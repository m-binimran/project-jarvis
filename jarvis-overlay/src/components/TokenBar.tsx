import { useEffect, useState } from 'react'

const DAEMON_URL = 'http://127.0.0.1:9101'

interface UsageToday {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  costUsd: number
  calls: number
}

export function TokenBar() {
  const [usage, setUsage] = useState<UsageToday | null>(null)

  const refresh = async () => {
    try {
      const res = await fetch(`${DAEMON_URL}/api/usage`)
      if (res.ok) {
        const data = await res.json()
        setUsage(data.today)
      }
    } catch { /* daemon offline */ }
  }

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 30_000)  // refresh every 30s
    return () => clearInterval(interval)
  }, [])

  if (!usage) return null

  const tokens = usage.totalTokens ?? (usage.inputTokens + usage.outputTokens)
  const cost = usage.costUsd ?? 0

  return (
    <div className="token-bar" title={`${usage.calls ?? 0} API calls today`}>
      <span>
        <span className="token-used">{tokens.toLocaleString()}</span>
        <span style={{ color: '#334155' }}> tokens</span>
      </span>
      <span className="token-cost">
        ${cost.toFixed(4)} today
      </span>
    </div>
  )
}
