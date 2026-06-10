import { useEffect, useRef, useState } from 'react'
import { jarvis } from './lib/ipc'
import { Bubble } from './components/Bubble'
import { VoiceEngine } from './lib/voice'

/**
 * The pill renderer. The pill sits at the top-center of the screen.
 * Clicking it — or pressing Alt+J, or saying "Hey Jarvis" — opens the full
 * JARVIS app window, which loads the polished frontend (served on :3020) with
 * every option. Onboarding, chat, enterprise mode, etc. all live in that frontend.
 */
export function App() {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(false)   // voice listening — animates the pill
  const [thinking, setThinking] = useState(false) // JARVIS is processing — loading dots
  const openRef = useRef(false)

  // Poll the daemon's "busy" flag so the pill shows a loading animation whenever
  // JARVIS is thinking (a chat reply or a screen-guidance vision call in flight).
  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const r = await fetch('http://127.0.0.1:9101/api/activity', { cache: 'no-store' })
        if (r.ok) { const d = await r.json(); if (alive) setThinking(!!d.busy) }
      } catch { /* daemon down — leave the pill calm */ }
    }
    const id = setInterval(tick, 600)
    tick()
    return () => { alive = false; clearInterval(id) }
  }, [])

  const apply = (next: boolean) => {
    openRef.current = next
    setOpen(next)
    if (next) jarvis.expandSidebar()
    else jarvis.collapseBubble()
  }
  const toggle = () => apply(!openRef.current)

  // Alt+J relayed from the main process
  useEffect(() => jarvis.onToggleSidebar(() => toggle()), [])

  // "Hey Jarvis" wake word → open the app (non-blocking; ignored if mic denied)
  useEffect(() => {
    const engine = new VoiceEngine({
      onStateChange: (s) => {
        setActive(s !== 'idle')
        if (s === 'wake' && !openRef.current) apply(true)
      },
      onTranscript: () => {},
      onResponse: () => {},
      onError: () => {},
    })
    const started = engine.start()
    return () => { if (started) engine.stop() }
  }, [])

  return <Bubble onClick={toggle} idle={!active} thinking={thinking} />
}
