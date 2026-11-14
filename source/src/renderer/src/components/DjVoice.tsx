// What you see while the AI DJ talks: a soft glow rising from the bottom of the window that
// breathes with the voice, and a floating caption with a live waveform where the words light
// up as they are spoken. Everything updates in requestAnimationFrame without React renders.
import { useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { useDj, voiceLevel, voiceProgress } from '@/lib/dj'
import { useApp, currentRoute } from '@/lib/store'

/** Runs `fn` every frame while `on` is true. */
function useFrame(on: boolean, fn: () => void): void {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    if (!on) return
    let raf = 0
    const loop = (): void => {
      ref.current()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [on])
}

/** The DJ's line, lit word by word in step with the voice. */
export function SpokenLine({ text, className = '', live }: { text: string; className?: string; live: boolean }): React.JSX.Element {
  const words = useMemo(() => text.split(/\s+/).filter(Boolean), [text])
  // Longer words take longer to say, so they get a bigger share of the time.
  const ends = useMemo(() => {
    const w = words.map((x) => x.length + 2)
    const total = w.reduce((a, b) => a + b, 0) || 1
    let acc = 0
    return w.map((n) => (acc += n) / total)
  }, [words])
  const box = useRef<HTMLSpanElement>(null)
  const last = useRef(-1)
  useEffect(() => {
    last.current = -1
  }, [text])
  useFrame(live, () => {
    const el = box.current
    if (!el) return
    const p = voiceProgress()
    let n = ends.findIndex((e) => p < e)
    if (n < 0) n = words.length
    if (n === last.current) return
    last.current = n
    el.querySelectorAll<HTMLElement>('.spoken__w').forEach((w, i) => w.classList.toggle('is-said', i < n || (i === n && p > 0)))
  })
  return (
    <span ref={box} className={`spoken ${live ? 'is-live' : 'is-done'} ${className}`}>
      {words.map((w, i) => (
        <span key={`${i}-${w}`} className="spoken__w" style={{ transitionDelay: `${Math.min(i, 3) * 10}ms` }}>
          {w}{' '}
        </span>
      ))}
    </span>
  )
}

const BARS = [0.55, 0.9, 1, 0.75, 0.45, 0.8, 0.6]

export function DjVoiceOverlay(): React.JSX.Element {
  const status = useDj((s) => s.status)
  const line = useDj((s) => s.line)
  const route = useApp(currentRoute)
  const nowPlaying = useApp((s) => s.nowPlaying)
  const drawer = useApp((s) => s.queueOpen || s.lyricsOpen)
  const speaking = status === 'speaking'
  const aura = useRef<HTMLDivElement>(null)
  const pill = useRef<HTMLDivElement>(null)
  const smooth = useRef(0)
  const t0 = useRef(0)

  useFrame(speaking, () => {
    smooth.current += (voiceLevel() - smooth.current) * 0.25
    const lvl = smooth.current.toFixed(3)
    aura.current?.style.setProperty('--lvl', lvl)
    if (pill.current) {
      pill.current.style.setProperty('--lvl', lvl)
      const t = (performance.now() - t0.current) / 1000
      pill.current.querySelectorAll<HTMLElement>('.djpill__bar').forEach((b, i) => {
        const wobble = 0.65 + 0.35 * Math.sin(t * (6 + i * 1.7) + i)
        b.style.transform = `scaleY(${Math.max(0.12, smooth.current * BARS[i] * 1.6 * wobble).toFixed(3)})`
      })
    }
  })
  useEffect(() => {
    if (speaking) t0.current = performance.now()
    else smooth.current = 0
  }, [speaking])

  // Every page shows it (rendered at the top of the document, so no page or panel can cover
  // it), except the DJ page itself, which has the big orb and the same words.
  const showPill = !(route.name === 'dj' && !nowPlaying)

  return createPortal(
    <>
      <AnimatePresence>
        {speaking && (
          <motion.div
            ref={aura}
            className="djaura"
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {speaking && showPill && line && (
          <motion.div
            ref={pill}
            className={`djpill ${drawer && !nowPlaying ? 'djpill--drawer' : ''} ${nowPlaying ? 'djpill--np' : ''}`}
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: 30, scale: 0.9, filter: 'blur(10px)' }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: 16, scale: 0.96, filter: 'blur(8px)' }}
            transition={{ type: 'spring', stiffness: 260, damping: 26 }}
          >
            <span className="djpill__orb" aria-hidden="true">
              <i />
              <i />
              <b />
            </span>
            <span className="djpill__body">
              <span className="djpill__who">Pulse DJ</span>
              <SpokenLine text={line} live={speaking} className="djpill__line" />
            </span>
            <span className="djpill__wave" aria-hidden="true">
              {BARS.map((_, i) => (
                <i key={i} className="djpill__bar" />
              ))}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </>,
    document.body
  )
}
