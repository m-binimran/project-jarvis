/**
 * JARVIS Agent Runner
 *
 * The core execution loop for a single agent.
 * Wraps the LLM call with:
 *   - Journal context injection
 *   - Rate limiting
 *   - Three-strikes abort
 *   - Permission checks before every tool call
 *   - Audit trail on every action
 *
 * This is the "inner loop" — one agent, one task.
 * The orchestrator coordinates multiple agents.
 */

import type { LLMManager } from "../llm/manager.ts";
import type { LLMMessage } from "../llm/provider.ts";
import { AuthorityEngine, type ActionCategory } from "../authority/engine.ts";
import { getAuditTrail } from "../authority/audit.ts";
import { guardToolResult } from "../authority/scanner.ts";
import { AgentJournal } from "./journal.ts";
import { RateLimiter, DEFAULT_LIMITS } from "./rate-limiter.ts";
import { getDb, generateId, now } from "../vault/schema.ts";
import { buildVisionPrefix } from "../vault/master-vision.ts";
import { recordFailure, shouldDream, runDreamingSession } from "./dreaming.ts";
import { buildLearningPrefix, recordLearning, detectFrustration, detectPreference } from "./learnings.ts";

/**
 * Pull a tool call out of an agent response — tolerantly.
 *
 * Accepts `TOOL_CALL:<name>:<json>` with optional spaces around the colons,
 * ignores any prose the model adds AFTER the JSON object, and brace-matches the
 * object so a `}` inside a JSON string doesn't end it early. Returns the tool
 * name plus the exact JSON substring, or null if there's no tool call.
 *
 * This replaces a greedy `(\{.*\})` regex that over-captured trailing text and
 * made a single malformed line crash the whole agent turn.
 */
export function extractToolCall(response: string): { name: string; json: string } | null {
  const m = response.match(/TOOL_CALL:\s*([\w.\-]+)\s*:\s*/);
  if (!m || m.index === undefined) return null;
  const start = m.index + m[0].length;
  if (response[start] !== "{") return null;

  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < response.length; i++) {
    const ch = response[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') {
      inStr = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return { name: m[1], json: response.slice(start, i + 1) };
    }
  }
  return null; // unbalanced — no complete JSON object
}

export interface AgentTool {
  name: string;
  description: string;
  category: ActionCategory;
  run: (params: Record<string, unknown>) => Promise<unknown>;
}

export interface AgentDefinition {
  id: string;
  name: string;
  role?: "head" | "team_lead" | "specialist";
  systemPrompt: string;
  tools: AgentTool[];
  model?: string;
  maxTurns?: number;
  temperature?: number;
  /** Set false for fast conversational agents — skips the self-review LLM call. */
  reflect?: boolean;
}

export interface RunResult {
  success: boolean;
  output: string;
  turns: number;
  abortReason?: string;
  tokensUsed: number;
}

// Sentinel — agent asks for approval via this tool name
const APPROVAL_TOOL = "__request_approval__";

/**
 * Strip self-review scaffolding from a final answer. The reflection step asks the
 * agent to reply "APPROVED" or an improved version; small models often wrap the
 * answer in review chatter ("Improvement needed.", "Missing context.", a trailing
 * "APPROVED"). None of that should ever reach the user.
 */
function stripControlTokens(text: string): string {
  return text
    .replace(/^\s*(?:improvement needed|missing context|needs?\s+improvement|revised(?:\s+version)?|improved\s+version|here(?:'s| is)\s+the\s+improved\s+version)\s*[:.\-]?\s*/i, "")
    .replace(/\s*\n*\s*APPROVED\.?\s*$/i, "")
    .trim();
}

export class AgentRunner {
  private agent: AgentDefinition;
  private llm: LLMManager;
  private authority: AuthorityEngine;
  private strikeLimit: number;
  private journal: AgentJournal;
  private limiter: RateLimiter;
  private audit = getAuditTrail();
  private strikes = 0;

  constructor(
    agent: AgentDefinition,
    llm: LLMManager,
    authority: AuthorityEngine,
    strikeLimit = 3
  ) {
    this.agent = agent;
    this.llm = llm;
    this.authority = authority;
    this.strikeLimit = strikeLimit;
    this.journal = new AgentJournal(agent.id);
    this.limiter = new RateLimiter({ agentId: agent.id, ...DEFAULT_LIMITS });
  }

  async run(params: {
    userMessage: string;
    conversationId?: string;
    taskId?: string;
    onApprovalNeeded?: (action: ActionCategory, context: string, agentId?: string) => Promise<boolean>;
    onStream?: (delta: string) => void;
    /** A2A: called when this agent hands off to another agent. Returns that agent's output. */
    onHandoff?: (toAgentId: string, context: string, taskId?: string, fromAgentId?: string) => Promise<string>;
  }): Promise<RunResult> {
    const { userMessage, conversationId, taskId, onApprovalNeeded } = params;
    let totalTokens = 0;
    let turns = 0;
    this.strikes = 0;

    this.audit.log({
      action: "agent_start",
      agentId: this.agent.id,
      taskId,
      conversationId,
      payload: { userMessage: userMessage.slice(0, 200) },
    });

    // Learn from the user's message: capture a standing preference, and if they
    // sound frustrated/corrective, dream about it (reflect + record a lesson).
    const pref = detectPreference(userMessage);
    if (pref) recordLearning("user", "preference", pref);
    if (detectFrustration(userMessage)) {
      recordFailure(this.agent.id, "user-frustration", "User sounded frustrated or corrected the agent", userMessage);
      if (shouldDream(this.agent.id, "user-frustration")) {
        runDreamingSession({
          agentId: this.agent.id, taskType: "user-frustration", failures: 2,
          errors: ["User expressed frustration: " + userMessage.slice(0, 200)], userMessage,
        }, this.llm).catch(() => {});
      }
    }

    // Build initial messages: vision + LEARNINGS + journal + agent prompt
    const visionPrefix   = buildVisionPrefix();
    const learningPrefix = buildLearningPrefix(this.agent.id);
    const journalPrefix  = this.journal.buildContextPrefix();
    const systemPrompt   = [visionPrefix, learningPrefix, journalPrefix, this.agent.systemPrompt]
      .filter(Boolean)
      .join("\n\n");

    const messages: LLMMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ];

    const maxTurns = this.agent.maxTurns ?? 10;
    let lastOutput = "";
    let reflected = false; // self-review runs at most once per task

    try {
      while (turns < maxTurns) {
        turns++;

        // Context compaction — if conversation is getting long, summarise to stay sharp (Decision 10a)
        if (messages.length > 20) {
          const mid = messages.slice(2, messages.length - 2);
          const summary = await this.llm.complete([
            { role: "system", content: "You are a summariser. Summarise the following conversation history into a compact context block. Keep all important facts, decisions, and tool results. Discard conversational filler." },
            { role: "user", content: mid.map(m => `[${m.role}]: ${m.content}`).join("\n") },
          ], { agentId: "compactor" });
          messages.splice(2, mid.length, {
            role: "user",
            content: `[COMPACTED CONTEXT]\n${summary.content}\n[END COMPACTED CONTEXT]`,
          });
          this.audit.log({ action: "agent_start", agentId: this.agent.id, taskId, payload: { note: "context_compacted" } });
        }

        // Rate limit check
        const rateCheck = this.limiter.consume(0);
        if (!rateCheck.allowed) {
          this.audit.log({
            action: "rate_limit_hit",
            agentId: this.agent.id,
            taskId,
            outcome: "blocked",
            payload: { resetAt: rateCheck.resetAt },
          });
          return {
            success: false,
            output: "Rate limit reached. Try again later.",
            turns,
            abortReason: "rate_limit",
            tokensUsed: totalTokens,
          };
        }

        // LLM call
        let response: string;
        try {
          const result = await this.llm.complete(messages, {
            model: this.agent.model,
            conversationId,
            agentId: this.agent.id,
          });

          response = result.content;
          totalTokens += result.usage.inputTokens + result.usage.outputTokens;

          this.audit.log({
            action: "llm_call",
            agentId: this.agent.id,
            taskId,
            payload: {
              model: result.model,
              inputTokens: result.usage.inputTokens,
              outputTokens: result.usage.outputTokens,
            },
          });

          this.strikes = 0; // reset on success
        } catch (err) {
          this.strikes++;

          if (this.strikes >= this.strikeLimit) {
            this.audit.log({
              action: "three_strikes_abort",
              agentId: this.agent.id,
              taskId,
              outcome: "failure",
              payload: { error: String(err), strikes: this.strikes },
            });

            // Dreaming: record failure and trigger self-reflection if threshold hit
            const taskType = userMessage.slice(0, 50);
            const failCount = recordFailure(this.agent.id, taskType, String(err), userMessage);
            if (shouldDream(this.agent.id, taskType)) {
              // Run dreaming asynchronously — don't block the response
              runDreamingSession({
                agentId: this.agent.id,
                taskType,
                failures: failCount,
                errors: [String(err)],
                userMessage,
              }, this.llm).catch(console.error);
            }

            this.journal.write({
              summary: `Aborted after ${this.strikeLimit} consecutive LLM failures`,
              mood: "degraded",
              tokenUsedToday: totalTokens,
            });

            return {
              success: false,
              output: "Three consecutive failures — task aborted. JARVIS is waiting for instructions.",
              turns,
              abortReason: "three_strikes",
              tokensUsed: totalTokens,
            };
          }

          // Back off and retry
          messages.push({ role: "assistant", content: `[Error: ${String(err)}]` });
          messages.push({ role: "user", content: "An error occurred. Please try a different approach." });
          continue;
        }

        lastOutput = response;
        // NOTE: we deliberately do NOT stream the raw response here — it may be a
        // TOOL_CALL/HANDOFF protocol line or an intermediate reflection turn.
        // The final, cleaned answer is streamed once when the loop resolves below.

        // ── A2A Handoff / Escalate pattern ───────────────────────────────────
        // Format: HANDOFF:<agentId>:<context>  or  ESCALATE:<agentId>:<context>
        const a2aMatch = response.match(/(?:HANDOFF|ESCALATE):([a-zA-Z0-9_-]+):(.+)/s);
        if (a2aMatch && params.onHandoff) {
          const [, toAgentId, context] = a2aMatch;
          const isEscalate = response.startsWith("ESCALATE");

          this.audit.log({
            action: "agent_a2a_message",
            agentId: this.agent.id,
            taskId,
            payload: { type: isEscalate ? "escalate" : "handoff", to: toAgentId },
          });

          params.onStream?.(
            isEscalate
              ? `↑ Escalating to ${toAgentId}…`
              : `→ Handing off to ${toAgentId}…`
          );

          try {
            const subResult = await params.onHandoff(toAgentId, context.trim(), taskId, this.agent.id);
            messages.push({ role: "assistant", content: response });
            messages.push({ role: "user", content: `HANDOFF_RESULT from ${toAgentId}: ${subResult}` });
            lastOutput = subResult;
          } catch (e) {
            messages.push({ role: "assistant", content: response });
            messages.push({ role: "user", content: `HANDOFF_FAILED: ${String(e)}. Continue with what you have.` });
          }
          continue;
        }

        // ── Tool call pattern ─────────────────────────────────────────────
        // Format: TOOL_CALL:<toolName>:<jsonParams>  (parsed tolerantly).
        const call = extractToolCall(response);
        if (call) {
          const toolName = call.name;
          let toolParams: Record<string, unknown>;
          try {
            toolParams = JSON.parse(call.json) as Record<string, unknown>;
          } catch {
            // Malformed JSON from the model — recover instead of failing the turn:
            // tell the agent what went wrong and let it retry on the next turn.
            messages.push({ role: "assistant", content: response });
            messages.push({ role: "user", content: `Your TOOL_CALL for "${toolName}" had invalid JSON. Resend it exactly as TOOL_CALL:${toolName}:{ ...valid JSON... } with nothing after the closing brace.` });
            continue;
          }

          const tool = this.agent.tools.find(t => t.name === toolName);
          if (!tool) {
            messages.push({ role: "assistant", content: response });
            messages.push({ role: "user", content: `Tool "${toolName}" not found.` });
            continue;
          }

          // Permission check
          const decision = this.authority.check(tool.category);
          this.audit.log({
            action: "permission_check",
            agentId: this.agent.id,
            taskId,
            payload: { tool: toolName, category: tool.category, decision },
          });

          if (!decision.allowed) {
            this.audit.log({
              action: "permission_denied",
              agentId: this.agent.id,
              taskId,
              outcome: "blocked",
              payload: { tool: toolName, reason: decision.reason },
            });
            messages.push({ role: "assistant", content: response });
            messages.push({ role: "user", content: `Permission denied: ${decision.reason}` });
            continue;
          }

          if (decision.requiresApproval && onApprovalNeeded) {
            const approved = await onApprovalNeeded(
              tool.category,
              `${tool.name}: ${JSON.stringify(toolParams)}`,
              this.agent.id
            );

            if (!approved) {
              this.audit.log({
                action: "circuit_breaker_triggered",
                agentId: this.agent.id,
                taskId,
                outcome: "blocked",
                payload: { tool: toolName, reason: "user denied" },
              });
              messages.push({ role: "assistant", content: response });
              messages.push({ role: "user", content: "Action was not approved. Stop or try a different approach." });
              continue;
            }

            this.audit.log({
              action: "permission_granted",
              agentId: this.agent.id,
              taskId,
              payload: { tool: toolName, approvedBy: "user" },
            });
          }

          // Execute tool
          let toolResult: unknown;
          try {
            this.audit.log({
              action: "tool_call",
              agentId: this.agent.id,
              taskId,
              payload: { tool: toolName, params: toolParams },
            });

            toolResult = await tool.run(toolParams);

            this.audit.log({
              action: "tool_result",
              agentId: this.agent.id,
              taskId,
              payload: { tool: toolName, success: true },
            });
          } catch (err) {
            toolResult = { error: String(err) };
            this.audit.log({
              action: "tool_result",
              agentId: this.agent.id,
              taskId,
              outcome: "failure",
              payload: { tool: toolName, error: String(err) },
            });
          }

          // Tool output is UNTRUSTED — scan it for prompt-injection before it
          // re-enters the model, and defang it if a pattern is found.
          const guarded = guardToolResult(toolName, toolResult);
          if (guarded.risk !== "safe") {
            this.audit.log({
              action: "injection_detected", agentId: this.agent.id, taskId,
              payload: { tool: toolName, risk: guarded.risk, patterns: guarded.flaggedPatterns },
            });
          }
          messages.push({ role: "assistant", content: response });
          messages.push({ role: "user", content: `TOOL_RESULT: ${guarded.text}` });
          continue;
        }

        // No tool call — agent reviews own output before finishing (Decision 10ab)
        // Only run reflection if the response is substantive (more than a one-liner)
        if (this.agent.reflect !== false && !reflected && response.length > 120 && turns < maxTurns - 1) {
          reflected = true; // only reflect once — avoids endless re-review loops
          messages.push({ role: "assistant", content: response });
          messages.push({
            role: "user",
            content: `Before you finalise: quickly check your response against the original request.
Does it fully answer what was asked? Is anything missing or weak?
If it's good — reply with exactly: APPROVED
If it needs improvement — reply with ONLY the improved answer, no preamble.`,
          });
          continue; // one more turn for self-review
        }

        // Reflection resolved. Small models often wrap or omit the APPROVED token,
        // so detect it loosely and strip any review scaffolding from the final text.
        if (/^\s*APPROVED\.?\s*$/i.test(response)) {
          const prev = messages[messages.length - 2]?.content;
          lastOutput = typeof prev === "string" ? prev : lastOutput;
        } else {
          lastOutput = response;
        }
        lastOutput = stripControlTokens(lastOutput);
        params.onStream?.(lastOutput); // stream the final, cleaned answer once
        break;
      }

      this.audit.log({
        action: "agent_complete",
        agentId: this.agent.id,
        taskId,
        conversationId,
        payload: { turns, tokensUsed: totalTokens },
      });

      this.journal.write({
        summary: `Completed task in ${turns} turns`,
        tasksCompleted: [userMessage.slice(0, 100)],
        mood: "nominal",
        tokenUsedToday: totalTokens,
      });

      return { success: true, output: lastOutput, turns, tokensUsed: totalTokens };

    } catch (err) {
      this.audit.log({
        action: "agent_fail",
        agentId: this.agent.id,
        taskId,
        outcome: "failure",
        payload: { error: String(err) },
      });

      this.journal.write({
        summary: `Failed: ${String(err)}`,
        mood: "degraded",
        tokenUsedToday: totalTokens,
      });

      return {
        success: false,
        output: `Agent failed: ${String(err)}`,
        turns,
        abortReason: String(err),
        tokensUsed: totalTokens,
      };
    }
  }
}

/** Update agent status in the DB */
export function setAgentStatus(
  agentId: string,
  status: "idle" | "running" | "error" | "dormant"
): void {
  try {
    const db = getDb();
    db.run(
      `UPDATE agents SET status=?, last_active=? WHERE id=?`,
      [status, now(), agentId]
    );
  } catch { /* non-fatal */ }
}
