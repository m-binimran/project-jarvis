import "./_setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { _runForTest, resumeLoops, getLoop } from "../src/agents/loop.ts";
import { getDb } from "../src/vault/schema.ts";
import type { Orchestrator } from "../src/agents/orchestrator.ts";

// Minimal stub orchestrator — the loop only reads output + tokensUsed.
function stub(reply: (step: number) => string, onCall?: () => void): Orchestrator {
  let n = 0;
  return { dispatch: async () => { n++; onCall?.(); return { output: reply(n), tokensUsed: 10 }; } } as unknown as Orchestrator;
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const INSERT = `INSERT INTO agent_loops(id,goal,mode,status,steps,max_steps,token_budget,tokens_used,deadline_at,started_at,conversation_id,agent_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`;

test("loop completes on GOAL COMPLETE and is checkpointed to the vault", async () => {
  const s = await _runForTest(stub(() => "GOAL COMPLETE: all done"), "do the thing");
  assert.equal(s.status, "done");
  assert.match(s.summary ?? "", /all done/);
  const row = getDb().query<{ status: string; steps: string }>(`SELECT status, steps FROM agent_loops WHERE id=?`).get(s.id);
  assert.equal(row!.status, "done");
  assert.equal(JSON.parse(row!.steps).length, 1);
});

test("loop stops at the step cap → limit", async () => {
  const s = await _runForTest(stub(() => "still working..."), "endless", { maxSteps: 3 });
  assert.equal(s.status, "limit");
  assert.equal(s.steps.length, 3);
});

test("overnight mode: higher ceiling + a time deadline, persisted", async () => {
  const s = await _runForTest(stub(() => "GOAL COMPLETE: quick"), "overnight goal", { mode: "overnight", maxMinutes: 60 });
  assert.equal(s.mode, "overnight");
  assert.ok(s.deadlineAt && s.deadlineAt > Date.now(), "overnight sets a future deadline");
  const row = getDb().query<{ mode: string; deadline_at: number }>(`SELECT mode, deadline_at FROM agent_loops WHERE id=?`).get(s.id);
  assert.equal(row!.mode, "overnight");
  assert.ok(row!.deadline_at > 0);
});

test("resume: an interrupted running loop is picked up and finishes from where it left off", async () => {
  getDb().run(`DELETE FROM agent_loops`);
  const id = "resume-1";
  getDb().run(INSERT, [id, "resume goal", "normal", "running",
    JSON.stringify([{ n: 1, output: "step1 done", tokens: 5, at: Date.now() }]),
    8, 60000, 5, null, Date.now(), "conv1", "jarvis"]);

  const count = resumeLoops(stub(() => "GOAL COMPLETE: resumed ok"));
  assert.ok(count >= 1, "should resume the running loop");
  for (let i = 0; i < 60 && getLoop(id)?.status === "running"; i++) await sleep(20);
  const s = getLoop(id);
  assert.equal(s?.status, "done");
  assert.ok((s?.steps.length ?? 0) >= 2, `expected resume to add a step beyond the first, got ${s?.steps.length}`);
});

test("resume: an overnight loop past its deadline is closed out, not run", async () => {
  getDb().run(`DELETE FROM agent_loops`);
  const id = "expired-1";
  getDb().run(INSERT, [id, "old goal", "overnight", "running", "[]",
    200, 1_000_000, 0, Date.now() - 1000, Date.now() - 7_200_000, "conv2", "jarvis"]);

  let ran = false;
  resumeLoops(stub(() => "GOAL COMPLETE: x", () => { ran = true; }));
  const row = getDb().query<{ status: string }>(`SELECT status FROM agent_loops WHERE id=?`).get(id);
  assert.equal(row!.status, "deadline");
  assert.equal(ran, false, "an expired loop must not execute any steps");
});
