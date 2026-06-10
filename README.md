# Project J.A.R.V.I.S.

**A personal AI operating system that runs on your own computer, with your own AI key.**

*Just A Rather Very Intelligent System.*

> **Built to be a foundation.** JARVIS isn't just an app — it's a clean, working **base for building your own AI agent or harness**. Fork it, keep the parts you want (the multi-provider LLM layer, the agent/workforce engine, free voice I/O, the MCP tool router, the screen overlay), and build your own features on top. No framework lock-in, no vendor lock-in.

JARVIS is a local-first AI assistant for solo founders, builders, and tinkerers. You bring your own model API key (NVIDIA, Google, OpenAI, Anthropic, or a local Ollama), and JARVIS gives you a voice-driven orb, an always-on "pill," a multi-agent workforce, screen guidance, and Slack integration — all running on your machine. **Your data and your keys never leave your computer.**

> ⚠️ **Naming note:** "JARVIS" is famously associated with the Marvel franchise. This project is an independent, non-commercial open-source tool and is not affiliated with or endorsed by Marvel/Disney. If you fork it for public or commercial use, consider choosing your own name.

## What it does

- 🎙️ **Free voice in & out** — speech-to-text via offline [Vosk](https://alphacephei.com/vosk/) (no key, no cloud) and neural text-to-speech via Edge TTS. Premium voices (ElevenLabs) are optional.
- 🔮 **The Orb** — a heads-up command center you talk to.
- 📌 **The Pill** — a Dynamic-Island-style always-on launcher with live "thinking" status.
- 👁️ **Screen guidance** — ask "show me where to click for X" and JARVIS looks at your screen (via a vision model) and draws the answer right on it.
- 🧑‍💼 **Multi-agent workforce** — a CEO agent delegates to department leads and specialists.
- 💬 **Slack** — DM or @mention JARVIS to run the workforce in a thread.
- 🔒 **Privacy-first** — API keys live in your OS keychain, never in code or config files. The memory vault stays in your home directory, outside the repo.

## Architecture

Three independent parts that talk to each other over localhost:

| Part | Folder | Stack | Port |
|------|--------|-------|------|
| **Daemon** (the brain) | `jarvis-daemon` | Node + Hono, SQLite vault | `9101` |
| **Frontend** (the orb UI) | `jarvis-frontend` | Static HTML + in-browser React/Babel | `3020` |
| **Overlay** (the pill + screen drawing) | `jarvis-overlay` | Electron (electron-forge + Vite) | — |

## Quick start

**Prerequisites:** [Node.js 22+](https://nodejs.org) (the daemon uses `--experimental-strip-types` to run TypeScript directly).

```bash
# 1. The brain
cd jarvis-daemon
npm install
node --experimental-strip-types src/index.ts      # serves http://127.0.0.1:9101

# 2. The orb UI (in a second terminal)
cd jarvis-frontend
node serve.js                                       # serves http://127.0.0.1:3020

# 3. The pill + screen overlay (in a third terminal)
cd jarvis-overlay
npm install
npm start                                           # launches the Electron pill
```

Then open the orb, go to **Settings**, and paste in **one** model API key (a free [NVIDIA build.nvidia.com](https://build.nvidia.com) key works great). The key is stored in your OS keychain — never written to disk in plain text.

### Voice model (one-time download)

Offline speech-to-text needs the small Vosk English model. It is **not** bundled (it's ~40 MB). Download it once:

```bash
# from jarvis-frontend/
mkdir -p models
curl -L -o models/vosk-model-small-en-us-0.15.tar.gz \
  https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.tar.gz
```

(Voice **output** and chat work without it; you only need it for hands-free voice input.)

## Bring your own brain

JARVIS speaks the OpenAI-compatible chat API plus Google Gemini and Anthropic, so you can point it at:

- **NVIDIA NIM** (`build.nvidia.com`) — free dev credits, the default
- **Google Gemini**, **OpenAI**, **Anthropic** — paid, faster/sharper
- **Ollama** — fully local, fully free

## Built to build on

JARVIS is designed so you can rip out, replace, or extend any layer. The main seams:

- **Models** — `jarvis-daemon/src/llm/` speaks an OpenAI-compatible interface. Add a provider by dropping in one adapter; the manager handles fallback/routing.
- **Tools** — `jarvis-daemon/src/mcp/` is a connector router. Register a connector with a few tools and every agent can call them.
- **Agents** — `jarvis-daemon/src/agents/` defines the CEO → department-lead → specialist workforce. Add your own agents/departments, or wire a different orchestration entirely.
- **Voice & UI** — voice in (`jarvis-frontend/voice.js`) and out (`/api/tts`) are swappable; the orb (`orb.jsx`) and the Electron overlay are independent front-ends talking to the same daemon over localhost.

Start from this base, keep what's useful, and build your own harness on top.

## Contributing

Issues and PRs welcome. This started as one person's tool and is shared as a foundation for others to build on — expect rough edges, and bring your own.

## License

**Dual-licensed — take your pick.** Project J.A.R.V.I.S. is licensed under **either**:

- [Apache License 2.0](LICENSE-APACHE) (includes an explicit patent grant), **or**
- [MIT License](LICENSE-MIT) (dead simple)

**at your option.** `SPDX-License-Identifier: MIT OR Apache-2.0`

Build on it, fork it, extend it, ship it (commercial use included) under whichever fits your project. Just keep the notices. Provided as-is, no warranty.

> Why both? It's the standard for foundations (e.g. the Rust ecosystem): MIT is the simplest/most familiar, Apache-2.0 adds patent protection — offering both lets the widest range of projects build on this one.

