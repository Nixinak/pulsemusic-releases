import { Children, Component, createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Emo } from './Emoji'
import { useDragScroll } from '@/lib/motionScroll'
import { AnimatePresence, motion, useScroll, useTransform, type MotionValue } from 'motion/react'
import { NoteIcon, PlayIcon } from './Icons'
import { livePosition, usePlayer } from '@/lib/player'
import { extractPalette, setPagePalette, type Palette } from '@/lib/colors'
import { useBackdrop } from '@/lib/backdrop'
import { prefetchArtist } from '@/lib/loaders'
import { useArtistImage } from '@/lib/artistImage'
import { useApp } from '@/lib/store'

export function Cover({
  src,
  size,
  radius = 12,
  round = false,
  className = '',
  alt = ''
}: {
  src: string | null | undefined
  size?: number | string
  radius?: number
  round?: boolean
  className?: string
  alt?: string
}): React.JSX.Element {
  const [loaded, setLoaded] = useState(false)
  const style = {
    width: size,
    height: size,
    borderRadius: round ? '50%' : radius
  }
  return (
    <div className={`cover ${className}`} style={style}>
      {src ? (
        <img src={src} alt={alt} loading="lazy" decoding="async" draggable={false} onLoad={() => setLoaded(true)} className={loaded ? 'is-loaded' : ''} />
      ) : (
        <span className="cover__empty">
          <NoteIcon size={22} />
        </span>
      )}
    </div>
  )
}

/** The interpolated playback position. Re-renders only when the shown second changes (or the
 *  player reports a new position), so time labels stay exact without rendering every frame;
 *  bars that glide use Slider's `live` instead. */
export function useLivePosition(): number {
  const [, tick] = useState(0)
  const paused = usePlayer((s) => s.paused)
  // a seek or a new sample re-renders through these
  usePlayer((s) => s.positionMs)
  usePlayer((s) => s.track?.id)
  useEffect(() => {
    if (paused) return
    let shown = -1
    const t = window.setInterval(() => {
      if (document.hidden) return
      const sec = Math.floor(livePosition(usePlayer.getState()) / 1000)
      if (sec !== shown) {
        shown = sec
        tick((n) => n + 1)
      }
    }, 200)
    return () => clearInterval(t)
  }, [paused])
  return livePosition(usePlayer.getState())
}

/** Pointer-driven horizontal slider (progress and volume). With `live`, the bar follows that
 *  value by itself every frame (written straight to the DOM, no React render, no layout). */
export function Slider({
  value,
  max,
  onCommit,
  onPreview,
  className = '',
  label,
  live
}: {
  value: number
  max: number
  onCommit: (v: number) => void
  onPreview?: (v: number | null) => void
  className?: string
  label: string
  live?: () => number
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const fill = useRef<HTMLDivElement>(null)
  const rail = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const shown = drag ?? value
  const frac = max > 0 ? Math.max(0, Math.min(1, shown / max)) : 0
  const following = !!live && drag === null
  const liveRef = useRef(live)
  liveRef.current = live
  const maxRef = useRef(max)
  maxRef.current = max

  useEffect(() => {
    if (!following) return
    let raf = 0
    let last = -1
    const loop = (): void => {
      raf = requestAnimationFrame(loop)
      const get = liveRef.current
      const m = maxRef.current
      if (!get || document.hidden) return
      const f = m > 0 ? Math.max(0, Math.min(1, get() / m)) : 0
      // under a tenth of a pixel on a wide bar: nothing to redraw
      if (Math.abs(f - last) < 0.00005) return
      last = f
      if (fill.current) fill.current.style.transform = `scaleX(${f})`
      if (rail.current) rail.current.style.transform = `translateX(${(f * 100).toFixed(3)}%)`
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [following])

  const fromEvent = (clientX: number): number => {
    const r = ref.current!.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * max
  }

  return (
    <div
      ref={ref}
      className={`slider ${drag !== null ? 'is-dragging' : ''} ${className}`}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(shown)}
      onPointerDown={(e) => {
        if (max <= 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        const v = fromEvent(e.clientX)
        setDrag(v)
        onPreview?.(v)
      }}
      onPointerMove={(e) => {
        if (drag === null) return
        const v = fromEvent(e.clientX)
        setDrag(v)
        onPreview?.(v)
      }}
      onPointerUp={(e) => {
        if (drag === null) return
        const v = fromEvent(e.clientX)
        setDrag(null)
        onPreview?.(null)
        onCommit(v)
      }}
      onPointerCancel={() => {
        if (drag === null) return
        setDrag(null)
        onPreview?.(null)
      }}
      onKeyDown={(e) => {
        const step = max / 20
        if (e.key === 'ArrowRight') onCommit(Math.min(max, value + step))
        if (e.key === 'ArrowLeft') onCommit(Math.max(0, value - step))
      }}
    >
      <div className="slider__track">
        <div ref={fill} className="slider__fill" style={following ? undefined : { transform: `scaleX(${frac})` }} />
      </div>
      <div ref={rail} className="slider__rail" style={following ? undefined : { transform: `translateX(${(frac * 100).toFixed(3)}%)` }}>
        <div className="slider__thumb" />
      </div>
    </div>
  )
}

export function EqBars({ playing }: { playing: boolean }): React.JSX.Element {
  return (
    <span className={`eq ${playing ? 'is-playing' : ''}`} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  )
}

export function Shelf({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }): React.JSX.Element {
  return (
    <section className="shelf">
      <header className="shelf__head">
        <h2>{title}</h2>
        {action}
      </header>
      <ShelfRow>{children}</ShelfRow>
    </section>
  )
}

/** A sideways row of cards: drag it with the mouse, it glides on and fades at the edges.
 *  Every horizontal row in the app uses this one, so they all look and move the same.
 *  When the cards don't fit, the row loops: it holds three copies and keeps you in the
 *  middle one, so you can scroll round and round without reaching an end. */
export function ShelfRow({
  children,
  className = '',
  loop = true,
  startAtEnd = false
}: {
  children: ReactNode
  className?: string
  /** false: a plain row with a start and an end (for things in order, like months). */
  loop?: boolean
  /** Open scrolled to the last card (the newest, in a row that runs oldest to newest). */
  startAtEnd?: boolean
}): React.JSX.Element {
  const rowRef = useRef<HTMLDivElement>(null)
  const loopWidth = useRef(0)
  const [looping, setLooping] = useState(false)
  useDragScroll(rowRef, loopWidth)
  const count = Children.count(children)

  useLayoutEffect(() => {
    const el = rowRef.current
    if (el && startAtEnd && !loop) el.scrollLeft = el.scrollWidth
  }, [startAtEnd, loop, count])

  // Loop only when one copy is wider than the row.
  useLayoutEffect(() => {
    const el = rowRef.current
    if (!el || !loop) return
    const measure = (): void => {
      if (!looping) {
        if (count >= 3 && el.scrollWidth > el.clientWidth + 24) setLooping(true)
        return
      }
      const a = el.querySelector<HTMLElement>('[data-copy="0"] > *')
      const b = el.querySelector<HTMLElement>('[data-copy="1"] > *')
      const w = a && b ? b.offsetLeft - a.offsetLeft : 0
      if (w <= el.clientWidth) {
        loopWidth.current = 0
        setLooping(false)
        return
      }
      const before = loopWidth.current
      loopWidth.current = w
      // start (or stay) in the middle copy
      if (!before) el.scrollLeft = w
      else if (before !== w) el.scrollLeft = w + ((el.scrollLeft - before) % w)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [looping, count])

  return (
    <div ref={rowRef} className={`shelf__row ${looping ? 'is-loop' : ''} ${className}`}>
      {looping
        ? [0, 1, 2].map((copy) => (
            <div key={copy} data-copy={copy} className="shelf__copy" aria-hidden={copy !== 1 || undefined}>
              {children}
            </div>
          ))
        : children}
    </div>
  )
}

export function MediaCard({
  image,
  title,
  subtitle,
  round = false,
  onOpen,
  onPlay,
  onContextMenu,
  onPrefetch,
  artistId
}: {
  image: string | null
  /** For artist cards: find a picture when Spotify gave none. */
  artistId?: string
  title: string
  subtitle?: ReactNode
  round?: boolean
  onOpen: () => void
  onPrefetch?: () => void
  onPlay?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
}): React.JSX.Element {
  // warm the page only when the pointer rests on the card (not while sweeping across a row)
  const dwell = useRef(0)
  const enter = (): void => {
    if (!onPrefetch) return
    window.clearTimeout(dwell.current)
    dwell.current = window.setTimeout(onPrefetch, 150)
  }
  const leave = (): void => window.clearTimeout(dwell.current)
  const art = useArtistImage(artistId, image)
  return (
    <div
      className={`card ${round ? 'card--round' : ''}`}
      onClick={onOpen}
      onMouseEnter={enter}
      onMouseLeave={leave}
      onFocus={onPrefetch}
      onContextMenu={onContextMenu}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
    >
      <div className="card__art">
        <Cover src={art} round={round} radius={14} />
        {onPlay && (
          <button
            className="card__play"
            aria-label={`Play ${title}`}
            onClick={(e) => {
              e.stopPropagation()
              onPlay()
            }}
          >
            <PlayIcon size={20} />
          </button>
        )}
      </div>
      <div className="card__title">
        <Emo>{title}</Emo>
      </div>
      {subtitle && <div className="card__sub">{subtitle}</div>}
    </div>
  )
}

export function PageTransition({ children, id }: { children: ReactNode; id: string }): React.JSX.Element {
  // Quality mode: a softer, longer glide with a little lift
  const quality = useApp((s) => s.settings.renderMode === 'quality')
  return (
    <motion.div
      key={id}
      className="page"
      initial={quality ? { opacity: 0, y: 14, scale: 0.98, filter: 'blur(10px)' } : { opacity: 0, scale: 0.985, filter: 'blur(6px)' }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
      exit={quality ? { opacity: 0, y: -8, scale: 1.012, filter: 'blur(10px)' } : { opacity: 0, scale: 1.01, filter: 'blur(6px)' }}
      transition={quality ? { type: 'spring', stiffness: 170, damping: 26, mass: 0.9 } : { type: 'spring', stiffness: 260, damping: 30, mass: 0.8 }}
    >
      {children}
    </motion.div>
  )
}

export function Skeleton({ rows = 8 }: { rows?: number }): React.JSX.Element {
  return (
    <div className="skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton__row" style={{ animationDelay: `${i * 60}ms` }} />
      ))}
    </div>
  )
}

export function ErrorState({ text, onRetry }: { text: string; onRetry?: () => void }): React.JSX.Element {
  return (
    <div className="state">
      <p>{text}</p>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}

let linkDwell = 0

export function ArtistLinks({ artists, onOpen }: { artists: { id: string; name: string }[]; onOpen: (id: string) => void }): React.JSX.Element {
  return (
    <>
      {artists.map((a, i) => (
        <span key={a.id + i}>
          {i > 0 && ', '}
          <span
            className="link"
            onMouseEnter={() => {
              window.clearTimeout(linkDwell)
              if (a.id) linkDwell = window.setTimeout(() => prefetchArtist(a.id, a.name), 150)
            }}
            onMouseLeave={() => window.clearTimeout(linkDwell)}
            onClick={(e) => {
              e.stopPropagation()
              if (a.id) onOpen(a.id)
            }}
          >
            {a.name}
          </span>
        </span>
      ))}
    </>
  )
}

/** Keeps one broken page from taking down the whole app and shows what failed. */
export class PageErrorBoundary extends Component<{ children: ReactNode; onBack: () => void }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }
  componentDidCatch(error: Error): void {
    console.error('[page] crashed', error)
  }
  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="state">
        <p>This page hit an error: {this.state.error.message}</p>
        <button className="btn" onClick={this.props.onBack}>
          Go back
        </button>
      </div>
    )
  }
}

/** The main scroll container, for scroll-linked effects such as parallax. */
export const ScrollContext = createContext<RefObject<HTMLDivElement | null> | null>(null)

/** Scroll offset of the main content area (0 when unavailable). */
export function usePageScroll(): MotionValue<number> {
  const ref = useContext(ScrollContext)
  const { scrollY } = useScroll(ref ? { container: ref as RefObject<HTMLElement> } : undefined)
  return scrollY
}

/** Tints the whole app with the artwork's colours while this page is open.
 *  With `fixed`, those colours are used instead and no artwork is shown behind the page. */
export function usePagePalette(url: string | null | undefined, fixed?: Palette | null): void {
  const fixedKey = fixed ? fixed.colors.join() : ''
  useEffect(() => {
    const owner = Symbol('page')
    if (fixed) {
      setPagePalette(fixed, owner)
      return () => setPagePalette(null, owner)
    }
    if (!url) return
    let alive = true
    useBackdrop.setState({ url })
    extractPalette(url)
      .then((p) => alive && setPagePalette(p, owner))
      .catch(() => {})
    return () => {
      alive = false
      setPagePalette(null, owner)
      if (useBackdrop.getState().url === url) useBackdrop.setState({ url: null })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, fixedKey])
}

/** Artwork that dissolves into the next song's cover: old one sinks back, new one rises in. */
export function SwapArt({ id, src, radius }: { id: string; src: string | null; radius: number }): React.JSX.Element {
  return (
    <div className="swap-art" style={{ borderRadius: radius }}>
      <AnimatePresence initial={false}>
        <motion.div
          key={id}
          className="swap-art__layer"
          initial={{ opacity: 0, scale: 1.18, filter: 'blur(14px) saturate(1.6)' }}
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px) saturate(1)' }}
          exit={{ opacity: 0, scale: 0.86, filter: 'blur(10px) saturate(0.6)' }}
          transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
        >
          <Cover src={src} radius={radius} />
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

/** Song title and artist that slide when the song changes. */
export function SwapText({ id, children, className = '' }: { id: string; children: ReactNode; className?: string }): React.JSX.Element {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={id}
        className={className}
        initial={{ opacity: 0, y: 14, filter: 'blur(6px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        exit={{ opacity: 0, y: -14, filter: 'blur(6px)' }}
        transition={{ type: 'spring', stiffness: 320, damping: 30 }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}

/** An on/off switch. */
export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }): React.JSX.Element {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`toggle ${on ? 'is-on' : ''}`} onClick={() => onChange(!on)}>
      <motion.span className="toggle__knob" layout transition={{ type: 'spring', stiffness: 600, damping: 32 }} />
    </button>
  )
}
