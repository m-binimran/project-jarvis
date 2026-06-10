// data.jsx — live data layer
// Loads real data from the JARVIS daemon on port 9101.
// Falls back to mock data when the daemon is offline.

window.DAEMON_URL = 'http://127.0.0.1:9101';

// ── Fallback mock data (shown while daemon loads) ─────────────────────────────

const DAILY_BRIEFS = [
  { id: "b1", date: "TODAY",    summary: "Loading from daemon…",              dot: "normal" },
];

const SKILLS = [
  { id: "email",    name: "Email Drafter",       on: true  },
  { id: "brief",    name: "Daily Briefing",      on: true  },
  { id: "screen",   name: "Screen Explainer",    on: true  },
  { id: "calendar", name: "Calendar Triage",     on: false },
  { id: "research", name: "Deep Research",       on: true  },
];

const CHARACTERS = [
  { id: "naval",   name: "Naval Ravikant",  init: "NR", tone: "Philosophy" },
  { id: "hormozi", name: "Alex Hormozi",    init: "AH", tone: "Growth"     },
  { id: "pg",      name: "Paul Graham",     init: "PG", tone: "Startups"   },
];

// Placeholder agent list — replaced by real data on load
const AGENTS = [
  { id: "jarvis", name: "JARVIS", type: "orchestrator", status: "active", role: "Orchestrator", rate: [0, 100], task: "Loading…" },
];
const EDGES = [];

const HISTORY_PROJECTS = [];
const HISTORY_CHATS = [
  { id: "ch-placeholder", title: "Loading conversations…", ts: "—", mode: "B" },
];

const THREAD = [];

// ── Daemon type mappers ───────────────────────────────────────────────────────

function mapAgentType(id, name) {
  if (id === "jarvis" || id === "ceo") return "orchestrator";
  if (name.toLowerCase().includes("lead")) return "lead";
  return "specialist";
}

function buildEdges(agents) {
  const edges = [];
  const jarvis = agents.find(a => a.id === "jarvis");
  const ceo = agents.find(a => a.id === "ceo");
  const leads = agents.filter(a => a.type === "lead");
  const specialists = agents.filter(a => a.type === "specialist");

  if (ceo) leads.forEach(l => edges.push([ceo.id, l.id]));
  if (jarvis) {
    leads.forEach(l => edges.push([jarvis.id, l.id]));
    // Jarvis → specialists that don't belong to a lead
    const contentLead  = agents.find(a => a.id === "content-lead" || a.id === "marketing-lead");
    const opsLead      = agents.find(a => a.id === "ops-lead");
    const financeLead  = agents.find(a => a.id === "finance-lead");
    specialists.forEach(s => {
      const matched =
        (contentLead && (s.id.includes("content") || s.id.includes("social") || s.id.includes("analytics") || s.id.includes("hooks") || s.id.includes("script"))) ||
        (opsLead     && (s.id.includes("project") || s.id.includes("automation"))) ||
        (financeLead && (s.id.includes("budget")  || s.id.includes("docs")));
      if (!matched) edges.push([jarvis.id, s.id]);
    });
    if (contentLead)  specialists.filter(s => s.id.includes("content") || s.id.includes("social") || s.id.includes("analytics") || s.id.includes("hooks") || s.id.includes("script")).forEach(s => edges.push([contentLead.id, s.id]));
    if (opsLead)      specialists.filter(s => s.id.includes("project") || s.id.includes("automation")).forEach(s => edges.push([opsLead.id, s.id]));
    if (financeLead)  specialists.filter(s => s.id.includes("budget")  || s.id.includes("docs")).forEach(s => edges.push([financeLead.id, s.id]));
  }
  return edges;
}

function relTime(ts) {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yest" : `${d}d`;
}

// ── Live loader ───────────────────────────────────────────────────────────────

async function loadLiveData() {
  const url = window.DAEMON_URL;

  // 1. Agents + edges
  try {
    const { agents } = await fetch(`${url}/api/agents`).then(r => r.json());
    if (agents?.length) {
      const mapped = agents.map(a => ({
        id: a.id,
        name: a.name,
        type: mapAgentType(a.id, a.name),
        status: a.status,
        role: a.name,
        rate: [0, 100],
        task: a.status === "active" ? "Running" : "—",
      }));
      window.AGENTS.length = 0;
      mapped.forEach(a => window.AGENTS.push(a));
      const edges = buildEdges(mapped);
      window.EDGES.length = 0;
      edges.forEach(e => window.EDGES.push(e));
    }
  } catch { /* daemon offline */ }

  // 2. Conversations → history
  try {
    const { conversations } = await fetch(`${url}/api/conversations?limit=30`).then(r => r.json());
    if (conversations?.length) {
      window.HISTORY_CHATS.length = 0;
      conversations.forEach(c => window.HISTORY_CHATS.push({
        id: c.id,
        title: c.title || "Untitled",
        ts: relTime(c.updatedAt || c.createdAt),
        mode: c.mode === "enterprise" ? "E" : "B",
      }));
    }
  } catch { /* daemon offline */ }

  // 3. Advisors → Characters
  try {
    const { advisors } = await fetch(`${url}/api/advisors`).then(r => r.json());
    if (advisors?.length) {
      window.CHARACTERS.length = 0;
      advisors.forEach(a => window.CHARACTERS.push({
        id: a.id,
        name: a.name,
        init: a.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase(),
        tone: (a.focus || "").split(",")[0].trim(),
      }));
    }
  } catch { /* daemon offline */ }

  // 4. Enterprise mode state
  try {
    const { enterprise } = await fetch(`${url}/api/enterprise/mode`).then(r => r.json());
    window.__JARVIS_ENTERPRISE__ = enterprise === true;
  } catch { window.__JARVIS_ENTERPRISE__ = false; }

  // Notify app that live data is ready (triggers re-render)
  window.dispatchEvent(new CustomEvent("jarvis:data-loaded"));
}

// Assign fallbacks first so app renders immediately, then overlay with live data
Object.assign(window, {
  DAILY_BRIEFS, SKILLS, CHARACTERS, AGENTS, EDGES,
  HISTORY_PROJECTS, HISTORY_CHATS, THREAD,
});

loadLiveData();
