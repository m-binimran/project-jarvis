# Build your own agent — the JARVIS kernel SDK

JARVIS is **the secure agent kernel**: a minimal, secure-by-default base that any
agent harness can build on. You don't get a framework that *can* be made safe —
you get one you can't easily make unsafe. Every tool call travels the same trunk:

```
model → PERMISSION GATE → guardrails → SANDBOX → tool → AUDIT → result
```

There is **no bypass path**. A tool cannot run without passing the authority gate,
clearing the guardrails, and being written to a tamper-evident audit chain — and
code/shell only ever runs inside a sandbox.

---

## Quickstart (the whole thing, ~20 lines)

```ts
import { createKernel, defineTool } from "./src/kernel.ts";
import { OllamaProvider } from "./src/llm/ollama.ts";   // local, BYO key, $0

const kernel = createKernel({ llm: new OllamaProvider() });

kernel.addTool(defineTool({
  name: "add",
  description: "Add two numbers",
  category: "run_code",
  inputSchema: { a: { type: "number" }, b: { type: "number" } },
  handler: ({ a, b }) => ({ sum: Number(a) + Number(b) }),
}));

const result = await kernel.run("What is 2 + 40?");
console.log(result.output);   // → "The answer is 42."
```

That agent is already secure: if you give it a tool whose `category` is a circuit
breaker (`delete_file`, `send_email`, `make_purchase`, …), the kernel will refuse
to run it unattended unless you supply an approval handler — and every call it
makes is audited.

Run it:

```bash
node --experimental-strip-types examples/agent.ts
```

---

## The layers (what you're building on)

| Layer | Where | What it guarantees |
|-------|-------|--------------------|
| **Permission gate** | `authority/engine.ts` | Four modes (`safe`/`productive`/`auto`/`bypass`). Circuit breakers (delete, send, purchase, credentials, …) **always** require human approval — a prompt can never override them. |
| **Guardrails** | `guardrails.ts` | Dry-run (mutating tools return a preview), per-tool token-bucket rate limits, file-path allowlist. |
| **Sandbox** | `sandbox.ts` | Code/shell runs only inside Docker (no network, read-only rootfs, cpu/mem/pids limits). Refuses if Docker is absent — no host fallback. Shell is OFF by default. |
| **Chokepoint** | `mcp/router.ts` | `router.call()` is the single path to every tool. Untrusted callers are gated; agent calls pass `{trusted:true}` (already gated). |
| **Audit** | `authority/audit.ts` | Every permission check, tool call, and result is appended to a hash-chained, tamper-evident trail. |
| **MCP interop** | `mcp/protocol.ts`, `mcp/client.ts` | Speak MCP both ways — expose your tools to any MCP client, and import any MCP server's tools (gated as `external_tool`). |

---

## API

### `createKernel(options?) → Kernel`

| Option | Default | Meaning |
|--------|---------|---------|
| `mode` | `"productive"` | Permission mode. |
| `llm` | — | An `LLMProvider` (e.g. `OllamaProvider`) or a configured `LLMManager`. |
| `tools` | — | Tools to register up front (`MCPTool` or `ToolSpec`). |
| `builtins` | `false` | Include the filesystem/exec/screen connectors. |
| `allowedPaths` | unrestricted | Confine file tools to these roots. |
| `dryRun` | `false` | Start in dry-run (mutating tools previewed, never executed). |
| `enableShell` | `false` | Allow shell — only ever inside the Docker sandbox. |

### `Kernel`

- `addTool(tool)` — register a `ToolSpec` or `MCPTool`.
- `addMcpServer(opts)` — connect an external MCP server over stdio; its tools become gated kernel tools. Returns a handle with `.close()`.
- `call(tool, params, { trusted? })` — call a tool through the chokepoint. **Untrusted by default** (circuit breakers denied without a human).
- `run(task, { maxTurns?, systemPrompt?, onApproval?, onStep? })` — run a minimal secure tool-calling loop. Returns `{ output, turns, toolCalls }`.
- `.router`, `.authority`, `.audit` — the raw building blocks, for forks.

### `defineTool(spec) → MCPTool`

```ts
defineTool({
  name: "send_invoice",
  description: "Email an invoice to a client",
  category: "send_email",        // ← a circuit breaker: always needs approval
  inputSchema: { to: { type: "string" }, amount: { type: "number" } },
  handler: async ({ to, amount }) => { /* … */ },
});
```

The `category` is what wires a tool into the security model. Pick the honest one —
it decides whether the tool is auto-approved, gated, or a circuit breaker.

### Approvals

`run()` is **safe when unattended**: any action needing approval is denied unless
you pass `onApproval`:

```ts
await kernel.run("Email the Q3 invoice to acme@co.com", {
  onApproval: (category, context) => {
    // return true/false (or a Promise). Wire this to your UI, Slack, etc.
    return category !== "send_email";   // e.g. allow everything but sending mail
  },
});
```

---

## Security guarantees (and how to verify them)

- **No bypass.** Everything goes through `router.call()`. Even spec-compliant MCP
  clients hitting `POST /mcp` pass the gate.
- **Circuit breakers can't be prompted away.** `delete_file`, `send_*`,
  `make_purchase`, `access_credentials`, `share_data_external`, `install_software`,
  `system_access` always require explicit approval.
- **Local-first, BYO key, zero telemetry.** Use `OllamaProvider` for a fully local
  agent. Keys live in your OS keychain. Nothing phones home.

Verify the gate yourself:

```ts
const k = createKernel({ llm });
k.addTool(defineTool({ name: "wipe", description: "delete", category: "delete_file",
  handler: () => ({ deleted: true }) }));
await k.call("wipe", { path: "x" });   // throws: [AUTHORITY] … Circuit breaker …
```
