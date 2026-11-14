// The full-screen show while a mix is made: your songs slide past on a belt, each one is looked
// at under the light, and the ones that fit are tossed down into a box (the new playlist); the
// rest roll on. When the mix is ready the box closes and opens up as the playlist: its cover,
// name and buttons, with the songs listed right below. Covers keep their distance on the belt
// and a picked one leaves downwards before the next arrives, so nothing slides over anything.
// Esc or the cross closes the show; the mix keeps being made and shows up on the page as usual.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { CloseIcon, PlayIcon, PlusIcon } from './Icons'
import { formatTime } from '@/lib/format'

/** The show runs at least this long, so a quick mix still gets its moment. */
const MIN_SHOW_MS = 2600
/** Songs tossed into the box once the mix is known, before it closes. */
const FINAL_PICKS = 6

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
  /** Songs to look through while the mix is made (from the pool once it's read). */
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
  /** The belt has tossed its last songs and the box has closed. */
  const [packed, setPacked] = useState(false)

  useEffect(() => {
    if (!open) return
    setOpenedAt(Date.now())
    setPacked(false)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // a failed mix (nothing fit) closes the show; the page explains why
  useEffect(() => {
    if (open && failed) onClose()
  }, [open, failed, onClose])

  if (!open) return null
  const done = !!result && packed
  return createPortal(
    <div className={`mixshow ${done ? 'is-done' : ''}`} role="dialog" aria-label="Making your mix">
      <div className="mixshow__bg" aria-hidden="true" />
      <button className="mixshow__close icon-btn" aria-label="Close (the mix keeps going)" title="Close (Esc)" onClick={onClose}>
        <CloseIcon size={22} />
      </button>
      {!done && <Belt items={items} result={result} openedAt={openedAt} onPacked={() => setPacked(true)} />}
      {done && result && <Reveal result={result} onPlay={onPlay} onPlayAt={onPlayAt} onSave={onSave} onClose={onClose} saving={saving} />}
    </div>,
    document.body
  )
}

interface Slot {
  el: HTMLDivElement | null
  img: HTMLImageElement | null
  x: number
  song: MixSong | null
  /** 'belt' moving along, 'drop' falling into the box, 'gone' waiting to come back on the right */
  state: 'belt' | 'drop' | 'gone'
  /** this one goes into the box when it reaches the light */
  pick: boolean
  /** passed the light without being picked */
  skipped: boolean
  /** one of the finished mix's own songs */
  final: boolean
  dropAt: number
}

/** The belt, the light and the box. Positions are written straight to the DOM every frame. */
function Belt({
  items,
  result,
  openedAt,
  onPacked
}: {
  items: MixSong[]
  result: MixMakerResult | null
  openedAt: number
  onPacked: () => void
}): React.JSX.Element {
  const stage = useRef<HTMLDivElement>(null)
  const slots = useRef<Slot[]>([])
  const itemsRef = useRef(items)
  itemsRef.current = items
  const resultRef = useRef(result)
  resultRef.current = result
  const packedRef = useRef(onPacked)
  packedRef.current = onPacked
  const [inspect, setInspect] = useState<{ song: MixSong; pick: boolean; n: number } | null>(null)
  const [count, setCount] = useState(0)
  const [closing, setClosing] = useState(false)

  if (slots.current.length === 0) {
    slots.current = Array.from({ length: 20 }, () => ({ el: null, img: null, x: 0, song: null, state: 'gone', pick: false, skipped: false, final: false, dropAt: 0 }))
  }

  useEffect(() => {
    const el = stage.current!
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    let last = performance.now()
    let w = 0
    let h = 0
    let size = 120
    let pitch = 150
    let laneY = 0
    let boxY = 0
    let started = false
    let next = 0 // index into items
    let finalPicks = 0 // result songs put on the belt
    let finalSkips = 0
    let finalIn = 0 // result songs that landed in the box
    let resultIndex = 0
    let ended = 0 // when the last song went into the box
    let inspected = 0

    const measure = (): void => {
      w = el.clientWidth
      h = el.clientHeight
      size = Math.round(Math.max(88, Math.min(140, w * 0.085)))
      pitch = size + Math.round(size * 0.24)
      laneY = Math.round(h * 0.3)
      boxY = Math.round(h * 0.66)
      el.style.setProperty('--card', `${size}px`)
      el.style.setProperty('--lane', `${laneY}px`)
      el.style.setProperty('--box', `${boxY}px`)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)

    /** What comes onto the belt next: before the mix is known, songs from the pool (some get
     *  picked); after, the mix's own songs go in, with a few others rolling past. */
    const feed = (s: Slot): void => {
      const res = resultRef.current
      const list = itemsRef.current
      s.skipped = false
      s.final = false
      if (res && res.tracks.length) {
        const wantPick = finalPicks < Math.min(FINAL_PICKS, res.tracks.length) && (finalSkips >= 2 || (finalPicks + finalSkips) % 3 !== 2)
        if (wantPick) {
          const t = res.tracks[resultIndex++ % res.tracks.length]
          s.song = t
          s.pick = true
          s.final = true
          finalPicks++
        } else if (finalPicks < Math.min(FINAL_PICKS, res.tracks.length)) {
          s.song = list.length ? list[Math.floor(Math.random() * list.length)] : null
          s.pick = false
          finalSkips++
        } else {
          s.song = null // the belt runs empty after the last song
          s.pick = false
        }
      } else if (list.length) {
        s.song = list[next++ % list.length]
        s.pick = Math.random() < 0.42
      } else {
        s.song = null
        s.pick = false
      }
      if (s.img) {
        const src = s.song?.image ?? ''
        if (src) {
          if (s.img.getAttribute('src') !== src) s.img.src = src
          s.img.style.visibility = 'visible'
        } else s.img.style.visibility = 'hidden'
      }
      if (s.el) s.el.classList.toggle('is-blank', !s.song)
    }

    const frame = (now: number): void => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (document.hidden) return
      const res = resultRef.current
      const speed = pitch * (res ? 2.4 : 1.5) * (reduce ? 0.5 : 1)
      const centre = w / 2
      if (!started) {
        // fill the belt from the right edge to just past the left one
        started = true
        slots.current.forEach((s, i) => {
          s.x = centre + pitch * (i - 8)
          s.state = 'belt'
          feed(s)
          // the first ones start out past the light, already looked at
          if (s.x < centre) {
            s.skipped = true
            s.pick = false
          }
        })
      }
      const rightmost = Math.max(...slots.current.map((s) => (s.state === 'gone' ? -Infinity : s.x)), centre)
      let refill = rightmost
      for (const s of slots.current) {
        const card = s.el
        if (!card) continue
        if (s.state === 'belt') {
          const before = s.x
          s.x -= speed * dt
          // reaching the light: the one to keep is tossed down into the box
          if (before >= centre && s.x < centre && s.song) {
            inspected++
            setInspect({ song: s.song, pick: s.pick, n: inspected })
            if (s.pick) {
              s.state = 'drop'
              s.dropAt = now
              s.x = centre
            } else s.skipped = true
          }
          if (s.x < -size) {
            // off the left edge: back in line on the right
            refill += pitch
            s.x = refill
            feed(s)
          }
          const lit = Math.max(0, 1 - Math.abs(s.x - centre) / (pitch * 0.6))
          const sc = 1 + lit * 0.14
          card.style.transform = `translate3d(${(s.x - size / 2).toFixed(1)}px, ${(laneY - size / 2).toFixed(1)}px, 0) scale(${sc.toFixed(3)})`
          card.style.opacity = s.song ? (s.skipped ? '0.45' : '1') : '0.18'
          card.style.zIndex = '2'
        } else if (s.state === 'drop') {
          // a quick toss: away from the belt at once, slowing into the box
          const u = Math.min(1, (now - s.dropAt) / 520)
          const e = 1 - (1 - u) * (1 - u)
          const y = laneY + (boxY + size * 0.15 - laneY) * e
          const sc = (1.14 - 0.5 * e).toFixed(3)
          const rot = (Math.sin(s.dropAt) * 14 * e).toFixed(1)
          card.style.transform = `translate3d(${(centre - size / 2).toFixed(1)}px, ${(y - size / 2).toFixed(1)}px, 0) rotate(${rot}deg) scale(${sc})`
          card.style.opacity = u > 0.85 ? String(Math.max(0, (1 - u) / 0.15)) : '1'
          if (u >= 1) {
            s.state = 'gone'
            if (s.final) finalIn++
            setCount((c) => c + 1)
            if (res && finalIn >= Math.min(FINAL_PICKS, res.tracks.length) && !slots.current.some((x) => x.state === 'drop')) ended = now
          }
        } else {
          card.style.opacity = '0'
          // wait for a gap on the right, then get back on the belt
          if (refill + pitch < w + pitch * 2) {
            refill += pitch
            s.x = refill
            s.state = 'belt'
            feed(s)
          }
        }
      }
      // all of the mix's songs are in: close the box, then open the playlist
      if (ended && now - ended > 250 && Date.now() - openedAt > MIN_SHOW_MS) {
        ended = 0
        setClosing(true)
        if (res) setCount(res.songs)
        window.setTimeout(() => packedRef.current(), 900)
      }
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
    // the belt runs for as long as the show is open; items and result are read through refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div ref={stage} className={`mixbelt ${closing ? 'is-closing' : ''}`} aria-hidden="true">
      <span className="mixbelt__light" />
      <span className="mixbelt__rail" />
      {slots.current.map((s, i) => (
        <div
          key={i}
          className="mixbelt__card is-blank"
          ref={(el) => {
            s.el = el
          }}
        >
          <img
            alt=""
            decoding="async"
            draggable={false}
            ref={(img) => {
              s.img = img
            }}
          />
        </div>
      ))}
      <div className="mixbelt__label">
        <AnimatePresence mode="popLayout" initial={false}>
          {inspect ? (
            <motion.div
              key={inspect.n}
              className={`mixbelt__song ${inspect.pick ? 'is-pick' : ''}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
            >
              <span className="mixbelt__verdict">{inspect.pick ? '✓' : '–'}</span>
              <span>
                <b>{inspect.song.name}</b>
                <small>{inspect.song.artist}</small>
              </span>
            </motion.div>
          ) : (
            <motion.div key="reading" className="mixbelt__song" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <span>
                <b>Reading your library…</b>
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="mixbox">
        <span className="mixbox__back" />
        <span className="mixbox__flap mixbox__flap--l" />
        <span className="mixbox__flap mixbox__flap--r" />
        <span className="mixbox__front">
          <small>{result ? result.name : 'Your new mix'}</small>
          <motion.b key={count} initial={{ scale: 1.25 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 18 }}>
            {count}
          </motion.b>
          <i>{count === 1 ? 'song' : 'songs'} in</i>
        </span>
      </div>
    </div>
  )
}

/** The box opens up as the playlist: cover, name and buttons, and the songs right below. */
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
