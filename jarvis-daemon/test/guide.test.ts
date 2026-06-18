import "./_setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUiTarsAction } from "../src/guide.ts";

const approx = (a: number, b: number, eps = 0.001) => Math.abs(a - b) <= eps;

test("parses a UI-TARS click action (start_box) into 0..1 coords", () => {
  const t = parseUiTarsAction("Thought: Click the Start button.\nAction: click(start_box='(120,950)')")!;
  assert.equal(t.found, true);
  assert.ok(approx(t.clickX, 0.12), `clickX=${t.clickX}`);
  assert.ok(approx(t.clickY, 0.95), `clickY=${t.clickY}`);
  assert.match(t.narration, /Start button/);
});

test("parses the point='<point>x y</point>' variant", () => {
  const t = parseUiTarsAction("Action: click(point='<point>510 150</point>')")!;
  assert.ok(approx(t.clickX, 0.51) && approx(t.clickY, 0.15), `${t.clickX},${t.clickY}`);
});

test("averages a 4-number box to its centre", () => {
  const t = parseUiTarsAction("Action: click(start_box='(100,200,300,400)')")!;
  assert.ok(approx(t.clickX, 0.2) && approx(t.clickY, 0.3), `${t.clickX},${t.clickY}`);
});

test("handles the <|box_start|> marker form", () => {
  const t = parseUiTarsAction("Action: click(start_box='<|box_start|>(279,81)<|box_end|>')")!;
  assert.ok(approx(t.clickX, 0.279) && approx(t.clickY, 0.081), `${t.clickX},${t.clickY}`);
});

test("coords are clamped to [0,1] and a look-here box is synthesised around the point", () => {
  const t = parseUiTarsAction("Action: click(start_box='(1000,1000)')")!;
  assert.equal(t.clickX, 1); assert.equal(t.clickY, 1);
  assert.ok(t.x >= 0 && t.y >= 0 && t.w > 0 && t.h > 0);
});

test("returns null when there is no usable action/coordinate", () => {
  assert.equal(parseUiTarsAction("I'm not sure where that is."), null);
  assert.equal(parseUiTarsAction(""), null);
});
