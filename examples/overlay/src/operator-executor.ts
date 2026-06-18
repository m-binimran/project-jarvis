/**
 * Computer-use executor — the "hands" for JARVIS's operator.
 *
 * The daemon decides + GATES every action (see jarvis-daemon/src/operator.ts);
 * this only EXECUTES an action the daemon has already approved. It moves the real
 * mouse/keyboard via a native input library (nut-js), which is an OPTIONAL native
 * dependency: if it isn't installed, computer-use stays OFF and the rest of the
 * overlay is unaffected.
 *
 *   To enable:  npm i @nut-tree-fork/nut-js   (in jarvis-overlay)
 *
 * NOTE: this path needs a real desktop + a UI-TARS endpoint to exercise end-to-end,
 * so it ships best-effort and unverified-live. The daemon-side gating/loop is tested.
 */

import { screen } from 'electron';

type DaemonRequest = (method: string, path: string, body?: unknown) => Promise<unknown>;
type Capture = () => Promise<string | null>;

// Mirrors jarvis-daemon OperatorAction (coords are 0..1 fractions of the screen).
type Action =
  | { type: 'click'; x: number; y: number }
  | { type: 'double_click'; x: number; y: number }
  | { type: 'right_click'; x: number; y: number }
  | { type: 'type'; text: string }
  | { type: 'hotkey'; keys: string }
  | { type: 'scroll'; x: number; y: number; direction: 'up' | 'down' | 'left' | 'right' }
  | { type: 'drag'; x: number; y: number; x2: number; y2: number }
  | { type: 'wait' }
  | { type: 'finished'; text: string };

/* eslint-disable @typescript-eslint/no-explicit-any */
let nut: any = null;

async function loadNut(): Promise<boolean> {
  if (nut) return true;
  for (const pkg of ['@nut-tree-fork/nut-js', '@nut-tree/nut-js']) {
    try { nut = await import(pkg); return true; } catch { /* try next */ }
  }
  return false;
}

const px = (frac: number, dim: number) => Math.max(0, Math.round(frac * dim));

function mapKey(token: string): any {
  const { Key } = nut;
  const t = token.toLowerCase();
  const m: Record<string, any> = {
    ctrl: Key.LeftControl, control: Key.LeftControl, alt: Key.LeftAlt,
    shift: Key.LeftShift, cmd: Key.LeftSuper, meta: Key.LeftSuper, win: Key.LeftSuper,
    enter: Key.Enter, return: Key.Enter, tab: Key.Tab, esc: Key.Escape, escape: Key.Escape,
    space: Key.Space, backspace: Key.Backspace, delete: Key.Delete,
    up: Key.Up, down: Key.Down, left: Key.Left, right: Key.Right,
  };
  if (m[t]) return m[t];
  if (t.length === 1 && t >= 'a' && t <= 'z') return Key[t.toUpperCase() as keyof typeof Key];
  if (t.length === 1 && t >= '0' && t <= '9') return Key[`Num${t}` as keyof typeof Key];
  return null;
}

async function execAction(a: Action, W: number, H: number): Promise<void> {
  const { mouse, keyboard, Button, Point } = nut;
  try { mouse.config.mouseSpeed = 3000; } catch { /* older nut-js */ }

  switch (a.type) {
    case 'click':
      await mouse.setPosition(new Point(px(a.x, W), px(a.y, H))); await mouse.click(Button.LEFT); break;
    case 'double_click':
      await mouse.setPosition(new Point(px(a.x, W), px(a.y, H))); await mouse.doubleClick(Button.LEFT); break;
    case 'right_click':
      await mouse.setPosition(new Point(px(a.x, W), px(a.y, H))); await mouse.click(Button.RIGHT); break;
    case 'type':
      await keyboard.type(a.text); break;
    case 'hotkey': {
      const keys = a.keys.split(/[\s+]+/).map(mapKey).filter(Boolean);
      if (keys.length) await keyboard.type(...keys);
      break;
    }
    case 'scroll': {
      await mouse.setPosition(new Point(px(a.x, W), px(a.y, H)));
      const amt = 5;
      if (a.direction === 'down') await mouse.scrollDown(amt);
      else if (a.direction === 'up') await mouse.scrollUp(amt);
      else if (a.direction === 'left') await mouse.scrollLeft(amt);
      else await mouse.scrollRight(amt);
      break;
    }
    case 'drag':
      await mouse.setPosition(new Point(px(a.x, W), px(a.y, H)));
      await mouse.pressButton(Button.LEFT);
      await mouse.setPosition(new Point(px(a.x2, W), px(a.y2, H)));
      await mouse.releaseButton(Button.LEFT);
      break;
    case 'wait':
      await new Promise(r => setTimeout(r, 600)); break;
    case 'finished':
      break;
  }
}

let polling = false;
let timer: ReturnType<typeof setInterval> | null = null;

async function pollOnce(daemonRequest: DaemonRequest, capture: Capture, W: number, H: number): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    const next = await daemonRequest('GET', '/api/operator/next') as { kind: string; id?: string; action?: Action } | null;
    if (!next || next.kind === 'idle' || !next.id) return;

    if (next.kind === 'act' && next.action) {
      try { await execAction(next.action, W, H); }
      catch (e) { console.error('[operator] action failed:', e instanceof Error ? e.message : String(e)); }
    }
    // Whether we just captured (shot) or executed (act), send the resulting frame
    // back so the daemon can decide + gate the next step.
    const shot = await capture();
    if (shot) await daemonRequest('POST', '/api/operator/frame', { id: next.id, screenshot: shot });
  } catch (e) {
    console.error('[operator] poll error:', e instanceof Error ? e.message : String(e));
  } finally {
    polling = false;
  }
}

/** Start the executor. No-op (logs) if the native input library isn't installed. */
export async function startOperatorPoller(daemonRequest: DaemonRequest, capture: Capture): Promise<void> {
  if (timer) return;
  if (!(await loadNut())) {
    console.log('[operator] computer-use disabled — run `npm i @nut-tree-fork/nut-js` in jarvis-overlay to enable');
    return;
  }
  const { width, height } = screen.getPrimaryDisplay().size;
  console.log(`[operator] computer-use executor active (${width}x${height})`);
  timer = setInterval(() => { void pollOnce(daemonRequest, capture, width, height); }, 700);
}
