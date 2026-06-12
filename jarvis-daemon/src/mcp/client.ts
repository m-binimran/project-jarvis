/**
 * Spec-compliant MCP client — stdio transport.
 *
 * Lets the kernel CONSUME the MCP ecosystem: spawn any MCP server (filesystem,
 * github, sqlite, …), discover its tools, and register them into our router as
 * a connector. Once registered they flow through the same secure chokepoint as
 * native tools — imported tools get category "external_tool", so an untrusted
 * (direct-API) caller can't fire them without approval, while the kernel's own
 * agents ({ trusted:true }) can.
 *
 * stdio framing: newline-delimited JSON, one JSON-RPC message per line
 * (per the MCP stdio transport spec). Implemented by hand — no SDK.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { MCPRouter, MCPConnector, MCPTool } from "./router.ts";
import { MCP_PROTOCOL_VERSION, type JsonRpcResponse } from "./protocol.ts";

export interface McpStdioOptions {
  id: string;                 // connector id
  name?: string;              // human label
  command: string;            // e.g. "npx"
  args?: string[];            // e.g. ["-y", "@modelcontextprotocol/server-filesystem", "/data"]
  env?: Record<string, string>;
  cwd?: string;
  timeoutMs?: number;         // per-request timeout (default 30s)
}

interface RemoteTool {
  name: string;
  description?: string;
  inputSchema?: { properties?: Record<string, unknown> } & Record<string, unknown>;
}

export interface McpClientHandle {
  id: string;
  toolNames: string[];
  close(): void;
}

export class McpStdioClient {
  private proc: ChildProcessWithoutNullStreams;
  private buf = "";
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: JsonRpcResponse) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private timeoutMs: number;
  private closed = false;
  private opts: McpStdioOptions;

  constructor(opts: McpStdioOptions) {
    this.opts = opts;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.proc = spawn(opts.command, opts.args ?? [], {
      env: { ...process.env, ...(opts.env ?? {}) },
      cwd: opts.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;

    this.proc.stdout.setEncoding("utf-8");
    this.proc.stdout.on("data", (chunk: string) => this.onData(chunk));
    this.proc.on("exit", () => this.failAll(new Error(`MCP server '${opts.id}' exited`)));
    this.proc.on("error", e => this.failAll(e instanceof Error ? e : new Error(String(e))));
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      let msg: JsonRpcResponse;
      try { msg = JSON.parse(line); } catch { continue; } // ignore non-JSON log lines
      if (typeof msg.id === "number" && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!;
        clearTimeout(p.timer);
        this.pending.delete(msg.id);
        p.resolve(msg);
      }
    }
  }

  private failAll(e: Error): void {
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(e); }
    this.pending.clear();
  }

  private send(method: string, params?: Record<string, unknown>): void {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  private request(method: string, params?: Record<string, unknown>): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP '${this.opts.id}' ${method} timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  /** Handshake: initialize → initialized → tools/list. Returns remote tools. */
  async handshake(): Promise<RemoteTool[]> {
    const init = await this.request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "jarvis-kernel", version: "0.1.0" },
    });
    if (init.error) throw new Error(`initialize failed: ${init.error.message}`);
    this.send("notifications/initialized");
    const list = await this.request("tools/list", {});
    if (list.error) throw new Error(`tools/list failed: ${list.error.message}`);
    const tools = (list.result as { tools?: RemoteTool[] } | undefined)?.tools ?? [];
    return tools;
  }

  /** Invoke a remote tool, returning its first text block (or the raw result). */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const res = await this.request("tools/call", { name, arguments: args });
    if (res.error) throw new Error(res.error.message);
    const r = res.result as { content?: { type: string; text?: string }[]; isError?: boolean } | undefined;
    if (r?.isError) {
      const text = r.content?.map(c => c.text).filter(Boolean).join("\n") || "remote tool error";
      throw new Error(`[MCP ${this.opts.id}] ${text}`);
    }
    const text = r?.content?.map(c => c.text).filter(Boolean).join("\n");
    return text ?? r ?? {};
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.failAll(new Error("client closed"));
    try { this.proc.kill(); } catch { /* already dead */ }
  }
}

/**
 * Connect to an external MCP server over stdio and register its tools into the
 * router as a connector. Imported tools are category "external_tool" (gated for
 * untrusted callers). Returns a handle to inspect/close the connection.
 */
export async function connectMcpServer(router: MCPRouter, opts: McpStdioOptions): Promise<McpClientHandle> {
  const client = new McpStdioClient(opts);
  const remote = await client.handshake();

  const tools: MCPTool[] = remote.map(rt => ({
    name: rt.name,
    description: rt.description ?? `(imported from ${opts.id})`,
    category: "external_tool",
    inputSchema: (rt.inputSchema?.properties as Record<string, unknown>) ?? {},
    handler: (params: Record<string, unknown>) => client.callTool(rt.name, params),
  }));

  const connector: MCPConnector = {
    id: opts.id,
    name: opts.name ?? opts.id,
    description: `External MCP server (${opts.command})`,
    tools,
  };
  router.register(connector);

  return {
    id: opts.id,
    toolNames: tools.map(t => t.name),
    close: () => { router.unregister(opts.id); client.close(); },
  };
}
