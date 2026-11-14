// Drag-to-reorder for long lists without re-rendering while dragging.
// Rows move with GPU transforms only; React sees a single state change on drop, which
// keeps it smooth even for playlists with thousands of songs.
import { useEffect, useRef, type RefObject } from 'react'
import { flushSync } from 'react-dom'

interface Options {
  /** Element that contains the rows (`[data-drag-row]`) and their handles (`[data-drag-handle]`). */
  container: RefObject<HTMLElement | null>
  /** Called once on drop with the old and new index. Applied synchronously. */
  onDrop: (from: number, to: number) => void
  enabled?: boolean
}

const EDGE = 70
const SETTLE_MS = 190

function scrollParent(el: HTMLElement): HTMLElement {
  let n: HTMLElement | null = el.parentElement
  while (n) {
    const o = getComputedStyle(n).overflowY
    if ((o === 'auto' || o === 'scroll') && n.scrollHeight > n.clientHeight) return n
    n = n.parentElement
  }
  return document.scrollingElement as HTMLElement
}

export function useDragReorder({ container, onDrop, enabled = true }: Options): void {
  const dropRef = useRef(onDrop)
  dropRef.current = onDrop
  useEffect(() => {
    const root = container.current
    if (!root || !enabled) return

    let rows: HTMLElement[] = []
    let tops: number[] = []
    let mids: number[] = []
    let shifts: number[] = []
    let from = -1
    let to = -1
    let pitch = 0
    let startY = 0
    let lastClientY = 0
    let scroller: HTMLElement = document.documentElement
    let scrollerRect: DOMRect = new DOMRect()
    let raf = 0
    let pointerId = -1
    let dragging = false
    let handleEl: HTMLElement | null = null

    const contentY = (clientY: number): number => clientY + scroller.scrollTop

    const update = (): void => {
      raf = 0
      if (!dragging) return
      // Scroll when the pointer is near the top or bottom edge.
      const topGap = lastClientY - scrollerRect.top
      // The main page scrolls under the floating player bar, so its bottom zone is taller.
      const bottomGap = scrollerRect.bottom - (scroller.classList.contains('main__scroll') ? 100 : 0) - lastClientY
      let speed = 0
      if (topGap < EDGE) speed = -Math.min(28, Math.ceil(((EDGE - topGap) / EDGE) * 18))
      else if (bottomGap < EDGE) speed = Math.min(28, Math.ceil(((EDGE - bottomGap) / EDGE) * 18))
      if (speed) scroller.scrollTop += speed

      const dy = contentY(lastClientY) - startY
      const dragged = rows[from]
      dragged.style.transform = `translate3d(0, ${dy}px, 0) scale(1.015)`
      const center = mids[from] + dy
      let target = from
      for (let j = from + 1; j < rows.length && center > mids[j]; j++) target = j
      for (let j = from - 1; j >= 0 && center < mids[j]; j--) target = j
      if (target !== to) {
        to = target
        for (let j = 0; j < rows.length; j++) {
          if (j === from) continue
          const shift = from < j && j <= to ? -pitch : to <= j && j < from ? pitch : 0
          if (shift !== shifts[j]) {
            shifts[j] = shift
            rows[j].style.transform = shift ? `translate3d(0, ${shift}px, 0)` : ''
          }
        }
      }
      if (speed) raf = requestAnimationFrame(update)
    }

    const schedule = (): void => {
      if (!raf) raf = requestAnimationFrame(update)
    }

    const cleanup = (): void => {
      for (const r of rows) {
        r.style.transition = 'none'
        r.style.transform = ''
        r.classList.remove('is-lifted')
      }
      // Re-enable transitions after the browser has applied the reset.
      void root.offsetHeight
      for (const r of rows) r.style.transition = ''
      root.classList.remove('is-reordering')
      document.documentElement.classList.remove('is-dragging-row')
      rows = []
    }

    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0) return
      const handle = (e.target as HTMLElement).closest<HTMLElement>('[data-drag-handle]')
      if (!handle || !root.contains(handle)) return
      const row = handle.closest<HTMLElement>('[data-drag-row]')
      if (!row) return
      e.preventDefault()
      rows = Array.from(root.querySelectorAll<HTMLElement>('[data-drag-row]'))
      from = to = rows.indexOf(row)
      if (from < 0) return
      scroller = scrollParent(root)
      scrollerRect =
        scroller === document.scrollingElement
          ? new DOMRect(0, 0, window.innerWidth, window.innerHeight)
          : scroller.getBoundingClientRect()
      const st = scroller.scrollTop
      const rects = rows.map((r) => r.getBoundingClientRect())
      tops = rects.map((r) => r.top + st)
      mids = rects.map((r) => r.top + st + r.height / 2)
      shifts = rows.map(() => 0)
      pitch = rows.length > 1 ? (from + 1 < rows.length ? tops[from + 1] - tops[from] : tops[from] - tops[from - 1]) : rects[from].height
      startY = contentY(e.clientY)
      lastClientY = e.clientY
      pointerId = e.pointerId
      handleEl = handle
      handle.setPointerCapture(e.pointerId)
      dragging = true
      root.classList.add('is-reordering')
      document.documentElement.classList.add('is-dragging-row')
      row.classList.add('is-lifted')
    }

    const onMove = (e: PointerEvent): void => {
      if (!dragging || e.pointerId !== pointerId) return
      lastClientY = e.clientY
      schedule()
    }

    const onUp = (e: PointerEvent): void => {
      if (!dragging || e.pointerId !== pointerId) return
      dragging = false
      cancelAnimationFrame(raf)
      raf = 0
      if (handleEl?.hasPointerCapture(e.pointerId)) handleEl.releasePointerCapture(e.pointerId)
      const dragged = rows[from]
      const finalShift = tops[to] - tops[from]
      dragged.style.transition = `transform ${SETTLE_MS}ms cubic-bezier(.2,.8,.2,1)`
      dragged.style.transform = `translate3d(0, ${finalShift}px, 0)`
      const a = from
      const b = to
      window.setTimeout(() => {
        if (a !== b) flushSync(() => dropRef.current(a, b))
        cleanup()
      }, SETTLE_MS)
    }

    // Keep the dragged row under the pointer while the list scrolls.
    const onScroll = (): void => {
      if (dragging) schedule()
    }

    root.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      cancelAnimationFrame(raf)
      root.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('scroll', onScroll, true)
      if (rows.length) cleanup()
    }
  }, [container, enabled])
}

/** Returns a copy of `list` with the item at `from` moved to `to`. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const out = list.slice()
  const [it] = out.splice(from, 1)
  out.splice(to, 0, it)
  return out
}
