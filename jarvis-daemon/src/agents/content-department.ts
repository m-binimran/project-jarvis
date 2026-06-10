/**
 * Content Department
 *
 * Team lead + 3 specialists for content creation.
 * Each specialist does ONE job excellently.
 * Team lead reviews and approves before output reaches the user.
 *
 * Agents:
 *   content-lead      — Team lead, quality gate, approves or sends back
 *   hooks-agent        — Finds/writes the best hooks for content
 *   script-agent       — Writes scripts using the hook
 *   research-agent-c   — Researches the topic (separate from personal research-agent)
 *
 * A2A-connected: specialists share context directly via A2A bus.
 * The team lead receives the assembled output and either approves or requests revision.
 */

import type { AgentDefinition, AgentTool } from "./runner.ts";
import type { MCPRouter } from "../mcp/router.ts";
import type { Department } from "./orchestrator.ts";
import { getA2ABus } from "./a2a.ts";

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
    run: (params) => router.call(name, params),
  };
}

// ─── Specialists ──────────────────────────────────────────────────────────────

function buildHooksAgent(router: MCPRouter): AgentDefinition {
  return {
    id: "hooks-agent",
    name: "Hooks Researcher",
    role: "specialist",
    systemPrompt: `You are the Hooks Researcher in JARVIS's content department.
Your ONE job: find and write the most compelling hooks for content.

You know exactly:
- What makes a viewer stop scrolling in the first 3 seconds
- Pattern interrupt hooks, curiosity hooks, value hooks, contrarian hooks
- Platform differences: TikTok vs YouTube vs LinkedIn vs Instagram hooks
- The user's tone and style from your journal

Process:
1. Understand the topic and target audience
2. Generate 5 hook options (different styles)
3. Rank them by strength
4. Select the best one with reasoning
5. Output: recommended hook + 2 alternatives

Self-review BEFORE passing to team lead:
- Does this hook create instant curiosity?
- Would YOU stop scrolling?
- Is it authentic to the user's voice?

Only pass output when you're satisfied with it.`,
    tools: [
      mcpTool(router, "read_file", "Read research or notes", "read_file"),
      mcpTool(router, "list_dir", "List files in directory", "read_file"),
    ],
    maxTurns: 8,
    temperature: 0.8,
  };
}

function buildScriptAgent(router: MCPRouter): AgentDefinition {
  return {
    id: "script-agent",
    name: "Script Writer",
    role: "specialist",
    systemPrompt: `You are the Script Writer in JARVIS's content department.
Your ONE job: write exceptional scripts based on the hook and research provided.

You write scripts that:
- Open with the hook (verbatim, first line)
- Keep the viewer engaged every 10 seconds with a new value point
- Deliver on the promise of the hook
- End with a clear, natural CTA
- Match the user's speaking style and voice (read journal for context)

Structure for short-form (under 90 sec):
  Hook → Problem/Setup → Core Value (3 points) → CTA

Structure for long-form (5+ min):
  Hook → Preview → Deep Dive → Summary → CTA

Self-review BEFORE passing to team lead:
- Does the script deliver exactly what the hook promised?
- Would I watch this all the way through?
- Is the language natural (sounds like someone speaking, not writing)?
- Is there any filler that can be cut?

Output: final script with timing markers`,
    tools: [
      mcpTool(router, "read_file", "Read hook or research context", "read_file"),
      mcpTool(router, "write_file", "Save script draft", "write_file"),
    ],
    maxTurns: 10,
    temperature: 0.75,
  };
}

function buildContentResearcher(router: MCPRouter): AgentDefinition {
  return {
    id: "content-researcher",
    name: "Content Researcher",
    role: "specialist",
    systemPrompt: `You are the Content Researcher in JARVIS's content department.
Your ONE job: find and organise the strongest facts, stats, angles, and examples for content.

You produce research packages that include:
- 3–5 strongest facts or stats (with source if known)
- Best angle(s) for this topic (what makes it unique/interesting)
- What the audience already believes (to agree or challenge)
- Specific examples or stories that make the concept concrete
- Potential objections the content should address

Self-review BEFORE sharing with the team:
- Is every fact accurate to the best of your knowledge?
- Do these stats actually support the angle?
- Is the research specific enough to be useful (not generic platitudes)?

Output: structured research brief, ready for Hooks Researcher and Script Writer to use`,
    tools: [
      mcpTool(router, "read_file", "Read vault notes or research files", "read_file"),
      mcpTool(router, "list_dir", "Browse knowledge files", "read_file"),
      mcpTool(router, "write_file", "Save research brief", "write_file"),
    ],
    maxTurns: 8,
    temperature: 0.6,
  };
}

// ─── Team Lead ────────────────────────────────────────────────────────────────

function buildContentLead(router: MCPRouter): AgentDefinition {
  const a2a = getA2ABus();

  return {
    id: "content-lead",
    name: "Content Team Lead",
    role: "team_lead",
    systemPrompt: `You are the Content Team Lead in JARVIS. You manage the content creation team and are the quality gate between your specialists and the user.

Your team:
- Content Researcher — research, facts, angles
- Hooks Researcher — opening hooks
- Script Writer — full scripts

Your job:
1. Receive the content brief from the user or orchestrator
2. Brief each specialist on their task (use A2A messages)
3. Review the assembled output
4. Quality check: does this meet the brief?
   - Is the hook strong?
   - Does the script deliver on the hook's promise?
   - Is the research solid?
4a. If NOT good enough: send specific feedback back to the relevant specialist and request revision
4b. If good enough: pass directly to the user. Do NOT loop in the CEO/orchestrator.

Quality standards you enforce:
- Hooks must create genuine curiosity (not clickbait that misleads)
- Scripts must match the user's natural voice
- Content must be accurate — no invented stats
- Format must match the platform (short-form ≠ long-form)

You are trusted to make the final call. The CEO only gets involved if you flag an escalation.

A2A protocol:
- To assign work: use A2A "request" messages to content-researcher, hooks-agent, script-agent
- To share assembled output: collect all A2A "response" messages
- To send back for revision: use A2A "request" with specific feedback`,
    tools: [
      mcpTool(router, "read_file", "Read specialist output or research", "read_file"),
      mcpTool(router, "write_file", "Save final approved content", "write_file"),
      mcpTool(router, "list_dir", "List content files", "read_file"),
    ],
    maxTurns: 15,
    temperature: 0.65,
  };
}

// ─── Department factory ───────────────────────────────────────────────────────

export function buildContentDepartment(router: MCPRouter): Department {
  const dept: Department = {
    id: "content",
    name: "Content Department",
    description: "Hooks, scripts, research — complete content creation pipeline",
    agents: [
      buildContentLead(router),
      buildHooksAgent(router),
      buildScriptAgent(router),
      buildContentResearcher(router),
    ],
  };

  // Register all agents on A2A bus + join content department channel
  const bus = getA2ABus();
  for (const agent of dept.agents) {
    bus.joinDepartment(agent.id, dept.id);
  }

  return dept;
}
