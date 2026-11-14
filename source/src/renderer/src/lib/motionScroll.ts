// Smooth scrolling helpers: click-and-drag rows with inertia. The mouse wheel is left to
// Chromium: its own smooth scrolling runs off the main thread (it keeps gliding even while
// the page is busy), which the old eased wheel handler here couldn't do, because it had to
// catch every wheel event on the main thread first.
import { useEffect, type RefObject } from 'react'

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
