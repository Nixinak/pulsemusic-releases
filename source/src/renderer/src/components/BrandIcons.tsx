// Small logos for an artist's profile links (simple line/solid marks, drawn at 24 px).
import { GlobeIcon } from './Icons'

type P = { size?: number }

const Svg = ({ size = 20, children, solid }: P & { children: React.ReactNode; solid?: boolean }): React.JSX.Element => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={solid ? 'currentColor' : 'none'}
    stroke={solid ? 'none' : 'currentColor'}
    strokeWidth={1.9}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
)

const MARKS: Record<string, (p: P) => React.JSX.Element> = {
  instagram: (p) => (
    <Svg {...p}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r=".6" fill="currentColor" />
    </Svg>
  ),
  youtube: (p) => (
    <Svg {...p} solid>
      <path fillRule="evenodd" d="M2.5 8.2c.2-1.8 1.4-3 3.2-3.1C7.6 5 9.8 5 12 5s4.4 0 6.3.1c1.8.1 3 1.3 3.2 3.1.1 1.2.2 2.5.2 3.8s-.1 2.6-.2 3.8c-.2 1.8-1.4 3-3.2 3.1-1.9.1-4.1.1-6.3.1s-4.4 0-6.3-.1c-1.8-.1-3-1.3-3.2-3.1C2.4 14.6 2.3 13.3 2.3 12s.1-2.6.2-3.8ZM10 8.8v6.4l5.4-3.2Z" />
    </Svg>
  ),
  tiktok: (p) => (
    <Svg {...p}>
      <path d="M14 3.5v11.2a3.8 3.8 0 1 1-3.8-3.8" />
      <path d="M14 3.5c.4 2.6 2.4 4.4 5 4.6" />
    </Svg>
  ),
  x: (p) => (
    <Svg {...p}>
      <path d="M4.5 4h4l11 16h-4Z" />
      <path d="M19.5 4l-6.3 7.2M10.8 12.8 4.5 20" />
    </Svg>
  ),
  facebook: (p) => (
    <Svg {...p}>
      <path d="M14.5 21v-8h3l.4-3.4h-3.4V7.6c0-1 .3-1.7 1.7-1.7H18V3.1A24 24 0 0 0 15.6 3C13 3 11.3 4.6 11.3 7.4v2.2H8.4V13h2.9v8" />
    </Svg>
  ),
  soundcloud: (p) => (
    <Svg {...p}>
      <path d="M10.5 17V9.2a5 5 0 0 1 9.4 2.2 2.8 2.8 0 0 1-.5 5.6Z" />
      <path d="M7.5 10.5V17M4.5 12.5V17" />
    </Svg>
  ),
  twitch: (p) => (
    <Svg {...p}>
      <path d="M5 3.5h14.5v9.5l-4 4h-4l-3 3v-3H5Z" />
      <path d="M11 8v4M15 8v4" />
    </Svg>
  ),
  bandcamp: (p) => (
    <Svg {...p} solid>
      <path d="M2.5 18 8.5 6h13l-6 12Z" />
    </Svg>
  ),
  apple: (p) => (
    <Svg {...p}>
      <path d="M9 18V6l10-2v12" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="16.5" cy="16" r="2.5" />
    </Svg>
  ),
  deezer: (p) => (
    <Svg {...p}>
      <path d="M4 19v-3M9 19v-6M14 19v-9M19 19V5" />
    </Svg>
  ),
  genius: (p) => (
    <Svg {...p}>
      <path d="M12 3a9 9 0 1 0 9 9h-8" />
    </Svg>
  ),
  wikipedia: (p) => (
    <Svg {...p}>
      <path d="m3 6 4.5 12L12 8l4.5 10L21 6" />
    </Svg>
  )
}

export function BrandIcon({ kind, size = 20 }: { kind: string; size?: number }): React.JSX.Element {
  const Mark = MARKS[kind]
  return Mark ? <Mark size={size} /> : <GlobeIcon size={size} />
}
