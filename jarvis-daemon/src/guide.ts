/**
 * Screen guidance — JARVIS looks at your screen and shows you where to click.
 *
 * Flow ("guide me to do X"):
 *   1. The orb asks the daemon to guide a task  → POST /api/guide { task }
 *      (no screenshot yet — the browser can't grab the whole OS screen).
 *   2. The Electron overlay polls GET /api/guide/pending, grabs a screenshot
 *      via desktopCapturer, and POSTs it back to /api/guide/capture { id, screenshot }.
 *   3. We send that screenshot + the task to a VISION model, which returns the
 *      location of the UI element to use. We draw a dotted "look here" box, a
 *      solid click-point ring, and a short spoken instruction (narration).
 *   4. The orb polls GET /api/guide/result/:id and speaks the narration.
 *
 * Vision is free-first: Google Gemini (free tier) → NVIDIA (free credits) →
 * OpenAI gpt-4o (paid, best accuracy). Whichever key exists is used.
 *
 * For testing, POST /api/guide can also carry a `screenshot` directly — then we
 * skip the overlay round-trip and locate + draw synchronously.
 */

import { setAnnotations, clearAnnotations, type Shape } from "./annotations.ts";
import { getProviderKey } from "./config/keychain.ts";
import { generateId } from "./vault/schema.ts";
import { beginWork, endWork } from "./activity.ts";

// ── Types ────────────────────────────────────────────────────────────────────

/** What the vision model returns: where to look, where to click, what to say. */
export interface GuideTarget {
  found: boolean;
  /** Bounding box of the element to use (0..1 fractions of the screen). */
  x: number; y: number; w: number; h: number;
  /** Exact point to click (0..1). */
  clickX: number; clickY: number;
  /** One short label drawn next to the box (e.g. "New Email"). */
  label: string;
  /** One spoken sentence guiding the user (e.g. "Click the blue Compose button, top-left."). */
  narration: string;
}

export interface GuideResult extends GuideTarget {
  ok: boolean;
  /** Set when the locate step itself failed (no vision key, model error). */
  error?: string;
}

// ── Vision backend selection (free-first) ─────────────────────────────────────

type VisionBackend =
  | { kind: "google"; key: string; model: string }
  | { kind: "openai"; key: string; model: string }
  | { kind: "nvidia"; key: string; model: string };

/**
 * Every available vision backend, in free-first preference order. locateTarget
 * tries them in turn so a quota/outage on one (e.g. Gemini free tier = 0) falls
 * through to the next instead of failing the whole request.
 */

// When a backend is rate-limited/quota-exhausted we park it for a while so we
// don't waste a round-trip on it every single request (e.g. a Gemini free key
// at quota 0 was costing ~1-2s before falling through to NVIDIA on every call).
const COOLDOWN_MS = 5 * 60_000;
const backendCooldown = new Map<string, number>(); // kind -> retry-after timestamp

function inCooldown(kind: string): boolean {
  const until = backendCooldown.get(kind);
  return until != null && Date.now() < until;
}

/** True if the error looks like a rate-limit / quota issue worth backing off from. */
function isRateLimited(msg: string): boolean {
  return /\b429\b|quota|rate.?limit|RESOURCE_EXHAUSTED|too many requests/i.test(msg);
}

async function listVisionBackends(): Promise<VisionBackend[]> {
  const all: VisionBackend[] = [];
  const google = await getProviderKey("google");
  if (google) all.push({ kind: "google", key: google, model: "gemini-2.0-flash" });
  const nvidia = await getProviderKey("nvidia");
  // 90B (not 11B): on NVIDIA's hosted API both have the same ~9s latency (network/
  // queue bound, not model-size bound), but 90B is more accurate + reliable JSON.
  if (nvidia) all.push({ kind: "nvidia", key: nvidia, model: "meta/llama-3.2-90b-vision-instruct" });
  const openai = await getProviderKey("openai");
  if (openai) all.push({ kind: "openai", key: openai, model: "gpt-4o" });

  // Prefer backends not in cooldown; fall back to the full list if all are parked
  // (better to retry a rate-limited one than fail outright).
  const ready = all.filter(b => !inCooldown(b.kind));
  return ready.length > 0 ? ready : all;
}

const SYSTEM_PROMPT =
  "You are JARVIS's screen-guidance vision system. You are shown a screenshot of " +
  "the user's screen and a task they want to accomplish. Find the single UI element " +
  "they should interact with next to make progress on that task (a button, link, " +
  "menu item, field, etc.).\n\n" +
  "Reply with STRICT JSON only — no prose, no markdown, no code fences. Schema:\n" +
  "{\n" +
  '  "found": boolean,            // false if the element is not visible on screen\n' +
  '  "x": number, "y": number,    // top-left of the element, as 0..1 fractions of screen width/height\n' +
  '  "w": number, "h": number,    // element size, as 0..1 fractions\n' +
  '  "click_x": number, "click_y": number, // the exact point to click, 0..1 fractions\n' +
  '  "label": string,             // 1-3 words naming the element\n' +
  '  "narration": string          // ONE short spoken sentence telling the user what to do\n' +
  "}\n" +
  "Coordinates: 0,0 = top-left of the screen; 1,1 = bottom-right. Be precise.";

/** Strip code fences / prose and pull the first {...} JSON object out of model text. */
function extractJson(text: string): Record<string, unknown> | null {
  const fenced = text.replace(/```(?:json)?/gi, "").trim();
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(fenced.slice(start, end + 1)); }
  catch { return null; }
}

function clamp01(n: unknown, fallback = 0): number {
  const x = typeof n === "number" && isFinite(n) ? n : fallback;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function normalizeTarget(raw: Record<string, unknown>): GuideTarget {
  const found = raw.found !== false; // default to true unless explicitly false
  const x = clamp01(raw.x), y = clamp01(raw.y);
  const w = clamp01(raw.w, 0.12), h = clamp01(raw.h, 0.06);
  // Default the click point to the centre of the box if the model omitted it.
  const clickX = raw.click_x != null ? clamp01(raw.click_x) : clamp01(x + w / 2);
  const clickY = raw.click_y != null ? clamp01(raw.click_y) : clamp01(y + h / 2);
  return {
    found,
    x, y, w, h, clickX, clickY,
    label: typeof raw.label === "string" ? raw.label.slice(0, 40) : "",
    narration: typeof raw.narration === "string" ? raw.narration.slice(0, 240) : "",
  };
}

// ── Vision calls ───────────────────────────────────────────────────────────

/** Google Gemini generateContent with an inline image (free tier supports vision). */
async function locateGoogle(b: VisionBackend & { kind: "google" }, task: string, dataUrl: string): Promise<string> {
  const m = /^data:(.+?);base64,(.*)$/s.exec(dataUrl);
  const mimeType = m?.[1] ?? "image/png";
  const data = m?.[2] ?? dataUrl;
  // Key goes in a header, NOT the URL — query-string keys leak into logs/proxies.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${b.model}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": b.key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: `Task: ${task}` }, { inlineData: { mimeType, data } }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 400 },
    }),
  });
  if (!res.ok) throw new Error(`Google vision ${res.status}: ${await res.text()}`);
  const j = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  return j.candidates?.[0]?.content?.parts?.map(p => p.text ?? "").join("") ?? "";
}

/** OpenAI-compatible vision (OpenAI gpt-4o, NVIDIA VLMs) via chat/completions image_url. */
async function locateOpenAICompatible(
  baseUrl: string, key: string, model: string, task: string, dataUrl: string
): Promise<string> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 400,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: [
          { type: "text", text: `Task: ${task}` },
          { type: "image_url", image_url: { url: dataUrl } },
        ] },
      ],
    }),
  });
  if (!res.ok) throw new Error(`${model} vision ${res.status}: ${await res.text()}`);
  const j = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  return j.choices?.[0]?.message?.content ?? "";
}

async function callBackend(b: VisionBackend, task: string, dataUrl: string): Promise<string> {
  if (b.kind === "google") return locateGoogle(b, task, dataUrl);
  if (b.kind === "nvidia") return locateOpenAICompatible("https://integrate.api.nvidia.com/v1", b.key, b.model, task, dataUrl);
  return locateOpenAICompatible("https://api.openai.com/v1", b.key, b.model, task, dataUrl);
}

/**
 * Ask a vision model where the target is. Tries each available backend in turn
 * (free first); only throws if there are none, or every one failed.
 */
export async function locateTarget(task: string, dataUrl: string): Promise<GuideTarget> {
  const backends = await listVisionBackends();
  if (backends.length === 0) {
    throw new Error(
      "Screen guidance needs a vision model. Add a Google key (free), an NVIDIA key " +
      "(free credits), or an OpenAI key in Settings."
    );
  }

  const errors: string[] = [];
  let gotUnparseable = false;
  for (const b of backends) {
    try {
      const text = await callBackend(b, task, dataUrl);
      const raw = extractJson(text);
      if (!raw) {
        // The model replied but not with JSON — let the next backend try.
        gotUnparseable = true;
        errors.push(`${b.kind}: non-JSON reply`);
        continue;
      }
      return normalizeTarget(raw);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Park rate-limited/quota'd backends so we skip them on later requests.
      if (isRateLimited(msg)) backendCooldown.set(b.kind, Date.now() + COOLDOWN_MS);
      errors.push(`${b.kind}: ${msg.slice(0, 160)}`);
    }
  }
  // Every backend that answered gave unparseable output (no hard errors) → soft fail.
  if (gotUnparseable) {
    return { found: false, x: 0, y: 0, w: 0, h: 0, clickX: 0, clickY: 0, label: "",
      narration: "I looked but couldn't read the screen clearly. Try rephrasing what you want to do." };
  }
  throw new Error(`All vision models failed. ${errors.join(" | ")}`);
}

/** Turn a located target into the shapes the overlay draws. */
export function targetToShapes(t: GuideTarget): Shape[] {
  if (!t.found) return [];
  const tiffany = "#0ABAB5";
  return [
    // Dotted "look around here" area.
    { type: "rect", x: t.x, y: t.y, w: t.w, h: t.h, text: t.label || undefined, color: tiffany },
    // Solid ring marking the exact click point.
    { type: "circle", x: t.clickX, y: t.clickY, w: 0.028, color: tiffany },
  ];
}

/** Locate + draw in one shot. Used by both the sync and overlay-capture paths. */
export async function runGuide(task: string, dataUrl: string): Promise<GuideResult> {
  beginWork(); // pill shows "thinking" while the vision call runs
  try {
    const t = await locateTarget(task, dataUrl);
    if (t.found) {
      setAnnotations(targetToShapes(t), 15_000); // stay up 15s so the user can act
    } else {
      clearAnnotations();
    }
    return { ok: true, ...t };
  } catch (e) {
    clearAnnotations();
    const msg = e instanceof Error ? e.message : String(e);
    // Keep the raw cause in `error`; say something a human can actually hear.
    const friendly = /no vision model|needs a vision model/i.test(msg)
      ? "Screen guidance needs a vision model — add a free Google, NVIDIA, or OpenAI key in Settings."
      : "I couldn't reach the vision model just now — give it a moment and try again.";
    return {
      ok: false, error: msg,
      found: false, x: 0, y: 0, w: 0, h: 0, clickX: 0, clickY: 0,
      label: "", narration: friendly,
    };
  } finally {
    endWork();
  }
}

// ── orb → overlay capture queue ──────────────────────────────────────────────
// The orb asks for guidance; the overlay (which can screenshot the OS) fulfils it.

interface GuideRequest { id: string; task: string; createdAt: number; taken: boolean; }
interface StoredResult { result: GuideResult; createdAt: number; }

const MAX_AGE_MS = 60_000;
// One map is both the FIFO queue (insertion-ordered) AND the authoritative task
// store — so submitCapture reads the task we recorded, never one a caller re-sends.
const requests = new Map<string, GuideRequest>();
const results = new Map<string, StoredResult>();

function sweep(): void {
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const [id, r] of requests) if (r.createdAt < cutoff) requests.delete(id);
  for (const [id, r] of results) if (r.createdAt < cutoff) results.delete(id);
}

/** Orb: enqueue a guidance request; the overlay will screenshot + fulfil it. */
export function requestGuide(task: string): string {
  sweep();
  const id = generateId();
  requests.set(id, { id, task, createdAt: Date.now(), taken: false });
  return id;
}

/** Overlay: claim the next un-taken request (FIFO), or null if none. */
export function takePendingGuide(): { id: string; task: string } | null {
  sweep();
  for (const r of requests.values()) {
    if (!r.taken) { r.taken = true; return { id: r.id, task: r.task }; }
  }
  return null;
}

/**
 * Overlay: submit the screenshot for a request → locate + draw → store result.
 * The task comes from OUR queue record (looked up by id), not from the caller.
 */
export async function submitCapture(id: string, dataUrl: string): Promise<GuideResult> {
  sweep();
  const req = requests.get(id);
  if (!req) {
    return {
      ok: false, error: "Unknown or expired guide request id",
      found: false, x: 0, y: 0, w: 0, h: 0, clickX: 0, clickY: 0,
      label: "", narration: "That guidance request expired — try again.",
    };
  }
  const result = await runGuide(req.task, dataUrl);
  results.set(id, { result, createdAt: Date.now() });
  return result;
}

/** Orb: poll for a finished result. */
export function getGuideResult(id: string): GuideResult | null {
  sweep();
  return results.get(id)?.result ?? null;
}
