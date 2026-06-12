/**
 * Spec-compliant MCP (Model Context Protocol) — server side.
 *
 * Exposes the kernel's tools over real MCP JSON-RPC 2.0 so ANY MCP client
 * (Claude Desktop, IDEs, other harnesses) can use them. The point of difference:
 * every `tools/call` is routed through `router.call()` — the secure chokepoint —
 * so external MCP clients are authority-gated + written to the audit chain just
 * like everyone else. MCP, but secure-by-default. No bypass.
 *
 * Transport-agnostic: this module turns a parsed JSON-RPC message into a
 * response object. Wire it to HTTP (POST /mcp) or stdio in server.ts.
 *
 * Spec: https://spec.modelcontextprotocol.io (revision 2024-11-05).
 * Implemented by hand — no SDK dependency — to keep the kernel forkable & lean.
 */

import type { MCPRouter } from "./router.ts";

export const MCP_PROTOCOL_VERSION = "2024-11-05";

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// JSON-RPC standard error codes.
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

function ok(id: JsonRpcRequest["id"], result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, result };
}
function err(id: JsonRpcRequest["id"], code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

/** Wrap the router's flat field map into a proper JSON-Schema object. */
function toJsonSchema(inputSchema: Record<string, unknown>): Record<string, unknown> {
  return { type: "object", properties: inputSchema ?? {} };
}

/** Render an arbitrary tool result as MCP content blocks. */
function toContent(result: unknown): { type: "text"; text: string }[] {
  const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
  return [{ type: "text", text }];
}

export interface McpServerInfo {
  name: string;
  version: string;
}

/**
 * Handle one JSON-RPC message against the kernel's tool router.
 * Returns a response, or `null` for notifications (no id → no reply expected).
 * Never throws: tool failures and gate denials come back as MCP tool errors
 * (`result.isError = true`), protocol problems as JSON-RPC `error`.
 */
export async function handleMcpRequest(
  router: MCPRouter,
  msg: JsonRpcRequest,
  info: McpServerInfo = { name: "jarvis-kernel", version: "0.1.0" }
): Promise<JsonRpcResponse | null> {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return err(msg?.id ?? null, INVALID_REQUEST, "Invalid JSON-RPC 2.0 request");
  }

  // Notifications (no id) expect no response.
  const isNotification = msg.id === undefined || msg.id === null;

  switch (msg.method) {
    case "initialize":
      return ok(msg.id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: info,
      });

    case "notifications/initialized":
    case "initialized":
      return null; // notification — ack only

    case "ping":
      return ok(msg.id, {});

    case "tools/list":
      return ok(msg.id, {
        tools: router.listTools().map(t => ({
          name: t.name,
          description: t.description,
          inputSchema: toJsonSchema(t.inputSchema),
        })),
      });

    case "tools/call": {
      const params = msg.params ?? {};
      const name = params.name as string | undefined;
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      if (!name || typeof name !== "string") {
        return err(msg.id, INVALID_PARAMS, "tools/call requires a string 'name'");
      }
      try {
        // UNTRUSTED path on purpose: external MCP clients pass through the
        // secure chokepoint (authority gate + audit). No { trusted:true } here.
        const result = await router.call(name, args);
        return ok(msg.id, { content: toContent(result), isError: false });
      } catch (e) {
        // Gate denials / tool errors are MCP tool errors, not protocol errors.
        return ok(msg.id, {
          content: [{ type: "text", text: String(e instanceof Error ? e.message : e) }],
          isError: true,
        });
      }
    }

    default:
      if (isNotification) return null;
      return err(msg.id, METHOD_NOT_FOUND, `Unknown method: ${msg.method}`);
  }
}

/** Parse + dispatch a raw JSON string (for stdio/HTTP transports). */
export async function handleMcpRaw(
  router: MCPRouter,
  raw: string,
  info?: McpServerInfo
): Promise<JsonRpcResponse | null> {
  let msg: JsonRpcRequest;
  try {
    msg = JSON.parse(raw);
  } catch {
    return err(null, PARSE_ERROR, "Parse error");
  }
  return handleMcpRequest(router, msg, info);
}
