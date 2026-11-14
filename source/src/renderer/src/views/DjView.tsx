// Pulse DJ: a radio studio. The orb in a ring of sound bars (they move with the DJ's voice) and
// an ON AIR sign, the DJ's words and the request bar beside it, moods to start a show with,
// and what's coming up. No inner scroll areas and no heavy effects, so the page scrolls smoothly.
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useApp } from '@/lib/store'
import { startDj, stopDj, useDj, voiceLevel } from '@/lib/dj'
import { playUris, usePlayer } from '@/lib/player'
import { ArtistLinks, Cover, EqBars } from '@/components/common'
import { SparkleIcon } from '@/components/Icons'
import { MOODS, MoodTile } from './HomeExtras'
import { SpokenLine } from '@/components/DjVoice'
import { AiSetup } from '@/components/AiSetup'


/** Bars around the orb: how far each one reaches when the DJ speaks (fixed, so it looks like a
 *  real level meter rather than noise). */
const BARS = Array.from({ length: 56 }, (_, i) => 0.35 + 0.65 * Math.abs(Math.sin(i * 2.399 + Math.sin(i * 0.7))))

/** The orb and its ring only follow the voice while the DJ talks; otherwise they breathe (CSS). */
function Orb({ speaking, thinking }: { speaking: boolean; thinking: boolean }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (!speaking) {
      el.style.setProperty('--lvl', '0')
      return
    }
    let raf = 0
    let smooth = 0
    const loop = (): void => {
      smooth += (voiceLevel() - smooth) * 0.3
      el.style.setProperty('--lvl', smooth.toFixed(3))
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [speaking])
  return (
    <div ref={ref} className={`djorb djx__orb ${speaking ? 'is-speaking' : ''} ${thinking ? 'is-thinking' : ''}`} aria-hidden="true">
      <span className="djx__bars">
        {BARS.map((k, i) => (
          <i key={i} style={{ ['--a' as string]: `${(i / BARS.length) * 360}deg`, ['--k' as string]: k.toFixed(3) }} />
        ))}
      </span>
      <span className="djorb__glow" />
      <span className="djorb__ball" />
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

export function DjView(): React.JSX.Element {
  // one selector each, so the DJ's chat log growing doesn't redraw the page
  const active = useDj((s) => s.active)
  const status = useDj((s) => s.status)
  const line = useDj((s) => s.line)
  const set = useDj((s) => s.set)
  const error = useDj((s) => s.error)
  const navigate = useApp((s) => s.navigate)
  const trackId = usePlayer((s) => s.track?.id)
  const paused = usePlayer((s) => s.paused)
  const { text: problem, setup: needsSetup, recheck } = useProblem()
  const [text, setText] = useState('')
  const [showAll, setShowAll] = useState(false)
  const busy = status === 'thinking'

  const send = (req: string): void => {
    setText('')
    void startDj(req.trim())
  }

  const statusText =
    status === 'thinking' ? 'Picking songs' : status === 'speaking' ? 'On air' : active ? 'Playing your show' : 'Off air'
  const current = set.findIndex((p) => p.id === trackId)
  const upcoming = showAll ? set : set.slice(Math.max(0, current), Math.max(0, current) + 6)

  return (
    <div className="djx">
      <section className={`djx__studio djx__studio--${status}`}>
        <span className="djx__studio-glow" aria-hidden="true" />
        <div className="djx__left">
          <Orb speaking={status === 'speaking'} thinking={busy} />
          <span className={`djx__onair ${status === 'speaking' ? 'is-live' : active ? 'is-on' : ''}`}>
            <i />
            {status === 'speaking' ? 'On air' : statusText}
          </span>
        </div>
        <div className="djx__right">
          <small className="djx__eyebrow">Pulse DJ</small>
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={line || `${active}`}
              className={`djx__line ${line ? '' : 'is-quiet'}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.3 }}
            >
              {line ? (
                <SpokenLine text={line} live={status === 'speaking'} />
              ) : active ? (
                'Ask for something, or just listen.'
              ) : (
                'Your own radio host. It picks songs from your library and talks between them.'
              )}
            </motion.p>
          </AnimatePresence>
          {status === 'error' && error && <p className="djv__error">{error}</p>}
          <form
            className="djx__ask"
            onSubmit={(e) => {
              e.preventDefault()
              if (text.trim()) send(text)
            }}
          >
            <input
              id="dj-request"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Ask for a song, artists or a mood…"
              disabled={busy || !!problem}
              autoComplete="off"
            />
            <button className="djx__send" aria-label="Ask the DJ" disabled={busy || !text.trim()}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M5.5 11.5L12 5l6.5 6.5" />
              </svg>
            </button>
          </form>
          <div className="djx__actions">
            {!active ? (
              <button className="btn btn--accent djx__start" disabled={busy || !!problem} onClick={() => send('')}>
                <SparkleIcon size={18} /> {busy ? 'Picking songs…' : 'Start the DJ'}
              </button>
            ) : (
              <button className="btn djx__stop" onClick={() => stopDj()}>
                Stop the show
              </button>
            )}
            <button className="btn djx__surprise" disabled={busy || !!problem} onClick={() => send('Surprise me')}>
              Surprise me
            </button>
          </div>
          {problem && (
            <div className="djv__problem">
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

      <section className="djx__moods">
        <h2 className="djx__h">Start a show</h2>
        <div className="djx__moodgrid">
          {MOODS.map((m) => (
            <MoodTile key={m.ask} m={m} disabled={busy || !!problem} />
          ))}
        </div>
      </section>

      {set.length > 0 && (
        <section className="djx__next">
          <header>
            <h2 className="djx__h">{current >= 0 ? 'Up next' : 'On the show'}</h2>
            {set.length > 6 && (
              <button className="link" onClick={() => setShowAll((v) => !v)}>
                {showAll ? 'Show less' : `All ${set.length}`}
              </button>
            )}
          </header>
          <ol>
            {upcoming.map((p, i) => {
              const now = p.id === trackId
              return (
                <li key={`${p.id}-${i}`} className={now ? 'is-now' : ''} onDoubleClick={() => void playUris(set.slice(set.indexOf(p)).map((x) => x.uri), undefined, { source: 'dj' })}>
                  <span className="djx__num">{now ? <EqBars playing={!paused} /> : set.indexOf(p) + 1}</span>
                  <Cover src={p.image} size={52} radius={10} />
                  <span className="djv__song">
                    <b>{p.name}</b>
                    <small>{p.artists?.length ? <ArtistLinks artists={p.artists} onOpen={(id) => navigate({ name: 'artist', id })} /> : p.artist}</small>
                  </span>
                  {p.discovered && <span className="djv__new">New</span>}
                  {now && <span className="djx__nowtag">Playing</span>}
                </li>
              )
            })}
          </ol>
        </section>
      )}
    </div>
  )
}
