// Slow background motion (the drifting colour blobs, the turning artwork) at a low frame rate.
// Glass panels refract whatever is behind them, so while the background moves they are redrawn
// every frame. The drift is so slow (a few pixels a second) that 15 updates a second look the
// same as 60, and the glass is redrawn a quarter as often.
import { useEffect, type RefObject } from 'react'

export interface DriftSpec {
  /** Where it ends up: x and y in vmax, and the scale. */
  to?: [number, number, number]
  /** Seconds for one way. */
  seconds: number
  /** Start at the far end (like animation-direction: alternate-reverse). */
  reverse?: boolean
  /** Turn instead: a full turn in `seconds`. */
  spin?: boolean
}

interface Item {
  el: HTMLElement
  spec: DriftSpec
  start: number
}

const items = new Set<Item>()
let timer = 0
const FPS = 15

const reduced = (): boolean =>
  document.documentElement.classList.contains('reduce-motion') || window.matchMedia('(prefers-reduced-motion: reduce)').matches

function place(it: Item, now: number): void {
  const { spec } = it
  const t = (now - it.start) / 1000 / spec.seconds
  if (spec.spin) {
    it.el.style.transform = `rotate(${(((t % 1) + 1) % 1) * 360}deg)`
    return
  }
  const [x, y, s] = spec.to ?? [0, 0, 1]
  // back and forth, easing in and out at both ends
  let u = ((t % 2) + 2) % 2
  if (u > 1) u = 2 - u
  if (spec.reverse) u = 1 - u
  const e = 0.5 - 0.5 * Math.cos(Math.PI * u)
  it.el.style.transform = `translate3d(${(x * e).toFixed(3)}vmax, ${(y * e).toFixed(3)}vmax, 0) scale(${(1 + (s - 1) * e).toFixed(4)})`
}

/** The drift's own clock: it stands still while the window is hidden or a page is scrolling
 *  (the glass has enough to redraw then), so nothing jumps when it carries on. */
let clock = 0
let lastTick = performance.now()

function tick(): void {
  const now = performance.now()
  const dt = Math.min(250, now - lastTick)
  lastTick = now
  if (document.hidden || reduced() || document.documentElement.classList.contains('is-scrolling')) return
  clock += dt
  for (const it of items) place(it, clock)
}

/** Moves `el` slowly until the returned function is called. */
export function drift(el: HTMLElement, spec: DriftSpec): () => void {
  // a random start, so the blobs don't all begin at their resting place
  const it: Item = { el, spec, start: clock - Math.random() * spec.seconds * 1000 }
  items.add(it)
  place(it, clock)
  if (!timer) {
    lastTick = performance.now()
    timer = window.setInterval(tick, 1000 / FPS)
  }
  return () => {
    items.delete(it)
    if (!items.size && timer) {
      clearInterval(timer)
      timer = 0
    }
  }
}

export function useDrift(ref: RefObject<HTMLElement | null>, spec: DriftSpec): void {
  const { seconds, reverse, spin } = spec
  const [x, y, s] = spec.to ?? [0, 0, 1]
  useEffect(() => {
    const el = ref.current
    if (!el) return
    return drift(el, { seconds, reverse, spin, to: [x, y, s] })
  }, [ref, seconds, reverse, spin, x, y, s])
}
