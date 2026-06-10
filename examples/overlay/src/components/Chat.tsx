import { useEffect, useRef, useState, useCallback } from 'react'

const DAEMON_URL = 'http://127.0.0.1:9101'

interface ApprovalRequest {
  requestId: string
  action: string
  context?: string
}

interface Message {
  id: string
  role: 'user' | 'assistant' | 'error'
  content: string
  agentId?: string
  feedback?: 1 | -1
  approval?: ApprovalRequest         // pending approval embedded in message
  approvalResolved?: boolean | null   // true=approved, false=denied, null=pending
}

let msgCounter = 0
const msgId = () => `m${++msgCounter}`

interface Props {
  speakRef?: React.MutableRefObject<((text: string) => void) | null>
  onSendReady?: (fn: (text: string) => void) => void
}

export function Chat({ speakRef, onSendReady }: Props = {}) {
  const [messages, setMessages] = useState<Message[]>([
    { id: msgId(), role: 'assistant', content: 'JARVIS online. How can I help?' }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [agentId, setAgentId] = useState<string | undefined>(undefined)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Exposed so VoiceIndicator can trigger sends directly
  const sendText = useCallback(async (text: string) => {
    if (!text.trim() || loading) return

    const placeholderId = msgId()
    setMessages(prev => [
      ...prev,
      { id: msgId(), role: 'user', content: text },
      { id: placeholderId, role: 'assistant', content: '' },
    ])
    setLoading(true)

    try {
      const res = await fetch(`${DAEMON_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, message: text }),
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      if (!res.body) throw new Error('No response body')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let respondingAgent: string | undefined

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
              respondingAgent = evt.result?.agentId
              const output = evt.result?.output ?? ''
              if (output) {
                setMessages(prev =>
                  prev.map(m => m.id === placeholderId
                    ? { ...m, content: output, agentId: respondingAgent, approval: undefined }
                    : m
                  )
                )
                speakRef?.current?.(output)
              }
            }

            if (evt.type === 'approval_needed') {
              // Replace placeholder with an approval card (keeps streaming paused)
              setMessages(prev =>
                prev.map(m => m.id === placeholderId
                  ? {
                      ...m,
                      content: '',
                      approval: {
                        requestId: evt.requestId,
                        action: evt.action,
                        context: evt.context,
                      },
                      approvalResolved: null,
                    }
                  : m
                )
              )
            }

            if (evt.type === 'approval_resolved') {
              // Update the card to show the decision — agent will continue/stop
              setMessages(prev =>
                prev.map(m =>
                  m.approval?.requestId === evt.requestId
                    ? { ...m, approvalResolved: evt.approved }
                    : m
                )
              )
            }

            if (evt.type === 'error') {
              setMessages(prev =>
                prev.map(m => m.id === placeholderId
                  ? { ...m, role: 'error', content: evt.message }
                  : m
                )
              )
            }
          } catch { /* skip malformed SSE */ }
        }
      }
    } catch (e) {
      setMessages(prev =>
        prev.map(m => m.id === placeholderId
          ? {
              ...m,
              role: 'error',
              content: `Cannot reach JARVIS daemon at ${DAEMON_URL}. Is it running?\n${String(e)}`,
            }
          : m
        )
      )
    } finally {
      setLoading(false)
      textareaRef.current?.focus()
    }
  }, [loading, agentId, speakRef])

  // Expose sendText to parent (VoiceIndicator injects commands through here)
  useEffect(() => {
    onSendReady?.(sendText)
  }, [sendText, onSendReady])

  // Wrapper for textarea send button (clears input first)
  const send = () => {
    const text = input.trim()
    if (!text) return
    setInput('')
    sendText(text)
  }

  const submitFeedback = async (msgId: string, score: 1 | -1, msgAgentId: string) => {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, feedback: score } : m))
    try {
      await fetch(`${DAEMON_URL}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: msgAgentId, score }),
      })
    } catch { /* non-blocking */ }
  }

  const resolveApproval = async (requestId: string, approved: boolean) => {
    // Optimistic UI — mark as resolved immediately
    setMessages(prev =>
      prev.map(m =>
        m.approval?.requestId === requestId
          ? { ...m, approvalResolved: approved }
          : m
      )
    )
    try {
      await fetch(`${DAEMON_URL}/api/approval/${requestId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved }),
      })
    } catch { /* agent will timeout-deny — acceptable */ }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <>
      <div className="messages">
        {messages.map((m, i) => (
          <div key={m.id} className={`message ${m.role}`}>
            {/* Approval card — shown when agent triggers a circuit breaker */}
            {m.approval && m.approvalResolved === null && (
              <div className="approval-card">
                <div className="approval-icon">⚠️</div>
                <div className="approval-body">
                  <div className="approval-title">Action requires approval</div>
                  <div className="approval-action">{m.approval.action}</div>
                  {m.approval.context && (
                    <div className="approval-context">{m.approval.context}</div>
                  )}
                </div>
                <div className="approval-btns">
                  <button
                    className="approval-btn approve"
                    onClick={() => resolveApproval(m.approval!.requestId, true)}
                  >
                    ✓ Approve
                  </button>
                  <button
                    className="approval-btn deny"
                    onClick={() => resolveApproval(m.approval!.requestId, false)}
                  >
                    ✕ Deny
                  </button>
                </div>
              </div>
            )}

            {/* Resolved approval badge */}
            {m.approval && m.approvalResolved !== null && m.approvalResolved !== undefined && (
              <div className={`approval-resolved ${m.approvalResolved ? 'approved' : 'denied'}`}>
                {m.approvalResolved ? '✓ Approved' : '✕ Denied'} — {m.approval.action}
              </div>
            )}

            {/* Regular message content */}
            {!m.approval && (
              <div className="message-content">
                {m.content || (m.role === 'assistant' && loading && i === messages.length - 1
                  ? <span className="dots"><span>●</span><span>●</span><span>●</span></span>
                  : null
                )}
              </div>
            )}

            {/* Feedback buttons — only on completed assistant messages */}
            {m.role === 'assistant' && m.content && !loading && !m.approval && (
              <div className="feedback-row">
                <button
                  className={`feedback-btn ${m.feedback === 1 ? 'active-up' : ''}`}
                  onClick={() => submitFeedback(m.id, 1, m.agentId ?? 'jarvis')}
                  title="Good response"
                >
                  👍
                </button>
                <button
                  className={`feedback-btn ${m.feedback === -1 ? 'active-down' : ''}`}
                  onClick={() => submitFeedback(m.id, -1, m.agentId ?? 'jarvis')}
                  title="Not helpful"
                >
                  👎
                </button>
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="input-area">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Message JARVIS…"
          disabled={loading}
          rows={1}
        />
        <button className="send-btn" onClick={send} disabled={loading || !input.trim()}>
          ↑
        </button>
      </div>
    </>
  )
}
