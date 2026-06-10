// graph.jsx — Agent Framework graph (direct-DOM rAF animation, 60+fps)
//
// Renders once via React; a single rAF loop computes node wobble + edge endpoints
// and writes them directly to DOM via refs (no React re-renders during animation).

const NODE_SIZE = { orchestrator: 44, lead: 28, specialist: 18 };

function layout(agents, w, h) {
  const cx = w / 2, cy = h / 2;
  const orch  = agents.filter(a => a.type === "orchestrator");
  const leads = agents.filter(a => a.type === "lead");
  const specs = agents.filter(a => a.type === "specialist");
  const positions = {};
  orch.forEach(a => positions[a.id] = { x: cx, y: cy });
  const rLeads = Math.min(w, h) * 0.22;
  leads.forEach((a, i) => {
    const ang = -Math.PI / 2 + (i / leads.length) * Math.PI * 2;
    positions[a.id] = { x: cx + Math.cos(ang) * rLeads, y: cy + Math.sin(ang) * rLeads };
  });
  const rSpecs = Math.min(w, h) * 0.42;
  specs.forEach((a, i) => {
    const ang = -Math.PI / 2 + (i / specs.length) * Math.PI * 2 + 0.15;
    positions[a.id] = { x: cx + Math.cos(ang) * rSpecs, y: cy + Math.sin(ang) * rSpecs };
  });
  return positions;
}

function nodeColor(a) {
  if (a.status === "dormant") return "var(--muted)";
  if (a.type === "orchestrator") return "var(--primary)";
  if (a.type === "lead") return "var(--accent)";
  return "var(--text)";
}

function AgentGraph({
  agents = window.AGENTS,
  edges = window.EDGES,
  width = 800,
  height = 600,
  labels = true,
  showDormant = true,
  onSelect,
  selectedId,
  hoverId,
  setHoverId,
  zoom = 1,
  pan = { x: 0, y: 0 },
  setPan,
  panZoomEnabled = true,
}) {
  const base = React.useMemo(() => layout(agents, width, height), [agents, width, height]);
  const visible = showDormant ? agents : agents.filter(a => a.status === "active");
  const visibleIds = new Set(visible.map(a => a.id));

  // refs for direct DOM mutation
  const nodeRefs = React.useRef({});
  const edgeRefs = React.useRef([]);

  // animation phase pre-computed per agent
  const phases = React.useMemo(() => {
    const p = {};
    agents.forEach(a => {
      p[a.id] = {
        phase: (a.id.charCodeAt(0) + a.id.charCodeAt(1)) * 0.27,
        amp: a.type === "orchestrator" ? 1.2 : (a.type === "lead" ? 2.4 : 3.2),
      };
    });
    return p;
  }, [agents]);

  // rAF loop — runs once per mount, writes to DOM directly
  React.useEffect(() => {
    let raf;
    const start = performance.now();
    const tick = (now) => {
      const t = (now - start) / 1000;
      // compute positions
      const positions = {};
      agents.forEach(a => {
        const b = base[a.id]; const ph = phases[a.id];
        if (!b || !ph) return;
        const x = b.x + Math.cos(t * 0.6 + ph.phase) * ph.amp;
        const y = b.y + Math.sin(t * 0.5 + ph.phase * 1.3) * ph.amp;
        positions[a.id] = { x, y };
        const el = nodeRefs.current[a.id];
        if (el) {
          const s = NODE_SIZE[a.type];
          el.style.transform = `translate3d(${x - s/2}px, ${y - s/2}px, 0)`;
        }
      });
      // edges
      for (let i = 0; i < edges.length; i++) {
        const [a, b] = edges[i];
        const line = edgeRefs.current[i];
        if (!line) continue;
        const A = positions[a], B = positions[b];
        if (!A || !B) continue;
        line.setAttribute("x1", A.x);
        line.setAttribute("y1", A.y);
        line.setAttribute("x2", B.x);
        line.setAttribute("y2", B.y);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [agents, edges, base, phases, width, height]);

  // panning
  const stateRef = React.useRef({ dragging: false, sx: 0, sy: 0, px: 0, py: 0 });
  const onMouseDown = (e) => {
    if (!panZoomEnabled) return;
    if (e.target.dataset && e.target.dataset.nodeid) return;
    stateRef.current = { dragging: true, sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y };
  };
  const onMouseMove = (e) => {
    if (!stateRef.current.dragging) return;
    setPan && setPan({
      x: stateRef.current.px + (e.clientX - stateRef.current.sx),
      y: stateRef.current.py + (e.clientY - stateRef.current.sy),
    });
  };
  const onMouseUp = () => { stateRef.current.dragging = false; };

  return (
    <div
      style={{ position: "relative", width, height, overflow: "hidden", cursor: panZoomEnabled ? "grab" : "default" }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      {/* grid background */}
      <svg width={width} height={height} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <defs>
          <pattern id="g_grid" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M40 0H0V40" fill="none" stroke="var(--grid)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width={width} height={height} fill="url(#g_grid)" />
      </svg>

      <div style={{ position: "absolute", inset: 0, transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`, transformOrigin: "0 0" }}>
        {/* edges */}
        <svg width={width} height={height} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          {edges.map(([a, b], i) => {
            if (!visibleIds.has(a) || !visibleIds.has(b)) return null;
            const dim = agents.find(n => n.id === a).status === "dormant" ||
                        agents.find(n => n.id === b).status === "dormant";
            const hi = hoverId === a || hoverId === b || selectedId === a || selectedId === b;
            return (
              <line key={i}
                ref={(el) => { edgeRefs.current[i] = el; }}
                x1={base[a]?.x} y1={base[a]?.y}
                x2={base[b]?.x} y2={base[b]?.y}
                stroke={hi ? "var(--primary)" : "var(--border-2)"}
                strokeOpacity={dim ? .35 : (hi ? 1 : .85)}
                strokeWidth={hi ? 1.2 : .6}
              />
            );
          })}
        </svg>

        {/* nodes */}
        {visible.map(a => {
          const s = NODE_SIZE[a.type];
          const dim = a.status === "dormant";
          const sel = a.id === selectedId;
          const ring = a.type === "orchestrator" && !dim;
          const b = base[a.id] || { x: 0, y: 0 };
          return (
            <div key={a.id}
              ref={(el) => { nodeRefs.current[a.id] = el; }}
              data-nodeid={a.id}
              onMouseEnter={() => setHoverId && setHoverId(a.id)}
              onMouseLeave={() => setHoverId && setHoverId(null)}
              onClick={() => onSelect && onSelect(a.id)}
              style={{
                position: "absolute",
                left: 0, top: 0,
                width: s, height: s,
                background: nodeColor(a),
                opacity: dim ? .4 : 1,
                outline: sel ? "1.5px solid var(--text)" : "none",
                outlineOffset: 2,
                cursor: "default",
                borderRadius: a.type === "orchestrator" ? 4 : (a.type === "lead" ? 3 : 2),
                transform: `translate3d(${b.x - s/2}px, ${b.y - s/2}px, 0)`,
                willChange: "transform",
              }}
            >
              {ring && (
                <span style={{
                  position: "absolute", inset: -6,
                  border: "1px solid var(--primary)",
                  opacity: .5,
                  borderRadius: 6,
                  animation: "nodePulse 2.4s ease-out infinite",
                }} />
              )}
              {!dim && a.status === "active" && a.type !== "orchestrator" && (
                <span style={{
                  position: "absolute", inset: -3,
                  border: `1px solid ${a.type === "lead" ? "var(--accent)" : "var(--text)"}`,
                  opacity: .25,
                  borderRadius: 4,
                }} />
              )}
              {labels && (a.id === hoverId || a.id === selectedId) && (
                <div className="mono" style={{
                  position: "absolute",
                  left: s + 8, top: "50%", transform: "translateY(-50%)",
                  whiteSpace: "nowrap",
                  fontSize: 10,
                  letterSpacing: ".06em",
                  textTransform: "uppercase",
                  color: "var(--text)",
                  background: "var(--surface)",
                  border: "1px solid var(--border-2)",
                  padding: "3px 6px",
                  borderRadius: 3,
                  pointerEvents: "none",
                }}>
                  {a.name} <span style={{ color: "var(--subtext)" }}>· {a.role}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

Object.assign(window, { AgentGraph, nodeColor });
