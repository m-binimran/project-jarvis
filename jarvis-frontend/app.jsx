// app.jsx — root shell, view routing, tweaks
// Backend wired: enterprise mode syncs with daemon on toggle + load

// ── API Key setup banner (shown when daemon has no key stored) ────────────────
function ApiKeyBanner({ onSaved }) {
  const [provider, setProvider] = React.useState("anthropic");
  const [key, setKey] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError]   = React.useState("");

  const save = async () => {
    if (!key.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`${window.DAEMON_URL}/api/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, key: key.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        onSaved();
      } else {
        setError(data.error || "Failed to save");
      }
    } catch (e) {
      setError("Cannot reach daemon: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      background: "var(--surface)",
      borderBottom: "1px solid var(--border-2)",
      padding: "10px 20px",
      display: "flex", alignItems: "center", gap: 12,
      flexShrink: 0, fontSize: 12,
    }}>
      <span style={{ color: "var(--warn)", fontWeight: 700, whiteSpace: "nowrap" }}>⚠ No API key</span>
      <span style={{ color: "var(--subtext)", whiteSpace: "nowrap" }}>Add one to start chatting:</span>
      <select value={provider} onChange={e => setProvider(e.target.value)}
        style={{
          background: "var(--surface-2)", color: "var(--text)",
          border: "1px solid var(--border-2)", padding: "4px 8px",
          borderRadius: "var(--radius-sm)", fontSize: 11,
        }}>
        <option value="anthropic">Anthropic</option>
        <option value="openai">OpenAI</option>
        <option value="google">Google</option>
      </select>
      <input
        value={key}
        onChange={e => setKey(e.target.value)}
        onKeyDown={e => e.key === "Enter" && save()}
        placeholder={provider === "anthropic" ? "sk-ant-api03-…" : provider === "openai" ? "sk-proj-…" : "AIzaSy…"}
        type="password"
        style={{
          flex: 1, maxWidth: 340,
          background: "var(--surface-2)", color: "var(--text)",
          border: "1px solid var(--border-2)", padding: "5px 10px",
          borderRadius: "var(--radius-sm)", fontSize: 12,
          fontFamily: "monospace",
        }}
      />
      <button onClick={save} disabled={saving || !key.trim()}
        style={{
          padding: "5px 14px",
          background: "var(--primary)", color: "var(--on-gold)",
          border: "none", borderRadius: "var(--radius-sm)",
          fontSize: 11, fontWeight: 700, cursor: "pointer",
          opacity: (saving || !key.trim()) ? .5 : 1,
        }}>
        {saving ? "Saving…" : "Save"}
      </button>
      {error && <span style={{ color: "var(--bad)", fontSize: 11 }}>{error}</span>}
    </div>
  );
}

async function setEnterpriseOnDaemon(enterprise) {
  try {
    await fetch(`${window.DAEMON_URL}/api/enterprise/mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enterprise }),
    });
  } catch { /* non-blocking */ }
}

//
// Views:
//   chat       — quadrant pane area; drop sessions onto quadrants
//   brief      — daily brief detail
//   framework  — full-bleed agent framework graph

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "mode": "basic",
  "view": "chat",
  "face": "orb",
  "sidebarWidth": 240,
  "fontPair": "grotesk"
}/*EDITMODE-END*/;

function BriefView({ briefId, mode }) {
  const b = window.DAILY_BRIEFS.find(x => x.id === briefId) || window.DAILY_BRIEFS[0];
  const items = [
    { kind: "EMAIL",   subject: "Re: Q3 staffing plan — needs your sign-off",       from: "j.lin@hexlabs",     prio: "urgent" },
    { kind: "EMAIL",   subject: "Vendor X — pricing update, 7-day window",          from: "billing@vendorx",   prio: "urgent" },
    { kind: "EMAIL",   subject: "Newsletter feedback (3 readers)",                  from: "—",                 prio: "normal" },
    { kind: "TASK",    subject: "Approve hero image for Tuesday send",              from: "Content Lead",      prio: "normal" },
    { kind: "TASK",    subject: "Confirm Lisbon flight before pricing rolls",       from: "Calendar Agent",    prio: "urgent" },
    { kind: "REPORT",  subject: "Stripe weekly — net +428 subs, no anomalies",      from: "Research Lead",     prio: "normal" },
  ];
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, background: "var(--bg)" }}>
      <div style={{ padding: "28px 40px 18px", borderBottom: "1px solid var(--border)" }}>
        <div className="mono upper" style={{ fontSize: 10, letterSpacing: ".18em", color: "var(--subtext)" }}>Daily Brief</div>
        <h1 style={{ fontSize: 28, fontWeight: 600, margin: "6px 0 10px", letterSpacing: "-.01em" }}>
          {b.date.split(" ").slice(0,2).join(" ")} <span style={{ color: "var(--muted)" }}>· {b.summary}</span>
        </h1>
        <div style={{ display: "flex", gap: 14, fontSize: 11, color: "var(--subtext)" }}>
          <span><span style={{ color: "var(--primary)" }}>●</span> 3 urgent</span>
          <span><span style={{ color: "var(--accent)" }}>●</span> 4 normal</span>
          <span className="mono">last refresh 06:14</span>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 40px 36px" }}>
        {items.map((it, i) => (
          <div key={i} style={{
            display: "grid",
            gridTemplateColumns: "78px 70px 1fr 160px 80px",
            alignItems: "center",
            padding: "12px 0",
            borderBottom: "1px solid var(--border)",
            fontSize: 12,
            gap: 12,
          }}>
            <span className="mono upper" style={{ fontSize: 9, color: "var(--subtext)", letterSpacing: ".14em" }}>{it.kind}</span>
            <span className="mono upper" style={{
              fontSize: 9, letterSpacing: ".14em",
              color: it.prio === "urgent" ? "var(--primary)" : "var(--accent)",
              border: `1px solid ${it.prio === "urgent" ? "var(--primary)" : "var(--accent)"}`,
              padding: "1px 5px", justifySelf: "start",
              borderRadius: "var(--radius-sm)",
            }}>{it.prio}</span>
            <span style={{ color: "var(--text)" }}>{it.subject}</span>
            <span className="mono" style={{ fontSize: 10.5, color: "var(--muted)" }}>{it.from}</span>
            <button className="mono upper" style={{
              fontSize: 9, letterSpacing: ".14em",
              padding: "4px 8px", border: "1px solid var(--border-2)",
              color: "var(--text)", justifySelf: "end",
              borderRadius: "var(--radius-sm)",
            }}>Open ›</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function FrameworkView({ mode, selectedAgent, setSelectedAgent }) {
  const wrapRef = React.useRef(null);
  const [size, setSize] = React.useState({ w: 900, h: 600 });
  const [zoom, setZoom] = React.useState(1);
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  const [labels, setLabels] = React.useState(true);
  const [showDormant, setShowDormant] = React.useState(true);
  const [hoverId, setHoverId] = React.useState(null);
  const [drawerId, setDrawerId] = React.useState(null);

  React.useEffect(() => {
    const r = () => {
      if (!wrapRef.current) return;
      const rect = wrapRef.current.getBoundingClientRect();
      setSize({ w: rect.width, h: rect.height });
    };
    r();
    window.addEventListener("resize", r);
    return () => window.removeEventListener("resize", r);
  }, []);

  const drawerAgent = drawerId ? window.AGENTS.find(a => a.id === drawerId) : null;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, background: "var(--bg)", position: "relative" }}>
      <div style={{
        padding: "12px 18px",
        borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center", gap: 12,
        background: "var(--surface)",
      }}>
        <div className="mono upper" style={{ fontSize: 10, letterSpacing: ".18em", color: "var(--subtext)" }}>Customize / Agents</div>
        <span style={{ color: "var(--border-2)" }}>│</span>
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>Agent Framework</span>
        <span className="mono" style={{ fontSize: 10, color: "var(--muted)" }}>
          {window.AGENTS.length} agents · {window.EDGES.length} edges · {window.AGENTS.filter(a => a.status === "active").length} active
        </span>
        <span style={{ flex: 1 }} />
        <div style={{ display: "flex", border: "1px solid var(--border-2)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
          <button onClick={() => setZoom(z => Math.min(2.5, z + 0.2))} title="Zoom in"
            style={{ width: 26, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", borderRight: "1px solid var(--border-2)" }}>
            <I.zoom size={11} />
          </button>
          <button onClick={() => setZoom(z => Math.max(0.4, z - 0.2))} title="Zoom out"
            style={{ width: 26, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", borderRight: "1px solid var(--border-2)" }}>
            <I.zoomOut size={11} />
          </button>
          <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} title="Reset"
            style={{ width: 26, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--muted)" }}>
            <I.reset size={11} />
          </button>
        </div>
        <button onClick={() => setLabels(l => !l)} className="mono upper"
          style={{
            fontSize: 9, letterSpacing: ".12em", padding: "3px 7px",
            border: "1px solid var(--border-2)",
            borderRadius: "var(--radius-sm)",
            color: labels ? "var(--accent)" : "var(--muted)",
          }}>{labels ? "labels on" : "labels off"}</button>
        <button onClick={() => setShowDormant(d => !d)} className="mono upper"
          style={{
            fontSize: 9, letterSpacing: ".12em", padding: "3px 7px",
            border: "1px solid var(--border-2)",
            borderRadius: "var(--radius-sm)",
            color: showDormant ? "var(--accent)" : "var(--muted)",
          }}>{showDormant ? "show dormant" : "hide dormant"}</button>
        <span className="mono" style={{ fontSize: 10, color: "var(--subtext)" }}>{Math.round(zoom * 100)}%</span>
      </div>

      <div ref={wrapRef} style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <AgentGraph
          agents={window.AGENTS}
          edges={window.EDGES}
          width={size.w}
          height={size.h}
          labels={labels}
          showDormant={showDormant}
          zoom={zoom} setZoom={setZoom}
          pan={pan} setPan={setPan}
          panZoomEnabled
          hoverId={hoverId} setHoverId={setHoverId}
          selectedId={drawerId} onSelect={(id) => { setDrawerId(id); setSelectedAgent && setSelectedAgent(id); }}
        />

        <div className="popover" style={{
          position: "absolute", left: 16, bottom: 16,
          padding: "10px 12px", fontSize: 10.5,
          minWidth: 180,
        }}>
          <div className="mono upper" style={{ fontSize: 9, color: "var(--subtext)", letterSpacing: ".14em", marginBottom: 8 }}>Legend</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
            <span style={{ width: 14, height: 14, background: "var(--primary)", borderRadius: 3 }} />
            <span>Orchestrator</span>
            <span style={{ flex: 1 }} />
            <span className="mono" style={{ color: "var(--subtext)", fontSize: 9 }}>1</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
            <span style={{ width: 10, height: 10, background: "var(--accent)", borderRadius: 2 }} />
            <span>Team Lead</span>
            <span style={{ flex: 1 }} />
            <span className="mono" style={{ color: "var(--subtext)", fontSize: 9 }}>3</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
            <span style={{ width: 7, height: 7, background: "var(--text)", borderRadius: 2 }} />
            <span>Specialist</span>
            <span style={{ flex: 1 }} />
            <span className="mono" style={{ color: "var(--subtext)", fontSize: 9 }}>8</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
            <span style={{ width: 7, height: 7, background: "var(--muted)", opacity: .35, borderRadius: 2 }} />
            <span style={{ color: "var(--muted)" }}>Dormant</span>
          </div>
        </div>

        {drawerAgent && (
          <div style={{
            position: "absolute", top: 0, right: 0, bottom: 0,
            width: 320,
            background: "var(--surface)",
            borderLeft: "1px solid var(--border-2)",
            display: "flex", flexDirection: "column",
            animation: "slideIn .18s ease-out",
          }}>
            <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center" }}>
              <span className="mono upper" style={{ fontSize: 10, letterSpacing: ".14em", color: "var(--subtext)" }}>Agent · Config</span>
              <span style={{ flex: 1 }} />
              <button onClick={() => setDrawerId(null)} style={{ color: "var(--muted)" }}><I.x size={13} /></button>
            </div>
            <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{
                  width: 12, height: 12, borderRadius: 3,
                  background: drawerAgent.type === "orchestrator" ? "var(--primary)" : drawerAgent.type === "lead" ? "var(--accent)" : "var(--text)",
                }} />
                <span style={{ fontSize: 14, fontWeight: 600 }}>{drawerAgent.name}</span>
              </div>
              <div className="mono upper" style={{ fontSize: 9, color: "var(--subtext)", letterSpacing: ".14em", marginTop: 4 }}>
                {drawerAgent.role} · {drawerAgent.status}
              </div>
            </div>
            <div style={{ padding: "12px 14px", overflowY: "auto", fontSize: 11.5 }}>
              <div className="mono upper" style={{ fontSize: 9, color: "var(--subtext)", letterSpacing: ".14em", marginBottom: 6 }}>Personality</div>
              <p style={{ marginBottom: 12, color: "var(--muted)" }}>
                Precise, terse. Returns numbers before words. Defers to the orchestrator before publishing.
              </p>
              <div className="mono upper" style={{ fontSize: 9, color: "var(--subtext)", letterSpacing: ".14em", marginBottom: 6 }}>Skills</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 12 }}>
                {["compose","summarize","fact-check","ledger"].map(s =>
                  <span key={s} className="mono" style={{ fontSize: 10, padding: "2px 6px", border: "1px solid var(--border-2)", color: "var(--muted)", borderRadius: 3 }}>{s}</span>
                )}
              </div>
              <div className="mono upper" style={{ fontSize: 9, color: "var(--subtext)", letterSpacing: ".14em", marginBottom: 6 }}>Rate limit</div>
              <div className="mono" style={{ fontSize: 11, color: "var(--text)", marginBottom: 12 }}>{drawerAgent.rate[0]} / {drawerAgent.rate[1]} per day</div>
              <div className="mono upper" style={{ fontSize: 9, color: "var(--subtext)", letterSpacing: ".14em", marginBottom: 6 }}>Last journal entries</div>
              <div style={{ borderLeft: "1px solid var(--border-2)", paddingLeft: 8, color: "var(--muted)", fontSize: 11 }}>
                <div style={{ marginBottom: 6 }}><span className="mono" style={{ color: "var(--subtext)" }}>09:44</span> Routed to Mailer; queue depth 3.</div>
                <div style={{ marginBottom: 6 }}><span className="mono" style={{ color: "var(--subtext)" }}>09:42</span> Picked headline #3 by user override.</div>
                <div style={{ marginBottom: 6 }}><span className="mono" style={{ color: "var(--subtext)" }}>09:41</span> Initialized session from Daily Brief.</div>
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`@keyframes slideIn{from{transform:translateX(20px);opacity:0}to{transform:translateX(0);opacity:1}}`}</style>
    </div>
  );
}

// ── Workspace panel — Agents + Advisors (Section A) ──────────────────────────
function WorkspacePanel({ kind, onClose }) {
  const [agents, setAgents]     = React.useState([]);
  const [advisors, setAdvisors] = React.useState([]);
  const [ask, setAsk]           = React.useState(null);
  const [q, setQ]               = React.useState("");
  const [thread, setThread]     = React.useState([]);
  const [busy, setBusy]         = React.useState(false);
  const loadThread = (id) => { try { return JSON.parse(localStorage.getItem("jarvis_adv_" + id) || "[]"); } catch { return []; } };

  React.useEffect(() => {
    fetch(`${window.DAEMON_URL}/api/agents`).then(r => r.json()).then(d => setAgents(d.agents || [])).catch(() => {});
    fetch(`${window.DAEMON_URL}/api/advisors`).then(r => r.json()).then(d => setAdvisors(d.advisors || [])).catch(() => {});
  }, []);

  const askAdvisor = async (adv) => {
    const question = q.trim();
    if (!question || busy) return;
    const prior = thread;
    setBusy(true); setQ("");
    setThread([...prior, { role: "user", text: question }, { role: "advisor", text: "" }]); // "" → thinking dots
    let target = "", shown = 0, finished = false;
    // Typewriter — reveal the reply progressively so it "types" out.
    const reveal = setInterval(() => {
      if (shown < target.length) {
        shown = Math.min(target.length, shown + 2);
        setThread([...prior, { role: "user", text: question }, { role: "advisor", text: target.slice(0, shown) }]);
      } else if (finished) {
        clearInterval(reveal);
        const finalThread = [...prior, { role: "user", text: question }, { role: "advisor", text: target || "(no reply)" }];
        setThread(finalThread);
        try { localStorage.setItem("jarvis_adv_" + adv.id, JSON.stringify(finalThread)); } catch (_) {}
        setBusy(false);
      }
    }, 16);
    try {
      const res = await fetch(`${window.DAEMON_URL}/api/advisors/${adv.id}/ask`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === "delta" && evt.content) { target += evt.content; }
            if (evt.type === "done") { target = (evt.result && evt.result.output) || target; }
            if (evt.type === "error") { target = "⚠ " + evt.message; }
          } catch (_) {}
        }
      }
    } catch (e) { target = "Couldn't reach advisor: " + e.message; }
    finished = true;
  };

  return (
    <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: 380, background: "var(--surface)", borderLeft: "1px solid var(--border-2)", display: "flex", flexDirection: "column", zIndex: 50, boxShadow: "-8px 0 24px rgba(0,0,0,.3)" }}>
      <div style={{ display: "flex", alignItems: "center", padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
        <span className="mono upper" style={{ fontSize: 11, letterSpacing: ".14em", fontWeight: 700 }}>{kind === "agents" ? "Your Agents" : "Your Advisors"}</span>
        <span style={{ flex: 1 }} />
        <button onClick={onClose} style={{ color: "var(--muted)", fontSize: 16, background: "none", cursor: "pointer" }}>✕</button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px" }}>
        {kind === "agents" && (agents.length ? agents.map(a => (
          <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: a.status === "active" ? "var(--ok)" : "var(--muted)" }} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>{a.name}</span>
            <span style={{ flex: 1 }} />
            <span className="mono" style={{ fontSize: 10, color: "var(--subtext)" }}>{a.department}</span>
          </div>
        )) : <p style={{ color: "var(--muted)", fontSize: 12 }}>No agents loaded.</p>)}

        {kind === "advisors" && !ask && (advisors.length ? advisors.map(a => (
          <button key={a.id} onClick={() => { setAsk(a); setQ(""); setThread(loadThread(a.id)); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 0", borderBottom: "1px solid var(--border)", background: "none", cursor: "pointer" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{a.name}</div>
            <div style={{ fontSize: 11, color: "var(--subtext)" }}>{a.focus}</div>
          </button>
        )) : <p style={{ color: "var(--muted)", fontSize: 12 }}>No advisors yet.</p>)}

        {kind === "advisors" && ask && (
          <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <button onClick={() => setAsk(null)} style={{ fontSize: 11, color: "var(--subtext)", background: "none", marginBottom: 6, cursor: "pointer", textAlign: "left" }}>‹ Back to advisors</button>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{ask.name}</div>
            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
              {thread.length === 0 && <p style={{ color: "var(--muted)", fontSize: 12 }}>No messages yet. Ask {ask.name} something — your conversation is saved.</p>}
              {thread.map((m, i) => (
                <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "85%", padding: "8px 10px", borderRadius: 12, fontSize: 12.5, lineHeight: 1.45, whiteSpace: "pre-wrap", background: m.role === "user" ? "var(--primary)" : "var(--surface-2)", color: m.role === "user" ? "var(--on-gold)" : "var(--text)" }}>
                  {m.role === "advisor" && m.text === ""
                    ? <span style={{ display: "inline-flex", gap: 4 }}>{[0, 1, 2].map(n => <span key={n} style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--primary)", display: "inline-block", animation: "blink 1s infinite", animationDelay: `${n * 0.18}s` }} />)}</span>
                    : m.text}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === "Enter") askAdvisor(ask); }} placeholder={`Ask ${ask.name}…`} style={{ flex: 1, background: "var(--surface-2)", color: "var(--text)", border: "1px solid var(--border-2)", borderRadius: "var(--radius-sm)", padding: "8px 10px", fontSize: 12 }} />
              <button onClick={() => askAdvisor(ask)} disabled={busy} style={{ padding: "8px 12px", background: "var(--primary)", color: "var(--on-gold)", border: "none", borderRadius: "var(--radius-sm)", fontSize: 11, fontWeight: 700, cursor: "pointer", opacity: busy ? .5 : 1 }}>{busy ? "…" : "Ask"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Settings panel — add a fast cloud brain (API keys) + optional voice key ──
function SettingsPanel({ onClose }) {
  const [keys, setKeys]     = React.useState([]);
  const [inputs, setInputs] = React.useState({});
  const [saved, setSaved]   = React.useState({});
  const [eleven, setEleven] = React.useState(() => localStorage.getItem("jarvis_elevenlabs_key") || "");

  const reload = () => fetch(`${window.DAEMON_URL}/api/keys`).then(r => r.json()).then(d => setKeys(d.keys || [])).catch(() => {});
  React.useEffect(() => { reload(); }, []);
  const has = (p) => keys.includes("provider:" + p);

  const saveKey = async (p) => {
    const key = (inputs[p] || "").trim(); if (!key) return;
    try {
      const res = await fetch(`${window.DAEMON_URL}/api/keys`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: p, key }) });
      const d = await res.json();
      if (d.success) { setSaved(s => ({ ...s, [p]: true })); setInputs(i => ({ ...i, [p]: "" })); reload(); setTimeout(() => setSaved(s => ({ ...s, [p]: false })), 2000); }
    } catch (_) {}
  };
  const saveEleven = () => { localStorage.setItem("jarvis_elevenlabs_key", eleven.trim()); setSaved(s => ({ ...s, eleven: true })); setTimeout(() => setSaved(s => ({ ...s, eleven: false })), 2000); };

  const PROVS = [
    { id: "nvidia",    name: "NVIDIA",             hint: "nvapi-…",   url: "https://build.nvidia.com", note: "Free credits — recommended" },
    { id: "google",    name: "Google Gemini",      hint: "AIzaSy…",   url: "https://aistudio.google.com/apikey", note: "Free tier (daily limit)" },
    { id: "openai",    name: "OpenAI",             hint: "sk-proj-…", url: "https://platform.openai.com/api-keys" },
    { id: "deepseek",  name: "DeepSeek",           hint: "sk-…",      url: "https://platform.deepseek.com/api_keys", note: "Very cheap" },
    { id: "anthropic", name: "Anthropic (Claude)", hint: "sk-ant-…",  url: "https://console.anthropic.com" },
  ];
  const inp = { flex: 1, background: "var(--surface-2)", color: "var(--text)", border: "1px solid var(--border-2)", borderRadius: "var(--radius-sm)", padding: "7px 9px", fontSize: 12, fontFamily: "monospace" };
  const btn = { padding: "7px 12px", background: "var(--primary)", color: "var(--on-gold)", border: "none", borderRadius: "var(--radius-sm)", fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" };

  return (
    <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: 380, background: "var(--surface)", borderLeft: "1px solid var(--border-2)", display: "flex", flexDirection: "column", zIndex: 50, boxShadow: "-8px 0 24px rgba(0,0,0,.3)" }}>
      <div style={{ display: "flex", alignItems: "center", padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
        <span className="mono upper" style={{ fontSize: 11, letterSpacing: ".14em", fontWeight: 700 }}>Settings · API Keys</span>
        <span style={{ flex: 1 }} />
        <button onClick={onClose} style={{ color: "var(--muted)", fontSize: 16, background: "none", cursor: "pointer" }}>✕</button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
        <div className="mono upper" style={{ fontSize: 9, color: "var(--subtext)", letterSpacing: ".14em", marginBottom: 8 }}>AI Brain</div>
        {PROVS.map(p => (
          <div key={p.id} style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{p.name}</span>
              {has(p.id) && <span style={{ fontSize: 10, color: "var(--ok)", fontWeight: 700 }}>● connected</span>}
              {p.note && !has(p.id) && <span style={{ fontSize: 10, color: "var(--accent)" }}>{p.note}</span>}
              <span style={{ flex: 1 }} />
              <a href={p.url} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: "var(--subtext)", textDecoration: "none" }}>get key →</a>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input type="password" value={inputs[p.id] || ""} onChange={e => setInputs(i => ({ ...i, [p.id]: e.target.value }))} onKeyDown={e => { if (e.key === "Enter") saveKey(p.id); }} placeholder={has(p.id) ? "Replace key…" : p.hint} style={inp} />
              <button onClick={() => saveKey(p.id)} style={btn}>{saved[p.id] ? "✓" : "Save"}</button>
            </div>
          </div>
        ))}

        <div className="mono upper" style={{ fontSize: 9, color: "var(--subtext)", letterSpacing: ".14em", margin: "18px 0 6px" }}>Voice (optional)</div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>JARVIS already speaks for free. Add an ElevenLabs key only if you want a premium voice.</div>
        <div style={{ display: "flex", gap: 6 }}>
          <input type="password" value={eleven} onChange={e => setEleven(e.target.value)} onKeyDown={e => { if (e.key === "Enter") saveEleven(); }} placeholder="ElevenLabs key (optional)…" style={inp} />
          <button onClick={saveEleven} style={btn}>{saved.eleven ? "✓" : "Save"}</button>
        </div>

        <div className="mono upper" style={{ fontSize: 9, color: "var(--subtext)", letterSpacing: ".14em", margin: "18px 0 6px" }}>Slack (optional)</div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>Talk to JARVIS in Slack. Add both tokens (see SLACK-SETUP.md), then DM or @mention the bot.</div>
        {[{ id: "slack_bot_token", label: "Bot token — xoxb-…" }, { id: "slack_app_token", label: "App token — xapp-…" }].map(s => (
          <div key={s.id} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <input type="password" value={inputs[s.id] || ""} onChange={e => setInputs(i => ({ ...i, [s.id]: e.target.value }))} onKeyDown={e => { if (e.key === "Enter") saveKey(s.id); }} placeholder={has(s.id) ? "Replace…" : s.label} style={inp} />
            <button onClick={() => saveKey(s.id)} style={btn}>{saved[s.id] ? "✓" : "Save"}</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function App() {
  const [hasApiKey,    setHasApiKey]    = React.useState(true);
  const [daemonOnline, setDaemonOnline] = React.useState(true);
  const [booted,       setBooted]       = React.useState(false);
  const [onboarding,   setOnboarding]   = React.useState(false);
  const [panel,        setPanel]        = React.useState(null); // "agents" | "advisors" | null

  // Check API key on mount
  React.useEffect(() => {
    fetch(`${window.DAEMON_URL}/api/keys`)
      .then(r => r.json())
      .then(d => {
        const hasKey = (d.keys ?? []).length > 0;
        setHasApiKey(hasKey);
        setOnboarding(!hasKey);
        setDaemonOnline(true);
        setBooted(true);
      })
      .catch(() => { setDaemonOnline(false); setBooted(true); });
  }, []);

  // Show conversational onboarding when no key is stored
  if (booted && daemonOnline && onboarding) {
    return (
      <div style={{ width: "100vw", height: "100vh", background: "var(--bg)", overflow: "hidden", position: "relative" }}>
        <Onboarding onComplete={() => { setHasApiKey(true); setOnboarding(false); }} />
      </div>
    );
  }

  return (
    <div style={{ width: "100vw", height: "100vh", background: "var(--bg)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {/* Daemon offline warning */}
      {!daemonOnline && (
        <div style={{ background: "var(--bad)", color: "#fff", fontSize: 11, padding: "6px 16px", flexShrink: 0, display: "flex", gap: 8 }}>
          <b>DAEMON OFFLINE</b>
          <span style={{ opacity: .8 }}>— run: <code>node --experimental-strip-types src/index.ts</code> in jarvis-daemon</span>
        </div>
      )}
      {/* Orb — full remaining height */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", position: "relative" }}>
        <OrbView mode="enterprise" onFlip={() => {}} onOpenChat={() => {}} />
        {/* Section A — reach your agents + advisors */}
        <div style={{ position: "absolute", top: 14, right: 16, display: "flex", gap: 8, zIndex: 40 }}>
          <button onClick={() => setPanel("agents")} style={{ padding: "6px 12px", background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border-2)", borderRadius: "var(--radius-sm)", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Agents</button>
          <button onClick={() => setPanel("advisors")} style={{ padding: "6px 12px", background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border-2)", borderRadius: "var(--radius-sm)", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Advisors</button>
          <button onClick={() => setPanel("settings")} style={{ padding: "6px 12px", background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border-2)", borderRadius: "var(--radius-sm)", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>⚙ Settings</button>
        </div>
        {panel === "settings"
          ? <SettingsPanel onClose={() => setPanel(null)} />
          : panel ? <WorkspacePanel kind={panel} onClose={() => setPanel(null)} /> : null}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
