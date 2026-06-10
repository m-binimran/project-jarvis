// sidebar.jsx — left column

const SectionLabel = ({ children, right }) => (
  <div className="mono upper" style={{
    display: "flex", justifyContent: "space-between", alignItems: "center",
    fontSize: 9, color: "var(--subtext)",
    padding: "16px 14px 6px",
  }}>
    <span>{children}</span>{right}
  </div>
);

const SBButton = ({ icon, children, onClick, active, style, full }) => (
  <button
    onClick={onClick}
    style={{
      display: "flex", alignItems: "center", gap: 6,
      width: full ? "100%" : "auto",
      padding: "7px 9px",
      fontSize: 11.5,
      fontWeight: 500,
      color: active ? "var(--text)" : "var(--text)",
      background: active ? "var(--primary-soft)" : "transparent",
      border: `1px solid ${active ? "var(--primary)" : "var(--border-2)"}`,
      borderRadius: 2,
      letterSpacing: ".01em",
      ...style,
    }}
  >{icon}{children}</button>
);

const ModeToggle = ({ mode, setMode }) => (
  <div style={{
    display: "flex",
    border: "1px solid var(--border-2)",
    height: 30,
    flex: 1,
  }}>
    {["basic", "enterprise"].map(m => {
      const active = mode === m;
      return (
        <button key={m} onClick={() => setMode(m)}
          className="mono upper"
          style={{
            flex: 1,
            fontSize: 9,
            letterSpacing: ".14em",
            background: active ? (m === "basic" ? "var(--primary-soft)" : "var(--primary-soft)") : "transparent",
            color: active ? "var(--text)" : "var(--subtext)",
            borderRight: m === "basic" ? "1px solid var(--border-2)" : "none",
          }}>
          {m === "basic" ? "BASIC" : "ENTRPRSE"}
        </button>
      );
    })}
  </div>
);

const BriefCard = ({ b, onClick, active }) => (
  <button onClick={onClick} style={{
    display: "block",
    width: "100%",
    padding: "8px 10px",
    margin: "0 0 1px 0",
    border: 0,
    background: active ? "var(--surface-2)" : "transparent",
    borderLeft: `2px solid ${active ? "var(--primary)" : "transparent"}`,
    textAlign: "left",
  }}
  onMouseEnter={e => { if (!active) e.currentTarget.style.background = "var(--surface-2)"; }}
  onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
  >
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
      <span className="mono upper" style={{ fontSize: 9, color: "var(--subtext)", letterSpacing: ".1em" }}>{b.date}</span>
      <span style={{
        width: 6, height: 6,
        background: b.dot === "urgent" ? "var(--primary)" : "var(--accent)",
        display: "inline-block",
      }} />
    </div>
    <div style={{ fontSize: 11.5, color: "var(--text)", lineHeight: 1.35 }}>{b.summary}</div>
  </button>
);

const Expand = ({ open, label, children, count }) => {
  const [o, setO] = React.useState(open);
  return (
    <div>
      <button onClick={() => setO(!o)}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          width: "100%", padding: "6px 14px",
          color: "var(--text)", fontSize: 12,
          fontWeight: 500,
          textAlign: "left",
        }}>
        <span style={{ transform: o ? "rotate(90deg)" : "none", transition: "transform .12s", display: "inline-flex" }}>
          <I.chev size={10} />
        </span>
        <span style={{ flex: 1 }}>{label}</span>
        {count != null && (
          <span className="mono" style={{ fontSize: 10, color: "var(--subtext)" }}>{count}</span>
        )}
      </button>
      {o && <div style={{ padding: "2px 14px 6px 26px" }}>{children}</div>}
    </div>
  );
};

const SkillRow = ({ s, onToggle }) => (
  <div style={{
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "4px 0", fontSize: 11.5,
  }}>
    <span style={{ color: s.on ? "var(--text)" : "var(--muted)" }}>{s.name}</span>
    <button onClick={() => onToggle(s.id)}
      style={{
        width: 24, height: 12,
        border: `1px solid ${s.on ? "var(--primary)" : "var(--border-2)"}`,
        background: s.on ? "var(--primary-soft)" : "transparent",
        position: "relative",
      }}>
      <span style={{
        position: "absolute", top: 1, bottom: 1,
        left: s.on ? "calc(100% - 9px)" : 1,
        width: 8,
        background: s.on ? "var(--primary)" : "var(--muted)",
        transition: "left .12s",
      }} />
    </button>
  </div>
);

const CharCard = ({ c }) => (
  <button style={{
    display: "flex", alignItems: "center", gap: 8,
    width: "100%", padding: "5px 0",
    color: "var(--text)", textAlign: "left",
  }}
    onMouseEnter={e => e.currentTarget.style.color = "var(--accent)"}
    onMouseLeave={e => e.currentTarget.style.color = "var(--text)"}>
    <span className="mono" style={{
      width: 22, height: 22,
      border: "1px solid var(--border-2)",
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      fontSize: 9, letterSpacing: ".06em",
      color: "var(--accent)",
    }}>{c.init}</span>
    <span style={{ flex: 1, fontSize: 11.5 }}>{c.name}</span>
    <span className="mono" style={{ fontSize: 9, color: "var(--subtext)" }}>{c.tone}</span>
  </button>
);

const HistoryItem = ({ h, active, onClick, onDragStart, onDragEnd }) => (
  <button onClick={onClick}
    draggable
    onDragStart={(e) => {
      e.dataTransfer.effectAllowed = "copy";
      e.dataTransfer.setData("application/x-jarvis-session",
        JSON.stringify({ id: h.id, label: h.title, thread: window.THREAD.slice(0, 4) }));
      onDragStart && onDragStart(h);
    }}
    onDragEnd={() => onDragEnd && onDragEnd()}
    style={{
      display: "flex", alignItems: "center", gap: 6,
      width: "100%", padding: "6px 14px",
      background: active ? "var(--surface-2)" : "transparent",
      borderLeft: `2px solid ${active ? "var(--accent)" : "transparent"}`,
      textAlign: "left",
      color: "var(--text)",
      position: "relative",
      cursor: "grab",
    }}
    onMouseEnter={e => { if (!active) e.currentTarget.style.background = "var(--surface-2)"; const tr = e.currentTarget.querySelector('.hi-tr'); if (tr) tr.style.opacity = 1; }}
    onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; const tr = e.currentTarget.querySelector('.hi-tr'); if (tr) tr.style.opacity = 0; }}
  >
    <span className="mono" style={{
      fontSize: 8, letterSpacing: ".1em",
      border: `1px solid ${h.mode === "B" ? "var(--primary)" : "var(--accent)"}`,
      color: h.mode === "B" ? "var(--primary)" : "var(--accent)",
      padding: "1px 3px",
      lineHeight: 1,
      borderRadius: 2,
    }}>{h.mode}</span>
    <span style={{
      flex: 1, fontSize: 11.5,
      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
    }}>{h.title}</span>
    <span className="mono" style={{ fontSize: 9, color: "var(--subtext)" }}>{h.ts}</span>
    <span className="hi-tr" style={{ position: "absolute", right: 6, opacity: 0, color: "var(--muted)", background: "var(--surface-2)", padding: "2px 4px", borderRadius: 3, transition: "opacity .12s" }}>
      <I.trash size={11} />
    </span>
  </button>
);

function Sidebar({ mode, setMode, view, setView, briefId, setBriefId, skills, setSkills, sessionId, setSessionId,
                   width = 240, setWidth, onDragSessionStart, onDragSessionEnd }) {
  const [histTab, setHistTab] = React.useState("chats");
  const histList = histTab === "chats" ? window.HISTORY_CHATS : window.HISTORY_PROJECTS;
  const toggleSkill = (id) => setSkills(s => s.map(x => x.id === id ? { ...x, on: !x.on } : x));

  // resize handle
  const dragRef = React.useRef({ active: false, startX: 0, startW: 0 });
  React.useEffect(() => {
    const move = (e) => {
      if (!dragRef.current.active) return;
      const dx = e.clientX - dragRef.current.startX;
      const next = Math.min(360, Math.max(190, dragRef.current.startW + dx));
      setWidth && setWidth(next);
    };
    const up = () => { dragRef.current.active = false; document.body.style.cursor = ""; document.body.style.userSelect = ""; };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, [setWidth]);
  const onHandleDown = (e) => {
    dragRef.current = { active: true, startX: e.clientX, startW: width };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <aside style={{
      width, flexShrink: 0,
      background: "var(--surface)",
      borderRight: "1px solid var(--border)",
      display: "flex", flexDirection: "column",
      height: "100%",
      overflow: "hidden",
      position: "relative",
    }}>
      {/* logo */}
      <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <LogoMark size={18} />
          <span className="upper gold-text" style={{ fontSize: 13, letterSpacing: ".34em", fontWeight: 700 }}>JARVIS</span>
          <span style={{ flex: 1 }} />
          <span className="mono" style={{ fontSize: 8, color: "var(--subtext)", letterSpacing: ".08em" }}>v0.4.1</span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <SBButton full icon={<I.plus size={11} />} style={{ flex: 1, justifyContent: "center", borderRadius: "var(--radius-sm)" }} onClick={() => setView("chat")}>
            <span style={{ marginLeft: 2 }}>{mode === "basic" ? "New Task" : "New Project"}</span>
          </SBButton>
        </div>
        <div style={{ display: "flex", marginTop: 6 }}>
          <ModeToggle mode={mode} setMode={setMode} />
        </div>
      </div>

      {/* scroll */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
        <SectionLabel right={<span className="mono" style={{ fontSize: 9 }}>3</span>}>Daily Briefs</SectionLabel>
        <div>
          {window.DAILY_BRIEFS.map(b =>
            <BriefCard key={b.id} b={b}
              active={view === "brief" && briefId === b.id}
              onClick={() => { setView("brief"); setBriefId(b.id); }}
            />
          )}
        </div>

        <SectionLabel>Customize</SectionLabel>
        <Expand open label="Skills" count={`${skills.filter(s => s.on).length}/${skills.length}`}>
          {skills.map(s => <SkillRow key={s.id} s={s} onToggle={toggleSkill} />)}
          <button style={{
            display: "flex", alignItems: "center", gap: 4,
            color: "var(--subtext)", fontSize: 10.5,
            marginTop: 4, padding: "4px 0",
          }}><I.plus size={10} /> Add skill</button>
        </Expand>
        <Expand label="Characters" count={window.CHARACTERS.length}>
          {window.CHARACTERS.map(c => <CharCard key={c.id} c={c} />)}
          <button style={{
            display: "flex", alignItems: "center", gap: 4,
            color: "var(--subtext)", fontSize: 10.5,
            marginTop: 4, padding: "4px 0",
          }}><I.plus size={10} /> Add advisor</button>
        </Expand>
        <button onClick={() => setView("framework")}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            width: "100%", padding: "8px 14px",
            background: view === "framework" ? "var(--surface-2)" : "transparent",
            borderLeft: `2px solid ${view === "framework" ? "var(--primary)" : "transparent"}`,
            color: "var(--text)", textAlign: "left",
            fontSize: 12, fontWeight: 500,
          }}
          onMouseEnter={e => { if (view !== "framework") e.currentTarget.style.background = "var(--surface-2)"; }}
          onMouseLeave={e => { if (view !== "framework") e.currentTarget.style.background = "transparent"; }}
        >
          <I.graph size={13} />
          <span style={{ flex: 1 }}>Agent Framework</span>
          <span className="mono" style={{ fontSize: 9, color: view === "framework" ? "var(--accent)" : "var(--subtext)" }}>
            {window.AGENTS.filter(a => a.status === "active").length}/{window.AGENTS.length}
          </span>
        </button>

        {/* History */}
        <SectionLabel right={
          <div style={{ display: "flex", gap: 6 }}>
            {["chats","projects"].map(t => (
              <button key={t} onClick={() => setHistTab(t)}
                className="mono upper"
                style={{
                  fontSize: 9, letterSpacing: ".1em",
                  color: histTab === t ? "var(--text)" : "var(--subtext)",
                  borderBottom: `1px solid ${histTab === t ? "var(--primary)" : "transparent"}`,
                  paddingBottom: 1,
                }}>{t}</button>
            ))}
          </div>
        }>History</SectionLabel>
        <div>
          {histList.map(h =>
            <HistoryItem key={h.id} h={h}
              active={sessionId === h.id}
              onClick={() => { setSessionId(h.id); setView("chat"); }}
              onDragStart={onDragSessionStart}
              onDragEnd={onDragSessionEnd}
            />
          )}
        </div>
        <div style={{ height: 16 }} />
      </div>

      {/* bottom user bar */}
      <div style={{
        borderTop: "1px solid var(--border)",
        padding: "9px 14px",
        display: "flex", alignItems: "center", gap: 8,
        background: "var(--surface)",
      }}>
        <span style={{
          width: 22, height: 22, background: "var(--surface-2)",
          border: "1px solid var(--border-2)",
          borderRadius: "var(--radius-sm)",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}><I.user size={12} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11.5, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>M. Carraway</div>
          <div className="mono" style={{ fontSize: 9, color: "var(--subtext)", letterSpacing: ".06em" }}>OPERATOR · LOCAL</div>
        </div>
        <span style={{ width: 6, height: 6, background: "var(--ok)", display: "inline-block", borderRadius: "50%" }} />
      </div>

      {/* resize handle */}
      <div
        onMouseDown={onHandleDown}
        title="Drag to resize"
        style={{
          position: "absolute", top: 0, right: -3, bottom: 0,
          width: 6, cursor: "col-resize",
          zIndex: 5,
        }}
      >
        <div style={{
          position: "absolute", top: 0, bottom: 0, left: 3,
          width: 1, background: "transparent",
          transition: "background .12s",
        }} className="sb-resizer" />
      </div>
    </aside>
  );
}

Object.assign(window, { Sidebar });
