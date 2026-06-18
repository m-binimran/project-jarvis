import "./_setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseUiTarsStep, describeAction,
  startOperator, observeFrame, approveStep, rejectStep, nextForOverlay, getOperator,
  getActiveOperator, __setDecideForTest, type OperatorAction,
} from "../src/operator.ts";
import { CIRCUIT_BREAKERS, AuthorityEngine } from "../src/authority/engine.ts";
import { getAnnotations } from "../src/annotations.ts";

const SHOT = "data:image/png;base64,AAAA";
const approx = (a: number, b: number) => Math.abs(a - b) <= 0.001;

// ── parser: the full UI-TARS action space ──
test("parses click / double / right into typed coords", () => {
  assert.deepEqual(parseUiTarsStep("Action: click(start_box='(120,950)')")!.action,
    { type: "click", x: 0.12, y: 0.95 });
  assert.equal(parseUiTarsStep("Action: left_double(start_box='(500,500)')")!.action.type, "double_click");
  assert.equal(parseUiTarsStep("Action: right_single(start_box='(500,500)')")!.action.type, "right_click");
});

test("parses type / hotkey / scroll / drag / wait / finished", () => {
  assert.deepEqual(parseUiTarsStep("Action: type(content='hello world')")!.action, { type: "type", text: "hello world" });
  assert.deepEqual(parseUiTarsStep("Action: hotkey(key='ctrl c')")!.action, { type: "hotkey", keys: "ctrl c" });
  const sc = parseUiTarsStep("Action: scroll(start_box='(500,500)', direction='down')")!.action as Extract<OperatorAction, { type: "scroll" }>;
  assert.equal(sc.type, "scroll"); assert.equal(sc.direction, "down");
  const dr = parseUiTarsStep("Action: drag(start_box='(100,100)', end_box='(200,200)')")!.action as Extract<OperatorAction, { type: "drag" }>;
  assert.ok(approx(dr.x, 0.1) && approx(dr.x2, 0.2), JSON.stringify(dr));
  assert.equal(parseUiTarsStep("Action: wait()")!.action.type, "wait");
  assert.equal(parseUiTarsStep("Action: finished(content='all done')")!.action.type, "finished");
});

test("unknown / empty actions return null", () => {
  assert.equal(parseUiTarsStep("Action: teleport(x)"), null);
  assert.equal(parseUiTarsStep("just chatting"), null);
});

// ── the security invariant ──
test("computer_use is a circuit breaker — never auto-approved in ANY mode", () => {
  assert.ok(CIRCUIT_BREAKERS.has("computer_use"));
  for (const mode of ["safe", "productive", "auto", "bypass"] as const) {
    assert.equal(new AuthorityEngine(mode).check("computer_use").requiresApproval, true);
  }
});

test("a proposed action PARKS for approval — it never executes on its own", async () => {
  __setDecideForTest(async () => "Thought: Click start.\nAction: click(start_box='(100,900)')");
  const { id } = startOperator("open the menu");
  const s = await observeFrame(id, SHOT);
  assert.equal(s.status, "awaiting_approval");
  // The overlay must NOT be handed an action while it's only proposed.
  assert.notEqual(nextForOverlay().kind, "act");
});

test("approve → overlay gets the action; reject → session stops", async () => {
  __setDecideForTest(async () => "Thought: Click.\nAction: click(start_box='(100,100)')");
  const a = startOperator("task A");
  await observeFrame(a.id, SHOT);
  approveStep(a.id);
  const next = nextForOverlay();
  assert.equal(next.kind, "act");
  assert.equal(next.id, a.id);

  const b = startOperator("task B");
  await observeFrame(b.id, SHOT);
  rejectStep(b.id);
  assert.equal(getOperator(b.id)!.status, "stopped");
});

test("finished() ends the session", async () => {
  __setDecideForTest(async () => "Thought: Done.\nAction: finished(content='all set')");
  const { id } = startOperator("trivial");
  const s = await observeFrame(id, SHOT);
  assert.equal(s.status, "done");
  assert.match(s.result, /all set/);
});

test("describeAction is human-readable", () => {
  assert.match(describeAction({ type: "click", x: 0.5, y: 0.5 }), /Click at 50%, 50%/);
});

test("proposing draws the target on screen + surfaces it for the UI; reject clears it", async () => {
  __setDecideForTest(async () => "Thought: Click here.\nAction: click(start_box='(300,400)')");
  const { id } = startOperator("draw test");
  await observeFrame(id, "data:image/png;base64,AAAA");
  const shapes = getAnnotations().shapes;
  assert.ok(
    shapes.some(s => s.type === "circle" && Math.abs(s.x - 0.3) < 0.01 && Math.abs(s.y - 0.4) < 0.01),
    `expected a circle near (0.3,0.4), got ${JSON.stringify(shapes)}`,
  );
  assert.ok(getActiveOperator(), "the awaiting action should be visible to a UI");
  rejectStep(id);
  assert.equal(getAnnotations().shapes.length, 0, "reject clears the on-screen preview");
  assert.equal(getOperator(id)!.status, "stopped");
});
