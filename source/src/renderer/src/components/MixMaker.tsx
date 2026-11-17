// The full-screen show while a mix is made: covers from your library circle the middle in depth,
// one is picked out every second (the background takes its colours), then the new playlist opens: its cover, name and buttons, with the songs listed right below. Esc or the
// cross closes the show; the mix keeps being made and shows up on the page.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { CloseIcon, PlayIcon, PlusIcon } from './Icons'
import { formatTime } from '@/lib/format'
import { extractPalette } from '@/lib/colors'

const STEPS = ['Reading your library', 'Listening through your songs', 'Picking the best ones', 'Spacing out the artists', 'Putting it in order']
/** The shuffle runs at least this long, so a quick mix still gets its moment. */
const MIN_SWIRL_MS = 2600

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
    <div className={`mixshow mixshow--orbit ${done ? 'is-done' : ''}`} role="dialog" aria-label="Making your mix">
      <div className="mixshow__bg" aria-hidden="true" />
      <Orbit images={images} done={done} />
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

/** How many covers orbit. */
const COVERS = 30
/** A new song is picked out of the orbit this often (ms). */
const PICK_EVERY = 1150
/** A pick: flies to the middle, holds, flies back (ms). */
const PICK_IN = 460
const PICK_HOLD = 520
const PICK_OUT = 420
const ease = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.pow(1 - x, 3))
const easeInOut = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
const rand = (a: number, b: number): number => a + Math.random() * (b - a)
const TILT_COS = Math.cos(-0.12)
const TILT_SIN = Math.sin(-0.12)

interface Body {
  el: HTMLDivElement | null
  src: string
  /** Orbit radius (share of the base radius), height in the scene, speed and where it starts. */
  r: number
  y: number
  speed: number
  phase: number
  /** When it was last picked (performance.now()), 0 = never. */
  pickedAt: number
  /** The cover was swapped on this lap already (covers change while behind the others). */
  lap: number
}

/**
 * Covers circle the middle on tilted orbits, in depth: the near ones big and bright, the far
 * ones small and dim. Every second or so the cover nearest to you is picked: it flies to the
 * middle, the whole background takes on its colours, and it flies back into its orbit. Covers
 * passing behind the others change to new ones from your library. When the mix is ready,
 * everything falls into the middle.
 */
function Orbit({ images, done }: { images: string[]; done: boolean }): React.JSX.Element {
  const list = useMemo(() => images.filter(Boolean), [images])
  const ready = useRef<string[]>([])
  const root = useRef<HTMLDivElement>(null)
  const bodies = useRef<Body[]>(
    Array.from({ length: COVERS }, (_, i) => ({
      el: null,
      src: '',
      r: rand(0.62, 1.08),
      y: ((i % 5) - 2) * 0.1 + rand(-0.03, 0.03),
      speed: rand(0.16, 0.3) * (i % 3 === 0 ? -1 : 1),
      phase: (i / COVERS) * Math.PI * 2 * 3.3,
      pickedAt: 0,
      lap: -1
    }))
  )
  const doneRef = useRef(done)
  doneRef.current = done

  // covers are loaded before they're shown (no empty flashes)
  useEffect(() => {
    for (const u of list) {
      if (ready.current.includes(u)) continue
      const im = new Image()
      im.onload = () => {
        void im
          .decode?.()
          .catch(() => undefined)
          .finally(() => !ready.current.includes(u) && ready.current.push(u))
      }
      im.src = u
    }
  }, [list])
  const give = (b: Body): void => {
    const l = ready.current
    if (!l.length) return
    // a cover no other body shows right now, when there are enough
    const used = new Set(bodies.current.map((x) => x.src))
    const free = l.filter((u) => !used.has(u))
    const u = (free.length ? free : l)[Math.floor(Math.random() * (free.length || l.length))]
    b.src = u
    const img = b.el?.querySelector('img')
    if (img && img.getAttribute('src') !== u) img.src = u
  }

  useEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    const t0 = performance.now()
    let lastPick = t0 - PICK_EVERY + 700
    let doneAt = 0
    const recent: Body[] = []
    const tint = (src: string): void => {
      void extractPalette(src).then((p) => {
        const el = root.current
        if (!el) return
        el.style.setProperty('--mx-a', p.colors[0])
        el.style.setProperty('--mx-b', p.colors[1])
        el.style.setProperty('--mx-c', p.colors[2])
        el.style.setProperty('--mx-glow', p.accentDark)
      })
    }
    const loop = (now: number): void => {
      raf = requestAnimationFrame(loop)
      if (document.hidden) return
      const all = bodies.current
      const W = window.innerWidth
      const H = window.innerHeight
      const cx = W / 2
      const cy = H * 0.45
      const R = Math.min(W * 0.36, H * 0.6)
      const cover = Math.max(80, Math.min(140, Math.min(W, H) * 0.14))
      const t = ((now - t0) / 1000) * (reduce ? 0.3 : 1)
      if (doneRef.current && !doneAt) doneAt = now
      const end = doneAt ? ease((now - doneAt) / 650) : 0

      // the nearest cover that wasn't picked lately is picked
      if (!doneAt && now - lastPick > PICK_EVERY) {
        let best: Body | null = null
        let bestZ = Infinity
        for (const b of all) {
          if (!b.src || recent.includes(b)) continue
          const a = b.phase + t * b.speed
          const z = Math.sin(a) * b.r
          if (z < bestZ) {
            bestZ = z
            best = b
          }
        }
        if (best) {
          lastPick = now
          if (!reduce) best.pickedAt = now
          recent.push(best)
          if (recent.length > 8) recent.shift()
          tint(best.src)
        }
      }

      for (const b of all) {
        const el = b.el
        if (!el) continue
        if (!b.src) give(b)
        if (!b.src) {
          el.style.opacity = '0'
          continue
        }
        const a = b.phase + t * b.speed
        // a new cover while it's behind the others, once per lap
        const lap = Math.floor((a + Math.PI / 2) / (Math.PI * 2))
        const z = Math.sin(a) * b.r
        if (z > 0.75 * b.r && lap !== b.lap && !b.pickedAt) {
          b.lap = lap
          if (Math.random() < 0.6) give(b)
        }
        // the orbit in 3D, seen from a little above and tilted
        const x3 = Math.cos(a) * b.r * R
        const z3 = z * R
        const y3 = b.y * R + z3 * 0.22
        const persp = 1900 / (1900 + z3)
        // the whole orbit leans a little
        let x = (x3 * TILT_COS - y3 * TILT_SIN) * persp
        let y = (x3 * TILT_SIN + y3 * TILT_COS) * persp
        let size = cover * persp * (0.75 + b.r * 0.3)
        let depth = 1 - (z / b.r + 1) / 2 // 1 = nearest
        let zi = Math.round(1000 - z3)
        let op = 0.25 + depth * 0.75
        let rot = Math.cos(a) * -14
        // picked: to the middle, hold, back
        if (b.pickedAt) {
          const e = now - b.pickedAt
          const k = e < PICK_IN ? easeInOut(e / PICK_IN) : e < PICK_IN + PICK_HOLD ? 1 : 1 - easeInOut((e - PICK_IN - PICK_HOLD) / PICK_OUT)
          if (e > PICK_IN + PICK_HOLD + PICK_OUT) b.pickedAt = 0
          const big = Math.min(W, H) * 0.3
          const hold = e > PICK_IN && e < PICK_IN + PICK_HOLD ? Math.sin(((e - PICK_IN) / PICK_HOLD) * Math.PI) * 6 : 0
          x = x * (1 - k)
          y = y * (1 - k) - hold
          size = size + (big - size) * k
          rot = rot * (1 - k)
          op = op + (1 - op) * k
          depth = depth + (1 - depth) * k
          zi = k > 0.02 ? 5000 : zi
          el.classList.toggle('is-picked', k > 0.5)
        } else if (el.classList.contains('is-picked')) el.classList.remove('is-picked')
        // the end: everything falls into the middle
        if (end) {
          x *= 1 - end
          y *= 1 - end
          size *= 1 - end * 0.7
          op *= 1 - end
        }
        const s = size / 200
        el.style.transform = `translate3d(${(cx + x - 100).toFixed(1)}px, ${(cy + y - 100).toFixed(1)}px, 0) rotate(${rot.toFixed(2)}deg) scale(${s.toFixed(3)})`
        el.style.opacity = op.toFixed(3)
        el.style.zIndex = String(zi)
        el.style.setProperty('--dim', (0.62 * (1 - depth)).toFixed(3))
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="mixorbit" ref={root} aria-hidden="true">
      <div className="mixorbit__wash" />
      {bodies.current.map((b, i) => (
        <div
          key={i}
          className="mixorbit__cover"
          ref={(el) => {
            b.el = el
          }}
        >
          <img alt="" draggable={false} src={b.src || undefined} />
          <i />
        </div>
      ))}
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
            transition={{
              delay: 0.15,
              type: 'spring',
              stiffness: 180,
              damping: 22
            }}
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
              transition={{
                delay: 0.25 + Math.min(i, 14) * 0.03,
                duration: 0.3
              }}
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
