/**
 * Feedback store — thumbs up / down per agent output
 *
 * Every piece of output JARVIS produces can be rated.
 * These ratings feed the learning loop — agents that get thumbs-down
 * more often will eventually trigger dreaming / self-correction.
 *
 * Decision 10aa: The learning loop only works with explicit signals.
 * Feedback is V1 non-negotiable.
 */

import { getDb, generateId, now } from "./schema.ts";
import { getAuditTrail } from "../authority/audit.ts";

export type FeedbackScore = 1 | -1;  // 1 = thumbs up, -1 = thumbs down

export interface FeedbackEntry {
  id: string;
  agentId: string;
  taskId?: string;
  conversationId?: string;
  messageId?: string;
  score: FeedbackScore;
  note?: string;
  createdAt: number;
}

export function storeFeedback(entry: Omit<FeedbackEntry, "id" | "createdAt">): FeedbackEntry {
  const db = getDb();
  const id = generateId();
  const createdAt = now();

  db.run(
    `INSERT OR IGNORE INTO feedback(id, agent_id, task_id, conversation_id, message_id, score, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      entry.agentId,
      entry.taskId ?? null,
      entry.conversationId ?? null,
      entry.messageId ?? null,
      entry.score,
      entry.note ?? null,
      createdAt,
    ]
  );

  getAuditTrail().log({
    action: "feedback_received",
    agentId: entry.agentId,
    taskId: entry.taskId,
    payload: { score: entry.score, note: entry.note },
    outcome: "success",
  });

  return { id, ...entry, createdAt };
}

export function getAgentFeedbackStats(agentId: string): {
  total: number;
  positive: number;
  negative: number;
  score: number;  // -1.0 to 1.0
} {
  const db = getDb();
  const rows = db.query<{ score: number; count: number }, []>(
    `SELECT score, COUNT(*) as count FROM feedback WHERE agent_id = ? GROUP BY score`,
  ).all(agentId);

  let positive = 0, negative = 0;
  for (const row of rows) {
    if (row.score === 1)  positive = row.count;
    if (row.score === -1) negative = row.count;
  }
  const total = positive + negative;
  const score = total === 0 ? 0 : (positive - negative) / total;

  return { total, positive, negative, score };
}

export function getRecentFeedback(opts?: {
  agentId?: string;
  limit?: number;
}): FeedbackEntry[] {
  const db = getDb();
  const limit = opts?.limit ?? 50;

  if (opts?.agentId) {
    return db.query<FeedbackEntry, [string, number]>(
      `SELECT id, agent_id as agentId, task_id as taskId, conversation_id as conversationId,
              message_id as messageId, score, note, created_at as createdAt
       FROM feedback WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?`
    ).all(opts.agentId, limit);
  }

  return db.query<FeedbackEntry, [number]>(
    `SELECT id, agent_id as agentId, task_id as taskId, conversation_id as conversationId,
            message_id as messageId, score, note, created_at as createdAt
     FROM feedback ORDER BY created_at DESC LIMIT ?`
  ).all(limit);
}
