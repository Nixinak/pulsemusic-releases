// Minimise / maximise / close, drawn as a glass pill so they match the rest of the app.
import { useEffect, useState } from 'react'
import { Glass } from './Glass'

export function WindowControls(): React.JSX.Element {
  const [max, setMax] = useState(false)
  useEffect(() => window.pulse.window.onMaximized(setMax), [])
  return (
    <Glass radius={999} bezel={10} refraction={28} className="winctl">
      <button className="winctl__btn" aria-label="Minimise" onClick={() => window.pulse.window.minimize()}>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2 6h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
      <button className="winctl__btn" aria-label={max ? 'Restore' : 'Maximise'} onClick={() => window.pulse.window.toggleMaximize()}>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3">
          {max ? (
            <>
              <rect x="2" y="3.5" width="6.5" height="6.5" rx="1.6" />
              <path d="M4 2h4.4A1.6 1.6 0 0 1 10 3.6V8" strokeLinecap="round" />
            </>
          ) : (
            <rect x="2" y="2" width="8" height="8" rx="2" />
          )}
        </svg>
      </button>
      <button className="winctl__btn winctl__btn--close" aria-label="Close" onClick={() => window.pulse.window.close()}>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="m2.5 2.5 7 7m0-7-7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
    </Glass>
  )
}
