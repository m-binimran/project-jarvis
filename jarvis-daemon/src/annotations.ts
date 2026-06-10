/**
 * Screen annotations — what JARVIS draws on your screen.
 *
 * The desktop overlay runs a transparent, click-through, full-screen window
 * (annotate.html) that polls GET /api/annotate and renders these shapes — so
 * JARVIS can highlight a spot, point an arrow, or flag "look here". Shapes
 * auto-expire so the screen clears itself.
 *
 * Coordinates are 0..1 fractions of the screen (so they work on any resolution):
 * x/y = top-left, w/h = size; for an arrow, x/y = tail, x2/y2 = head.
 */

export type ShapeType = "rect" | "circle" | "arrow" | "label";

export interface Shape {
  type: ShapeType;
  x: number; y: number;     // 0..1
  w?: number; h?: number;   // 0..1 (rect/circle)
  x2?: number; y2?: number; // 0..1 (arrow head)
  text?: string;            // label, or caption on a rect
  color?: string;           // CSS colour; default tiffany
}

interface State { shapes: Shape[]; version: number; expiresAt: number; }

let state: State = { shapes: [], version: 0, expiresAt: 0 };

const VALID_TYPES = new Set<ShapeType>(["rect", "circle", "arrow", "label"]);

/** Replace what's on screen. ttlMs=0 means "until cleared". Returns the new version. */
export function setAnnotations(shapes: Shape[], ttlMs = 8000): number {
  const clean = (Array.isArray(shapes) ? shapes : [])
    .filter(s => s && VALID_TYPES.has(s.type))   // drop unknown types (MCP path bypasses zod)
    .slice(0, 24).map(s => ({
    type: s.type,
    x: clamp01(s.x), y: clamp01(s.y),
    w: s.w != null ? clamp01(s.w) : undefined,
    h: s.h != null ? clamp01(s.h) : undefined,
    x2: s.x2 != null ? clamp01(s.x2) : undefined,
    y2: s.y2 != null ? clamp01(s.y2) : undefined,
    text: typeof s.text === "string" ? s.text.slice(0, 120) : undefined,
    color: typeof s.color === "string" ? s.color.slice(0, 32) : undefined,
  }));
  state = { shapes: clean, version: state.version + 1, expiresAt: ttlMs > 0 ? Date.now() + ttlMs : 0 };
  return state.version;
}

/** Current shapes for the overlay (empty once expired). */
export function getAnnotations(): { shapes: Shape[]; version: number } {
  if (state.expiresAt && Date.now() > state.expiresAt) return { shapes: [], version: state.version };
  return { shapes: state.shapes, version: state.version };
}

export function clearAnnotations(): void {
  state = { shapes: [], version: state.version + 1, expiresAt: 0 };
}

function clamp01(n: unknown): number {
  const x = typeof n === "number" && isFinite(n) ? n : 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
