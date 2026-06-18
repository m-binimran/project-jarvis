/**
 * Kernel guardrails - the "you can't hurt yourself" primitives that the secure
 * chokepoint (router.call) consults on every tool call:
 *
 *   - DRY-RUN: when on, side-effectful tools are NOT executed - they return a
 *     {dryRun:true, wouldRun:...} preview instead. Plan without consequences.
 *   - RATE LIMITS: a per-tool token bucket caps how often any one tool can fire.
 *   - PATH ALLOWLIST: file tools can be confined to specific roots (opt-in).
 *
 * All are safe-by-default: dry-run OFF, generous rate cap, allowlist = allow-all
 * until the operator restricts it. No imports from router.ts (avoids a cycle).
 */

// Categories that change the world (vs. read-only). Used by dry-run.
const MUTATING = new Set<string>([
  "write_file", "delete_file", "send_email", "send_message", "post_social",
  "make_purchase", "calendar_write", "run_code", "install_software",
  "system_access", "share_data_external", "access_credentials", "computer_use",
]);
export function isMutating(category: string): boolean {
  return MUTATING.has(category);
}

// ── Dry-run ──────────────────────────────────────────────────────────────────
let _dryRun = process.env.JARVIS_DRY_RUN === "1" || process.env.JARVIS_DRY_RUN === "true";
export function isDryRun(): boolean { return _dryRun; }
export function setDryRun(on: boolean): void { _dryRun = !!on; }

// ── Per-tool rate limiting (token bucket) ────────────────────────────────────
const RATE_CAPACITY = 30;        // burst
const RATE_REFILL_PER_MIN = 30;  // sustained: 30 calls/min/tool
const buckets = new Map<string, { tokens: number; last: number }>();

/** Returns true if the call is allowed (and consumes a token), false if rate-limited. */
export function rateLimitOk(toolName: string): boolean {
  const now = Date.now();
  const b = buckets.get(toolName) ?? { tokens: RATE_CAPACITY, last: now };
  const elapsedMin = (now - b.last) / 60_000;
  b.tokens = Math.min(RATE_CAPACITY, b.tokens + elapsedMin * RATE_REFILL_PER_MIN);
  b.last = now;
  if (b.tokens < 1) { buckets.set(toolName, b); return false; }
  b.tokens -= 1;
  buckets.set(toolName, b);
  return true;
}

// ── Path allowlist for file tools ────────────────────────────────────────────
let _allowedPaths: string[] | null = null; // null = allow all (default)
/** Restrict file tools to these root paths (null = no restriction). */
export function setAllowedPaths(paths: string[] | null): void {
  _allowedPaths = paths && paths.length ? paths : null;
}
export function pathAllowed(p: string): boolean {
  if (!_allowedPaths) return true;
  const norm = String(p).replace(/\\/g, "/").toLowerCase();
  return _allowedPaths.some(a => norm.startsWith(a.replace(/\\/g, "/").toLowerCase()));
}

const FILE_TOOLS = new Set(["read_file", "write_file", "append_file", "delete_file", "list_dir"]);
export function isFileTool(toolName: string): boolean { return FILE_TOOLS.has(toolName); }
