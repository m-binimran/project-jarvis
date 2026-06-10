/**
 * Slack bot — JARVIS runs as a multi-agent **workforce** in Slack (Decision 24, V2).
 *
 * The company model:
 *   - JARVIS is the orchestrator. It assigns work to **team leads** (managers).
 *   - Each lead briefs its **sub-agents** (workers); the workers do the work and
 *     report back ("done, your turn"); the lead reviews + perfects + combines.
 *   - If several departments are involved, the leads "meet" and JARVIS merges.
 *   - JARVIS does the final review, corrects, and delivers.
 *
 * Each agent can post under its OWN Slack app (a real separate member) once you
 * register that app's bot token — see registerAgentToken / SLACK-SETUP.md. Until
 * then, an agent posts via the coordinator app wearing its name + avatar
 * (chat:write.customize) or a bold name-prefix fallback. So you can onboard the
 * 27 agents' apps incrementally and it works the whole way.
 *
 * Transport: Socket Mode (no public URL). Only the JARVIS app needs the app-level
 * token + Socket Mode + Interactivity (it hears you and owns the Approve/Deny
 * buttons). Worker/lead apps only need a bot token with chat:write to post.
 *
 * Keychain:
 *   - slack_bot_token        (xoxb-…)  JARVIS coordinator bot token
 *   - slack_app_token        (xapp-…)  app-level token, connections:write (Socket Mode)
 *   - slack_agent:<agentId>  (xoxb-…)  each agent's OWN app bot token (optional, per agent)
 */

import { SocketModeClient } from "@slack/socket-mode";
import { WebClient } from "@slack/web-api";
import { getProviderKey, getKey, listKeys } from "../config/keychain.ts";
import { scanMessage } from "../authority/scanner.ts";
import type { Orchestrator, AgentMessageEvent } from "../agents/orchestrator.ts";
import { getApprovalManager } from "../authority/approvals.ts";
import { listAdvisors } from "../agents/advisor-council.ts";
import { SlackPresenceHub, buildPersonaMap } from "./presence.ts";

const AGENT_TOKEN_PREFIX = "slack_agent:";

let started = false;
let moduleHub: SlackPresenceHub | null = null;

/** Cap a chunk of text so a single Slack message stays readable. */
function clip(text: string, max: number): string {
  const t = (text ?? "").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Trivial chatter → a quick single-agent reply; anything substantial → the workforce. */
function isQuickAsk(text: string): boolean {
  const t = text.trim();
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length <= 4) return true;
  return /^(hi|hey|hello|yo|sup|thanks|thank you|ok|okay|cool|nice|gm|good morning)\b/i.test(t);
}

/** Build the agentId → own-app WebClient map from registered per-agent tokens. */
async function buildAgentClients(): Promise<Map<string, WebClient>> {
  const clients = new Map<string, WebClient>();
  let keys: { account: string }[] = [];
  try { keys = await listKeys(); } catch { return clients; }
  for (const k of keys) {
    if (!k.account.startsWith(AGENT_TOKEN_PREFIX)) continue;
    const agentId = k.account.slice(AGENT_TOKEN_PREFIX.length);
    if (!agentId || agentId === "jarvis") continue; // jarvis = the coordinator app itself
    const token = await getKey(k.account);
    if (token) clients.set(agentId, new WebClient(token));
  }
  return clients;
}

/** Re-read per-agent tokens and update the live hub (call after registering a token). */
export async function refreshAgentApps(): Promise<number> {
  if (!moduleHub) return 0;
  const clients = await buildAgentClients();
  moduleHub.setAgentClients(clients);
  console.log(`[Slack] Agent apps refreshed — ${clients.size} agent(s) now post under their own identity.`);
  return clients.size;
}

export async function startSlack(orchestrator: Orchestrator): Promise<boolean> {
  const botToken = await getProviderKey("slack_bot_token");
  const appToken = await getProviderKey("slack_app_token");
  if (!botToken || !appToken) return false; // not configured — silently skip
  if (started) return true;

  const web = new WebClient(botToken);
  const socket = new SocketModeClient({ appToken });

  // Our own bot user id, so we never reply to ourselves.
  let botUserId = "";
  try {
    const auth = await web.auth.test();
    botUserId = String(auth.user_id ?? "");
  } catch { /* non-fatal */ }

  // Personas (names + emoji) from the live roster, + per-agent app clients.
  const roster = orchestrator.getDepartments().flatMap(d => d.agents.map(a => ({ id: a.id, name: a.name })));
  let advisors: Array<{ id: string; name: string }> = [];
  try { advisors = listAdvisors().map(a => ({ id: a.id, name: a.name })); } catch { /* db not ready — fine */ }
  const agentClients = await buildAgentClients();
  const hub = new SlackPresenceHub(web, buildPersonaMap(roster, advisors), agentClients);
  moduleHub = hub;

  // ⏳ "working" indicator on the user's message (best-effort; needs reactions:write).
  const react = async (channel: string, ts: string, add: boolean) => {
    try {
      if (add) await web.reactions.add({ channel, timestamp: ts, name: "hourglass_flowing_sand" });
      else await web.reactions.remove({ channel, timestamp: ts, name: "hourglass_flowing_sand" });
    } catch { /* missing scope or already (un)reacted — ignore */ }
  };

  /** Render one beat of the inter-agent conversation into the thread. */
  const renderBeat = async (channel: string, threadTs: string, m: AgentMessageEvent) => {
    const toName = m.to ? hub.personaFor(m.to).name : "";
    if (m.kind === "handoff") {
      await hub.say(m.from, channel, `→ *@${toName}*  ${clip(m.text, 280)}`, { threadTs });
    } else if (m.kind === "escalate") {
      await hub.say(m.from, channel, `⬆️ escalating to *@${toName}*  ${clip(m.text, 280)}`, { threadTs });
    } else {
      // response / note / final — the agent speaks in its own voice
      await hub.say(m.from, channel, clip(m.text, 1400), { threadTs });
    }
  };

  /** Surface a circuit-breaker approval as inline buttons; wait for the decision. */
  const askApproval = async (
    channel: string, threadTs: string, action: string, context: string, agentId?: string,
  ): Promise<boolean> => {
    const who = agentId || "jarvis";
    const mgr = getApprovalManager();
    const { requestId, promise } = mgr.request(who, action, context);
    const ts = await hub.requestApproval(who, channel, threadTs, action, context, requestId);
    const approved = await promise; // resolved by a button click, the overlay, or 60s auto-deny
    if (ts) await hub.resolveApprovalMessage(who, channel, ts, approved, action);
    if (approved) await hub.say(who, channel, "Approved — proceeding. ✅", { threadTs });
    return approved;
  };

  /** Run one user request — as the full workforce, or a quick single-agent reply. */
  const handle = async (event: {
    user?: string; bot_id?: string; subtype?: string;
    text?: string; channel?: string; ts?: string; thread_ts?: string;
  }) => {
    if (!event || event.bot_id || event.subtype) return;     // ignore bot/system/persona posts
    if (event.user && event.user === botUserId) return;       // ignore our own messages
    const channel = event.channel;
    if (!channel) return;
    const text = (event.text ?? "").replace(/<@[A-Z0-9]+>/g, "").trim(); // strip the @mention
    if (!text) return;

    const rootTs = event.thread_ts ?? event.ts ?? undefined;  // thread the whole conversation
    const thread = rootTs ?? event.ts ?? "";
    const userMsgTs = event.ts;

    const scan = scanMessage(text);
    if (scan.risk === "blocked") {
      await hub.say("jarvis", channel, `⚠️ ${scan.reason}`, { threadTs: rootTs });
      return;
    }

    if (userMsgTs) await react(channel, userMsgTs, true);
    try {
      if (isQuickAsk(text)) {
        // Quick path — one agent answers (no full company spin-up).
        const result = await orchestrator.dispatch({
          userMessage: text,
          conversationId: "slack:" + channel,
          onAgentMessage: (m) => renderBeat(channel, thread, m),
          onApprovalNeeded: (action, context, agentId) => askApproval(channel, thread, action, context, agentId),
        });
        const responder = result.agentId && result.agentId !== "none" ? result.agentId : "jarvis";
        await hub.say(responder, channel, result.output || "…", { threadTs: rootTs });
      } else {
        // Workforce path — JARVIS runs the company; the deliverable comes back from JARVIS.
        const result = await orchestrator.runWorkforce({
          userMessage: text,
          conversationId: "slack:" + channel,
          onAgentMessage: (m) => renderBeat(channel, thread, m),
          onApprovalNeeded: (action, context, agentId) => askApproval(channel, thread, action, context, agentId),
        });
        await hub.say("jarvis", channel, `*Final deliverable*\n${result.output || "…"}`, { threadTs: rootTs });
      }
    } catch (err) {
      await hub.say("jarvis", channel, "Hit an error handling that: " + String(err), { threadTs: rootTs });
    } finally {
      if (userMsgTs) await react(channel, userMsgTs, false);
    }
  };

  // @mentions in channels
  socket.on("app_mention", async ({ event, ack }: { event: Record<string, unknown>; ack: () => Promise<void> }) => {
    await ack();
    await handle(event as Parameters<typeof handle>[0]);
  });

  // direct messages to the bot (ignore channel messages here to avoid double-replies)
  socket.on("message", async ({ event, ack }: { event: Record<string, unknown>; ack: () => Promise<void> }) => {
    await ack();
    if ((event as { channel_type?: string }).channel_type === "im") {
      await handle(event as Parameters<typeof handle>[0]);
    }
  });

  // Approve / Deny button clicks — resolve the pending approval.
  socket.on("interactive", async ({ body, ack }: { body: Record<string, unknown>; ack: () => Promise<void> }) => {
    await ack();
    try {
      const actions = (body as { actions?: Array<{ action_id?: string; value?: string }> }).actions;
      const action = actions?.[0];
      if (action?.action_id !== "approval_approve" && action?.action_id !== "approval_deny") return;
      const requestId = String(action?.value ?? "");
      if (!requestId) return;
      getApprovalManager().respond(requestId, action.action_id === "approval_approve");
    } catch { /* malformed payload — ignore */ }
  });

  await socket.start();
  started = true;
  console.log(`[Slack] Connected — ${roster.length} agents, ${agentClients.size} with their own app. @mention JARVIS; the workforce runs in a thread.`);
  return true;
}
