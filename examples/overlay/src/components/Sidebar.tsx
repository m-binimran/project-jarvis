import { useCallback, useEffect, useRef, useState } from 'react'
import { Chat } from './Chat'
import { ScreenPanel } from './ScreenPanel'
import { TokenBar } from './TokenBar'
import { VoiceIndicator } from './VoiceIndicator'
import { WorkflowBuilder } from './WorkflowBuilder'
import { AdvisorPanel } from './AdvisorPanel'
import { SetupChecklist } from './SetupChecklist'

const DAEMON_URL = 'http://127.0.0.1:9101'

type Tab = 'chat' | 'screen' | 'flows' | 'council'

interface Props {
  onClose: () => void
}

export function Sidebar({ onClose }: Props) {
  const [tab, setTab] = useState<Tab>('chat')
  const [enterprise, setEnterprise] = useState(false)
  const [enterpriseLoading, setEnterpriseLoading] = useState(false)
  const [showChecklist, setShowChecklist] = useState(false)

  // speakRef: VoiceIndicator exposes its speak() via this ref so Chat can call it
  const speakRef = useRef<((text: string) => void) | null>(null)
  const handleSpeak = useCallback((fn: (text: string) => void) => {
    speakRef.current = fn
  }, [])

  // sendRef: Chat exposes sendText() so VoiceIndicator can inject commands
  const sendRef = useRef<((text: string) => void) | null>(null)
  const handleSendRef = useCallback((fn: (text: string) => void) => {
    sendRef.current = fn
  }, [])

  const sendFromVoice = useCallback((text: string) => {
    sendRef.current?.(text)
    setTab('chat')
  }, [])

  // Load enterprise mode + checklist visibility on mount
  useEffect(() => {
    fetch(`${DAEMON_URL}/api/enterprise/mode`)
      .then(r => r.json())
      .then(data => setEnterprise(data.enterprise ?? false))
      .catch(() => {/* daemon offline — stay false */})

    // Show checklist if the user hasn't completed setup or dismissed it
    fetch(`${DAEMON_URL}/api/onboarding/checklist`)
      .then(r => r.json())
      .then(data => {
        const completed: string[] = data.completed ?? []
        const dismissed: boolean = data.dismissed ?? false
        // Show if not dismissed and at least one item not done
        if (!dismissed && completed.length < 6) {
          setShowChecklist(true)
        }
      })
      .catch(() => {/* daemon offline — don't show checklist */})
  }, [])

  const dismissChecklist = async () => {
    setShowChecklist(false)
    try {
      await fetch(`${DAEMON_URL}/api/onboarding/checklist/dismiss`, { method: 'POST' })
    } catch { /* non-blocking */ }
  }

  const toggleEnterprise = async () => {
    setEnterpriseLoading(true)
    const next = !enterprise
    try {
      await fetch(`${DAEMON_URL}/api/enterprise/mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enterprise: next }),
      })
      setEnterprise(next)
    } catch { /* ignore */ }
    setEnterpriseLoading(false)
  }

  return (
    <div className={`sidebar ${enterprise ? 'enterprise' : ''}`}>
      <div className="sidebar-header">
        <div className="header-title">
          <h1>JARVIS</h1>
          {enterprise && <span className="enterprise-badge">ENTERPRISE</span>}
        </div>
        <div className="header-actions">
          <button
            className={`mode-toggle-btn ${enterprise ? 'enterprise-on' : ''}`}
            onClick={toggleEnterprise}
            disabled={enterpriseLoading}
            title={enterprise ? 'Enterprise Mode ON — click to switch to Everyday' : 'Switch to Enterprise Mode'}
          >
            {enterprise ? '🏢' : '👤'}
          </button>
          <VoiceIndicator onSendMessage={sendFromVoice} onSpeak={handleSpeak} />
          <button className="close-btn" onClick={onClose} title="Close (Alt+J)">✕</button>
        </div>
      </div>

      <div className="tabs">
        <button
          className={`tab ${tab === 'chat' ? 'active' : ''}`}
          onClick={() => setTab('chat')}
        >
          Chat
        </button>
        <button
          className={`tab ${tab === 'screen' ? 'active' : ''}`}
          onClick={() => setTab('screen')}
        >
          Screen
        </button>
        <button
          className={`tab ${tab === 'flows' ? 'active' : ''}`}
          onClick={() => setTab('flows')}
        >
          Flows
        </button>
        <button
          className={`tab ${tab === 'council' ? 'active' : ''}`}
          onClick={() => setTab('council')}
        >
          Council
        </button>
      </div>

      {showChecklist && (
        <SetupChecklist onDismiss={dismissChecklist} />
      )}

      <div className={`tab-content ${showChecklist ? 'tab-content-condensed' : ''}`}>
        {tab === 'chat' && (
          <Chat
            speakRef={speakRef}
            onSendReady={handleSendRef}
          />
        )}
        {tab === 'screen' && <ScreenPanel />}
        {tab === 'flows' && <WorkflowBuilder />}
        {tab === 'council' && <AdvisorPanel />}
      </div>

      <TokenBar />
    </div>
  )
}
