/**
 * Global "is JARVIS working right now" flag.
 *
 * The pill (a separate Electron window) can't see the orb's React state, so it
 * polls GET /api/activity and shows its thinking animation while this is busy.
 * It's a simple in-flight counter: any chat dispatch or screen-guidance vision
 * call brackets itself with beginWork()/endWork().
 */

let active = 0;

export function beginWork(): void {
  active++;
}

export function endWork(): void {
  active = Math.max(0, active - 1);
}

export function isBusy(): boolean {
  return active > 0;
}

/** Run a piece of async work bracketed as "busy" — endWork always runs. */
export async function withWork<T>(fn: () => Promise<T>): Promise<T> {
  beginWork();
  try {
    return await fn();
  } finally {
    endWork();
  }
}
