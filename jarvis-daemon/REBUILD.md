# JARVIS Kernel Rebuild - progress (14 steps)

Goal: make JARVIS **the secure base every agent harness builds on** - a minimal,
secure-by-default, forkable kernel. See `KERNEL.md` for the architecture.

Decisions: **Sandbox = Docker** | **Memory = sqlite-vec + local Ollama embeddings**.

## MOVE 1 - forge the secure trunk (the moat)
- [x] **1. Define the kernel boundary** -> `KERNEL.md` (trunk vs. branch, the 10 layers).
- [x] **2. No-bypass authority+audit chokepoint** -> every tool call goes through
      `router.call()`; untrusted (direct-API) calls are authority-gated + audited;
      agent calls pass `{trusted:true}`. TESTED: read_file passes, delete_file blocked,
      agents unaffected.
- [~] **3. Sandbox execution by default** -> `src/sandbox.ts` (Docker: no network,
      read-only rootfs, cpu/mem/pids/time limits; refuses if Docker absent - no host
      fallback). `run_shell` rewired + OFF by default. TESTED: shell refuses without
      opt-in. DOCKER INSTALL FAILED (winget exit -5; not installed). RETRY: download
      Docker Desktop from docker.com, run AS ADMIN; needs WSL2 + BIOS virtualization.
      Sandbox refuses meanwhile (secure default) - does NOT block Steps 4-14.
- [x] **4. Guardrail primitives** -> `src/guardrails.ts`: dry-run mode (mutating tools
      return a {dryRun} preview), per-tool token-bucket rate limits (30 burst / 30·min⁻¹),
      file path allowlist, shell-off-by-default. Toggle via `/api/kernel/dryrun`; inspect
      via `/api/kernel/status`. TESTED LIVE: dry-run previews run_shell; shell refuses when
      off; 45 rapid read_file -> 8 pass then 37 blocked by the rate limiter.

## MOVE 2 - make it forkable (a base, not an app)
- [ ] **5. Spec-compliant MCP** (server + client) for ecosystem interop.
- [ ] **6. 20-line "build your own agent" SDK** + per-layer docs.
- [ ] **7. Memory tier** -> sqlite-vec (embedded) + Ollama embeddings (local).

## MOVE 3 - keep the validated wants first-class
- [ ] **8. Voice stays in the base** (Vosk + edge-tts) - already core; keep.
- [ ] **9. Bounded autonomous loops stay core** - already built (`agents/loop.ts`).
- [ ] **10. Guarantee local-first + BYO key + zero telemetry** - audit + state it.

## MOVE 4 - prove & position
- [ ] **11. Demote clients to examples/** (orb, pill, Slack) - partly done in OSS repo.
- [ ] **12. Lead all messaging with "the secure agent kernel".**
- [ ] **13. Record the real product** (orb/pill) for authentic proof.
- [ ] **14. (Later) Monetization** - kernel free; paid = hosted/managed or enterprise
      security tier (open-core).

## Next
Finish #3 once Docker is running (launch Docker Desktop, accept license), then #4.
Sync kernel changes (router/sandbox/index + KERNEL.md/REBUILD.md) to the public repo.
