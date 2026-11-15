// The full-screen show while a mix is made: covers from your library circle into the middle
// like water down a drain, then the new playlist opens: its cover, name and buttons, with the
// songs listed right below. Covers never pass over each other: they travel in rings that stay
// apart. Esc or the cross closes the show; the mix keeps being made and shows up on the page.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { CloseIcon, PlayIcon, PlusIcon } from './Icons'
import { formatTime } from '@/lib/format'

const STEPS = ['Reading your library', 'Listening through your songs', 'Picking the best ones', 'Spacing out the artists', 'Putting it in order']
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

export interface MixSong {
  image: string | null
  name: string
  artist: string
}

export interface MixMakerResult {
  name: string
  covers: string[]
  songs: number
  length: string
  tracks: (MixSong & { uri: string; durationMs: number })[]
}

export function MixMaker({
  open,
  items,
  result,
  failed,
  onClose,
  onPlay,
  onPlayAt,
  onSave,
  saving
}: {
  open: boolean
  /** Songs whose covers swirl while the mix is made (from the pool once it's read). */
  items: MixSong[]
  result: MixMakerResult | null
  failed: boolean
  onClose: () => void
  onPlay: () => void
  onPlayAt: (index: number) => void
  onSave: () => void
  saving: boolean
}): React.JSX.Element | null {
  const [openedAt, setOpenedAt] = useState(0)
  const [step, setStep] = useState(0)
  const [, force] = useState(0)
  const images = useMemo(() => items.map((i) => i.image).filter((x): x is string => !!x), [items])

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
        <Reveal result={result} onPlay={onPlay} onPlayAt={onPlayAt} onSave={onSave} onClose={onClose} saving={saving} />
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


function Reveal({
  result,
  onPlay,
  onPlayAt,
  onSave,
  onClose,
  saving
}: {
  result: MixMakerResult
  onPlay: () => void
  onPlayAt: (index: number) => void
  onSave: () => void
  onClose: () => void
  saving: boolean
}): React.JSX.Element {
  const covers = useMemo(() => {
    const unique = [...new Set(result.covers.filter(Boolean))]
    const out: string[] = []
    while (unique.length && out.length < 4) out.push(...unique)
    return out.slice(0, 4)
  }, [result.covers])
  return (
    <motion.div className="mixshow__reveal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35 }}>
      <div className="mixreveal">
        <header className="mixreveal__head">
          <motion.div
            className="mixreveal__cover"
            initial={{ scale: 0.6, rotate: -6, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 220, damping: 18 }}
          >
            {covers.map((src, i) => (
              <img key={i} src={src} alt="" draggable={false} decoding="async" />
            ))}
            <span className="mixshow__shine" />
          </motion.div>
          <motion.div
            className="mixshow__text"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, type: 'spring', stiffness: 180, damping: 22 }}
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
            </div>
          </motion.div>
        </header>
        <ol className="mixreveal__list">
          {result.tracks.map((t, i) => (
            <motion.li
              key={`${t.uri}-${i}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 + Math.min(i, 14) * 0.03, duration: 0.3 }}
            >
              <button
                onClick={() => {
                  onPlayAt(i)
                  onClose()
                }}
              >
                <span className="mixreveal__n">{i + 1}</span>
                {t.image ? <img src={t.image} alt="" decoding="async" loading="lazy" draggable={false} /> : <span className="mixreveal__blank" />}
                <span className="mixreveal__t">
                  <b>{t.name}</b>
                  <small>{t.artist}</small>
                </span>
                <span className="mixreveal__d">{formatTime(t.durationMs)}</span>
              </button>
            </motion.li>
          ))}
        </ol>
      </div>
    </motion.div>
  )
}
