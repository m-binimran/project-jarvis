/**
 * JARVIS Phase 2 Setup Checklist
 *
 * Shopify-style optional setup panel. Shows after first login.
 * User can complete items at their own pace — JARVIS works fully without it.
 * Each item unlocks a specific capability when completed.
 *
 * Decision 17: Phase 2 is optional depth, not a gate.
 */

import { useEffect, useState } from 'react'

const DAEMON_URL = 'http://127.0.0.1:9101'

interface ChecklistItem {
  id: string
  icon: string
  title: string
  description: string
  unlocks: string
  done: boolean
}

const DEFAULT_ITEMS: ChecklistItem[] = [
  {
    id: 'vision',
    icon: '🎯',
    title: 'Set your Master Vision',
    description: 'Tell JARVIS who you are and what you\'re building.',
    unlocks: 'All agents understand your goals',
    done: false,
  },
  {
    id: 'gmail',
    icon: '📧',
    title: 'Connect Gmail',
    description: 'Let JARVIS read and draft emails on your behalf.',
    unlocks: 'Email agent goes live',
    done: false,
  },
  {
    id: 'calendar',
    icon: '📅',
    title: 'Connect Calendar',
    description: 'JARVIS sees your schedule and gives you daily briefings.',
    unlocks: 'Scheduling + daily briefing',
    done: false,
  },
  {
    id: 'advisor',
    icon: '🧠',
    title: 'Add your first Advisor',
    description: 'Pick a mentor — Naval, Hormozi, Paul Graham, or your own.',
    unlocks: 'Advisory council activates',
    done: false,
  },
  {
    id: 'permission',
    icon: '🔑',
    title: 'Set permission mode',
    description: 'Choose how much autonomy JARVIS has (Safe / Productive / Auto / Bypass).',
    unlocks: 'Move beyond Safe mode',
    done: false,
  },
  {
    id: 'skill',
    icon: '⚡',
    title: 'Try a pre-baked skill',
    description: 'Run the daily briefing or email drafter to see skills in action.',
    unlocks: 'Skills system active',
    done: false,
  },
]

interface Props {
  onDismiss: () => void
}

export function SetupChecklist({ onDismiss }: Props) {
  const [items, setItems] = useState<ChecklistItem[]>(DEFAULT_ITEMS)
  const [activeItem, setActiveItem] = useState<string | null>(null)
  const [visionText, setVisionText] = useState('')
  const [visionSaving, setVisionSaving] = useState(false)
  const [visionError, setVisionError] = useState('')

  // Load completed state from daemon on mount
  useEffect(() => {
    fetch(`${DAEMON_URL}/api/onboarding/checklist`)
      .then(r => r.json())
      .then(data => {
        if (data.completed && Array.isArray(data.completed)) {
          setItems(prev =>
            prev.map(item => ({
              ...item,
              done: data.completed.includes(item.id),
            }))
          )
        }
      })
      .catch(() => {/* daemon offline — show all as undone */})
  }, [])

  const markDone = async (id: string) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, done: true } : item))
    try {
      await fetch(`${DAEMON_URL}/api/onboarding/checklist/${id}`, { method: 'POST' })
    } catch { /* non-blocking */ }
  }

  const saveVision = async () => {
    if (!visionText.trim()) return
    setVisionSaving(true)
    setVisionError('')
    try {
      const res = await fetch(`${DAEMON_URL}/api/vault/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'master_vision', value: visionText.trim() }),
      })
      const data = await res.json()
      if (data.success !== false) {
        await markDone('vision')
        setActiveItem(null)
      } else {
        setVisionError('Failed to save. Is the daemon running?')
      }
    } catch {
      setVisionError('Cannot reach JARVIS daemon.')
    } finally {
      setVisionSaving(false)
    }
  }

  const completedCount = items.filter(i => i.done).length
  const totalCount = items.length
  const progressPct = Math.round((completedCount / totalCount) * 100)
  const allDone = completedCount === totalCount

  return (
    <div className="setup-checklist">
      <div className="checklist-header">
        <div className="checklist-title-row">
          <h3 className="checklist-title">Set up JARVIS</h3>
          <button className="checklist-dismiss" onClick={onDismiss} title="Hide checklist">✕</button>
        </div>
        <div className="checklist-progress-row">
          <div className="checklist-progress-bar">
            <div className="checklist-progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
          <span className="checklist-progress-label">{completedCount}/{totalCount}</span>
        </div>
        {allDone && (
          <div className="checklist-all-done">
            🎉 JARVIS is fully set up. You're ready.
          </div>
        )}
      </div>

      <div className="checklist-items">
        {items.map(item => (
          <div key={item.id} className={`checklist-item ${item.done ? 'done' : ''} ${activeItem === item.id ? 'expanded' : ''}`}>
            <button
              className="checklist-item-header"
              onClick={() => setActiveItem(activeItem === item.id ? null : item.id)}
              disabled={item.done}
            >
              <span className="checklist-item-icon">{item.done ? '✓' : item.icon}</span>
              <div className="checklist-item-info">
                <div className="checklist-item-title">{item.title}</div>
                {!item.done && (
                  <div className="checklist-item-unlocks">Unlocks: {item.unlocks}</div>
                )}
              </div>
              {!item.done && (
                <span className="checklist-item-chevron">{activeItem === item.id ? '▲' : '▼'}</span>
              )}
            </button>

            {activeItem === item.id && !item.done && (
              <div className="checklist-item-body">
                <p className="checklist-item-desc">{item.description}</p>

                {/* Vision — inline text input */}
                {item.id === 'vision' && (
                  <div className="checklist-vision">
                    <textarea
                      className="checklist-vision-input"
                      value={visionText}
                      onChange={e => setVisionText(e.target.value)}
                      placeholder="I'm a solo agency owner helping e-commerce brands grow. My goal is to get to £25k/month in 12 months by..."
                      rows={4}
                    />
                    {visionError && <div className="onboard-error">{visionError}</div>}
                    <button
                      className="onboard-btn primary"
                      onClick={saveVision}
                      disabled={visionSaving || !visionText.trim()}
                    >
                      {visionSaving ? 'Saving…' : 'Save Vision'}
                    </button>
                  </div>
                )}

                {/* Permission — mode picker */}
                {item.id === 'permission' && (
                  <div className="checklist-permission">
                    {(['safe', 'productive', 'auto', 'bypass'] as const).map(mode => (
                      <button
                        key={mode}
                        className="checklist-mode-btn"
                        onClick={async () => {
                          try {
                            await fetch(`${DAEMON_URL}/api/authority/mode`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ mode }),
                            })
                          } catch { /* non-blocking */ }
                          markDone('permission')
                          setActiveItem(null)
                        }}
                      >
                        <span className="checklist-mode-name">
                          {mode.charAt(0).toUpperCase() + mode.slice(1)}
                        </span>
                        <span className="checklist-mode-desc">
                          {mode === 'safe' && 'Asks before every action'}
                          {mode === 'productive' && 'Auto-approves low-risk, asks for changes'}
                          {mode === 'auto' && 'AI decides what needs approval'}
                          {mode === 'bypass' && 'Runs freely — circuit breakers still apply'}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {/* All others — external action + mark done */}
                {!['vision', 'permission'].includes(item.id) && (
                  <div className="checklist-action-row">
                    <button
                      className="onboard-btn secondary"
                      onClick={() => {
                        markDone(item.id)
                        setActiveItem(null)
                      }}
                    >
                      Mark as done
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
