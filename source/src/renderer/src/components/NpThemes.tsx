// Now Playing looks: the usual one, a big cover, a turntable and a CD deck, plus the menu at the
// right edge of the screen that switches between them (three lines) and turns real full screen
// on and off. The menu shows when the pointer comes near the right edge.
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { NpTheme } from '@shared/types'
import { useLivePosition } from './common'
import { formatTime } from '@/lib/format'
import { Glass } from './Glass'

export const NP_THEMES: { id: NpTheme; label: string; hint: string }[] = [
  { id: 'classic', label: 'Classic', hint: 'Cover, controls and lyrics' },
  { id: 'cover', label: 'Album cover', hint: 'The cover, big and centre stage' },
  { id: 'vinyl', label: 'Vinyl', hint: 'A turntable spinning the record' },
  { id: 'cd', label: 'CD deck', hint: 'A disc in a player, with a display' }
]

/* ---------- The record player ---------- */

export function Turntable({ art, paused }: { art: string | null; paused: boolean }): React.JSX.Element {
  return (
    <div className={`tt ${paused ? 'is-paused' : ''}`} aria-hidden="true">
      <div className="tt__plinth">
        <span className="tt__light" />
        <div className="tt__platter">
          <div className="tt__record">
            <span className="tt__grooves" />
            <span className="tt__sheen" />
            <span className="tt__label">{art ? <img src={art} alt="" draggable={false} /> : null}</span>
            <span className="tt__spindle" />
          </div>
        </div>
        <svg className="tt__arm" viewBox="0 0 100 100">
          <circle className="tt__arm-base" cx="84" cy="14" r="8" />
          <circle className="tt__arm-pivot" cx="84" cy="14" r="3.2" />
          <path className="tt__arm-rod" d="M84 14 L83 56 L64 71" />
          <rect className="tt__arm-head" x="57" y="68.5" width="10" height="7" rx="1.6" transform="rotate(-38 62 72)" />
          <rect className="tt__arm-weight" x="80.5" y="2" width="7" height="7" rx="1.5" />
        </svg>
        <span className="tt__knob" />
        <span className="tt__speed">33</span>
      </div>
    </div>
  )
}

/* ---------- The CD deck ---------- */

export function CdDeck({ art, paused, title, artist, durationMs }: { art: string | null; paused: boolean; title: string; artist: string; durationMs: number }): React.JSX.Element {
  const pos = useLivePosition()
  const text = `${title} — ${artist}`
  return (
    <div className={`cdd ${paused ? 'is-paused' : ''}`} aria-hidden="true">
      <div className="cdd__body">
        <div className="cdd__well">
          <div className="cdd__disc">
            {art && <img src={art} alt="" draggable={false} />}
            <span className="cdd__rainbow" />
            <span className="cdd__hub" />
          </div>
          <span className="cdd__lid" />
        </div>
        <div className="cdd__panel">
          <div className="cdd__lcd">
            <div className="cdd__row">
              <span className={`cdd__state ${paused ? '' : 'is-on'}`}>{paused ? '❚❚' : '▶'}</span>
              <span className="cdd__time">{formatTime(pos)}</span>
              <span className="cdd__total">/ {formatTime(durationMs)}</span>
            </div>
            <div className="cdd__marquee">
              <span key={text} className={text.length > 26 ? 'is-long' : ''}>
                {text}
                {text.length > 26 && <>&nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp;{text}</>}
              </span>
            </div>
          </div>
          <div className="cdd__leds">
            <i className={paused ? '' : 'is-on'} />
            <small>PLAY</small>
            <i className="is-rec" />
            <small>REC</small>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------- The menu at the edge ---------- */

const MenuIcon = (): React.JSX.Element => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <path d="M4.5 7h15M4.5 12h15M4.5 17h15" />
  </svg>
)
const FullIcon = ({ on }: { on: boolean }): React.JSX.Element => (
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    {on ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
  </svg>
)

/** Small drawings of each look, for the menu. */
function ThemePreview({ id }: { id: NpTheme }): React.JSX.Element {
  return (
    <span className={`npm__pv npm__pv--${id}`} aria-hidden="true">
      {id === 'classic' && (
        <>
          <i className="npm__pv-art" />
          <i className="npm__pv-lines" />
        </>
      )}
      {id === 'cover' && <i className="npm__pv-art" />}
      {id === 'vinyl' && (
        <>
          <i className="npm__pv-text" />
          <i className="npm__pv-disc" />
        </>
      )}
      {id === 'cd' && (
        <>
          <i className="npm__pv-cd" />
          <i className="npm__pv-lcd" />
        </>
      )}
    </span>
  )
}

export function NpEdgeMenu({
  theme,
  full,
  onTheme,
  onFull
}: {
  theme: NpTheme
  full: boolean
  onTheme: (t: NpTheme) => void
  onFull: () => void
}): React.JSX.Element {
  const [near, setNear] = useState(false)
  const [menu, setMenu] = useState(false)
  // shown for a moment when Now Playing opens, so it can be found
  const [hint, setHint] = useState(true)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const t = window.setTimeout(() => setHint(false), 2600)
    return () => window.clearTimeout(t)
  }, [])

  useEffect(() => {
    let raf = 0
    let x = 0
    let y = 0
    const check = (): void => {
      raf = 0
      const w = window.innerWidth
      const h = window.innerHeight
      // near the right edge, away from the window buttons at the top and the corner at the bottom
      const edge = x > w - 120 && y > h * 0.18 && y < h * 0.82
      // once open, the menu stays while the pointer is over it or close to it
      const r = box.current?.getBoundingClientRect()
      const over = !!r && x > r.left - 60 && y > r.top - 60 && y < r.bottom + 60
      setNear(edge || over)
    }
    const onMove = (e: PointerEvent): void => {
      x = e.clientX
      y = e.clientY
      if (!raf) raf = requestAnimationFrame(check)
    }
    window.addEventListener('pointermove', onMove)
    return () => {
      window.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(raf)
    }
  }, [])

  // the theme list closes when the pointer goes away or on a click elsewhere
  useEffect(() => {
    if (!near && menu) {
      const t = window.setTimeout(() => setMenu(false), 500)
      return () => window.clearTimeout(t)
    }
    return undefined
  }, [near, menu])
  useEffect(() => {
    if (!menu) return
    const onDown = (e: PointerEvent): void => {
      if (!box.current?.contains(e.target as Node)) setMenu(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        setMenu(false)
      }
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [menu])

  const shown = near || menu || hint
  return (
    <div ref={box} className={`npm ${shown ? 'is-shown' : ''}`}>
      <AnimatePresence>
        {menu && (
          <motion.div
            className="npm__panel"
            initial={{ opacity: 0, x: 16, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 12, scale: 0.97, transition: { duration: 0.16 } }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          >
            <Glass radius={24} bezel={14} refraction={36} className="npm__glass">
              <p className="npm__h">Look</p>
              <div className="npm__list" role="radiogroup" aria-label="Now Playing look">
                {NP_THEMES.map((t) => (
                  <button
                    key={t.id}
                    role="radio"
                    aria-checked={theme === t.id}
                    className={`npm__opt ${theme === t.id ? 'is-on' : ''}`}
                    onClick={() => onTheme(t.id)}
                  >
                    <ThemePreview id={t.id} />
                    <span className="npm__txt">
                      <b>{t.label}</b>
                      <small>{t.hint}</small>
                    </span>
                  </button>
                ))}
              </div>
            </Glass>
          </motion.div>
        )}
      </AnimatePresence>
      <Glass radius={999} bezel={10} refraction={30} className="npm__pill">
        <button className={`npm__btn ${menu ? 'is-on' : ''}`} aria-label="Change the look" aria-expanded={menu} title="Look" onClick={() => setMenu((v) => !v)}>
          <MenuIcon />
        </button>
        <button className={`npm__btn ${full ? 'is-on' : ''}`} aria-label={full ? 'Leave full screen' : 'Full screen'} title={full ? 'Leave full screen' : 'Full screen (hides the taskbar)'} onClick={onFull}>
          <FullIcon on={full} />
        </button>
      </Glass>
    </div>
  )
}
