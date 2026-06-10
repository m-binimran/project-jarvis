// icons.jsx — minimal stroke-icon set, sharp, 1.5 stroke

const Icon = ({ d, size = 14, stroke = 1.5, fill = "none", style, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill}
       stroke="currentColor" strokeWidth={stroke}
       strokeLinecap="square" strokeLinejoin="miter"
       style={{ display: "block", flexShrink: 0, ...(style || {}) }} {...rest}>
    {typeof d === "string" ? <path d={d} /> : d}
  </svg>
);

const I = {
  plus:    (p) => <Icon {...p} d="M12 5v14M5 12h14" />,
  chev:    (p) => <Icon {...p} d="M9 6l6 6-6 6" />,
  chevDn:  (p) => <Icon {...p} d="M6 9l6 6 6-6" />,
  chevUp:  (p) => <Icon {...p} d="M6 15l6-6 6 6" />,
  chevL:   (p) => <Icon {...p} d="M15 6l-6 6 6 6" />,
  x:       (p) => <Icon {...p} d="M6 6l12 12M18 6L6 18" />,
  send:    (p) => <Icon {...p} d="M5 12h14M12 5l7 7-7 7" />,
  clip:    (p) => <Icon {...p} d="M20 10l-9 9a5 5 0 1 1-7-7L13 3a3.5 3.5 0 1 1 5 5L9 17a2 2 0 1 1-3-3l8-8" />,
  search:  (p) => <Icon {...p} d={<g><circle cx="11" cy="11" r="6" /><path d="M20 20l-4-4" /></g>} />,
  trash:   (p) => <Icon {...p} d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  edit:    (p) => <Icon {...p} d="M4 20h4L20 8l-4-4L4 16v4z" />,
  pause:   (p) => <Icon {...p} d="M7 5v14M17 5v14" />,
  play:    (p) => <Icon {...p} fill="currentColor" d="M6 4v16l14-8z" stroke="none" />,
  dot:     (p) => <Icon {...p} fill="currentColor" stroke="none" d={<circle cx="12" cy="12" r="4" />} />,
  brain:   (p) => <Icon {...p} d="M9 4a3 3 0 0 0-3 3v1a3 3 0 0 0-2 3 3 3 0 0 0 2 3v1a3 3 0 0 0 3 3M15 4a3 3 0 0 1 3 3v1a3 3 0 0 1 2 3 3 3 0 0 1-2 3v1a3 3 0 0 1-3 3M9 4v18M15 4v18" />,
  bolt:    (p) => <Icon {...p} d="M13 3L4 14h6l-1 7 9-11h-6l1-7z" />,
  user:    (p) => <Icon {...p} d={<g><circle cx="12" cy="8" r="3.5" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></g>} />,
  graph:   (p) => <Icon {...p} d={<g><circle cx="6" cy="6" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="12" cy="18" r="2" /><path d="M7.5 7.5l3 9M16.5 7.5l-3 9" /></g>} />,
  doc:     (p) => <Icon {...p} d="M6 3h9l4 4v14H6zM15 3v4h4" />,
  inbox:   (p) => <Icon {...p} d="M3 12l3-7h12l3 7M3 12v8h18v-8M3 12h6l1 3h4l1-3h6" />,
  layout1: (p) => <Icon {...p} d="M3 4h18v16H3z" />,
  layout2: (p) => <Icon {...p} d="M3 4h18v16H3zM12 4v16" />,
  layout4: (p) => <Icon {...p} d="M3 4h18v16H3zM12 4v16M3 12h18" />,
  panelR:  (p) => <Icon {...p} d="M3 4h18v16H3zM15 4v16" />,
  power:   (p) => <Icon {...p} d="M12 4v8M6 7a8 8 0 1 0 12 0" />,
  shield:  (p) => <Icon {...p} d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z" />,
  zoom:    (p) => <Icon {...p} d="M6 12h12M12 6v12" />,
  zoomOut: (p) => <Icon {...p} d="M6 12h12" />,
  reset:   (p) => <Icon {...p} d="M4 4v6h6M20 20v-6h-6M4 10a8 8 0 0 1 14-3M20 14a8 8 0 0 1-14 3" />,
  eye:     (p) => <Icon {...p} d={<g><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></g>} />,
  eyeOff:  (p) => <Icon {...p} d="M3 3l18 18M10.5 6.2A10 10 0 0 1 22 12s-1.5 2.7-4.5 4.7M6.5 8C3.7 9.6 2 12 2 12s4 7 10 7c1.7 0 3.2-.4 4.5-1" />,
  tag:     (p) => <Icon {...p} d="M3 12l9-9h9v9l-9 9z M16 8h.01" />,
  cpu:     (p) => <Icon {...p} d="M6 6h12v12H6zM9 9h6v6H9zM3 9h3M3 15h3M18 9h3M18 15h3M9 3v3M15 3v3M9 18v3M15 18v3" />,
};

// JARVIS logo mark — hex with inner triangle (original, not licensed)
const LogoMark = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "block" }}>
    <path d="M12 1.5L21.5 7v10L12 22.5 2.5 17V7z"
          fill="none" stroke="var(--primary)" strokeWidth="1.5" />
    <path d="M12 6L17 9v6l-5 3-5-3V9z"
          fill="var(--primary)" stroke="none" opacity=".22" />
    <path d="M12 6v12M7 9l10 6M17 9L7 15"
          stroke="var(--primary)" strokeWidth="1" opacity=".6" />
    <circle cx="12" cy="12" r="1.6" fill="var(--accent)" />
  </svg>
);

Object.assign(window, { Icon, I, LogoMark });
