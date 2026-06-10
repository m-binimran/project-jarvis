import { useState } from 'react'
import { jarvis } from '../lib/ipc'

export function ScreenPanel() {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [analysis, setAnalysis] = useState('')

  const capture = async () => {
    setLoading(true)
    setError('')
    setAnalysis('')
    const res = await jarvis.captureScreen()
    if (res.success && res.dataUrl) {
      setDataUrl(res.dataUrl)
    } else {
      setError(res.error || 'Capture failed')
    }
    setLoading(false)
  }

  const analyze = async () => {
    if (!dataUrl) return
    setAnalyzing(true)
    setAnalysis('')
    try {
      const res = await fetch('http://localhost:3010/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: 'jarvis',
          message: 'Analyze this screenshot and tell me what you see.',
          screenshot: dataUrl,
        }),
      })
      const data = await res.json()
      setAnalysis(data.response || data.message || 'No response')
    } catch (e) {
      setAnalysis(`Error: ${String(e)}`)
    }
    setAnalyzing(false)
  }

  return (
    <div className="screen-panel">
      <div className="screen-actions">
        <button className="action-btn" onClick={capture} disabled={loading}>
          {loading ? 'Capturing…' : '📷  Capture Screen'}
        </button>
        {dataUrl && (
          <button className="action-btn secondary" onClick={analyze} disabled={analyzing}>
            {analyzing ? 'Analyzing…' : '🔍  Analyze with JARVIS'}
          </button>
        )}
      </div>

      {error && <div className="screen-error">{error}</div>}

      {analysis && (
        <div className="screen-analysis">
          <div className="analysis-label">Analysis</div>
          <p>{analysis}</p>
        </div>
      )}

      {dataUrl && (
        <div className="screen-preview">
          <img src={dataUrl} alt="Screen capture" />
        </div>
      )}

      {!dataUrl && !loading && (
        <div className="screen-empty">
          Hit capture to grab a screenshot
        </div>
      )}
    </div>
  )
}
