// Pulse DJ: one calm column. The orb and the DJ's words up top, a request bar, and what's
// coming up. No inner scroll areas and no heavy effects, so the page scrolls smoothly.
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useApp } from '@/lib/store'
import { startDj, stopDj, useDj, voiceLevel } from '@/lib/dj'
import { playUris, usePlayer } from '@/lib/player'
import { Cover, EqBars } from '@/components/common'
import { SparkleIcon } from '@/components/Icons'
import { SpokenLine } from '@/components/DjVoice'
import { AiSetup } from '@/components/AiSetup'

const IDEAS = ['Late night drive', 'Gym energy', 'Deep focus', 'What’s new', 'Surprise me']

/** The orb only animates its size while the DJ talks; otherwise it slowly turns (CSS only). */
function Orb({ speaking }: { speaking: boolean }): React.JSX.Element {
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
    <div ref={ref} className={`djorb ${speaking ? 'is-speaking' : ''}`} aria-hidden="true">
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
  const { active, status, line, set, error } = useDj()
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
    <div className="djv">
      <section className="djv__hero">
        <Orb speaking={status === 'speaking'} />
        <span className={`djv__status djv__status--${status}`}>
          <i />
          {statusText}
        </span>
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={line || `${active}`}
            className={`djv__line ${line ? '' : 'is-quiet'}`}
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
        {!active ? (
          <button className="btn btn--accent djv__start" disabled={busy || !!problem} onClick={() => send('')}>
            <SparkleIcon size={18} /> Start the DJ
          </button>
        ) : (
          <button className="btn djv__stop" onClick={() => stopDj()}>
            Stop
          </button>
        )}
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
      </section>

      <form
        className="djv__ask"
        onSubmit={(e) => {
          e.preventDefault()
          if (text.trim()) send(text)
        }}
      >
        <input
          id="dj-request"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="A song, artists, an album or a mood, like “riad and calin” or “late night drive”"
          disabled={busy || !!problem}
          autoComplete="off"
        />
        <button className="djv__send" aria-label="Ask the DJ" disabled={busy || !text.trim()}>
          ↑
        </button>
      </form>
      <div className="djv__ideas">
        {IDEAS.map((i) => (
          <button key={i} className="pill" disabled={busy || !!problem} onClick={() => send(i)}>
            {i}
          </button>
        ))}
      </div>

      {set.length > 0 && (
        <section className="djv__next">
          <header>
            <h2>{current >= 0 ? 'Up next' : 'On the show'}</h2>
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
                  <Cover src={p.image} size={44} radius={8} />
                  <span className="djv__song">
                    <b>{p.name}</b>
                    <small>{p.note ? `${p.artist}. ${p.note}` : p.artist}</small>
                  </span>
                  {p.discovered && <span className="djv__new">New</span>}
                  {now && <EqBars playing={!paused} />}
                </li>
              )
            })}
          </ol>
        </section>
      )}
    </div>
  )
}
