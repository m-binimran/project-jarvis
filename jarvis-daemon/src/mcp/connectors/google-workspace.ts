/**
 * Google Workspace MCP Connector
 * Provides Gmail and Google Calendar tools to the MCPRouter.
 *
 * Auth: OAuth 2.0 with stored refresh token (kept in OS keychain).
 * Setup flow:
 *   1. POST /api/auth/google      → returns { authUrl }
 *   2. User approves in browser
 *   3. GET /api/auth/google/callback?code=... → exchanges code, stores tokens
 *   4. Connector is now live
 *
 * Scopes required:
 *   gmail.readonly, gmail.send, gmail.modify
 *   calendar.readonly, calendar.events
 */

import { getKeychain } from "../../config/keychain.ts";
import type { MCPConnector } from "../router.ts";

const KEYCHAIN_NS  = "jarvis-google";
const REFRESH_KEY  = "google_refresh_token";
const CREDS_KEY    = "google_oauth_creds";    // JSON { client_id, client_secret }

const TOKEN_URL    = "https://oauth2.googleapis.com/token";
const GMAIL_BASE   = "https://gmail.googleapis.com/gmail/v1";
const CAL_BASE     = "https://www.googleapis.com/calendar/v3";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

// ─── Credential management ───────────────────────────────────────────────────

interface OAuthCreds { client_id: string; client_secret: string; }
interface TokenCache { access_token: string; expires_at: number; }

let _cache: TokenCache | null = null;

function kc() { return getKeychain(); }

export async function storeOAuthCreds(clientId: string, clientSecret: string) {
  await kc().set(KEYCHAIN_NS, CREDS_KEY, JSON.stringify({ client_id: clientId, client_secret: clientSecret }));
}

export async function storeRefreshToken(token: string) {
  await kc().set(KEYCHAIN_NS, REFRESH_KEY, token);
  _cache = null;
}

export async function isGoogleConnected(): Promise<boolean> {
  return !!(await kc().get(KEYCHAIN_NS, REFRESH_KEY));
}

export async function getGoogleAuthUrl(redirectUri: string): Promise<string | null> {
  const raw = await kc().get(KEYCHAIN_NS, CREDS_KEY);
  if (!raw) return null;
  const creds: OAuthCreds = JSON.parse(raw);
  const p = new URLSearchParams({
    client_id: creds.client_id, redirect_uri: redirectUri,
    response_type: "code", scope: SCOPES,
    access_type: "offline", prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export async function exchangeCodeForTokens(code: string, redirectUri: string) {
  const raw = await kc().get(KEYCHAIN_NS, CREDS_KEY);
  if (!raw) throw new Error("OAuth credentials not set — POST /api/auth/google/creds first");
  const creds: OAuthCreds = JSON.parse(raw);

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code", code, redirect_uri: redirectUri,
      client_id: creds.client_id, client_secret: creds.client_secret,
    }),
  });
  if (!res.ok) throw new Error(`OAuth exchange failed: ${await res.text()}`);
  const data = await res.json() as { refresh_token?: string; access_token: string; expires_in: number };
  if (!data.refresh_token) throw new Error("No refresh token returned — ensure prompt=consent in auth URL");
  await storeRefreshToken(data.refresh_token);
}

async function getAccessToken(): Promise<string> {
  if (_cache && Date.now() < _cache.expires_at - 60_000) return _cache.access_token;

  const raw  = await kc().get(KEYCHAIN_NS, CREDS_KEY);
  const rTok = await kc().get(KEYCHAIN_NS, REFRESH_KEY);
  if (!raw || !rTok) throw new Error("Google Workspace not connected");

  const creds: OAuthCreds = JSON.parse(raw);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token", refresh_token: rTok,
      client_id: creds.client_id, client_secret: creds.client_secret,
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  const data = await res.json() as { access_token: string; expires_in: number };
  _cache = { access_token: data.access_token, expires_at: Date.now() + data.expires_in * 1000 };
  return _cache.access_token;
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function gGet(base: string, path: string) {
  const tok = await getAccessToken();
  const r = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${tok}` } });
  if (!r.ok) throw new Error(`Google API ${r.status}: ${await r.text()}`);
  return r.json();
}

async function gPost(base: string, path: string, body: unknown) {
  const tok = await getAccessToken();
  const r = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Google API ${r.status}: ${await r.text()}`);
  return r.json();
}

// ─── Email helpers ────────────────────────────────────────────────────────────

function header(list: Array<{ name: string; value: string }>, name: string) {
  return list.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function b64urlDecode(s: string) {
  try { return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8"); }
  catch { return "[decode error]"; }
}

function extractBody(payload: Record<string, unknown>): string {
  const body = payload.body as any;
  if (body?.data) return b64urlDecode(body.data);
  const parts = payload.parts as any[];
  if (parts) {
    for (const p of parts) {
      if (p.mimeType === "text/plain" && p.body?.data) return b64urlDecode(p.body.data);
    }
    for (const p of parts) {
      const nested = extractBody(p);
      if (nested) return nested;
    }
  }
  return "";
}

// ─── Connector definition ─────────────────────────────────────────────────────

export function buildGoogleWorkspaceConnector(): MCPConnector {
  return {
    id: "google-workspace",
    name: "Google Workspace",
    description: "Gmail and Google Calendar",
    tools: [

      // ── Gmail ──────────────────────────────────────────────────────────────

      {
        name: "list_emails",
        description: "List recent Gmail messages. Returns from/subject/date/snippet.",
        category: "read_file",
        inputSchema: {
          maxResults: { type: "number" },
          query: { type: "string", description: "Gmail search query (e.g. 'is:unread from:boss@company.com')" },
        },
        async handler(p) {
          const max = Math.min((p.maxResults as number | undefined) ?? 10, 50);
          const q   = p.query ? `&q=${encodeURIComponent(p.query as string)}` : "";
          const data = await gGet(GMAIL_BASE, `/users/me/messages?maxResults=${max}${q}`) as any;
          if (!data.messages?.length) return { emails: [] };

          const emails = await Promise.all(
            data.messages.slice(0, max).map(async (m: { id: string }) => {
              const msg = await gGet(GMAIL_BASE, `/users/me/messages/${m.id}?format=metadata&metadataHeaders=From,Subject,Date`) as any;
              const h   = msg.payload?.headers ?? [];
              return { id: m.id, from: header(h, "From"), subject: header(h, "Subject"), date: header(h, "Date"), snippet: msg.snippet ?? "" };
            })
          );
          return { emails };
        },
      },

      {
        name: "read_email",
        description: "Read the full content of a Gmail message by ID.",
        category: "read_file",
        inputSchema: { emailId: { type: "string", required: true } },
        async handler(p) {
          const msg  = await gGet(GMAIL_BASE, `/users/me/messages/${p.emailId}?format=full`) as any;
          const h    = msg.payload?.headers ?? [];
          const body = extractBody(msg.payload ?? {});
          return {
            id: msg.id,
            from: header(h, "From"), to: header(h, "To"),
            subject: header(h, "Subject"), date: header(h, "Date"),
            body: body.slice(0, 8000),
          };
        },
      },

      {
        name: "search_emails",
        description: "Search Gmail using Gmail query syntax. Returns matching messages.",
        category: "read_file",
        inputSchema: {
          query: { type: "string", required: true },
          maxResults: { type: "number" },
        },
        async handler(p) {
          const max  = Math.min((p.maxResults as number | undefined) ?? 10, 20);
          const data = await gGet(GMAIL_BASE, `/users/me/messages?maxResults=${max}&q=${encodeURIComponent(p.query as string)}`) as any;
          if (!data.messages?.length) return { emails: [], count: 0 };

          const emails = await Promise.all(
            data.messages.map(async (m: { id: string }) => {
              const msg = await gGet(GMAIL_BASE, `/users/me/messages/${m.id}?format=metadata&metadataHeaders=From,Subject,Date`) as any;
              const h   = msg.payload?.headers ?? [];
              return { id: m.id, from: header(h, "From"), subject: header(h, "Subject"), date: header(h, "Date"), snippet: msg.snippet ?? "" };
            })
          );
          return { emails, count: emails.length };
        },
      },

      {
        name: "send_email",
        description: "Send an email via Gmail. CIRCUIT BREAKER — always requires explicit user approval.",
        category: "send_email",   // ← triggers circuit breaker in AuthorityEngine
        inputSchema: {
          to:      { type: "string", required: true, description: "Recipient email" },
          subject: { type: "string", required: true },
          body:    { type: "string", required: true, description: "Plain text body" },
          cc:      { type: "string" },
        },
        async handler(p) {
          const lines = [
            `To: ${p.to}`,
            p.cc ? `Cc: ${p.cc}` : null,
            `Subject: ${p.subject}`,
            "Content-Type: text/plain; charset=utf-8",
            "MIME-Version: 1.0",
            "",
            p.body,
          ].filter(Boolean).join("\r\n");

          const raw = Buffer.from(lines as string).toString("base64url");
          await gPost(GMAIL_BASE, "/users/me/messages/send", { raw });
          return { success: true, to: p.to, subject: p.subject };
        },
      },

      // ── Calendar ────────────────────────────────────────────────────────────

      {
        name: "list_calendar_events",
        description: "List upcoming Google Calendar events.",
        category: "read_file",
        inputSchema: {
          maxResults: { type: "number" },
          daysAhead:  { type: "number", description: "Days ahead to look (default 7)" },
          calendarId: { type: "string", description: "Calendar ID (default: primary)" },
        },
        async handler(p) {
          const max    = (p.maxResults as number | undefined) ?? 10;
          const days   = (p.daysAhead  as number | undefined) ?? 7;
          const calId  = encodeURIComponent((p.calendarId as string | undefined) ?? "primary");
          const tMin   = new Date().toISOString();
          const tMax   = new Date(Date.now() + days * 86400_000).toISOString();

          const data = await gGet(CAL_BASE, `/calendars/${calId}/events?maxResults=${max}&timeMin=${tMin}&timeMax=${tMax}&singleEvents=true&orderBy=startTime`) as any;
          const events = (data.items ?? []).map((e: any) => ({
            id:          e.id,
            summary:     e.summary ?? "(no title)",
            start:       e.start?.dateTime ?? e.start?.date,
            end:         e.end?.dateTime   ?? e.end?.date,
            location:    e.location ?? null,
            description: e.description ? (e.description as string).slice(0, 200) : null,
          }));
          return { events, count: events.length };
        },
      },

      {
        name: "create_calendar_event",
        description: "Create a new event in Google Calendar.",
        category: "calendar_write",
        inputSchema: {
          summary:       { type: "string", required: true, description: "Event title" },
          startDateTime: { type: "string", required: true, description: "ISO 8601 start (e.g. 2026-05-28T14:00:00)" },
          endDateTime:   { type: "string", required: true, description: "ISO 8601 end" },
          description:   { type: "string" },
          location:      { type: "string" },
          calendarId:    { type: "string" },
        },
        async handler(p) {
          const calId = encodeURIComponent((p.calendarId as string | undefined) ?? "primary");
          const event = await gPost(CAL_BASE, `/calendars/${calId}/events`, {
            summary:     p.summary,
            description: p.description,
            location:    p.location,
            start: { dateTime: p.startDateTime, timeZone: "UTC" },
            end:   { dateTime: p.endDateTime,   timeZone: "UTC" },
          }) as any;
          return { success: true, eventId: event.id, htmlLink: event.htmlLink };
        },
      },

      {
        name: "search_calendar_events",
        description: "Search Google Calendar events by keyword.",
        category: "read_file",
        inputSchema: {
          query:      { type: "string", required: true },
          maxResults: { type: "number" },
        },
        async handler(p) {
          const max  = (p.maxResults as number | undefined) ?? 10;
          const data = await gGet(CAL_BASE, `/calendars/primary/events?maxResults=${max}&q=${encodeURIComponent(p.query as string)}&singleEvents=true&timeMin=${new Date().toISOString()}`) as any;
          const events = (data.items ?? []).map((e: any) => ({
            id: e.id, summary: e.summary ?? "(no title)",
            start: e.start?.dateTime ?? e.start?.date,
            end:   e.end?.dateTime   ?? e.end?.date,
          }));
          return { events, count: events.length };
        },
      },

      {
        name: "get_calendar_event",
        description: "Get full details of a Google Calendar event by ID.",
        category: "read_file",
        inputSchema: {
          eventId:    { type: "string", required: true },
          calendarId: { type: "string" },
        },
        async handler(p) {
          const calId = encodeURIComponent((p.calendarId as string | undefined) ?? "primary");
          const e = await gGet(CAL_BASE, `/calendars/${calId}/events/${p.eventId}`) as any;
          return {
            id: e.id, summary: e.summary,
            start: e.start?.dateTime ?? e.start?.date,
            end:   e.end?.dateTime   ?? e.end?.date,
            location: e.location, description: e.description,
            attendees: (e.attendees ?? []).map((a: any) => ({ email: a.email, name: a.displayName })),
            htmlLink: e.htmlLink,
          };
        },
      },

    ],
  };
}

/**
 * Register the Google Workspace connector if a refresh token exists.
 * Called from index.ts during boot.
 */
export async function registerGoogleWorkspace(router: import("../router.ts").MCPRouter): Promise<void> {
  if (await isGoogleConnected()) {
    router.register(buildGoogleWorkspaceConnector());
    console.log("[Google Workspace] Connected — Gmail + Calendar tools registered");
  } else {
    console.log("[Google Workspace] Not connected — POST /api/auth/google to begin OAuth setup");
  }
}
