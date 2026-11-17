// More Now Playing looks:
//  - Cassette: a tape in a see-through shell, the cover on its label, the reels turning while it
//    plays and the tape winding from one reel to the other as the song goes on,
//  - Poster: the song printed as a gig poster (big cover, the title in huge letters, small print),
//  - Visualizer: the cover as a round disc inside a ring of bars that moves with the music.
import { useEffect, useRef } from 'react'
import { useLivePosition } from './common'
import { formatTime } from '@/lib/format'
import { usePlayer } from '@/lib/player'
import { useApp } from '@/lib/store'
import { BANDS, readBeat, useBeat } from '@/lib/beat'

/* ================= Cassette ================= */

/** Where the reels sit in the drawing, and how big the tape on them can get. */
const REEL = { y: 318, left: 352, right: 648, hub: 40, min: 50, max: 112 }

export function Cassette({ art, paused, title, artist }: { art: string | null; paused: boolean; title: string; artist: string }): React.JSX.Element {
  const left = useRef<SVGGElement>(null)
  const right = useRef<SVGGElement>(null)
  const pos = useLivePosition()
  const dur = usePlayer((s) => s.track?.durationMs ?? 0)
  const progress = dur ? Math.min(1, pos / dur) : 0
  // the tape moves from the left reel to the right one as the song plays
  const rl = REEL.min + (REEL.max - REEL.min) * (1 - progress)
  const rr = REEL.min + (REEL.max - REEL.min) * progress
  const live = useRef({ paused, rl, rr })
  live.current = { paused, rl, rr }

  useEffect(() => {
    const reduce = useApp.getState().settings.reduceMotion
    let a = 0
    let b = 0
    let speed = 0
    let last = performance.now()
    let raf = 0
    const tick = (now: number): void => {
      raf = requestAnimationFrame(tick)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const want = live.current.paused || reduce ? 0 : 1
      speed += (want - speed) * Math.min(1, dt * 5)
      // the tape runs at one speed, so a full reel turns slower than an empty one
      a += (speed * dt * 9000) / live.current.rl
      b += (speed * dt * 9000) / live.current.rr
      left.current?.setAttribute('transform', `rotate(${a % 360} ${REEL.left} ${REEL.y})`)
      right.current?.setAttribute('transform', `rotate(${b % 360} ${REEL.right} ${REEL.y})`)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const hub = (cx: number, ref: React.RefObject<SVGGElement | null>): React.JSX.Element => (
    <g ref={ref}>
      <circle cx={cx} cy={REEL.y} r={REEL.hub} fill="#eceae4" />
      <circle cx={cx} cy={REEL.y} r={REEL.hub - 9} fill="#1a1a1d" />
      {Array.from({ length: 6 }, (_, i) => (
        <rect key={i} x={cx - 4} y={REEL.y - REEL.hub + 6} width="8" height="13" rx="2" fill="#eceae4" transform={`rotate(${i * 60} ${cx} ${REEL.y})`} />
      ))}
      {/* a mark on the reel, so the turning is easy to see */}
      <rect x={cx - 2} y={REEL.y - REEL.hub - 4} width="4" height="10" rx="2" fill="rgba(0,0,0,0.35)" />
    </g>
  )

  return (
    <div className={`cass ${paused ? 'is-paused' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 1000 640" className="cass__svg">
        <defs>
          <linearGradient id="cassShell" x1="0" y1="0" x2="0.3" y2="1">
            <stop offset="0" stopColor="#3a3c43" />
            <stop offset="0.5" stopColor="#1f2024" />
            <stop offset="1" stopColor="#141518" />
          </linearGradient>
          <linearGradient id="cassPaper" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f6f1e6" />
            <stop offset="1" stopColor="#e6dfcf" />
          </linearGradient>
          <radialGradient id="cassTape" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0.6" stopColor="#3b2619" />
            <stop offset="0.9" stopColor="#2a190f" />
            <stop offset="1" stopColor="#4a3020" />
          </radialGradient>
          <clipPath id="cassWin">
            <rect x="250" y="246" width="500" height="144" rx="64" />
          </clipPath>
          <clipPath id="cassArt">
            <rect x="96" y="86" width="132" height="132" rx="8" />
          </clipPath>
          <filter id="cassSoft" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="12" />
          </filter>
        </defs>
        {/* shadow and shell */}
        <rect x="40" y="56" width="920" height="580" rx="40" fill="rgba(0,0,0,0.55)" filter="url(#cassSoft)" />
        <rect x="20" y="20" width="960" height="600" rx="36" fill="url(#cassShell)" />
        <rect x="21.5" y="21.5" width="957" height="597" rx="35" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="2" />
        {[
          [52, 52],
          [948, 52],
          [52, 588],
          [948, 588]
        ].map(([x, y]) => (
          <g key={`${x}${y}`}>
            <circle cx={x} cy={y} r="13" fill="#0c0c0e" />
            <path d={`M${x - 7} ${y}h14M${x} ${y - 7}v14`} stroke="#5d5f66" strokeWidth="3" strokeLinecap="round" />
          </g>
        ))}

        {/* the label */}
        <rect x="70" y="62" width="860" height="360" rx="20" fill="url(#cassPaper)" />
        <rect x="70" y="232" width="860" height="22" style={{ fill: 'var(--amb-1)' }} opacity="0.85" />
        <rect x="70" y="254" width="860" height="10" style={{ fill: 'var(--amb-2)' }} opacity="0.7" />
        {art ? (
          <image href={art} x="96" y="86" width="132" height="132" preserveAspectRatio="xMidYMid slice" clipPath="url(#cassArt)" />
        ) : (
          <rect x="96" y="86" width="132" height="132" rx="8" fill="#d8d0bf" />
        )}
        <text x="252" y="128" className="cass__hand cass__hand--title">
          {title.length > 30 ? `${title.slice(0, 29)}…` : title}
        </text>
        <text x="252" y="182" className="cass__hand">
          {artist.length > 38 ? `${artist.slice(0, 37)}…` : artist}
        </text>
        <line x1="252" y1="140" x2="900" y2="140" stroke="rgba(0,0,0,0.12)" strokeWidth="2" />
        <line x1="252" y1="194" x2="900" y2="194" stroke="rgba(0,0,0,0.12)" strokeWidth="2" />
        <text x="104" y="392" className="cass__side">A</text>
        <text x="900" y="222" textAnchor="end" className="cass__type">
          C·60 · TYPE II
        </text>

        {/* the window: tinted plastic, the reels behind it */}
        <rect x="244" y="240" width="512" height="156" rx="70" fill="#09090b" />
        <g clipPath="url(#cassWin)">
          <rect x="250" y="246" width="500" height="144" fill="#121215" />
          <circle cx={REEL.left} cy={REEL.y} r={rl} fill="url(#cassTape)" />
          <circle cx={REEL.right} cy={REEL.y} r={rr} fill="url(#cassTape)" />
          {hub(REEL.left, left)}
          {hub(REEL.right, right)}
          <rect x="250" y="246" width="500" height="144" fill="rgba(140,150,170,0.08)" />
          <path d="M260 262 L420 262 L380 386 L260 386 Z" fill="rgba(255,255,255,0.05)" />
        </g>
        <rect x="244" y="240" width="512" height="156" rx="70" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="2" />

        {/* the bottom, where the tape meets the head */}
        <path d="M236 620 L282 470 L718 470 L764 620 Z" fill="#17181b" stroke="rgba(255,255,255,0.08)" strokeWidth="2" />
        {[330, 420, 500, 580, 670].map((x, i) => (
          <circle key={x} cx={x} cy={i === 2 ? 560 : 548} r={i === 2 ? 20 : 13} fill="#060607" />
        ))}
        <rect x="300" y="596" width="400" height="10" rx="3" style={{ fill: 'color-mix(in srgb, #3b2619 80%, var(--amb-1))' }} />
      </svg>
    </div>
  )
}

/* ================= Poster ================= */

export function Poster({ art, paused, title, artist, album, durationMs }: { art: string | null; paused: boolean; title: string; artist: string; album: string; durationMs: number }): React.JSX.Element {
  const pos = useLivePosition()
  const progress = durationMs ? Math.min(1, pos / durationMs) : 0
  const size = title.length > 34 ? 'is-long' : title.length > 16 ? 'is-mid' : ''
  return (
    <div className={`poster ${paused ? 'is-paused' : ''}`} aria-hidden="true">
      <div className="poster__art">{art && <img src={art} alt="" draggable={false} />}</div>
      <div className="poster__head">
        <span>Now playing</span>
        <span>{formatTime(durationMs)}</span>
      </div>
      <h2 className={`poster__title ${size}`}>{title}</h2>
      <div className="poster__foot">
        <span className="poster__artist">{artist}</span>
        <span className="poster__album">{album}</span>
      </div>
      <div className="poster__bar">
        <i style={{ width: `${progress * 100}%` }} />
      </div>
    </div>
  )
}

/* ================= Visualizer ================= */

export function PulseRing({ art, paused }: { art: string | null; paused: boolean }): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null)
  const disc = useRef<HTMLDivElement>(null)
  const reduce = useApp((s) => s.settings.reduceMotion)
  useBeat(!reduce && !paused)

  useEffect(() => {
    const cv = canvas.current
    if (!cv) return
    const g = cv.getContext('2d')
    if (!g) return
    const shown = new Float32Array(BANDS)
    let spin = 0
    let raf = 0
    let tint = '#ffffff'
    let tintAt = 0
    let last = performance.now()
    const tick = (now: number): void => {
      raf = requestAnimationFrame(tick)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = cv.clientWidth
      if (!w) return
      if (cv.width !== Math.round(w * dpr)) {
        cv.width = Math.round(w * dpr)
        cv.height = Math.round(w * dpr)
      }
      const b = readBeat()
      const still = paused || reduce
      for (let i = 0; i < BANDS; i++) {
        const want = still ? 0.04 : Math.min(1, b.bands[i] * 1.25)
        shown[i] += (want - shown[i]) * (want > shown[i] ? 0.55 : 0.12)
      }
      if (!still) spin += dt * 4
      const kick = still ? 0 : b.kick
      if (disc.current) disc.current.style.transform = `scale(${1 + kick * 0.035}) rotate(${spin}deg)`
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, w)
      const c = w / 2
      const r0 = w * 0.335
      const len = w * 0.15
      const bars = BANDS * 2
      // the song's colour (read once a second: it only changes with the song)
      if (now - tintAt > 1000) {
        tintAt = now
        tint = getComputedStyle(cv).getPropertyValue('--amb-1').trim() || '#ffffff'
      }
      // a soft glow behind the bars on each kick
      const glow = g.createRadialGradient(c, c, r0 * 0.9, c, c, r0 + len * 1.3)
      glow.addColorStop(0, 'rgba(255,255,255,0)')
      glow.addColorStop(0.35, `rgba(255,255,255,${0.04 + kick * 0.1})`)
      glow.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = glow
      g.fillRect(0, 0, w, w)
      g.lineCap = 'round'
      g.lineWidth = Math.max(2, (Math.PI * 2 * r0) / bars * 0.48)
      for (let i = 0; i < bars; i++) {
        // the lows at the top, mirrored left and right
        const band = i < BANDS ? i : bars - 1 - i
        const v = shown[band]
        const ang = (i / bars) * Math.PI * 2 - Math.PI / 2 + (spin * Math.PI) / 180
        const r1 = r0 + 6
        const r2 = r1 + 4 + v * len
        g.strokeStyle = i % 2 ? tint : 'rgba(255,255,255,0.88)'
        g.globalAlpha = 0.45 + v * 0.55
        g.beginPath()
        g.moveTo(c + Math.cos(ang) * r1, c + Math.sin(ang) * r1)
        g.lineTo(c + Math.cos(ang) * r2, c + Math.sin(ang) * r2)
        g.stroke()
      }
      g.globalAlpha = 1
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [paused, reduce])

  return (
    <div className={`pulsev ${paused ? 'is-paused' : ''}`} aria-hidden="true">
      <canvas ref={canvas} className="pulsev__canvas" />
      <div className="pulsev__disc" ref={disc}>
        {art && <img src={art} alt="" draggable={false} />}
        <span className="pulsev__hole" />
      </div>
    </div>
  )
}
