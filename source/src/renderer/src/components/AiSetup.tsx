// One-click setup for the AI DJ: downloads its built-in brain, with live progress.
import { useEffect, useState } from 'react'

export function AiSetup({ onReady, compact = false }: { onReady?: () => void; compact?: boolean }): React.JSX.Element {
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [step, setStep] = useState('')
  const [line, setLine] = useState('')
  const [percent, setPercent] = useState<number | null>(null)
  const [error, setError] = useState('')

  useEffect(
    () =>
      window.pulse.dj.onAiProgress((p) => {
        if (p.step) {
          setStep(p.step)
          setPercent(null)
          setLine('')
        }
        if (p.line) setLine(p.line)
        if (p.percent !== undefined) setPercent(p.percent)
        if (p.error) setError(p.error)
      }),
    []
  )

  const run = async (): Promise<void> => {
    setState('running')
    setError('')
    setStep('Starting…')
    const ok = await window.pulse.dj.setupAi()
    setState(ok ? 'done' : 'error')
    if (ok) onReady?.()
  }

  if (state === 'done') return <p className="aisetup__ok">The AI DJ is ready.</p>
  return (
    <div className={`aisetup ${compact ? 'is-compact' : ''}`}>
      {state !== 'running' ? (
        <>
          <button className="btn btn--accent" onClick={() => void run()}>
            {state === 'error' ? 'Try again' : 'Set up the AI DJ for me'}
          </button>
          {!compact && <span className="muted">About 2 GB, once.</span>}
          {state === 'error' && <p className="aisetup__err">{error || 'The setup did not finish.'}</p>}
        </>
      ) : (
        <div className="aisetup__run">
          <b>{step}</b>
          <div className="aisetup__bar">
            <i style={{ width: percent !== null ? `${percent}%` : undefined }} className={percent === null ? 'is-busy' : ''} />
          </div>
          {line && <small>{line}</small>}
        </div>
      )}
    </div>
  )
}
