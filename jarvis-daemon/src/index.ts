/**
 * JARVIS Daemon — Entry Point
 *
 * Boot sequence:
 *   1. Initialize SQLite DB (migrations run automatically)
 *   2. Load config from settings table
 *   3. Build LLM manager (pulls API keys from OS keychain)
 *   4. Boot audit trail (restores chain head)
 *   5. Build MCP router (register built-in connectors)
 *   6. Boot orchestrator (register departments, agents start dormant)
 *   7. Boot sidecar manager
 *   8. Start Hono HTTP server on configured port
 *   9. Write startup audit record
 *  10. Print JARVIS banner
 */

import { initDb } from "./vault/schema.ts";
import { loadConfig, buildLLMManager } from "./config/loader.ts";
import { Orchestrator } from "./agents/orchestrator.ts";
import { resumeLoops } from "./agents/loop.ts";
import { buildPersonalDepartment } from "./agents/departments.ts";
import { buildContentDepartment } from "./agents/content-department.ts";
import { buildEnterpriseDepartments } from "./agents/enterprise-department.ts";
import { initAdvisorCouncil } from "./agents/advisor-council.ts";
import { registerBrowser } from "./mcp/connectors/browser.ts";
import { ensureDefaultVision } from "./vault/master-vision.ts";
import { buildSkills, SKILL_KEYWORDS } from "./agents/skills.ts";
import { getA2ABus } from "./agents/a2a.ts";
import { SidecarManager } from "./sidecar/manager.ts";
import { buildDefaultRouter } from "./mcp/router.ts";
import { registerGoogleWorkspace } from "./mcp/connectors/google-workspace.ts";
import { buildServer } from "./server.ts";
import { startSlack } from "./slack/bot.ts";
import { getAuditTrail } from "./authority/audit.ts";
import { AuthorityEngine } from "./authority/engine.ts";
import { serve } from "@hono/node-server";

async function boot() {
  console.log("\n");
  console.log("  ╔══════════════════════════════════════╗");
  console.log("  ║         J A R V I S  v0.1.0          ║");
  console.log("  ║    Personal AI Operating System      ║");
  console.log("  ╚══════════════════════════════════════╝");
  console.log("\n");

  // 1. Database
  console.log("[boot] Initializing vault...");
  initDb();

  // 2. Config
  console.log("[boot] Loading config...");
  const cfg = loadConfig();
  console.log(`[boot] Mode: ${cfg.mode} | Port: ${cfg.daemonPort}`);

  // 3. LLM
  console.log("[boot] Building LLM manager...");
  const llm = await buildLLMManager();
  const providers = llm.getProviderNames();
  console.log(`[boot] LLM providers: ${providers.join(", ") || "none (add API key via /api/keys)"}`);

  // 4. Audit
  console.log("[boot] Restoring audit chain...");
  const audit = getAuditTrail();

  // 5. MCP
  console.log("[boot] Building MCP router...");
  const mcpRouter = buildDefaultRouter();
  // Shared authority engine — makes the MCP router a secure chokepoint, and the
  // orchestrator uses the SAME engine so a mode change applies everywhere at once.
  const authority = new AuthorityEngine("productive");
  mcpRouter.setAuthority(authority);
  await registerGoogleWorkspace(mcpRouter);  // adds Gmail + Calendar tools if OAuth tokens exist
  const tools = mcpRouter.listTools();
  console.log(`[boot] MCP tools: ${tools.map(t => t.name).join(", ")}`);

  // 5b. A2A bus
  const a2aBus = getA2ABus();
  console.log("[boot] A2A message bus ready");

  // 5c. Advisor Council — seed built-in advisors (Naval, Hormozi, PG)
  initAdvisorCouncil();
  console.log("[boot] Advisor Council seeded (Naval, Hormozi, PG)");

  // 5d. Master Vision — set default if none exists
  ensureDefaultVision();

  // 5e. Browser MCP — Playwright browser control (replaces per-service MCPs)
  registerBrowser(mcpRouter);
  console.log("[boot] Browser MCP ready (Playwright)");

  // 5f. Pre-baked skills — Decision 15
  const skillDept = {
    id: "skills",
    name: "Skills",
    description: "Pre-baked skills: email drafter, daily briefing, screen explainer, reply faster, quick capture",
    agents: buildSkills(mcpRouter),
  };

  // 6. Orchestrator — pass live MCP router so agents have real tools
  console.log("[boot] Booting orchestrator...");
  const orchestrator = new Orchestrator(llm, authority);

  const personalDept = buildPersonalDepartment(mcpRouter);
  orchestrator.registerDepartment(personalDept);
  orchestrator.registerDepartment(skillDept);

  const contentDept = buildContentDepartment(mcpRouter);
  orchestrator.registerDepartment(contentDept);

  const enterpriseDepts = buildEnterpriseDepartments(mcpRouter);
  for (const dept of enterpriseDepts) {
    orchestrator.registerDepartment(dept);
  }

  const allAgents = [
    ...personalDept.agents,
    ...skillDept.agents,
    ...contentDept.agents,
    ...enterpriseDepts.flatMap(d => d.agents),
  ];
  const agentCount = allAgents.length;
  const deptCount = 3 + enterpriseDepts.length; // personal + skills + content + enterprise depts
  console.log(`[boot] ${agentCount} agents dormant across ${deptCount} departments`);

  // Subscribe each agent to A2A bus
  for (const agent of allAgents) {
    if (!a2aBus.getSubscribers().includes(agent.id)) {
      a2aBus.subscribe(agent.id, async (msg) => {
        console.log(`[A2A] ${agent.id} ← ${msg.type} from ${msg.from}: ${msg.subject}`);
      });
    }
  }

  // 7. Sidecar
  const sidecarManager = new SidecarManager();

  // 8. Server
  console.log("[boot] Starting HTTP server...");
  const app = buildServer({
    orchestrator,
    sidecar: sidecarManager,
    mcp: mcpRouter,
    llm,
    a2a: a2aBus,
  });

  // Use Bun.serve when running under Bun, @hono/node-server otherwise
  let serverClose: () => void;
  const isBun = typeof Bun !== "undefined";

  if (isBun) {
    const bunServer = (Bun as any).serve({
      port: cfg.daemonPort,
      hostname: "127.0.0.1",
      fetch: app.fetch,
    });
    serverClose = () => bunServer.stop();
  } else {
    const nodeServer = serve({
      fetch: app.fetch,
      port: cfg.daemonPort,
      hostname: "127.0.0.1",
    });
    serverClose = () => nodeServer.close();
  }

  // 9. Startup audit
  audit.log({
    action: "system_start",
    payload: {
      port: cfg.daemonPort,
      mode: cfg.mode,
      providers,
      agentCount,
    },
  });

  // 10. Ready banner
  console.log(`\n  ✓ JARVIS daemon running at http://127.0.0.1:${cfg.daemonPort}`);
  console.log(`  ✓ ${agentCount} agents across ${deptCount} departments | Mode: ${cfg.mode}`);
  console.log(`  ✓ Browser MCP: Playwright (${mcpRouter.listTools().filter(t => t.name.startsWith("browser_")).length} browser tools)`);
  console.log(`  ✓ Audit chain: ACTIVE`);
  console.log(`  ✓ MCP tools: ${tools.length}`);
  console.log(`  ✓ A2A bus: ${a2aBus.getSubscribers().length} agents subscribed\n`);

  // 11. Slack — connect if bot+app tokens are configured (non-blocking; see SLACK-SETUP.md)
  startSlack(orchestrator).then(ok => { if (ok) console.log("  ✓ Slack: connected — DM or @mention JARVIS"); }).catch(() => {});

  // 12. Resume any autonomous/overnight loops interrupted by the last shutdown.
  const resumed = resumeLoops(orchestrator);
  if (resumed > 0) console.log(`  ✓ Resumed ${resumed} interrupted loop(s)`);

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n[shutdown] JARVIS daemon stopping...");
    audit.log({ action: "system_stop", payload: {} });
    serverClose();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    audit.log({ action: "system_stop", payload: {} });
    serverClose();
    process.exit(0);
  });
}

boot().catch(err => {
  console.error("[FATAL] Boot failed:", err);
  process.exit(1);
});
