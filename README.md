# Project J.A.R.V.I.S. — the secure agent kernel

**A minimal, secure-by-default base that every AI agent or harness can build on.**

*Just A Rather Very Intelligent System.*

Most agent frameworks let you bolt safety on afterward. JARVIS is the other way
round: safety is the trunk. Every tool call travels one path —

```
model → PERMISSION GATE → guardrails → SANDBOX → tool → AUDIT → result
```

— and there is **no bypass**. A tool cannot run without passing the authority
gate, clearing the guardrails, and being written to a tamper-evident audit chain;
code and shell only ever run inside a sandbox. You don't get a framework you
*can* make safe — you get one you can't easily make unsafe. Fork it and build
your own agent on a base that's secure from the first commit.

> 📐 Architecture & the moat → [`jarvis-daemon/KERNEL.md`](jarvis-daemon/KERNEL.md) ·
> 🛠️ Build your own agent → [`jarvis-daemon/SDK.md`](jarvis-daemon/SDK.md) ·
> 🔒 Zero-telemetry guarantee → [`jarvis-daemon/PRIVACY.md`](jarvis-daemon/PRIVACY.md)

## Build your own secure agent (~20 lines)

```ts
import { createKernel, defineTool } from "./jarvis-daemon/src/kernel.ts";
import { OllamaProvider } from "./jarvis-daemon/src/llm/ollama.ts"; // local, BYO key, $0

const kernel = createKernel({ llm: new OllamaProvider() });

kernel.addTool(defineTool({
  name: "add",
  description: "Add two numbers",
  category: "run_code",
  inputSchema: { a: { type: "number" }, b: { type: "number" } },
  handler: ({ a, b }) => ({ sum: Number(a) + Number(b) }),
}));

console.log((await kernel.run("What is 2 + 40?")).output); // → "The answer is 42."
```

That agent is already safe: give it a tool whose `category` is a circuit breaker
(`delete_file`, `send_email`, `make_purchase`, …) and the kernel refuses to run it
unattended unless you supply an approval handler — and every call is audited.
Run it: `node --experimental-strip-types jarvis-daemon/examples/agent.ts`.

## What makes it a *kernel*

- 🔒 **No-bypass authority + audit chokepoint** — every tool call goes through one
  gate. Untrusted/direct-API callers are permission-checked and audited; circuit
  breakers (delete, send, purchase, credentials, computer-use…) can never be prompted away.
- 📦 **Sandboxed execution by default** — code/shell runs only inside Docker (no
  network, read-only rootfs, cpu/mem/pids limits). Refuses if Docker is absent —
  no silent host fallback. Shell is off by default.
- 🚦 **Guardrails** — dry-run mode (mutating tools return a preview), per-tool rate
  limits, file-path allowlist.
- 🔌 **Spec-compliant MCP, both ways** — expose your tools to any MCP client over
  JSON-RPC (`POST /mcp`), and import any MCP server's tools — all still gated.
- 🧠 **Local semantic memory** — embedded in your SQLite vault; local Ollama
  embeddings with a keyword fallback. Nothing leaves the machine.
- 🗣️ **Free voice + autonomous loops (incl. overnight)** — offline Vosk STT + Edge
  TTS, and goal-seeking loops with hard step/token/time caps that deny risky actions
  unattended. Overnight loops are checkpointed to the vault and resume after a restart.
- 🏠 **Local-first, BYO key, zero telemetry** — single local vault, your keys in
  the OS keychain, no analytics, no phone-home. [Audited.](jarvis-daemon/PRIVACY.md)

## What's built on it (the reference app)

The kernel ships with a full personal-assistant app as proof — and as example
clients you can swap out:

- 🔮 **The Orb** — a heads-up command center you talk to.
- 📌 **The Pill** — a Dynamic-Island-style always-on launcher with live status.
- 👁️ **Screen guidance** — "show me where to click for X"; JARVIS looks at your
  screen and draws the answer on it. Uses **UI-TARS** for precise GUI grounding when
  configured (`JARVIS_UITARS_URL`), falling back to general vision models.
- 🖱️ **Computer-use operator** — JARVIS can actually click/type for you, but every
  action is gated: it shows the target on your screen and you approve each step
  (`computer_use` is a circuit breaker, so nothing runs unattended). Control panel
  at `/operator`; the "hands" use a native input lib in the overlay (opt-in).
- 🧑‍💼 **Multi-agent workforce** — a CEO agent delegates to leads and specialists.
- 💬 **Slack** — DM or @mention to run the workforce in a thread.

> ⚠️ **Naming note:** "JARVIS" is associated with the Marvel franchise. This is an
> independent, non-commercial open-source project, not affiliated with or endorsed
> by Marvel/Disney. If you fork it publicly or commercially, consider your own name.

## Architecture

Three independent parts over localhost. **The kernel is `jarvis-daemon`**; the UIs
are reference clients built purely on its HTTP API.

| Part | Folder | Stack | Port |
|------|--------|-------|------|
| **Kernel/Daemon** — the secure base | `jarvis-daemon` | Node + Hono, SQLite vault | `9101` |
| Orb web UI *(example client)* | `examples/orb-ui` | Static HTML + in-browser React/Babel | `3020` |
| Desktop overlay *(example client)* | `examples/overlay` | Electron (electron-forge + Vite) | — |

## Quick start

**Prerequisites:** [Node.js 22+](https://nodejs.org) (the daemon runs TypeScript
directly via `--experimental-strip-types`).

```bash
# 1. The kernel
cd jarvis-daemon
npm install
node --experimental-strip-types src/index.ts      # http://127.0.0.1:9101

# 2. (optional) the orb web UI — an example client, second terminal
cd examples/orb-ui && node serve.js                # http://127.0.0.1:3020

# 3. (optional) the desktop pill + screen overlay — an example client
cd examples/overlay && npm install && npm start
```

Then open the orb → **Settings** → paste **one** model API key (a free
[build.nvidia.com](https://build.nvidia.com) key works great), or run Ollama for a
fully local, fully free setup. Keys are stored in your OS keychain.

### Voice model (one-time, optional)

Offline speech-to-text needs the small Vosk English model (~40 MB, not bundled):

```bash
# from examples/orb-ui/
mkdir -p models
curl -L -o models/vosk-model-small-en-us-0.15.tar.gz \
  https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.tar.gz
```

(Chat and voice **output** work without it; you only need it for voice input.)

## Bring your own brain

JARVIS speaks the OpenAI-compatible chat API plus Google Gemini and Anthropic:

- **NVIDIA NIM** (`build.nvidia.com`) — free dev credits, the default
- **Google Gemini**, **OpenAI**, **Anthropic**, **DeepSeek** — paid, faster/sharper
- **Ollama** — fully local, fully free (and zero outbound calls)

## The seams (build on any layer)

| Layer | Where | Swap in… |
|-------|-------|----------|
| Models | `src/llm/` | any OpenAI-compatible / Gemini / Anthropic / Ollama adapter |
| Tools | `src/mcp/` + `defineTool()` | your own tools, or any MCP server (`addMcpServer`) |
| Permissions | `src/authority/engine.ts` | your own modes/overrides (circuit breakers stay) |
| Memory | `src/memory.ts` | sqlite-vec or any vector store (same API) |
| Agents | `src/agents/` | your own orchestration; or just use `kernel.run()` |
| Clients | `examples/` | your own UI over the HTTP API |

Start from this base, keep what's useful, build your harness on top.

## Tested — the invariants are locked

A base is only useful if it's sturdy, so the security guarantees are covered by an
automated suite (runs on every push via CI). It needs only Node — no extra tooling:

```bash
cd jarvis-daemon && npm test
```

It locks the things a fork must be able to trust: circuit breakers can't be
prompted/overridden away, the chokepoint blocks untrusted dangerous calls, every
call hits the audit chain, the audit chain is tamper-evident (and detects forgery),
guardrails (dry-run / rate limit / path allowlist) fire, inputs are validated, the
MCP gate holds, and — where Docker is present — the sandbox really has no network
and a read-only rootfs. (Sandbox tests auto-skip if Docker isn't installed.)

The newer capabilities are covered too: the **computer-use operator** (every action
parks for approval and never self-executes; `computer_use` is a circuit breaker in
every mode), the **UI-TARS** coordinate parser, and **overnight loops** (checkpointed
to the vault, resumed from where they left off, expired runs closed out). 60+ tests.

## Contributing

Issues and PRs welcome. This started as one person's tool and is shared as a
foundation for others to build on — expect rough edges, and bring your own. Please
keep `npm test` green.

## License

**Dual-licensed — take your pick.** Either:

- [Apache License 2.0](LICENSE-APACHE) (explicit patent grant), **or**
- [MIT License](LICENSE-MIT) (dead simple)

**at your option.** `SPDX-License-Identifier: MIT OR Apache-2.0`

Build on it, fork it, ship it (commercial use included) under whichever fits. Keep
the notices. Provided as-is, no warranty.

> Why both? It's the standard for foundations (e.g. the Rust ecosystem): MIT is the
> simplest, Apache-2.0 adds patent protection — offering both lets the widest range
> of projects build on this one.
