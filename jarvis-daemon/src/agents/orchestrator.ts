/**
 * JARVIS Orchestrator
 *
 * Manages the department/agent hierarchy.
 * Routes tasks to the right agent.
 * Keeps dormant agents at zero token cost.
 * Wakes agents on demand, returns them to sleep after idle timeout.
 *
 * Department structure:
 *   JARVIS (head) → Team Leads → Specialist Agents
 *
 * Dormant = instantiated but not given any messages.
 * Active = currently processing a task.
 */

import { AgentRunner, type AgentDefinition, type RunResult } from "./runner.ts";
import { listAdvisors, buildAdvisorAgent } from "./advisor-council.ts";
export type { AgentDefinition };
import type { LLMManager } from "../llm/manager.ts";
import { SKILL_KEYWORDS } from "./skills.ts";
import { AuthorityEngine } from "../authority/engine.ts";
import { getAuditTrail } from "../authority/audit.ts";
import { getDb, generateId, now } from "../vault/schema.ts";
import { getA2ABus } from "./a2a.ts";

export interface Department {
  id: string;
  name: string;
  description: string;
  agents: AgentDefinition[];
}

/**
 * A visible message in the multi-agent conversation. Emitted by the orchestrator
 * at each handoff boundary so a presentation layer (e.g. the Slack workspace) can
 * render agents talking to each other under their own identities. Purely a
 * presentation hook — the orchestrator works fine when no handler is supplied.
 */
export interface AgentMessageEvent {
  /** Agent id that is "speaking". */
  from: string;
  /** Agent id being addressed (for a handoff/response), or null. */
  to?: string | null;
  /** What kind of beat this is in the conversation. */
  kind: "handoff" | "escalate" | "response" | "note" | "final";
  /** Short headline for the beat (the ask, or "Re: …"). */
  subject?: string;
  /** The actual content. */
  text: string;
}

export interface TaskRequest {
  userMessage: string;
  conversationId?: string;
  preferredAgentId?: string;
  /** Circuit-breaker approval gate. `agentId` is the agent that triggered it. */
  onApprovalNeeded?: (action: string, context: string, agentId?: string) => Promise<boolean>;
  onStream?: (delta: string) => void;
  /** Called at each handoff boundary so a UI can show agents conversing. */
  onAgentMessage?: (msg: AgentMessageEvent) => void | Promise<void>;
}

export class Orchestrator {
  private departments = new Map<string, Department>();
  private runners = new Map<string, AgentRunner>();
  private authority: AuthorityEngine;
  private audit = getAuditTrail();
  private enterpriseMode = false;

  private llm: LLMManager;

  constructor(
    llm: LLMManager,
    authority?: AuthorityEngine
  ) {
    this.llm = llm;
    this.authority = authority ?? new AuthorityEngine("productive");
  }

  registerDepartment(dept: Department): void {
    this.departments.set(dept.id, dept);
  }

  private getOrCreateRunner(agent: AgentDefinition): AgentRunner {
    if (!this.runners.has(agent.id)) {
      this.runners.set(
        agent.id,
        new AgentRunner(agent, this.llm, this.authority)
      );
    }
    return this.runners.get(agent.id)!;
  }

  private findAgent(agentId: string): AgentDefinition | null {
    for (const dept of this.departments.values()) {
      const found = dept.agents.find(a => a.id === agentId);
      if (found) return found;
    }
    return null;
  }

  private findBestAgent(message: string): AgentDefinition | null {
    // Enterprise Mode: all tasks start at CEO
    if (this.enterpriseMode) {
      const ceo = this.findAgent("ceo");
      if (ceo) return ceo;
    }

    // Simple keyword routing — will be improved with embeddings later
    const lower = message.toLowerCase();

    // Check pre-baked skills first (Decision 15)
    for (const [skillId, keywords] of Object.entries(SKILL_KEYWORDS)) {
      if (keywords.some(kw => lower.includes(kw))) {
        const agent = this.findAgent(skillId);
        if (agent) return agent;
      }
    }

    const routingRules: [string[], string][] = [
      [["email", "send", "reply", "inbox", "gmail"], "comms-agent"],
      [["calendar", "meeting", "schedule", "remind"], "calendar-agent"],
      [["file", "read", "write", "folder", "document"], "fs-agent"],
      [["code", "debug", "function", "script", "build"], "code-agent"],
      [["search", "find", "look up", "who is", "what is"], "research-agent"],
      [["task", "todo", "plan", "project"], "task-agent"],
      // Enterprise routing — only active when enterprise departments are registered
      [["content", "blog", "article", "newsletter"], "content-enterprise"],
      [["social", "tweet", "linkedin", "instagram", "post"], "social-agent"],
      [["analytics", "metrics", "data", "kpi", "growth"], "analytics-agent"],
      [["marketing", "brand", "campaign"], "marketing-lead"],
      [["automation", "workflow", "automate", "script"], "automation-agent"],
      [["operations", "ops", "process", "system"], "ops-lead"],
      [["budget", "revenue", "expense", "finance", "money"], "budget-agent"],
      [["contract", "proposal", "report", "document"], "docs-agent"],
    ];

    for (const [keywords, agentId] of routingRules) {
      if (keywords.some(kw => lower.includes(kw))) {
        const agent = this.findAgent(agentId);
        if (agent) return agent;
      }
    }

    // Fall back to JARVIS head agent
    return this.findAgent("jarvis") ?? null;
  }

  async dispatch(req: TaskRequest): Promise<RunResult & { agentId: string }> {
    // Create a task record
    const taskId = generateId();
    const db = getDb();

    try {
      db.run(
        `INSERT INTO tasks(id,title,status,created_at,updated_at) VALUES(?,?,?,?,?)`,
        [taskId, req.userMessage.slice(0, 100), "running", now(), now()]
      );
    } catch { /* non-fatal if tasks table has different schema */ }

    // Pick agent
    let agent: AgentDefinition | null = null;
    if (req.preferredAgentId) {
      agent = this.findAgent(req.preferredAgentId);
    }
    if (!agent) {
      agent = this.findBestAgent(req.userMessage);
    }

    if (!agent) {
      return {
        success: false,
        output: "No suitable agent found for this task.",
        turns: 0,
        tokensUsed: 0,
        agentId: "none",
      };
    }

    // One-line headline for a handoff/response beat in the conversation.
    const subjectOf = (s: string): string => {
      const t = s.replace(/\s+/g, " ").trim();
      return t.length > 80 ? `${t.slice(0, 77)}…` : t || "handoff";
    };

    // Surface a conversation beat to the presentation layer (Slack, UI) AND
    // record it on the A2A bus so /api/a2a/history reflects real agent traffic.
    const bus = getA2ABus();
    const announce = async (m: AgentMessageEvent): Promise<void> => {
      try { await req.onAgentMessage?.(m); } catch { /* presentation only — never fail the task */ }
      if (m.kind === "handoff" || m.kind === "escalate" || m.kind === "response") {
        try {
          await bus.send(m.from, m.to ?? null, m.kind, m.subject ?? m.kind, m.text, { taskId });
        } catch { /* bus is best-effort */ }
      }
    };

    const runner = this.getOrCreateRunner(agent);
    const result = await runner.run({
      ...req,
      taskId,
      onApprovalNeeded: req.onApprovalNeeded
        ? (category, context, fromAgentId) => req.onApprovalNeeded!(category, context, fromAgentId)
        : undefined,
      // A2A: when this agent hands off to another, dispatch sub-task through orchestrator
      onHandoff: async (toAgentId: string, context: string, subTaskId?: string, fromAgentId?: string) => {
        const from = fromAgentId ?? agent?.id ?? "jarvis";
        const subject = subjectOf(context);

        // Advisor consult — JARVIS asks a mentor (with their real knowledge) and relays the answer.
        if (toAgentId.toLowerCase().startsWith("advisor")) {
          const q = toAgentId.toLowerCase().replace(/^advisor[-_:]?/, "");
          const advisors = listAdvisors();
          const adv = advisors.find(a => {
            const n = a.name.toLowerCase();
            return n.includes(q) || n.split(/\s+/).some(w => w.length > 2 && (q.includes(w) || w.includes(q)));
          }) ?? advisors[0];
          if (!adv) return "No advisor is set up yet.";
          const advisorAgentId = `advisor-${adv.id}`;
          await announce({ from, to: advisorAgentId, kind: "handoff", subject, text: context });
          const advRunner = new AgentRunner(buildAdvisorAgent(adv, context), this.llm, this.authority);
          const advResult = await advRunner.run({
            userMessage: context,
            conversationId: req.conversationId,
            taskId: subTaskId ?? generateId(),
            onStream: req.onStream,
          });
          await announce({ from: advisorAgentId, to: from, kind: "response", subject: `Re: ${subject}`, text: advResult.output });
          return `${adv.name} says: ${advResult.output}`;
        }
        const targetAgent = this.findAgent(toAgentId) ?? this.findBestAgent(context);
        if (!targetAgent) return `Agent "${toAgentId}" not found`;
        await announce({ from, to: targetAgent.id, kind: "handoff", subject, text: context });
        const subRunner = this.getOrCreateRunner(targetAgent);
        const subResult = await subRunner.run({
          userMessage: context,
          conversationId: req.conversationId,
          taskId: subTaskId ?? generateId(),
          onApprovalNeeded: req.onApprovalNeeded,
          onStream: req.onStream,
        });
        await announce({ from: targetAgent.id, to: from, kind: "response", subject: `Re: ${subject}`, text: subResult.output });
        return subResult.output;
      },
    });

    // Update task record
    try {
      db.run(
        `UPDATE tasks SET status=?, updated_at=? WHERE id=?`,
        [result.success ? "completed" : "failed", now(), taskId]
      );
    } catch { /* non-fatal */ }

    return { ...result, agentId: agent.id };
  }

  // ── Workforce: a company-style run (Decision 24, V2) ──────────────────────
  // JARVIS (orchestrator) → team leads (managers) → sub-agents (workers).
  // Workers do the assigned work and report back; each lead reviews + perfects +
  // combines its team's output; if several departments are involved the leads
  // "meet" and JARVIS merges; finally JARVIS reviews, corrects, and delivers.
  // Every beat is surfaced via onAgentMessage so a chat surface (Slack) can show
  // the agents instructing each other and handing work back ("done, your turn").
  // Each agent reasons with its own brain (its own AgentRunner + model); the
  // orchestrator only conducts the turn order so it can't spiral into loops.

  private static LEAD_ROUTING: Array<{ deptId: string; leadId: string; kws: string[] }> = [
    { deptId: "marketing",  leadId: "marketing-lead", kws: ["market", "brand", "campaign", "social", "tweet", "twitter", "linkedin", "instagram", "post", " ad", "ads", "seo", "growth", "audience", "launch", "outreach"] },
    { deptId: "content",    leadId: "content-lead",   kws: ["content", "blog", "article", "script", "hook", "video", "newsletter", "copy", "write", "story", "caption", "youtube", "tiktok", "thread"] },
    { deptId: "operations", leadId: "ops-lead",       kws: ["ops", "operation", "project", "automation", "automate", "workflow", "process", "system", "task", "schedule", "roadmap", "deploy", "pipeline"] },
    { deptId: "finance",    leadId: "finance-lead",   kws: ["financ", "budget", "revenue", "expense", "invoice", "cost", "pricing", "contract", "proposal", "legal", "report", "forecast", "p&l"] },
  ];

  // Short, role-aware brief a lead hands a worker. Deterministic → reliable even
  // on a small/slow brain (we don't depend on parsing the lead's free text).
  private static WORKER_BRIEF: Record<string, string> = {
    "research-agent":     "Research the facts, sources, and key data",
    "content-researcher": "Pull the strongest facts, angles, and examples",
    "hooks-agent":        "Write 3 strong hook options and pick the best",
    "script-agent":       "Draft the script/copy",
    "social-agent":       "Draft the social posts",
    "analytics-agent":    "Surface the key metrics and what they imply",
    "content-enterprise": "Write the long-form content",
    "project-agent":      "Lay out the plan: tasks, owners, milestones",
    "automation-agent":   "Identify what to automate and how",
    "budget-agent":       "Work the numbers: costs, revenue, runway",
    "docs-agent":         "Draft the document (proposal/report/contract)",
    "comms-agent":        "Draft the message/email",
    "task-agent":         "Break this into a prioritized task list",
    "code-agent":         "Write the code",
    "fs-agent":           "Handle the files",
    "calendar-agent":     "Sort out the scheduling",
  };

  /** Pick the relevant team lead(s) + their workers for a goal. */
  private selectLeads(goal: string, maxLeads: number, maxWorkers: number): Array<{ leadId: string; workerIds: string[] }> {
    const lower = ` ${goal.toLowerCase()} `;
    let matched = Orchestrator.LEAD_ROUTING.filter(r => r.kws.some(k => lower.includes(k)));
    if (matched.length === 0) {
      const fallback = Orchestrator.LEAD_ROUTING.find(r => r.deptId === "content");
      if (fallback) matched = [fallback];
    }
    matched = matched.slice(0, Math.max(1, maxLeads));
    return matched
      .filter(r => !!this.findAgent(r.leadId))
      .map(r => {
        const dept = this.departments.get(r.deptId);
        const workerIds = (dept?.agents ?? [])
          .map(a => a.id)
          .filter(id => id !== r.leadId)
          .slice(0, Math.max(1, maxWorkers));
        return { leadId: r.leadId, workerIds };
      });
  }

  /** Run one agent on a focused instruction. Never throws — returns a note on failure. */
  private async runWorker(
    agentId: string,
    instruction: string,
    req: { conversationId?: string; onApprovalNeeded?: TaskRequest["onApprovalNeeded"] },
    taskId: string
  ): Promise<string> {
    const agent = this.findAgent(agentId);
    if (!agent) return `(${agentId} is not available)`;
    try {
      const runner = this.getOrCreateRunner(agent);
      const r = await runner.run({
        userMessage: instruction,
        conversationId: req.conversationId,
        taskId,
        onApprovalNeeded: req.onApprovalNeeded
          ? (cat, ctx, aid) => req.onApprovalNeeded!(cat, ctx, aid ?? agentId)
          : undefined,
      });
      return (r.output || "").trim() || "(no output)";
    } catch (e) {
      return `(${agent.name} hit an error: ${String(e)})`;
    }
  }

  async runWorkforce(req: {
    userMessage: string;
    conversationId?: string;
    maxLeads?: number;
    maxWorkersPerLead?: number;
    onAgentMessage?: (msg: AgentMessageEvent) => void | Promise<void>;
    onApprovalNeeded?: TaskRequest["onApprovalNeeded"];
  }): Promise<RunResult & { agentId: string; leadCount: number }> {
    const taskId = generateId();
    const goal = req.userMessage;
    const maxLeads = req.maxLeads ?? 2;
    const maxWorkers = req.maxWorkersPerLead ?? 2;
    const bus = getA2ABus();
    const nameOf = (id: string) => this.findAgent(id)?.name ?? id;

    const emit = async (m: AgentMessageEvent) => {
      try { await req.onAgentMessage?.(m); } catch { /* presentation only — never fail the run */ }
      if (m.kind === "handoff" || m.kind === "escalate" || m.kind === "response") {
        try { await bus.send(m.from, m.to ?? null, m.kind, m.subject ?? m.kind, m.text, { taskId }); } catch { /* best-effort */ }
      }
    };

    const leads = this.selectLeads(goal, maxLeads, maxWorkers);

    // No department matched and no fallback (shouldn't happen) → JARVIS handles it solo.
    if (leads.length === 0) {
      const direct = await this.runWorker("jarvis", goal, req, taskId);
      return { success: true, output: direct, turns: 1, tokensUsed: 0, agentId: "jarvis", leadCount: 0 };
    }

    await emit({ from: "jarvis", kind: "note", text: `*Goal:* ${goal}\nAssembling the team — ${leads.map(l => nameOf(l.leadId)).join(", ")}.` });

    // Each department: lead assigns → workers do the work → lead reviews + combines.
    const deptResults: Array<{ leadId: string; result: string }> = [];
    for (const lead of leads) {
      await emit({ from: "jarvis", to: lead.leadId, kind: "handoff", subject: "assignment", text: `You're on point. Goal: ${goal}` });

      const workerOutputs: Array<{ id: string; output: string }> = [];
      for (const workerId of lead.workerIds) {
        const brief = Orchestrator.WORKER_BRIEF[workerId] ?? "Do your part";
        const instruction = `${brief} for: ${goal}`;
        await emit({ from: lead.leadId, to: workerId, kind: "handoff", subject: "task", text: instruction });
        const out = await this.runWorker(workerId, instruction, req, taskId);
        workerOutputs.push({ id: workerId, output: out });
        await emit({ from: workerId, to: lead.leadId, kind: "response", subject: "done", text: out });
      }

      const combinePrompt = workerOutputs.length > 0
        ? `Your team delivered the following for the goal "${goal}". Review it, fix weaknesses, and produce ONE polished, combined result ready to present. Do not mention this instruction.\n\n${workerOutputs.map(w => `### ${nameOf(w.id)}\n${w.output}`).join("\n\n")}`
        : `Handle this goal yourself and produce a polished result: ${goal}`;
      const combined = await this.runWorker(lead.leadId, combinePrompt, req, taskId);
      deptResults.push({ leadId: lead.leadId, result: combined });
      await emit({ from: lead.leadId, to: "jarvis", kind: "response", subject: "department result", text: combined });
    }

    // Managers' meeting — only when several departments contributed.
    let assembled: string;
    if (deptResults.length > 1) {
      await emit({ from: "jarvis", kind: "note", text: `*Managers' meeting* — combining ${deptResults.length} departments' work.` });
      const meetingPrompt = `Your team leads each delivered their department's work for the goal "${goal}". Combine them into ONE coherent result, resolving overlaps. Do not mention this instruction.\n\n${deptResults.map(d => `### ${nameOf(d.leadId)}\n${d.result}`).join("\n\n")}`;
      assembled = await this.runWorker("jarvis", meetingPrompt, req, taskId);
    } else {
      assembled = deptResults[0].result;
    }

    // JARVIS final review + correction → the deliverable.
    const reviewPrompt = `Final review as the orchestrator. Here is the assembled work for the goal "${goal}". Correct any issues, tighten it, and deliver the FINAL version for the user. Output only the final deliverable.\n\n${assembled}`;
    const final = await this.runWorker("jarvis", reviewPrompt, req, taskId);

    return { success: true, output: final, turns: leads.length, tokensUsed: 0, agentId: "jarvis", leadCount: leads.length };
  }

  getMode() { return this.authority.getMode(); }
  setMode(mode: Parameters<AuthorityEngine["setMode"]>[0]) {
    this.authority.setMode(mode);
  }

  isEnterpriseMode(): boolean { return this.enterpriseMode; }
  setEnterpriseMode(on: boolean): void {
    this.enterpriseMode = on;
    this.audit.log({
      action: "permission_check",
      payload: { enterpriseModeChange: on },
    });
  }

  getDepartments(): Department[] {
    return [...this.departments.values()];
  }

  getRunningAgents(): string[] {
    return [...this.runners.keys()];
  }
}
