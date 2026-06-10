/**
 * Key-value settings store — backed by the `settings` table.
 * Used for lightweight persistent state that isn't a first-class entity:
 * onboarding checklist progress, UI dismissals, feature flags, etc.
 */

import { getDb, now } from "./schema.ts";

export function getSetting(key: string): string | null {
  const db = getDb();
  const row = db.query<{ value: string }>(
    "SELECT value FROM settings WHERE key = ?"
  ).get(key);
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  const db = getDb();
  db.run(
    `INSERT INTO settings(key, value, updated_at) VALUES(?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, now()]
  );
}

export function deleteSetting(key: string): void {
  const db = getDb();
  db.run("DELETE FROM settings WHERE key = ?", [key]);
}
