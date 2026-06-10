import { useEffect, useRef, useState } from 'react'
import { VoiceEngine, type VoiceState, voiceStateIcon } from '../lib/voice'

interface Props {
  onSendMessage: (text: string) => void
  onSpeak: (fn: (text: string) => void) => void   // exposes speak() to parent
}

export function VoiceIndicator({ onSendMessage, onSpeak }: Props) {
  const [enabled, setEnabled] = useState(false)
  const [state, setState] = useState<VoiceState>('idle')
  const [transcript, setTranscript] = useState('')
  const engineRef = useRef<VoiceEngine | null>(null)

  // Expose the speak function to parent so chat responses can be spoken
  useEffect(() => {
    onSpeak((text: string) => {
      engineRef.current?.speak(text)
    })
  }, [onSpeak])

  const toggle = () => {
    if (!enabled) {
      const engine = new VoiceEngine({
        onStateChange: setState,
        onTranscript: (t, final) => {
          setTranscript(t)
          if (final) setTimeout(() => setTranscript(''), 1500)
        },
        onResponse: () => {},
        onError: (msg) => {
          console.error('[Voice]', msg)
          setEnabled(false)
          setState('error')
        },
      })
      engine.setSendHandler(onSendMessage)
      engineRef.current = engine
      const ok = engine.start()
      if (ok) setEnabled(true)
    } else {
      engineRef.current?.stop()
      engineRef.current = null
      setEnabled(false)
      setState('idle')
      setTranscript('')
    }
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      engineRef.current?.stop()
      engineRef.current = null
    }
  }, [])

  const isActive = state === 'wake' || state === 'listening'

  return (
    <div className="voice-indicator">
      <button
        className={`voice-btn ${enabled ? 'voice-on' : ''} ${isActive ? 'voice-active' : ''}`}
        onClick={toggle}
        title={enabled ? 'Voice on — say "Jarvis" to activate. Click to disable.' : 'Enable voice — say "Jarvis" to activate'}
      >
        {voiceStateIcon(enabled ? state : 'idle')}
      </button>

      {enabled && transcript && (
        <span className="voice-transcript">{transcript}</span>
      )}

      {enabled && !transcript && state !== 'idle' && (
        <span className="voice-state-label">{
          state === 'wake' ? 'Wake word!' :
          state === 'listening' ? 'Listening…' :
          state === 'speaking' ? 'Speaking…' :
          state === 'processing' ? 'Processing…' : ''
        }</span>
      )}
    </div>
  )
}
