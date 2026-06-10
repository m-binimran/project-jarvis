/**
 * JARVIS Agent Journals
 *
 * Each agent writes a journal entry when a task ends.
 * The next task run reads the last journal to restore context.
 * Zero token cost when dormant — only loaded when the agent activates.
 */

import { getDb, generateId, now } from "../vault/schema.ts";

export interface JournalEntry {
  id: string;
  agentId: string;
  summary: string;
  tasksCompleted: string[];
  keyLearnings: string[];
  pendingItems: string[];
  mood: "nominal" | "degraded" | "recovering";
  tokenUsedToday: number;
  createdAt: number;
}

export class AgentJournal {
  private agentId: string;
  constructor(agentId: string) { this.agentId = agentId; }

  /** Write an entry at task completion */
  write(params: {
    summary: string;
    tasksCompleted?: string[];
    keyLearnings?: string[];
    pendingItems?: string[];
    mood?: JournalEntry["mood"];
    tokenUsedToday?: number;
  }): void {
    const db = getDb();
    db.run(
      `INSERT INTO agent_journals(id,agent_id,summary,tasks_completed,key_learnings,pending_items,mood,token_used_today,created_at)
       VALUES(?,?,?,?,?,?,?,?,?)`,
      [
        generateId(),
        this.agentId,
        params.summary,
        JSON.stringify(params.tasksCompleted ?? []),
        JSON.stringify(params.keyLearnings ?? []),
        JSON.stringify(params.pendingItems ?? []),
        params.mood ?? "nominal",
        params.tokenUsedToday ?? 0,
        now(),
      ]
    );
  }

  /** Read the most recent journal entry — called at agent startup */
  readLatest(): JournalEntry | null {
    const db = getDb();
    const row = db.query<{
      id: string; agent_id: string; summary: string;
      tasks_completed: string; key_learnings: string;
      pending_items: string; mood: string;
      token_used_today: number; created_at: number;
    }, [string]>(
      `SELECT * FROM agent_journals WHERE agent_id = ? ORDER BY created_at DESC LIMIT 1`
    ).get(this.agentId);

    if (!row) return null;

    return {
      id: row.id,
      agentId: row.agent_id,
      summary: row.summary,
      tasksCompleted: JSON.parse(row.tasks_completed),
      keyLearnings: JSON.parse(row.key_learnings),
      pendingItems: JSON.parse(row.pending_items),
      mood: row.mood as JournalEntry["mood"],
      tokenUsedToday: row.token_used_today,
      createdAt: row.created_at,
    };
  }

  /** Get the last N journal entries */
  history(limit = 7): JournalEntry[] {
    const db = getDb();
    const rows = db.query<{
      id: string; agent_id: string; summary: string;
      tasks_completed: string; key_learnings: string;
      pending_items: string; mood: string;
      token_used_today: number; created_at: number;
    }, [string, number]>(
      `SELECT * FROM agent_journals WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?`
    ).all(this.agentId, limit);

    return rows.map(r => ({
      id: r.id,
      agentId: r.agent_id,
      summary: r.summary,
      tasksCompleted: JSON.parse(r.tasks_completed),
      keyLearnings: JSON.parse(r.key_learnings),
      pendingItems: JSON.parse(r.pending_items),
      mood: r.mood as JournalEntry["mood"],
      tokenUsedToday: r.token_used_today,
      createdAt: r.created_at,
    }));
  }

  /**
   * Build a compact system prompt prefix from the last journal.
   * Injected at the start of each agent turn — gives it memory without
   * burning tokens on full conversation history.
   */
  buildContextPrefix(): string {
    const latest = this.readLatest();
    if (!latest) return "";

    const lines: string[] = [
      `[JOURNAL — last session: ${new Date(latest.createdAt).toLocaleDateString()}]`,
      `Status: ${latest.mood}`,
      `Summary: ${latest.summary}`,
    ];

    if (latest.pendingItems.length) {
      lines.push(`Pending: ${latest.pendingItems.join(", ")}`);
    }
    if (latest.keyLearnings.length) {
      lines.push(`Remember: ${latest.keyLearnings.join("; ")}`);
    }
    lines.push("[END JOURNAL]");

    return lines.join("\n");
  }
}
