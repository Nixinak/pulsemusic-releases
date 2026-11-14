// Pulse DJ: a stage. The song that's on fills the background, the orb in the middle moves with
// the music (its ring is the live spectrum, it jumps on every kick) and with the DJ's voice,
// the DJ's words sit under it like captions, and the request bar is right there. Below: moods
// to start a show with, and the show's rundown.
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useApp } from '@/lib/store'
import { startDj, stopDj, useDj, voiceLevel } from '@/lib/dj'
import { nextTrack, playUris, usePlayer } from '@/lib/player'
import { BANDS, readBeat, useBeat } from '@/lib/beat'
import { formatTime } from '@/lib/format'
import { ArtistLinks, Cover, EqBars, useLivePosition } from '@/components/common'
import { NextIcon, SparkleIcon } from '@/components/Icons'
import { MOODS, MoodTile } from './HomeExtras'
import { SpokenLine } from '@/components/DjVoice'
import { AiSetup } from '@/components/AiSetup'

/** The orb: a ball of the song's colours with the spectrum around it. One animation frame loop
 *  sets two CSS variables (--kick, --lvl) and draws the ring on a canvas. */
function Orb({ status, playing }: { status: string; playing: boolean }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const reduce = useApp((s) => s.settings.reduceMotion)
  useBeat(!reduce)

  useEffect(() => {
    const el = ref.current
    const cv = canvas.current
    if (!el || !cv) return
    const g = cv.getContext('2d')
    if (!g) return
    let raf = 0
    let colors = { a: '#ff4f8b', b: '#7a5cff' }
    let colorsAt = 0
    let smoothVoice = 0
    let smoothKick = 0
    const draw = (): void => {
      const now = performance.now()
      if (now - colorsAt > 1000) {
        colorsAt = now
        const cs = getComputedStyle(el)
        colors = { a: cs.getPropertyValue('--amb-1').trim() || colors.a, b: cs.getPropertyValue('--amb-2').trim() || colors.b }
      }
      const beat = readBeat()
      smoothVoice += (voiceLevel() - smoothVoice) * 0.3
      smoothKick += (beat.kick - smoothKick) * (beat.kick > smoothKick ? 0.7 : 0.25)
      el.style.setProperty('--kick', smoothKick.toFixed(3))
      el.style.setProperty('--lvl', Math.max(beat.level, smoothVoice).toFixed(3))

      // the ring: each band twice (left and right), lows at the bottom, highs at the top
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const size = cv.clientWidth
      if (cv.width !== Math.round(size * dpr)) {
        cv.width = Math.round(size * dpr)
        cv.height = Math.round(size * dpr)
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, size, size)
      const c = size / 2
      const r0 = size * 0.33 * (1 + smoothKick * 0.035)
      const grad = g.createLinearGradient(0, size, 0, 0)
      grad.addColorStop(0, colors.a)
      grad.addColorStop(1, colors.b)
      g.strokeStyle = grad
      g.lineCap = 'round'
      g.lineWidth = Math.max(2.5, size / 150)
      const total = BANDS * 2
      for (let i = 0; i < total; i++) {
        const b = i < BANDS ? i : total - 1 - i
        const v = Math.max(beat.bands[b], smoothVoice * (0.5 + 0.5 * Math.abs(Math.sin(i * 1.7))))
        const len = 3 + v * size * 0.12
        const a = Math.PI / 2 + ((i + 0.5) / total) * Math.PI * 2
        const cos = Math.cos(a)
        const sin = Math.sin(a)
        g.globalAlpha = 0.35 + Math.min(0.65, v * 1.2)
        g.beginPath()
        g.moveTo(c + cos * r0, c + sin * r0)
        g.lineTo(c + cos * (r0 + len), c + sin * (r0 + len))
        g.stroke()
      }
      g.globalAlpha = 1
      raf = requestAnimationFrame(draw)
    }
    if (reduce) {
      el.style.setProperty('--kick', '0')
      el.style.setProperty('--lvl', '0')
      return
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [reduce])

  return (
    <div ref={ref} className={`djs__orb is-${status} ${playing ? 'is-playing' : ''}`} aria-hidden="true">
      <canvas ref={canvas} className="djs__ring" />
      <span className="djs__halo" />
      <span className="djs__ball">
        <i className="djs__swirl" />
        <i className="djs__swirl djs__swirl--b" />
        <i className="djs__shine" />
      </span>
      <span className="djs__orbit" />
    </div>
  )
}

function useProblem(): { text: string | null; setup: boolean; recheck: () => void } {
  const s = useApp((st) => st.settings)
  const [ready, setReady] = useState<boolean | undefined>(undefined)
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    if (s.djProvider !== 'local') return
    void window.pulse.dj.localReady().then(setReady)
  }, [s.djProvider, nonce])
  const recheck = (): void => setNonce((n) => n + 1)
  if (s.djProvider === 'claude') return { text: s.djClaudeKey ? null : 'Add your Claude API key in Settings.', setup: false, recheck }
  if (ready === false) return { text: 'The AI DJ isn’t set up yet.', setup: true, recheck }
  return { text: null, setup: false, recheck }
}

/** The song that's on, small, at the bottom of the stage. */
function NowOnStage(): React.JSX.Element | null {
  const track = usePlayer((s) => s.track)
  const navigate = useApp((s) => s.navigate)
  const pos = useLivePosition()
  if (!track) return null
  const pct = track.durationMs ? Math.min(100, (pos / track.durationMs) * 100) : 0
  return (
    <div className="djs__now">
      <Cover src={track.artUrlSmall ?? track.artUrl} size={46} radius={10} />
      <span className="djs__now-text">
        <b>{track.name}</b>
        <small>
          <ArtistLinks artists={track.artists} onOpen={(id) => navigate({ name: 'artist', id })} />
        </small>
      </span>
      <span className="djs__now-time">
        {formatTime(pos)} / {formatTime(track.durationMs)}
      </span>
      <span className="djs__now-bar" style={{ ['--p' as string]: `${pct}%` }} />
    </div>
  )
}

export function DjView(): React.JSX.Element {
  // one selector each, so the DJ's chat log growing doesn't redraw the page
  const active = useDj((s) => s.active)
  const status = useDj((s) => s.status)
  const line = useDj((s) => s.line)
  const set = useDj((s) => s.set)
  const error = useDj((s) => s.error)
  const navigate = useApp((s) => s.navigate)
  const trackId = usePlayer((s) => s.track?.id)
  const art = usePlayer((s) => s.track?.artUrl ?? null)
  const paused = usePlayer((s) => s.paused)
  const { text: problem, setup: needsSetup, recheck } = useProblem()
  const [text, setText] = useState('')
  const [showAll, setShowAll] = useState(false)
  const busy = status === 'thinking'

  const send = (req: string): void => {
    setText('')
    void startDj(req.trim())
  }

  const statusText = status === 'thinking' ? 'Picking songs' : status === 'speaking' ? 'On air' : active ? 'Live' : 'Off air'
  const current = set.findIndex((p) => p.id === trackId)
  const from = Math.max(0, current)
  const upcoming = showAll ? set.map((p, i) => [p, i] as const) : set.slice(from, from + 8).map((p, i) => [p, from + i] as const)

  return (
    <div className="djs">
      <section className={`djs__stage is-${status} ${active ? 'is-active' : ''}`}>
        <div className="djs__backdrop" aria-hidden="true">
          <AnimatePresence initial={false}>
            {art && (
              <motion.img
                key={art}
                src={art}
                alt=""
                draggable={false}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.9 }}
              />
            )}
          </AnimatePresence>
        </div>

        <header className="djs__top">
          <span className="djs__brand">
            <SparkleIcon size={15} /> Pulse DJ
          </span>
          <span className={`djs__onair ${status === 'speaking' ? 'is-live' : active ? 'is-on' : ''} ${busy ? 'is-busy' : ''}`}>
            <i />
            {statusText}
          </span>
        </header>

        <div className="djs__center">
          <Orb status={status} playing={!!trackId && !paused} />
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={line || `${active}`}
              className={`djs__line ${line ? '' : 'is-quiet'}`}
              initial={{ opacity: 0, y: 10, filter: 'blur(6px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -8, filter: 'blur(6px)' }}
              transition={{ duration: 0.35 }}
            >
              {line ? (
                <SpokenLine text={line} live={status === 'speaking'} />
              ) : active ? (
                'Ask for anything, or just listen.'
              ) : (
                'Your own radio host. It picks songs you’ll love and talks between them.'
              )}
            </motion.p>
          </AnimatePresence>
          {status === 'error' && error && <p className="djs__error">{error}</p>}
        </div>

        <div className="djs__controls">
          <form
            className="djs__ask"
            onSubmit={(e) => {
              e.preventDefault()
              if (text.trim()) send(text)
            }}
          >
            <SparkleIcon size={18} />
            <input
              id="dj-request"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={active ? 'Ask for a song, an artist or a mood…' : 'What do you want to hear?'}
              disabled={busy || !!problem}
              autoComplete="off"
            />
            <button className="djs__send" aria-label="Ask the DJ" disabled={busy || !text.trim()}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M5.5 11.5L12 5l6.5 6.5" />
              </svg>
            </button>
          </form>
          <div className="djs__buttons">
            {!active ? (
              <button className="djs__btn djs__btn--main" disabled={busy || !!problem} onClick={() => send('')}>
                {busy ? <span className="cmd__spin" /> : <SparkleIcon size={17} />}
                {busy ? 'Picking songs…' : 'Start the show'}
              </button>
            ) : (
              <>
                <button className="djs__btn" disabled={!trackId} onClick={() => void nextTrack()}>
                  <NextIcon size={16} /> Next song
                </button>
                <button className="djs__btn" onClick={() => stopDj()}>
                  Stop the show
                </button>
              </>
            )}
            <button className="djs__btn" disabled={busy || !!problem} onClick={() => send('Surprise me')}>
              Surprise me
            </button>
          </div>
          {problem && (
            <div className="djs__problem">
              <p>
                {problem}{' '}
                {!needsSetup && (
                  <button className="link" onClick={() => navigate({ name: 'settings' })}>
                    Open settings
                  </button>
                )}
              </p>
              {needsSetup && <AiSetup onReady={recheck} />}
            </div>
          )}
        </div>

        <NowOnStage />
      </section>

      <section className="djs__section">
        <h2 className="djs__h">Start a show</h2>
        <div className="djs__moods">
          {MOODS.map((m) => (
            <MoodTile key={m.ask} m={m} disabled={busy || !!problem} />
          ))}
        </div>
      </section>

      {set.length > 0 && (
        <section className="djs__section">
          <header className="djs__head">
            <h2 className="djs__h">{current >= 0 ? 'Coming up' : 'On the show'}</h2>
            {set.length > 8 && (
              <button className="link" onClick={() => setShowAll((v) => !v)}>
                {showAll ? 'Show less' : `All ${set.length}`}
              </button>
            )}
          </header>
          <ol className="djs__rundown">
            {upcoming.map(([p, i]) => {
              const now = p.id === trackId
              return (
                <li
                  key={`${p.id}-${i}`}
                  className={`${now ? 'is-now' : ''} ${i < current ? 'is-past' : ''}`}
                  title="Double-click to play from here"
                  onDoubleClick={() => void playUris(set.slice(i).map((x) => x.uri), undefined, { source: 'dj' })}
                >
                  <span className="djs__num">{now ? <EqBars playing={!paused} /> : i + 1}</span>
                  <Cover src={p.image} size={48} radius={10} />
                  <span className="djs__song">
                    <b>{p.name}</b>
                    <small>{p.artists?.length ? <ArtistLinks artists={p.artists} onOpen={(id) => navigate({ name: 'artist', id })} /> : p.artist}</small>
                  </span>
                  {p.note && !now && <span className="djs__note">{p.note}</span>}
                  {p.discovered && <span className="djs__new">New</span>}
                  {now && <span className="djs__nowtag">Playing</span>}
                </li>
              )
            })}
          </ol>
        </section>
      )}
    </div>
  )
}
