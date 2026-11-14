// The like (heart) button: an outline heart that fills with the accent gradient, pops and
// throws a small burst of sparks when you like a song. Used in the player bar and Now Playing.
import { useId, useRef, useState } from 'react'
import { toggleLike } from '@/lib/player'

const HEART =
  'M12 20.3s-7.8-4.6-8.9-9.9C2.4 7 4.6 4.2 7.7 4.2c1.9 0 3.3 1 4.3 2.5 1-1.5 2.4-2.5 4.3-2.5 3.1 0 5.3 2.8 4.6 6.2-1.1 5.3-8.9 9.9-8.9 9.9Z'

const reduceMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

export function LikeButton({
  liked,
  size = 20,
  variant = 'bar'
}: {
  liked: boolean
  size?: number
  /** "np" sits on artwork colours in Now Playing, so it fills white instead of the accent. */
  variant?: 'bar' | 'np'
}): React.JSX.Element {
  const gid = `like${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const heart = useRef<SVGSVGElement>(null)
  const [burst, setBurst] = useState(0)

  const onClick = (): void => {
    const el = heart.current
    if (!liked) {
      if (!reduceMotion()) setBurst((n) => n + 1)
      el?.animate(
        [
          { transform: 'scale(1)' },
          { transform: 'scale(0.7)', offset: 0.18 },
          { transform: 'scale(1.32)', offset: 0.5 },
          { transform: 'scale(0.94)', offset: 0.75 },
          { transform: 'scale(1)' }
        ],
        { duration: 560, easing: 'ease-out' }
      )
    } else {
      el?.animate([{ transform: 'scale(1)' }, { transform: 'scale(0.78)' }, { transform: 'scale(1)' }], {
        duration: 260,
        easing: 'ease-out'
      })
    }
    void toggleLike()
  }

  return (
    <button
      className={`like like--${variant} ${liked ? 'is-liked' : ''}`}
      aria-label={liked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
      aria-pressed={liked}
      onClick={onClick}
    >
      {burst > 0 && (
        <span key={burst} className="like__burst" aria-hidden="true">
          <i className="like__ring" />
          {Array.from({ length: 8 }, (_, i) => (
            <i key={i} className="like__spark" style={{ ['--i' as string]: i }} />
          ))}
        </span>
      )}
      <svg ref={heart} className="like__heart" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--like-a)' }} />
            <stop offset="1" style={{ stopColor: 'var(--like-b)' }} />
          </linearGradient>
        </defs>
        <path className="like__outline" d={HEART} />
        <path className="like__fill" d={HEART} fill={`url(#${gid})`} />
        <path className="like__shine" d="M6.4 7.2c.6-.9 1.6-1.3 2.5-1.1" />
      </svg>
    </button>
  )
}
