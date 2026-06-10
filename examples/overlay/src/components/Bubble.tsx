interface Props {
  onClick: () => void
  /** When true the pill rests quietly (silent mode) — bars don't animate. */
  idle?: boolean
  /** When true JARVIS is processing — show the loading dots instead of the bars. */
  thinking?: boolean
}

/**
 * Minimal Mac-style pill (Dynamic Island feel) that lives at the top-center.
 * Click it, press Alt+J, or say "Hey Jarvis" to expand into the app.
 *
 * Right side shows one of two indicators:
 *   - thinking → three dots bouncing up and down (JARVIS is working)
 *   - otherwise → the mini waveform bars (idle/listening)
 */
export function Bubble({ onClick, idle = false, thinking = false }: Props) {
  return (
    <div
      className={`pill${idle ? ' idle' : ''}${thinking ? ' thinking' : ''}`}
      onClick={onClick}
      title="Open JARVIS — click, press Alt+J, or say 'Hey Jarvis'"
    >
      <span className="pill-dot" />
      <span className="pill-label">Jarvis</span>
      {thinking
        ? <span className="pill-loader" aria-label="JARVIS is thinking"><i /><i /><i /></span>
        : <span className="pill-bars"><i /><i /><i /><i /></span>}
    </div>
  )
}
