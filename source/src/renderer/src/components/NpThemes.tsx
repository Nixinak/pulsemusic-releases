// Now Playing looks: the usual one, a big cover, a turntable and a CD deck, plus the menu at the
// right edge of the screen that switches between them (three lines) and turns real full screen
// on and off. The menu shows when the pointer comes near the right edge.
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { NpTheme } from '@shared/types'
import { Glass } from './Glass'

export const NP_THEMES: { id: NpTheme; label: string; hint: string }[] = [
  { id: 'classic', label: 'Classic', hint: 'Cover, controls and lyrics' },
  { id: 'cover', label: 'Album cover', hint: 'The cover, big and centre stage' },
  { id: 'vinyl', label: 'Vinyl', hint: 'A turntable spinning the record' },
  { id: 'cd', label: 'CD deck', hint: 'A disc in a player, with a display' },
  { id: 'lock', label: 'Lock screen', hint: 'The cover as wallpaper, with the time' }
]

/* ---------- The lock screen ---------- */

/** The cover filling the screen like a wallpaper (it slowly drifts closer). */
export function LockWall({ art }: { art: string | null }): React.JSX.Element {
  return (
    <div className="lockwall" aria-hidden="true">
      <AnimatePresence initial={false}>
        {art && (
          <motion.img
            key={art}
            src={art}
            alt=""
            draggable={false}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.1 }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

/** The date and a big clock, like a lock screen. */
export function LockClock(): React.JSX.Element {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let t = 0
    // ticks on the minute, so the clock changes when the real one does
    const next = (): void => {
      t = window.setTimeout(
        () => {
          setNow(new Date())
          next()
        },
        60_000 - (Date.now() % 60_000) + 30
      )
    }
    next()
    return () => window.clearTimeout(t)
  }, [])
  const date = now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return (
    <div className="lockclock">
      <span className="lockclock__date">{date}</span>
      <span className="lockclock__time">{time}</span>
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
      {id === 'lock' && (
        <>
          <i className="npm__pv-clock" />
          <i className="npm__pv-art" />
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
  sounds,
  scratch,
  onTheme,
  onFull,
  onSounds,
  onScratch
}: {
  theme: NpTheme
  full: boolean
  sounds: boolean
  scratch: boolean
  onTheme: (t: NpTheme) => void
  onFull: () => void
  onSounds: (on: boolean) => void
  onScratch: (on: boolean) => void
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
              <button className={`npm__sound ${sounds ? 'is-on' : ''}`} role="switch" aria-checked={sounds} onClick={() => onSounds(!sounds)}>
                <span>
                  <b>Device sounds</b>
                  <small>Vinyl crackle, the needle, the CD spinning up</small>
                </span>
                <i aria-hidden="true" />
              </button>
              {theme === 'vinyl' && (
                <button className={`npm__sound npm__sound--sub ${scratch ? 'is-on' : ''}`} role="switch" aria-checked={scratch} onClick={() => onScratch(!scratch)}>
                  <span>
                    <b>Scratch the record</b>
                    <small>Grab the vinyl and spin it like a DJ</small>
                  </span>
                  <i aria-hidden="true" />
                </button>
              )}
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
