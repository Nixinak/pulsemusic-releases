// Little illustrations for the "Ask the DJ for" mood cards: dumbbells for Gym, a rain cloud
// for Sad hours, and so on. Drawn in white so they sit on any card gradient; each one gets
// its own small hover animation (see .moodart in v3.css).

export type MoodArtKind = 'drive' | 'gym' | 'chill' | 'party' | 'focus' | 'sad' | 'throwback' | 'new'

const S = { stroke: '#fff', strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
const SOFT = 'rgba(255,255,255,0.2)'

function Spark({ x, y, r = 4, className = '' }: { x: number; y: number; r?: number; className?: string }): React.JSX.Element {
  const k = r * 0.28
  return (
    <path
      className={`ma-twinkle ${className}`}
      d={`M${x} ${y - r}Q${x + k} ${y - k} ${x + r} ${y}Q${x + k} ${y + k} ${x} ${y + r}Q${x - k} ${y + k} ${x - r} ${y}Q${x - k} ${y - k} ${x} ${y - r}Z`}
      fill="#fff"
    />
  )
}

function Drive(): React.JSX.Element {
  return (
    <>
      {/* Moon */}
      <path className="ma-moon" d="M49.6 11.2A13 13 0 1 0 64.8 26.4A11 11 0 0 1 49.6 11.2Z" fill="#fff" />
      <Spark x={22} y={14} r={3.5} />
      <Spark x={33} y={27} r={2.5} className="ma-d2" />
      <Spark x={70} y={44} r={2.5} className="ma-d3" />
      {/* Road running to the horizon */}
      <path d="M8 78L36 48H44L72 78Z" fill={SOFT} />
      <path d="M8 78L36 48M72 78L44 48" {...S} strokeWidth={2.5} fill="none" />
      <path className="ma-road" d="M40 50V78" {...S} strokeWidth={2.5} strokeDasharray="4 5" fill="none" />
    </>
  )
}

function Gym(): React.JSX.Element {
  return (
    <>
      <g className="ma-lift">
        <g transform="translate(0 -5) rotate(-28 40 42)">
          <rect x="14" y="39" width="52" height="6" rx="3" fill="#fff" />
          <rect x="13" y="25" width="10" height="34" rx="3.5" fill={SOFT} {...S} />
          <rect x="5" y="30" width="8" height="24" rx="3" fill={SOFT} {...S} />
          <rect x="57" y="25" width="10" height="34" rx="3.5" fill={SOFT} {...S} />
          <rect x="67" y="30" width="8" height="24" rx="3" fill={SOFT} {...S} />
          <path d="M31 39.5v5M35 39.5v5M45 39.5v5M49 39.5v5" stroke="rgba(0,0,0,0.25)" strokeWidth={1.5} />
        </g>
      </g>
      {/* Effort lines */}
      <path className="ma-pump" d="M60 10l3 5M69 15l-2 5M52 8l1 4" {...S} strokeWidth={2.5} fill="none" />
    </>
  )
}

function Chill(): React.JSX.Element {
  return (
    <>
      <path className="ma-sun" d="M22 48A18 18 0 0 1 58 48Z" fill="#fff" />
      <path d="M40 22v-6M24 30l-4-4M56 30l4-4M16 44h-5M64 44h5" {...S} strokeWidth={2.5} fill="none" opacity={0.85} />
      <g className="ma-waves" fill="none" {...S}>
        <path d="M-30 56q6-5 12 0t12 0 12 0 12 0 12 0 12 0 12 0 12 0 12 0 12 0 12 0 12 0 12 0" />
        <path d="M-36 65q6-5 12 0t12 0 12 0 12 0 12 0 12 0 12 0 12 0 12 0 12 0 12 0 12 0 12 0" opacity={0.75} />
        <path d="M-30 74q6-5 12 0t12 0 12 0 12 0 12 0 12 0 12 0 12 0 12 0 12 0 12 0 12 0 12 0" opacity={0.5} />
      </g>
    </>
  )
}

function Party(): React.JSX.Element {
  return (
    <>
      <g className="ma-sway">
        <path d="M40 2v18" {...S} strokeWidth={2} />
        <circle cx="40" cy="42" r="21" fill={SOFT} {...S} />
        <g fill="none" stroke="#fff" strokeWidth={1.6} opacity={0.8}>
          <ellipse cx="40" cy="42" rx="8" ry="21" />
          <ellipse cx="40" cy="42" rx="15" ry="21" />
          <path d="M20 35h40M19 42h42M20 49h40M23 28h34M23 56h34" />
        </g>
        <rect x="27" y="29" width="6" height="6" rx="1" fill="#fff" />
        <rect x="34" y="36" width="5" height="5" rx="1" fill="#fff" opacity={0.7} />
      </g>
      <Spark x={67} y={18} r={5} />
      <Spark x={12} y={62} r={4} className="ma-d2" />
      <g className="ma-confetti" fill="#fff">
        <rect x="10" y="16" width="5" height="3" rx="1" transform="rotate(25 12 17)" />
        <rect x="66" y="58" width="5" height="3" rx="1" transform="rotate(-30 68 59)" />
        <circle cx="70" cy="34" r="2" />
        <circle cx="16" cy="40" r="1.8" />
      </g>
    </>
  )
}

function Focus(): React.JSX.Element {
  return (
    <>
      <circle cx="36" cy="46" r="26" fill={SOFT} {...S} />
      <circle cx="36" cy="46" r="17" fill="none" {...S} />
      <circle cx="36" cy="46" r="8" fill="#fff" />
      <g className="ma-arrow">
        <path d="M37 45L70 12" {...S} fill="none" />
        <path d="M64 8l6 4-2 8M70 12l-9 1" {...S} strokeWidth={2.5} fill="none" />
        <path d="M70 12l6-3M70 12l3-6" {...S} strokeWidth={2.5} fill="none" />
      </g>
    </>
  )
}

function Sad(): React.JSX.Element {
  return (
    <>
      <path
        d="M22 44h38a12 12 0 0 0 0-24 16 16 0 0 0-30-4 13 13 0 0 0-8 28Z"
        fill="rgba(255,255,255,0.9)"
      />
      <g className="ma-rain" {...S} strokeWidth={2.5} fill="none">
        <path className="ma-drop" d="M28 52l-3 7" />
        <path className="ma-drop ma-d2" d="M42 52l-3 7" />
        <path className="ma-drop ma-d3" d="M56 52l-3 7" />
        <path className="ma-drop ma-d4" d="M35 64l-3 7" />
        <path className="ma-drop ma-d5" d="M49 64l-3 7" />
      </g>
    </>
  )
}

function Throwback(): React.JSX.Element {
  const reel = (cx: number): React.JSX.Element => (
    <g className="ma-reel">
      <circle cx={cx} cy="44" r="6.5" fill="#fff" />
      <path d={`M${cx} 40v8M${cx - 4} 44h8`} stroke="rgba(0,0,0,0.35)" strokeWidth={1.8} strokeLinecap="round" />
    </g>
  )
  return (
    <g transform="rotate(-10 40 42)">
      <rect x="6" y="18" width="68" height="46" rx="7" fill={SOFT} {...S} />
      <rect x="13" y="25" width="54" height="26" rx="4" fill="rgba(255,255,255,0.3)" />
      <rect x="31" y="39" width="18" height="10" rx="2" fill="rgba(0,0,0,0.2)" />
      {reel(24)}
      {reel(56)}
      <path d="M20 64l4-9h32l4 9" {...S} strokeWidth={2.5} fill="none" />
      <path d="M17 31h20" stroke="#fff" strokeWidth={2} strokeLinecap="round" opacity={0.9} />
    </g>
  )
}

function New(): React.JSX.Element {
  return (
    <>
      <g className="ma-spin">
        <polygon
          points="40.0,18.0 44.3,23.0 50.4,20.4 52.2,26.8 58.8,27.0 57.6,33.5 63.4,36.7 59.5,42.0 63.4,47.3 57.6,50.5 58.8,57.0 52.2,57.2 50.4,63.6 44.3,61.0 40.0,66.0 35.7,61.0 29.6,63.6 27.8,57.2 21.2,57.0 22.4,50.5 16.6,47.3 20.5,42.0 16.6,36.7 22.4,33.5 21.2,27.0 27.8,26.8 29.6,20.4 35.7,23.0"
          fill="#fff"
        />
      </g>
      <text x="40" y="46.5" textAnchor="middle" fontSize="12.5" fontWeight="900" fill="var(--a)" style={{ fontFamily: 'var(--font-display)', letterSpacing: '0.02em' }}>
        NEW
      </text>
      <Spark x={10} y={14} r={4.5} />
      <Spark x={70} y={70} r={3.5} className="ma-d2" />
      <Spark x={68} y={12} r={2.5} className="ma-d3" />
    </>
  )
}

const ART: Record<MoodArtKind, () => React.JSX.Element> = {
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
  const Art = ART[kind]
  return (
    <svg className={`moodart moodart--${kind}`} viewBox="0 0 80 80" aria-hidden="true" overflow="visible">
      <Art />
    </svg>
  )
}
