// The full-screen show while a mix is made: covers from your library are shuffled like a deck of
// cards (split in two, riffled back together, squared up, again with new covers on top), then the
// new playlist opens: its cover, name and buttons, with the songs listed right below. Esc or the
// cross closes the show; the mix keeps being made and shows up on the page.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { CloseIcon, PlayIcon, PlusIcon } from './Icons'
import { formatTime } from '@/lib/format'

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
    <div className={`mixshow mixshow--deck ${done ? 'is-done' : ''}`} role="dialog" aria-label="Making your mix">
      <div className="mixshow__bg" aria-hidden="true" />
      <Deck images={images} done={done} />
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

/** How many cards are in the deck. */
const CARDS = 26
/** One shuffle (split, riffle, square up), in seconds. */
const ROUND = 2.6
const ease = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.pow(1 - x, 3))
const easeInOut = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)

/**
 * The deck: covers stacked in the middle, cut into two halves that slide apart, riffled back
 * together one by one in an arc, squared up with a little bounce, and after each round a few new
 * covers go on top. When the mix is ready the cards fly out in a ring and fade.
 */
function Deck({ images, done }: { images: string[]; done: boolean }): React.JSX.Element {
  const list = useMemo(() => images.filter(Boolean), [images])
  const ready = useRef<string[]>([])
  const cards = useRef<{ el: HTMLDivElement | null; src: string }[]>(Array.from({ length: CARDS }, () => ({ el: null, src: '' })))
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
  const give = (c: { el: HTMLDivElement | null; src: string }): void => {
    const l = ready.current
    if (!l.length) return
    const u = l[Math.floor(Math.random() * l.length)]
    c.src = u
    const img = c.el?.querySelector('img')
    if (img && img.getAttribute('src') !== u) img.src = u
  }

  useEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    const t0 = performance.now()
    let round = -1
    let doneAt = 0
    // the order of the stack (bottom first); a riffle interleaves the two halves
    let order = Array.from({ length: CARDS }, (_, i) => i)
    const loop = (now: number): void => {
      raf = requestAnimationFrame(loop)
      const all = cards.current
      for (const c of all) if (!c.src) give(c)
      const time = ((now - t0) / 1000) * (reduce ? 0.4 : 1)
      const r = Math.floor(time / ROUND)
      const t = (time % ROUND) / ROUND
      if (r !== round) {
        round = r
        // a new round: the riffled order becomes the stack, a few new covers go on top
        if (r > 0) {
          const left = order.filter((_, k) => k % 2 === 0)
          const right = order.filter((_, k) => k % 2 === 1)
          const next: number[] = []
          for (let k = 0; k < Math.max(left.length, right.length); k++) {
            if (left[k] !== undefined) next.push(left[k])
            if (right[k] !== undefined) next.push(right[k])
          }
          order = next
          for (const idx of order.slice(-5)) give(all[idx])
        }
      }
      if (doneRef.current && !doneAt) doneAt = now
      const out = doneAt ? ease((now - doneAt) / 700) : 0
      const n = order.length
      order.forEach((idx, pos) => {
        const el = all[idx].el
        if (!el || !all[idx].src) {
          if (el) el.style.opacity = '0'
          return
        }
        const side = pos < n / 2 ? -1 : 1
        const inHalf = side < 0 ? pos : pos - Math.floor(n / 2)
        // 1. the cut: the halves slide apart and tilt
        const cut = easeInOut(t / 0.3)
        // 2. the riffle: cards drop back in from alternating halves, bottom first
        const riffleOrder = side < 0 ? inHalf * 2 : inHalf * 2 + 1
        const start = 0.34 + (riffleOrder / n) * 0.36
        const back = easeInOut((t - start) / 0.14)
        // 3. squared up, with a small bounce
        const bounce = t > 0.82 ? Math.sin(((t - 0.82) / 0.18) * Math.PI) * 0.04 : 0
        const sx = side * 210 * cut * (1 - back)
        const lift = Math.sin(back * Math.PI) * 70
        const stackY = -(back > 0 ? riffleOrder : pos) * 1.6
        const y = stackY - inHalf * 1.2 * cut * (1 - back) - lift
        const rot = side * 9 * cut * (1 - back) + side * 4 * Math.sin(back * Math.PI)
        // the end: out in a ring
        const a = (pos / n) * Math.PI * 2
        const fx = Math.cos(a) * 900 * out
        const fy = Math.sin(a) * 600 * out
        el.style.transform = `translate3d(${(sx + fx).toFixed(1)}px, ${(y + fy).toFixed(1)}px, 0) rotate(${(rot + out * 90).toFixed(2)}deg) scale(${(1 + bounce).toFixed(3)})`
        el.style.opacity = String(1 - out)
        // cards that are back on the stack lie above the ones still in the halves
        el.style.zIndex = String(back > 0 ? 100 + riffleOrder : 50 - Math.abs(inHalf - n / 4))
      })
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="mixdeck" aria-hidden="true">
      <div className="mixdeck__table">
        {cards.current.map((c, i) => (
          <div
            key={i}
            className="mixdeck__card"
            ref={(el) => {
              c.el = el
            }}
          >
            <img alt="" draggable={false} src={c.src || undefined} />
          </div>
        ))}
      </div>
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
