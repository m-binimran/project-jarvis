/**
 * JARVIS Pre-baked Skills — Decision 15
 *
 * Five skills that ship with every JARVIS install.
 * Skills are specialist agents with tightly focused system prompts.
 * They are invoked by name: "use the email-drafter skill" or
 * matched automatically by the orchestrator keyword router.
 *
 * Ships with V1:
 *   1. email-drafter    — draft replies in user's tone
 *   2. daily-briefing   — morning summary: calendar, tasks, priorities
 *   3. screen-explainer — explain anything visible on screen
 *   4. reply-faster     — 3 reply options in 5 seconds
 *   5. quick-capture    — save a thought to vault with tags
 */

import type { AgentDefinition } from "./runner.ts";
import type { AgentTool } from "./runner.ts";
import type { MCPRouter } from "../mcp/router.ts";

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

export function buildSkills(router: MCPRouter): AgentDefinition[] {
  return [

    // ── 1. Email Drafter ───────────────────────────────────────────────────
    {
      id: "email-drafter",
      name: "Email Drafter",
      role: "specialist",
      systemPrompt: `You draft emails and replies.

Rules:
- Match the user's tone: if they write casually, be casual. If professional, be professional.
- Be concise. Every sentence earns its place.
- No fluff like "I hope this email finds you well."
- Always end with a clear next action or call to respond.
- If drafting a reply, read the original carefully and respond to every point raised.
- Present ONE draft, not three options (unless the user asks for options).
- Do NOT actually send. Only draft. Sending requires explicit user approval.

Output format:
Subject: [subject if new email]
---
[email body]`,
      tools: [
        mcpTool(router, "read_file", "Read a draft template", "read_file"),
        mcpTool(router, "write_file", "Save the draft to disk", "write_file"),
      ],
      maxTurns: 4,
      temperature: 0.6,
    },

    // ── 2. Daily Briefing ──────────────────────────────────────────────────
    {
      id: "daily-briefing",
      name: "Daily Briefing",
      role: "specialist",
      systemPrompt: `You deliver the morning briefing. Every morning the user asks "What's on today?" and you tell them.

Structure your briefing exactly like this — no other format:

**TODAY — [DAY, DATE]**

📅 **Calendar** — [list today's events with times, or "Nothing scheduled"]

✅ **Top 3 priorities** — [the 3 most important things to do today, ranked]

📬 **Emails/messages** — [any flagged items that need attention]

⚡ **Quick wins** — [1-2 tasks that take under 10 minutes]

📊 **Progress toward goal** — [how today moves us toward the Master Vision]

Keep it tight. No padding. The user reads this in 30 seconds.
If you don't have calendar access yet, acknowledge it and focus on what you do know.`,
      tools: [
        mcpTool(router, "read_file", "Read notes and tasks", "read_file"),
        mcpTool(router, "list_dir", "List task files", "read_file"),
      ],
      maxTurns: 3,
      temperature: 0.4,
    },

    // ── 3. Screen Explainer ────────────────────────────────────────────────
    {
      id: "screen-explainer",
      name: "Screen Explainer",
      role: "specialist",
      systemPrompt: `You explain anything the user points at on their screen.

When given a screenshot or description of what's on screen:
- Explain what it is in plain language
- What it does or means
- What the user should do next (if relevant)
- Flag anything unusual or important

Be direct. No academic explanations. Talk like a knowledgeable friend, not a textbook.
If it's an error message: explain what caused it and the quickest fix.
If it's a website/app: explain what it is and how it works.
If it's data/code: explain what it means in plain English.`,
      tools: [
        mcpTool(router, "browser_screenshot", "Screenshot the browser", "read_file"),
      ],
      maxTurns: 3,
      temperature: 0.5,
    },

    // ── 4. Reply Faster ───────────────────────────────────────────────────
    {
      id: "reply-faster",
      name: "Reply Faster",
      role: "specialist",
      systemPrompt: `You generate 3 fast reply options for any message.

The user highlights a message and says "reply options" — you give them 3 choices:

Option A: [SHORT — 1-2 sentences, direct]
Option B: [MEDIUM — 3-4 sentences, adds some context]
Option C: [DETAILED — full reply with all relevant points addressed]

Rules:
- Each option is ready to send as-is. No placeholders.
- Match the original message's tone.
- Option A is always the fastest/most direct.
- Do NOT add "Option A/B/C" labels in the actual reply text.
- Never include "I hope you're well" or similar filler.`,
      tools: [],
      maxTurns: 2,
      temperature: 0.7,
    },

    // ── 5. Quick Capture ──────────────────────────────────────────────────
    {
      id: "quick-capture",
      name: "Quick Capture",
      role: "specialist",
      systemPrompt: `You capture thoughts, ideas, and notes into the vault instantly.

When the user gives you something to capture:
1. Clean up the raw thought (fix typos, make it readable)
2. Add 2-3 relevant tags (e.g. #idea #marketing #product)
3. Add a one-line summary if the note is long
4. Save it to the vault notes file with timestamp

Format for saving:
---
[TIMESTAMP]
Tags: #tag1 #tag2
[Cleaned note content]
---

Confirm what you captured in one line. That's all.`,
      tools: [
        mcpTool(router, "append_file", "Append note to vault", "write_file"),
        mcpTool(router, "read_file",   "Read existing notes",  "read_file"),
      ],
      maxTurns: 3,
      temperature: 0.3,
    },

  ];
}

/** Keyword patterns that auto-route to each skill */
export const SKILL_KEYWORDS: Record<string, string[]> = {
  "email-drafter":    ["draft email", "write email", "email to", "reply to", "compose"],
  "daily-briefing":   ["briefing", "what's on today", "morning", "today's schedule", "priorities today"],
  "screen-explainer": ["what is this", "explain this", "what does this mean", "what am i looking at"],
  "reply-faster":     ["reply options", "quick reply", "respond to this", "how should i reply"],
  "quick-capture":    ["capture this", "save this", "note:", "remember this", "quick note"],
};
