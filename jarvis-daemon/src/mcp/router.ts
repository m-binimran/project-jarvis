/**
 * JARVIS MCP Router
 *
 * Custom MCP plug-in router — connect anything.
 * Each MCP connector registers its tools here.
 * The router exposes a unified interface: tool name → handler.
 *
 * Inspired by the TradingView MCP pattern we know well.
 * Written fresh — no code copied.
 *
 * V1 built-in connectors:
 *   - filesystem (local read/write/list)
 *   - exec (shell command runner)
 *   - web_search (Brave Search API or DuckDuckGo)
 *
 * Pluggable connectors (wired in later):
 *   - Gmail (mcp-google-workspace)
 *   - Google Calendar
 *   - Custom user connectors
 */

import type { ActionCategory, AuthorityEngine } from "../authority/engine.ts";
import { checkCode } from "../authority/firewall.ts";
import { getAuditTrail } from "../authority/audit.ts";
import { isDryRun, isMutating, rateLimitOk, isFileTool, pathAllowed } from "../guardrails.ts";

export interface MCPTool {
  name: string;
  description: string;
  category: ActionCategory;
  inputSchema: Record<string, unknown>;
  handler: (params: Record<string, unknown>) => Promise<unknown>;
}

export interface MCPConnector {
  id: string;
  name: string;
  description: string;
  tools: MCPTool[];
}

export class MCPRouter {
  private connectors = new Map<string, MCPConnector>();
  private toolIndex = new Map<string, MCPTool>();
  private authority: AuthorityEngine | null = null;
  private audit = getAuditTrail();

  /** Wire the authority engine so the router becomes the secure chokepoint. */
  setAuthority(authority: AuthorityEngine): void {
    this.authority = authority;
  }

  register(connector: MCPConnector): void {
    this.connectors.set(connector.id, connector);
    for (const tool of connector.tools) {
      this.toolIndex.set(tool.name, tool);
    }
    console.log(`[MCP] Registered connector: ${connector.name} (${connector.tools.length} tools)`);
  }

  unregister(connectorId: string): void {
    const connector = this.connectors.get(connectorId);
    if (!connector) return;
    for (const tool of connector.tools) {
      this.toolIndex.delete(tool.name);
    }
    this.connectors.delete(connectorId);
  }

  /**
   * Run a tool — the kernel's SECURE CHOKEPOINT. Every call is audited; external
   * (untrusted) callers are authority-gated here, so a tool cannot be invoked via
   * the direct API without passing the permission engine. Agent-internal calls
   * pass { trusted: true } because the agent runner already gated them interactively.
   * No-bypass invariant: there is no path to a tool that skips this method.
   */
  async call(
    toolName: string,
    params: Record<string, unknown>,
    opts: { trusted?: boolean } = {}
  ): Promise<unknown> {
    const tool = this.toolIndex.get(toolName);
    if (!tool) throw new Error(`MCP tool not found: ${toolName}`);

    // Authority gate — for untrusted (direct-API / unattended) callers only.
    // Anything denied, or that needs human approval, cannot run without a human.
    if (this.authority && !opts.trusted) {
      const decision = this.authority.check(tool.category);
      this.audit.log({ action: "permission_check", payload: { tool: toolName, category: tool.category, decision } });
      if (!decision.allowed || decision.requiresApproval) {
        this.audit.log({ action: "permission_denied", outcome: "blocked", payload: { tool: toolName, reason: decision.reason } });
        throw new Error(`[AUTHORITY] '${toolName}' (${tool.category}) blocked — ${decision.reason}. Not permitted via the direct API without approval.`);
      }
    }

    // Guardrails — rate limit, path allowlist, dry-run (the kernel safety net).
    if (!rateLimitOk(toolName)) {
      this.audit.log({ action: "rate_limit_hit", payload: { tool: toolName } });
      throw new Error(`[GUARDRAIL] Rate limit exceeded for '${toolName}' — slow down.`);
    }
    if (isFileTool(toolName) && typeof params.path === "string" && !pathAllowed(params.path)) {
      this.audit.log({ action: "permission_denied", outcome: "blocked", payload: { tool: toolName, reason: "path not allowlisted" } });
      throw new Error(`[GUARDRAIL] Path not allowed by the allowlist: ${params.path}`);
    }
    if (isDryRun() && isMutating(tool.category)) {
      this.audit.log({ action: "tool_call", payload: { tool: toolName, dryRun: true } });
      return { dryRun: true, wouldRun: toolName, category: tool.category, params };
    }

    // CodeShield — scan any code/shell execution before it runs (applies to ALL callers).
    if (tool.category === "run_code") {
      const command = [params.command, ...(Array.isArray(params.args) ? params.args : []), params.code]
        .filter(v => typeof v === "string" && v.length > 0)
        .join(" ");
      if (command) {
        const shield = checkCode(command, "shell");
        if (shield.verdict === "block") {
          throw new Error(
            `[FIREWALL] CodeShield blocked execution — ${shield.reasons.join("; ")} (risk ${shield.score}). ` +
            `Command was not run.`
          );
        }
      }
    }

    // Audit every invocation — the no-bypass guarantee.
    this.audit.log({ action: "tool_call", payload: { tool: toolName, trusted: !!opts.trusted } });
    try {
      const result = await tool.handler(params);
      this.audit.log({ action: "tool_result", payload: { tool: toolName, success: true } });
      return result;
    } catch (err) {
      this.audit.log({ action: "tool_result", outcome: "failure", payload: { tool: toolName, success: false, error: String(err) } });
      throw err;
    }
  }

  getTool(name: string): MCPTool | null {
    return this.toolIndex.get(name) ?? null;
  }

  listTools(): MCPTool[] {
    return [...this.toolIndex.values()];
  }

  listConnectors(): { id: string; name: string; toolCount: number }[] {
    return [...this.connectors.values()].map(c => ({
      id: c.id,
      name: c.name,
      toolCount: c.tools.length,
    }));
  }
}

// ── Built-in V1 Connectors ────────────────────────────────────────────────

import { readFileSync, writeFileSync, appendFileSync, readdirSync, unlinkSync } from "node:fs";
import { runInSandbox, isShellEnabled } from "../sandbox.ts";

export const filesystemConnector: MCPConnector = {
  id: "filesystem",
  name: "File System",
  description: "Read, write, and list local files",
  tools: [
    {
      name: "read_file",
      description: "Read a file from the local filesystem",
      category: "read_file",
      inputSchema: { path: { type: "string" } },
      async handler({ path }) {
        const content = readFileSync(String(path), "utf-8");
        return { content };
      },
    },
    {
      name: "write_file",
      description: "Write content to a file",
      category: "write_file",
      inputSchema: { path: { type: "string" }, content: { type: "string" } },
      async handler({ path, content }) {
        writeFileSync(String(path), String(content), "utf-8");
        return { success: true };
      },
    },
    {
      name: "append_file",
      description: "Append content to a file",
      category: "write_file",
      inputSchema: { path: { type: "string" }, content: { type: "string" } },
      async handler({ path, content }) {
        appendFileSync(String(path), String(content), "utf-8");
        return { success: true };
      },
    },
    {
      name: "list_dir",
      description: "List files in a directory",
      category: "read_file",
      inputSchema: { path: { type: "string" } },
      async handler({ path }) {
        const items = readdirSync(String(path), { withFileTypes: true });
        return {
          items: items.map(i => ({ name: i.name, isDir: i.isDirectory() })),
        };
      },
    },
    {
      name: "delete_file",
      description: "Delete a file (requires user approval — circuit breaker)",
      category: "delete_file",
      inputSchema: { path: { type: "string" } },
      async handler({ path }) {
        unlinkSync(String(path));
        return { success: true, deleted: path };
      },
    },
  ],
};

import { setAnnotations, clearAnnotations, type Shape } from "../annotations.ts";

/**
 * Screen connector — lets an agent DRAW on the user's screen to guide them.
 * Shapes render on the transparent click-through overlay (annotate.html).
 * Category "web_browse": a harmless on-screen UI action, auto-approved, never a
 * circuit breaker — it only paints an overlay, it can't click or change anything.
 */
export const screenConnector: MCPConnector = {
  id: "screen",
  name: "Screen Guide",
  description: "Draw highlights, arrows, and click-points on the user's screen to guide them",
  tools: [
    {
      name: "draw_on_screen",
      description:
        "Draw shapes on the user's screen to point them at something. " +
        "shapes: array of { type: 'rect'|'circle'|'arrow'|'label', x, y, w?, h?, x2?, y2?, text?, color? } " +
        "where all coordinates are 0..1 fractions of the screen (0,0=top-left). " +
        "Use 'rect' for a look-here area, 'circle' for an exact click-point, 'arrow' to point. " +
        "ttlMs: how long it stays up (default 8000).",
      category: "web_browse",
      inputSchema: {
        shapes: { type: "array" },
        ttlMs: { type: "number" },
      },
      async handler({ shapes, ttlMs }) {
        const version = setAnnotations(
          Array.isArray(shapes) ? (shapes as Shape[]) : [],
          typeof ttlMs === "number" ? ttlMs : 8000
        );
        return { success: true, version, count: Array.isArray(shapes) ? shapes.length : 0 };
      },
    },
    {
      name: "clear_screen",
      description: "Erase everything JARVIS has drawn on the screen.",
      category: "web_browse",
      inputSchema: {},
      async handler() {
        clearAnnotations();
        return { success: true };
      },
    },
  ],
};

export const execConnector: MCPConnector = {
  id: "exec",
  name: "Shell Executor",
  description: "Run shell commands inside a Docker sandbox (off by default; opt-in)",
  tools: [
    {
      name: "run_shell",
      description: "Run a shell command in an isolated Docker sandbox (no network, cpu/mem/time limits). Disabled by default.",
      category: "run_code",
      inputSchema: {
        command: { type: "string" },
        args: { type: "array", items: { type: "string" } },
      },
      async handler({ command, args = [] }) {
        // Shell is OFF by default - opt-in only, and only ever inside the sandbox.
        if (!isShellEnabled()) {
          throw new Error("[SANDBOX] Shell execution is disabled by default. Enable it explicitly (setShellEnabled / JARVIS_ENABLE_SHELL=1); it only ever runs inside a Docker sandbox.");
        }
        const res = runInSandbox(String(command), (args as string[]).map(String));
        if (res.error) throw new Error(`[SANDBOX] ${res.error}`);
        return { stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode, sandboxed: true };
      },
    },
  ],
};

/** Build the default MCP router with V1 built-in connectors */
export function buildDefaultRouter(): MCPRouter {
  const router = new MCPRouter();
  router.register(filesystemConnector);
  router.register(execConnector);
  router.register(screenConnector);
  return router;
}
