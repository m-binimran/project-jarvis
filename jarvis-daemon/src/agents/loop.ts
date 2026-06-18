/**
 * Autonomous agent loop — including OVERNIGHT mode.
 *
 * Give it a goal and it works toward it across multiple steps on its own —
 * planning, acting (through the normal dispatch path, so tools stay behind the
 * authority engine + firewall), and deciding when it's done — until either the
 * goal is reached or a guardrail trips.
 *
 * SECURITY / RELIABILITY GUARDRAILS (this is a "reliable, secure base", so the
 * loop is bounded by design, never open-ended):
 *   - Step cap (normal: default 8 / max 25; overnight: up to 200) — never infinite.
 *   - Token budget — it stops when the budget is spent.
 *   - Time budget (overnight) — it stops at a deadline (e.g. "work for 8 hours").
 *   - Per-step timeout — a stuck step can't wedge the loop.
 *   - Concurrency cap — only a few loops can run at once (runaway-cost guard).
 *   - Cancellable — stopLoop() halts it at the next step boundary.
 *   - Unattended approvals are DENIED — circuit-breaker actions (delete, send,
 *     purchase, computer-use, …) never auto-fire while no human is watching.
 *
 * OVERNIGHT durability: loops are checkpointed to the vault on every step, so a
 * long run survives a daemon restart — resumeLoops() picks interrupted runs back
 * up from where they left off (same conversation, remaining steps + time).
 */

import type { Orchestrator } from "./orchestrator.ts";
import { generateId, now, getDb } from "../vault/schema.ts";
import { getAuditTrail } from "../authority/audit.ts";

const HARD_MAX_STEPS = 25;          // ceiling for a normal loop
const OVERNIGHT_MAX_STEPS = 200;    // ceiling for an overnight loop
const DEFAULT_MAX_STEPS = 8;
const DEFAULT_TOKEN_BUDGET = 60_000;
const OVERNIGHT_TOKEN_BUDGET = 1_000_000;
const DEFAULT_OVERNIGHT_MINUTES = 480; // 8 hours
const STEP_TIMEOUT_MS = 120_000;
const MAX_CONCURRENT = 3;
const RETAIN_MS = 60 * 60_000;      // keep finished loops in memory for an hour

export type LoopMode = "normal" | "overnight";
export type LoopStatus = "running" | "done" | "stopped" | "limit" | "budget" | "deadline" | "error";

export interface LoopStep { n: number; output: string; tokens: number; at: number; }

export interface LoopState {
  id: string;
  goal: string;
  mode: LoopMode;
  status: LoopStatus;
  steps: LoopStep[];
  maxSteps: number;
  tokenBudget: number;
  tokensUsed: number;
  deadlineAt?: number;
  startedAt: number;
  endedAt?: number;
  summary?: string;
  error?: string;
}

interface LoopRecord extends LoopState { stop: boolean; conversationId: string; agentId: string; }

const loops = new Map<string, LoopRecord>();

// ── Persistence (checkpointing) ──────────────────────────────────────────────

let tableReady = false;
function ensureTable(): void {
  if (tableReady) return;
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS agent_loops (
      id TEXT PRIMARY KEY, goal TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL,
      steps TEXT NOT NULL, max_steps INTEGER, token_budget INTEGER, tokens_used INTEGER,
      deadline_at INTEGER, started_at INTEGER, ended_at INTEGER, summary TEXT, error TEXT,
      conversation_id TEXT, agent_id TEXT
    );
  `);
  tableReady = true;
}

function persist(rec: LoopRecord): void {
  try {
    ensureTable();
    getDb().run(
      `INSERT INTO agent_loops(id,goal,mode,status,steps,max_steps,token_budget,tokens_used,deadline_at,started_at,ended_at,summary,error,conversation_id,agent_id)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET status=excluded.status, steps=excluded.steps,
         tokens_used=excluded.tokens_used, ended_at=excluded.ended_at,
         summary=excluded.summary, error=excluded.error`,
      [rec.id, rec.goal, rec.mode, rec.status, JSON.stringify(rec.steps), rec.maxSteps,
       rec.tokenBudget, rec.tokensUsed, rec.deadlineAt ?? null, rec.startedAt, rec.endedAt ?? null,
       rec.summary ?? null, rec.error ?? null, rec.conversationId, rec.agentId]
    );
  } catch { /* checkpointing is best-effort — never break the run over a write */ }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sweep(): void {
  const cutoff = Date.now() - RETAIN_MS;
  for (const [id, l] of loops) {
    if (l.status !== "running" && (l.endedAt ?? 0) < cutoff) loops.delete(id);
  }
}

function publicView(l: LoopRecord): LoopState {
  const { stop, conversationId, agentId, ...rest } = l;
  void stop; void conversationId; void agentId;
  return rest;
}

function runningCount(): number {
  let n = 0;
  for (const l of loops.values()) if (l.status === "running") n++;
  return n;
}

function buildPrompt(goal: string, steps: LoopStep[]): string {
  const rules =
    'When the goal is fully achieved, reply with a line that starts EXACTLY with ' +
    '"GOAL COMPLETE:" followed by a one-paragraph summary. If a step needs an action ' +
    'you are not allowed to take unattended (sending, deleting, purchasing, etc.), say so ' +
    'and treat the goal as blocked rather than pretending it is done.';
  if (steps.length === 0) {
    return `You are working autonomously toward this goal:\n\n"${goal}"\n\n` +
      `Take the single next concrete step now (use your tools if needed) and report what you did. ${rules}`;
  }
  const history = steps.map(s => `Step ${s.n}: ${s.output}`).join("\n\n").slice(-6000);
  return `Goal: "${goal}"\n\nWork so far:\n${history}\n\n` +
    `Continue with the next concrete step. Do not repeat work already done. ${rules}`;
}

async function dispatchStep(
  orchestrator: Orchestrator, prompt: string, conversationId: string, agentId: string
): Promise<{ output: string; tokens: number }> {
  const result = await Promise.race([
    orchestrator.dispatch({
      userMessage: prompt,
      conversationId,
      preferredAgentId: agentId,
      onApprovalNeeded: async () => false, // unattended: never approve circuit-breakers
    }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("step timed out")), STEP_TIMEOUT_MS)),
  ]);
  return {
    output: (result as { output?: string }).output ?? "",
    tokens: (result as { tokensUsed?: number }).tokensUsed ?? 0,
  };
}

async function runLoop(orchestrator: Orchestrator, rec: LoopRecord): Promise<void> {
  const audit = getAuditTrail();
  try {
    // Resume-aware: continue from the step after whatever is already recorded.
    for (let n = rec.steps.length + 1; n <= rec.maxSteps; n++) {
      if (rec.stop) { rec.status = "stopped"; break; }
      if (rec.tokensUsed >= rec.tokenBudget) { rec.status = "budget"; break; }
      if (rec.deadlineAt && Date.now() >= rec.deadlineAt) { rec.status = "deadline"; break; }

      const { output, tokens } = await dispatchStep(orchestrator, buildPrompt(rec.goal, rec.steps), rec.conversationId, rec.agentId);
      rec.tokensUsed += tokens;
      rec.steps.push({ n, output, tokens, at: now() });
      audit.log({ action: "agent_loop_step", payload: { loopId: rec.id, step: n, tokens } });
      persist(rec); // checkpoint after every step so an overnight run survives a restart

      if (/^\s*GOAL COMPLETE:/im.test(output)) {
        rec.status = "done";
        rec.summary = output.replace(/[\s\S]*?GOAL COMPLETE:/i, "").trim().slice(0, 2000);
        break;
      }
    }
    if (rec.status === "running") rec.status = "limit";
  } catch (e) {
    rec.status = "error";
    rec.error = e instanceof Error ? e.message : String(e);
  } finally {
    rec.endedAt = now();
    persist(rec);
    audit.log({ action: "agent_loop_end", payload: { loopId: rec.id, status: rec.status, steps: rec.steps.length } });
  }
}

function createRecord(goal: string, opts: StartOpts): LoopRecord {
  const mode: LoopMode = opts.mode === "overnight" ? "overnight" : "normal";
  const ceiling = mode === "overnight" ? OVERNIGHT_MAX_STEPS : HARD_MAX_STEPS;
  const defSteps = mode === "overnight" ? OVERNIGHT_MAX_STEPS : DEFAULT_MAX_STEPS;
  const defBudget = mode === "overnight" ? OVERNIGHT_TOKEN_BUDGET : DEFAULT_TOKEN_BUDGET;
  const deadlineAt = mode === "overnight"
    ? now() + Math.max(1, opts.maxMinutes ?? DEFAULT_OVERNIGHT_MINUTES) * 60_000
    : undefined;
  return {
    id: generateId(),
    goal: goal.slice(0, 2000),
    mode,
    status: "running",
    steps: [],
    maxSteps: Math.min(Math.max(1, opts.maxSteps ?? defSteps), ceiling),
    tokenBudget: Math.max(1000, opts.tokenBudget ?? defBudget),
    tokensUsed: 0,
    deadlineAt,
    startedAt: now(),
    stop: false,
    conversationId: generateId(),
    agentId: opts.agentId ?? "jarvis",
  };
}

export interface StartOpts {
  maxSteps?: number;
  tokenBudget?: number;
  agentId?: string;
  mode?: LoopMode;
  maxMinutes?: number; // overnight time budget
}

/** Start an autonomous loop toward `goal`. Returns the loop id (runs in the background). */
export function startLoop(orchestrator: Orchestrator, goal: string, opts: StartOpts = {}): { id: string } | { error: string } {
  sweep();
  if (runningCount() >= MAX_CONCURRENT) {
    return { error: `Too many loops running (max ${MAX_CONCURRENT}). Stop one first.` };
  }
  const rec = createRecord(goal, opts);
  loops.set(rec.id, rec);
  persist(rec);
  getAuditTrail().log({ action: "agent_loop_start", payload: { loopId: rec.id, goal: rec.goal, mode: rec.mode, maxSteps: rec.maxSteps } });
  void runLoop(orchestrator, rec);
  return { id: rec.id };
}

/**
 * Resume any loops that were still "running" when the daemon last stopped — the
 * heart of overnight durability. Call once on boot.
 */
export function resumeLoops(orchestrator: Orchestrator): number {
  let resumed = 0;
  try {
    ensureTable();
    const rows = getDb().query<Record<string, unknown>>(
      `SELECT * FROM agent_loops WHERE status='running' ORDER BY started_at ASC LIMIT ${MAX_CONCURRENT}`
    ).all();
    for (const r of rows) {
      const rec: LoopRecord = {
        id: String(r.id), goal: String(r.goal),
        mode: (r.mode === "overnight" ? "overnight" : "normal"),
        status: "running",
        steps: JSON.parse(String(r.steps ?? "[]")) as LoopStep[],
        maxSteps: Number(r.max_steps), tokenBudget: Number(r.token_budget), tokensUsed: Number(r.tokens_used ?? 0),
        deadlineAt: r.deadline_at != null ? Number(r.deadline_at) : undefined,
        startedAt: Number(r.started_at),
        stop: false, conversationId: String(r.conversation_id ?? generateId()), agentId: String(r.agent_id ?? "jarvis"),
      };
      // If it already blew its time budget while we were down, close it out cleanly.
      if (rec.deadlineAt && Date.now() >= rec.deadlineAt) {
        rec.status = "deadline"; rec.endedAt = now(); persist(rec); continue;
      }
      loops.set(rec.id, rec);
      getAuditTrail().log({ action: "agent_loop_start", payload: { loopId: rec.id, resumed: true, fromStep: rec.steps.length } });
      void runLoop(orchestrator, rec);
      resumed++;
    }
  } catch { /* no DB / no table yet — nothing to resume */ }
  return resumed;
}

/** Request a running loop to stop at the next step boundary. */
export function stopLoop(id: string): boolean {
  const l = loops.get(id);
  if (!l || l.status !== "running") return false;
  l.stop = true;
  return true;
}

export function getLoop(id: string): LoopState | null {
  sweep();
  const l = loops.get(id);
  return l ? publicView(l) : null;
}

export function listLoops(): LoopState[] {
  sweep();
  return [...loops.values()].sort((a, b) => b.startedAt - a.startedAt).map(publicView);
}

/** Test seam: run a loop to completion with an injected orchestrator and return its final state. */
export async function _runForTest(orchestrator: Orchestrator, goal: string, opts: StartOpts = {}): Promise<LoopState> {
  const rec = createRecord(goal, opts);
  loops.set(rec.id, rec);
  persist(rec);
  await runLoop(orchestrator, rec);
  return publicView(rec);
}
