/**
 * Slack multi-agent presence verification — run with:
 *   node --experimental-strip-types verify-slack-presence.ts
 *
 * Deterministic. No Slack workspace, tokens, or LLM required. Uses a fake Slack
 * web client to prove the presence layer:
 *   - each agent posts under its own name + avatar (username / icon_emoji override)
 *   - if chat:write.customize is missing, it auto-falls back to a bold name prefix
 *   - OutputFilter still redacts secrets before anything reaches Slack
 *   - approval prompts render Approve/Deny buttons carrying the request id
 */

import {
  SlackPresenceHub,
  buildPersonaMap,
  buildApprovalBlocks,
  defaultPersona,
  AGENT_EMOJI,
} from "./src/slack/presence.ts";

// ── Fake Slack WebClient ──────────────────────────────────────────────────────
interface PostArgs {
  channel: string; text?: string; thread_ts?: string;
  username?: string; icon_emoji?: string; blocks?: unknown[];
}
function makeFakeWeb(opts?: { failCustomizeOnce?: boolean }) {
  const posts: PostArgs[] = [];
  const updates: Array<{ channel: string; ts: string; text?: string; blocks?: unknown[] }> = [];
  let failedYet = false;
  const web = {
    posts,
    updates,
    chat: {
      postMessage: async (args: PostArgs) => {
        if (opts?.failCustomizeOnce && args.username && !failedYet) {
          failedYet = true;
          const e = new Error("missing_scope") as Error & { data?: { error: string } };
          e.data = { error: "missing_scope" };
          throw e;
        }
        posts.push(args);
        return { ok: true, ts: `ts-${posts.length}`, message: { username: args.username } };
      },
      update: async (args: { channel: string; ts: string; text?: string; blocks?: unknown[] }) => {
        updates.push(args);
        return { ok: true, ts: args.ts };
      },
    },
  };
  return web;
}

const SECRET = "sk-ant-api03-ZZxxCCvvBBnnMMaaSSddFFgg1234567890abcd";

// ── Cases ─────────────────────────────────────────────────────────────────────
interface Case { name: string; fn: () => boolean | Promise<boolean>; }
const cases: Case[] = [

  // ── Persona resolution ──
  {
    name: "Persona map uses real agent names + curated emoji",
    fn: () => {
      const map = buildPersonaMap(
        [{ id: "research-agent", name: "Research" }, { id: "ceo", name: "CEO" }],
        [{ id: "naval", name: "Naval Ravikant" }],
      );
      const hub = new SlackPresenceHub(makeFakeWeb() as never, map);
      const r = hub.personaFor("research-agent");
      const c = hub.personaFor("ceo");
      const n = hub.personaFor("advisor-naval");
      return r.name === "Research" && r.emoji === AGENT_EMOJI["research-agent"]
        && c.name === "CEO" && c.emoji === ":crown:"
        && n.name === "Naval Ravikant" && n.emoji === ":compass:";
    },
  },
  {
    name: "Unknown agent id falls back to a title-cased persona",
    fn: () => {
      const p = defaultPersona("totally-unknown");
      const a = defaultPersona("advisor-naval");
      const b = defaultPersona("budget-agent");
      return p.name === "Totally Unknown" && p.emoji === ":speech_balloon:"
        && a.name === "Naval" && b.name === "Budget";
    },
  },

  // ── Posting as a persona ──
  {
    name: "say() posts under the agent's name + avatar",
    fn: async () => {
      const web = makeFakeWeb();
      const hub = new SlackPresenceHub(web as never, buildPersonaMap([{ id: "research-agent", name: "Research" }]));
      const ts = await hub.say("research-agent", "C1", "found 3 sources", { threadTs: "T1" });
      const post = web.posts[0];
      return ts === "ts-1" && post.username === "Research" && post.icon_emoji === ":mag:"
        && post.channel === "C1" && post.thread_ts === "T1" && post.text === "found 3 sources";
    },
  },
  {
    name: "say() redacts secrets via OutputFilter before sending",
    fn: async () => {
      const web = makeFakeWeb();
      const hub = new SlackPresenceHub(web as never, buildPersonaMap([{ id: "jarvis", name: "JARVIS" }]));
      await hub.say("jarvis", "C1", `your key is ${SECRET}`);
      const text = web.posts[0].text ?? "";
      return !text.includes(SECRET) && text.includes("[REDACTED");
    },
  },
  {
    name: "Agent with its OWN app posts under its real identity (no override)",
    fn: async () => {
      const coord = makeFakeWeb();
      const own = makeFakeWeb();
      const clients = new Map<string, never>([["research-agent", own as never]]);
      const hub = new SlackPresenceHub(
        coord as never,
        buildPersonaMap([{ id: "research-agent", name: "Research" }]),
        clients as never,
      );
      const ts = await hub.say("research-agent", "C1", "found 3 sources", { threadTs: "T1" });
      const ownPost = own.posts[0];
      return hub.hasOwnApp("research-agent") === true
        && coord.posts.length === 0           // not routed through the coordinator
        && own.posts.length === 1
        && ownPost.username === undefined      // real app identity — no username override
        && ownPost.text === "found 3 sources" && ts === "ts-1";
    },
  },

  // ── Fallback when chat:write.customize is missing ──
  {
    name: "Missing customize scope → auto-fallback to bold name prefix",
    fn: async () => {
      const web = makeFakeWeb({ failCustomizeOnce: true });
      const hub = new SlackPresenceHub(web as never, buildPersonaMap([{ id: "ceo", name: "CEO" }]));
      const ts = await hub.say("ceo", "C1", "shipping it");
      const post = web.posts[0];
      // retried without username override, identity preserved via bold prefix
      return ts === "ts-1" && post.username === undefined
        && (post.text ?? "").startsWith("*CEO*") && hub.isCustomizeAvailable() === false;
    },
  },
  {
    name: "After fallback, later messages keep the name prefix",
    fn: async () => {
      const web = makeFakeWeb({ failCustomizeOnce: true });
      const hub = new SlackPresenceHub(web as never, buildPersonaMap([{ id: "ceo", name: "CEO" }]));
      await hub.say("ceo", "C1", "first");      // triggers fallback
      await hub.say("ceo", "C1", "second");     // should already be in prefix mode
      const second = web.posts[1];
      return second.username === undefined && (second.text ?? "").startsWith("*CEO*  second");
    },
  },

  // ── Approval prompt ──
  {
    name: "buildApprovalBlocks renders Approve/Deny carrying the request id",
    fn: () => {
      const blocks = buildApprovalBlocks(defaultPersona("comms-agent"), "send_message", "email to bob", "REQ-9") as Array<Record<string, unknown>>;
      const actions = blocks[blocks.length - 1] as { type: string; block_id?: string; elements: Array<{ action_id: string; value: string; style?: string }> };
      const approve = actions.elements.find(e => e.action_id === "approval_approve");
      const deny = actions.elements.find(e => e.action_id === "approval_deny");
      return actions.type === "actions"
        && actions.block_id === "approval:REQ-9"
        && !!approve && approve.value === "REQ-9" && approve.style === "primary"
        && !!deny && deny.value === "REQ-9" && deny.style === "danger";
    },
  },
  {
    name: "requestApproval posts buttons via coordinator, attributed to the agent",
    fn: async () => {
      const web = makeFakeWeb();
      const hub = new SlackPresenceHub(web as never, buildPersonaMap([{ id: "comms-agent", name: "Communications" }]));
      const ts = await hub.requestApproval("comms-agent", "C1", "T1", "send_message", "email to bob", "REQ-1");
      const post = web.posts[0];
      const blocks = (post.blocks ?? []) as Array<Record<string, unknown>>;
      const hasActions = blocks.some(b => b.type === "actions");
      // Posted by the coordinator (JARVIS) so its socket gets the click — card names the agent.
      return ts === "ts-1" && post.username === "JARVIS" && post.thread_ts === "T1"
        && hasActions && JSON.stringify(blocks[0] ?? {}).includes("Communications");
    },
  },
  {
    name: "resolveApprovalMessage updates the prompt and drops the buttons",
    fn: async () => {
      const web = makeFakeWeb();
      const hub = new SlackPresenceHub(web as never, buildPersonaMap([{ id: "comms-agent", name: "Communications" }]));
      await hub.resolveApprovalMessage("comms-agent", "C1", "ts-1", true, "send_message");
      const upd = web.updates[0];
      const blocks = (upd.blocks ?? []) as Array<Record<string, unknown>>;
      const hasButtons = blocks.some(b => b.type === "actions");
      return upd.ts === "ts-1" && !hasButtons && (upd.text ?? "").includes("Approved");
    },
  },
];

// ── Runner ──────────────────────────────────────────────────────────────────
const failures: string[] = [];
let pass = 0;
for (const c of cases) {
  let ok = false;
  try { ok = await c.fn(); } catch (e) { ok = false; failures.push(`  FAIL [threw ${(e as Error).message}]  ${c.name}`); }
  if (ok) pass++;
  else if (!failures.some(f => f.includes(c.name))) failures.push(`  FAIL  ${c.name}`);
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}`);
}

console.log(`\n${"=".repeat(50)}\n${pass}/${cases.length} passed`);
if (failures.length > 0) {
  console.log("\nFAILURES:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("ALL SLACK PRESENCE CHECKS PASSED ✅");
process.exit(0);
