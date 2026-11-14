// Liquid glass surface: refraction via an SVG displacement filter used as a backdrop-filter.
// "Full" quality bends and splits the backdrop at the edges (chromatic dispersion);
// "Lite" falls back to a plain frosted blur.
import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes
} from 'react'
import { useApp } from '@/lib/store'

export interface GlassProps extends HTMLAttributes<HTMLDivElement> {
  /** Corner radius in px. Use a large number for pills. */
  radius?: number
  /** Width of the refracting edge in px. */
  bezel?: number
  /** Displacement strength. */
  refraction?: number
  /** Backdrop blur in px. */
  blur?: number
  /** Visual weight of the tint layer. */
  tone?: 'clear' | 'regular' | 'thick'
  interactive?: boolean
  /** Plain frosted blur, no refraction: for large panels whose contents scroll or animate,
   *  where the refraction filter would have to be redrawn every frame. */
  simple?: boolean
}

/**
 * Displacement map for the refracting edge. Red = sideways shift, blue = up/down shift,
 * 50% grey = no shift. Drawn per pixel from the distance to the rounded edge, so the shift
 * fades out smoothly towards the middle. (The old map was a blurred grey box on top of two
 * gradients: where the box ended you could see a faint second rectangle inside the glass.)
 */
const mapCache = new Map<string, string>()
function displacementMap(w: number, h: number, r: number, bezel: number): string {
  const key = `${w}x${h}r${r}b${bezel}`
  const hit = mapCache.get(key)
  if (hit) return hit
  // Half resolution is plenty: the map is smooth and the filter scales it back up.
  const cw = Math.max(2, Math.round(w / 2))
  const ch = Math.max(2, Math.round(h / 2))
  const sx = w / cw
  const sy = h / ch
  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  const img = ctx.createImageData(cw, ch)
  const d = img.data
  const hw = w / 2
  const hh = h / 2
  const rr = Math.min(r, hw, hh)
  for (let j = 0; j < ch; j++) {
    for (let i = 0; i < cw; i++) {
      // Point relative to the centre, in real pixels.
      const px = (i + 0.5) * sx - hw
      const py = (j + 0.5) * sy - hh
      const qx = Math.abs(px) - (hw - rr)
      const qy = Math.abs(py) - (hh - rr)
      // Distance inwards from the rounded edge, and the outward direction at that point.
      let depth: number
      let nx: number
      let ny: number
      if (qx > 0 && qy > 0) {
        const len = Math.hypot(qx, qy) || 1
        depth = rr - len
        nx = (qx / len) * Math.sign(px)
        ny = (qy / len) * Math.sign(py)
      } else if (qx > qy) {
        depth = rr - Math.max(qx, 0) - Math.min(Math.max(qx, qy), 0)
        nx = Math.sign(px)
        ny = 0
      } else {
        depth = rr - Math.max(qy, 0) - Math.min(Math.max(qx, qy), 0)
        nx = 0
        ny = Math.sign(py)
      }
      const t = Math.min(1, Math.max(0, depth / bezel))
      // Strongest at the rim, easing to zero (with zero slope) where the bezel ends.
      const m = depth < 0 ? 0 : (1 - t) * (1 - t) * (1 - t * 0.35)
      const o = (j * cw + i) * 4
      // Pull the backdrop inwards, like the old map did.
      d[o] = Math.round(127.5 - nx * m * 127.5)
      d[o + 1] = 128
      d[o + 2] = Math.round(127.5 - ny * m * 127.5)
      d[o + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  const url = canvas.toDataURL('image/png')
  if (mapCache.size > 40) mapCache.clear()
  mapCache.set(key, url)
  return url
}

/** True while the window is being resized (and a moment after). */
let windowResizing = false
let resizeTimer = 0
if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => {
    windowResizing = true
    window.clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(() => (windowResizing = false), 220)
  })
}

export const Glass = forwardRef<HTMLDivElement, GlassProps>(function Glass(
  {
    radius = 24,
    bezel = 18,
    refraction = 60,
    blur = 10,
    tone = 'regular',
    interactive = false,
    simple = false,
    className = '',
    style,
    children,
    ...rest
  },
  outerRef
) {
  const quality = useApp((s) => s.settings.glassQuality)
  const ref = useRef<HTMLDivElement>(null)
  useImperativeHandle(outerRef, () => ref.current as HTMLDivElement)
  const [size, setSize] = useState({ w: 0, h: 0 })
  /** Being resized: a plain frosted blur until the size settles. */
  const [settling, setSettling] = useState(false)
  const sizeRef = useRef({ w: 0, h: 0 })
  const rawId = useId()
  const id = `lg${rawId.replace(/[^a-zA-Z0-9]/g, '')}`

  useEffect(() => {
    const el = ref.current
    if (!el || quality !== 'full' || simple) return
    // While the window is being resized every panel changes size every frame; drawing new
    // refraction maps each time made resizing stutter, so then the glass waits (as a plain
    // frosted blur) until the size settles. Other size changes apply straight away.
    let timer = 0
    let first = true
    const ro = new ResizeObserver(([entry]) => {
      const b = entry.borderBoxSize?.[0]
      const w = Math.round((b?.inlineSize ?? el.offsetWidth) / 2) * 2
      const h = Math.round((b?.blockSize ?? el.offsetHeight) / 2) * 2
      const apply = (): void => {
        sizeRef.current = { w, h }
        setSize({ w, h })
        setSettling(false)
      }
      window.clearTimeout(timer)
      if (first || !windowResizing) {
        first = false
        apply()
        return
      }
      if (w === sizeRef.current.w && h === sizeRef.current.h) {
        setSettling(false)
        return
      }
      setSettling(true)
      timer = window.setTimeout(apply, 140)
    })
    ro.observe(el)
    return () => {
      window.clearTimeout(timer)
      ro.disconnect()
    }
  }, [quality, simple])

  const full = !simple && quality === 'full' && !settling && size.w > 0 && size.h > 0
  const r = Math.min(radius, size.h / 2 || radius, size.w / 2 || radius)
  const edge = Math.min(bezel, Math.max(4, Math.min(size.w, size.h) / 3))
  const map = useMemo(() => (full ? displacementMap(size.w, size.h, r, edge) : ''), [full, size.w, size.h, r, edge])

  const glassStyle: CSSProperties = {
    borderRadius: radius,
    ...(full
      ? { backdropFilter: `url(#${id})`, WebkitBackdropFilter: `url(#${id})` }
      : { backdropFilter: `blur(${blur * 2.2}px) saturate(170%)`, WebkitBackdropFilter: `blur(${blur * 2.2}px) saturate(170%)` }),
    ...style
  }

  return (
    <div
      ref={ref}
      className={`glass glass--${tone} ${interactive ? 'glass--interactive' : ''} ${className}`}
      style={glassStyle}
      {...rest}
    >
      {full && (
        <svg className="glass__defs" width="0" height="0" aria-hidden="true">
          <filter
            id={id}
            x="0"
            y="0"
            width={size.w}
            height={size.h}
            filterUnits="userSpaceOnUse"
            primitiveUnits="userSpaceOnUse"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur in="SourceGraphic" stdDeviation={blur} edgeMode="duplicate" result="blur" />
            <feImage href={map} x="0" y="0" width={size.w} height={size.h} preserveAspectRatio="none" result="map" />
            <feDisplacementMap in="blur" in2="map" scale={refraction} xChannelSelector="R" yChannelSelector="B" result="dr" />
            <feColorMatrix in="dr" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
            <feDisplacementMap in="blur" in2="map" scale={refraction * 0.9} xChannelSelector="R" yChannelSelector="B" result="dg" />
            <feColorMatrix in="dg" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g" />
            <feDisplacementMap in="blur" in2="map" scale={refraction * 0.8} xChannelSelector="R" yChannelSelector="B" result="db" />
            <feColorMatrix in="db" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b" />
            <feBlend in="r" in2="g" mode="screen" result="rg" />
            <feBlend in="rg" in2="b" mode="screen" result="rgb" />
            <feColorMatrix in="rgb" type="saturate" values="1.7" />
          </filter>
        </svg>
      )}
      <span className="glass__rim" style={{ borderRadius: radius }} aria-hidden="true" />
      {children}
    </div>
  )
})
