/**
 * JARVIS Agent Dreaming — Decision 10abaa
 *
 * After 2-3 consecutive failures or corrections on the same task type,
 * the agent enters a dreaming session — a deep offline reflection that
 * runs between tasks. It reviews what went wrong, extracts the pattern,
 * and updates its own memory so the mistake doesn't repeat.
 *
 * Inspired by Anthropic's Claude Dreaming feature (Code with Claude, May 2026).
 * Harvey (legal AI) saw 6x task completion rates after enabling this.
 */

import type { LLMManager } from "../llm/manager.ts";
import { AgentJournal } from "./journal.ts";
import { recordLearning } from "./learnings.ts";
import { getDb, generateId, now } from "../vault/schema.ts";

export interface DreamTrigger {
  agentId: string;
  taskType: string;   // what kind of task keeps failing
  failures: number;   // how many consecutive failures
  errors: string[];   // the actual error messages
  userMessage: string;
}

export interface DreamResult {
  insight: string;    // what the agent learned
  newRule: string;    // specific rule to follow next time
  journalEntry: string;
}

// Track failure counts per agent+task-type
const failureCounts = new Map<string, { count: number; errors: string[]; lastMessage: string }>();

export function recordFailure(agentId: string, taskType: string, error: string, userMessage: string): number {
  const key = `${agentId}:${taskType}`;
  const existing = failureCounts.get(key) ?? { count: 0, errors: [], lastMessage: "" };
  const updated = {
    count: existing.count + 1,
    errors: [...existing.errors.slice(-4), error],
    lastMessage: userMessage,
  };
  failureCounts.set(key, updated);
  return updated.count;
}

export function resetFailures(agentId: string, taskType: string): void {
  failureCounts.delete(`${agentId}:${taskType}`);
}

export function shouldDream(agentId: string, taskType: string): boolean {
  const key = `${agentId}:${taskType}`;
  const data = failureCounts.get(key);
  return (data?.count ?? 0) >= 2;
}

/**
 * Run a dreaming session for an agent.
 * Called automatically when shouldDream() returns true.
 */
export async function runDreamingSession(
  trigger: DreamTrigger,
  llm: LLMManager
): Promise<DreamResult> {
  const { agentId, taskType, errors, userMessage } = trigger;

  const dreamPrompt = `You are the ${agentId} agent in JARVIS, conducting a self-reflection session.

You have failed at this type of task ${trigger.failures} times in a row:
Task type: "${taskType}"
Last message you were given: "${userMessage.slice(0, 300)}"
Errors that occurred:
${errors.map((e, i) => `${i + 1}. ${e}`).join("\n")}

Deep reflection process:
1. What specifically went wrong? (be precise, not vague)
2. What pattern do these failures share?
3. What did you misunderstand about the task or context?
4. What is the ONE specific rule that would have prevented all these failures?

Output format (follow exactly):
INSIGHT: [what you now understand that you didn't before]
NEW_RULE: [one specific, actionable rule to follow for this task type in future]
JOURNAL: [2-3 sentence journal entry in first person, past tense]`;

  try {
    const result = await llm.complete([
      { role: "system", content: "You are an AI agent performing honest self-reflection on your failures." },
      { role: "user", content: dreamPrompt },
    ], { agentId: "dreaming" });

    const output = result.content;
    const insight  = output.match(/INSIGHT:\s*(.+)/)?.[1]?.trim()   ?? "Reflection incomplete";
    const newRule  = output.match(/NEW_RULE:\s*(.+)/)?.[1]?.trim()  ?? "Review task requirements carefully";
    const journal  = output.match(/JOURNAL:\s*(.+)/s)?.[1]?.trim()  ?? output;

    // Durable learning — this rule persists and is injected into EVERY future run
    // for this agent, so the mistake never repeats (not just the next session).
    recordLearning(agentId, "lesson", newRule);

    // Write dreaming result to agent's journal
    const agentJournal = new AgentJournal(agentId);
    agentJournal.write({
      summary: `[DREAMING] ${insight}`,
      keyLearnings: [newRule],
      mood: "recovering",
      tokenUsedToday: result.usage.inputTokens + result.usage.outputTokens,
    });

    // Store in DB for visibility
    const db = getDb();
    db.run(
      `INSERT INTO agent_journals(id,agent_id,summary,tasks_completed,key_learnings,pending_items,mood,token_used_today,created_at)
       VALUES(?,?,?,?,?,?,?,?,?)`,
      [
        generateId(), agentId,
        `[DREAM] ${insight}`,
        "[]",
        JSON.stringify([newRule]),
        "[]",
        "recovering",
        result.usage.inputTokens + result.usage.outputTokens,
        now(),
      ]
    );

    // Reset the failure counter
    resetFailures(agentId, taskType);

    console.log(`[dream] ${agentId} completed dreaming session. New rule: ${newRule}`);

    return { insight, newRule, journalEntry: journal };
  } catch (e) {
    console.error(`[dream] Dreaming session failed for ${agentId}:`, e);
    return {
      insight: "Dreaming session failed — will retry after next failure",
      newRule: "Proceed more carefully and check inputs before acting",
      journalEntry: "Attempted self-reflection but encountered an error.",
    };
  }
}
