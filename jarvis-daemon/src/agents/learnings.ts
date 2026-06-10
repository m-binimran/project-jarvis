/**
 * JARVIS Learnings — durable memory that changes behaviour over time.
 *
 * Unlike the per-session journal (which only keeps the latest entry), learnings
 * ACCUMULATE and are ALWAYS injected into the agent's prompt, so JARVIS:
 *   - never repeats a mistake it (or the user) flagged   → kind "mistake" / "lesson"
 *   - follows what the user said they like/prefer         → kind "preference"
 *
 * Preferences are stored under the special agent id "user" so EVERY agent follows
 * them. Mistakes/lessons are per-agent. Deduped + pruned so the prompt stays small.
 */

import { getDb, generateId, now } from "../vault/schema.ts";

export type LearningKind = "mistake" | "preference" | "lesson";

export interface Learning {
  id: string;
  agentId: string;
  kind: LearningKind;
  text: string;
  createdAt: number;
}

const KEEP_PER_AGENT = 40;

function ensureTable(): void {
  getDb().run(
    `CREATE TABLE IF NOT EXISTS agent_learnings(
       id TEXT PRIMARY KEY,
       agent_id TEXT NOT NULL,
       kind TEXT NOT NULL,
       text TEXT NOT NULL,
       created_at INTEGER NOT NULL
     )`
  );
}

/** Store a durable learning. Near-duplicates are ignored so it doesn't bloat. */
export function recordLearning(agentId: string, kind: LearningKind, text: string | null | undefined): void {
  const t = (text ?? "").trim();
  if (t.length < 4) return;
  ensureTable();
  const db = getDb();
  const norm = t.toLowerCase().slice(0, 120);
  const recent = db.query<{ text: string }, [string, string]>(
    `SELECT text FROM agent_learnings WHERE agent_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 30`
  ).all(agentId, kind);
  if (recent.some(r => r.text.toLowerCase().slice(0, 120) === norm)) return; // already know this

  db.run(
    `INSERT INTO agent_learnings(id,agent_id,kind,text,created_at) VALUES(?,?,?,?,?)`,
    [generateId(), agentId, kind, t.slice(0, 400), now()]
  );
  // Prune to the newest KEEP_PER_AGENT for this agent.
  db.run(
    `DELETE FROM agent_learnings WHERE agent_id = ?
       AND id NOT IN (SELECT id FROM agent_learnings WHERE agent_id = ? ORDER BY created_at DESC LIMIT ${KEEP_PER_AGENT})`,
    [agentId, agentId]
  );
}

/** This agent's learnings + the global "user" preferences every agent should honour. */
export function getLearnings(agentId: string, limit = 14): Learning[] {
  ensureTable();
  const rows = getDb().query<{
    id: string; agent_id: string; kind: string; text: string; created_at: number;
  }, [string, number]>(
    `SELECT * FROM agent_learnings WHERE agent_id IN (?, 'user') ORDER BY created_at DESC LIMIT ?`
  ).all(agentId, limit);
  return rows.map(r => ({ id: r.id, agentId: r.agent_id, kind: r.kind as LearningKind, text: r.text, createdAt: r.created_at }));
}

/** A compact prompt block of learned preferences + mistakes-to-avoid. Injected every run. */
export function buildLearningPrefix(agentId: string): string {
  const items = getLearnings(agentId, 14);
  if (!items.length) return "";
  const prefs    = items.filter(i => i.kind === "preference").map(i => i.text);
  const mistakes = items.filter(i => i.kind === "mistake" || i.kind === "lesson").map(i => i.text);

  const lines: string[] = ["[WHAT YOU'VE LEARNED — follow these; they override your defaults]"];
  if (prefs.length)    lines.push("The user prefers:\n" + prefs.map(p => `- ${p}`).join("\n"));
  if (mistakes.length) lines.push("Never repeat these mistakes:\n" + mistakes.map(m => `- ${m}`).join("\n"));
  lines.push("[END LEARNED]");
  return lines.join("\n");
}

// ── Signal detectors (cheap, deterministic) ──────────────────────────────────

const FRUSTRATION = /\b(this is (wrong|not right|bad)|that'?s (wrong|not what|incorrect)|not what i (asked|wanted|meant)|you (keep|always|still)|wrong again|did ?n'?t work|does ?n'?t work|not working|messed? up|messing up|useless|terrible|awful|frustrat\w*|annoying|ugh|come on|seriously\??|try again|that'?s not it)\b/i;

/** True when the user's message reads as frustration / a correction. */
export function detectFrustration(text: string): boolean {
  return FRUSTRATION.test(text || "");
}

const PREFERENCE = /\b(always|never|from now on|going forward|don'?t ever|stop (saying|using|doing|adding|being)|keep (it|your (answers?|replies?|responses?)) (short|brief|concise|simple|long|detailed)|i prefer|i like it when|please always|please don'?t|make sure you always|i (don'?t|do not) (like|want))\b/i;

/** If the message is a short standing instruction (not a one-off task), return it as a preference. */
export function detectPreference(text: string): string | null {
  const t = (text || "").trim();
  if (t.length < 6 || t.length > 220) return null; // long = probably a task, not a standing preference
  return PREFERENCE.test(t) ? t : null;
}
