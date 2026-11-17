// More Now Playing looks:
//  - Poster: a cartoon poster: the cover as a taped-on sticker, the title written by hand,
//    stickers for the artist and album, doodles and a squiggly progress line,
//  - Visualizer: NCS style: the cover pumping with the bass inside rings of the spectrum, with
//    sparks flying out.
import { useEffect, useRef } from 'react'
import { useLivePosition } from './common'
import { formatTime } from '@/lib/format'
import { usePlayer } from '@/lib/player'
import { useApp } from '@/lib/store'
import { BANDS, readBeat, useBeat } from '@/lib/beat'

/* ================= Poster ================= */

/** Doodles drawn around the poster (stars, a heart, squiggles, a lightning bolt). */
const DOODLES = [
  {
    d: 'M12 2l2.9 6.6 7.1.6-5.4 4.7 1.7 7-6.3-3.8-6.3 3.8 1.7-7L2 9.2l7.1-.6L12 2Z',
    x: 6,
    y: 8,
    s: 46,
    r: -14,
    c: 'var(--pz-a)'
  },
  {
    d: 'M12 21s-7-4.4-9.3-8.6C.9 9 3 5 6.6 5c2.1 0 3.5 1.2 4.4 2.5C11.9 6.2 13.3 5 15.4 5 19 5 21.1 9 19.3 12.4 17 16.6 12 21 12 21Z',
    x: 86,
    y: 6,
    s: 40,
    r: 12,
    c: 'var(--pz-b)'
  },
  {
    d: 'M13 2 4 14h7l-1 8 9-12h-7l1-8Z',
    x: 88,
    y: 70,
    s: 44,
    r: 10,
    c: 'var(--pz-c)'
  },
  {
    d: 'M2 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0',
    x: 4,
    y: 78,
    s: 54,
    r: -8,
    c: 'var(--pz-d)'
  },
  {
    d: 'M12 2l2.9 6.6 7.1.6-5.4 4.7 1.7 7-6.3-3.8-6.3 3.8 1.7-7L2 9.2l7.1-.6L12 2Z',
    x: 92,
    y: 40,
    s: 24,
    r: 20,
    c: 'var(--pz-b)'
  }
]

export function Poster({
  art,
  paused,
  title,
  artist,
  album,
  durationMs
}: {
  art: string | null
  paused: boolean
  title: string
  artist: string
  album: string
  durationMs: number
}): React.JSX.Element {
  const pos = useLivePosition()
  const progress = durationMs ? Math.min(1, pos / durationMs) : 0
  const size = title.length > 34 ? 'is-long' : title.length > 16 ? 'is-mid' : ''
  // the squiggly progress line: a wave drawn up to where the song is
  const wave = Array.from({ length: 41 }, (_, i) => `${i === 0 ? 'M' : 'L'}${(i * 2.5).toFixed(1)} ${(6 + Math.sin(i * 0.9) * 3.2).toFixed(2)}`).join(' ')
  return (
    <div className={`poster ${paused ? 'is-paused' : ''}`} aria-hidden="true">
      {DOODLES.map((d, i) => (
        <svg
          key={i}
          className="poster__doodle"
          viewBox="0 0 24 24"
          style={{
            left: `${d.x}%`,
            top: `${d.y}%`,
            width: d.s,
            height: d.s,
            rotate: `${d.r}deg`,
            ['--c' as string]: d.c,
            animationDelay: `${i * -0.7}s`
          }}
        >
          <path d={d.d} />
        </svg>
      ))}
      <span className="poster__bubble">now playing!</span>
      <div className="poster__sticker">
        <span className="poster__tape poster__tape--l" />
        <span className="poster__tape poster__tape--r" />
        <div className="poster__art">{art && <img src={art} alt="" draggable={false} />}</div>
      </div>
      <h2 className={`poster__title ${size}`}>{title}</h2>
      <div className="poster__tags">
        <span className="poster__tag poster__tag--artist">{artist}</span>
        {album && album !== title && <span className="poster__tag poster__tag--album">{album}</span>}
        <span className="poster__tag poster__tag--time">{formatTime(durationMs)}</span>
      </div>
      <svg className="poster__wave" viewBox="0 0 100 12" preserveAspectRatio="none">
        <path d={wave} className="poster__wave-bg" />
        <defs>
          <clipPath id="posterWaveClip">
            <rect x="-2" y="-4" height="20" width={progress * 100 + 2} />
          </clipPath>
        </defs>
        <path d={wave} className="poster__wave-on" clipPath="url(#posterWaveClip)" />
      </svg>
    </div>
  )
}

/* ================= Visualizer ================= */

export function PulseRing({ art, paused }: { art: string | null; paused: boolean }): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null)
  const disc = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const reduce = useApp((s) => s.settings.reduceMotion)
  useBeat(!reduce && !paused)

  // An NCS-style visualizer: the cover in the middle, pumping with the bass; around it a few
  // smooth rings of the spectrum in the song's colours, laid over each other; sparks flying out,
  // faster when it's loud; the whole thing shakes a little on a hard kick.
  useEffect(() => {
    const cv = canvas.current
    if (!cv) return
    const g = cv.getContext('2d')
    if (!g) return
    const shown = new Float32Array(BANDS)
    const sparks = Array.from({ length: 150 }, () => ({
      a: Math.random() * Math.PI * 2,
      r: Math.random(),
      v: 0.4 + Math.random() * 0.8,
      s: 0.6 + Math.random() * 1.6
    }))
    let colors = ['#ffffff', '#ffffff', '#ffffff']
    let colorsAt = 0
    let raf = 0
    let last = performance.now()
    let bass = 0
    const tick = (now: number): void => {
      raf = requestAnimationFrame(tick)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = cv.clientWidth
      const h = cv.clientHeight
      if (!w || !h) return
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr)
        cv.height = Math.round(h * dpr)
      }
      if (now - colorsAt > 1000) {
        colorsAt = now
        const css = getComputedStyle(cv)
        colors = ['--amb-1', '--amb-2', '--amb-3'].map((v) => css.getPropertyValue(v).trim() || '#ffffff')
      }
      const b = readBeat()
      const still = paused || reduce
      for (let i = 0; i < BANDS; i++) {
        const want = still ? 0.02 : Math.min(1, b.bands[i])
        shown[i] += (want - shown[i]) * (want > shown[i] ? 0.75 : 0.16)
      }
      let low = 0
      for (let i = 0; i < 8; i++) low += shown[i]
      low /= 8
      const kick = still ? 0 : b.kick
      bass += (Math.max(low, kick * 0.9) - bass) * (low > bass ? 0.6 : 0.12)

      // the cover pumps with the bass; everything shakes a little on a hard kick
      if (disc.current) disc.current.style.transform = `scale(${(1 + bass * 0.09).toFixed(4)})`
      if (box.current) {
        const sh = kick > 0.7 ? (kick - 0.7) * 10 : 0
        box.current.style.transform = sh ? `translate(${((Math.random() - 0.5) * sh).toFixed(2)}px, ${((Math.random() - 0.5) * sh).toFixed(2)}px)` : ''
      }

      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
      const cx = w / 2
      const cy = h / 2
      const size = Math.min(w, h)
      // the cover's edge (its box is 55 % of the deck; the canvas is 160 % of it)
      const r0 = size * 0.172 * (1 + bass * 0.09)
      const len = size * 0.15

      // a glow behind, brighter on the bass
      const glow = g.createRadialGradient(cx, cy, r0 * 0.8, cx, cy, r0 + len * 1.6)
      glow.addColorStop(0, `rgba(255,255,255,${0.05 + bass * 0.18})`)
      glow.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = glow
      g.fillRect(0, 0, w, h)

      // the spectrum rings: mirrored left and right, the lows at the bottom like NCS
      const N = 120
      const ring = (scale: number, shift: number, color: string, alpha: number): void => {
        const pts: [number, number][] = []
        for (let i = 0; i < N; i++) {
          const t = i / N
          // mirrored: 0 → 0.5 is one half, 0.5 → 1 the other
          const half = t < 0.5 ? t * 2 : (1 - t) * 2
          const bi = Math.min(BANDS - 1, Math.floor(half * (BANDS - 1) * 0.85 + shift))
          const v = shown[bi]
          const ang = Math.PI / 2 + t * Math.PI * 2
          const rr = r0 + 3 + Math.pow(v, 1.3) * len * scale
          pts.push([cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr])
        }
        g.beginPath()
        for (let i = 0; i <= N; i++) {
          const p = pts[i % N]
          const q = pts[(i + 1) % N]
          const mx = (p[0] + q[0]) / 2
          const my = (p[1] + q[1]) / 2
          if (i === 0) g.moveTo(mx, my)
          else g.quadraticCurveTo(p[0], p[1], mx, my)
        }
        g.closePath()
        g.globalAlpha = alpha
        g.fillStyle = color
        g.fill()
      }
      g.globalCompositeOperation = 'lighter'
      ring(1.15, 3, colors[2], 0.55)
      ring(1.0, 1.5, colors[1], 0.6)
      ring(0.82, 0, colors[0], 0.75)
      g.globalCompositeOperation = 'source-over'
      ring(0.55, 0, '#ffffff', 0.92)
      g.globalAlpha = 1

      // the sparks
      const level = still ? 0 : b.level
      const speed = 0.08 + level * 0.5 + bass * 0.9
      g.fillStyle = '#ffffff'
      for (const s of sparks) {
        s.r += s.v * speed * dt
        if (s.r > 1) {
          s.r = 0
          s.a = Math.random() * Math.PI * 2
        }
        const rr = r0 + len * 0.4 + s.r * size * 0.48
        const x = cx + Math.cos(s.a) * rr
        const y = cy + Math.sin(s.a) * rr
        g.globalAlpha = Math.min(1, s.r * 4) * (1 - s.r) * (0.35 + bass * 0.65)
        g.beginPath()
        g.arc(x, y, s.s * (1 + bass), 0, Math.PI * 2)
        g.fill()
      }
      g.globalAlpha = 1
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [paused, reduce])

  return (
    <div className={`pulsev ${paused ? 'is-paused' : ''}`} aria-hidden="true" ref={box}>
      <canvas ref={canvas} className="pulsev__canvas" />
      <div className="pulsev__disc" ref={disc}>
        {art && <img src={art} alt="" draggable={false} />}
      </div>
    </div>
  )
}
