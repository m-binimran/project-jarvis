import "./_setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createKernel } from "../src/kernel.ts";
import { runEval, formatReport, replayCasesFromAudit } from "../src/eval.ts";
import { getAuditTrail } from "../src/authority/audit.ts";
import type { LLMProvider, LLMResponse } from "../src/llm/provider.ts";

// Stub model: always answers "The answer is 42." (no tool calls).
const stub: LLMProvider = {
  name: "stub", defaultModel: "stub",
  async isAvailable() { return true; },
  async complete(): Promise<LLMResponse> {
    return { content: "The answer is 42.", model: "stub", provider: "stub", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 } };
  },
  async *stream() { yield { delta: "", done: true }; },
};

test("runEval scores expect-checks (pass + fail) and custom asserts", async () => {
  const k = createKernel({ llm: stub, memory: false });
  const report = await runEval(k, [
    { name: "answers 42", task: "what is the answer?", expect: { outputMatches: /42/, maxToolCalls: 0 } },
    { name: "wrong expectation fails", task: "x", expect: { outputMatches: /999/ } },
    { name: "custom assert passes", task: "x", assert: r => r.toolCalls === 0 || "expected no tool calls" },
  ]);
  assert.equal(report.total, 3);
  assert.equal(report.passed, 2);
  assert.equal(report.failed, 1);
  assert.equal(report.results.find(r => r.name === "answers 42")!.pass, true);
  assert.equal(report.results.find(r => r.name === "wrong expectation fails")!.pass, false);
});

test("outputNotMatches catches forbidden content (e.g. a regression that leaks text)", async () => {
  const k = createKernel({ llm: stub, memory: false });
  const report = await runEval(k, [
    { name: "must not say 42", task: "x", expect: { outputNotMatches: /42/ } },
  ]);
  assert.equal(report.passed, 0);
  assert.equal(report.failed, 1);
});

test("formatReport summarises pass/fail", async () => {
  const k = createKernel({ llm: stub, memory: false });
  const report = await runEval(k, [{ name: "ok", task: "x", expect: { outputMatches: /42/ } }]);
  const s = formatReport(report);
  assert.match(s, /PASS  ok/);
  assert.match(s, /1\/1 passed/);
});

test("replayCasesFromAudit pulls real goals from the audit chain", () => {
  const audit = getAuditTrail();
  audit.log({ action: "agent_loop_start", payload: { goal: "tidy and tag all my notes" } });
  audit.log({ action: "agent_start", payload: { userMessage: "what's on my calendar today?" } });

  const cases = replayCasesFromAudit({ limit: 10 });
  assert.ok(cases.length >= 2, `expected >=2 replay cases, got ${cases.length}`);
  assert.ok(cases.some(c => c.task.includes("tidy and tag")));
  assert.ok(cases.some(c => c.task.includes("calendar")));
  // replay cases default to "must not error"
  assert.equal(cases[0].expect?.mustNotError, true);
});
