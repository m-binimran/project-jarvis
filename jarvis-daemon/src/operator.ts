/**
 * Computer-use operator — JARVIS doesn't just SHOW you where to click, it can do
 * it: move the mouse, click, type, scroll. This is the single most dangerous thing
 * an agent can do (it can touch anything on screen), so it is the most gated thing
 * in JARVIS:
 *
 *   - `computer_use` is a CIRCUIT BREAKER → EVERY action needs an explicit human OK.
 *     A prompt can never auto-approve it. Unattended (nobody approves) = nothing runs.
 *   - Every proposal, approval, rejection, and action is written to the audit chain.
 *   - Sessions are step-bounded and can be stopped at any time.
 *
 * The brain lives here (daemon): screenshot → UI-TARS decides the next action →
 * gate + await approval → hand the approved action to the overlay to execute → new
 * screenshot → repeat. The HANDS live in the Electron overlay (it owns the real
 * mouse/keyboard); this module never touches the OS itself.
 */

import { getAuditTrail } from "./authority/audit.ts";
import { generateId } from "./vault/schema.ts";
import { setAnnotations, clearAnnotations } from "./annotations.ts";

// ── Action space (mirrors UI-TARS; coordinates are 0..1 fractions of the screen) ─

export type OperatorAction =
  | { type: "click"; x: number; y: number }
  | { type: "double_click"; x: number; y: number }
  | { type: "right_click"; x: number; y: number }
  | { type: "type"; text: string }
  | { type: "hotkey"; keys: string }
  | { type: "scroll"; x: number; y: number; direction: "up" | "down" | "left" | "right" }
  | { type: "drag"; x: number; y: number; x2: number; y2: number }
  | { type: "wait" }
  | { type: "finished"; text: string };

export interface OperatorStep {
  thought: string;
  action: OperatorAction;
  raw: string;
}

function clamp01(n: number): number { return n < 0 ? 0 : n > 1 ? 1 : n; }

/** Pull the first 1-2 coordinate pairs (0..1000 space) out of a box/point string. */
function boxNums(s: string): number[] {
  const cleaned = s.replace(/<\|box_start\|>|<\|box_end\|>/g, "").replace(/<\/?point>/g, " ");
  return [...cleaned.matchAll(/(\d{1,4})/g)].map(m => Number(m[1]));
}
function pt(nums: number[], i = 0): { x: number; y: number } {
  const a = nums[i] ?? 0, b = nums[i + 1] ?? 0;
  return { x: clamp01(a / 1000), y: clamp01(b / 1000) };
}

/**
 * Parse one UI-TARS step ("Thought: …\nAction: click(start_box='(x,y)')") into a
 * structured, screen-fraction action. Returns null if no usable action is present.
 */
export function parseUiTarsStep(text: string): OperatorStep | null {
  if (!text) return null;
  const thoughtM = text.match(/Thought:\s*([\s\S]+?)(?=\n?\s*Action[:：]|$)/i);
  const thought = thoughtM ? thoughtM[1].trim().replace(/\s+/g, " ").slice(0, 240) : "";

  const actionStr = (text.split(/Action[:：]/i).pop() ?? "").trim();
  const verbM = actionStr.match(/^(\w+)\s*\(/);
  if (!verbM) return null;
  const verb = verbM[1].toLowerCase();
  const args = actionStr.slice(actionStr.indexOf("(") + 1, actionStr.lastIndexOf(")"));

  const mk = (action: OperatorAction): OperatorStep => ({ thought, action, raw: actionStr });

  // type(content='...')
  if (verb === "type") {
    const c = args.match(/content\s*=\s*'([^]*?)'\s*$/) ?? args.match(/content\s*=\s*"([^]*?)"\s*$/);
    return mk({ type: "type", text: c ? c[1] : "" });
  }
  // hotkey(key='ctrl c')
  if (verb === "hotkey" || verb === "key") {
    const k = args.match(/key\s*=\s*'([^']*)'/) ?? args.match(/key\s*=\s*"([^"]*)"/);
    return mk({ type: "hotkey", keys: k ? k[1] : args.replace(/['"]/g, "").trim() });
  }
  if (verb === "wait") return mk({ type: "wait" });
  if (verb === "finished" || verb === "done") {
    const c = args.match(/content\s*=\s*'([^]*?)'\s*$/) ?? args.match(/content\s*=\s*"([^]*?)"\s*$/);
    return mk({ type: "finished", text: c ? c[1] : thought });
  }
  if (verb === "scroll") {
    const { x, y } = pt(boxNums(args));
    const d = (args.match(/direction\s*=\s*'([^']*)'/) ?? args.match(/direction\s*=\s*"([^"]*)"/))?.[1] ?? "down";
    const dir = ["up", "down", "left", "right"].includes(d) ? (d as "up" | "down" | "left" | "right") : "down";
    return mk({ type: "scroll", x, y, direction: dir });
  }
  if (verb === "drag") {
    const n = boxNums(args);
    // start point = first pair; end point = next pair (after the start box's numbers)
    const start = pt(n, 0);
    const end = pt(n, n.length >= 4 ? 2 : 0);
    return mk({ type: "drag", x: start.x, y: start.y, x2: end.x, y2: end.y });
  }
  // click family: click / left_single / left_double / right_single
  const { x, y } = pt(boxNums(args));
  if (verb === "left_double" || verb === "double_click" || verb === "doubleclick")
    return mk({ type: "double_click", x, y });
  if (verb === "right_single" || verb === "right_click" || verb === "rightclick")
    return mk({ type: "right_click", x, y });
  if (verb === "click" || verb === "left_single" || verb === "left_click" || verb === "tap")
    return mk({ type: "click", x, y });
  return null; // unknown verb → let the caller treat as unparseable
}

/** A short human sentence describing what an action will do (for the approval prompt). */
export function describeAction(a: OperatorAction): string {
  switch (a.type) {
    case "click": return `Click at ${(a.x * 100) | 0}%, ${(a.y * 100) | 0}%`;
    case "double_click": return `Double-click at ${(a.x * 100) | 0}%, ${(a.y * 100) | 0}%`;
    case "right_click": return `Right-click at ${(a.x * 100) | 0}%, ${(a.y * 100) | 0}%`;
    case "type": return `Type: "${a.text.slice(0, 60)}"`;
    case "hotkey": return `Press keys: ${a.keys}`;
    case "scroll": return `Scroll ${a.direction}`;
    case "drag": return `Drag from ${(a.x * 100) | 0}%,${(a.y * 100) | 0}% to ${(a.x2 * 100) | 0}%,${(a.y2 * 100) | 0}%`;
    case "wait": return `Wait`;
    case "finished": return `Finish: ${a.text.slice(0, 80)}`;
  }
}

/** Where on screen an action points (for the on-screen preview), or null. */
function actionCoords(a: OperatorAction): { x: number; y: number } | null {
  if (a.type === "click" || a.type === "double_click" || a.type === "right_click" || a.type === "scroll" || a.type === "drag")
    return { x: a.x, y: a.y };
  return null;
}

/** Draw the PROPOSED action on screen (amber) so the user sees it before approving. */
function drawProposed(a: OperatorAction): void {
  const amber = "#FFB020";
  if (a.type === "drag") {
    setAnnotations([{ type: "arrow", x: a.x, y: a.y, x2: a.x2, y2: a.y2, color: amber, text: describeAction(a) }], 0);
    return;
  }
  const c = actionCoords(a);
  if (c) setAnnotations([{ type: "circle", x: c.x, y: c.y, w: 0.035, color: amber, text: describeAction(a) }], 0);
  else setAnnotations([{ type: "label", x: 0.5, y: 0.08, color: amber, text: describeAction(a) }], 0);
}

// ── UI-TARS computer-use prompt + call ───────────────────────────────────────

const OPERATOR_PROMPT =
  "You are a computer-use agent. You are given a screenshot of the screen and a task. " +
  "Decide the SINGLE next action to make progress, then output it.\n\n" +
  "Output EXACTLY:\n" +
  "Thought: <one short sentence>\n" +
  "Action: <one action>\n\n" +
  "Action space (coordinates are integers in a 0-1000 space, (0,0)=top-left):\n" +
  "click(start_box='(x,y)') | left_double(start_box='(x,y)') | right_single(start_box='(x,y)') | " +
  "drag(start_box='(x,y)', end_box='(x,y)') | hotkey(key='ctrl c') | type(content='text') | " +
  "scroll(start_box='(x,y)', direction='down') | wait() | finished(content='summary')\n" +
  "Use finished() when the task is complete.";

function uitarsConfig(): { url: string; key: string; model: string } | null {
  const url = process.env.JARVIS_UITARS_URL;
  if (!url) return null;
  return {
    url: url.replace(/\/+$/, ""),
    key: process.env.JARVIS_UITARS_KEY ?? "EMPTY",
    model: process.env.JARVIS_UITARS_MODEL ?? "ui-tars-1.5-7b",
  };
}

/** Ask UI-TARS for the next step given the latest screenshot. Overridable for tests. */
let _decide = async (task: string, history: string[], dataUrl: string): Promise<string> => {
  const cfg = uitarsConfig();
  if (!cfg) throw new Error("Computer-use needs UI-TARS — set JARVIS_UITARS_URL to an endpoint serving the model.");
  const res = await fetch(`${cfg.url}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0,
      max_tokens: 400,
      messages: [
        { role: "system", content: OPERATOR_PROMPT },
        { role: "user", content: [
          { type: "text", text: `Task: ${task}\nSteps so far: ${history.join(" | ") || "(none)"}` },
          { type: "image_url", image_url: { url: dataUrl } },
        ] },
      ],
    }),
  });
  if (!res.ok) throw new Error(`UI-TARS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  return j.choices?.[0]?.message?.content ?? "";
};
/** Test seam: replace the model call with a stub. */
export function __setDecideForTest(fn: typeof _decide): void { _decide = fn; }

// ── Session state machine ────────────────────────────────────────────────────

export type OperatorStatus =
  | "need_screenshot"   // waiting for the overlay to send a frame
  | "capturing"         // overlay claimed the screenshot request (in flight)
  | "deciding"          // running UI-TARS on the latest frame
  | "awaiting_approval" // proposed an action; waiting for a human OK
  | "ready_to_act"      // approved; the overlay should execute `proposed`
  | "executing"         // overlay claimed the action (in flight)
  | "done" | "stopped" | "error";

interface Session {
  id: string;
  task: string;
  maxSteps: number;
  step: number;
  status: OperatorStatus;
  history: string[];
  proposed: OperatorStep | null;
  result: string;
  error?: string;
  createdAt: number;
}

const HARD_MAX_STEPS = 30;
const sessions = new Map<string, Session>();
const audit = getAuditTrail();

export function startOperator(task: string, maxSteps = 12): { id: string } {
  const id = generateId();
  sessions.set(id, {
    id, task,
    maxSteps: Math.min(Math.max(1, maxSteps), HARD_MAX_STEPS),
    step: 0, status: "need_screenshot", history: [], proposed: null, result: "", createdAt: Date.now(),
  });
  audit.log({ action: "agent_loop_start", taskId: id, payload: { kind: "computer_use", task: task.slice(0, 200) } });
  return { id };
}

/** What the overlay should do next: take a screenshot, execute an action, or idle. */
export function nextForOverlay(): { kind: "shot" | "act" | "idle"; id?: string; action?: OperatorAction } {
  // Claim the work as we hand it out (status → in-flight) so a second poll before
  // the overlay's /frame arrives can't dispatch the same action/screenshot twice.
  for (const s of sessions.values()) {
    if (s.status === "ready_to_act" && s.proposed) {
      s.status = "executing";
      return { kind: "act", id: s.id, action: s.proposed.action };
    }
  }
  for (const s of sessions.values()) {
    if (s.status === "need_screenshot") {
      s.status = "capturing";
      return { kind: "shot", id: s.id };
    }
  }
  return { kind: "idle" };
}

/**
 * The overlay sends a fresh screenshot (after capturing, or after executing an
 * action). We run UI-TARS, propose the next action, and PARK it for human approval.
 */
export async function observeFrame(id: string, dataUrl: string): Promise<Session> {
  const s = sessions.get(id);
  if (!s) throw new Error("Unknown operator session");
  if (s.status === "done" || s.status === "stopped" || s.status === "error") return s;

  s.step++;
  if (s.step > s.maxSteps) {
    s.status = "stopped"; s.result = "Step budget reached.";
    audit.log({ action: "agent_loop_end", taskId: id, outcome: "blocked", payload: { reason: "max_steps" } });
    return s;
  }

  s.status = "deciding";
  let text: string;
  try {
    text = await _decide(s.task, s.history, dataUrl);
  } catch (e) {
    s.status = "error"; s.error = e instanceof Error ? e.message : String(e);
    audit.log({ action: "agent_loop_end", taskId: id, outcome: "failure", payload: { error: s.error } });
    return s;
  }

  const stepParsed = parseUiTarsStep(text);
  if (!stepParsed) {
    s.status = "error"; s.error = "Could not parse a UI-TARS action.";
    return s;
  }
  s.history.push(describeAction(stepParsed.action));

  if (stepParsed.action.type === "finished") {
    s.status = "done"; s.result = stepParsed.action.text || "Done.";
    audit.log({ action: "agent_loop_end", taskId: id, payload: { result: s.result.slice(0, 200) } });
    return s;
  }

  // GATE: computer_use is a circuit breaker — propose, then wait for a human OK.
  s.proposed = stepParsed;
  s.status = "awaiting_approval";
  drawProposed(stepParsed.action); // show the user EXACTLY what it wants to do
  audit.log({
    action: "permission_check", taskId: id,
    payload: { category: "computer_use", action: describeAction(stepParsed.action), requiresApproval: true },
  });
  return s;
}

/** Human approves the proposed action → the overlay may now execute it. */
export function approveStep(id: string): Session {
  const s = sessions.get(id);
  if (!s) throw new Error("Unknown operator session");
  if (s.status !== "awaiting_approval" || !s.proposed) return s;
  audit.log({ action: "permission_granted", taskId: id, payload: { action: describeAction(s.proposed.action), approvedBy: "user" } });
  audit.log({ action: "tool_call", taskId: id, payload: { tool: "computer_use", action: s.proposed.action } });
  clearAnnotations(); // it's approved — clear the preview marker
  s.status = "ready_to_act";
  return s;
}

/** Human rejects the proposed action → stop the session (secure default). */
export function rejectStep(id: string): Session {
  const s = sessions.get(id);
  if (!s) throw new Error("Unknown operator session");
  audit.log({ action: "permission_denied", taskId: id, outcome: "blocked", payload: { action: s.proposed ? describeAction(s.proposed.action) : "?" } });
  clearAnnotations();
  s.status = "stopped"; s.result = "You declined the action.";
  return s;
}

export function stopOperator(id: string): Session | null {
  const s = sessions.get(id);
  if (!s) return null;
  clearAnnotations();
  s.status = "stopped"; s.result = s.result || "Stopped.";
  audit.log({ action: "agent_loop_end", taskId: id, outcome: "blocked", payload: { reason: "user_stop" } });
  return s;
}

/** The session currently waiting for a human OK (for a UI to poll), or null. */
export function getActiveOperator(): ReturnType<typeof getOperator> {
  for (const s of sessions.values()) {
    if (s.status === "awaiting_approval" && s.proposed) return getOperator(s.id);
  }
  return null;
}

/** UI-facing view of a session (what it wants to do, where it is). */
export function getOperator(id: string): {
  id: string; status: OperatorStatus; step: number; maxSteps: number;
  task: string; result: string; error?: string;
  proposed?: { thought: string; action: OperatorAction; describe: string };
} | null {
  const s = sessions.get(id);
  if (!s) return null;
  return {
    id: s.id, status: s.status, step: s.step, maxSteps: s.maxSteps,
    task: s.task, result: s.result, error: s.error,
    proposed: s.proposed ? { thought: s.proposed.thought, action: s.proposed.action, describe: describeAction(s.proposed.action) } : undefined,
  };
}
