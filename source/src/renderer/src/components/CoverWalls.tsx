// Artwork scenery for page heads: a corridor of covers flowing towards you, two rings of
// covers turning like a carousel (Party), and a fanned stack of covers (Mix, Friends).
// All plain CSS 3D, so they cost almost nothing.
import { Cover } from './common'

/** Repeats a list until it has at least `min` entries (empty stays empty). */
function fill<T>(list: T[], min: number): T[] {
  if (!list.length) return []
  const out: T[] = []
  while (out.length < min) out.push(...list)
  return out
}

/** Two walls of covers receding to a vanishing point, drifting towards the viewer forever. */
export function CoverTunnel({ images, className = '' }: { images: (string | null)[]; className?: string }): React.JSX.Element {
  const list = fill(images.filter(Boolean), 36)
  const left = list.filter((_, i) => i % 2 === 0)
  const right = list.filter((_, i) => i % 2 === 1)
  // each wall holds its covers twice, so sliding by half a wall loops without a seam
  const wall = (items: (string | null)[], side: 'l' | 'r'): React.JSX.Element => (
    <div className={`tunnel__wall tunnel__wall--${side}`}>
      <div className="tunnel__belt" style={{ '--n': items.length } as React.CSSProperties}>
        {[...items, ...items].map((src, i) => (
          <span key={i} className={`tunnel__tile tunnel__tile--${i % 3}`}>
            <Cover src={src} radius={6} />
          </span>
        ))}
      </div>
    </div>
  )
  return (
    <div className={`tunnel ${className}`} aria-hidden="true">
      {list.length > 0 && (
        <>
          {wall(left, 'l')}
          {wall(right, 'r')}
        </>
      )}
      <div className="tunnel__fog" />
    </div>
  )
}

/** A fanned stack of covers: one in front, the others tucked behind at angles. */
export function CoverStack({ images, className = '' }: { images: (string | null)[]; className?: string }): React.JSX.Element {
  const list = images.filter(Boolean).slice(0, 7)
  // positions around the front card: x, y (in % of a card), rotation, depth
  const spots = [
    [0, 0, 0, 0],
    [-52, -14, -9, 1],
    [50, -10, 8, 1],
    [-30, 22, -4, 2],
    [34, 26, 5, 2],
    [-74, 10, -14, 3],
    [76, 14, 13, 3]
  ]
  return (
    <div className={`cstack ${className}`} aria-hidden="true">
      {list.map((src, i) => {
        const [x, y, r, d] = spots[i]
        return (
          <span
            key={`${src}-${i}`}
            className="cstack__card"
            style={
              {
                '--x': `${x}%`,
                '--y': `${y}%`,
                '--r': `${r}deg`,
                '--d': d,
                zIndex: 10 - d
              } as React.CSSProperties
            }
          >
            <Cover src={src} radius={14} />
          </span>
        )
      })}
    </div>
  )
}

/** Two rings of covers turning in opposite directions around the page title, like a disco carousel. */
export function CoverCarousel({ images, className = '' }: { images: (string | null)[]; className?: string }): React.JSX.Element {
  const list = fill(images.filter(Boolean), 28).slice(0, 28)
  const rings = [list.filter((_, i) => i % 2 === 0), list.filter((_, i) => i % 2 === 1)]
  return (
    <div className={`carousel ${className}`} aria-hidden="true">
      {list.length > 0 &&
        rings.map((ring, k) => (
          <div key={k} className={`carousel__ring carousel__ring--${k}`} style={{ '--n': ring.length } as React.CSSProperties}>
            {ring.map((src, i) => (
              <span key={i} className="carousel__tile" style={{ '--i': i } as React.CSSProperties}>
                <Cover src={src} radius={10} />
              </span>
            ))}
          </div>
        ))}
      <div className="carousel__beams" />
      <div className="carousel__fog" />
    </div>
  )
}
