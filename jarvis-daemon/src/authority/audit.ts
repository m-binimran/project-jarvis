/**
 * JARVIS Audit Trail
 *
 * Tamper-evident log of every action JARVIS takes.
 * Each record includes a chain hash (SHA-256 of previous record + current data)
 * so any deletion or modification is detectable.
 *
 * Inspired by Microsoft Agent Governance Toolkit's audit pattern —
 * written fresh against our schema.
 */

import { createHash } from "node:crypto";
import { getDb, generateId, now } from "../vault/schema.ts";
import { redactObject } from "../vault/redact.ts";

export type AuditAction =
  | "agent_start"
  | "agent_complete"
  | "agent_fail"
  | "tool_call"
  | "tool_result"
  | "permission_check"
  | "permission_granted"
  | "permission_denied"
  | "circuit_breaker_triggered"
  | "llm_call"
  | "message_sent"
  | "file_read"
  | "file_write"
  | "system_start"
  | "system_stop"
  | "key_stored"
  | "sidecar_connect"
  | "sidecar_disconnect"
  | "rate_limit_hit"
  | "three_strikes_abort"
  | "feedback_received"
  | "agent_a2a_message"
  | "agent_loop_start"
  | "agent_loop_step"
  | "agent_loop_end"
  | "injection_detected";

export interface AuditEntry {
  id: string;
  action: AuditAction;
  agentId?: string;
  taskId?: string;
  conversationId?: string;
  payload: Record<string, unknown>;
  outcome: "success" | "failure" | "pending" | "blocked";
  chainHash: string;
  createdAt: number;
}

export class AuditTrail {
  private lastHash = "GENESIS";

  constructor() {
    // Restore last hash from DB so chain continues across restarts
    this.restoreChainHead();
  }

  private restoreChainHead(): void {
    try {
      const db = getDb();
      const row = db.query<{ chain_hash: string }, []>(
        // rowid tiebreaker: created_at (ms) can collide under rapid writes; rowid
        // is the true insertion order, so the chain head is always deterministic.
        `SELECT chain_hash FROM audit_trail ORDER BY created_at DESC, rowid DESC LIMIT 1`
      ).get();
      if (row) this.lastHash = row.chain_hash;
    } catch { /* fresh DB — stay at GENESIS */ }
  }

  private computeHash(
    action: AuditAction,
    payload: Record<string, unknown>,
    outcome: string,
    ts: number
  ): string {
    const data = `${this.lastHash}|${action}|${JSON.stringify(payload)}|${outcome}|${ts}`;
    return createHash("sha256").update(data).digest("hex");
  }

  log(params: {
    action: AuditAction;
    agentId?: string;
    taskId?: string;
    conversationId?: string;
    payload?: Record<string, unknown>;
    outcome?: "success" | "failure" | "pending" | "blocked";
  }): AuditEntry {
    const id = generateId();
    const ts = now();
    // Redact sensitive data before it ever touches the audit log (Decision 10b)
    const payload = redactObject(params.payload ?? {}) as Record<string, unknown>;
    const outcome = params.outcome ?? "success";

    const chainHash = this.computeHash(params.action, payload, outcome, ts);
    this.lastHash = chainHash;

    const entry: AuditEntry = {
      id,
      action: params.action,
      agentId: params.agentId,
      taskId: params.taskId,
      conversationId: params.conversationId,
      payload,
      outcome,
      chainHash,
      createdAt: ts,
    };

    try {
      const db = getDb();
      db.run(
        `INSERT INTO audit_trail(id,action,agent_id,task_id,conversation_id,payload,outcome,chain_hash,created_at)
         VALUES(?,?,?,?,?,?,?,?,?)`,
        [
          id,
          params.action,
          params.agentId ?? null,
          params.taskId ?? null,
          params.conversationId ?? null,
          JSON.stringify(payload),
          outcome,
          chainHash,
          ts,
        ]
      );
    } catch (err) {
      // Audit failures are critical — print but don't swallow silently
      console.error("[AUDIT] Failed to write audit record:", err);
    }

    return entry;
  }

  /**
   * Verify chain integrity — walks every record and recomputes hashes.
   * Returns { valid: true } or { valid: false, brokenAt: id }
   */
  verify(): { valid: boolean; brokenAt?: string; totalRecords: number } {
    const db = getDb();
    const rows = db.query<{
      id: string;
      action: string;
      payload: string;
      outcome: string;
      chain_hash: string;
      created_at: number;
    }, []>(
      // Same order the chain was written in — rowid breaks created_at (ms) ties,
      // otherwise verify() can falsely report a valid chain as broken.
      `SELECT id,action,payload,outcome,chain_hash,created_at FROM audit_trail ORDER BY created_at ASC, rowid ASC`
    ).all();

    let prevHash = "GENESIS";

    for (const row of rows) {
      const payload = JSON.parse(row.payload);
      const expected = createHash("sha256")
        .update(`${prevHash}|${row.action}|${JSON.stringify(payload)}|${row.outcome}|${row.created_at}`)
        .digest("hex");

      if (expected !== row.chain_hash) {
        return { valid: false, brokenAt: row.id, totalRecords: rows.length };
      }
      prevHash = row.chain_hash;
    }

    return { valid: true, totalRecords: rows.length };
  }

  /**
   * Get recent audit records, optionally filtered by agent or action.
   */
  recent(opts: {
    limit?: number;
    agentId?: string;
    action?: AuditAction;
  } = {}): AuditEntry[] {
    const db = getDb();
    const conditions: string[] = [];
    const args: unknown[] = [];

    if (opts.agentId) { conditions.push("agent_id = ?"); args.push(opts.agentId); }
    if (opts.action) { conditions.push("action = ?"); args.push(opts.action); }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = opts.limit ?? 50;
    args.push(limit);

    const rows = db.query<{
      id: string; action: string; agent_id: string | null;
      task_id: string | null; conversation_id: string | null;
      payload: string; outcome: string; chain_hash: string; created_at: number;
    }, unknown[]>(
      `SELECT * FROM audit_trail ${where} ORDER BY created_at DESC LIMIT ?`
    ).all(...args);

    return rows.map(r => ({
      id: r.id,
      action: r.action as AuditAction,
      agentId: r.agent_id ?? undefined,
      taskId: r.task_id ?? undefined,
      conversationId: r.conversation_id ?? undefined,
      payload: JSON.parse(r.payload),
      outcome: r.outcome as AuditEntry["outcome"],
      chainHash: r.chain_hash,
      createdAt: r.created_at,
    }));
  }
}

// Singleton — one trail per daemon process
let _trail: AuditTrail | null = null;
export function getAuditTrail(): AuditTrail {
  if (!_trail) _trail = new AuditTrail();
  return _trail;
}
