// Song transition visuals: both covers side by side while one song hands over to the next.
// Approach: the current cover tilts back and dims as the next comes forward, joined by a
// filling wave. Landing: the old cover slides away and the new one settles with a pulse.
import { useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useTransition } from '@/lib/transition'
import { useApp } from '@/lib/store'
import { usePlayer } from '@/lib/player'
import { Glass } from './Glass'
import { Cover } from './common'

/** The covers, wave and title. `big` is the Now Playing version. */
export function TransitionStage({ big = false }: { big?: boolean }): React.JSX.Element | null {
  const phase = useTransition((s) => s.phase)
  const progress = useTransition((s) => s.progress)
  // how far the next cover travels to take the current one's place (measured, so it lands
  // exactly there whatever the sizes)
  const fromRef = useRef<HTMLDivElement>(null)
  const toRef = useRef<HTMLDivElement>(null)
  const [shift, setShift] = useState(big ? 260 : 162)
  useLayoutEffect(() => {
    if (fromRef.current && toRef.current) setShift(toRef.current.offsetLeft - fromRef.current.offsetLeft)
  }, [phase.kind, big])
  if (phase.kind === 'idle') return null
  const landing = phase.kind === 'land'
  const p = landing ? 1 : progress

  return (
    <div className={`xstage ${big ? 'xstage--big' : ''}`}>
      <div className="xstage__covers">
        <motion.div
          ref={fromRef}
          className="xstage__cover"
          // Starting pose, used when a skip goes straight to the landing.
          initial={{ x: 0, opacity: 1, scale: 1, rotateY: 0, filter: 'blur(0px)' }}
          animate={
            landing
              ? { x: -40, opacity: 0, scale: 0.7, rotateY: 35, filter: 'blur(6px)' }
              : { x: 0, opacity: 1 - p * 0.55, scale: 1 - p * 0.18, rotateY: p * 22, filter: `blur(${p * 2}px)` }
          }
          transition={landing ? { duration: 0.55, ease: [0.22, 1, 0.36, 1] } : { duration: 0.15 }}
        >
          <Cover src={phase.from.artUrl} radius={big ? 20 : 12} />
        </motion.div>

        <motion.div
          className="xstage__wave"
          initial={{ opacity: 1, scaleX: 1 }}
          animate={landing ? { opacity: 0, scaleX: 0 } : { opacity: 1, scaleX: 1 }}
          transition={{ duration: 0.3 }}
        >
          <span className="xstage__wave-fill" style={{ transform: `scaleX(${p})` }} />
          <span className="xstage__wave-dot" style={{ left: `${p * 100}%` }} />
        </motion.div>

        <motion.div
          ref={toRef}
          className="xstage__cover xstage__cover--next"
          initial={{ x: 0, opacity: 0.45, scale: 0.82, rotateY: -22, filter: 'blur(2px)' }}
          animate={
            landing
              ? { x: -shift, opacity: 1, scale: 1, rotateY: 0, filter: 'blur(0px)' }
              : { x: 0, opacity: 0.45 + p * 0.55, scale: 0.82 + p * 0.18, rotateY: -22 + p * 22, filter: `blur(${(1 - p) * 2}px)` }
          }
          transition={landing ? { type: 'spring', stiffness: 170, damping: 22, delay: 0.1 } : { duration: 0.15 }}
        >
          <Cover src={phase.to.artUrl} radius={big ? 20 : 12} />
          {landing && (
            <motion.span
              className="xstage__ring"
              initial={{ opacity: 0.8, scale: 1 }}
              animate={{ opacity: 0, scale: 1.6 }}
              transition={{ duration: 0.9, delay: 0.45, ease: 'easeOut' }}
            />
          )}
        </motion.div>
      </div>
      <div className="xstage__text">
        <span className="xstage__label">{landing ? 'Now playing' : 'Up next'}</span>
        <span className="xstage__title">{phase.to.name}</span>
        <span className="xstage__artist">{phase.to.artists}</span>
        <FadeStatus landing={landing} />
      </div>
    </div>
  )
}

/** Live readout of the sound fade, so it is clear the transition is doing something. */
function FadeStatus({ landing }: { landing: boolean }): React.JSX.Element {
  const isLocal = usePlayer((s) => s.isLocal)
  const gain = usePlayer((s) => s.fadeGain)
  if (!isLocal) return <span className="xstage__fade">Sound fades only on this computer</span>
  const pct = Math.round(gain * 100)
  return (
    <span className="xstage__fade">
      <span className="xstage__meter" aria-hidden="true">
        <span style={{ transform: `scaleX(${gain})` }} />
      </span>
      {landing ? 'Fading in' : 'Fading out'} · {pct} %
    </span>
  )
}

/** Floating version above the player bar (Now Playing shows the big one in its panel). */
export function TransitionCard(): React.JSX.Element {
  const active = useTransition((s) => s.phase.kind !== 'idle')
  const npShowsIt = useApp((s) => s.nowPlaying && s.npPanel !== 'none')
  return (
    <AnimatePresence>
      {active && !npShowsIt && (
        <motion.div
          key="xfade"
          className="xfade"
          initial={{ opacity: 0, y: 30, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.94, transition: { duration: 0.35 } }}
          transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        >
          <Glass radius={28} tone="regular" bezel={18} refraction={52} className="xfade__card">
            <TransitionStage />
          </Glass>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
