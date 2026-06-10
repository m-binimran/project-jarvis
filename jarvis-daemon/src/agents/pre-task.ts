/**
 * Pre-Task Skill Acquisition — Decision 20
 *
 * Before executing any complex task, JARVIS checks whether it has the
 * right skills and MCPs to do it properly. If gaps are found, it asks
 * the user before starting.
 *
 * The sequence:
 * 1. User gives JARVIS a complex task
 * 2. JARVIS analyses what it requires
 * 3. Checks current tools against the task
 * 4. Identifies gaps
 * 5. Reports gaps — user decides whether to proceed
 */

import type { MCPRouter } from "../mcp/router.ts";
import type { LLMManager } from "../llm/manager.ts";

export interface PreTaskCheck {
  ready: boolean;
  gaps: string[];
  suggestions: string[];
  recommendation: string;
}

// Keyword → required tool mappings
const TOOL_REQUIREMENTS: Array<{ keywords: string[]; tools: string[]; suggestion: string }> = [
  {
    keywords: ["email", "gmail", "inbox", "send email", "reply to"],
    tools: ["list_emails", "send_email"],
    suggestion: "Connect Gmail — POST /api/auth/google/creds with your OAuth credentials",
  },
  {
    keywords: ["calendar", "schedule", "meeting", "appointment"],
    tools: ["list_calendar_events", "create_calendar_event"],
    suggestion: "Connect Google Calendar — POST /api/auth/google/creds",
  },
  {
    keywords: ["browse", "website", "search online", "look up", "navigate to", "open url"],
    tools: ["browser_navigate", "browser_extract"],
    suggestion: "Browser tools are available — Playwright is installed",
  },
  {
    keywords: ["linkedin", "post on linkedin", "linkedin content"],
    tools: ["browser_navigate"],
    suggestion: "Use browser tools to post on LinkedIn manually — no MCP needed",
  },
  {
    keywords: ["instagram", "post on instagram"],
    tools: ["browser_navigate"],
    suggestion: "Use browser tools for Instagram — log in via browser_navigate",
  },
  {
    keywords: ["code", "script", "run code", "execute"],
    tools: ["run_shell"],
    suggestion: "Shell executor is available",
  },
  {
    keywords: ["file", "read file", "write file", "folder"],
    tools: ["read_file", "write_file"],
    suggestion: "File system tools are available",
  },
];

export function preTaskCheck(userMessage: string, router: MCPRouter): PreTaskCheck {
  const lower = userMessage.toLowerCase();
  const availableTools = new Set(router.listTools().map(t => t.name));
  const gaps: string[] = [];
  const suggestions: string[] = [];

  for (const req of TOOL_REQUIREMENTS) {
    const mentionsThis = req.keywords.some(kw => lower.includes(kw));
    if (!mentionsThis) continue;

    const missingTools = req.tools.filter(t => !availableTools.has(t));
    if (missingTools.length > 0) {
      gaps.push(`Missing: ${missingTools.join(", ")} (needed for ${req.keywords[0]})`);
      suggestions.push(req.suggestion);
    }
  }

  const ready = gaps.length === 0;

  return {
    ready,
    gaps,
    suggestions,
    recommendation: ready
      ? "All required tools are available. Ready to proceed."
      : `${gaps.length} tool gap(s) detected. You can still proceed — JARVIS will work around what's missing.`,
  };
}
