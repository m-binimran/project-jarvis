/**
 * Master Vision — the user's north star.
 * Every agent reads this before working. It is the foundation everything is built on.
 * Decision 16: Mandatory setup. No vision = directionless agents.
 */

import { getDb, now } from "./schema.ts";

export interface MasterVision {
  content: string;
  updatedAt: number;
}

const DEFAULT_VISION = `This is your Master Vision — your north star. Every agent reads it before working, so make it count.

Replace this with what YOU are working toward:
- Your #1 goal right now (and by when)
- Your top 3 priorities
- What you value (e.g. speed, quality, revenue, craft)
- The question JARVIS should ask before every action (e.g. "Does this move me toward my goal?")

You can change this any time in Settings, or just tell JARVIS: "update my vision".`;

export function getMasterVision(): MasterVision | null {
  const db = getDb();
  const row = db.query<{ content: string; updated_at: number }>(
    "SELECT content, updated_at FROM master_vision WHERE id = 1"
  ).get();
  if (!row) return null;
  return { content: row.content, updatedAt: row.updated_at };
}

export function setMasterVision(content: string): void {
  const db = getDb();
  db.run(
    `INSERT INTO master_vision(id, content, updated_at) VALUES(1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
    [content, now()]
  );
}

export function ensureDefaultVision(): void {
  const existing = getMasterVision();
  if (!existing) {
    setMasterVision(DEFAULT_VISION);
    console.log("[vision] No vision set yet — seeded the onboarding placeholder.");
  }
}

/** Returns the vision as a system prompt prefix for any agent */
export function buildVisionPrefix(): string {
  const vision = getMasterVision();
  if (!vision) return "";
  return `=== MASTER VISION (your north star — read this before every task) ===
${vision.content}
=== END MASTER VISION ===\n\n`;
}
