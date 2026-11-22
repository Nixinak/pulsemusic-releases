// Scenes for the "Ask the DJ for" mood cards. Each mood is a small full-bleed picture drawn on
// the card's own two colours (--a, --b): a road at night under streetlights, rain on glass with
// the city out of focus behind it, a synthwave sun over a grid, and so on. Shapes are white or
// black at low opacity so every scene sits on its card's gradient; hover moves a layer or two.

export type MoodArtKind = 'drive' | 'gym' | 'chill' | 'party' | 'focus' | 'sad' | 'throwback' | 'new'

/** The same "random" numbers every time, so a scene never changes between renders. */
function seeded(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
}

const W = 320
const H = 180

function Drive(): React.JSX.Element {
  const horizon = 96
  const vx = 196
  // the dashes in the middle of the road, smaller as they go away
  const dashes = Array.from({ length: 7 }, (_, i) => {
    const t0 = Math.pow(i / 7, 1.8)
    const t1 = Math.pow((i + 0.45) / 7, 1.8)
    const y0 = horizon + (H - horizon) * t0
    const y1 = horizon + (H - horizon) * t1
    const x = (y: number): number => vx + (150 - vx) * ((y - horizon) / (H - horizon))
    const w = (y: number): number => 0.6 + 4 * ((y - horizon) / (H - horizon))
    return `M${x(y0) - w(y0)} ${y0}L${x(y0) + w(y0)} ${y0}L${x(y1) + w(y1)} ${y1}L${x(y1) - w(y1)} ${y1}Z`
  })
  const lamps = Array.from({ length: 6 }, (_, i) => {
    const t = Math.pow((i + 1) / 6.5, 1.7)
    return { x: vx + (318 - vx) * t, y: horizon - 2 - 52 * t, r: 1 + 5 * t }
  })
  const rnd = seeded(7)
  const towers = Array.from({ length: 16 }, (_, i) => ({ x: i * 20 - 4 + rnd() * 6, w: 10 + rnd() * 12, h: 6 + rnd() * 22 }))
  return (
    <>
      <rect width={W} height={horizon} fill="url(#ma-sky)" />
      <g className="ma-stars" fill="#fff">
        {Array.from({ length: 22 }, (_, i) => {
          const r = seeded(100 + i)
          return <circle key={i} cx={r() * W} cy={r() * 60} r={0.5 + r() * 0.9} opacity={0.3 + r() * 0.6} />
        })}
      </g>
      <path d="M262 24a14 14 0 1 0 16 20 11.5 11.5 0 0 1-16-20Z" fill="#fff" opacity="0.92" />
      <g fill="#000" opacity="0.38">
        {towers.map((t, i) => (
          <rect key={i} x={t.x} y={horizon - t.h} width={t.w} height={t.h} />
        ))}
      </g>
      <rect y={horizon - 10} width={W} height="14" fill="url(#ma-haze)" />
      <path d={`M${vx - 3} ${horizon}L${vx + 3} ${horizon}L330 ${H}L-30 ${H}Z`} fill="#000" opacity="0.42" />
      <g className="ma-road" fill="#fff" opacity="0.85">
        {dashes.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
      {lamps.map((l, i) => (
        <g key={i}>
          <circle cx={l.x} cy={l.y} r={l.r * 4} fill="url(#ma-lamp)" />
          <circle cx={l.x} cy={l.y} r={l.r * 0.7} fill="#fff6d8" />
        </g>
      ))}
    </>
  )
}

function Gym(): React.JSX.Element {
  // a heartbeat across the card, over bold bars that climb
  const beat = 'M-10 112H70L82 112L92 70L104 150L118 40L132 128L142 112H196L206 92L214 124L222 112H330'
  return (
    <>
      <g className="ma-bars">
        {Array.from({ length: 11 }, (_, i) => {
          const h = 30 + Math.abs(Math.sin(i * 1.3)) * 90 + i * 4
          return <rect key={i} x={20 + i * 28} y={H - h} width="16" height={h} rx="4" fill="#000" opacity={0.1 + (i % 3) * 0.05} />
        })}
      </g>
      <path d={beat} fill="none" stroke="#fff" strokeWidth="9" strokeLinejoin="round" strokeLinecap="round" opacity="0.18" />
      <path className="ma-beat" d={beat} fill="none" stroke="#fff" strokeWidth="3.2" strokeLinejoin="round" strokeLinecap="round" pathLength={1} />
      <circle cx="118" cy="40" r="5" fill="#fff" />
    </>
  )
}

function Chill(): React.JSX.Element {
  const wave = (y: number, amp: number, len: number, phase: number): string => {
    let d = `M-40 ${y}`
    for (let x = -40; x <= W + 40; x += 8) d += `L${x} ${(y + Math.sin((x + phase) / len) * amp).toFixed(1)}`
    return `${d}L${W + 40} ${H}L-40 ${H}Z`
  }
  return (
    <>
      <circle cx="226" cy="74" r="44" fill="#fff" opacity="0.9" />
      <circle cx="226" cy="74" r="74" fill="url(#ma-glow)" />
      <g className="ma-waves">
        <path d={wave(98, 6, 30, 0)} fill="#fff" opacity="0.16" />
        <path d={wave(112, 7, 26, 40)} fill="#fff" opacity="0.18" />
        <path d={wave(128, 6, 34, 90)} fill="#000" opacity="0.14" />
        <path d={wave(146, 5, 28, 20)} fill="#000" opacity="0.2" />
      </g>
    </>
  )
}

function Party(): React.JSX.Element {
  const rnd = seeded(21)
  const confetti = Array.from({ length: 34 }, () => ({ x: rnd() * W, y: rnd() * H, w: 2 + rnd() * 5, r: rnd() * 180, o: 0.4 + rnd() * 0.6 }))
  return (
    <>
      <g className="ma-beams" style={{ transformOrigin: '230px 30px' }}>
        {[-62, -38, -14, 10, 34, 58].map((a, i) => (
          <path key={i} d="M230 30L210 220L250 220Z" fill="#fff" opacity={0.07 + (i % 2) * 0.05} transform={`rotate(${a} 230 30)`} />
        ))}
      </g>
      <circle cx="230" cy="30" r="20" fill="url(#ma-ball)" />
      <g opacity="0.35" stroke="#000" strokeWidth="0.6">
        <path d="M210 30h40M213 20h34M213 40h34M230 10v40M220 12v36M240 12v36" />
      </g>
      <g className="ma-confetti">
        {confetti.map((c, i) => (
          <rect key={i} x={c.x} y={c.y} width={c.w} height={c.w * 0.5} fill="#fff" opacity={c.o} transform={`rotate(${c.r} ${c.x} ${c.y})`} />
        ))}
      </g>
    </>
  )
}

function Focus(): React.JSX.Element {
  return (
    <>
      <g stroke="#fff" fill="none" opacity="0.16">
        {Array.from({ length: 9 }, (_, i) => (
          <path key={i} d={`M${i * 40} 0V${H}`} />
        ))}
        {Array.from({ length: 5 }, (_, i) => (
          <path key={i} d={`M0 ${i * 40 + 10}H${W}`} />
        ))}
      </g>
      <g className="ma-rings" fill="none" stroke="#fff">
        {[70, 52, 34, 16].map((r, i) => (
          <circle key={r} cx="232" cy="78" r={r} strokeWidth={1.2 + i * 0.4} opacity={0.25 + i * 0.18} />
        ))}
      </g>
      <circle cx="232" cy="78" r="5" fill="#fff" />
      <circle cx="232" cy="78" r="22" fill="url(#ma-glow)" />
    </>
  )
}

function Sad(): React.JSX.Element {
  const rnd = seeded(5)
  const bokeh = Array.from({ length: 16 }, () => ({ x: rnd() * W, y: 40 + rnd() * 100, r: 8 + rnd() * 20, o: 0.06 + rnd() * 0.16 }))
  const drops = Array.from({ length: 26 }, () => ({ x: rnd() * W, y: rnd() * H, r: 1 + rnd() * 2.6 }))
  const rain = Array.from({ length: 40 }, () => ({ x: rnd() * (W + 60), y: rnd() * H, l: 10 + rnd() * 18 }))
  return (
    <>
      {bokeh.map((b, i) => (
        <circle key={i} cx={b.x} cy={b.y} r={b.r} fill="#fff" opacity={b.o} />
      ))}
      <g className="ma-rain" stroke="#fff" strokeWidth="1" strokeLinecap="round" opacity="0.4">
        {rain.map((r, i) => (
          <path key={i} d={`M${r.x} ${r.y}l-${r.l * 0.25} ${r.l}`} />
        ))}
      </g>
      {drops.map((d, i) => (
        <g key={i}>
          <circle cx={d.x} cy={d.y} r={d.r} fill="#000" opacity="0.18" />
          <circle cx={d.x - d.r * 0.3} cy={d.y - d.r * 0.3} r={d.r * 0.45} fill="#fff" opacity="0.55" />
        </g>
      ))}
    </>
  )
}

function Throwback(): React.JSX.Element {
  const horizon = 108
  return (
    <>
      <clipPath id="ma-sunclip">
        <circle cx="210" cy={horizon} r="52" />
      </clipPath>
      <g className="ma-sun">
        <circle cx="210" cy={horizon} r="52" fill="url(#ma-sun)" />
        <g clipPath="url(#ma-sunclip)">
          {[0, 1, 2, 3, 4].map((i) => (
            <rect key={i} x="150" y={horizon - 30 + i * 7} width="120" height={1.5 + i * 0.9} style={{ fill: 'var(--a)' }} />
          ))}
        </g>
      </g>
      <rect y={horizon} width={W} height={H - horizon} fill="#000" opacity="0.35" />
      <g stroke="#fff" opacity="0.4" strokeWidth="1">
        {Array.from({ length: 6 }, (_, i) => {
          const y = horizon + Math.pow((i + 1) / 6, 1.8) * (H - horizon)
          return <path key={i} d={`M0 ${y}H${W}`} />
        })}
        {Array.from({ length: 15 }, (_, i) => (
          <path key={i} d={`M${210 + (i - 7) * 6} ${horizon}L${210 + (i - 7) * 70} ${H}`} />
        ))}
      </g>
    </>
  )
}

function New(): React.JSX.Element {
  const rnd = seeded(11)
  const sparks = Array.from({ length: 14 }, () => ({ x: rnd() * W, y: rnd() * H, r: 1.5 + rnd() * 4 }))
  const star = (x: number, y: number, r: number): string => {
    const k = r * 0.22
    return `M${x} ${y - r}Q${x + k} ${y - k} ${x + r} ${y}Q${x + k} ${y + k} ${x} ${y + r}Q${x - k} ${y + k} ${x - r} ${y}Q${x - k} ${y - k} ${x} ${y - r}Z`
  }
  return (
    <>
      <g className="ma-rays" style={{ transformOrigin: '226px 76px' }} opacity="0.16" fill="#fff">
        {Array.from({ length: 12 }, (_, i) => (
          <path key={i} d="M226 76L220 -60L232 -60Z" transform={`rotate(${i * 30} 226 76)`} />
        ))}
      </g>
      <circle cx="226" cy="76" r="60" fill="url(#ma-glow)" />
      <path className="ma-star" d={star(226, 76, 34)} fill="#fff" />
      <g className="ma-sparks" fill="#fff">
        {sparks.map((s, i) => (
          <path key={i} d={star(s.x, s.y, s.r)} opacity={0.5 + (i % 3) * 0.2} />
        ))}
      </g>
    </>
  )
}

const SCENES: Record<MoodArtKind, () => React.JSX.Element> = {
  drive: Drive,
  gym: Gym,
  chill: Chill,
  party: Party,
  focus: Focus,
  sad: Sad,
  throwback: Throwback,
  new: New
}

export function MoodArt({ kind }: { kind: MoodArtKind }): React.JSX.Element {
  const Scene = SCENES[kind]
  return (
    <svg className={`moodart moodart--${kind}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="ma-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000" stopOpacity="0.45" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="ma-haze" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.22" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="ma-lamp">
          <stop offset="0" stopColor="#ffe9a8" stopOpacity="0.75" />
          <stop offset="1" stopColor="#ffe9a8" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="ma-glow">
          <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="ma-ball" cx="0.35" cy="0.3">
          <stop offset="0" stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.55" />
        </radialGradient>
        <linearGradient id="ma-sun" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff6c2" />
          <stop offset="1" stopColor="#ff7aa8" />
        </linearGradient>
      </defs>
      <Scene />
    </svg>
  )
}
