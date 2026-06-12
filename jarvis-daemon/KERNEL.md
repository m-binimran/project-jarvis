# The JARVIS Kernel — the secure trunk every agent builds on

Strip away the leaves and branches — voice, the orb, the workforce, Slack, connectors, the UI —
and what's left is the **trunk**: the loop that lets a model take an action.

Everyone ships that loop as:

```
model  ->  tool  ->  result            (open, unsafe — the agent can do anything)
```

JARVIS ships it as:

```
model  ->  PERMISSION GATE  ->  SANDBOX  ->  tool  ->  AUDIT  ->  result
```

**A secure-by-default agent kernel.** That is the one thing that sets this base apart: you
cannot build an unsafe agent on it, even by accident. Frameworks bolt safety on afterward (or
never); finished assistants hide the loop. Nobody publishes a *minimal, secure, forkable kernel*.
That's the gap this fills.

## The invariant (the moat, in one sentence)

> **No tool/side-effect runs without passing the authority gate and being written to the audit
> chain — and code/shell runs sandboxed. There is no bypass path.**

If that invariant holds at every entry point (agent runner, direct API, autonomous loop, sidecar),
the kernel is secure by construction. Everything else is a feature layered on top.

## The layers (bottom -> top)

| # | Layer | Kernel? | Notes |
|---|-------|---------|-------|
| 1 | **Models** | kernel | Provider-agnostic (OpenAI-compatible + Ollama/vLLM); per-agent routing |
| 2 | **Tools** | kernel | MCP-native router; *the* extension seam |
| 3 | **Permission / firewall** | kernel | Authority engine — gates every side-effect (the moat) |
| 4 | **Sandbox** | kernel | Code/shell runs isolated; raw shell off by default |
| 5 | **Audit** | kernel | Tamper-evident hash chain of every action |
| 6 | **Memory** | kernel (interface) | State (SQLite) + semantic/vector tier |
| 7 | **Agent runner / loops** | kernel | The action loop + bounded autonomous loops |
| 8 | **Voice** | first-class | Free in (Vosk) + out (edge-tts); a differentiator |
| 9 | **Channels / clients** | branch (examples) | Orb UI, overlay, Slack — fork or replace |
| 10 | **Connectors** | branch (plugins) | Gmail, Notion, Obsidian, GitHub, … |

Layers 1-7 (+ voice) = **the trunk you publish**. Layers 9-10 = **examples/plugins** that prove it.

## Branch vs. trunk (what moves to examples/)

- **Trunk (keep in the base):** llm, mcp router, authority, sandbox, audit, runner + loop, memory.
- **Branch (examples/plugins):** orb UI, overlay, Slack, advisors, dreaming, preset departments,
  master-vision, workflows. Nothing deleted — just not part of the secure base.

## What a builder gets

Fork the kernel, register a model + a tool + a channel, and you have a *safe* agent in ~20 lines.
The security, audit, sandbox, voice, and loop come for free. That's the on-ramp.
