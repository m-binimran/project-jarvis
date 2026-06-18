/**
 * JARVIS Daemon HTTP Server
 *
 * Hono-based REST + SSE server.
 * Runs on port 9101 (localhost only — never exposed to internet without sidecar auth).
 *
 * Routes:
 *   GET  /health                   — daemon status
 *   GET  /api/usage                — token usage for today
 *   POST /api/chat                 — send a message, stream response
 *   POST /api/task                 — dispatch a background task
 *   GET  /api/agents               — list agents + status
 *   GET  /api/departments          — list departments
 *   GET  /api/conversations        — recent conversations
 *   GET  /api/conversations/:id    — messages in a conversation
 *   POST /api/permission/mode      — change permission mode
 *   GET  /api/audit                — recent audit log
 *   GET  /api/audit/verify         — verify chain integrity
 *   POST /api/keys                 — store an API key
 *   GET  /api/keys                 — list stored key names (no values)
 *   GET  /api/mcp/tools            — list MCP tools
 *   POST /api/mcp/call             — call an MCP tool
 *   POST /api/sidecar/register     — register a new sidecar
 *   GET  /api/sidecar/list         — list sidecars
 *   DELETE /api/sidecar/:id        — revoke a sidecar
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { stream } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Orchestrator } from "./agents/orchestrator.ts";
import type { SidecarManager } from "./sidecar/manager.ts";
import type { MCPRouter } from "./mcp/router.ts";
import type { A2AMessageBus } from "./agents/a2a.ts";
import { getAuditTrail } from "./authority/audit.ts";
import { setProviderKey, listKeys, storeKey, deleteKey } from "./config/keychain.ts";
import { getRecentConversations, getMessages } from "./vault/conversations.ts";
import type { LLMManager } from "./llm/manager.ts";
import {
  storeOAuthCreds,
  getGoogleAuthUrl,
  exchangeCodeForTokens,
  isGoogleConnected,
  registerGoogleWorkspace,
} from "./mcp/connectors/google-workspace.ts";
import { storeFeedback, getAgentFeedbackStats, getRecentFeedback } from "./vault/feedback.ts";
import { getMasterVision, setMasterVision } from "./vault/master-vision.ts";
import { getSetting, setSetting } from "./vault/settings.ts";
import { scanMessage } from "./authority/scanner.ts";
import { checkAlignment, filterOutput } from "./authority/firewall.ts";
import { synthesizeSpeech } from "./llm/edge-tts.ts";
import { setAnnotations, getAnnotations, clearAnnotations, type Shape } from "./annotations.ts";
import { runGuide, requestGuide, takePendingGuide, submitCapture, getGuideResult } from "./guide.ts";
import { startOperator, nextForOverlay, observeFrame, approveStep, rejectStep, stopOperator, getOperator, getActiveOperator } from "./operator.ts";
import { OPERATOR_UI } from "./operator-ui.ts";
import { beginWork, endWork, isBusy } from "./activity.ts";
import { startLoop, stopLoop, getLoop, listLoops } from "./agents/loop.ts";
import { isDryRun, setDryRun } from "./guardrails.ts";
import { isShellEnabled, dockerAvailable } from "./sandbox.ts";
import { handleMcpRequest, type JsonRpcRequest } from "./mcp/protocol.ts";
import { configureProviders } from "./config/loader.ts";
import { startSlack, refreshAgentApps } from "./slack/bot.ts";
import { preTaskCheck } from "./agents/pre-task.ts";
import { getApprovalManager } from "./authority/approvals.ts";
import { saveWorkflow, getWorkflow, listWorkflows, executeWorkflow } from "./vault/workflows.ts";
import {
  listAdvisors,
  addAdvisor,
  addAdvisorKnowledge,
  buildAdvisorAgent,
} from "./agents/advisor-council.ts";
import { AgentRunner } from "./agents/runner.ts";
import { AuthorityEngine } from "./authority/engine.ts";
import { recordLearning } from "./agents/learnings.ts";

export function buildServer(deps: {
  orchestrator: Orchestrator;
  sidecar: SidecarManager;
  mcp: MCPRouter;
  llm: LLMManager;
  a2a?: A2AMessageBus;
}): Hono {
  const { orchestrator, sidecar, mcp, llm, a2a } = deps;
  const app = new Hono();


  // CORS — allow any localhost origin + Electron renderer (null origin)
  app.use("*", cors({
    origin: (origin) => {
      if (!origin || origin === "null") return origin ?? "null";
      // Allow any localhost / 127.0.0.1 port (custom frontends, dev servers, etc.)
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
      return null;
    },
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }));

  // ── Health ───────────────────────────────────────────────────────────────

  app.get("/health", c => c.json({
    status: "ok",
    version: "0.1.0",
    mode: orchestrator.getMode(),
    timestamp: Date.now(),
  }));

  // ── Usage / Token Bar ────────────────────────────────────────────────────

  app.get("/api/usage", c => {
    const today = llm.getTodayUsage();
    return c.json({ today });
  });

  // ── Text-to-speech — free Edge neural voice (British male "Ryan") ─────────
  const ttsSchema = z.object({ text: z.string().min(1), voice: z.string().optional() });
  app.post("/api/tts", zValidator("json", ttsSchema), async c => {
    const body = c.req.valid("json") as { text: string; voice?: string };
    try {
      const audio = await synthesizeSpeech(body.text.slice(0, 1500), body.voice);
      return c.body(new Uint8Array(audio), 200, { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // ── Screen annotations — what JARVIS draws on your screen ─────────────────
  const annotateSchema = z.object({
    shapes: z.array(z.object({
      type: z.enum(["rect", "circle", "arrow", "label"]),
      x: z.number(), y: z.number(),
      w: z.number().optional(), h: z.number().optional(),
      x2: z.number().optional(), y2: z.number().optional(),
      text: z.string().optional(), color: z.string().optional(),
    })),
    ttlMs: z.number().optional(),
  });
  app.post("/api/annotate", zValidator("json", annotateSchema), c => {
    const body = c.req.valid("json") as { shapes: Shape[]; ttlMs?: number };
    const version = setAnnotations(body.shapes, body.ttlMs ?? 8000);
    return c.json({ success: true, version });
  });
  app.get("/api/annotate", c => c.json(getAnnotations()));
  app.post("/api/annotate/clear", c => { clearAnnotations(); return c.json({ success: true }); });

  // ── Screen guidance — "show me where to click for X" ──────────────────────
  // The orb calls POST /api/guide with a task. If it can supply a screenshot it
  // gets an answer synchronously; otherwise we queue it for the Electron overlay
  // (which can screenshot the whole OS) to fulfil, and the orb polls for the result.
  const MAX_SHOT = 8_000_000; // ~8MB data URL — a full-screen JPEG is well under this
  const guideSchema = z.object({
    task: z.string().min(1).max(2000),
    screenshot: z.string().max(MAX_SHOT).optional(), // data URL — only the overlay/tests provide this
  });
  app.post("/api/guide", zValidator("json", guideSchema), async c => {
    const { task, screenshot } = c.req.valid("json") as { task: string; screenshot?: string };
    if (screenshot) {
      const result = await runGuide(task, screenshot);
      return c.json({ ok: result.ok, mode: "sync", ...result });
    }
    const id = requestGuide(task);
    return c.json({ ok: true, mode: "async", id, pending: true });
  });

  // Overlay polls this; returns the next task that needs a screenshot (or null).
  app.get("/api/guide/pending", c => c.json({ pending: takePendingGuide() }));

  // Overlay posts the screenshot it captured for a queued request. The task is
  // taken from the daemon's own queue record (by id) — not from this body.
  const captureSchema = z.object({
    id: z.string().min(1),
    screenshot: z.string().min(1).max(MAX_SHOT),
  });
  app.post("/api/guide/capture", zValidator("json", captureSchema), async c => {
    const { id, screenshot } = c.req.valid("json") as { id: string; screenshot: string };
    const result = await submitCapture(id, screenshot);
    return c.json({ ok: result.ok, ...result });
  });

  // Orb polls this until the overlay has produced a result.
  app.get("/api/guide/result/:id", c => {
    const result = getGuideResult(c.req.param("id"));
    return c.json({ ready: !!result, result });
  });

  // ── Computer-use operator — JARVIS actually clicks/types, every step gated ──
  // Loop: start → overlay GET /next (shot|act) → POST /frame(screenshot) → daemon
  // proposes the next action (awaiting_approval) → human POST /:id/approve|reject →
  // approved action surfaces via /next → overlay executes → /frame → repeat.
  const opStartSchema = z.object({ task: z.string().min(1).max(2000), maxSteps: z.number().int().positive().max(30).optional() });
  app.post("/api/operator/start", zValidator("json", opStartSchema), c => {
    const { task, maxSteps } = c.req.valid("json") as { task: string; maxSteps?: number };
    return c.json(startOperator(task, maxSteps));
  });

  // Overlay polls: returns { kind: "shot" | "act" | "idle", id?, action? }.
  app.get("/api/operator/next", c => c.json(nextForOverlay()));

  // UI polls this for the action currently awaiting a human OK (or null).
  app.get("/api/operator/active", c => c.json({ active: getActiveOperator() }));

  // The human-in-the-loop control panel (self-contained page).
  app.get("/operator", c => c.html(OPERATOR_UI));

  // Overlay posts a fresh screenshot (after a shot, or after executing an action).
  const opFrameSchema = z.object({ id: z.string().min(1), screenshot: z.string().min(1).max(MAX_SHOT) });
  app.post("/api/operator/frame", zValidator("json", opFrameSchema), async c => {
    const { id, screenshot } = c.req.valid("json") as { id: string; screenshot: string };
    try { return c.json(await observeFrame(id, screenshot)); }
    catch (e) { return c.json({ error: String(e instanceof Error ? e.message : e) }, 400); }
  });

  // UI: inspect a session, then approve / reject the proposed action, or stop.
  app.get("/api/operator/:id", c => {
    const s = getOperator(c.req.param("id"));
    return s ? c.json(s) : c.json({ error: "not found" }, 404);
  });
  app.post("/api/operator/:id/approve", c => c.json(approveStep(c.req.param("id"))));
  app.post("/api/operator/:id/reject", c => c.json(rejectStep(c.req.param("id"))));
  app.post("/api/operator/:id/stop", c => { const s = stopOperator(c.req.param("id")); return s ? c.json(s) : c.json({ error: "not found" }, 404); });

  // ── Chat ─────────────────────────────────────────────────────────────────

  const chatSchema = z.object({
    message: z.string().min(1),
    conversationId: z.string().optional(),
    agentId: z.string().optional(),
  });

  app.post("/api/chat", zValidator("json", chatSchema), async c => {
    const { message, conversationId, agentId } = c.req.valid("json");

    // Prompt injection scan — runs before any agent sees the message
    const scan = scanMessage(message);
    if (scan.risk === "blocked") {
      return c.json({
        error: scan.reason,
        flagged: scan.flaggedPatterns,
        blocked: true,
      }, 400);
    }

    // Streaming SSE response
    return stream(c, async (s) => {
      // Warn client if suspicious but not blocked
      if (scan.risk === "suspicious") {
        s.write(`data: ${JSON.stringify({ type: "warning", message: scan.reason })}\n\n`);
      }

      // Pre-task check — inform client of any tool gaps (non-blocking)
      const check = preTaskCheck(message, mcp);
      if (!check.ready) {
        s.write(`data: ${JSON.stringify({ type: "pre_task_gaps", gaps: check.gaps, suggestions: check.suggestions })}\n\n`);
      }

      beginWork(); // pill shows a "thinking" animation while this is processed
      try {
        const result = await orchestrator.dispatch({
          userMessage: message,
          conversationId,
          preferredAgentId: agentId,
          onStream: (delta) => {
            s.write(`data: ${JSON.stringify({ type: "delta", content: delta })}\n\n`);
          },
          onApprovalNeeded: async (action, context, fromAgentId) => {
            const approvalMgr = getApprovalManager();
            const { requestId, promise } = approvalMgr.request(
              fromAgentId ?? agentId ?? "jarvis",
              action,
              context
            );
            // Send the approval request downstream — overlay shows Approve/Deny buttons
            s.write(`data: ${JSON.stringify({
              type: "approval_needed",
              requestId,
              action,
              context,
            })}\n\n`);
            // Wait for user response (60s timeout = auto-deny)
            const approved = await promise;
            s.write(`data: ${JSON.stringify({
              type: "approval_resolved",
              requestId,
              approved,
            })}\n\n`);
            return approved;
          },
        });

        // Firewall output side — AlignmentCheck flags a hijacked agent;
        // OutputFilter redacts any secret that leaked into the final text.
        const aligned = checkAlignment(result.output);
        if (aligned.verdict !== "allow") {
          s.write(`data: ${JSON.stringify({ type: "warning", message: `AlignmentCheck: ${aligned.reasons.join("; ")}` })}\n\n`);
        }
        const filtered = filterOutput(result.output);
        const safeResult = filtered.verdict === "allow"
          ? result
          : { ...result, output: filtered.sanitized ?? result.output };

        s.write(`data: ${JSON.stringify({ type: "done", result: safeResult })}\n\n`);
      } catch (err) {
        s.write(`data: ${JSON.stringify({ type: "error", message: String(err) })}\n\n`);
      } finally {
        endWork();
      }
    });
  });

  // ── Activity — is JARVIS working? (the pill polls this for its thinking dots) ─
  app.get("/api/activity", c => c.json({ busy: isBusy() }));

  // ── Autonomous agent loop ─────────────────────────────────────────────────
  // Give it a goal; it works step-by-step on its own until done or a guardrail
  // trips (step cap, token budget, cancel). Risky actions stay blocked unattended.
  const loopSchema = z.object({
    goal: z.string().min(1).max(2000),
    maxSteps: z.number().int().positive().optional(),
    tokenBudget: z.number().int().positive().optional(),
    agentId: z.string().optional(),
    mode: z.enum(["normal", "overnight"]).optional(),
    maxMinutes: z.number().int().positive().max(1440).optional(), // overnight time budget (<=24h)
  });
  app.post("/api/loop/start", zValidator("json", loopSchema), c => {
    const body = c.req.valid("json") as { goal: string; maxSteps?: number; tokenBudget?: number; agentId?: string; mode?: "normal" | "overnight"; maxMinutes?: number };
    const res = startLoop(orchestrator, body.goal, body);
    if ("error" in res) return c.json(res, 429);
    return c.json(res);
  });
  app.get("/api/loop", c => c.json({ loops: listLoops() }));
  app.get("/api/loop/:id", c => {
    const loop = getLoop(c.req.param("id"));
    return loop ? c.json(loop) : c.json({ error: "loop not found" }, 404);
  });
  app.post("/api/loop/:id/stop", c => c.json({ stopped: stopLoop(c.req.param("id")) }));

  // ── Kernel controls — guardrail status + dry-run toggle ────────────────────
  app.get("/api/kernel/status", c => c.json({
    dryRun: isDryRun(),
    shellEnabled: isShellEnabled(),
    dockerAvailable: dockerAvailable(),
  }));
  const dryRunSchema = z.object({ on: z.boolean() });
  app.post("/api/kernel/dryrun", zValidator("json", dryRunSchema), c => {
    const { on } = c.req.valid("json") as { on: boolean };
    setDryRun(on);
    return c.json({ dryRun: isDryRun() });
  });

  // ── Agents ───────────────────────────────────────────────────────────────

  app.get("/api/agents", c => {
    const departments = orchestrator.getDepartments();
    const running = new Set(orchestrator.getRunningAgents());

    const agents = departments.flatMap(d =>
      d.agents.map(a => ({
        id: a.id,
        name: a.name,
        department: d.name,
        status: running.has(a.id) ? "active" : "dormant",
      }))
    );

    return c.json({ agents });
  });

  app.get("/api/departments", c => {
    return c.json({
      departments: orchestrator.getDepartments().map(d => ({
        id: d.id,
        name: d.name,
        description: d.description,
        agentCount: d.agents.length,
      })),
    });
  });

  // ── Conversations ────────────────────────────────────────────────────────

  app.get("/api/conversations", c => {
    const limit = parseInt(c.req.query("limit") ?? "20", 10);
    const conversations = getRecentConversations(limit);
    return c.json({ conversations });
  });

  app.get("/api/conversations/:id", c => {
    const messages = getMessages(c.req.param("id"));
    return c.json({ messages });
  });

  // ── Permission Mode ───────────────────────────────────────────────────────

  const modeSchema = z.object({
    mode: z.enum(["safe", "productive", "auto", "bypass"]),
  });

  app.post("/api/permission/mode", zValidator("json", modeSchema), c => {
    const { mode } = c.req.valid("json");
    orchestrator.setMode(mode);
    getAuditTrail().log({
      action: "permission_check",
      payload: { modeChange: mode },
    });
    return c.json({ success: true, mode });
  });

  // ── Enterprise Mode ──────────────────────────────────────────────────────

  app.get("/api/enterprise/mode", c => {
    return c.json({
      enterprise: orchestrator.isEnterpriseMode(),
      departments: orchestrator.getDepartments().map(d => ({
        id: d.id,
        name: d.name,
        agentCount: d.agents.length,
      })),
    });
  });

  const enterpriseModeSchema = z.object({
    enterprise: z.boolean(),
  });

  app.post("/api/enterprise/mode", zValidator("json", enterpriseModeSchema), c => {
    const { enterprise } = c.req.valid("json");
    orchestrator.setEnterpriseMode(enterprise);
    return c.json({ success: true, enterprise });
  });

  // ── Approval System ──────────────────────────────────────────────────────

  /** GET /api/approvals — list pending approvals (UI fallback polling) */
  app.get("/api/approvals", c => {
    const pending = getApprovalManager().listPending();
    return c.json({ pending });
  });

  /** POST /api/approval/:requestId — resolve a pending approval */
  const approvalSchema = z.object({
    approved: z.boolean(),
  });

  app.post("/api/approval/:requestId", zValidator("json", approvalSchema), c => {
    const requestId = c.req.param("requestId");
    const { approved } = c.req.valid("json");
    const resolved = getApprovalManager().respond(requestId, approved);

    if (!resolved) {
      return c.json({ success: false, error: "Request not found or already resolved" }, 404);
    }

    getAuditTrail().log({
      action: approved ? "permission_granted" : "circuit_breaker_triggered",
      payload: { requestId, approved },
    });

    return c.json({ success: true, requestId, approved });
  });

  // ── Workflows ────────────────────────────────────────────────────────────

  app.get("/api/workflows", c => {
    const workflows = listWorkflows();
    return c.json({ workflows });
  });

  app.get("/api/workflows/:id", c => {
    const wf = getWorkflow(c.req.param("id"));
    if (!wf) return c.json({ error: "Not found" }, 404);
    return c.json({ workflow: wf });
  });

  const workflowSaveSchema = z.object({
    id: z.string().optional(),
    name: z.string().min(1),
    nodes: z.array(z.object({
      id: z.string(),
      type: z.enum(["trigger", "action", "output"]),
      data: z.record(z.unknown()),
      position: z.object({ x: z.number(), y: z.number() }).optional(),
    })),
    edges: z.array(z.object({
      id: z.string(),
      source: z.string(),
      target: z.string(),
    })),
  });

  app.post("/api/workflows", zValidator("json", workflowSaveSchema), c => {
    const body = c.req.valid("json") as Parameters<typeof saveWorkflow>[0];
    const saved = saveWorkflow(body);
    return c.json({ success: true, id: saved.id, workflow: saved });
  });

  app.post("/api/workflows/:id/run", async c => {
    const id = c.req.param("id");
    let input: unknown = null;
    try {
      const body = await c.req.json();
      input = body.input;
    } catch { /* no body */ }

    const result = await executeWorkflow(id, input, async (agentId, prompt) => {
      const dispatchResult = await orchestrator.dispatch({
        userMessage: prompt,
        preferredAgentId: agentId,
      });
      return dispatchResult.output;
    });

    return c.json(result);
  });

  // Latest = most recently updated workflow (convenience for UI)
  app.post("/api/workflows/latest/run", async c => {
    const all = listWorkflows();
    if (all.length === 0) return c.json({ error: "No workflows saved" }, 404);

    let input: unknown = null;
    try {
      const body = await c.req.json();
      input = body.input;
    } catch { /* no body */ }

    const result = await executeWorkflow(all[0].id, input, async (agentId, prompt) => {
      const dispatchResult = await orchestrator.dispatch({
        userMessage: prompt,
        preferredAgentId: agentId,
      });
      return dispatchResult.output;
    });

    return c.json(result);
  });

  // ── Onboarding: Phase 2 Setup Checklist ────────────────────────────────────
  // Tracks which Phase 2 items the user has completed + whether the checklist
  // panel was dismissed. Stored in the settings table:
  //   checklist_completed → JSON string[] of item ids
  //   checklist_dismissed → "true" | (absent)

  app.get("/api/onboarding/checklist", c => {
    let completed: string[] = [];
    try {
      const raw = getSetting("checklist_completed");
      if (raw) completed = JSON.parse(raw);
    } catch { /* corrupt value — treat as empty */ }
    const dismissed = getSetting("checklist_dismissed") === "true";
    return c.json({ completed, dismissed });
  });

  const checklistItemSchema = z.object({ id: z.string().min(1) });

  app.post("/api/onboarding/checklist", zValidator("json", checklistItemSchema), c => {
    const { id } = c.req.valid("json");
    let completed: string[] = [];
    try {
      const raw = getSetting("checklist_completed");
      if (raw) completed = JSON.parse(raw);
    } catch { /* reset on corrupt */ }
    if (!completed.includes(id)) {
      completed.push(id);
      setSetting("checklist_completed", JSON.stringify(completed));
    }
    return c.json({ success: true, completed });
  });

  app.post("/api/onboarding/checklist/dismiss", c => {
    setSetting("checklist_dismissed", "true");
    return c.json({ success: true });
  });

  // ── Master Vision ─────────────────────────────────────────────────────────

  app.get("/api/master-vision", c => {
    return c.json({ vision: getMasterVision() });
  });

  const visionSchema = z.object({ content: z.string().min(1) });
  app.post("/api/master-vision", zValidator("json", visionSchema), c => {
    const { content } = c.req.valid("json");
    setMasterVision(content);
    getAuditTrail().log({ action: "agent_start", payload: { note: "master_vision_updated" } });
    return c.json({ success: true });
  });

  // ── Vault Search ───────────────────────────────────────────────────────────

  app.get("/api/vault/search", async c => {
    const q     = c.req.query("q") ?? "";
    const limit = parseInt(c.req.query("limit") ?? "20", 10);
    if (!q) return c.json({ results: [] });
    try {
      const { getDb } = await import("./vault/schema.ts");
      const db = getDb();
      // Search conversations + facts + journals
      const convs = db.query<{ id: string; title: string; created_at: number }>(
        `SELECT id, title, created_at FROM conversations
         WHERE title LIKE ? ORDER BY created_at DESC LIMIT ?`
      ).all(`%${q}%`, Math.ceil(limit / 3));

      const facts = db.query<{ id: string; content: string; created_at: number }>(
        `SELECT id, content, created_at FROM facts
         WHERE content LIKE ? ORDER BY created_at DESC LIMIT ?`
      ).all(`%${q}%`, Math.ceil(limit / 3));

      const journals = db.query<{ id: string; summary: string; agent_id: string; created_at: number }>(
        `SELECT id, summary, agent_id, created_at FROM agent_journals
         WHERE summary LIKE ? ORDER BY created_at DESC LIMIT ?`
      ).all(`%${q}%`, Math.ceil(limit / 3));

      return c.json({
        results: [
          ...convs.map(r    => ({ type: "conversation", ...r })),
          ...facts.map(r    => ({ type: "fact",         ...r })),
          ...journals.map(r => ({ type: "journal",      ...r })),
        ].sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0)),
      });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // ── Advisor Council ──────────────────────────────────────────────────────

  app.get("/api/advisors", c => {
    const advisors = listAdvisors();
    return c.json({ advisors });
  });

  const addAdvisorSchema = z.object({
    name: z.string().min(1),
    focus: z.string().min(1),
    sources: z.array(z.string()).optional(),
  });

  app.post("/api/advisors", zValidator("json", addAdvisorSchema), c => {
    const body = c.req.valid("json") as Parameters<typeof addAdvisor>[0];
    const advisor = addAdvisor(body);
    return c.json({ success: true, advisor });
  });

  const advisorKnowledgeSchema = z.object({
    content: z.string().min(1),
    sourceType: z.enum(["manual", "summary"]).default("manual"),
    sourceUrl: z.string().optional(),
  });

  app.post("/api/advisors/:id/knowledge", zValidator("json", advisorKnowledgeSchema), c => {
    const advisorId = c.req.param("id");
    const { content, sourceType, sourceUrl } = c.req.valid("json");
    addAdvisorKnowledge(advisorId, content, sourceType, sourceUrl);
    return c.json({ success: true });
  });

  /** Ask an advisor a question — returns a streaming SSE response */
  const askAdvisorSchema = z.object({
    question: z.string().min(1),
  });

  app.post("/api/advisors/:id/ask", zValidator("json", askAdvisorSchema), async c => {
    const advisorId = c.req.param("id");
    const { question } = c.req.valid("json");

    const advisors = listAdvisors();
    const advisor = advisors.find(a => a.id === advisorId);
    if (!advisor) return c.json({ error: "Advisor not found" }, 404);

    const agentDef = buildAdvisorAgent(advisor, question);
    const authority = new AuthorityEngine("productive");
    const runner = new AgentRunner(agentDef, llm, authority);

    return stream(c, async (s) => {
      try {
        const result = await runner.run({
          userMessage: question,
          onStream: (delta) => {
            s.write(`data: ${JSON.stringify({ type: "delta", content: delta })}\n\n`);
          },
        });
        s.write(`data: ${JSON.stringify({ type: "done", result, advisorId, advisorName: advisor.name })}\n\n`);
      } catch (err) {
        s.write(`data: ${JSON.stringify({ type: "error", message: String(err) })}\n\n`);
      }
    });
  });

  // ── Audit ─────────────────────────────────────────────────────────────────

  app.get("/api/audit", c => {
    const limit = parseInt(c.req.query("limit") ?? "50", 10);
    const agentId = c.req.query("agentId");
    const entries = getAuditTrail().recent({ limit, agentId });
    return c.json({ entries });
  });

  app.get("/api/audit/verify", c => {
    const result = getAuditTrail().verify();
    return c.json(result);
  });

  // ── API Keys ─────────────────────────────────────────────────────────────

  const keySchema = z.object({
    provider: z.string(),
    key: z.string().min(1),
  });

  app.post("/api/keys", zValidator("json", keySchema), async c => {
    const { provider, key } = c.req.valid("json");

    // Validate provider name
    const allowed = ["anthropic", "openai", "nvidia", "deepseek", "google", "ollama_host", "slack_bot_token", "slack_app_token"];
    if (!allowed.includes(provider)) {
      return c.json({ error: "Unknown provider" }, 400);
    }

    await setProviderKey(provider as Parameters<typeof setProviderKey>[0], key);

    // Hot-reload the LLM manager so the new key works immediately — no daemon restart.
    try { await configureProviders(llm); } catch { /* non-fatal */ }
    // If a Slack token was just added, try connecting Slack now too.
    if (provider.startsWith("slack")) { startSlack(orchestrator).catch(() => {}); }

    getAuditTrail().log({
      action: "key_stored",
      payload: { provider, keyLength: key.length },
    });

    return c.json({ success: true });
  });

  app.get("/api/keys", async c => {
    const keys = await listKeys();
    return c.json({ keys: keys.map(k => k.account) });
  });

  // ── Slack Workforce — per-agent app tokens (each agent = its own Slack app) ──
  const AGENT_TOKEN_PREFIX = "slack_agent:";

  /** GET /api/slack/agents — every agent + whether it has its own Slack app wired up */
  app.get("/api/slack/agents", async c => {
    let accounts: { account: string }[] = [];
    try { accounts = await listKeys(); } catch { /* keychain unavailable */ }
    const withApp = new Set(
      accounts
        .filter(k => k.account.startsWith(AGENT_TOKEN_PREFIX))
        .map(k => k.account.slice(AGENT_TOKEN_PREFIX.length))
    );
    const agents = orchestrator.getDepartments().flatMap(d =>
      d.agents.map(a => ({ id: a.id, name: a.name, department: d.name, hasApp: withApp.has(a.id) }))
    );
    return c.json({ agents });
  });

  /** POST /api/slack/agents — register one agent's own Slack app bot token (xoxb-…) */
  const agentTokenSchema = z.object({
    agentId: z.string().min(1),
    token: z.string().min(10),
  });

  app.post("/api/slack/agents", zValidator("json", agentTokenSchema), async c => {
    const { agentId, token } = c.req.valid("json");
    if (agentId === "jarvis") {
      return c.json({ error: "JARVIS uses the main bot token (slack_bot_token), not a per-agent token." }, 400);
    }
    const known = orchestrator.getDepartments().some(d => d.agents.some(a => a.id === agentId));
    if (!known) return c.json({ error: `Unknown agent id "${agentId}"` }, 400);

    await storeKey(AGENT_TOKEN_PREFIX + agentId, token);
    const count = await refreshAgentApps();
    getAuditTrail().log({ action: "key_stored", payload: { provider: AGENT_TOKEN_PREFIX + agentId, keyLength: token.length } });
    return c.json({ success: true, agentId, agentAppsActive: count });
  });

  /** DELETE /api/slack/agents/:agentId — remove an agent's own Slack app token */
  app.delete("/api/slack/agents/:agentId", async c => {
    const agentId = c.req.param("agentId");
    try { await deleteKey(AGENT_TOKEN_PREFIX + agentId); } catch { /* not present */ }
    const count = await refreshAgentApps();
    return c.json({ success: true, agentId, agentAppsActive: count });
  });

  // ── MCP ───────────────────────────────────────────────────────────────────

  app.get("/api/mcp/tools", c => {
    return c.json({
      tools: mcp.listTools().map(t => ({
        name: t.name,
        description: t.description,
        category: t.category,
      })),
      connectors: mcp.listConnectors(),
    });
  });

  const mcpCallSchema = z.object({
    tool: z.string(),
    params: z.record(z.unknown()).optional(),
  });

  app.post("/api/mcp/call", zValidator("json", mcpCallSchema), async c => {
    const { tool, params = {} } = c.req.valid("json");
    try {
      const result = await mcp.call(tool, params);
      return c.json({ success: true, result });
    } catch (err) {
      return c.json({ success: false, error: String(err) }, 400);
    }
  });

  // Spec-compliant MCP endpoint (JSON-RPC 2.0). Any MCP client can speak to the
  // kernel here — and every tools/call still passes the secure chokepoint.
  app.post("/mcp", async c => {
    let body: JsonRpcRequest | JsonRpcRequest[];
    try {
      body = await c.req.json();
    } catch {
      return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
    }
    // Support JSON-RPC batches.
    if (Array.isArray(body)) {
      const responses = (await Promise.all(body.map(m => handleMcpRequest(mcp, m)))).filter(Boolean);
      return c.json(responses);
    }
    const res = await handleMcpRequest(mcp, body);
    return res ? c.json(res) : c.body(null, 204); // notifications → no content
  });

  // ── Sidecar ───────────────────────────────────────────────────────────────

  const sidecarSchema = z.object({ name: z.string().min(1) });

  app.post("/api/sidecar/register", zValidator("json", sidecarSchema), async c => {
    const { name } = c.req.valid("json");
    const result = await sidecar.register(name);
    getAuditTrail().log({
      action: "sidecar_connect",
      payload: { sidecarId: result.sidecarId, name },
    });
    return c.json(result);
  });

  app.get("/api/sidecar/list", c => {
    return c.json({ sidecars: sidecar.list() });
  });

  app.delete("/api/sidecar/:id", c => {
    const id = c.req.param("id");
    sidecar.revoke(id);
    getAuditTrail().log({
      action: "sidecar_disconnect",
      payload: { sidecarId: id },
    });
    return c.json({ success: true });
  });

  // ── Feedback ──────────────────────────────────────────────────────────────

  /**
   * POST /api/feedback  — submit a thumbs-up (1) or thumbs-down (-1)
   */
  const feedbackSchema = z.object({
    agentId:        z.string().min(1),
    score:          z.union([z.literal(1), z.literal(-1)]),
    taskId:         z.string().optional(),
    conversationId: z.string().optional(),
    messageId:      z.string().optional(),
    note:           z.string().optional(),
  });

  app.post("/api/feedback", zValidator("json", feedbackSchema), c => {
    const body = c.req.valid("json") as Parameters<typeof storeFeedback>[0];
    const entry = storeFeedback(body);
    // Turn the thumb into a durable learning so behaviour actually changes next time.
    const note = (body as { note?: string }).note;
    if (body.score === -1) {
      recordLearning(body.agentId, "mistake", note ? `User disliked: ${note}` : "A recent response was marked unhelpful — be more accurate and answer exactly what was asked.");
    } else if (body.score === 1 && note) {
      recordLearning("user", "preference", `User liked: ${note}`);
    }
    return c.json({ success: true, id: entry.id });
  });

  /**
   * GET /api/feedback?agentId=&limit=  — recent feedback entries
   */
  app.get("/api/feedback", c => {
    const agentId = c.req.query("agentId");
    const limit   = parseInt(c.req.query("limit") ?? "50", 10);
    const entries = getRecentFeedback({ agentId, limit });
    return c.json({ entries });
  });

  /**
   * GET /api/feedback/stats/:agentId  — score summary for one agent
   */
  app.get("/api/feedback/stats/:agentId", c => {
    const stats = getAgentFeedbackStats(c.req.param("agentId"));
    return c.json(stats);
  });

  // ── Google OAuth ──────────────────────────────────────────────────────────

  /**
   * POST /api/auth/google/creds  — store OAuth client_id + client_secret
   * Body: { clientId, clientSecret }
   */
  const googleCredsSchema = z.object({
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
  });

  app.post("/api/auth/google/creds", zValidator("json", googleCredsSchema), async c => {
    const { clientId, clientSecret } = c.req.valid("json");
    await storeOAuthCreds(clientId, clientSecret);
    return c.json({ success: true, message: "OAuth credentials stored. GET /api/auth/google to get the auth URL." });
  });

  /**
   * GET /api/auth/google  — returns the URL the user should open in their browser
   * Query: ?redirect_uri=http://localhost:9101/api/auth/google/callback
   */
  app.get("/api/auth/google", async c => {
    const redirectUri = c.req.query("redirect_uri") ?? "http://localhost:9101/api/auth/google/callback";
    const url = await getGoogleAuthUrl(redirectUri);
    if (!url) {
      return c.json({ error: "OAuth credentials not set. POST /api/auth/google/creds first." }, 400);
    }
    return c.json({ authUrl: url, redirectUri });
  });

  /**
   * GET /api/auth/google/callback  — OAuth callback, exchanges code for refresh token
   */
  app.get("/api/auth/google/callback", async c => {
    const code        = c.req.query("code");
    const redirectUri = c.req.query("redirect_uri") ?? "http://localhost:9101/api/auth/google/callback";

    if (!code) {
      return c.html(`<h2>Error</h2><p>No code parameter received.</p>`, 400);
    }

    try {
      await exchangeCodeForTokens(code, redirectUri);
      // Re-register connector now that tokens are stored
      await registerGoogleWorkspace(mcp);
      getAuditTrail().log({ action: "key_stored", payload: { provider: "google-workspace" } });
      return c.html(`
        <h2>✅ Google Workspace Connected</h2>
        <p>Gmail and Google Calendar are now active in JARVIS.</p>
        <p>You can close this window.</p>
      `);
    } catch (err) {
      return c.html(`<h2>❌ OAuth failed</h2><p>${String(err)}</p>`, 400);
    }
  });

  /**
   * GET /api/auth/google/status  — check if Google Workspace is connected
   */
  app.get("/api/auth/google/status", async c => {
    const connected = await isGoogleConnected();
    return c.json({ connected });
  });

  // ── A2A Message Bus ───────────────────────────────────────────────────────

  /**
   * GET /api/a2a/history  — recent agent-to-agent messages
   */
  app.get("/api/a2a/history", c => {
    if (!a2a) return c.json({ messages: [] });
    const agentId = c.req.query("agentId");
    const limit   = parseInt(c.req.query("limit") ?? "50", 10);
    return c.json({ messages: a2a.getHistory({ agentId, limit }) });
  });

  /**
   * GET /api/a2a/subscribers  — list agents currently subscribed to the bus
   */
  app.get("/api/a2a/subscribers", c => {
    if (!a2a) return c.json({ subscribers: [] });
    return c.json({ subscribers: a2a.getSubscribers() });
  });

  /**
   * POST /api/a2a/send  — manually inject an A2A message (for testing / UI)
   */
  const a2aSendSchema = z.object({
    from:       z.string(),
    to:         z.string().nullable(),
    type:       z.enum(["request", "response", "handoff", "escalate", "share", "ack"]),
    subject:    z.string(),
    content:    z.string(),
    taskId:     z.string().optional(),
    department: z.string().optional(),
  });

  app.post("/api/a2a/send", zValidator("json", a2aSendSchema), async c => {
    if (!a2a) return c.json({ error: "A2A bus not initialized" }, 500);
    const body = c.req.valid("json");
    const id = await a2a.send(body.from, body.to, body.type, body.subject, body.content, {
      taskId: body.taskId,
      department: body.department,
    });
    return c.json({ success: true, messageId: id });
  });

  return app;
}
