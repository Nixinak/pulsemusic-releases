// Smooth scrolling helpers: eased mouse-wheel scrolling, click-and-drag rows with inertia,
// and a flag while the main view scrolls.
import { useEffect, type RefObject } from 'react'

const reduced = (): boolean =>
  document.documentElement.classList.contains('reduce-motion') ||
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Eases mouse-wheel scrolling: each notch moves a target and the view glides toward it.
 * Precision touchpads already scroll smoothly, so small pixel deltas pass straight through.
 */
export function useSmoothWheel(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let target = el.scrollTop
    let raf = 0
    let animating = false

    const step = (): void => {
      const diff = target - el.scrollTop
      if (Math.abs(diff) < 0.5) {
        el.scrollTop = target
        animating = false
        return
      }
      el.scrollTop += diff * 0.16
      raf = requestAnimationFrame(step)
    }

    const onWheel = (e: WheelEvent): void => {
      if (e.ctrlKey || e.shiftKey || reduced()) return
      // Let nested scroll areas (lyrics, menus, drawers) scroll themselves.
      const inner = (e.target as HTMLElement).closest('[data-own-scroll]')
      if (inner && inner !== el) return
      const delta = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY
      // Touchpads send many tiny deltas and are already smooth.
      if (Math.abs(delta) < 40 && e.deltaMode === 0 && !animating) return
      e.preventDefault()
      if (!animating) target = el.scrollTop
      target = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, target + delta))
      if (!animating) {
        animating = true
        raf = requestAnimationFrame(step)
      }
    }

    // Keep the target in sync when something else scrolls (keyboard, scrollTo, scrollbar).
    const onScroll = (): void => {
      if (!animating) target = el.scrollTop
    }

    // A new page: stop any glide still heading for a spot on the old page.
    const onReset = (): void => {
      cancelAnimationFrame(raf)
      animating = false
      target = 0
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('pulse:scroll-reset', onReset)
    return () => {
      el.removeEventListener('pulse:scroll-reset', onReset)
      cancelAnimationFrame(raf)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('scroll', onScroll)
    }
  }, [ref])
}

/** Click-and-drag horizontal scrolling with momentum (no motion blur). With `loop` (the width
 *  of one copy of the row's cards, the row holding three copies), the row has no ends: it
 *  jumps by one copy whenever it leaves the middle one, which looks seamless. */
export function useDragScroll(ref: RefObject<HTMLElement | null>, loop?: RefObject<number>): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    /** Keeps the view in the middle copy; returns the jump made. */
    const wrap = (): number => {
      const w = loop?.current ?? 0
      if (w <= 0) return 0
      if (el.scrollLeft < w * 0.5) {
        el.scrollLeft += w
        return w
      }
      if (el.scrollLeft > w * 1.5) {
        el.scrollLeft -= w
        return -w
      }
      return 0
    }
    let down = false
    let moved = false
    let startX = 0
    let startScroll = 0
    let lastX = 0
    let lastT = 0
    let velocity = 0 // px per ms
    let raf = 0

    const glide = (): void => {
      let last = performance.now()
      const frame = (now: number): void => {
        const dt = Math.min(32, now - last)
        last = now
        el.scrollLeft -= velocity * dt
        wrap()
        velocity *= Math.pow(0.94, dt / 16)
        const atEdge = !(loop?.current ?? 0) && (el.scrollLeft <= 0 || el.scrollLeft >= el.scrollWidth - el.clientWidth - 1)
        if (Math.abs(velocity) > 0.02 && !atEdge) raf = requestAnimationFrame(frame)
        else {
          velocity = 0
          el.classList.remove('is-dragging')
        }
      }
      raf = requestAnimationFrame(frame)
    }

    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0 || e.pointerType === 'touch') return
      cancelAnimationFrame(raf)
      down = true
      moved = false
      startX = lastX = e.clientX
      startScroll = el.scrollLeft
      lastT = performance.now()
      velocity = 0
    }

    const onMove = (e: PointerEvent): void => {
      if (!down) return
      const dx = e.clientX - startX
      if (!moved && Math.abs(dx) > 5) {
        moved = true
        el.classList.add('is-dragging')
        el.setPointerCapture(e.pointerId)
      }
      if (!moved) return
      el.scrollLeft = startScroll - dx
      startScroll += wrap()
      const now = performance.now()
      const dt = Math.max(1, now - lastT)
      // Smoothed velocity so a jittery mouse doesn't throw the row around.
      velocity = velocity * 0.6 + ((e.clientX - lastX) / dt) * 0.4
      lastX = e.clientX
      lastT = now
    }

    const onUp = (e: PointerEvent): void => {
      if (!down) return
      down = false
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      if (moved && performance.now() - lastT < 80) glide()
      else {
        el.classList.remove('is-dragging')
      }
    }

    // A drag must not also count as a click on the card under the pointer.
    const onClick = (e: MouseEvent): void => {
      if (moved) {
        e.stopPropagation()
        e.preventDefault()
        moved = false
      }
    }

    // Soft fade on the side(s) where more cards are hidden.
    const edges = (): void => {
      if (loop?.current) {
        wrap()
        el.classList.add('fade-left', 'fade-right')
        return
      }
      el.classList.toggle('fade-left', el.scrollLeft > 2)
      el.classList.toggle('fade-right', el.scrollLeft < el.scrollWidth - el.clientWidth - 2)
    }
    edges()
    const ro = new ResizeObserver(edges)
    ro.observe(el)
    el.addEventListener('scroll', edges, { passive: true })

    // A vertical wheel over the row still scrolls the page; Shift+wheel scrolls the row.
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    el.addEventListener('click', onClick, true)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      el.removeEventListener('scroll', edges)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('click', onClick, true)
    }
  }, [ref, loop])
}

/** Marks the document while the main view is scrolling, so heavy effects can pause. */
export function useScrollingFlag(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let t = 0
    const root = document.documentElement
    const onScroll = (): void => {
      root.classList.add('is-scrolling')
      clearTimeout(t)
      t = window.setTimeout(() => root.classList.remove('is-scrolling'), 180)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      clearTimeout(t)
      el.removeEventListener('scroll', onScroll)
      root.classList.remove('is-scrolling')
    }
  }, [ref])
}
