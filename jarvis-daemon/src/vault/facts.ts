/**
 * Vault Facts — entity extraction, storage, and hybrid retrieval.
 * Hermes-inspired learning: facts are weighted by how often they're useful.
 */

import { getDb, generateId, now } from "./schema.ts";

export interface Entity {
  id: string;
  type: string;
  name: string;
  properties: Record<string, unknown> | null;
  created_at: number;
  updated_at: number;
}

export interface Fact {
  id: string;
  content: string;
  entity_id: string | null;
  source: string | null;
  confidence: number;
  created_at: number;
}

// ── Entity helpers ─────────────────────────────────────────────────────────

export function upsertEntity(type: string, name: string, props?: Record<string, unknown>): Entity {
  const db = getDb();
  const existing = db.query<Entity, [string, string]>(
    `SELECT * FROM entities WHERE type=? AND name=?`
  ).get(type, name);

  if (existing) {
    db.run(`UPDATE entities SET properties=?,updated_at=? WHERE id=?`,
      [props ? JSON.stringify(props) : existing.properties, now(), existing.id]);
    return { ...existing, updated_at: now() };
  }

  const e: Entity = {
    id: generateId(), type, name,
    properties: props ?? null,
    created_at: now(), updated_at: now(),
  };
  db.run(
    `INSERT INTO entities(id,type,name,properties,created_at,updated_at) VALUES(?,?,?,?,?,?)`,
    [e.id, e.type, e.name, e.properties ? JSON.stringify(e.properties) : null, e.created_at, e.updated_at]
  );
  return e;
}

export function findEntities(type?: string, limit = 50): Entity[] {
  const db = getDb();
  if (type) {
    return db.query<Entity, [string, number]>(
      `SELECT * FROM entities WHERE type=? ORDER BY updated_at DESC LIMIT ?`
    ).all(type, limit);
  }
  return db.query<Entity, [number]>(
    `SELECT * FROM entities ORDER BY updated_at DESC LIMIT ?`
  ).all(limit);
}

// ── Fact helpers ───────────────────────────────────────────────────────────

export function createFact(content: string, entityId?: string, source?: string, confidence = 1.0): Fact {
  const db = getDb();
  const f: Fact = {
    id: generateId(), content,
    entity_id: entityId ?? null,
    source: source ?? null,
    confidence,
    created_at: now(),
  };
  db.run(
    `INSERT INTO facts(id,content,entity_id,source,confidence,created_at) VALUES(?,?,?,?,?,?)`,
    [f.id, f.content, f.entity_id, f.source, f.confidence, f.created_at]
  );
  // Keep FTS in sync
  db.run(`INSERT INTO facts_fts(rowid,content) VALUES(last_insert_rowid(),?)`, [f.content]);
  return f;
}

export function searchFacts(query: string, limit = 10): Fact[] {
  const db = getDb();
  // Hybrid: FTS5 full-text + recency boost
  return db.query<Fact, [string, number]>(`
    SELECT f.* FROM facts f
    JOIN facts_fts fts ON f.rowid = fts.rowid
    WHERE facts_fts MATCH ?
    ORDER BY rank * -1, f.created_at DESC
    LIMIT ?
  `).all(query, limit);
}

export function getRecentFacts(limit = 20): Fact[] {
  return getDb().query<Fact, [number]>(
    `SELECT * FROM facts ORDER BY created_at DESC LIMIT ?`
  ).all(limit);
}

/**
 * Extract facts from a message using simple heuristics.
 * In production this calls the LLM — for now, a lightweight pattern matcher.
 */
export function extractFactsFromMessage(content: string): string[] {
  const facts: string[] = [];

  // "I am / I'm X"
  const iam = content.match(/\bi(?:'m| am)\s+([^.,!?]{5,60})/gi);
  if (iam) facts.push(...iam.map(f => f.trim()));

  // "My X is Y"
  const myX = content.match(/\bmy\s+\w+\s+is\s+[^.,!?]{3,60}/gi);
  if (myX) facts.push(...myX.map(f => f.trim()));

  // "I want to / I'm trying to"
  const goals = content.match(/\b(?:i want to|i'm trying to|i need to)\s+[^.,!?]{5,80}/gi);
  if (goals) facts.push(...goals.map(f => f.trim()));

  return facts.slice(0, 5); // cap per message
}
