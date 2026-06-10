// orb.jsx — JARVIS Orb HUD (the "back" face)
//
// Central listening orb that:
//   - Listens to the mic if granted; otherwise simulates input
//   - When AI is "speaking" (state: speaking), mimics output via a scripted envelope
//   - Surrounded by ring fidgets, telemetry panels, chat launcher

const ORB_STATES = ["idle", "listening", "thinking", "speaking"];

// ───────────────────────────────────────────────────────────────────────────
// Audio engine: returns a continuously updating amplitude (0..1) ref
// based on either mic input or a simulated waveform tied to state.

function useOrbAmplitude(state) {
  const ampRef      = React.useRef(0);
  const freqRef     = React.useRef(0);
  const analyserRef = React.useRef(null); // exposed so WaveformPanel can read frequency bins
  const dataRef     = React.useRef(null);
  const ctxRef      = React.useRef(null);
  const streamRef   = React.useRef(null);

  React.useEffect(() => {
    let mounted = true;
    if (state === "listening" && navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        if (!mounted) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        ctxRef.current = ctx;
        const src = ctx.createMediaStreamSource(stream);
        const an  = ctx.createAnalyser();
        an.fftSize = 512;                   // 256 frequency bins
        an.smoothingTimeConstant = 0.75;
        src.connect(an);
        analyserRef.current = an;
        dataRef.current = new Uint8Array(an.frequencyBinCount);
      }).catch(() => {/* no mic */});
    } else if (state !== "listening") {
      // mic released — tear down
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
      if (ctxRef.current)    { try { ctxRef.current.close(); } catch(_){} ctxRef.current = null; }
      analyserRef.current = null;
      dataRef.current = null;
    }
    return () => {
      mounted = false;
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); }
      if (ctxRef.current)    { try { ctxRef.current.close(); } catch(_){} }
    };
  }, [state]);

  const sample = React.useCallback((t) => {
    let amp = 0, freq = 0;
    const an = analyserRef.current, data = dataRef.current;
    if (an && data) {
      an.getByteFrequencyData(data);
      let sum = 0, hi = 0;
      for (let i = 0; i < data.length; i++) { sum += data[i]; if (i > data.length / 2) hi += data[i]; }
      amp  = Math.min(1.3, (sum / data.length) / 128);
      freq = Math.min(1.3, (hi  / (data.length / 2)) / 128);
    } else {
      if (state === "thinking") { amp = 0.18 + Math.sin(t * 0.8) * 0.05; freq = 0.4; }
      else                      { amp = 0.12 + Math.sin(t * 0.5) * 0.04; freq = 0.3; }
    }
    ampRef.current  = Math.max(0, Math.min(1, amp));
    freqRef.current = Math.max(0, Math.min(1, freq));
  }, [state]);

  return { ampRef, freqRef, analyserRef, sample };
}

// ───────────────────────────────────────────────────────────────────────────
// Orb canvas: 360° particle ring + radial waveform — drawn on <canvas>

function OrbCanvas({ size = 360, state, ampRef, freqRef, sample, pal }) {
  const cvRef = React.useRef(null);
  const palRef = React.useRef(pal);
  palRef.current = pal;

  React.useEffect(() => {
    const cv = cvRef.current; if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = size * dpr;
    cv.height = size * dpr;
    const ctx = cv.getContext("2d");
    ctx.scale(dpr, dpr);

    // particles in a sphere shell
    const N = 220;
    const parts = [];
    for (let i = 0; i < N; i++) {
      const u = Math.random(), v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      parts.push({
        theta, phi,
        r: 0.86 + Math.random() * 0.18,
        spin: 0.6 + Math.random() * 0.6,
        wob: Math.random() * Math.PI * 2,
      });
    }
    // ambient pinpricks (the dust)
    const dust = [];
    for (let i = 0; i < 80; i++) {
      dust.push({
        a: Math.random() * Math.PI * 2,
        r: 1.0 + Math.random() * 0.3,
        s: 0.2 + Math.random() * 0.6,
      });
    }

    let raf, start = performance.now();
    const tick = (now) => {
      const t = (now - start) / 1000;
      sample(t);
      const amp = ampRef.current;
      const freq = freqRef.current;

      const cx = size / 2, cy = size / 2;
      const R = size * 0.32;

      ctx.clearRect(0, 0, size, size);

      // resolved palette (mode-aware, passed from React)
      const P = palRef.current || {};
      const prim = P.primary || "#9C7B3D";
      const accent = P.accent || "#C9A84C";
      const core = P.core || "#ffffff";

      // central glow disc
      const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, R * (1.0 + amp * 0.7));
      glow.addColorStop(0,    hexA(prim, 0.7 + amp * 0.3));
      glow.addColorStop(0.35, hexA(prim, 0.3 + amp * 0.18));
      glow.addColorStop(1,    hexA(prim, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, R * (1.0 + amp * 0.7), 0, Math.PI * 2);
      ctx.fill();

      // outer wire-rings
      ctx.lineWidth = 1;
      ctx.strokeStyle = hexA(prim, 0.6);
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.2, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = hexA(prim, 0.18);
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.45, 0, Math.PI * 2); ctx.stroke();
      // dashed third ring
      ctx.strokeStyle = hexA(accent, 0.35);
      ctx.setLineDash([2, 6]);
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.65, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);

      // dust particles (outside the orb)
      for (const d of dust) {
        const a = d.a + t * 0.05;
        const r = R * (1.3 + d.r * 0.25);
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        ctx.fillStyle = hexA(prim, 0.18 + Math.sin(t * d.s + d.a) * 0.18);
        ctx.fillRect(x, y, 1.2, 1.2);
      }

      // sphere particles — projected onto 2D with depth shading
      for (const p of parts) {
        // rotate around y
        const ang = p.theta + t * 0.25 * p.spin;
        // amplitude pushes radius outward
        const rr = R * (p.r + amp * 0.35 * Math.sin(t * 2 + p.wob));
        // sphere → 2D
        const sx = Math.sin(p.phi) * Math.cos(ang);
        const sy = Math.cos(p.phi);
        const sz = Math.sin(p.phi) * Math.sin(ang);

        const x = cx + sx * rr;
        const y = cy + sy * rr;

        // depth (sz in -1..1) → opacity + size
        const depth = (sz + 1) / 2;
        const op = 0.22 + depth * 0.78;
        const sz2 = 0.7 + depth * 1.7 + amp * 1.5;
        ctx.fillStyle = hexA(prim, op);
        ctx.fillRect(x - sz2 / 2, y - sz2 / 2, sz2, sz2);
      }

      // central core
      ctx.fillStyle = hexA(core, 0.6 + amp * 0.4);
      ctx.beginPath();
      ctx.arc(cx, cy, 4 + amp * 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hexA(prim, 0.85);
      ctx.beginPath();
      ctx.arc(cx, cy, 2 + amp * 3, 0, Math.PI * 2);
      ctx.fill();

      // radial waveform around the orb (12 spokes)
      const SPOKES = 96;
      ctx.lineWidth = 1.2;
      for (let i = 0; i < SPOKES; i++) {
        const a = (i / SPOKES) * Math.PI * 2;
        const phase = Math.sin(t * 4 + i * 0.3) * 0.5 + 0.5;
        const len = R * 0.06 + amp * R * 0.5 * phase * (state === "idle" ? 0.3 : 1);
        const r1 = R * 1.21;
        const r2 = r1 + len;
        ctx.strokeStyle = hexA(prim, 0.5 * phase + amp * 0.3);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
        ctx.stroke();
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [size, state, ampRef, freqRef, sample]);

  return <canvas ref={cvRef} width={size} height={size} style={{ width: size, height: size, display: "block" }} />;
}

// utility: hex (#rgb / #rrggbb / oklab) → rgba string. Falls back for non-hex.
function hexA(c, a) {
  c = (c || "").trim();
  if (c.startsWith("#")) {
    let h = c.slice(1);
    if (h.length === 3) h = h.split("").map(x => x + x).join("");
    const n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  // assume already a CSS color string
  return c;
}

// ───────────────────────────────────────────────────────────────────────────
// Surrounding ring fidgets

function RingFidgets({ size, state }) {
  // outer SVG: rotating tick rings + corner brackets
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <defs>
        <linearGradient id="hud-ring-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"  stopColor="var(--primary)" stopOpacity=".0" />
          <stop offset="50%" stopColor="var(--primary)" stopOpacity=".9" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity=".0" />
        </linearGradient>
      </defs>
      <g style={{ transformOrigin: `${size/2}px ${size/2}px`, animation: "spin 32s linear infinite" }}>
        {/* ticks */}
        {Array.from({ length: 72 }, (_, i) => {
          const a = (i / 72) * Math.PI * 2;
          const r1 = size * 0.48;
          const r2 = r1 - (i % 6 === 0 ? 10 : 4);
          return (
            <line key={i}
              x1={size/2 + Math.cos(a) * r1} y1={size/2 + Math.sin(a) * r1}
              x2={size/2 + Math.cos(a) * r2} y2={size/2 + Math.sin(a) * r2}
              stroke="var(--primary)" strokeOpacity={i % 6 === 0 ? .6 : .25}
              strokeWidth={1}
            />
          );
        })}
      </g>
      {/* inner rotating arc */}
      <g style={{ transformOrigin: `${size/2}px ${size/2}px`, animation: "spinRev 12s linear infinite" }}>
        <circle cx={size/2} cy={size/2} r={size * 0.4} fill="none" stroke="url(#hud-ring-grad)" strokeWidth="1.4" />
      </g>
      {/* corner brackets */}
      {[
        [10, 10, "M0 20 L0 0 L20 0"],
        [size - 10, 10, `M${-20} 0 L0 0 L0 20`],
        [10, size - 10, `M0 -20 L0 0 L20 0`],
        [size - 10, size - 10, `M-20 0 L0 0 L0 -20`],
      ].map(([x, y, d], i) => (
        <path key={i} d={d} transform={`translate(${x},${y})`}
          stroke="var(--primary)" strokeOpacity=".6" strokeWidth="1.4" fill="none" />
      ))}
    </svg>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// HUD telemetry panels

function HudPanel({ title, children, style }) {
  return (
    <div className="card" style={{
      background: "color-mix(in oklab, var(--surface) 88%, transparent)",
      backdropFilter: "blur(8px)",
      padding: 12,
      ...style,
    }}>
      <div className="mono upper" style={{
        fontSize: 9, letterSpacing: ".18em",
        color: "var(--subtext)", marginBottom: 8,
        display: "flex", alignItems: "center", gap: 6,
      }}>
        <span style={{ width: 5, height: 5, background: "var(--primary)", borderRadius: "50%", animation: "blink 2s infinite" }} />
        {title}
      </div>
      {children}
    </div>
  );
}

function Sparkline({ values, color = "var(--primary)" }) {
  const w = 100, h = 24;
  const max = Math.max(...values) || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - (v / max) * h}`).join(" ");
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.2" />
    </svg>
  );
}

// Real JARVIS stats from the daemon
function StatusPanel() {
  const [stats, setStats] = React.useState({
    agents: 0, total: 0,
    tokens: 0, cost: 0,
    provider: "—", mode: "—",
    messages: 0,
  });

  React.useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const [agentRes, usageRes, healthRes] = await Promise.all([
          fetch(`${window.DAEMON_URL}/api/agents`).then(r => r.json()).catch(() => ({})),
          fetch(`${window.DAEMON_URL}/api/usage`).then(r => r.json()).catch(() => ({})),
          fetch(`${window.DAEMON_URL}/health`).then(r => r.json()).catch(() => ({})),
        ]);
        if (!mounted) return;
        const agents  = agentRes.agents  ?? [];
        const today   = usageRes.today   ?? {};
        setStats({
          agents:   agents.filter(a => a.status === "active").length,
          total:    agents.length,
          tokens:   today.tokens   ?? 0,
          cost:     today.costUsd  ?? 0,
          provider: healthRes.mode ? healthRes.mode.toUpperCase() : "—",
          mode:     healthRes.version ?? "v0.1",
        });
      } catch {}
    }
    load();
    const id = setInterval(load, 8000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  const rows = [
    ["AGENTS",   `${stats.agents} / ${stats.total}`],
    ["TOKENS",   stats.tokens > 0 ? stats.tokens.toLocaleString() : "0"],
    ["COST",     `$${stats.cost.toFixed(4)}`],
    ["MODE",     stats.provider],
    ["DAEMON",   stats.mode],
  ];

  return (
    <HudPanel title="JARVIS Status">
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: "1px dashed var(--border)", gap: 6 }}>
          <span className="mono upper" style={{ fontSize: 9, color: "var(--muted)", letterSpacing: ".14em" }}>{k}</span>
          <span className="mono" style={{ fontSize: 10.5, color: "var(--text)" }}>{v}</span>
        </div>
      ))}
    </HudPanel>
  );
}

// Real audit log — last actions from the daemon
function ActivityPanel() {
  const [entries, setEntries] = React.useState([]);

  React.useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const { entries: log } = await fetch(`${window.DAEMON_URL}/api/audit?limit=8`).then(r => r.json());
        if (mounted && log?.length) setEntries(log);
      } catch {}
    }
    load();
    const id = setInterval(load, 5000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  function fmt(action) {
    return action
      .replace(/_/g, " ")
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  function relTime(ts) {
    if (!ts) return "";
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60)  return `${s}s`;
    if (s < 3600) return `${Math.floor(s/60)}m`;
    return `${Math.floor(s/3600)}h`;
  }

  return (
    <HudPanel title="Activity">
      {entries.length === 0 ? (
        <div className="mono" style={{ fontSize: 9, color: "var(--subtext)", padding: "4px 0" }}>No activity yet</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {entries.map((e, i) => (
            <div key={e.id || i} style={{ display: "flex", justifyContent: "space-between", gap: 6, fontSize: 10 }}>
              <span style={{
                color: e.outcome === "failure" ? "var(--bad)" : "var(--muted)",
                flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>{fmt(e.action)}</span>
              <span className="mono" style={{ color: "var(--subtext)", fontSize: 9, flexShrink: 0 }}>{relTime(e.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </HudPanel>
  );
}

function MiniRadarPanel({ color }) {
  const cvRef = React.useRef(null);
  const colorRef = React.useRef(color);
  colorRef.current = color;
  React.useEffect(() => {
    const cv = cvRef.current; if (!cv) return;
    const ctx = cv.getContext("2d");
    const W = cv.width, H = cv.height;
    let raf, start = performance.now();
    const blips = Array.from({ length: 6 }, () => ({
      a: Math.random() * Math.PI * 2,
      r: 0.2 + Math.random() * 0.75,
      life: Math.random(),
    }));
    const tick = (now) => {
      const t = (now - start) / 1000;
      ctx.clearRect(0, 0, W, H);
      const cx = W/2, cy = H/2;
      const prim = colorRef.current || "#9C7B3D";
      ctx.strokeStyle = hexA(prim, .3);
      ctx.lineWidth = 1;
      [0.3, 0.55, 0.8, 1.0].forEach(f => { ctx.beginPath(); ctx.arc(cx, cy, (W/2) * f, 0, Math.PI*2); ctx.stroke(); });
      ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(W, cy); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke();
      // sweep
      const swA = t * 1.4;
      const grad = ctx.createConicGradient ? ctx.createConicGradient(swA, cx, cy) : null;
      if (grad) {
        grad.addColorStop(0,    hexA(prim, .5));
        grad.addColorStop(0.15, hexA(prim, 0));
        grad.addColorStop(1,    hexA(prim, 0));
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(cx, cy, W/2, 0, Math.PI * 2); ctx.fill();
      }
      // blips
      blips.forEach(b => {
        const x = cx + Math.cos(b.a) * b.r * (W/2 - 4);
        const y = cy + Math.sin(b.a) * b.r * (W/2 - 4);
        ctx.fillStyle = hexA(prim, 0.6 + Math.sin(t * 4 + b.life * 10) * 0.4);
        ctx.fillRect(x - 1, y - 1, 2, 2);
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <HudPanel title="Spatial Map">
      <div style={{ display: "flex", justifyContent: "center" }}>
        <canvas ref={cvRef} width={140} height={120} style={{ width: 140, height: 120 }} />
      </div>
    </HudPanel>
  );
}

// WaveformPanel — real equalizer bars from WebAudio frequency data.
// When mic is active: draws live frequency bins as vertical bars.
// When idle: draws very small baseline bars so it doesn't look broken.
function WaveformPanel({ analyserRef, color }) {
  const cvRef    = React.useRef(null);
  const colorRef = React.useRef(color);
  colorRef.current = color;

  React.useEffect(() => {
    const cv = cvRef.current; if (!cv) return;
    const ctx = cv.getContext("2d");
    const W = cv.offsetWidth || 220;
    const H = 56;
    cv.width  = W * (window.devicePixelRatio || 1);
    cv.height = H * (window.devicePixelRatio || 1);
    ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);

    const BARS  = 40;
    const GAP   = 2;
    const barW  = (W - GAP * (BARS - 1)) / BARS;
    // smoothed heights for animation
    const smooth = new Float32Array(BARS).fill(0);
    let raf;

    const tick = (now) => {
      const t = now / 1000;
      ctx.clearRect(0, 0, W, H);
      const prim = colorRef.current || "#0ABAB5";
      const an = analyserRef.current;

      for (let i = 0; i < BARS; i++) {
        let target = 0;
        if (an) {
          // map bar index to frequency bin (emphasise lower/mid bands more)
          const bin  = Math.floor(Math.pow(i / BARS, 1.4) * (an.frequencyBinCount * 0.7));
          const data = new Uint8Array(an.frequencyBinCount);
          an.getByteFrequencyData(data);
          target = data[bin] / 255;
        } else {
          // idle micro-breathe so bars aren't dead flat
          target = 0.03 + Math.abs(Math.sin(t * 0.8 + i * 0.4)) * 0.04;
        }
        // ease toward target
        smooth[i] += (target - smooth[i]) * (an ? 0.5 : 0.08);

        const h    = Math.max(2, smooth[i] * (H - 4));
        const x    = i * (barW + GAP);
        const y    = H - h;
        const op   = 0.4 + smooth[i] * 0.6;

        ctx.fillStyle = hexA(prim, op);
        ctx.fillRect(x, y, barW, h);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [analyserRef]);

  return (
    <HudPanel title="Acoustic">
      <canvas ref={cvRef} style={{ width: "100%", height: 56, display: "block" }} />
    </HudPanel>
  );
}

function ObjectiveBar({ state, transcript }) {
  const stateLabel = {
    idle: "STANDING BY",
    listening: "LISTENING",
    thinking: "REASONING",
    speaking: "SPEAKING",
  }[state];
  return (
    <div className="card" style={{
      background: "color-mix(in oklab, var(--surface) 88%, transparent)",
      backdropFilter: "blur(8px)",
      padding: "8px 14px",
      display: "flex", alignItems: "center", gap: 14,
      minHeight: 36,
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: "50%",
        background: state === "speaking" ? "var(--accent)" :
                    state === "listening" ? "var(--primary)" :
                    state === "thinking" ? "var(--warn)" : "var(--muted)",
        boxShadow: `0 0 8px currentColor`,
        animation: state === "idle" ? "none" : "blink 1.2s infinite",
      }} />
      <span className="mono upper" style={{ fontSize: 10, letterSpacing: ".18em", color: "var(--primary)" }}>
        {stateLabel}
      </span>
      <span style={{ color: "var(--border-2)" }}>│</span>
      <span style={{
        flex: 1, fontSize: 12, color: "var(--text)",
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      }}>{transcript}</span>
      <span className="mono" style={{ fontSize: 10, color: "var(--subtext)" }}>
        SESSION 04 · LOCAL
      </span>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Top-right chat launcher — closed: icon button; open: model picker chips

const CHAT_MODELS = [
  { id: "clause",  name: "Clause",  desc: "Direct, terse" },
  { id: "claudia", name: "Claudia", desc: "Warm, narrative" },
  { id: "claudio", name: "Claudio", desc: "Analytical, precise" },
];

function ChatLauncher({ onOpenChat }) {
  const [open, setOpen] = React.useState(false);
  const [picked, setPicked] = React.useState("clause");
  const [value, setValue] = React.useState("");
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen(o => !o)}
        className="card"
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "6px 10px",
          fontSize: 11.5,
          background: "color-mix(in oklab, var(--surface) 88%, transparent)",
          backdropFilter: "blur(8px)",
          color: "var(--text)",
        }}>
        <I.brain size={13} />
        <span>Chat</span>
        <span className="mono upper" style={{ fontSize: 9, color: "var(--subtext)", letterSpacing: ".14em" }}>
          {open ? "open" : ""}
        </span>
      </button>
      {open && (
        <div className="popover" style={{
          position: "absolute", top: "calc(100% + 8px)", right: 0,
          width: 320, padding: 12, zIndex: 30,
        }}>
          <div className="mono upper" style={{ fontSize: 9, letterSpacing: ".14em", color: "var(--subtext)", marginBottom: 6 }}>
            Quick chat
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            {CHAT_MODELS.map(m => {
              const active = picked === m.id;
              return (
                <button key={m.id} onClick={() => setPicked(m.id)}
                  style={{
                    flex: 1,
                    padding: "8px 6px",
                    background: active ? "var(--primary-soft)" : "var(--surface-2)",
                    border: `1px solid ${active ? "var(--primary)" : "var(--border)"}`,
                    borderRadius: "var(--radius-sm)",
                    textAlign: "center",
                  }}>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: active ? "var(--primary)" : "var(--text)" }}>{m.name}</div>
                  <div className="mono" style={{ fontSize: 9, color: "var(--subtext)", letterSpacing: ".06em" }}>{m.desc}</div>
                </button>
              );
            })}
          </div>
          <div style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            padding: 8,
            display: "flex", alignItems: "flex-end", gap: 6,
          }}>
            <textarea
              value={value} onChange={(e) => setValue(e.target.value)}
              placeholder={`Ask ${CHAT_MODELS.find(m => m.id === picked).name}…`}
              rows={2}
              style={{
                flex: 1, background: "transparent",
                resize: "none", border: 0, outline: 0,
                color: "var(--text)", fontFamily: "inherit",
                fontSize: 12, lineHeight: 1.4, minHeight: 32,
              }}
            />
            <button className="gold"
              onClick={() => { if (value.trim()) { onOpenChat && onOpenChat(picked, value); setValue(""); setOpen(false); } }}
              style={{ width: 26, height: 24, borderRadius: "var(--radius-sm)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              <I.send size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Active Agent Panel — polls daemon every 2s, shows live agent status

function ActiveAgentPanel() {
  const [agents, setAgents] = React.useState([]);
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    let mounted = true;
    async function poll() {
      try {
        const res = await fetch(`${window.DAEMON_URL}/api/agents`);
        if (!res.ok || !mounted) return;
        const { agents: all } = await res.json();
        const active = all.filter(a => a.status === "active");
        if (mounted) setAgents(active.length > 0 ? active : all.slice(0, 3));
      } catch { /* daemon offline */ }
    }
    poll();
    const id = setInterval(() => { poll(); setTick(t => t + 1); }, 2000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  // Cycling task descriptions for active agents (since daemon tracks status not live task text)
  const TASK_HINTS = {
    "jarvis":          "Routing requests · orchestrating",
    "ceo":             "Strategic oversight",
    "research-agent":  "Scanning sources",
    "content-lead":    "Reviewing drafts",
    "marketing-lead":  "Campaign planning",
    "ops-lead":        "Queue management",
    "finance-lead":    "Budget review",
    "task-agent":      "Tracking tasks",
    "code-agent":      "Code review",
    "comms-agent":     "Draft queue",
    "calendar-agent":  "Schedule check",
    "fs-agent":        "File ops",
    "content-enterprise": "Writing content",
    "social-agent":    "Social drafts",
    "analytics-agent": "Analysing metrics",
    "project-agent":   "Project status",
    "automation-agent":"Running workflows",
    "budget-agent":    "Expense tracking",
    "docs-agent":      "Document review",
  };

  const typeColor = {
    orchestrator: "var(--primary)",
    lead:         "var(--accent)",
    specialist:   "var(--muted)",
  };

  return (
    <HudPanel title="Active Agents" style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
      {agents.length === 0 ? (
        <div className="mono" style={{ fontSize: 10, color: "var(--subtext)", padding: "4px 0" }}>
          No agents active · daemon idle
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, overflowY: "auto", maxHeight: 160 }}>
          {agents.map((a) => {
            const isOrch  = a.id === "jarvis" || a.id === "ceo";
            const isLead  = a.name.toLowerCase().includes("lead");
            const type    = isOrch ? "orchestrator" : isLead ? "lead" : "specialist";
            const task    = TASK_HINTS[a.id] || "Processing…";
            const active  = a.status === "active";

            return (
              <div key={a.id} style={{
                display: "grid",
                gridTemplateColumns: "8px 1fr",
                gap: "0 8px",
                alignItems: "start",
                paddingBottom: 6,
                borderBottom: "1px dashed var(--border)",
              }}>
                {/* status dot */}
                <span style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: active ? typeColor[type] : "var(--border-2)",
                  marginTop: 3, flexShrink: 0,
                  boxShadow: active ? `0 0 5px ${typeColor[type]}` : "none",
                  animation: active ? "blink 2s infinite" : "none",
                }} />
                <div>
                  <div style={{
                    fontSize: 10.5, fontWeight: 600,
                    color: active ? "var(--text)" : "var(--muted)",
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>{a.name}</div>
                  <div className="mono" style={{
                    fontSize: 9, color: "var(--subtext)",
                    letterSpacing: ".04em", marginTop: 1,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>{task}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </HudPanel>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// ElevenLabs TTS
// Voice: "Adam" — deep, authoritative. Change JARVIS_VOICE_ID to swap voice.
const JARVIS_VOICE_ID = "pNInz6obpgDQGcFmaJgB"; // Adam

async function speakText(text, apiKey) {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${JARVIS_VOICE_ID}/stream`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2",        // fastest model, lowest latency
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.80,
          style: 0.0,
          use_speaker_boost: true,
        },
      }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail?.message || `ElevenLabs ${res.status}`);
  }
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const audio = new Audio(url);
    audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
    audio.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    audio.play().catch(reject);
  });
}

// Free voice-out: Edge neural TTS via the daemon, browser speech as the fallback.
// Resolves when speech finishes so callers can chain UI state off it.
function speakFree(text) {
  return fetch(`${window.DAEMON_URL}/api/tts`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }),
  })
    .then(r => (r.ok ? r.blob() : Promise.reject(new Error("tts"))))
    .then(blob => {
      if (!blob || !blob.size) throw new Error("empty");
      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      return new Promise(res => {
        const done = () => { URL.revokeObjectURL(url); res(); };
        a.onended = done; a.onerror = done; a.play().catch(done);
      });
    })
    .catch(() => new Promise(res => {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.0; u.pitch = 0.95; u.onend = res; u.onerror = res;
      window.speechSynthesis.speak(u);
    }));
}

// Speak: ElevenLabs if a key is set (premium), else the free Edge voice.
function speak(text) {
  const key = localStorage.getItem("jarvis_elevenlabs_key");
  return key ? speakText(text, key).catch(() => speakFree(text)) : speakFree(text);
}

// Detects "guide me / show me where to click" style requests → screen guidance.
const GUIDE_RE = /\b(show me (where|how)|where (do|can|should) i|where('?s| is) the|how (do|can) i|guide me|walk me through|point (me )?to|help me (find|click)|take me to)\b/i;

// Small settings bar to enter/clear the ElevenLabs key
function VoiceKeyBar({ apiKey, onSave }) {
  const [input, setInput] = React.useState(apiKey || "");
  const [saved, setSaved] = React.useState(false);

  const save = () => {
    const k = input.trim();
    localStorage.setItem("jarvis_elevenlabs_key", k);
    onSave(k);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "5px 14px",
      borderBottom: "1px solid var(--border)",
      background: "var(--surface)",
      fontSize: 11, flexShrink: 0,
    }}>
      <span className="mono upper" style={{ fontSize: 9, color: "var(--subtext)", letterSpacing: ".14em", whiteSpace: "nowrap" }}>
        🔊 VOICE KEY
      </span>
      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => e.key === "Enter" && save()}
        type="password"
        placeholder="ElevenLabs API key…"
        style={{
          flex: 1, maxWidth: 280,
          background: "var(--surface-2)", color: "var(--text)",
          border: "1px solid var(--border-2)", padding: "3px 8px",
          borderRadius: "var(--radius-sm)", fontSize: 11,
          fontFamily: "monospace",
        }}
      />
      <button onClick={save} style={{
        padding: "3px 10px",
        background: saved ? "var(--ok)" : "var(--primary)",
        color: "#000", border: "none",
        borderRadius: "var(--radius-sm)", fontSize: 10,
        fontWeight: 700, cursor: "pointer",
      }}>{saved ? "Saved ✓" : "Save"}</button>
      {apiKey && (
        <button onClick={() => { localStorage.removeItem("jarvis_elevenlabs_key"); onSave(""); setInput(""); }}
          style={{ fontSize: 10, color: "var(--subtext)", background: "none", border: "none", cursor: "pointer" }}>
          Clear
        </button>
      )}
      <a href="https://elevenlabs.io" target="_blank" rel="noreferrer"
        style={{ fontSize: 9, color: "var(--subtext)", marginLeft: 4, textDecoration: "none" }}>
        Get key →
      </a>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Main OrbView

function OrbView({ mode, onFlip, onOpenChat }) {
  const [state, setState]           = React.useState("idle");
  const [transcript, setTranscript] = React.useState("Hold space to talk, or press the mic.");
  const [orbSize, setOrbSize]       = React.useState(420);
  const [elevenKey, setElevenKey]   = React.useState(
    () => localStorage.getItem("jarvis_elevenlabs_key") || ""
  );
  const [showVoiceBar, setShowVoiceBar] = React.useState(false);
  const [typed, setTyped] = React.useState("");
  const [entering, setEntering] = React.useState(true); // plays the orb "wake / thinking" spin-in
  const wrapRef    = React.useRef(null);
  const recogRef   = React.useRef(null);
  const listeningRef = React.useRef(false); // true while push-to-talk Vosk capture is live
  const spokenRef  = React.useRef("");
  const busyRef    = React.useRef(false);
  const { ampRef, freqRef, analyserRef, sample } = useOrbAmplitude(state);

  const pal = { primary: "#0ABAB5", accent: "#1a4fff", core: "#e6fffe" };

  // Play the "wake / thinking" spin-in on mount AND every time the orb window is
  // re-shown/refocused — so opening the overview always reads as JARVIS coming
  // alive to think, not a static orb that was just sitting there.
  React.useEffect(() => {
    let timer;
    const playWake = () => {
      clearTimeout(timer);
      setEntering(false); // drop the class so re-adding it restarts the CSS animation
      requestAnimationFrame(() => {
        setEntering(true);
        timer = setTimeout(() => setEntering(false), 1300);
      });
    };
    timer = setTimeout(() => setEntering(false), 1300); // initial mount
    const onShow = () => { if (document.visibilityState === "visible") playWake(); };
    window.addEventListener("focus", onShow);
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", onShow);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, []);

  React.useEffect(() => {
    const update = () => {
      if (!wrapRef.current) return;
      const r = wrapRef.current.getBoundingClientRect();
      setOrbSize(Math.max(260, Math.min(560, Math.min(r.width, r.height) * 0.62)));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // ── Screen guidance: JARVIS looks at the screen and shows where to click ───
  // Browser can't screenshot the OS, so we queue the task; the Electron overlay
  // grabs the screenshot, the daemon locates the target + draws, we narrate it.
  const runGuidance = React.useCallback(async (task) => {
    busyRef.current = true;
    setState("thinking");
    setTranscript("Looking at your screen…");
    try {
      const res = await fetch(`${window.DAEMON_URL}/api/guide`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      // Sync path (a screenshot was supplied) — answer is already here.
      let result = data.mode === "sync" ? data : null;

      // Async path — poll until the overlay fulfils the capture (max ~25s).
      if (!result && data.id) {
        for (let i = 0; i < 32 && !result; i++) {
          await new Promise(r => setTimeout(r, 800));
          const pr = await fetch(`${window.DAEMON_URL}/api/guide/result/${data.id}`, { cache: "no-store" });
          if (pr.ok) { const pd = await pr.json(); if (pd.ready) result = pd.result; }
        }
      }

      const resetIdle = () => { setState("idle"); setTranscript("Hold space to talk, or press the mic."); busyRef.current = false; };
      if (!result) { setTranscript("The screen overlay didn't respond — is the JARVIS pill running?"); setTimeout(resetIdle, 4000); return; }
      if (result.error) { setTranscript(`⚠ ${result.error}`); setTimeout(resetIdle, 5000); return; }

      const say = result.narration || (result.found ? "There it is — highlighted on your screen." : "I couldn't find that on your screen.");
      setState("speaking");
      setTranscript(say);
      speak(say).finally(resetIdle);
    } catch (e) {
      setTranscript(`⚠ ${e.message} — is the daemon running?`);
      setTimeout(() => { setState("idle"); setTranscript("Hold space to talk, or press the mic."); busyRef.current = false; }, 4000);
    }
  }, []);

  // ── Send spoken text to the daemon and stream response back ────────────────
  const sendToJarvis = React.useCallback(async (text) => {
    text = text.trim();
    if (!text || busyRef.current) return;

    // Screen-guidance requests take a different path (vision + draw, not chat).
    if (GUIDE_RE.test(text)) { runGuidance(text); return; }

    busyRef.current = true;

    setState("thinking");
    setTranscript("Thinking…");

    try {
      const res = await fetch(`${window.DAEMON_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, agentId: "jarvis" }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!res.body) throw new Error("No response body");

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "", full = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));

            if (evt.type === "delta" && evt.content) {
              full += evt.content;
              setState("speaking");
              setTranscript(full);
            }

            if (evt.type === "done") {
              const out = evt.result?.output ?? full;
              setTranscript(out);

              // Speak with ElevenLabs if key is set, otherwise fall back to browser TTS
              const key = localStorage.getItem("jarvis_elevenlabs_key");
              if (key) {
                setState("speaking");
                speakText(out, key)
                  .catch(() => {
                    // ElevenLabs failed — fall back to browser speech
                    const u = new SpeechSynthesisUtterance(out);
                    u.rate = 0.95; u.pitch = 0.85;
                    window.speechSynthesis.speak(u);
                    return new Promise(res => { u.onend = res; });
                  })
                  .finally(() => {
                    setState("idle");
                    setTranscript("Hold space to talk, or press the mic.");
                    busyRef.current = false;
                  });
              } else {
                // Free Edge neural voice (British male) via the daemon; fall back to the browser voice.
                setState("speaking");
                const resetIdle = () => { setState("idle"); setTranscript("Hold space to talk, or press the mic."); busyRef.current = false; };
                fetch(`${window.DAEMON_URL}/api/tts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: out }) })
                  .then(r => r.ok ? r.blob() : Promise.reject(new Error("tts")))
                  .then(blob => {
                    if (!blob || blob.size === 0) throw new Error("empty");
                    const audio = new Audio(URL.createObjectURL(blob));
                    audio.onended = resetIdle;
                    return audio.play();
                  })
                  .catch(() => {
                    const u = new SpeechSynthesisUtterance(out);
                    u.rate = 1.0; u.pitch = 0.95;
                    const vs = window.speechSynthesis.getVoices();
                    const findV = (re) => vs.find(v => re.test(v.name));
                    u.voice = findV(/Ryan|Thomas|Guy|Davis|Tony|Andrew|Christopher|Eric|Brian|Steffan/i)
                           || findV(/Natural|Online/i) || findV(/David|Mark|George/i)
                           || findV(/\bmale\b/i) || vs[0] || null;
                    u.onend = resetIdle;
                    window.speechSynthesis.speak(u);
                  });
              }
              return;
            }

            if (evt.type === "error") {
              setTranscript(`⚠ ${evt.message}`);
              setTimeout(() => {
                setState("idle");
                setTranscript("Hold space to talk, or press the mic.");
                busyRef.current = false;
              }, 4000);
              return;
            }
          } catch { /* skip malformed line */ }
        }
      }
    } catch (e) {
      setTranscript(`⚠ ${e.message} — is the daemon running?`);
      setTimeout(() => {
        setState("idle");
        setTranscript("Hold space to talk, or press the mic.");
        busyRef.current = false;
      }, 4000);
    }
  }, [runGuidance]);

  // ── Start listening: FREE offline Vosk speech-to-text (no API key) ─────────
  // Uses the in-browser Vosk engine bridged at window.JarvisVoice (see voice.js).
  // Works inside Electron where webkitSpeechRecognition is dead, and costs nothing.
  const startListening = React.useCallback(async () => {
    if (busyRef.current || listeningRef.current) return;
    const V = window.JarvisVoice;
    if (!V || !V.pttStart) { setTranscript("Voice engine still loading — try again in a moment, or type below."); return; }
    listeningRef.current = true;
    setState("listening");
    setTranscript("Listening… (release to send)");
    const ok = await V.pttStart((partial) => {
      if (listeningRef.current && partial) setTranscript(partial + " …");
    });
    if (!ok) {
      listeningRef.current = false;
      setState("idle");
      setTranscript("Voice unavailable — run setup-voice.ps1 to install the model, or type below.");
    }
  }, []);

  // ── Stop listening and fire the request ───────────────────────────────────
  const stopListeningAndSend = React.useCallback(() => {
    if (!listeningRef.current) {
      setState("idle"); setTranscript("Hold space to talk, tap the mic, or type below."); return;
    }
    listeningRef.current = false;
    const V = window.JarvisVoice;
    const text = (V && V.pttStop ? V.pttStop() : "").trim();
    if (text) sendToJarvis(text);
    else { setState("idle"); setTranscript("Didn't catch that — try again, or type below."); }
  }, [sendToJarvis]);

  // ── Space bar: hold = listen, release = send ──────────────────────────────
  React.useEffect(() => {
    const down = (e) => {
      if (e.code !== "Space" || e.repeat || busyRef.current) return;
      if (e.target && /input|textarea/i.test(e.target.tagName)) return;
      e.preventDefault();
      startListening();
    };
    const up = (e) => {
      if (e.code !== "Space") return;
      if (e.target && /input|textarea/i.test(e.target.tagName)) return;
      e.preventDefault();
      stopListeningAndSend();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup",   up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup",   up);
    };
  }, [startListening, stopListeningAndSend]);

  // ── Mic button: click to start, click again to send ───────────────────────
  const onMicClick = () => {
    if (state === "listening") {
      stopListeningAndSend();
    } else if (!busyRef.current) {
      startListening();
    }
  };

  return (
    <div ref={wrapRef} style={{
      flex: 1, width: "100%", height: "100%", minHeight: 0, position: "relative",
      background: "var(--bg)",
      overflow: "hidden",
    }}>
      {/* background grid */}
      <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, opacity: 0.6, pointerEvents: "none" }}>
        <defs>
          <pattern id="orb_grid" x="0" y="0" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M48 0H0V48" fill="none" stroke="var(--grid)" strokeWidth="1" />
          </pattern>
          <radialGradient id="orb_vignette" cx="50%" cy="50%" r="65%">
            <stop offset="60%" stopColor="transparent" />
            <stop offset="100%" stopColor="var(--bg)" />
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#orb_grid)" />
        <rect width="100%" height="100%" fill="url(#orb_vignette)" />
      </svg>

      {/* top status bar */}
      <div style={{
        position: "absolute", top: 14, left: 14, right: 14,
        display: "flex", alignItems: "center", gap: 8, zIndex: 4,
      }}>
        <div className="card" style={{
          flex: 1,
          background: "color-mix(in oklab, var(--surface) 88%, transparent)",
          backdropFilter: "blur(8px)",
          padding: "7px 14px",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <span style={{
            width: 7, height: 7, borderRadius: "50%",
            background: state === "idle" ? "var(--muted)" : "var(--primary)",
            boxShadow: state !== "idle" ? "0 0 8px var(--primary)" : "none",
            animation: state !== "idle" ? "blink 1.2s infinite" : "none",
            flexShrink: 0,
          }} />
          <span style={{ fontSize: 12, color: "var(--text)", flex: 1,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {transcript}
          </span>
          <span className="mono" style={{ fontSize: 9, color: "var(--subtext)", letterSpacing: ".1em", flexShrink: 0 }}>
            LOCAL
          </span>
        </div>

        {/* ElevenLabs key now lives in the full app → ⚙ Settings (no clutter on the orb) */}
      </div>

      {/* left HUD stack — real JARVIS stats + activity log */}
      <div style={{
        position: "absolute", top: 62, left: 14, bottom: 80, width: 230,
        display: "flex", flexDirection: "column", gap: 10, zIndex: 3,
        overflowY: "auto",
      }}>
        <StatusPanel />
        <ActivityPanel />
      </div>

      {/* right HUD stack — spatial map, acoustic bars, active agent */}
      <div style={{
        position: "absolute", top: 62, right: 14, bottom: 80, width: 230,
        display: "flex", flexDirection: "column", gap: 10, zIndex: 3,
        overflowY: "auto",
      }}>
        <MiniRadarPanel color={pal.primary} />
        <WaveformPanel analyserRef={analyserRef} color={pal.primary} />
        <ActiveAgentPanel />
      </div>

      {/* central orb */}
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 2,
      }}>
        <div style={{
          position: "relative",
          width: orbSize, height: orbSize,
          animation: entering
            ? "orbWakeIn 1.25s cubic-bezier(.2,.75,.2,1) both"
            : (state === "idle" ? "orbBreath 5s ease-in-out infinite" : "none"),
        }}>
          {/* soft contrast halo behind the orb */}
          <div style={{
            position: "absolute", inset: "-6%",
            borderRadius: "50%",
            background: "radial-gradient(circle, color-mix(in oklab, var(--primary) 14%, transparent) 0%, transparent 58%)",
            pointerEvents: "none",
          }} />
          <RingFidgets size={orbSize} state={state} />
          <OrbCanvas size={orbSize} state={state} ampRef={ampRef} freqRef={freqRef} sample={sample} pal={pal} />

          {/* state badge above orb */}
          <div style={{
            position: "absolute", top: -8, left: "50%", transform: "translate(-50%, -100%)",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
          }}>
            <span className="mono upper gold-text" style={{ fontSize: 11, letterSpacing: ".34em", fontWeight: 700 }}>J.A.R.V.I.S.</span>
            <span className="mono" style={{ fontSize: 9, color: "var(--subtext)", letterSpacing: ".16em" }}>
              JUST · A · RATHER · VERY · INTELLIGENT · SYSTEM
            </span>
          </div>
        </div>
      </div>

      {/* bottom mic dock — clean, no state chips */}
      <div style={{
        position: "absolute", bottom: 16, left: 0, right: 0,
        display: "flex", justifyContent: "center", zIndex: 4,
      }}>
        <div className="card-lg" style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "10px 20px",
          background: "color-mix(in oklab, var(--surface) 92%, transparent)",
          backdropFilter: "blur(10px)",
        }}>
          <input
            value={typed}
            onChange={e => setTyped(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && typed.trim()) { sendToJarvis(typed); setTyped(""); } }}
            placeholder="Type to JARVIS, or hold Space / tap the mic…"
            style={{
              width: 340, maxWidth: "46vw",
              background: "var(--surface-2)", color: "var(--text)",
              border: "1px solid var(--border-2)", borderRadius: "var(--radius-sm)",
              padding: "10px 12px", fontSize: 13, outline: "none",
            }}
          />
          <button onClick={onMicClick}
            style={{
              width: 44, height: 44, borderRadius: "50%",
              background: state === "listening" ? "var(--primary)" : "var(--surface-2)",
              border: `1px solid ${state === "listening" ? "var(--primary)" : "var(--border-2)"}`,
              color: state === "listening" ? "#000" : "var(--text)",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              boxShadow: state === "listening" ? "0 0 0 6px var(--primary-glow)" : "none",
              transition: "background .12s, box-shadow .15s",
            }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <rect x="9" y="3" width="6" height="12" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
          </button>
          <div className="mono" style={{ fontSize: 10, color: "var(--subtext)", letterSpacing: ".1em" }}>
            HOLD SPACE · OR PRESS MIC
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { OrbView, ChatLauncher });
