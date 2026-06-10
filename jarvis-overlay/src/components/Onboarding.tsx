/**
 * JARVIS Onboarding — First Run Setup
 *
 * Phase 1 — Mandatory (5 min):
 *   1. Welcome — animated "J" logo + brief pitch
 *   2. Provider — pick Anthropic / OpenAI / Google
 *   3. API Key — input + store in daemon keychain
 *   4. Voice Test — say "Hello Jarvis", hear JARVIS respond (skippable)
 *   5. First Task — ask JARVIS anything, see it work live
 *   6. Done — transition to PIN setup
 *
 * Zero telemetry. Key goes straight to OS keychain via daemon.
 * Decision 17: 5 minutes to first value, then optional depth.
 */

import { useEffect, useRef, useState } from 'react'
import { VoiceEngine } from '../lib/voice'

const DAEMON_URL = 'http://127.0.0.1:9101'

interface Props {
  onComplete: () => void
}

type Step = 'welcome' | 'provider' | 'apikey' | 'voicetest' | 'firsttask' | 'done'

interface Provider {
  id: string
  name: string
  icon: string
  description: string
  keyPrefix: string
  keyPlaceholder: string
}

const PROVIDERS: Provider[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    icon: '⬡',
    description: 'Claude — best for reasoning, writing, and complex tasks',
    keyPrefix: 'sk-ant-',
    keyPlaceholder: 'sk-ant-api03-...',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    icon: '◯',
    description: 'GPT-4o — great all-rounder, wide ecosystem',
    keyPrefix: 'sk-',
    keyPlaceholder: 'sk-proj-...',
  },
  {
    id: 'google',
    name: 'Google',
    icon: '✦',
    description: 'Gemini — fast, multimodal, generous free tier',
    keyPrefix: 'AIzaSy',
    keyPlaceholder: 'AIzaSy...',
  },
]

export function Onboarding({ onComplete }: Props) {
  const [step, setStep] = useState<Step>('welcome')
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Voice test state
  const [voiceListening, setVoiceListening] = useState(false)
  const [voiceHeard, setVoiceHeard] = useState(false)
  const [voiceError, setVoiceError] = useState('')
  const voiceEngineRef = useRef<VoiceEngine | null>(null)

  // First task state
  const [firstTaskInput, setFirstTaskInput] = useState('')
  const [firstTaskResponse, setFirstTaskResponse] = useState('')
  const [firstTaskLoading, setFirstTaskLoading] = useState(false)
  const firstTaskRef = useRef<HTMLTextAreaElement>(null)

  // Clean up voice engine on step change
  useEffect(() => {
    if (step !== 'voicetest') {
      voiceEngineRef.current?.stop()
      voiceEngineRef.current = null
      setVoiceListening(false)
    }
  }, [step])

  const startVoiceTest = () => {
    setVoiceError('')
    setVoiceHeard(false)
    const engine = new VoiceEngine({
      onStateChange: () => {},
      onTranscript: () => {},
      onResponse: () => {},
      onError: (msg) => {
        setVoiceError(msg)
        setVoiceListening(false)
      },
    })
    // Override: trigger heard when wake word fires
    const origStart = engine.start.bind(engine)
    engine.start = () => {
      const ok = origStart()
      return ok
    }
    // Watch for wake word via a polling check on state
    let watchInterval: ReturnType<typeof setInterval>
    engine.setSendHandler(() => {
      // Wake word detected — command sent
      clearInterval(watchInterval)
      setVoiceHeard(true)
      setVoiceListening(false)
      engine.speak("I'm here. Nice to meet you.")
      voiceEngineRef.current?.stop()
    })
    voiceEngineRef.current = engine
    const ok = engine.start()
    if (ok) {
      setVoiceListening(true)
    } else {
      setVoiceError('Microphone not available. You can skip this step.')
    }
  }

  const sendFirstTask = async () => {
    const text = firstTaskInput.trim()
    if (!text || firstTaskLoading) return
    setFirstTaskLoading(true)
    setFirstTaskResponse('')
    try {
      const res = await fetch(`${DAEMON_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let output = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const evt = JSON.parse(line.slice(6))
            if (evt.type === 'delta' && evt.content) {
              output += evt.content
              setFirstTaskResponse(output)
            }
            if (evt.type === 'done' && evt.result?.output) {
              setFirstTaskResponse(evt.result.output)
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch {
      setFirstTaskResponse('JARVIS daemon not reachable — but your key is saved. You can proceed.')
    } finally {
      setFirstTaskLoading(false)
    }
  }

  const onFirstTaskKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendFirstTask()
    }
  }

  const saveKey = async () => {
    if (!selectedProvider || !apiKey.trim()) return
    setSaving(true)
    setError('')

    try {
      const res = await fetch(`${DAEMON_URL}/api/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: selectedProvider.id, key: apiKey.trim() }),
      })
      const data = await res.json()

      if (data.success) {
        setStep('voicetest')
      } else {
        setError(data.error ?? 'Failed to save key')
      }
    } catch {
      setError('Cannot reach JARVIS daemon. Make sure it\'s running.')
    } finally {
      setSaving(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') saveKey()
  }

  return (
    <div className="onboarding">
      {step === 'welcome' && (
        <div className="onboard-step">
          <div className="onboard-logo">J</div>
          <h2 className="onboard-title">Welcome to JARVIS</h2>
          <p className="onboard-subtitle">
            Your personal AI operating system.<br />
            Runs entirely on your machine. Zero cloud. Zero telemetry.
          </p>
          <div className="onboard-features">
            <div className="onboard-feature">
              <span>🧠</span>
              <span>44 specialist agents, always on</span>
            </div>
            <div className="onboard-feature">
              <span>🎙</span>
              <span>Wake word: say "Jarvis" anytime</span>
            </div>
            <div className="onboard-feature">
              <span>🔒</span>
              <span>API keys stored in OS keychain only</span>
            </div>
            <div className="onboard-feature">
              <span>🏢</span>
              <span>Enterprise Mode with full CEO hierarchy</span>
            </div>
          </div>
          <button className="onboard-btn primary" onClick={() => setStep('provider')}>
            Get Started →
          </button>
        </div>
      )}

      {step === 'provider' && (
        <div className="onboard-step">
          <div className="onboard-step-label">Step 1 of 4</div>
          <h2 className="onboard-title">Choose your AI provider</h2>
          <p className="onboard-subtitle">
            Bring your own API key — you only pay for what you use.
          </p>
          <div className="provider-list">
            {PROVIDERS.map(p => (
              <button
                key={p.id}
                className={`provider-card ${selectedProvider?.id === p.id ? 'selected' : ''}`}
                onClick={() => setSelectedProvider(p)}
              >
                <span className="provider-icon">{p.icon}</span>
                <div className="provider-info">
                  <div className="provider-name">{p.name}</div>
                  <div className="provider-desc">{p.description}</div>
                </div>
                {selectedProvider?.id === p.id && <span className="provider-check">✓</span>}
              </button>
            ))}
          </div>
          <div className="onboard-actions">
            <button className="onboard-btn secondary" onClick={() => setStep('welcome')}>← Back</button>
            <button
              className="onboard-btn primary"
              onClick={() => setStep('apikey')}
              disabled={!selectedProvider}
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {step === 'apikey' && selectedProvider && (
        <div className="onboard-step">
          <div className="onboard-step-label">Step 2 of 4</div>
          <h2 className="onboard-title">{selectedProvider.name} API Key</h2>
          <p className="onboard-subtitle">
            Your key is stored in your OS keychain — never in any database or file.
          </p>
          <div className="apikey-input-group">
            <div className="apikey-provider-badge">
              {selectedProvider.icon} {selectedProvider.name}
            </div>
            <input
              className="apikey-input"
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={selectedProvider.keyPlaceholder}
              autoFocus
            />
          </div>
          {error && <div className="onboard-error">{error}</div>}
          <div className="apikey-hint">
            {selectedProvider.id === 'anthropic' && (
              <>Get your key at <span className="link-hint">console.anthropic.com</span></>
            )}
            {selectedProvider.id === 'openai' && (
              <>Get your key at <span className="link-hint">platform.openai.com/api-keys</span></>
            )}
            {selectedProvider.id === 'google' && (
              <>Get your key at <span className="link-hint">aistudio.google.com/apikey</span></>
            )}
          </div>
          <div className="onboard-actions">
            <button className="onboard-btn secondary" onClick={() => setStep('provider')}>← Back</button>
            <button
              className="onboard-btn primary"
              onClick={saveKey}
              disabled={saving || !apiKey.trim()}
            >
              {saving ? 'Saving…' : 'Save & Continue →'}
            </button>
          </div>
        </div>
      )}

      {step === 'voicetest' && (
        <div className="onboard-step">
          <div className="onboard-step-label">Step 3 of 4</div>
          <h2 className="onboard-title">Wake word test</h2>
          <p className="onboard-subtitle">
            Say <strong>"Jarvis"</strong> and JARVIS will respond.<br />
            This is how you'll summon JARVIS from anywhere.
          </p>

          <div className="voice-test-area">
            {!voiceHeard && !voiceListening && !voiceError && (
              <button className="voice-test-btn" onClick={startVoiceTest}>
                🎙 Start Listening
              </button>
            )}
            {voiceListening && (
              <div className="voice-test-listening">
                <div className="voice-test-pulse" />
                <span>Listening… say <strong>"Jarvis"</strong></span>
              </div>
            )}
            {voiceHeard && (
              <div className="voice-test-success">
                <span className="voice-test-check">✓</span>
                <span>Wake word detected! JARVIS responded.</span>
              </div>
            )}
            {voiceError && (
              <div className="onboard-error">{voiceError}</div>
            )}
          </div>

          <div className="onboard-actions">
            <button className="onboard-btn secondary" onClick={() => setStep('apikey')}>← Back</button>
            <button
              className="onboard-btn secondary"
              onClick={() => setStep('firsttask')}
            >
              Skip
            </button>
            {voiceHeard && (
              <button className="onboard-btn primary" onClick={() => setStep('firsttask')}>
                Next →
              </button>
            )}
          </div>
        </div>
      )}

      {step === 'firsttask' && (
        <div className="onboard-step">
          <div className="onboard-step-label">Step 4 of 4</div>
          <h2 className="onboard-title">Ask JARVIS anything</h2>
          <p className="onboard-subtitle">
            Try it live. Type a question and see JARVIS respond.
          </p>

          <div className="first-task-area">
            {!firstTaskResponse && (
              <div className="first-task-input-group">
                <textarea
                  ref={firstTaskRef}
                  className="first-task-input"
                  value={firstTaskInput}
                  onChange={e => setFirstTaskInput(e.target.value)}
                  onKeyDown={onFirstTaskKeyDown}
                  placeholder="What can you help me with?"
                  rows={2}
                  autoFocus
                  disabled={firstTaskLoading}
                />
                <button
                  className="onboard-btn primary"
                  onClick={sendFirstTask}
                  disabled={firstTaskLoading || !firstTaskInput.trim()}
                >
                  {firstTaskLoading ? '…' : 'Ask →'}
                </button>
              </div>
            )}
            {firstTaskResponse && (
              <div className="first-task-response">
                <div className="first-task-q">You: {firstTaskInput}</div>
                <div className="first-task-a">
                  <span className="first-task-label">JARVIS:</span> {firstTaskResponse}
                </div>
              </div>
            )}
          </div>

          <div className="onboard-actions">
            <button className="onboard-btn secondary" onClick={() => setStep('voicetest')}>← Back</button>
            <button
              className="onboard-btn secondary"
              onClick={() => setStep('done')}
            >
              Skip
            </button>
            {firstTaskResponse && (
              <button className="onboard-btn primary" onClick={() => setStep('done')}>
                Next →
              </button>
            )}
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="onboard-step onboard-done">
          <div className="onboard-done-icon">✓</div>
          <h2 className="onboard-title">JARVIS is ready</h2>
          <p className="onboard-subtitle">
            {selectedProvider?.name} key stored securely.<br />
            Now set up your 4-digit PIN to protect your JARVIS.
          </p>
          <button className="onboard-btn primary" onClick={onComplete}>
            Set Up PIN →
          </button>
        </div>
      )}
    </div>
  )
}
