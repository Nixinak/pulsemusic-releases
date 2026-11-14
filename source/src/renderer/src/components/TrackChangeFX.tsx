// The one orchestrated moment on song change: a wash of the new song's colours
// blooms out from the artwork in the player bar and settles into the background.
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { usePlayer } from '@/lib/player'
import { useApp } from '@/lib/store'
import { extractPalette } from '@/lib/colors'

export function TrackChangeFX(): React.JSX.Element {
  const trackId = usePlayer((s) => s.track?.id)
  const art = usePlayer((s) => s.track?.artUrl)
  const reduce = useApp((s) => s.settings.reduceMotion)
  const [burst, setBurst] = useState<{ key: string; colors: string[] } | null>(null)
  const prev = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!trackId) return
    const first = prev.current === undefined
    prev.current = trackId
    if (first || reduce || !art) return
    let alive = true
    extractPalette(art)
      .then((p) => alive && setBurst({ key: trackId, colors: p.colors }))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [trackId, art, reduce])

  return (
    <AnimatePresence>
      {burst && (
        <motion.div
          key={burst.key}
          className="fx-bloom"
          aria-hidden="true"
          style={{
            background: `radial-gradient(circle at 24% 92%, ${burst.colors[0]} 0%, ${burst.colors[1]} 20%, ${burst.colors[2]} 38%, transparent 62%)`
          }}
          initial={{ opacity: 0, scale: 0.25 }}
          animate={{ opacity: [0, 0.5, 0], scale: [0.3, 1.25, 1.8] }}
          transition={{ duration: 2.4, times: [0, 0.4, 1], ease: [0.22, 1, 0.36, 1] }}
          onAnimationComplete={() => setBurst((b) => (b?.key === burst.key ? null : b))}
        />
      )}
    </AnimatePresence>
  )
}
