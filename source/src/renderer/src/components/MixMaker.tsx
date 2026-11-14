// The full-screen show while a mix is made: covers from your library swirl into the middle and
// get mixed, then the chosen songs fly together into the new playlist's cover. Esc or the
// cross closes it; the mix keeps being made and shows up on the page as usual.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { CloseIcon, PlayIcon, PlusIcon } from './Icons'

const STEPS = ['Reading your library', 'Listening through your songs', 'Picking the best ones', 'Spacing out the artists', 'Putting it in order']
const SWIRL = 34
const GRID = 4
/** The swirl runs at least this long, so a quick mix still gets its moment. */
const MIN_SWIRL_MS = 2600

interface Particle {
  el: HTMLDivElement | null
  src: string
  a: number
  r: number
  speed: number
  inward: number
  spin: number
  rot: number
  size: number
}

const rand = (a: number, b: number): number => a + Math.random() * (b - a)

export interface MixMakerResult {
  name: string
  covers: string[]
  songs: number
  length: string
}

export function MixMaker({
  open,
  images,
  result,
  failed,
  onClose,
  onPlay,
  onSave,
  saving
}: {
  open: boolean
  /** Covers to swirl: your sources first, then songs from the pool once it's read. */
  images: string[]
  result: MixMakerResult | null
  failed: boolean
  onClose: () => void
  onPlay: () => void
  onSave: () => void
  saving: boolean
}): React.JSX.Element | null {
  const [openedAt, setOpenedAt] = useState(0)
  const [step, setStep] = useState(0)
  const [, force] = useState(0)

  useEffect(() => {
    if (!open) return
    setOpenedAt(Date.now())
    setStep(0)
    const t = window.setInterval(() => setStep((s) => Math.min(STEPS.length - 1, s + 1)), 1400)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearInterval(t)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  // the result waits until the swirl has had its moment
  const early = !!result && Date.now() - openedAt < MIN_SWIRL_MS
  useEffect(() => {
    if (!early) return
    const t = window.setTimeout(() => force((x) => x + 1), MIN_SWIRL_MS - (Date.now() - openedAt))
    return () => window.clearTimeout(t)
  }, [early, openedAt])
  const done = !!result && !early

  // a failed mix (nothing fit) closes the show; the page explains why
  useEffect(() => {
    if (open && failed) onClose()
  }, [open, failed, onClose])

  if (!open) return null
  return createPortal(
    <div className={`mixshow ${done ? 'is-done' : ''}`} role="dialog" aria-label="Making your mix">
      <div className="mixshow__bg" aria-hidden="true" />
      <Swirl images={images} done={done} />
      <button className="mixshow__close icon-btn" aria-label="Close (the mix keeps going)" title="Close (Esc)" onClick={onClose}>
        <CloseIcon size={22} />
      </button>
      {done && result ? (
        <Reveal result={result} onPlay={onPlay} onSave={onSave} onClose={onClose} saving={saving} />
      ) : (
        <div className="mixshow__status">
          <div className="mixshow__orb" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <AnimatePresence mode="wait">
            <motion.p key={step} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.35 }}>
              {STEPS[step]}…
            </motion.p>
          </AnimatePresence>
        </div>
      )}
    </div>,
    document.body
  )
}

/** Covers circling into the middle, faster and smaller as they get close, then reborn outside. */
function Swirl({ images, done }: { images: string[]; done: boolean }): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const list = useMemo(() => images.filter(Boolean), [images])
  const parts = useRef<Particle[]>([])
  const listRef = useRef(list)
  listRef.current = list
  const doneRef = useRef(done)
  doneRef.current = done

  // the particles are made once; their pictures change as they're reborn
  if (parts.current.length === 0) {
    parts.current = Array.from({ length: SWIRL }, () => ({
      el: null,
      src: '',
      a: rand(0, Math.PI * 2),
      r: rand(0.35, 1.25),
      speed: rand(0.25, 0.5),
      inward: rand(0.05, 0.11),
      spin: rand(-40, 40),
      rot: rand(-20, 20),
      size: rand(78, 132)
    }))
  }

  useLayoutEffect(() => {
    const pick = (): string => {
      const l = listRef.current
      return l.length ? l[Math.floor(Math.random() * l.length)] : ''
    }
    for (const p of parts.current) if (!p.src) p.src = pick()
    const imgs = box.current?.querySelectorAll('img') ?? []
    parts.current.forEach((p, i) => {
      if (imgs[i] && p.src) (imgs[i] as HTMLImageElement).src = p.src
    })
  }, [list])

  useEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    let last = performance.now()
    const loop = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const w = window.innerWidth
      const h = window.innerHeight
      const cx = w / 2
      const cy = h / 2 - 20
      const R = Math.hypot(w, h) * 0.55
      const ending = doneRef.current
      parts.current.forEach((p) => {
        const el = p.el
        if (!el) return
        // closer to the middle = faster round, like water going down a drain
        const pull = ending ? 1.9 : p.inward
        p.r -= pull * dt * (reduce ? 0.3 : 1)
        p.a += p.speed * dt * (1 + 0.5 / Math.max(0.08, p.r)) * (reduce ? 0.3 : 1)
        p.rot += p.spin * dt
        if (p.r < 0.1) {
          if (ending) {
            p.r = 0.05
          } else {
            p.r = rand(1.05, 1.3)
            p.a = rand(0, Math.PI * 2)
            const l = listRef.current
            if (l.length) {
              p.src = l[Math.floor(Math.random() * l.length)]
              const img = el.querySelector('img')
              if (img && img.src !== p.src) img.src = p.src
            }
          }
        }
        const depth = Math.sin(p.a) // -1 back … 1 front
        const x = cx + Math.cos(p.a) * p.r * R * 0.95
        const y = cy + Math.sin(p.a) * p.r * R * 0.42
        const scale = (0.55 + 0.45 * Math.min(1, p.r * 1.2)) * (0.8 + 0.25 * depth)
        // fade out near the middle (keeps the words readable) and at the far edge
        const fade = Math.min(1, (p.r - 0.12) / 0.3) * Math.min(1, (1.3 - p.r) / 0.25)
        el.style.transform = `translate3d(${(x - p.size / 2).toFixed(1)}px, ${(y - p.size / 2).toFixed(1)}px, 0) rotate(${p.rot.toFixed(1)}deg) scale(${scale.toFixed(3)})`
        el.style.opacity = Math.max(0, fade * (0.55 + 0.45 * (depth + 1) / 2)).toFixed(3)
        el.style.zIndex = String(Math.round(50 + depth * 40))
      })
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="mixshow__swirl" ref={box} aria-hidden="true">
      {parts.current.map((p, i) => (
        <div
          key={i}
          className="mixshow__card"
          ref={(el) => {
            p.el = el
          }}
          style={{ width: p.size, height: p.size }}
        >
          <img alt="" decoding="async" draggable={false} />
        </div>
      ))}
    </div>
  )
}

/** The chosen songs fly together into the new cover, then the name and buttons appear. */
function Reveal({
  result,
  onPlay,
  onSave,
  onClose,
  saving
}: {
  result: MixMakerResult
  onPlay: () => void
  onSave: () => void
  onClose: () => void
  saving: boolean
}): React.JSX.Element {
  const covers = useMemo(() => {
    const unique = [...new Set(result.covers.filter(Boolean))]
    const out: string[] = []
    while (unique.length && out.length < GRID * GRID) out.push(...unique)
    return out.slice(0, GRID * GRID)
  }, [result.covers])
  // where each tile starts: somewhere off in the swirl
  const starts = useMemo(
    () =>
      covers.map(() => ({
        x: rand(-0.7, 0.7) * window.innerWidth,
        y: rand(-0.6, 0.6) * window.innerHeight,
        r: rand(-50, 50),
        s: rand(0.4, 0.9)
      })),
    [covers]
  )
  return (
    <div className="mixshow__reveal">
      <div className="mixshow__grid" style={{ '--n': GRID } as React.CSSProperties}>
        {covers.map((src, i) => (
          // a CSS animation (runs on the GPU): from somewhere in the swirl to its place
          <img
            key={i}
            src={src}
            alt=""
            draggable={false}
            style={
              {
                '--i': i,
                '--sx': `${starts[i].x.toFixed(0)}px`,
                '--sy': `${starts[i].y.toFixed(0)}px`,
                '--sr': `${starts[i].r.toFixed(0)}deg`,
                '--ss': starts[i].s.toFixed(2)
              } as React.CSSProperties
            }
          />
        ))}
        <span className="mixshow__shine" />
      </div>
      <motion.div
        className="mixshow__text"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.045 * covers.length + 0.7, type: 'spring', stiffness: 160, damping: 22 }}
      >
        <small>Your new mix</small>
        <h2>{result.name}</h2>
        <p>
          {result.songs} songs, {result.length}
        </p>
        <div className="mixshow__actions">
          <button
            className="btn btn--accent"
            onClick={() => {
              onPlay()
              onClose()
            }}
          >
            <PlayIcon size={18} /> Play
          </button>
          <button className="btn" disabled={saving} onClick={onSave}>
            <PlusIcon size={17} /> {saving ? 'Saving…' : 'Save as playlist'}
          </button>
          <button className="btn" onClick={onClose}>
            See the songs
          </button>
        </div>
      </motion.div>
    </div>
  )
}
