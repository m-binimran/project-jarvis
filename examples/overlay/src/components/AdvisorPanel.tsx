/**
 * JARVIS Advisor Council Panel
 *
 * Pick a mentor, ask a question, hear it answered in their voice.
 *
 * Built-in: Naval Ravikant, Alex Hormozi, Paul Graham
 * User can add custom advisors via the + button.
 */

import { useEffect, useState } from 'react'

const DAEMON_URL = 'http://127.0.0.1:9101'

interface Advisor {
  id: string
  name: string
  focus: string
  sources: string[]
  createdAt: number
}

interface AdvisorMessage {
  id: string
  role: 'user' | 'advisor'
  content: string
  advisorName?: string
}

let msgCounter = 0
const msgId = () => `a${++msgCounter}`

// Emoji avatars for built-in advisors
const ADVISOR_AVATARS: Record<string, string> = {
  naval: '🧘',
  hormozi: '💪',
  pg: '✍️',
}

function getAvatar(id: string) {
  return ADVISOR_AVATARS[id] ?? '🧠'
}

export function AdvisorPanel() {
  const [advisors, setAdvisors] = useState<Advisor[]>([])
  const [selected, setSelected] = useState<Advisor | null>(null)
  const [messages, setMessages] = useState<AdvisorMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newFocus, setNewFocus] = useState('')
  const [addStatus, setAddStatus] = useState('')

  useEffect(() => {
    fetch(`${DAEMON_URL}/api/advisors`)
      .then(r => r.json())
      .then(data => {
        setAdvisors(data.advisors ?? [])
        if (data.advisors?.length > 0 && !selected) {
          setSelected(data.advisors[0])
        }
      })
      .catch(() => {})
  }, [])

  const selectAdvisor = (advisor: Advisor) => {
    setSelected(advisor)
    setMessages([])
  }

  const ask = async () => {
    if (!selected || !input.trim() || loading) return
    const question = input.trim()
    setInput('')

    const placeholderId = msgId()
    setMessages(prev => [
      ...prev,
      { id: msgId(), role: 'user', content: question },
      { id: placeholderId, role: 'advisor', content: '', advisorName: selected.name },
    ])
    setLoading(true)

    try {
      const res = await fetch(`${DAEMON_URL}/api/advisors/${selected.id}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      })

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

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
              setMessages(prev =>
                prev.map(m => m.id === placeholderId
                  ? { ...m, content: m.content + evt.content }
                  : m
                )
              )
            }

            if (evt.type === 'done') {
              const output = evt.result?.output ?? ''
              if (output) {
                setMessages(prev =>
                  prev.map(m => m.id === placeholderId
                    ? { ...m, content: output }
                    : m
                  )
                )
              }
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (e) {
      setMessages(prev =>
        prev.map(m => m.id === placeholderId
          ? { ...m, content: `Failed: ${String(e)}` }
          : m
        )
      )
    } finally {
      setLoading(false)
    }
  }

  const addAdvisor = async () => {
    if (!newName.trim() || !newFocus.trim()) return
    setAddStatus('Adding…')
    try {
      const res = await fetch(`${DAEMON_URL}/api/advisors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), focus: newFocus.trim() }),
      })
      const data = await res.json()
      if (data.advisor) {
        setAdvisors(prev => [...prev, data.advisor])
        setSelected(data.advisor)
        setNewName('')
        setNewFocus('')
        setShowAdd(false)
        setAddStatus('')
      }
    } catch {
      setAddStatus('Failed — is daemon running?')
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') ask()
  }

  return (
    <div className="advisor-panel">
      {/* Advisor roster */}
      <div className="advisor-roster">
        {advisors.map(a => (
          <button
            key={a.id}
            className={`advisor-chip ${selected?.id === a.id ? 'active' : ''}`}
            onClick={() => selectAdvisor(a)}
            title={a.focus}
          >
            <span className="advisor-chip-avatar">{getAvatar(a.id)}</span>
            <span className="advisor-chip-name">{a.name.split(' ')[0]}</span>
          </button>
        ))}
        <button
          className="advisor-chip add-advisor"
          onClick={() => setShowAdd(!showAdd)}
          title="Add a custom advisor"
        >
          +
        </button>
      </div>

      {/* Add advisor form */}
      {showAdd && (
        <div className="advisor-add-form">
          <input
            className="advisor-add-input"
            placeholder="Name (e.g. Elon Musk)"
            value={newName}
            onChange={e => setNewName(e.target.value)}
          />
          <input
            className="advisor-add-input"
            placeholder="Focus (e.g. First principles, EVs, AI)"
            value={newFocus}
            onChange={e => setNewFocus(e.target.value)}
          />
          {addStatus && <div className="advisor-add-status">{addStatus}</div>}
          <div className="advisor-add-actions">
            <button className="wf-btn save" onClick={() => setShowAdd(false)}>Cancel</button>
            <button className="wf-btn run" onClick={addAdvisor}>Add Advisor</button>
          </div>
        </div>
      )}

      {/* Selected advisor info */}
      {selected && !showAdd && (
        <div className="advisor-bio">
          <span className="advisor-bio-avatar">{getAvatar(selected.id)}</span>
          <div>
            <div className="advisor-bio-name">{selected.name}</div>
            <div className="advisor-bio-focus">{selected.focus}</div>
          </div>
        </div>
      )}

      {/* Conversation */}
      <div className="advisor-messages">
        {messages.length === 0 && selected && (
          <div className="advisor-empty">
            Ask {selected.name.split(' ')[0]} anything…
          </div>
        )}
        {messages.map((m, i) => (
          <div key={m.id} className={`advisor-message ${m.role}`}>
            {m.role === 'advisor' && (
              <div className="advisor-msg-name">{m.advisorName}</div>
            )}
            <div className="advisor-msg-content">
              {m.content || (m.role === 'advisor' && loading && i === messages.length - 1
                ? <span className="dots"><span>●</span><span>●</span><span>●</span></span>
                : ''
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      {selected && (
        <div className="input-area advisor-input">
          <input
            className="advisor-question-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={`Ask ${selected.name.split(' ')[0]}…`}
            disabled={loading}
          />
          <button
            className="send-btn"
            onClick={ask}
            disabled={loading || !input.trim()}
          >
            ↑
          </button>
        </div>
      )}
    </div>
  )
}
