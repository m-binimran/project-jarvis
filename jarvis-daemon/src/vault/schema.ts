/**
 * JARVIS Vault — SQLite Schema
 * Single local file. Everything lives here. Nothing leaves the machine.
 *
 * Uses better-sqlite3 (Node.js compatible). Same synchronous API as bun:sqlite
 * so the rest of the codebase doesn't need changes.
 */

// @ts-ignore — better-sqlite3 CJS default export
import BetterSqlite3 from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import { mkdirSync } from "node:fs";

// ── Compat shim — exposes a bun:sqlite-like interface over better-sqlite3 ──

export class Database {
  private raw: BetterSqlite3.Database;

  constructor(filePath: string, _opts?: { create?: boolean }) {
    this.raw = new BetterSqlite3(filePath);
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  run(sql: string, params: unknown[] = []): void {
    this.raw.prepare(sql).run(...params);
  }

  query<TRow = Record<string, unknown>, _TParams = unknown[]>(sql: string) {
    const stmt = this.raw.prepare(sql);
    return {
      get: (...params: unknown[]): TRow | null => {
        // Accept either spread args or a single array
        const args = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
        return (stmt.get(...(args as unknown[])) as TRow) ?? null;
      },
      all: (...params: unknown[]): TRow[] => {
        const args = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
        return stmt.all(...(args as unknown[])) as TRow[];
      },
    };
  }

  close(): void {
    this.raw.close();
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────

let db: Database | null = null;

export function generateId(): string {
  return crypto.randomUUID();
}

export function now(): number {
  return Date.now();
}

export function getDb(): Database {
  if (!db) throw new Error("Database not initialised. Call initDatabase() first.");
  return db;
}

export function closeDb(): void {
  db?.close();
  db = null;
}

export function defaultDbPath(): string {
  return path.join(os.homedir(), ".jarvis", "vault.db");
}

export function initDatabase(dbPath: string = defaultDbPath()): Database {
  closeDb();

  const dir = path.dirname(dbPath);
  mkdirSync(dir, { recursive: true });

  db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  db.exec("PRAGMA synchronous=NORMAL");

  createTables(db);
  console.log(`[vault] Initialised at ${dbPath}`);
  return db;
}

function createTables(db: Database): void {

  // ── Conversations ──────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT,
      mode TEXT NOT NULL DEFAULT 'basic',
      agent_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user','assistant','system','tool')),
      content TEXT NOT NULL,
      agent_id TEXT,
      tokens_used INTEGER DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
  `);

  // ── Vault Memory ──────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      properties TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS facts (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      entity_id TEXT REFERENCES entities(id),
      source TEXT,
      confidence REAL DEFAULT 1.0,
      embedding TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(content, content=facts, content_rowid=rowid);

    CREATE TABLE IF NOT EXISTS relationships (
      id TEXT PRIMARY KEY,
      from_entity TEXT NOT NULL REFERENCES entities(id),
      to_entity TEXT NOT NULL REFERENCES entities(id),
      type TEXT NOT NULL,
      properties TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_facts_entity ON facts(entity_id);
    CREATE INDEX IF NOT EXISTS idx_relationships_from ON relationships(from_entity);
  `);

  // ── Agent System ───────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'specialist',
      department_id TEXT,
      status TEXT NOT NULL DEFAULT 'dormant',
      last_active INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      mode TEXT NOT NULL DEFAULT 'basic',
      status TEXT NOT NULL DEFAULT 'dormant',
      created_at INTEGER NOT NULL
    );
  `);

  // ── Agent Journals ─────────────────────────────────────────────────────────
  // Matches journal.ts: summary, tasks_completed, key_learnings, pending_items, mood, token_used_today
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_journals (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      tasks_completed TEXT NOT NULL DEFAULT '[]',
      key_learnings TEXT NOT NULL DEFAULT '[]',
      pending_items TEXT NOT NULL DEFAULT '[]',
      mood TEXT NOT NULL DEFAULT 'nominal',
      token_used_today INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_journals_agent ON agent_journals(agent_id, created_at DESC);
  `);

  // ── Tasks ──────────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      agent_id TEXT,
      failure_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  `);

  // ── Authority & Audit ──────────────────────────────────────────────────────
  // Matches audit.ts: action, agent_id, task_id, conversation_id, payload (JSON), outcome, chain_hash
  db.exec(`
    CREATE TABLE IF NOT EXISTS permission_config (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      mode TEXT NOT NULL DEFAULT 'safe',
      updated_at INTEGER NOT NULL
    );

    INSERT OR IGNORE INTO permission_config(id, mode, updated_at) VALUES(1, 'safe', ${now()});

    CREATE TABLE IF NOT EXISTS audit_trail (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      agent_id TEXT,
      task_id TEXT,
      conversation_id TEXT,
      payload TEXT NOT NULL DEFAULT '{}',
      outcome TEXT NOT NULL DEFAULT 'success',
      chain_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audit_agent ON audit_trail(agent_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_trail(created_at DESC);
  `);

  // ── Rate Limit Buckets ─────────────────────────────────────────────────────
  // Matches rate-limiter.ts: agent_id (PK), window_start, tokens_used, calls_made
  db.exec(`
    CREATE TABLE IF NOT EXISTS rate_limit_buckets (
      agent_id TEXT PRIMARY KEY,
      window_start INTEGER NOT NULL,
      tokens_used INTEGER DEFAULT 0,
      calls_made INTEGER DEFAULT 0
    );
  `);

  // ── Usage / Token Tracking ─────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_stats (
      id TEXT PRIMARY KEY,
      conversation_id TEXT,
      agent_id TEXT,
      model TEXT NOT NULL,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_usage_time ON usage_stats(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_usage_conv ON usage_stats(conversation_id);
  `);

  // ── Advisor Council ────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS advisors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      focus TEXT,
      sources TEXT,
      last_synced INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS advisor_knowledge (
      id TEXT PRIMARY KEY,
      advisor_id TEXT NOT NULL REFERENCES advisors(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_url TEXT,
      embedding TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS advisor_knowledge_fts
      USING fts5(content, content=advisor_knowledge, content_rowid=rowid);
  `);

  // ── Sidecars ───────────────────────────────────────────────────────────────
  // Matches sidecar/manager.ts: public_key_ref (keychain pointer), active flag, last_seen_at
  db.exec(`
    CREATE TABLE IF NOT EXISTS sidecars (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      public_key_ref TEXT NOT NULL,
      last_seen_at INTEGER,
      created_at INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );
  `);

  // ── Settings ───────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  // ── Feedback ───────────────────────────────────────────────────────────────
  // Decision: thumbs up/down per agent output — feeds learning loop
  db.exec(`
    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      task_id TEXT,
      conversation_id TEXT,
      message_id TEXT,
      score INTEGER NOT NULL CHECK(score IN (1, -1)),
      note TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_feedback_agent ON feedback(agent_id, created_at DESC);
  `);

  // ── Master Vision ──────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS master_vision (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      content TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  // ── Workflows ──────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      definition TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'saved',
      last_run_at INTEGER,
      run_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'running',
      input TEXT,
      output TEXT,
      error TEXT,
      started_at INTEGER NOT NULL,
      finished_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_workflow_runs ON workflow_runs(workflow_id, started_at DESC);
  `);
}

// Alias so index.ts can call initDatabase as initDb via the import alias
export { initDatabase as initDb };
