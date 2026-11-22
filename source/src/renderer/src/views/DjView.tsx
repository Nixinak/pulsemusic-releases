// Pulse DJ: a stage. The song that's on fills the background, the aura in the middle moves with
// the music (it swells on every kick) and with the DJ's voice,
// the DJ's words sit under it like captions, and the request bar is right there. Below: moods
// to start a show with, and the show's rundown.
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useApp } from '@/lib/store'
import { startDj, stopDj, useDj, voiceLevel, warmDj } from '@/lib/dj'
import { nextTrack, playUris, usePlayer } from '@/lib/player'
import { readBeat, useBeat } from '@/lib/beat'
import { formatTime } from '@/lib/format'
import { ArtistLinks, Cover, EqBars, useLivePosition } from '@/components/common'
import { NextIcon, SparkleIcon } from '@/components/Icons'
import { MOODS, MoodTile } from './HomeExtras'
import { SpokenLine } from '@/components/DjVoice'
import { AiSetup } from '@/components/AiSetup'

/** The aura: soft ribbons of light that drift into each other, in the spirit of the new Siri.
 *  No hard edge and no ring. One animation frame loop sets --kick and --lvl from the music and
 *  the DJ's voice; CSS turns them into how big and how bright the light is. */
function Orb({ status, playing, on }: { status: string; playing: boolean; on: boolean }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const reduce = useApp((s) => s.settings.reduceMotion)
  // only a running show moves it: with the DJ off it rests, whatever music is playing
  const live = on && !reduce
  useBeat(live)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (!live) {
      el.style.setProperty('--kick', '0')
      el.style.setProperty('--lvl', '0')
      return
    }
    let raf = 0
    let voice = 0
    let kick = 0
    let lvl = 0
    const tick = (): void => {
      const beat = readBeat()
      voice += (voiceLevel() - voice) * 0.3
      kick += (beat.kick - kick) * (beat.kick > kick ? 0.6 : 0.12)
      lvl += (Math.max(beat.level, voice) - lvl) * 0.15
      el.style.setProperty('--kick', kick.toFixed(3))
      el.style.setProperty('--lvl', lvl.toFixed(3))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [live])

  return (
    <div ref={ref} className={`aura is-${status} ${playing ? 'is-playing' : ''} ${on ? 'is-on' : 'is-off'}`} aria-hidden="true">
      <span className="aura__bloom" />
      <span className="aura__light">
        <i className="aura__ribbon aura__ribbon--a" />
        <i className="aura__ribbon aura__ribbon--b" />
        <i className="aura__ribbon aura__ribbon--c" />
        <i className="aura__ribbon aura__ribbon--d" />
      </span>
      <span className="aura__core" />
    </div>
  )
}

function useProblem(): {
  text: string | null
  setup: boolean
  recheck: () => void
} {
  const s = useApp((st) => st.settings)
  const [ready, setReady] = useState<boolean | undefined>(undefined)
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    if (s.djProvider !== 'local') return
    void window.pulse.dj.localReady().then(setReady)
  }, [s.djProvider, nonce])
  const recheck = (): void => setNonce((n) => n + 1)
  if (s.djProvider === 'claude')
    return {
      text: s.djClaudeKey ? null : 'Add your Claude API key in Settings.',
      setup: false,
      recheck
    }
  if (ready === false) return { text: 'The AI DJ isn’t set up yet.', setup: true, recheck }
  return { text: null, setup: false, recheck }
}

export function DjView(): React.JSX.Element {
  // the first set is made while you look at the page, so Start is quick
  useEffect(() => {
    const t = window.setTimeout(() => !useDj.getState().active && warmDj(), 1500)
    return () => window.clearTimeout(t)
  }, [])
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
        </header>

        <div className="djs__center">
          <Orb status={status} playing={!!trackId && !paused} on={active || busy} />
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
                  onDoubleClick={() =>
                    void playUris(
                      set.slice(i).map((x) => x.uri),
                      undefined,
                      { source: 'dj' }
                    )
                  }
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
