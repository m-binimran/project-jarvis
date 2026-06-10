// chat.jsx — main chat area: top bar, messages, split panes, input
// Backend wired: real SSE streaming, live token bar, permission mode sync

// Map UI permission mode names to daemon's API values
const PERM_MODE_TO_API = { SAFE: "safe", PRODUCTIVE: "productive", AUTO: "auto", BYPASS: "bypass" };

async function syncPermModeWithDaemon(mode) {
  try {
    await fetch(`${window.DAEMON_URL}/api/permission/mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: PERM_MODE_TO_API[mode] || "productive" }),
    });
  } catch { /* non-blocking */ }
}

async function resolveApproval(requestId, approved) {
  try {
    await fetch(`${window.DAEMON_URL}/api/approval/${requestId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved }),
    });
  } catch { /* non-blocking */ }
}

const PERMISSION_STATES = ["ask", "allow", "block"];
const PERMISSION_COLOR = {
  ask:   { fg: "var(--muted)", bd: "var(--border-2)", bg: "transparent" },
  allow: { fg: "var(--ok)",    bd: "var(--ok)",       bg: "transparent" },
  block: { fg: "var(--bad)",   bd: "var(--bad)",      bg: "transparent" },
};
const PERMISSION_DEFAULTS = {
  "File Access": "allow",
  "Email Send":  "ask",
  "Web Browse":  "allow",
  "Code Exec":   "block",
};

const PERMISSION_MODES = [
  { id: "SAFE",       desc: "Ask before every action",      tone: "ok"    },
  { id: "PRODUCTIVE", desc: "Auto-allow safe actions",      tone: "accent"},
  { id: "AUTO",       desc: "Auto-allow except destructive",tone: "accent"},
  { id: "BYPASS",     desc: "Skip all permission checks",   tone: "bad"   },
];

const AGENT_CHIPS = [
  { id: "jarvis",   label: "JARVIS" },
  { id: "content",  label: "Content Lead" },
  { id: "research", label: "Research Lead" },
];

function TopBar({ session, setSession, mode, tokens, setTokens, view, setView, paneCount, onFlipBack, onOpenChat }) {
  const [popover, setPopover] = React.useState(false);
  const ChatLauncher = window.ChatLauncher;

  // Poll live token usage from daemon every 30s
  React.useEffect(() => {
    const load = () => {
      fetch(`${window.DAEMON_URL}/api/usage`)
        .then(r => r.json())
        .then(data => {
          if (data.today) {
            setTokens(prev => ({
              ...prev,
              up:   data.today.inputTokens  || prev.up,
              down: data.today.outputTokens || prev.down,
              cost: data.today.costUsd      || prev.cost,
            }));
          }
        })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);
  return (
    <div style={{
      minHeight: 44,
      display: "flex", alignItems: "center", gap: 10,
      padding: "0 16px",
      borderBottom: "1px solid var(--border)",
      background: "var(--surface)",
      flexShrink: 0,
      position: "relative",
      whiteSpace: "nowrap",
      overflowX: "auto",
      overflowY: "hidden",
    }}>
      <input
        value={session.name}
        onChange={(e) => setSession(s => ({ ...s, name: e.target.value }))}
        style={{
          fontSize: 13.5, fontWeight: 600,
          background: "transparent",
          padding: "4px 6px",
          border: "1px solid transparent",
          borderRadius: "var(--radius-sm)",
          minWidth: 180,
          letterSpacing: "-.005em",
        }}
        onFocus={e => e.currentTarget.style.borderColor = "var(--border-2)"}
        onBlur={e => e.currentTarget.style.borderColor = "transparent"}
      />
      <span className="mono upper" style={{
        fontSize: 9, letterSpacing: ".14em",
        color: "var(--primary)",
        border: "1px solid var(--primary)",
        padding: "2px 6px",
        borderRadius: "var(--radius-sm)",
      }}>{mode === "basic" ? "BASIC" : "ENTRPRSE"}</span>
      {paneCount > 1 && (
        <span className="mono" style={{ fontSize: 10, color: "var(--subtext)" }}>
          {paneCount} panes
        </span>
      )}

      <span style={{ flex: 1, minWidth: 8 }} />

      {/* token */}
      <div style={{ position: "relative", flexShrink: 0 }}>
        <button onClick={() => setPopover(o => !o)}
          className="mono"
          style={{
            fontSize: 10.5,
            color: "var(--muted)",
            letterSpacing: ".04em",
            padding: "4px 8px",
            border: `1px solid ${popover ? "var(--border-2)" : "transparent"}`,
            borderRadius: "var(--radius-sm)",
            whiteSpace: "nowrap",
          }}>
          ↑ {tokens.up.toLocaleString()} <span style={{ color: "var(--subtext)" }}>·</span> ↓ {tokens.down.toLocaleString()} <span style={{ color: "var(--subtext)" }}>·</span> <span className="gold-text" style={{ fontWeight: 600 }}>${tokens.cost.toFixed(3)}</span>
        </button>
        {popover && (
          <div className="popover" style={{
            position: "absolute", top: 30, right: 0, zIndex: 30,
            width: 300, padding: 12, fontSize: 11,
          }}>
            <div className="mono upper" style={{ fontSize: 9, color: "var(--subtext)", letterSpacing: ".14em", marginBottom: 8 }}>USAGE · TODAY</div>
            {[
              ["JARVIS",        "12,402 / 8,114", "$0.041"],
              ["Content Lead",  "8,221 / 4,030",  "$0.024"],
              ["Research Lead", "14,118 / 1,901", "$0.038"],
              ["Mail Agent",    "1,402 / 220",    "$0.004"],
              ["Memory",        "22,400 / 800",   "$0.031"],
            ].map(([a, t, c]) => (
              <div key={a} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px dashed var(--border)" }}>
                <span>{a}</span>
                <span className="mono" style={{ color: "var(--muted)" }}>{t}</span>
                <span className="mono" style={{ minWidth: 50, textAlign: "right" }}>{c}</span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0 0", fontWeight: 600 }}>
              <span>TOTAL</span>
              <span className="mono gold-text">$0.138</span>
            </div>
          </div>
        )}
      </div>

      {/* top-right: chat launcher + flip to back */}
      <ChatLauncher onOpenChat={onOpenChat} />
      <button onClick={onFlipBack}
        className="card"
        title="Flip to JARVIS orb"
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "5px 10px",
          fontSize: 11,
          color: "var(--text)",
          background: "var(--surface-2)",
          flexShrink: 0,
        }}>
        <I.power size={12} />
        <span className="mono upper" style={{ fontSize: 9, letterSpacing: ".14em" }}>JARVIS</span>
      </button>
    </div>
  );
}

function ApprovalCard({ approval, onResolve }) {
  const { action, context, resolved } = approval;
  if (resolved !== null && resolved !== undefined) {
    return (
      <div style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "4px 10px",
        fontSize: 11,
        borderRadius: "var(--radius-sm)",
        background: resolved ? "color-mix(in oklab, var(--ok) 12%, transparent)" : "color-mix(in oklab, var(--bad) 12%, transparent)",
        border: `1px solid ${resolved ? "var(--ok)" : "var(--bad)"}`,
        color: resolved ? "var(--ok)" : "var(--bad)",
      }}>
        {resolved ? "✓ Approved" : "✕ Denied"} — {action}
      </div>
    );
  }
  return (
    <div style={{
      padding: "10px 12px",
      background: "color-mix(in oklab, var(--warn) 8%, var(--surface))",
      border: "1px solid var(--warn)",
      borderRadius: "var(--radius)",
      fontSize: 12,
      maxWidth: 400,
    }}>
      <div style={{ fontWeight: 600, color: "var(--warn)", marginBottom: 4 }}>⚠ Approval needed</div>
      <div style={{ color: "var(--text)", marginBottom: 4 }}>{action}</div>
      {context && <div style={{ color: "var(--muted)", fontSize: 11, marginBottom: 8 }}>{context}</div>}
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={() => onResolve(true)}
          style={{
            padding: "4px 12px", fontSize: 11, fontWeight: 600,
            background: "var(--ok)", color: "#fff",
            border: "none", borderRadius: "var(--radius-sm)", cursor: "pointer",
          }}>Approve</button>
        <button onClick={() => onResolve(false)}
          style={{
            padding: "4px 12px", fontSize: 11,
            background: "transparent", color: "var(--bad)",
            border: "1px solid var(--bad)", borderRadius: "var(--radius-sm)", cursor: "pointer",
          }}>Deny</button>
      </div>
    </div>
  );
}

function MessageRow({ m, onApprove }) {
  const isUser = m.from === "user";
  const isError = m.from === "error";
  const accentColor = m.from === "jarvis" || m.from === "ceo" ? "var(--primary)" : "var(--accent)";

  const handleApprove = async (approved) => {
    if (onApprove) onApprove(m.approval.requestId, approved);
    await resolveApproval(m.approval.requestId, approved);
  };

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: isUser ? "flex-end" : "flex-start",
      gap: 4,
      width: "100%",
      marginBottom: 18,
    }}>
      <div className="mono upper" style={{
        fontSize: 9,
        letterSpacing: ".12em",
        color: "var(--subtext)",
        display: "flex", gap: 8, alignItems: "center",
      }}>
        <span>{m.ts}</span>
        <span style={{ color: "var(--border-2)" }}>·</span>
        <span style={{ color: isUser ? "var(--muted)" : accentColor }}>
          {isUser ? "YOU" : (m.agent || "JARVIS")}
        </span>
        {m.streaming && (
          <span style={{ color: "var(--muted)", fontSize: 9 }}>●</span>
        )}
      </div>

      {/* Approval card */}
      {m.approval && <ApprovalCard approval={m.approval} onResolve={handleApprove} />}

      {/* Regular content */}
      {!m.approval && isUser && (
        <div style={{
          padding: "8px 12px",
          background: "var(--surface-2)",
          border: "1px solid var(--border-2)",
          borderRadius: "var(--radius)",
          maxWidth: 480,
          fontSize: 13,
          whiteSpace: "pre-wrap",
          lineHeight: 1.5,
        }}>{m.text}</div>
      )}
      {!m.approval && !isUser && (
        <div style={{
          borderLeft: `2px solid ${isError ? "var(--bad)" : accentColor}`,
          padding: "2px 0 2px 12px",
          fontSize: 13,
          color: isError ? "var(--bad)" : "var(--text)",
          whiteSpace: "pre-wrap",
          lineHeight: 1.55,
          minHeight: 20,
          maxWidth: "100%",
        }}>
          {m.text || (m.streaming ? (
            <span style={{ display: "inline-flex", gap: 3 }}>
              {[0, 1, 2].map(i => (
                <span key={i} style={{
                  display: "inline-block", width: 5, height: 5,
                  background: "var(--muted)", borderRadius: "50%",
                  animation: `typing 1.2s ${i * 0.2}s ease-in-out infinite`,
                }} />
              ))}
            </span>
          ) : null)}
        </div>
      )}
    </div>
  );
}

function PermPopover({ permissions, setPermissions, permMode, setPermMode, onClose }) {
  const cycle = (k) => {
    const i = PERMISSION_STATES.indexOf(permissions[k]);
    const next = PERMISSION_STATES[(i + 1) % PERMISSION_STATES.length];
    setPermissions(p => ({ ...p, [k]: next }));
  };
  return (
    <div className="popover" style={{
      position: "absolute",
      bottom: "calc(100% + 6px)", left: 0,
      width: 280, padding: 10,
      zIndex: 40,
    }}
      onMouseLeave={onClose}
    >
      <div className="mono upper" style={{ fontSize: 9, color: "var(--subtext)", letterSpacing: ".14em", marginBottom: 6 }}>Permission mode</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 10 }}>
        {PERMISSION_MODES.map(m => {
          const active = permMode === m.id;
          const tone = m.tone === "ok" ? "var(--ok)" : m.tone === "bad" ? "var(--bad)" : "var(--accent)";
          return (
            <button key={m.id} onClick={() => { setPermMode(m.id); syncPermModeWithDaemon(m.id); }}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "6px 8px",
                background: active ? "var(--surface-2)" : "transparent",
                border: `1px solid ${active ? "var(--border-2)" : "transparent"}`,
                borderRadius: "var(--radius-sm)",
                textAlign: "left",
              }}>
              <span style={{ width: 6, height: 6, background: tone, borderRadius: "50%" }} />
              <span className="mono upper" style={{ fontSize: 10, letterSpacing: ".12em", color: active ? tone : "var(--text)", minWidth: 80 }}>{m.id}</span>
              <span style={{ fontSize: 10.5, color: "var(--muted)" }}>{m.desc}</span>
            </button>
          );
        })}
      </div>
      <div className="mono upper" style={{ fontSize: 9, color: "var(--subtext)", letterSpacing: ".14em", marginBottom: 6 }}>Capabilities</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {Object.entries(permissions).map(([k, v]) => {
          const c = PERMISSION_COLOR[v];
          return (
            <button key={k} onClick={() => cycle(k)}
              className="mono"
              title={`Cycle: ${v}`}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "3px 7px",
                fontSize: 10,
                letterSpacing: ".02em",
                color: c.fg,
                border: `1px solid ${c.bd}`,
                borderRadius: "var(--radius-sm)",
                background: c.bg,
              }}>
              <span style={{ width: 4, height: 4, background: c.fg, display: "inline-block", borderRadius: "50%" }} />
              {k}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PermTrigger({ permissions, setPermissions, permMode, setPermMode }) {
  const [open, setOpen] = React.useState(false);
  const closeTimer = React.useRef(null);
  const hoverIn = () => { clearTimeout(closeTimer.current); setOpen(true); };
  const hoverOut = () => { closeTimer.current = setTimeout(() => setOpen(false), 220); };
  const tone = permMode === "BYPASS" ? "var(--bad)" :
               permMode === "SAFE"   ? "var(--ok)"  : "var(--accent)";
  return (
    <div style={{ position: "relative" }} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
      <button onClick={() => setOpen(o => !o)}
        className="mono upper"
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          fontSize: 10, letterSpacing: ".14em",
          padding: "4px 8px",
          color: tone,
          background: "transparent",
          border: `1px solid ${open ? "var(--border-2)" : "transparent"}`,
          borderRadius: "var(--radius-sm)",
        }}>
        <I.shield size={11} />
        {permMode}
        <I.chevUp size={9} style={{ opacity: .6 }} />
      </button>
      {open && <PermPopover
        permissions={permissions} setPermissions={setPermissions}
        permMode={permMode} setPermMode={setPermMode}
        onClose={hoverOut} />}
    </div>
  );
}

function InputArea({ value, setValue, onSend, agent, setAgent, permissions, setPermissions, permMode, setPermMode }) {
  const taRef = React.useRef(null);
  React.useEffect(() => {
    const ta = taRef.current; if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(160, ta.scrollHeight) + "px";
  }, [value]);
  return (
    <div style={{
      borderTop: "1px solid var(--border)",
      background: "var(--surface)",
      padding: "10px 12px 8px",
    }}>
      <div style={{
        background: "var(--surface-2)",
        border: "1px solid var(--border-2)",
        borderRadius: "var(--radius)",
        padding: "8px 10px",
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <textarea
            ref={taRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Message JARVIS…"
            rows={1}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); }
            }}
            style={{
              flex: 1,
              background: "transparent",
              color: "var(--text)",
              padding: "2px 0",
              border: 0,
              resize: "none",
              fontSize: 13,
              lineHeight: 1.5,
              fontFamily: "inherit",
              minHeight: 22,
              maxHeight: 160,
            }}
          />
        </div>
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          marginTop: 6,
        }}>
          {/* bottom-left: perm trigger + attach */}
          <PermTrigger
            permissions={permissions} setPermissions={setPermissions}
            permMode={permMode} setPermMode={setPermMode}
          />
          <button title="Attach"
            style={{
              width: 22, height: 22,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              color: "var(--muted)",
              borderRadius: "var(--radius-sm)",
            }}><I.clip size={13} /></button>

          <span style={{ flex: 1 }} />

          {/* bottom-right: agent chips + send */}
          <span className="mono upper" style={{ fontSize: 9, color: "var(--subtext)", letterSpacing: ".12em", marginRight: 2 }}>→</span>
          {AGENT_CHIPS.map(c => {
            const active = agent === c.id;
            return (
              <button key={c.id} onClick={() => setAgent(c.id)}
                className="mono upper"
                style={{
                  fontSize: 9, letterSpacing: ".08em",
                  padding: "3px 7px",
                  color: active ? "var(--on-gold)" : "var(--muted)",
                  background: active ? "var(--primary)" : "transparent",
                  border: `1px solid ${active ? "var(--primary)" : "var(--border-2)"}`,
                  borderRadius: "var(--radius-sm)",
                }}>{c.label}</button>
            );
          })}
          <button className="mono upper"
            style={{
              fontSize: 9, letterSpacing: ".08em",
              padding: "3px 6px",
              color: "var(--subtext)",
              border: "1px dashed var(--border-2)",
              borderRadius: "var(--radius-sm)",
            }}>+</button>

          <button onClick={onSend}
            className="gold"
            style={{
              width: 26, height: 22,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              borderRadius: "var(--radius-sm)",
              marginLeft: 4,
            }}><I.send size={13} /></button>
        </div>
      </div>
    </div>
  );
}

function Pane({ pane, onClose, single, mode }) {
  const [value, setValue] = React.useState("");
  const [agent, setAgent] = React.useState("jarvis");
  const [thread, setThread] = React.useState(pane.thread || window.THREAD);
  const [permissions, setPermissions] = React.useState(PERMISSION_DEFAULTS);
  const [permMode, setPermMode] = React.useState("PRODUCTIVE");
  const scrollRef = React.useRef(null);

  const onSend = async () => {
    const v = value.trim(); if (!v) return;
    const ts = new Date().toTimeString().slice(0, 5);
    setThread(t => [...t, { from: "user", text: v, ts }]);
    setValue("");

    // Insert a streaming placeholder
    const tempId = `stream-${Date.now()}`;
    const agentLabel = AGENT_CHIPS.find(c => c.id === agent)?.label || "JARVIS";
    setThread(t => [...t, {
      id: tempId,
      from: agent || "jarvis",
      agent: agentLabel,
      text: "",
      ts: new Date().toTimeString().slice(0, 5),
      streaming: true,
    }]);

    try {
      const res = await fetch(`${window.DAEMON_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: v, agentId: agent }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!res.body) throw new Error("No body");

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";

      while (true) {
        const { value: chunk, done } = await reader.read();
        if (done) break;
        buf += dec.decode(chunk, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));

            if (evt.type === "delta" && evt.content) {
              setThread(t => t.map(m =>
                m.id === tempId ? { ...m, text: m.text + evt.content } : m
              ));
            }

            if (evt.type === "done") {
              const out = evt.result?.output;
              setThread(t => t.map(m =>
                m.id === tempId
                  ? { ...m, text: out || m.text, streaming: false, agentId: evt.result?.agentId }
                  : m
              ));
            }

            if (evt.type === "approval_needed") {
              setThread(t => t.map(m =>
                m.id === tempId
                  ? {
                      ...m,
                      text: "",
                      streaming: false,
                      approval: {
                        requestId: evt.requestId,
                        action: evt.action,
                        context: evt.context,
                        resolved: null,
                      },
                    }
                  : m
              ));
            }

            if (evt.type === "approval_resolved") {
              setThread(t => t.map(m =>
                m.approval?.requestId === evt.requestId
                  ? { ...m, approval: { ...m.approval, resolved: evt.approved } }
                  : m
              ));
            }

            if (evt.type === "error") {
              setThread(t => t.map(m =>
                m.id === tempId
                  ? { ...m, text: `⚠ ${evt.message}`, streaming: false, from: "error" }
                  : m
              ));
            }
          } catch { /* skip malformed SSE line */ }
        }
      }
    } catch (e) {
      setThread(t => t.map(m =>
        m.id === tempId
          ? { ...m, text: `Cannot reach JARVIS daemon (${window.DAEMON_URL}). Is it running?\n${e.message}`, streaming: false, from: "error" }
          : m
      ));
    }
  };

  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [thread.length]);

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      minWidth: 0, minHeight: 0,
      background: "var(--bg)",
      border: single ? "none" : "1px solid var(--border)",
      borderRadius: single ? 0 : "var(--radius)",
      margin: single ? 0 : 4,
      overflow: "hidden",
    }}>
      {!single && (
        <div style={{
          display: "flex", alignItems: "center",
          padding: "6px 12px",
          background: "var(--surface)",
          borderBottom: "1px solid var(--border)",
          height: 30, flexShrink: 0,
        }}>
          <span style={{ width: 6, height: 6, background: "var(--primary)", borderRadius: "50%", marginRight: 8 }} />
          <span style={{ fontSize: 11.5, fontWeight: 600, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pane.label}</span>
          <span className="mono" style={{ fontSize: 9, color: "var(--subtext)", marginRight: 8 }}>{thread.length} msgs</span>
          <button onClick={onClose} title="Close pane"
            style={{ color: "var(--muted)", padding: 2, borderRadius: 3 }}
            onMouseEnter={e => e.currentTarget.style.color = "var(--bad)"}
            onMouseLeave={e => e.currentTarget.style.color = "var(--muted)"}
          ><I.x size={12} /></button>
        </div>
      )}
      <div ref={scrollRef} style={{
        flex: 1, overflowY: "auto",
        padding: single ? "28px 0" : "16px 0",
        minHeight: 0,
      }}>
        {/* Centred conversation column — fills the main area without leaving half the screen empty */}
        <div style={{ maxWidth: 740, margin: "0 auto", padding: "0 28px" }}>
          {thread.map((m, i) => (
            <MessageRow key={m.id || i} m={m} onApprove={(requestId, approved) => {
              setThread(t => t.map(msg =>
                msg.approval?.requestId === requestId
                  ? { ...msg, approval: { ...msg.approval, resolved: approved } }
                  : msg
              ));
            }} />
          ))}
        </div>
      </div>
      <InputArea value={value} setValue={setValue} onSend={onSend}
        agent={agent} setAgent={setAgent}
        permissions={permissions} setPermissions={setPermissions}
        permMode={permMode} setPermMode={setPermMode} />
    </div>
  );
}

// ChatArea: 2x2 quadrant model. Panes is { tl, tr, bl, br } map.
const QUADS = ["tl", "tr", "bl", "br"];
const QUAD_LABEL = { tl: "Top left", tr: "Top right", bl: "Bottom left", br: "Bottom right" };

function spanFor(q, filled) {
  const has = (x) => filled.includes(x);
  const row = q[0], col = q[1];
  const topEmpty   = !has("tl") && !has("tr");
  const botEmpty   = !has("bl") && !has("br");
  const leftEmpty  = !has("tl") && !has("bl");
  const rightEmpty = !has("tr") && !has("br");
  let rs = 1, cs = 1;
  if (row === "t" && botEmpty) rs = 2;
  if (row === "b" && topEmpty) rs = 2;
  if (col === "l" && rightEmpty) cs = 2;
  if (col === "r" && leftEmpty)  cs = 2;
  return { rs, cs };
}

function quadCoords(q) {
  const r = q[0] === "t" ? 1 : 2;
  const c = q[1] === "l" ? 1 : 2;
  return { r, c };
}

function ChatArea({ mode, view, setView, session, setSession, tokens, setTokens,
                    panes, setPanes, dragging, dragPayload, onFlipBack }) {
  const filled = QUADS.filter(q => panes[q]);
  const single = filled.length === 1;
  const [hoverQuad, setHoverQuad] = React.useState(null);

  // Determine which cells are covered by visible panes (so we know where to show empty placeholders).
  const covered = new Set();
  filled.forEach(q => {
    const { rs, cs } = spanFor(q, filled);
    const { r, c } = quadCoords(q);
    for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) covered.add(`${r+i}-${c+j}`);
  });
  const emptyCells = [];
  for (let r = 1; r <= 2; r++) for (let c = 1; c <= 2; c++) {
    if (!covered.has(`${r}-${c}`)) {
      const q = (r === 1 ? "t" : "b") + (c === 1 ? "l" : "r");
      emptyCells.push({ q, r, c });
    }
  }

  const onDropPane = (q, e) => {
    e.preventDefault();
    if (panes[q]) return;
    let payload = dragPayload.current;
    try {
      const raw = e.dataTransfer.getData("application/x-jarvis-session");
      if (raw) payload = JSON.parse(raw);
    } catch (_) {}
    if (!payload) return;
    setPanes(prev => ({ ...prev, [q]: payload }));
    setHoverQuad(null);
  };

  const closePane = (q) => {
    setPanes(prev => {
      const next = { ...prev, [q]: null };
      if (!QUADS.some(x => next[x])) {
        // Always keep at least one open — reopen the default
        next.tl = prev[q] || { id: "default", label: session.name, thread: window.THREAD };
      }
      return next;
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <TopBar session={session} setSession={setSession} mode={mode}
        tokens={tokens} setTokens={setTokens}
        view={view} setView={setView}
        paneCount={filled.length}
        onFlipBack={onFlipBack}
        onOpenChat={(modelId, message) => {
          // open the dropped model as a new pane in the first empty quadrant
          setPanes(prev => {
            const empty = QUADS.find(q => !prev[q]);
            const label = ({ clause: "Clause", claudia: "Claudia", claudio: "Claudio" })[modelId] || "Chat";
            const seed = message
              ? [{ from: "user", text: message, ts: new Date().toTimeString().slice(0,5) }]
              : window.THREAD.slice(0, 2);
            const pane = { id: "chat-" + Date.now(), label, thread: seed };
            if (!empty) return { ...prev, tl: pane };
            return { ...prev, [empty]: pane };
          });
        }}
      />

      <div style={{
        flex: 1, minHeight: 0,
        display: "grid",
        gridTemplateColumns: single ? "1fr" : "1fr 1fr",
        gridTemplateRows:    single ? "1fr" : "1fr 1fr",
        position: "relative",
        background: "var(--bg)",
      }}>
        {filled.map(q => {
          const { rs, cs } = single ? { rs: 1, cs: 1 } : spanFor(q, filled);
          const { r, c } = quadCoords(q);
          return (
            <div key={q}
              style={{
                gridRow:    single ? "1" : `${r} / span ${rs}`,
                gridColumn: single ? "1" : `${c} / span ${cs}`,
                minWidth: 0, minHeight: 0,
                display: "flex",
                position: "relative",
              }}
              onDragOver={dragging ? (e) => { e.preventDefault(); } : undefined}
            >
              <div style={{ flex: 1, display: "flex", minWidth: 0, minHeight: 0 }}>
                <Pane pane={panes[q]} single={single} mode={mode}
                  onClose={() => closePane(q)} />
              </div>
            </div>
          );
        })}

        {/* empty quadrant placeholders — only shown when at least one quadrant is filled and there are gaps */}
        {!single && emptyCells.map(({ q, r, c }) => (
          <div key={"empty-" + q}
            style={{ gridRow: `${r}`, gridColumn: `${c}`, padding: 4, minWidth: 0, minHeight: 0 }}
            onDragEnter={() => setHoverQuad(q)}
            onDragLeave={(e) => { if (e.currentTarget === e.target) setHoverQuad(null); }}
            onDragOver={(e) => { e.preventDefault(); }}
            onDrop={(e) => onDropPane(q, e)}
          >
            <div className={"dropzone" + (hoverQuad === q ? " over" : "")} style={{
              height: "100%", width: "100%",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              borderRadius: "var(--radius)",
              fontSize: 11,
              gap: 6,
            }}>
              <I.plus size={16} />
              <span className="mono upper" style={{ fontSize: 9, letterSpacing: ".14em" }}>{QUAD_LABEL[q]}</span>
              <span style={{ fontSize: 10.5 }}>Drop a chat here</span>
            </div>
          </div>
        ))}

        {/* Full overlay when single pane + dragging: 4-quadrant choice */}
        {single && dragging && (
          <div style={{
            position: "absolute", inset: 0,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gridTemplateRows: "1fr 1fr",
            background: "color-mix(in oklab, var(--bg) 78%, transparent)",
            zIndex: 10,
            padding: 8, gap: 8,
          }}>
            {QUADS.map(q => (
              <div key={q}
                onDragEnter={() => setHoverQuad(q)}
                onDragLeave={(e) => { if (e.currentTarget === e.target) setHoverQuad(null); }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  // The first filled quadrant is whatever was there before; we want to keep it.
                  // If user drops on that same quadrant, replace it. Otherwise, place new + keep old as tl.
                  e.preventDefault();
                  let payload = dragPayload.current;
                  try {
                    const raw = e.dataTransfer.getData("application/x-jarvis-session");
                    if (raw) payload = JSON.parse(raw);
                  } catch (_) {}
                  if (!payload) return;
                  setPanes(prev => {
                    const existing = QUADS.find(x => prev[x]);
                    const existingPane = existing ? prev[existing] : null;
                    const next = { tl: null, tr: null, bl: null, br: null };
                    if (q === existing) {
                      next[q] = payload;
                    } else {
                      next[existing || "tl"] = existingPane || prev.tl;
                      next[q] = payload;
                    }
                    return next;
                  });
                  setHoverQuad(null);
                }}
                className={"dropzone" + (hoverQuad === q ? " over" : "")}
                style={{
                  borderRadius: "var(--radius)",
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  gap: 4,
                  fontSize: 11,
                }}>
                <I.plus size={18} />
                <span className="mono upper" style={{ fontSize: 9, letterSpacing: ".14em" }}>{QUAD_LABEL[q]}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { ChatArea });
