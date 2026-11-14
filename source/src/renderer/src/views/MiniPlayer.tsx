// Always-on-top mini player. Mirrors state from the main window over IPC.
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { EMPTY_SNAPSHOT, type PlaybackSnapshot } from '@shared/types'
import { applyPalette, extractPalette } from '@/lib/colors'
import { formatTime } from '@/lib/format'
import { Cover } from '@/components/common'
import { ExpandIcon, HeartIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon } from '@/components/Icons'

export function MiniPlayer(): React.JSX.Element {
  const [s, setS] = useState<PlaybackSnapshot>(EMPTY_SNAPSHOT)
  const [, tick] = useState(0)

  useEffect(() => {
    document.documentElement.classList.add('is-mini')
    return window.pulse.playback.onSnapshot(setS)
  }, [])

  useEffect(() => {
    if (s.artUrl) void extractPalette(s.artUrl).then(applyPalette).catch(() => {})
  }, [s.artUrl])

  useEffect(() => {
    if (s.paused) return
    const t = window.setInterval(() => tick((n) => n + 1), 500)
    return () => clearInterval(t)
  }, [s.paused])

  const pos = s.paused ? s.positionMs : Math.min(s.durationMs, s.positionMs + (Date.now() - s.sampledAt))
  const pct = s.durationMs ? (pos / s.durationMs) * 100 : 0
  const cmd = window.pulse.playback.command

  return (
    <div className="mini">
      <div className="mini__tint" />
      <AnimatePresence mode="wait">
        <motion.div
          key={s.trackId ?? 'none'}
          className="mini__art"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        >
          <Cover src={s.artUrl} radius={12} />
        </motion.div>
      </AnimatePresence>
      <div className="mini__body">
        <div className="mini__meta">
          <span className="mini__title">{s.hasTrack ? s.title : 'Nothing playing'}</span>
          <span className="mini__artist">{s.artists}</span>
        </div>
        <div className="mini__controls">
          <button className="icon-btn icon-btn--sm" aria-label="Like" aria-pressed={s.liked} onClick={() => cmd({ type: 'like' })} disabled={!s.hasTrack}>
            <HeartIcon size={16} filled={s.liked} />
          </button>
          <button className="icon-btn icon-btn--sm" aria-label="Previous" onClick={() => cmd({ type: 'previous' })} disabled={!s.hasTrack}>
            <PrevIcon size={17} />
          </button>
          <button className="mini__play" aria-label={s.paused ? 'Play' : 'Pause'} onClick={() => cmd({ type: 'toggle' })} disabled={!s.hasTrack}>
            {s.paused ? <PlayIcon size={18} /> : <PauseIcon size={18} />}
          </button>
          <button className="icon-btn icon-btn--sm" aria-label="Next" onClick={() => cmd({ type: 'next' })} disabled={!s.hasTrack}>
            <NextIcon size={17} />
          </button>
          <button className="icon-btn icon-btn--sm" aria-label="Open Pulse Music" onClick={() => window.pulse.window.showMain()}>
            <ExpandIcon size={16} />
          </button>
        </div>
        <div className="mini__progress">
          <span>{formatTime(pos)}</span>
          <div className="mini__bar">
            <div style={{ width: `${pct}%` }} />
          </div>
          <span>{formatTime(s.durationMs)}</span>
        </div>
      </div>
    </div>
  )
}
