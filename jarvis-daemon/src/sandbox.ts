/**
 * Sandbox - run code/shell tools in an isolated Docker container.
 *
 * Kernel security posture: untrusted code NEVER runs on the host. It runs in a
 * throwaway container with NO network, a read-only rootfs, a temp working dir, and
 * cpu / memory / pids / time limits. If Docker isn't available, sandboxed execution
 * is REFUSED - we never silently fall back to running on the host (that would defeat
 * the entire point). Shell execution is also OFF by default (opt-in only).
 */
import { spawnSync } from "node:child_process";

const DEFAULT_IMAGE = "python:3.11-slim"; // has /bin/sh, python3, pip
const DEFAULT_TIMEOUT_MS = 30_000;

export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  ok: boolean;
  error?: string;
}

// Shell execution is opt-in. Default OFF; enable via env or setShellEnabled(true).
let _shellEnabled = process.env.JARVIS_ENABLE_SHELL === "1" || process.env.JARVIS_ENABLE_SHELL === "true";
export function isShellEnabled(): boolean { return _shellEnabled; }
export function setShellEnabled(on: boolean): void { _shellEnabled = !!on; }

let _dockerOk: boolean | null = null;
/** Is the Docker engine reachable? Cached after first check (pass force to recheck). */
export function dockerAvailable(force = false): boolean {
  if (_dockerOk !== null && !force) return _dockerOk;
  try {
    const r = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf-8", timeout: 6000 });
    _dockerOk = r.status === 0 && !!(r.stdout && r.stdout.trim());
  } catch { _dockerOk = false; }
  return _dockerOk;
}

/** Run a command inside a locked-down, throwaway container. */
export function runInSandbox(
  command: string,
  args: string[] = [],
  opts: { image?: string; timeoutMs?: number } = {}
): SandboxResult {
  if (!dockerAvailable()) {
    return { stdout: "", stderr: "", exitCode: null, ok: false,
      error: "Docker sandbox unavailable - execution refused (no unsandboxed fallback)." };
  }
  const image = opts.image ?? DEFAULT_IMAGE;
  const dockerArgs = [
    "run", "--rm",
    "--network", "none",          // no network
    "--cpus", "1",
    "--memory", "256m",
    "--pids-limit", "128",
    "--read-only",                // immutable rootfs
    "--tmpfs", "/work:rw,size=64m",
    "-w", "/work",
    image,
    command, ...args,
  ];
  const r = spawnSync("docker", dockerArgs, {
    encoding: "utf-8",
    timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (r.error) {
    return { stdout: r.stdout ?? "", stderr: String(r.error), exitCode: null, ok: false, error: String(r.error) };
  }
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", exitCode: r.status, ok: r.status === 0 };
}
