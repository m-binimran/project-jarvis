/**
 * JARVIS Default Departments & Agents
 *
 * Defines the V1 agent roster.
 * All agents start dormant — zero token cost until dispatched.
 *
 * Tools are wired to the MCPRouter — no stubs.
 * The router is injected at boot via buildDepartments().
 */

import type { Department, AgentDefinition } from "./orchestrator.ts";
import type { AgentTool } from "./runner.ts";
import type { MCPRouter } from "../mcp/router.ts";

// ── Tool factory — wraps MCPRouter.call() into an AgentTool ───────────────

function mcpTool(
  router: MCPRouter,
  name: string,
  description: string,
  category: AgentTool["category"]
): AgentTool {
  return {
    name,
    description,
    category,
    run: (params) => router.call(name, params, { trusted: true }),
  };
}

// ── Agent definitions (built with live router) ────────────────────────────

function buildJarvisHead(router: MCPRouter): AgentDefinition {
  return {
    id: "jarvis",
    name: "JARVIS",
    systemPrompt: `You are JARVIS — a personal AI operating system.
You are precise, honest, and proactively helpful. You are not a chatbot — you execute tasks.

TOOL CALL format: TOOL_CALL:<toolName>:{"param":"value"}
HANDOFF format:   HANDOFF:<agentId>:<what you need from them>
ESCALATE format:  ESCALATE:<agentId>:<why you need their help>

When to hand off:
- Research needed → HANDOFF:research-agent:<what to find>
- Email/comms needed → HANDOFF:comms-agent:<what to draft>
- Code needed → HANDOFF:code-agent:<what to build>
- File work needed → HANDOFF:fs-agent:<what to do>
- Calendar needed → HANDOFF:calendar-agent:<what to check>

When the user wants ADVICE, consult a mentor advisor (they answer using that person's real frameworks) and relay their answer:
- Offers, sales, pricing, scaling a business → HANDOFF:advisor-hormozi:<the question>
- Wealth, leverage, focus, life philosophy → HANDOFF:advisor-naval:<the question>
- Startups, growth, product, fundraising → HANDOFF:advisor-graham:<the question>
Pick the most relevant advisor yourself, or if it's unclear, ask the user which advisor they'd like. After they answer, weave their advice into your reply.

Circuit breakers — ALWAYS ask before: deleting files, sending any message, making purchases, accessing credentials.

For web tasks: use browser_navigate to open a page, browser_extract to read content, browser_click/browser_type to interact.`,
    tools: [
      mcpTool(router, "read_file",          "Read a file from disk",           "read_file"),
      mcpTool(router, "write_file",         "Write content to a file",         "write_file"),
      mcpTool(router, "list_dir",           "List files in a directory",       "read_file"),
      mcpTool(router, "run_shell",          "Run a shell command",             "run_code"),
      mcpTool(router, "append_file",        "Append content to a file",        "write_file"),
      mcpTool(router, "browser_navigate",   "Open any URL in browser",         "read_file"),
      mcpTool(router, "browser_click",      "Click element on page",           "write_file"),
      mcpTool(router, "browser_type",       "Type into input field",           "write_file"),
      mcpTool(router, "browser_extract",    "Extract text from page",          "read_file"),
      mcpTool(router, "browser_screenshot", "Screenshot current page",         "read_file"),
      mcpTool(router, "browser_wait",       "Wait for element or time",        "read_file"),
      mcpTool(router, "browser_scroll",     "Scroll the page",                 "read_file"),
    ],
    model: "meta/llama-3.1-8b-instruct",  // fast 8B for snappy chat; heavy work is delegated to the 70B specialist agents
    reflect: false,        // skip the self-review call — JARVIS should answer instantly
    maxTurns: 15,
  };
}

function buildResearchAgent(router: MCPRouter): AgentDefinition {
  return {
    id: "research-agent",
    name: "Research",
    systemPrompt: `You are the Research agent for JARVIS.
Find information, summarize sources, extract key facts from anywhere.
Use the browser to research websites, competitors, prices, news — anything.
Format tool calls: TOOL_CALL:<toolName>:{"param":"value"}

Research process:
1. Navigate to relevant sources
2. Extract the content
3. Synthesise into clear findings
4. Always cite where the information came from`,
    tools: [
      mcpTool(router, "read_file",          "Read a file",              "read_file"),
      mcpTool(router, "list_dir",           "List a directory",         "read_file"),
      mcpTool(router, "browser_navigate",   "Open a website",           "read_file"),
      mcpTool(router, "browser_extract",    "Extract page content",     "read_file"),
      mcpTool(router, "browser_screenshot", "Screenshot a page",        "read_file"),
      mcpTool(router, "browser_scroll",     "Scroll to load more",      "read_file"),
      mcpTool(router, "browser_wait",       "Wait for page to load",    "read_file"),
    ],
    maxTurns: 12,
  };
}

function buildTaskAgent(router: MCPRouter): AgentDefinition {
  return {
    id: "task-agent",
    name: "Task Manager",
    systemPrompt: `You are the Task Management agent for JARVIS.
Create, update, and prioritize tasks. Track projects. Suggest next actions.
Read and write task files. Do NOT send messages or emails.
Format tool calls: TOOL_CALL:<toolName>:{"param":"value"}`,
    tools: [
      mcpTool(router, "read_file",   "Read a file",          "read_file"),
      mcpTool(router, "write_file",  "Write a file",         "write_file"),
      mcpTool(router, "append_file", "Append to a file",     "write_file"),
      mcpTool(router, "list_dir",    "List a directory",     "read_file"),
    ],
    maxTurns: 6,
  };
}

function buildCommsAgent(router: MCPRouter): AgentDefinition {
  return {
    id: "comms-agent",
    name: "Communications",
    systemPrompt: `You are the Communications agent for JARVIS.
DRAFT emails and messages. NEVER send without explicit user approval.
Always show the draft and ask "Shall I send this?" before using any send tool.
Format tool calls: TOOL_CALL:<toolName>:{"param":"value"}`,
    tools: [
      // Drafting = reads a template file, circuit breakers handle sending
      mcpTool(router, "read_file",  "Read a draft template",      "read_file"),
      mcpTool(router, "write_file", "Save a draft to disk",       "write_file"),
    ],
    maxTurns: 6,
  };
}

function buildFsAgent(router: MCPRouter): AgentDefinition {
  return {
    id: "fs-agent",
    name: "File System",
    systemPrompt: `You are the File System agent for JARVIS.
Read, write, and organize files. NEVER delete without explicit user approval.
Format tool calls: TOOL_CALL:<toolName>:{"param":"value"}`,
    tools: [
      mcpTool(router, "read_file",   "Read a file",          "read_file"),
      mcpTool(router, "write_file",  "Write a file",         "write_file"),
      mcpTool(router, "append_file", "Append to a file",     "write_file"),
      mcpTool(router, "list_dir",    "List a directory",     "read_file"),
      mcpTool(router, "delete_file", "Delete a file",        "delete_file"),
    ],
    maxTurns: 8,
  };
}

function buildCalendarAgent(router: MCPRouter): AgentDefinition {
  return {
    id: "calendar-agent",
    name: "Calendar",
    systemPrompt: `You are the Calendar agent for JARVIS.
Check schedules, suggest times, create events.
Always confirm before writing to calendar.
Format tool calls: TOOL_CALL:<toolName>:{"param":"value"}`,
    tools: [
      mcpTool(router, "read_file",  "Read calendar data",   "read_file"),
      mcpTool(router, "write_file", "Write calendar event", "calendar_write"),
    ],
    maxTurns: 4,
  };
}

function buildCodeAgent(router: MCPRouter): AgentDefinition {
  return {
    id: "code-agent",
    name: "Code",
    systemPrompt: `You are the Code agent for JARVIS.
Write, debug, and explain code. Run scripts when asked.
Always show code before executing. Explain what it does first.
Format tool calls: TOOL_CALL:<toolName>:{"param":"value"}`,
    tools: [
      mcpTool(router, "read_file",  "Read a file",          "read_file"),
      mcpTool(router, "write_file", "Write a file",         "write_file"),
      mcpTool(router, "list_dir",   "List a directory",     "read_file"),
      mcpTool(router, "run_shell",  "Run a shell command",  "run_code"),
    ],
    maxTurns: 15,
  };
}

// ── Department builder — call this with the live router at boot ───────────

export function buildPersonalDepartment(router: MCPRouter): Department {
  return {
    id: "personal",
    name: "Personal",
    description: "M's everyday personal AI — Basic Mode",
    agents: [
      buildJarvisHead(router),
      buildResearchAgent(router),
      buildTaskAgent(router),
      buildCommsAgent(router),
      buildFsAgent(router),
      buildCalendarAgent(router),
      buildCodeAgent(router),
    ],
  };
}

// Keep ALL_DEPARTMENTS for legacy import compatibility —
// this version has no router (tools return stubs), only used if buildDepartments() isn't called
import { buildDefaultRouter } from "../mcp/router.ts";

const _fallbackRouter = buildDefaultRouter();

export const ALL_DEPARTMENTS: Department[] = [
  buildPersonalDepartment(_fallbackRouter),
];
