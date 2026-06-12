/**
 * JARVIS — the secure agent kernel. Public SDK entry point.
 *
 * Build your own secure agent in ~20 lines. Everything routes through the same
 * trunk: model → PERMISSION GATE → guardrails → SANDBOX → tool → AUDIT → result.
 * You cannot build an unsafe agent on this: tool calls are authority-gated,
 * rate-limited, optionally dry-run/path-confined, code/shell is sandboxed, and
 * every action is written to a tamper-evident audit chain. No bypass path.
 *
 *   import { createKernel, defineTool } from "jarvis-kernel";
 *   import { OllamaProvider } from "jarvis-kernel/llm";
 *
 *   const k = createKernel({ llm: new OllamaProvider() });   // local, BYO key, $0
 *   k.addTool(defineTool({
 *     name: "add", description: "Add two numbers", category: "run_code",
 *     inputSchema: { a: { type: "number" }, b: { type: "number" } },
 *     handler: ({ a, b }) => ({ sum: Number(a) + Number(b) }),
 *   }));
 *   console.log(await k.run("What is 2 + 40?"));
 *
 * The full JARVIS app (orb, pill, Slack, workforce) is just one consumer of this
 * kernel. This file is the base every harness can build on.
 */

import { MCPRouter, buildDefaultRouter, type MCPTool } from "./mcp/router.ts";
import { AuthorityEngine, type ActionCategory, type PermissionMode } from "./authority/engine.ts";
import { getAuditTrail, type AuditTrail } from "./authority/audit.ts";
import { getDb, initDatabase } from "./vault/schema.ts";
import { setDryRun, setAllowedPaths } from "./guardrails.ts";
import { setShellEnabled } from "./sandbox.ts";
import { connectMcpServer, type McpStdioOptions, type McpClientHandle } from "./mcp/client.ts";
import { extractToolCall } from "./agents/runner.ts";
import { LLMManager } from "./llm/manager.ts";
import type { LLMProvider, LLMMessage } from "./llm/provider.ts";

export interface ToolSpec {
  name: string;
  description: string;
  category: ActionCategory;
  inputSchema?: Record<string, unknown>;
  /** Either `handler` or `run` — your tool's implementation. */
  handler?: (params: Record<string, unknown>) => unknown | Promise<unknown>;
  run?: (params: Record<string, unknown>) => unknown | Promise<unknown>;
}

/** Turn a friendly spec into a router tool. */
export function defineTool(spec: ToolSpec): MCPTool {
  const impl = spec.handler ?? spec.run;
  if (!impl) throw new Error(`defineTool('${spec.name}'): provide a handler or run function`);
  return {
    name: spec.name,
    description: spec.description,
    category: spec.category,
    inputSchema: spec.inputSchema ?? {},
    handler: async (params) => impl(params),
  };
}

export interface KernelOptions {
  /** Permission mode (default "productive": reads/web/code auto-approved, the rest gated). */
  mode?: PermissionMode;
  /** Your model. Pass an LLMProvider (e.g. OllamaProvider) or a configured LLMManager. */
  llm?: LLMProvider | LLMManager;
  /** Extra tools to register up front. */
  tools?: (MCPTool | ToolSpec)[];
  /** Include the built-in filesystem/exec/screen connectors (default false — stay lean). */
  builtins?: boolean;
  /** Confine file tools to these roots (default: unrestricted). */
  allowedPaths?: string[] | null;
  /** Start in dry-run (mutating tools return a preview, never execute). Default false. */
  dryRun?: boolean;
  /** Allow shell execution (only ever inside the Docker sandbox). Default false. */
  enableShell?: boolean;
}

export type ApprovalHandler = (action: ActionCategory, context: string) => boolean | Promise<boolean>;

export interface RunOptions {
  maxTurns?: number;
  systemPrompt?: string;
  /** Called when a gated action needs human approval. Default: deny (secure when unattended). */
  onApproval?: ApprovalHandler;
  onStep?: (info: { turn: number; text: string }) => void;
}

export interface RunResult {
  output: string;
  turns: number;
  toolCalls: number;
}

function isTool(x: MCPTool | ToolSpec): x is MCPTool {
  return typeof (x as MCPTool).handler === "function" && (x as ToolSpec).run === undefined && "category" in x;
}

/**
 * The secure agent kernel. Holds the router (chokepoint), the authority engine,
 * and the audit chain — and gives you a minimal, safe tool-calling loop.
 */
export class Kernel {
  readonly router: MCPRouter;
  readonly authority: AuthorityEngine;
  readonly audit: AuditTrail;
  llm: LLMManager | null = null;

  constructor(opts: KernelOptions = {}) {
    // Persist the audit chain out of the box — but never clobber an already-open
    // store (e.g. when embedded in the running daemon). In-memory if init fails.
    try { getDb(); } catch { try { initDatabase(); } catch { /* in-memory audit fallback */ } }

    this.router = opts.builtins ? buildDefaultRouter() : new MCPRouter();
    this.authority = new AuthorityEngine(opts.mode ?? "productive");
    this.router.setAuthority(this.authority); // make the router the secure chokepoint
    this.audit = getAuditTrail();

    if (opts.llm) this.useLLM(opts.llm);
    if (opts.tools) for (const t of opts.tools) this.addTool(t);
    if (opts.allowedPaths !== undefined) setAllowedPaths(opts.allowedPaths);
    if (opts.dryRun) setDryRun(true);
    if (opts.enableShell) setShellEnabled(true);
  }

  /** Attach a model. Accepts a single provider or a fully-configured LLMManager. */
  useLLM(llm: LLMProvider | LLMManager): this {
    if (llm instanceof LLMManager) {
      this.llm = llm;
    } else {
      const mgr = new LLMManager();
      mgr.register(llm);
      this.llm = mgr;
    }
    return this;
  }

  /** Register a tool (friendly spec or raw router tool) as its own one-tool connector. */
  addTool(tool: MCPTool | ToolSpec): this {
    const t = isTool(tool) ? tool : defineTool(tool);
    this.router.register({ id: `tool:${t.name}`, name: t.name, description: t.description, tools: [t] });
    return this;
  }

  /** Connect an external MCP server over stdio; its tools become gated kernel tools. */
  addMcpServer(opts: McpStdioOptions): Promise<McpClientHandle> {
    return connectMcpServer(this.router, opts);
  }

  /**
   * Call a tool through the secure chokepoint.
   * Untrusted by default: circuit breakers / approval-required actions are denied
   * without a human. Pass { trusted:true } only for already-gated agent calls.
   */
  call(tool: string, params: Record<string, unknown> = {}, opts?: { trusted?: boolean }): Promise<unknown> {
    return this.router.call(tool, params, opts);
  }

  /**
   * Run a minimal secure agent loop over the registered tools.
   * The agent proposes `TOOL_CALL:<name>:<json>`; the kernel gates it (authority +
   * your approval handler), then executes it through the router (audit + guardrails
   * + sandbox). Returns the agent's final text.
   */
  async run(task: string, opts: RunOptions = {}): Promise<RunResult> {
    if (!this.llm) throw new Error("Kernel.run needs a model — pass { llm } to createKernel or call useLLM().");
    const maxTurns = opts.maxTurns ?? 8;
    const approve: ApprovalHandler = opts.onApproval ?? (() => false);
    const tools = this.router.listTools();

    const toolDocs = tools.length
      ? tools.map(t => `- ${t.name}(${Object.keys(t.inputSchema ?? {}).join(", ")}) — ${t.description}`).join("\n")
      : "(no tools registered)";
    const system = [
      opts.systemPrompt ?? "You are a helpful, careful agent.",
      `You can call tools. To call one, reply with exactly one line:`,
      `TOOL_CALL:<toolName>:{ ...json args... }`,
      `and nothing after the closing brace. When you have the final answer, reply with prose only (no TOOL_CALL).`,
      `Available tools:\n${toolDocs}`,
    ].join("\n\n");

    const messages: LLMMessage[] = [
      { role: "system", content: system },
      { role: "user", content: task },
    ];

    let turns = 0, toolCalls = 0, output = "";
    while (turns < maxTurns) {
      turns++;
      const res = await this.llm.complete(messages, { agentId: "kernel" });
      const text = res.content ?? "";
      opts.onStep?.({ turn: turns, text });

      const call = extractToolCall(text);
      if (!call) { output = text.trim(); break; }

      let args: Record<string, unknown> = {};
      try { args = JSON.parse(call.json) as Record<string, unknown>; }
      catch {
        messages.push({ role: "assistant", content: text });
        messages.push({ role: "user", content: `That TOOL_CALL had invalid JSON. Resend as TOOL_CALL:${call.name}:{ ...valid JSON... }` });
        continue;
      }

      const tool = this.router.getTool(call.name);
      if (!tool) {
        messages.push({ role: "assistant", content: text });
        messages.push({ role: "user", content: `Tool "${call.name}" not found. Tools: ${tools.map(t => t.name).join(", ")}` });
        continue;
      }

      // Gate interactively (authority + your approval handler), then execute
      // through the router as a trusted call so it is audited + guardrailed +
      // sandboxed without being double-blocked.
      const decision = this.authority.check(tool.category);
      let toolResult: unknown;
      if (!decision.allowed) {
        toolResult = { denied: decision.reason };
      } else if (decision.requiresApproval && !(await approve(tool.category, `${call.name} ${call.json}`))) {
        toolResult = { denied: `not approved: ${tool.category}` };
      } else {
        toolCalls++;
        try { toolResult = await this.router.call(call.name, args, { trusted: true }); }
        catch (e) { toolResult = { error: String(e instanceof Error ? e.message : e) }; }
      }

      messages.push({ role: "assistant", content: text });
      messages.push({ role: "user", content: `TOOL_RESULT: ${JSON.stringify(toolResult)}` });
    }

    return { output, turns, toolCalls };
  }
}

/** Create a secure agent kernel. */
export function createKernel(opts?: KernelOptions): Kernel {
  return new Kernel(opts);
}

// Re-export the building blocks for power users / forks.
export { MCPRouter } from "./mcp/router.ts";
export type { MCPTool, MCPConnector } from "./mcp/router.ts";
export { AuthorityEngine, CIRCUIT_BREAKERS } from "./authority/engine.ts";
export type { ActionCategory, PermissionMode, AuthDecision } from "./authority/engine.ts";
export { getAuditTrail } from "./authority/audit.ts";
export { connectMcpServer } from "./mcp/client.ts";
export { handleMcpRequest } from "./mcp/protocol.ts";
