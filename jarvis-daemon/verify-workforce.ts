/**
 * Workforce choreography verification — run with:
 *   node --experimental-strip-types verify-workforce.ts
 *
 * Proves the company-style run (JARVIS → team leads → workers → review → meeting →
 * final) sequences the conversation correctly, using a FAKE brain and a THROWAWAY
 * temp DB (the real ~/.jarvis vault is never touched). We assert the order of the
 * agent-to-agent beats, not their wording — so it's deterministic regardless of
 * what any agent's model would actually say.
 */

import os from "node:os";
import path from "node:path";
import { initDatabase, closeDb } from "./src/vault/schema.ts";

// Throwaway DB first — before any agent touches the vault.
const tmpDb = path.join(os.tmpdir(), `jarvis-verify-workforce-${Date.now()}.db`);
initDatabase(tmpDb);

import { Orchestrator, type AgentMessageEvent } from "./src/agents/orchestrator.ts";
import { buildPersonalDepartment } from "./src/agents/departments.ts";
import { buildContentDepartment } from "./src/agents/content-department.ts";
import { buildEnterpriseDepartments } from "./src/agents/enterprise-department.ts";
import { buildDefaultRouter } from "./src/mcp/router.ts";

// Fake LLM — returns a short tagged string so reflection is skipped and runs are instant.
const fakeLlm = {
  complete: async (_messages: unknown, opts?: { agentId?: string }) => ({
    content: `[${opts?.agentId ?? "agent"} did the work]`,
    usage: { inputTokens: 1, outputTokens: 1 },
    model: "fake",
  }),
  getProviderNames: () => ["fake"],
  getTodayUsage: () => ({ totalTokens: 0 }),
} as never;

const router = buildDefaultRouter();
const orch = new Orchestrator(fakeLlm);
orch.registerDepartment(buildPersonalDepartment(router));   // jarvis lives here
orch.registerDepartment(buildContentDepartment(router));
for (const d of buildEnterpriseDepartments(router)) orch.registerDepartment(d);

async function run(goal: string) {
  const beats: AgentMessageEvent[] = [];
  const result = await orch.runWorkforce({
    userMessage: goal,
    onAgentMessage: (m) => { beats.push(m); },
  });
  return { beats, result };
}

interface Case { name: string; fn: () => Promise<boolean>; }
const cases: Case[] = [

  {
    name: "Single department: JARVIS → lead → workers → report → lead combines",
    fn: async () => {
      const { beats, result } = await run("write a blog article and a video script");
      const kinds = beats.map(b => `${b.kind}:${b.from}->${b.to ?? "-"}`);
      const handoffToLead = beats.some(b => b.kind === "handoff" && b.from === "jarvis" && b.to === "content-lead");
      // a worker is briefed by the lead, then reports back to the lead
      const briefed = beats.some(b => b.kind === "handoff" && b.from === "content-lead" && (b.to === "hooks-agent" || b.to === "script-agent"));
      const reported = beats.some(b => b.kind === "response" && (b.from === "hooks-agent" || b.from === "script-agent") && b.to === "content-lead");
      const leadToJarvis = beats.some(b => b.kind === "response" && b.from === "content-lead" && b.to === "jarvis" && (b.subject ?? "").includes("department"));
      const ok = result.leadCount === 1 && result.agentId === "jarvis" && typeof result.output === "string" && result.output.length > 0
        && beats[0]?.kind === "note" && handoffToLead && briefed && reported && leadToJarvis;
      if (!ok) console.log("   beats:", kinds.join(" | "));
      return ok;
    },
  },

  {
    name: "Worker is briefed BEFORE it reports back (turn order is correct)",
    fn: async () => {
      const { beats } = await run("write a blog article and a video script");
      const briefIdx = beats.findIndex(b => b.kind === "handoff" && b.from === "content-lead" && b.to === "hooks-agent");
      const reportIdx = beats.findIndex(b => b.kind === "response" && b.from === "hooks-agent" && b.to === "content-lead");
      return briefIdx >= 0 && reportIdx >= 0 && briefIdx < reportIdx;
    },
  },

  {
    name: "Multi-department goal triggers two leads + a managers' meeting",
    fn: async () => {
      const { beats, result } = await run("plan a product launch: marketing campaign and budget forecast");
      const leadsAssigned = new Set(
        beats.filter(b => b.kind === "handoff" && b.from === "jarvis").map(b => b.to),
      );
      const meeting = beats.some(b => b.kind === "note" && /managers' meeting/i.test(b.text));
      return result.leadCount === 2 && leadsAssigned.has("marketing-lead") && leadsAssigned.has("finance-lead") && meeting;
    },
  },

  {
    name: "Every beat names a real agent (no phantom ids)",
    fn: async () => {
      const { beats } = await run("draft a sales proposal and a budget");
      const ids = new Set<string>();
      for (const b of beats) { ids.add(b.from); if (b.to) ids.add(b.to); }
      const real = new Set(orch.getDepartments().flatMap(d => d.agents.map(a => a.id)));
      const phantom = [...ids].filter(id => !real.has(id));
      if (phantom.length) console.log("   phantom ids:", phantom.join(", "));
      return phantom.length === 0;
    },
  },

];

const failures: string[] = [];
let pass = 0;
for (const c of cases) {
  let ok = false;
  try { ok = await c.fn(); } catch (e) { ok = false; failures.push(`  FAIL [threw ${(e as Error).message}]  ${c.name}`); }
  if (ok) pass++;
  else if (!failures.some(f => f.includes(c.name))) failures.push(`  FAIL  ${c.name}`);
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}`);
}

closeDb();
try { const { rmSync } = await import("node:fs"); rmSync(tmpDb, { force: true }); rmSync(`${tmpDb}-wal`, { force: true }); rmSync(`${tmpDb}-shm`, { force: true }); } catch { /* temp cleanup */ }

console.log(`\n${"=".repeat(50)}\n${pass}/${cases.length} passed`);
if (failures.length > 0) {
  console.log("\nFAILURES:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("ALL WORKFORCE CHOREOGRAPHY CHECKS PASSED ✅");
process.exit(0);
