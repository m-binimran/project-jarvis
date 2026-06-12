# Examples

These are **things built on top of the kernel** (`../jarvis-daemon`). They are
*not* part of the core — they show what you can build, and give you something
runnable out of the box. Fork them, replace them, or ignore them entirely.

**Start here:** the fastest way to understand the kernel is to build a secure
agent in ~20 lines — see [`../jarvis-daemon/examples/agent.ts`](../jarvis-daemon/examples/agent.ts)
and the [SDK guide](../jarvis-daemon/SDK.md).

| Example | What it is |
|---------|------------|
| [`../jarvis-daemon/examples/agent.ts`](../jarvis-daemon/examples/agent.ts) | **Build your own agent** — the kernel SDK in ~20 lines (`createKernel` + `defineTool` + `run`). The best starting point. |
| [`orb-ui/`](orb-ui) | The "orb" web UI — a heads-up command center (voice, chat, status panels) served on `:3020`, talking to the kernel over localhost. |
| [`overlay/`](overlay) | An Electron desktop client — the always-on "pill," plus the screen-guidance overlay that draws on your screen. |

The clients talk to the kernel only through its HTTP API (`http://127.0.0.1:9101`).
That's the whole point: **the kernel is the engine; everything else is swappable.**
Build your own.
