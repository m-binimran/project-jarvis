/**
 * Slack Presence Hub — gives every JARVIS agent its own identity in Slack.
 *
 * Slack lets a single bot app post under different display names + avatars per
 * message via the `username` / `icon_emoji` overrides (scope: chat:write.customize).
 * That is the practical way to run 27 agents as 27 "people" without creating 27
 * separate Slack apps. Each agent gets a persona (name + emoji) and the hub posts
 * its messages under that persona.
 *
 * Resilience: if `chat:write.customize` is NOT granted, Slack ignores the username
 * override (every message would show as the bot's name). The hub detects this on
 * the first post and automatically falls back to prefixing each message with a
 * bold agent name, so "who is speaking" stays legible either way.
 *
 * Secrets never leak: every outgoing message passes through OutputFilter first.
 */

import type { WebClient } from "@slack/web-api";
import { filterOutput } from "../authority/firewall.ts";

export interface AgentPersona {
  id: string;
  name: string;
  /** Slack emoji shortcode used as the avatar, e.g. ":mag:". */
  emoji: string;
}

const DEFAULT_EMOJI = ":speech_balloon:";

/** Curated avatars per agent id. Unknown ids fall back to DEFAULT_EMOJI. */
export const AGENT_EMOJI: Record<string, string> = {
  // Personal
  jarvis: ":large_blue_diamond:",
  "research-agent": ":mag:",
  "task-agent": ":clipboard:",
  "comms-agent": ":envelope:",
  "fs-agent": ":file_folder:",
  "calendar-agent": ":calendar:",
  "code-agent": ":computer:",
  // Skills
  "email-drafter": ":pencil2:",
  "daily-briefing": ":sunrise:",
  "screen-explainer": ":tv:",
  "reply-faster": ":zap:",
  "quick-capture": ":memo:",
  // Content department
  "content-lead": ":clapper:",
  "hooks-agent": ":fishing_pole_and_fish:",
  "script-agent": ":scroll:",
  "content-researcher": ":books:",
  // Enterprise
  ceo: ":crown:",
  "marketing-lead": ":loudspeaker:",
  "content-enterprise": ":newspaper:",
  "social-agent": ":bird:",
  "analytics-agent": ":bar_chart:",
  "ops-lead": ":gear:",
  "project-agent": ":pushpin:",
  "automation-agent": ":robot_face:",
  "finance-lead": ":moneybag:",
  "budget-agent": ":money_with_wings:",
  "docs-agent": ":page_facing_up:",
  // Advisors
  "advisor-naval": ":compass:",
  "advisor-hormozi": ":money_mouth_face:",
  "advisor-pg": ":bulb:",
};

/** Title-case an agent id into a display name, e.g. "research-agent" → "Research". */
export function defaultPersona(id: string): AgentPersona {
  const name = id
    .replace(/^advisor-/, "")
    .replace(/[-_]/g, " ")
    .replace(/\bagent\b/i, "")
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase()) || id;
  return { id, name: name || id, emoji: AGENT_EMOJI[id] ?? DEFAULT_EMOJI };
}

/**
 * Build a persona map from the live agent roster + advisor list, so display
 * names always match the actual orchestrator agents (no drift).
 */
export function buildPersonaMap(
  agents: Array<{ id: string; name: string }>,
  advisors: Array<{ id: string; name: string }> = []
): Map<string, AgentPersona> {
  const map = new Map<string, AgentPersona>();
  for (const a of agents) {
    map.set(a.id, { id: a.id, name: a.name, emoji: AGENT_EMOJI[a.id] ?? DEFAULT_EMOJI });
  }
  for (const adv of advisors) {
    const id = `advisor-${adv.id}`;
    map.set(id, { id, name: adv.name, emoji: AGENT_EMOJI[id] ?? ":compass:" });
  }
  if (!map.has("jarvis")) {
    map.set("jarvis", { id: "jarvis", name: "JARVIS", emoji: AGENT_EMOJI.jarvis });
  }
  return map;
}

/** Block Kit blocks for an inline approval prompt with Approve / Deny buttons. */
export function buildApprovalBlocks(
  persona: AgentPersona,
  action: string,
  context: string,
  requestId: string
): unknown[] {
  const detail = context.length > 400 ? `${context.slice(0, 397)}…` : context;
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${persona.name}* needs your approval to *${action}*.`,
      },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: "```" + detail + "```" },
    },
    {
      type: "actions",
      block_id: `approval:${requestId}`,
      elements: [
        {
          type: "button",
          style: "primary",
          text: { type: "plain_text", text: "✅ Approve", emoji: true },
          action_id: "approval_approve",
          value: requestId,
        },
        {
          type: "button",
          style: "danger",
          text: { type: "plain_text", text: "🚫 Deny", emoji: true },
          action_id: "approval_deny",
          value: requestId,
        },
      ],
    },
  ];
}

export class SlackPresenceHub {
  /** Coordinator (JARVIS app) client — used for agents that have no app of their own. */
  private web: WebClient;
  private personas: Map<string, AgentPersona>;
  /** agentId → that agent's OWN Slack app client. Present = real separate identity. */
  private agentClients: Map<string, WebClient>;
  /** Optimistic — flips false the first time a username override is rejected/ignored. */
  private customizeOk = true;

  constructor(
    web: WebClient,
    personas: Map<string, AgentPersona>,
    agentClients?: Map<string, WebClient>
  ) {
    this.web = web;
    this.personas = personas;
    this.agentClients = agentClients ?? new Map();
  }

  personaFor(agentId: string): AgentPersona {
    return this.personas.get(agentId) ?? defaultPersona(agentId);
  }

  /** Swap in a new set of per-agent app clients (e.g. after a token is registered). */
  setAgentClients(clients: Map<string, WebClient>): void {
    this.agentClients = clients;
  }

  /** True if this agent posts under its OWN Slack app (a real separate member). */
  hasOwnApp(agentId: string): boolean {
    return this.agentClients.has(agentId);
  }

  /** How many agents currently have their own app wired up. */
  ownAppCount(): number {
    return this.agentClients.size;
  }

  /** True once a username override was found to be unsupported (missing scope). */
  isCustomizeAvailable(): boolean {
    return this.customizeOk;
  }

  /**
   * Post a message AS the given agent. If the agent has its own Slack app token it
   * posts under its real identity; otherwise it posts via the coordinator app,
   * wearing the agent's name/avatar (chat:write.customize) or a bold name-prefix
   * fallback. OutputFilter is applied to every message. Returns the message ts.
   */
  async say(
    agentId: string,
    channel: string,
    text: string,
    opts?: { threadTs?: string; blocks?: unknown[] }
  ): Promise<string | undefined> {
    const safe = filterOutput(text).sanitized || text || "…";

    // Agent has its own app → post as its real self (no name/avatar override needed).
    const own = this.agentClients.get(agentId);
    if (own) {
      const res = await own.chat.postMessage({
        channel,
        text: safe,
        thread_ts: opts?.threadTs,
        blocks: opts?.blocks as never,
        unfurl_links: false,
        unfurl_media: false,
      });
      return res?.ts as string | undefined;
    }

    return this.postAsPersona(agentId, channel, safe, opts);
  }

  /**
   * Post via the coordinator app, wearing the agent's name + avatar
   * (chat:write.customize) or a bold name-prefix fallback if that scope is missing.
   * `safe` must already be OutputFilter-sanitized.
   */
  private async postAsPersona(
    agentId: string,
    channel: string,
    safe: string,
    opts?: { threadTs?: string; blocks?: unknown[] }
  ): Promise<string | undefined> {
    const persona = this.personaFor(agentId);
    const common = {
      channel,
      thread_ts: opts?.threadTs,
      blocks: opts?.blocks as never,
      unfurl_links: false,
      unfurl_media: false,
    };

    // Known-unsupported: post plainly with a bold name prefix so identity stays clear.
    if (!this.customizeOk) {
      const res = await this.web.chat.postMessage({ ...common, text: `*${persona.name}*  ${safe}` });
      return res?.ts as string | undefined;
    }

    // Optimistic: post under the persona's own name + avatar.
    try {
      const res = await this.web.chat.postMessage({
        ...common,
        text: safe,
        username: persona.name,
        icon_emoji: persona.emoji,
      });
      // Silent-ignore detection: Slack echoed a different username than we set.
      const echoed = (res as { message?: { username?: string } })?.message?.username;
      if (echoed && echoed !== persona.name) this.customizeOk = false;
      return res?.ts as string | undefined;
    } catch (e) {
      const err = String((e as { data?: { error?: string } })?.data?.error ?? e);
      // Missing chat:write.customize (or token can't customize) → switch modes + retry plainly.
      if (/customize|missing_scope|not_allowed_token_type|invalid_arguments|username/i.test(err)) {
        this.customizeOk = false;
        try {
          const res = await this.web.chat.postMessage({ ...common, text: `*${persona.name}*  ${safe}` });
          return res?.ts as string | undefined;
        } catch { /* fall through to rethrow original */ }
      }
      throw e;
    }
  }

  /**
   * Post an inline approval prompt (Approve / Deny buttons). Always sent by the
   * coordinator app — so its Socket Mode connection receives the button click —
   * but attributed in-card to the agent that actually needs the approval.
   */
  async requestApproval(
    agentId: string,
    channel: string,
    threadTs: string | undefined,
    action: string,
    context: string,
    requestId: string
  ): Promise<string | undefined> {
    const persona = this.personaFor(agentId);
    const safeContext = filterOutput(context).sanitized || context || "";
    const blocks = buildApprovalBlocks(persona, action, safeContext, requestId);
    return this.postAsPersona(
      "jarvis",
      channel,
      `${persona.name} needs approval to ${action}`,
      { threadTs, blocks }
    );
  }

  /** Best-effort: replace an approval prompt with its resolved state (removes buttons). */
  async resolveApprovalMessage(
    agentId: string,
    channel: string,
    ts: string,
    approved: boolean,
    action: string
  ): Promise<void> {
    const persona = this.personaFor(agentId);
    const verdict = approved ? "✅ Approved" : "🚫 Denied";
    try {
      await this.web.chat.update({
        channel,
        ts,
        text: `${verdict} — ${action}`,
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: `*${persona.name}* — *${action}*\n${verdict}` },
          },
        ] as never,
      });
    } catch { /* update is best-effort; the follow-up message still confirms */ }
  }
}
