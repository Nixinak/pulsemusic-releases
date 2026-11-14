// The full-screen show while a mix is made: covers from your library circle into the middle
// like water down a drain, then the chosen songs come together into the new playlist's cover.
// Covers never pass over each other: they travel in rings that stay apart, and the final tiles
// close in from all sides at once. Esc or the cross closes it; the mix keeps being made and
// shows up on the page as usual.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { CloseIcon, PlayIcon, PlusIcon } from './Icons'

const STEPS = ['Reading your library', 'Listening through your songs', 'Picking the best ones', 'Spacing out the artists', 'Putting it in order']
const GRID = 4
/** The swirl runs at least this long, so a quick mix still gets its moment. */
const MIN_SWIRL_MS = 2600

/* The swirl: rings of upright covers, PER_RING evenly spaced on each ring. A cover is SIZE ×
   its ring's radius wide (at most MAX_COVER), and each ring is RATIO the size of the one
   outside it. With these numbers neighbours on a ring and covers on neighbouring rings always
   keep a gap, however the rings turn. */
const PER_RING = 12
const SIZE = 0.32
const RATIO = 0.58
const MAX_COVER = 150
/** Rings that move one place inwards per second. */
const INWARD = 0.32
/** Below this radius covers fade out, so the words in the middle stay readable. */
const INNER = 70

interface Ring {
  /** Place from the outside (0 = outermost); grows as the ring moves in. */
  level: number
  /** Turn of the ring in radians. */
  angle: number
  cards: { el: HTMLDivElement | null; src: string }[]
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

/** Rings of covers turning into the middle, faster as they get close, then reborn outside. */
function Swirl({ images, done }: { images: string[]; done: boolean }): React.JSX.Element {
  const list = useMemo(() => images.filter(Boolean), [images])
  const listRef = useRef(list)
  listRef.current = list
  const doneRef = useRef(done)
  doneRef.current = done
  const rings = useRef<Ring[]>([])

  // Enough rings to reach the corners of the biggest window this screen can show.
  if (rings.current.length === 0) {
    const far = Math.hypot(window.screen.width || 1920, window.screen.height || 1080) / 2 + MAX_COVER
    const count = Math.ceil(Math.log(far / (INNER * 0.8)) / Math.log(1 / RATIO)) + 1
    rings.current = Array.from({ length: count }, (_, i) => ({
      level: i,
      angle: rand(0, Math.PI * 2),
      cards: Array.from({ length: PER_RING }, () => ({ el: null, src: '' }))
    }))
  }

  // new covers (the pool is read while the show runs) go to cards that have none yet
  useLayoutEffect(() => {
    const l = listRef.current
    if (!l.length) return
    for (const r of rings.current)
      for (const c of r.cards) {
        if (c.src) continue
        c.src = l[Math.floor(Math.random() * l.length)]
        const img = c.el?.querySelector('img')
        if (img) img.src = c.src
      }
  }, [list])

  useEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    const all = rings.current
    const span = all.length
    let raf = 0
    let last = performance.now()
    const loop = (now: number): void => {
      raf = requestAnimationFrame(loop)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (document.hidden) return
      const w = window.innerWidth
      const h = window.innerHeight
      const cx = w / 2
      const cy = h / 2 - 20
      const outer = Math.hypot(w, h) / 2 + MAX_COVER
      const ending = doneRef.current
      const slow = reduce ? 0.3 : 1
      for (const ring of all) {
        ring.level += (ending ? 2.4 : INWARD) * dt * slow
        let r = outer * Math.pow(RATIO, ring.level)
        if (r < INNER * 0.8 && !ending) {
          // past the drain: back outside with new covers
          ring.level -= span
          r = outer * Math.pow(RATIO, ring.level)
          ring.angle = rand(0, Math.PI * 2)
          const l = listRef.current
          for (const c of ring.cards) {
            if (!l.length) break
            c.src = l[Math.floor(Math.random() * l.length)]
            const img = c.el?.querySelector('img')
            if (img && img.getAttribute('src') !== c.src) img.src = c.src
          }
        }
        // closer to the middle = faster round
        ring.angle += 0.22 * dt * slow * (1 + 140 / Math.max(40, r))
        const size = Math.min(MAX_COVER, SIZE * r)
        const scale = size / MAX_COVER
        const fade = Math.max(0, Math.min(1, (r - INNER) / 80))
        // a ring that is all outside the window isn't drawn
        const off = r - size > Math.hypot(w, h) / 2
        ring.cards.forEach((c, i) => {
          const el = c.el
          if (!el) return
          if (off || fade <= 0) {
            if (el.style.opacity !== '0') el.style.opacity = '0'
            return
          }
          const a = ring.angle + (i / PER_RING) * Math.PI * 2
          const x = cx + Math.cos(a) * r - MAX_COVER / 2
          const y = cy + Math.sin(a) * r - MAX_COVER / 2
          el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${scale.toFixed(3)})`
          el.style.opacity = fade.toFixed(3)
        })
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="mixshow__swirl" aria-hidden="true">
      {rings.current.flatMap((ring, ri) =>
        ring.cards.map((c, ci) => (
          <div
            key={`${ri}-${ci}`}
            className="mixshow__card"
            ref={(el) => {
              c.el = el
            }}
          >
            <img alt="" decoding="async" draggable={false} src={c.src || undefined} />
          </div>
        ))
      )}
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
  // Where each tile starts: further out on the line from the middle through its place, the
  // same distance for every tile of a ring, so the tiles close in like a grid shrinking and
  // never cross each other. The middle four arrive first, the outer twelve right after.
  const starts = useMemo(() => {
    const pitch = Math.min(window.innerHeight * 0.42, window.innerWidth * 0.4, 440) / GRID
    return covers.map((_, i) => {
      const gx = (i % GRID) - (GRID - 1) / 2
      const gy = Math.floor(i / GRID) - (GRID - 1) / 2
      const outerRing = Math.max(Math.abs(gx), Math.abs(gy)) > 1
      const k = 3.2
      return { x: gx * (k - 1) * pitch, y: gy * (k - 1) * pitch, delay: outerRing ? 160 : 0 }
    })
  }, [covers])
  return (
    <div className="mixshow__reveal">
      <div className="mixshow__grid" style={{ '--n': GRID } as React.CSSProperties}>
        {covers.map((src, i) => (
          // a CSS animation (runs on the GPU): from further out on its line to its place
          <img
            key={i}
            src={src}
            alt=""
            draggable={false}
            style={
              {
                '--delay': `${starts[i].delay}ms`,
                '--sx': `${starts[i].x.toFixed(0)}px`,
                '--sy': `${starts[i].y.toFixed(0)}px`
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
        transition={{ delay: 1.05, type: 'spring', stiffness: 160, damping: 22 }}
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
