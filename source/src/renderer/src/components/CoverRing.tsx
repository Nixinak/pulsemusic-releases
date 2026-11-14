// The home page's cover carousel: artwork fanned on a curve around the centre card, drifting
// slowly and looping forever (there is no first or last card). Drag, scroll sideways or use the
// arrow keys to move it; click a side card to bring it to the middle, click the middle one to
// open it. Positions are written straight to the DOM every frame, so React never re-renders
// while it moves, and there is no motion blur.
import { Emo } from './Emoji'
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Cover } from './common'
import { PlayIcon } from './Icons'

export interface RingItem {
  key: string
  image: string | null
  title: string
  subtitle: string
  onOpen: () => void
  onPlay: () => void
  onContextMenu?: (e: React.MouseEvent) => void
}

/** Most cards drawn on each side of the centre (fewer when the row is narrow). */
const MAX_SIDE = 11
/** Length of the opening spread, in seconds. */
const INTRO = 1.1
/** Drift while nobody touches it, in cards per second. */
const DRIFT = 0.11

const reduced = (): boolean =>
  document.documentElement.classList.contains('reduce-motion') || window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Wraps a distance in cards to the shortest way round a loop of `n`. */
const wrap = (d: number, n: number): number => ((((d + n / 2) % n) + n) % n) - n / 2

export function CoverRing({ items, onFocus }: { items: RingItem[]; onFocus?: (item: RingItem) => void }): React.JSX.Element | null {
  // Few items still need a full loop: repeat them.
  const loop = items.length === 0 ? [] : Array.from({ length: Math.max(1, Math.ceil(16 / items.length)) }, () => items).flat()
  const n = loop.length
  const stage = useRef<HTMLDivElement>(null)
  const cards = useRef<(HTMLDivElement | null)[]>([])
  const motionState = useRef({ offset: 0, velocity: 0, target: null as number | null, hover: false, drag: false })
  const [focus, setFocus] = useState(0)
  const focusRef = useRef(0)
  const onFocusRef = useRef(onFocus)
  onFocusRef.current = onFocus
  const played = useRef(false)

  // tell the page which cover is in the middle (it tints the background with it)
  useEffect(() => {
    const it = loop[focus]
    if (it) onFocusRef.current?.(it)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, n])

  useEffect(() => {
    if (!n) return
    const el = stage.current!
    let raf = 0
    let last = performance.now()
    const m = motionState.current
    // the cards fan out from the middle the first time the ring appears
    let intro = played.current || reduced() ? 1 : 0
    played.current = true
    let visible = true
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting))
    io.observe(el)

    const layout = (): void => {
      const w = el.clientWidth
      // card width follows the stage, the spacing follows the card
      const card = Math.max(120, Math.min(240, w / 6.4))
      // wide windows spread the cards further and sink them less, so the ring fills the width
      const spread = Math.max(1, Math.min(1.9, w / 1300))
      const gap = card * 0.6 * spread
      const depth = 0.4 / spread
      const side = Math.min(MAX_SIDE, Math.ceil((w / 2 - card) / (gap * 0.7)) + 1)
      el.style.setProperty('--ring-card', `${card}px`)
      const t = 1 - Math.pow(1 - intro, 3)
      for (let i = 0; i < n; i++) {
        const c = cards.current[i]
        if (!c) continue
        const d = wrap(i - m.offset, n)
        const a = Math.abs(d)
        if (a > side + 0.5) {
          c.style.visibility = 'hidden'
          continue
        }
        c.style.visibility = 'visible'
        // the curve: cards spread out, turn towards the middle and sink back the further they are
        const x = Math.sign(d) * (a < 1 ? a * card * 0.92 : card * 0.92 + (a - 1) * gap * (1 - Math.min(0.35, (a - 1) * 0.04)))
        const ry = -Math.sign(d) * Math.min(62, a * 22 + (a > 1 ? 18 : 0) * Math.min(1, a - 1))
        const z = -Math.pow(a, 1.2) * card * depth
        const s = (1 + Math.max(0, 1 - a) * 0.28) * (0.7 + 0.3 * t)
        c.style.transform = `translate3d(${(x * t).toFixed(1)}px, 0, ${(z * t).toFixed(1)}px) rotateY(${(ry * t).toFixed(2)}deg) scale(${s.toFixed(3)})`
        c.style.zIndex = String(100 - Math.round(a * 10))
        c.style.opacity = String(Math.max(0, Math.min(1, side + 0.5 - a)) * Math.min(1, t * 1.6 - a * 0.04 * (1 - t)))
        c.classList.toggle('is-centre', a < 0.5)
      }
      const f = ((Math.round(m.offset) % n) + n) % n
      if (f !== focusRef.current) {
        focusRef.current = f
        setFocus(f)
      }
    }

    const frame = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      raf = requestAnimationFrame(frame)
      // nothing to draw while scrolled away or minimised
      if (!visible || document.hidden) return
      if (intro < 1) intro = Math.min(1, intro + dt / INTRO)
      if (!m.drag) {
        if (m.target !== null) {
          m.offset += (m.target - m.offset) * (1 - Math.exp(-dt * 9))
          if (Math.abs(m.target - m.offset) < 0.001) {
            m.offset = m.target
            m.target = null
          }
        } else if (Math.abs(m.velocity) > 0.05) {
          m.offset += m.velocity * dt
          m.velocity *= Math.exp(-dt * 3.2)
          if (Math.abs(m.velocity) <= 0.05) m.target = Math.round(m.offset)
        } else if (m.hover || reduced() || intro < 1) {
          // settle on the nearest card while the pointer rests here
          if (Math.abs(m.offset - Math.round(m.offset)) > 0.001) m.target = Math.round(m.offset)
        } else {
          m.offset += DRIFT * dt
        }
      }
      layout()
    }
    layout()
    raf = requestAnimationFrame(frame)

    /* ---- input ---- */
    let startX = 0
    let startOffset = 0
    let lastX = 0
    let lastT = 0
    let moved = false
    const unit = (): number => Math.max(120, Math.min(210, el.clientWidth / 6.2)) * 0.62

    const down = (e: PointerEvent): void => {
      if (e.button !== 0) return
      m.drag = true
      m.target = null
      m.velocity = 0
      moved = false
      startX = lastX = e.clientX
      lastT = performance.now()
      startOffset = m.offset
    }
    const move = (e: PointerEvent): void => {
      if (!m.drag) return
      const dx = e.clientX - startX
      if (!moved && Math.abs(dx) > 5) {
        moved = true
        el.setPointerCapture(e.pointerId)
        el.classList.add('is-dragging')
      }
      if (!moved) return
      m.offset = startOffset - dx / unit()
      const now = performance.now()
      const dt = Math.max(1, now - lastT) / 1000
      m.velocity = m.velocity * 0.5 + (-(e.clientX - lastX) / unit() / dt) * 0.5
      lastX = e.clientX
      lastT = now
    }
    const up = (e: PointerEvent): void => {
      if (!m.drag) return
      m.drag = false
      el.classList.remove('is-dragging')
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      if (moved) {
        if (performance.now() - lastT > 90) m.velocity = 0
        m.velocity = Math.max(-14, Math.min(14, m.velocity))
        if (Math.abs(m.velocity) <= 0.05) m.target = Math.round(m.offset)
        return
      }
      // a click: the middle card opens, a side card comes to the middle
      const card = (e.target as HTMLElement).closest<HTMLElement>('[data-ring]')
      if (!card || (e.target as HTMLElement).closest('button')) return
      const i = Number(card.dataset.ring)
      const d = wrap(i - m.offset, n)
      if (Math.abs(d) < 0.5) loop[i]?.onOpen()
      else m.target = m.offset + d
    }
    const wheel = (e: WheelEvent): void => {
      // sideways scrolling (touchpad, Shift+wheel) moves the ring; up and down still scroll the page
      const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0
      if (!dx) return
      e.preventDefault()
      m.target = null
      m.velocity = 0
      m.offset += dx / unit() / 1.5
      window.clearTimeout(wheelEnd)
      wheelEnd = window.setTimeout(() => (m.target = Math.round(m.offset)), 140)
    }
    let wheelEnd = 0
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault()
        const base = m.target ?? Math.round(m.offset)
        m.target = base + (e.key === 'ArrowRight' ? 1 : -1)
      } else if (e.key === 'Enter') loop[((Math.round(m.offset) % n) + n) % n]?.onOpen()
    }
    const enter = (): void => void (m.hover = true)
    const leave = (): void => void (m.hover = false)
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('keydown', key)
    el.addEventListener('pointerenter', enter)
    el.addEventListener('pointerleave', leave)
    return () => {
      cancelAnimationFrame(raf)
      io.disconnect()
      window.clearTimeout(wheelEnd)
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('keydown', key)
      el.removeEventListener('pointerenter', enter)
      el.removeEventListener('pointerleave', leave)
    }
    // the loop is rebuilt when the items change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, items])

  if (!n) return null
  const current = loop[focus]
  return (
    <section className="ring">
      <div ref={stage} className="ring__stage" tabIndex={0} role="listbox" aria-label="Recently played" aria-activedescendant={`ring-${focus}`}>
        {loop.map((it, i) => (
          <div
            key={`${it.key}-${i}`}
            id={`ring-${i}`}
            ref={(el) => {
              cards.current[i] = el
            }}
            className="ring__card"
            data-ring={i}
            role="option"
            aria-selected={i === focus}
            aria-label={`${it.title}, ${it.subtitle}`}
            onContextMenu={it.onContextMenu}
          >
            <Cover src={it.image} radius={18} />
          </div>
        ))}
      </div>
      <div className="ring__caption">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={current?.key ?? 'none'}
            className="ring__text"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22 }}
          >
            <button className="ring__title" onClick={() => current?.onOpen()}>
              <Emo>{current?.title}</Emo>
            </button>
            <span className="ring__sub">{current?.subtitle}</span>
          </motion.div>
        </AnimatePresence>
        <button className="play-fab ring__play" aria-label={`Play ${current?.title ?? ''}`} onClick={() => current?.onPlay()}>
          <PlayIcon size={22} />
        </button>
      </div>
    </section>
  )
}
