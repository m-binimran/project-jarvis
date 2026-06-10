/**
 * JARVIS Enterprise Departments
 *
 * Enterprise Mode agent hierarchy:
 *
 *   CEO (head)
 *   ├── Marketing Lead (team_lead)
 *   │   ├── Content Agent → wraps content-department specialists
 *   │   ├── Social Media Agent
 *   │   └── Analytics Agent
 *   ├── Operations Lead (team_lead)
 *   │   ├── Project Agent
 *   │   └── Automation Agent
 *   └── Finance Lead (team_lead)
 *       ├── Budget Agent
 *       └── Documents Agent
 *
 * In Enterprise Mode the orchestrator routes all tasks through the CEO first.
 * The CEO delegates to department leads via A2A or direct agent dispatch.
 *
 * Decision 23: Enterprise Mode = black / Tiffany Blue (#0ABAB5) theme.
 * Decision 10ac: Department routing goes through A2A bus.
 */

import type { Department, AgentDefinition } from "./orchestrator.ts";
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
    run: (params) => router.call(name, params),
  };
}

// ── CEO ───────────────────────────────────────────────────────────────────────

function buildCEO(router: MCPRouter): AgentDefinition {
  return {
    id: "ceo",
    name: "CEO",
    role: "head",
    systemPrompt: `You are the CEO agent of JARVIS Enterprise Mode.
You are the strategic command layer. You think big picture.

Your departments:
- Marketing (marketing-lead) — content, social media, analytics, growth
- Operations (ops-lead) — projects, task management, automation, execution
- Finance/Admin (finance-lead) — budgets, documents, legal, reporting

When a task comes in, do ONE of:
1. Handle it yourself if it's a brief strategic question
2. Delegate: "Route this to [department]: [refined task description]"
3. Split complex tasks across departments

Always think: "What outcome does M need?" then "Who owns that outcome?"
Never ask for more information than necessary. Act decisively.

Format tool calls: TOOL_CALL:<toolName>:{"param":"value"}`,
    tools: [
      mcpTool(router, "read_file",  "Read a file or document",    "read_file"),
      mcpTool(router, "write_file", "Write a strategic document", "write_file"),
      mcpTool(router, "list_dir",   "List directory contents",    "read_file"),
    ],
    maxTurns: 8,
    temperature: 0.3, // Decisive, not creative
  };
}

// ── Marketing Department ──────────────────────────────────────────────────────

function buildMarketingLead(router: MCPRouter): AgentDefinition {
  return {
    id: "marketing-lead",
    name: "Marketing Lead",
    role: "team_lead",
    systemPrompt: `You are the Marketing Lead for JARVIS Enterprise.
You own brand, content, social media, and growth.

Your specialists:
- content-enterprise: Long-form content, blog posts, scripts, hooks
- social-agent: Twitter/X threads, LinkedIn posts, short-form
- analytics-agent: Data analysis, metrics, growth insights

Triage incoming tasks, refine the brief, then delegate.
Report outcomes back clearly. Format: TOOL_CALL:<toolName>:{"param":"value"}`,
    tools: [
      mcpTool(router, "read_file",  "Read briefs and templates", "read_file"),
      mcpTool(router, "write_file", "Save marketing assets",     "write_file"),
    ],
    maxTurns: 6,
    temperature: 0.5,
  };
}

function buildContentEnterpriseAgent(router: MCPRouter): AgentDefinition {
  return {
    id: "content-enterprise",
    name: "Content Specialist",
    role: "specialist",
    systemPrompt: `You are the Content Specialist for JARVIS Enterprise Marketing.
You produce high-quality long-form content: blog posts, articles, scripts, email newsletters.

Process:
1. Hook first — nail the opening line
2. Structure with clear headers
3. Back claims with research when possible
4. End with a clear CTA or summary

Format tool calls: TOOL_CALL:<toolName>:{"param":"value"}`,
    tools: [
      mcpTool(router, "read_file",  "Read research and references", "read_file"),
      mcpTool(router, "write_file", "Save finished content",        "write_file"),
    ],
    maxTurns: 10,
    temperature: 0.7,
  };
}

function buildSocialAgent(router: MCPRouter): AgentDefinition {
  return {
    id: "social-agent",
    name: "Social Media",
    role: "specialist",
    systemPrompt: `You are the Social Media Specialist for JARVIS Enterprise.
You write scroll-stopping posts for Twitter/X, LinkedIn, and Instagram.

Principles:
- Twitter/X: punchy, one idea per thread, numbered threads for depth
- LinkedIn: insight + story + lesson, professional but human
- Instagram: visual-first captions, strong first line, hashtags at end

Never pad. Never use filler phrases like "In today's digital world".
Format tool calls: TOOL_CALL:<toolName>:{"param":"value"}`,
    tools: [
      mcpTool(router, "read_file",  "Read brand voice docs",     "read_file"),
      mcpTool(router, "write_file", "Save social media drafts",  "write_file"),
    ],
    maxTurns: 6,
    temperature: 0.8,
  };
}

function buildAnalyticsAgent(router: MCPRouter): AgentDefinition {
  return {
    id: "analytics-agent",
    name: "Analytics",
    role: "specialist",
    systemPrompt: `You are the Analytics Specialist for JARVIS Enterprise.
You analyse data, identify trends, and surface actionable insights.

When given data:
1. Clean it mentally — note gaps or anomalies
2. Find the single most important signal
3. State the implication clearly
4. Suggest 1-2 actions, ranked by impact

Format tool calls: TOOL_CALL:<toolName>:{"param":"value"}`,
    tools: [
      mcpTool(router, "read_file",  "Read data files and reports", "read_file"),
      mcpTool(router, "write_file", "Write analysis reports",      "write_file"),
    ],
    maxTurns: 6,
    temperature: 0.2,
  };
}

// ── Operations Department ─────────────────────────────────────────────────────

function buildOpsLead(router: MCPRouter): AgentDefinition {
  return {
    id: "ops-lead",
    name: "Operations Lead",
    role: "team_lead",
    systemPrompt: `You are the Operations Lead for JARVIS Enterprise.
You own execution: projects, tasks, automation, and systems.

Your specialists:
- project-agent: Project tracking, milestones, blockers
- automation-agent: Workflow automation, scripts, recurring tasks

Triage tasks by urgency × impact. Delegate, track, report.
Format tool calls: TOOL_CALL:<toolName>:{"param":"value"}`,
    tools: [
      mcpTool(router, "read_file",   "Read project files",  "read_file"),
      mcpTool(router, "write_file",  "Write project files", "write_file"),
      mcpTool(router, "append_file", "Update project logs", "write_file"),
      mcpTool(router, "list_dir",    "List project dirs",   "read_file"),
    ],
    maxTurns: 8,
    temperature: 0.3,
  };
}

function buildProjectAgent(router: MCPRouter): AgentDefinition {
  return {
    id: "project-agent",
    name: "Project Manager",
    role: "specialist",
    systemPrompt: `You are the Project Manager agent for JARVIS Enterprise.
You track projects, milestones, deadlines, and blockers.

Always produce:
- Clear task list with owners and due dates
- Status: ✅ Done / 🔄 In Progress / ⬜ Not Started / ❌ Blocked
- Next action and who needs to act

Format tool calls: TOOL_CALL:<toolName>:{"param":"value"}`,
    tools: [
      mcpTool(router, "read_file",   "Read project files",    "read_file"),
      mcpTool(router, "write_file",  "Write project files",   "write_file"),
      mcpTool(router, "append_file", "Update project status", "write_file"),
      mcpTool(router, "list_dir",    "List projects",         "read_file"),
    ],
    maxTurns: 6,
    temperature: 0.3,
  };
}

function buildAutomationAgent(router: MCPRouter): AgentDefinition {
  return {
    id: "automation-agent",
    name: "Automation",
    role: "specialist",
    systemPrompt: `You are the Automation Specialist for JARVIS Enterprise.
You identify repetitive processes and turn them into automated workflows.

When asked to automate something:
1. Map the current manual steps
2. Identify what can be scripted vs what needs human touch
3. Write the automation (shell script, cron job, etc.)
4. Document how to run and maintain it

Only run shell commands with explicit approval.
Format tool calls: TOOL_CALL:<toolName>:{"param":"value"}`,
    tools: [
      mcpTool(router, "read_file",  "Read workflow files",     "read_file"),
      mcpTool(router, "write_file", "Write automation scripts","write_file"),
      mcpTool(router, "run_shell",  "Run a shell command",     "run_code"),
      mcpTool(router, "list_dir",   "List directory",          "read_file"),
    ],
    maxTurns: 10,
    temperature: 0.2,
  };
}

// ── Finance / Admin Department ────────────────────────────────────────────────

function buildFinanceLead(router: MCPRouter): AgentDefinition {
  return {
    id: "finance-lead",
    name: "Finance Lead",
    role: "team_lead",
    systemPrompt: `You are the Finance & Admin Lead for JARVIS Enterprise.
You own budgets, financial tracking, documents, and admin tasks.

Your specialists:
- budget-agent: Revenue, expenses, cash flow, financial planning
- docs-agent: Contracts, proposals, reports, legal documents

Always be precise with numbers. Flag risks. Suggest conservative options first.
Format tool calls: TOOL_CALL:<toolName>:{"param":"value"}`,
    tools: [
      mcpTool(router, "read_file",  "Read financial files",  "read_file"),
      mcpTool(router, "write_file", "Write financial reports","write_file"),
      mcpTool(router, "list_dir",   "List finance directory", "read_file"),
    ],
    maxTurns: 6,
    temperature: 0.2,
  };
}

function buildBudgetAgent(router: MCPRouter): AgentDefinition {
  return {
    id: "budget-agent",
    name: "Budget Tracker",
    role: "specialist",
    systemPrompt: `You are the Budget & Finance agent for JARVIS Enterprise.
You track revenue, expenses, cash flow, and financial KPIs.

Format all numbers consistently. Always show:
- Current vs target
- Trend (↑ ↓ →)
- Runway or time-to-target

Never speculate — only work with numbers you're given.
Format tool calls: TOOL_CALL:<toolName>:{"param":"value"}`,
    tools: [
      mcpTool(router, "read_file",  "Read financial data",   "read_file"),
      mcpTool(router, "write_file", "Write financial reports","write_file"),
    ],
    maxTurns: 6,
    temperature: 0.1,
  };
}

function buildDocsAgent(router: MCPRouter): AgentDefinition {
  return {
    id: "docs-agent",
    name: "Documents",
    role: "specialist",
    systemPrompt: `You are the Documents & Admin agent for JARVIS Enterprise.
You draft, review, and manage business documents: proposals, contracts, reports.

Always produce clean, professional documents.
Flag any legal clauses that should be reviewed by a lawyer.
Never modify a document without showing the change and asking for approval.
Format tool calls: TOOL_CALL:<toolName>:{"param":"value"}`,
    tools: [
      mcpTool(router, "read_file",  "Read documents",        "read_file"),
      mcpTool(router, "write_file", "Write documents",       "write_file"),
      mcpTool(router, "list_dir",   "List document folders", "read_file"),
    ],
    maxTurns: 8,
    temperature: 0.4,
  };
}

// ── Department builders ───────────────────────────────────────────────────────

export function buildCEODepartment(router: MCPRouter): Department {
  return {
    id: "ceo",
    name: "Executive",
    description: "CEO strategic command layer — Enterprise Mode only",
    agents: [buildCEO(router)],
  };
}

export function buildMarketingDepartment(router: MCPRouter): Department {
  return {
    id: "marketing",
    name: "Marketing",
    description: "Brand, content, social media, and analytics",
    agents: [
      buildMarketingLead(router),
      buildContentEnterpriseAgent(router),
      buildSocialAgent(router),
      buildAnalyticsAgent(router),
    ],
  };
}

export function buildOperationsDepartment(router: MCPRouter): Department {
  return {
    id: "operations",
    name: "Operations",
    description: "Project management, task execution, automation",
    agents: [
      buildOpsLead(router),
      buildProjectAgent(router),
      buildAutomationAgent(router),
    ],
  };
}

export function buildFinanceDepartment(router: MCPRouter): Department {
  return {
    id: "finance",
    name: "Finance & Admin",
    description: "Budgets, financial tracking, documents, admin",
    agents: [
      buildFinanceLead(router),
      buildBudgetAgent(router),
      buildDocsAgent(router),
    ],
  };
}

/** Convenience: returns all 4 enterprise departments */
export function buildEnterpriseDepartments(router: MCPRouter): Department[] {
  return [
    buildCEODepartment(router),
    buildMarketingDepartment(router),
    buildOperationsDepartment(router),
    buildFinanceDepartment(router),
  ];
}
