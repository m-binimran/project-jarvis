/**
 * Local eval / replay harness — catch regressions without any telemetry.
 *
 * Define cases (a task + checks), run them against a Kernel, and get a scored
 * report. Everything is local: it drives the kernel and reads the local audit
 * chain — nothing is uploaded. Two ways to get cases:
 *   - hand-written EvalCases (incl. SECURITY cases — "a circuit breaker must block
 *     this", "this output must NOT contain X"), and
 *   - replayCasesFromAudit(): pull goals JARVIS actually ran from the audit chain
 *     and re-run them to check behaviour hasn't drifted.
 *
 * It's a library (run from a script or CI), not a runtime endpoint.
 */

import type { Kernel, RunOptions, RunResult } from "./kernel.ts";
import { getAuditTrail } from "./authority/audit.ts";

export interface EvalExpect {
  outputMatches?: RegExp;       // output must match
  outputNotMatches?: RegExp;    // output must NOT match (e.g. a leaked secret / injected text)
  maxToolCalls?: number;        // at most N tool calls
  maxTurns?: number;            // at most N turns
  mustNotError?: boolean;       // run must not throw
}

export interface EvalCase {
  name: string;
  task: string;
  runOpts?: RunOptions;
  expect?: EvalExpect;
  /** Custom check: return true to pass, or a string describing the failure. */
  assert?: (r: RunResult) => boolean | string;
}

export interface EvalResult {
  name: string; pass: boolean; detail: string;
  output: string; turns: number; toolCalls: number;
}
export interface EvalReport { total: number; passed: number; failed: number; results: EvalResult[]; }

/** Run a set of eval cases against a kernel and score them. */
export async function runEval(kernel: Kernel, cases: EvalCase[]): Promise<EvalReport> {
  const results: EvalResult[] = [];
  for (const c of cases) {
    const fails: string[] = [];
    let r: RunResult = { output: "", turns: 0, toolCalls: 0 };
    try {
      r = await kernel.run(c.task, c.runOpts);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (c.expect?.mustNotError !== false) fails.push(`threw: ${msg}`);
    }
    const e = c.expect;
    if (e?.outputMatches && !e.outputMatches.test(r.output)) fails.push(`output didn't match ${e.outputMatches}`);
    if (e?.outputNotMatches && e.outputNotMatches.test(r.output)) fails.push(`output matched forbidden ${e.outputNotMatches}`);
    if (e?.maxToolCalls != null && r.toolCalls > e.maxToolCalls) fails.push(`toolCalls ${r.toolCalls} > ${e.maxToolCalls}`);
    if (e?.maxTurns != null && r.turns > e.maxTurns) fails.push(`turns ${r.turns} > ${e.maxTurns}`);
    if (c.assert) {
      const a = c.assert(r);
      if (a !== true) fails.push(typeof a === "string" ? a : "custom assertion failed");
    }
    results.push({
      name: c.name, pass: fails.length === 0, detail: fails.join("; ") || "ok",
      output: r.output, turns: r.turns, toolCalls: r.toolCalls,
    });
  }
  const passed = results.filter(r => r.pass).length;
  return { total: results.length, passed, failed: results.length - passed, results };
}

/** A one-line-per-case summary you can print to a console or CI log. */
export function formatReport(report: EvalReport): string {
  const lines = report.results.map(r => `${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : "  — " + r.detail}`);
  lines.push(`\n${report.passed}/${report.total} passed${report.failed ? `, ${report.failed} FAILED` : ""}`);
  return lines.join("\n");
}

/**
 * Build replayable eval cases from goals JARVIS actually ran (read from the audit
 * chain). Re-run them to confirm behaviour hasn't regressed. By default each case
 * just asserts the run doesn't error; add your own checks as needed.
 */
export function replayCasesFromAudit(opts: { limit?: number; runOpts?: RunOptions } = {}): EvalCase[] {
  const audit = getAuditTrail();
  const limit = opts.limit ?? 10;
  const cases: EvalCase[] = [];
  const seen = new Set<string>();

  const add = (task: unknown, label: string) => {
    if (typeof task !== "string" || !task.trim()) return;
    const key = task.slice(0, 120);
    if (seen.has(key)) return;
    seen.add(key);
    cases.push({ name: `replay(${label}): ${key.slice(0, 60)}`, task, runOpts: opts.runOpts, expect: { mustNotError: true } });
  };

  for (const e of audit.recent({ action: "agent_loop_start", limit })) add((e.payload as { goal?: string }).goal, "loop");
  for (const e of audit.recent({ action: "agent_start", limit })) add((e.payload as { userMessage?: string }).userMessage, "chat");
  return cases.slice(0, limit);
}
