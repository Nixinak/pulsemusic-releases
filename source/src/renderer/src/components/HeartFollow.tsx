// Follow as a heart: following makes it pop (with a little burst), unfollowing breaks it in two.
import { useEffect, useId, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import * as sp from '@/lib/spotify'
import { useApp, errorText } from '@/lib/store'
import { invalidate } from '@/lib/useQuery'

const HEART = 'M12 20.5s-7.6-4.6-9.5-9.4C1.2 7.8 3.3 4 7 4c2.1 0 3.6 1.1 5 2.9C13.4 5.1 14.9 4 17 4c3.7 0 5.8 3.8 4.5 7.1-1.9 4.8-9.5 9.4-9.5 9.4Z'
// the crack runs down the middle in a zigzag
const LEFT = '0,0 12,0 12,6.9 10.2,10.4 13,13.3 11,17 12,24 0,24'
const RIGHT = '12,0 24,0 24,24 12,24 11,17 13,13.3 10.2,10.4 12,6.9'
const BURST = [0, 60, 120, 180, 240, 300]

export function HeartFollow({ uri, name }: { uri: string; name?: string }): React.JSX.Element {
  const [following, setFollowing] = useState<boolean | null>(null)
  // bumps on every change so the animation plays again
  const [fx, setFx] = useState<{ kind: 'like' | 'break'; n: number } | null>(null)
  const toast = useApp((s) => s.toast)
  const id = useId().replace(/:/g, '')

  useEffect(() => {
    setFx(null)
    sp.libraryContains([uri])
      .then(([v]) => setFollowing(!!v))
      .catch(() => setFollowing(false))
  }, [uri])

  const toggle = async (): Promise<void> => {
    const next = !following
    setFollowing(next)
    setFx((f) => ({ kind: next ? 'like' : 'break', n: (f?.n ?? 0) + 1 }))
    try {
      if (next) await sp.saveToLibrary([uri])
      else await sp.removeFromLibrary([uri])
      invalidate('lib:artists')
    } catch (e) {
      setFollowing(!next)
      setFx(null)
      toast(errorText(e), 'error')
    }
  }

  const label = following ? `Unfollow${name ? ` ${name}` : ''}` : `Follow${name ? ` ${name}` : ''}`
  return (
    <button className={`heart-follow ${following ? 'is-on' : ''}`} disabled={following === null} aria-label={label} aria-pressed={!!following} title={following ? 'Following' : 'Follow'} onClick={() => void toggle()}>
      <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" className="heart-follow__svg">
        <defs>
          <clipPath id={`${id}l`}>
            <polygon points={LEFT} />
          </clipPath>
          <clipPath id={`${id}r`}>
            <polygon points={RIGHT} />
          </clipPath>
        </defs>
        {/* the outline is always there; the filled heart sits on top while following */}
        <motion.path
          d={HEART}
          className="heart-follow__outline"
          initial={false}
          animate={{ opacity: following ? 0 : 1 }}
          transition={{ delay: fx?.kind === 'break' && !following ? 0.35 : 0, duration: 0.25 }}
        />
        <AnimatePresence>
          {following && (
            <motion.path
              key={`fill${fx?.n ?? 0}`}
              d={HEART}
              className="heart-follow__fill"
              initial={fx?.kind === 'like' ? { scale: 0.2 } : false}
              animate={{ scale: [fx?.kind === 'like' ? 0.2 : 1, fx?.kind === 'like' ? 1.3 : 1, 1] }}
              exit={{ opacity: 0, transition: { duration: 0 } }}
              transition={{ duration: 0.45, times: [0, 0.55, 1], ease: 'easeOut' }}
            />
          )}
        </AnimatePresence>
        {/* unfollow: the two halves of the filled heart crack apart and fall away */}
        <AnimatePresence>
          {fx?.kind === 'break' && !following && (
            <g key={`break${fx.n}`}>
              {[
                { clip: `${id}l`, x: -4, r: -28 },
                { clip: `${id}r`, x: 4, r: 28 }
              ].map((h) => (
                <motion.g
                  key={h.clip}
                  style={{ originX: 0.5, originY: 1 }}
                  initial={{ x: 0, y: 0, rotate: 0, opacity: 1 }}
                  animate={{ x: [0, h.x * 0.2, h.x], y: [0, 0, 9], rotate: [0, h.r * 0.25, h.r], opacity: [1, 1, 0] }}
                  transition={{ duration: 0.7, times: [0, 0.25, 1], ease: 'easeIn' }}
                >
                  <path d={HEART} className="heart-follow__fill" clipPath={`url(#${h.clip})`} />
                </motion.g>
              ))}
            </g>
          )}
        </AnimatePresence>
      </svg>
      {/* follow: a ring of sparks */}
      <AnimatePresence>
        {fx?.kind === 'like' && following && (
          <span key={`burst${fx.n}`} className="heart-follow__burst" aria-hidden="true">
            <motion.i className="heart-follow__ring" initial={{ scale: 0.3, opacity: 0.9 }} animate={{ scale: 1.6, opacity: 0 }} transition={{ duration: 0.55, ease: 'easeOut' }} />
            {BURST.map((a) => (
              <motion.i
                key={a}
                className="heart-follow__spark"
                initial={{ x: 0, y: 0, scale: 1, opacity: 1 }}
                animate={{ x: Math.cos((a * Math.PI) / 180) * 30, y: Math.sin((a * Math.PI) / 180) * 30, scale: 0, opacity: 0 }}
                transition={{ duration: 0.6, ease: 'easeOut', delay: 0.08 }}
              />
            ))}
          </span>
        )}
      </AnimatePresence>
    </button>
  )
}
