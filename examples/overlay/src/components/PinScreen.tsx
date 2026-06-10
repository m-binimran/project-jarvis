import { useState } from 'react'
import { jarvis } from '../lib/ipc'

interface Props {
  isFirstTime: boolean
  onSuccess: () => void
}

export function PinScreen({ isFirstTime, onSuccess }: Props) {
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [step, setStep] = useState<'enter' | 'confirm'>('enter')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleDigit = (d: string) => {
    if (loading) return
    if (step === 'confirm') {
      if (confirmPin.length < 4) setConfirmPin(p => p + d)
    } else {
      if (pin.length < 4) setPin(p => p + d)
    }
    setError('')
  }

  const handleBackspace = () => {
    if (loading) return
    if (step === 'confirm') {
      setConfirmPin(p => p.slice(0, -1))
    } else {
      setPin(p => p.slice(0, -1))
    }
    setError('')
  }

  // Auto-submit when 4 digits entered
  const currentPin = step === 'confirm' ? confirmPin : pin

  const handleSubmit = async () => {
    if (loading) return

    if (isFirstTime) {
      if (step === 'enter') {
        if (pin.length < 4) return
        setStep('confirm')
        return
      }
      // Confirm step
      if (confirmPin !== pin) {
        setError("PINs don't match. Try again.")
        setConfirmPin('')
        return
      }
      setLoading(true)
      const res = await jarvis.setPin(pin)
      if (res.success) {
        onSuccess()
      } else {
        setError(res.error || 'Failed to set PIN')
        setLoading(false)
      }
    } else {
      if (pin.length < 4) return
      setLoading(true)
      const res = await jarvis.verifyPin(pin)
      if (res.success) {
        onSuccess()
      } else {
        setError('Wrong PIN. Try again.')
        setPin('')
        setLoading(false)
      }
    }
  }

  // Auto-submit on 4th digit
  const handleDigitWithAuto = (d: string) => {
    const next = (step === 'confirm' ? confirmPin : pin) + d
    if (step === 'confirm') {
      if (confirmPin.length < 4) {
        setConfirmPin(next)
        setError('')
        if (next.length === 4) {
          // Trigger submit after state update
          setTimeout(() => {
            if (next !== pin) {
              setError("PINs don't match. Try again.")
              setConfirmPin('')
            } else {
              setLoading(true)
              jarvis.setPin(pin).then(res => {
                if (res.success) onSuccess()
                else { setError(res.error || 'Failed to set PIN'); setLoading(false) }
              })
            }
          }, 100)
        }
      }
    } else {
      if (pin.length < 4) {
        setPin(next)
        setError('')
        if (next.length === 4) {
          if (isFirstTime) {
            setTimeout(() => setStep('confirm'), 100)
          } else {
            setTimeout(() => {
              setLoading(true)
              jarvis.verifyPin(next).then(res => {
                if (res.success) onSuccess()
                else { setError('Wrong PIN. Try again.'); setPin(''); setLoading(false) }
              })
            }, 100)
          }
        }
      }
    }
  }

  const dots = step === 'confirm' ? confirmPin : pin

  return (
    <div className="pin-screen">
      <div className="pin-logo">J</div>
      <div className="pin-title">JARVIS</div>
      <div className="pin-subtitle">
        {isFirstTime
          ? step === 'enter' ? 'Set up your PIN' : 'Confirm your PIN'
          : 'Enter your PIN'}
      </div>

      <div className="pin-dots">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className={`pin-dot ${dots.length > i ? 'active' : ''}`} />
        ))}
      </div>

      {error && <div className="pin-error">{error}</div>}

      <div className="pin-pad">
        {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((d, i) => (
          <button
            key={i}
            className={`pin-key ${d === '' ? 'invisible' : ''}`}
            onClick={() => d === '⌫' ? handleBackspace() : d !== '' ? handleDigitWithAuto(d) : undefined}
            disabled={loading}
          >
            {d}
          </button>
        ))}
      </div>
    </div>
  )
}
