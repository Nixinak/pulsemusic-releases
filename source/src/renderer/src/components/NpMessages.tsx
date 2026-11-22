// The Messages look: the lyrics arrive as text messages. Each line is a bubble, from the left or
// the right, and the words type themselves into it as they're sung; a "typing" bubble shows
// before a line after a pause. Now and then a line comes as a shared place (a little map card).
// The conversation's contact is the artist, with the cover as their picture.
import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { getLyrics, type Lyrics as LyricsData, type SyncedLine } from '@/lib/lyrics'
import { livePosition, usePlayer, type PlayerTrack } from '@/lib/player'
import { INSTRUMENTAL, NO_LYRICS, pickLine } from './Lyrics'

type Side = 'in' | 'out'

interface Msg {
  /** Index among the shown lines. */
  i: number
  text: string
  side: Side
  /** A line shared as a place: a little map, the line, and somewhere in the world. */
  place: string | null
  start: number
  words: { text: string; start: number; end: number }[]
}

/** Places for the shared-location bubbles. */
const PLACES = [
  'Shibuya Crossing, Tokyo',
  'Brooklyn Bridge, New York',
  'Charles Bridge, Prague',
  'Venice Beach, Los Angeles',
  'Shoreditch, London',
  'Montmartre, Paris',
  'Kreuzberg, Berlin',
  'Copacabana, Rio de Janeiro',
  'Gangnam, Seoul',
  'Wynwood, Miami',
  'Nyhavn, Copenhagen',
  'Barceloneta, Barcelona',
  'Navigli, Milan',
  'Bondi Beach, Sydney'
]

const hash = (s: string): number => {
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0
  return Math.abs(h)
}

/** When each word of a line is sung: exact with word timings, estimated from length otherwise. */
function timeWords(line: SyncedLine, next: number | undefined): Msg['words'] {
  if (line.words?.length) {
    return line.words
      .map((w, i) => ({ text: w.text.trim(), start: w.timeMs, end: line.words![i + 1]?.timeMs ?? Math.min(next ?? w.timeMs + 900, w.timeMs + 1500) }))
      .filter((w) => w.text)
  }
  const parts = line.text.split(/\s+/).filter(Boolean)
  const natural = line.text.length * 62 + 700
  const span = Math.max(400, Math.min(next ?? line.timeMs + natural, line.timeMs + natural) - line.timeMs)
  const total = parts.reduce((n, p) => n + p.length + 2, 0) || 1
  let t = line.timeMs
  return parts.map((p) => {
    const d = ((p.length + 2) / total) * span
    const w = { text: p, start: t, end: t + d }
    t += d
    return w
  })
}

/** The lines as messages: who sends each, and which ones come as places. */
function toMessages(lines: SyncedLine[], trackId: string): Msg[] {
  const out: Msg[] = []
  let side: Side = 'out'
  let lastEnd = -Infinity
  let blank = false
  for (let k = 0; k < lines.length; k++) {
    const l = lines[k]
    const text = l.text.trim()
    if (!text || /^[♪♫\s.…-]+$/.test(text)) {
      blank = true
      continue
    }
    // after a pause or an empty line the other side starts a new exchange
    side = blank || l.timeMs - lastEnd > 7000 ? 'in' : side === 'in' ? 'out' : 'in'
    blank = false
    const words = timeWords(l, lines[k + 1]?.timeMs)
    const i = out.length
    const place = i > 1 && text.length >= 14 && hash(`${trackId}:${i}`) % 8 === 0 ? PLACES[hash(`${trackId}:${i}:p`) % PLACES.length] : null
    out.push({ i, text, side, place, start: l.timeMs, words })
    lastEnd = words[words.length - 1]?.end ?? l.timeMs
  }
  return out
}

const PinIcon = (): React.JSX.Element => (
  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
    <path d="M14.2 1.8 1.9 7.1c-.5.2-.4.9.1 1l5 1 1 5c.1.5.8.6 1 .1l5.3-12.3c.2-.4-.2-.8-.6-.6Z" fill="currentColor" />
  </svg>
)

/** The little map on a shared place: the cover, washed out, under a street grid and a pin. */
function MapCard({ art, seed }: { art: string | null; seed: number }): React.JSX.Element {
  const rot = (seed % 40) - 20
  return (
    <span className="msg__map" aria-hidden="true">
      {art && <img src={art} alt="" draggable={false} />}
      <svg viewBox="0 0 200 70" preserveAspectRatio="xMidYMid slice">
        <g transform={`rotate(${rot} 100 35)`} stroke="rgba(255,255,255,0.32)" fill="none">
          <path d="M-40 18H240M-40 44H240M-40 62H240" strokeWidth="5" />
          <path d="M30 -40V120M86 -40V120M150 -40V120M190 -40V120" strokeWidth="3" />
          <path d="M-40 90 240 -10" strokeWidth="7" stroke="rgba(255,214,120,0.45)" />
        </g>
        <circle cx="100" cy="35" r="7" fill="#ff453a" stroke="#fff" strokeWidth="2.5" />
      </svg>
      <span className="msg__maplabel">Maps</span>
    </span>
  )
}

/** Three dots, as when someone's typing. */
function Typing({ side }: { side: Side }): React.JSX.Element {
  return (
    <motion.div
      layout="position"
      className={`msg msg--${side} msg--typing msg--tail`}
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 30 }}
      style={{ transformOrigin: side === 'in' ? '0% 100%' : '100% 100%' }}
    >
      <i />
      <i />
      <i />
    </motion.div>
  )
}

function Bubble({ m, shown, tail, art }: { m: Msg; shown: number; tail: boolean; art: string | null }): React.JSX.Element {
  const words = shown >= m.words.length ? null : m.words.slice(0, Math.max(1, shown))
  return (
    <motion.div
      layout
      className={`msg msg--${m.side} ${m.place ? 'msg--place' : ''} ${tail ? 'msg--tail' : ''}`}
      initial={{ opacity: 0, y: 18, scale: 0.86 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -12, transition: { duration: 0.2 } }}
      transition={{ type: 'spring', stiffness: 380, damping: 30, mass: 0.8 }}
      style={{ transformOrigin: m.side === 'in' ? '0% 100%' : '100% 100%' }}
    >
      {m.place && <MapCard art={art} seed={hash(m.text)} />}
      <span className="msg__text">
        {words
          ? words.map((w, k) => (
              <span key={k} className="msg__word">
                {w.text}{' '}
              </span>
            ))
          : m.text}
      </span>
      {m.place && (
        <span className="msg__where">
          <PinIcon />
          {m.place}
        </span>
      )}
    </motion.div>
  )
}

/** The top of the chat: the artist as the contact, the cover as their picture. */
function Contact({ track }: { track: PlayerTrack }): React.JSX.Element {
  return (
    <header className="npmsg__head">
      <span className="npmsg__avatar">{track.artUrl && <img src={track.artUrl} alt="" draggable={false} />}</span>
      <span className="npmsg__who">
        {track.artists.map((a) => a.name).join(', ')}
        <svg viewBox="0 0 8 12" width="7" height="11" aria-hidden="true">
          <path d="m1.5 1.5 4.5 4.5-4.5 4.5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </header>
  )
}

/** The first thing in the chat: when it started, and the song shared as a card. */
function Opening({ track, at }: { track: PlayerTrack; at: number }): React.JSX.Element {
  const time = new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return (
    <motion.div layout="position" className="npmsg__opening" exit={{ opacity: 0, y: -12, transition: { duration: 0.2 } }}>
      <p className="npmsg__stamp">
        <b>Today</b> {time}
      </p>
      <div className="msg msg--in msg--card msg--tail">
        <span className="msg__cover">{track.artUrl && <img src={track.artUrl} alt="" draggable={false} />}</span>
        <span className="msg__text msg__text--title">{track.name}</span>
        <span className="msg__where">
          <PinIcon />
          {track.album.name}
        </span>
      </div>
    </motion.div>
  )
}

const KEEP = 9

/** Synced lyrics as a conversation that follows the song. */
function LiveChat({ track, lines }: { track: PlayerTrack; lines: SyncedLine[] }): React.JSX.Element {
  const msgs = useMemo(() => toMessages(lines, track.id), [lines, track.id])
  const [state, setState] = useState<{ idx: number; shown: number; typing: Side | null }>({ idx: -1, shown: 0, typing: null })
  const startedAt = useMemo(() => Date.now() - livePosition(usePlayer.getState()), [track.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const last = useRef(state)

  useEffect(() => {
    let raf = 0
    const tick = (): void => {
      raf = requestAnimationFrame(tick)
      const pos = livePosition(usePlayer.getState()) + 60
      let lo = 0
      let hi = msgs.length - 1
      let idx = -1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (msgs[mid].start <= pos) {
          idx = mid
          lo = mid + 1
        } else hi = mid - 1
      }
      const cur = msgs[idx]
      const shown = cur ? cur.words.filter((w) => w.start <= pos).length : 0
      const next = msgs[idx + 1]
      const curEnd = cur ? (cur.words[cur.words.length - 1]?.end ?? cur.start) : -Infinity
      const typing = next && pos >= next.start - 1400 && pos - curEnd > 700 ? next.side : null
      const p = last.current
      if (p.idx !== idx || p.shown !== shown || p.typing !== typing) {
        last.current = { idx, shown, typing }
        setState(last.current)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [msgs])

  const from = Math.max(0, state.idx - KEEP + 1)
  const visible = state.idx >= 0 ? msgs.slice(from, state.idx + 1) : []
  const lastOut = visible.length && visible[visible.length - 1].side === 'out' && !state.typing && state.shown >= visible[visible.length - 1].words.length
  return (
    <LayoutGroup id={`msgs-${track.id}`}>
      <div className="npmsg__list">
        <AnimatePresence initial={false}>
          {from === 0 && <Opening key="opening" track={track} at={startedAt} />}
          {visible.map((m, k) => (
            <Bubble
              key={m.i}
              m={m}
              art={track.artUrl}
              shown={m.i === state.idx ? state.shown : Infinity}
              tail={k === visible.length - 1 ? state.typing !== m.side : visible[k + 1].side !== m.side}
            />
          ))}
          {lastOut && (
            <motion.p
              key={`read-${state.idx}`}
              layout="position"
              className="npmsg__read"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              Delivered
            </motion.p>
          )}
          {state.typing && <Typing key={`typing-${state.idx}`} side={state.typing} />}
        </AnimatePresence>
      </div>
    </LayoutGroup>
  )
}

/** Lyrics without timings: the whole conversation at once, to scroll through. */
function StillChat({ track, lines }: { track: PlayerTrack; lines: string[] }): React.JSX.Element {
  const msgs = useMemo(
    () =>
      toMessages(
        lines.map((text, i) => ({ timeMs: i * 3000, text })),
        track.id
      ),
    [lines, track.id]
  )
  return (
    <div className="npmsg__list npmsg__list--still" data-own-scroll>
      <Opening track={track} at={Date.now()} />
      {msgs.map((m, k) => (
        <Bubble key={m.i} m={m} art={track.artUrl} shown={Infinity} tail={msgs[k + 1]?.side !== m.side} />
      ))}
    </div>
  )
}

/** A song without words: the cover sent as a photo, and a line about it. */
function NoWords({ track, text }: { track: PlayerTrack; text: string }): React.JSX.Element {
  return (
    <div className="npmsg__list">
      <Opening track={track} at={Date.now()} />
      <motion.div
        className="msg msg--out msg--tail"
        initial={{ opacity: 0, y: 18, scale: 0.86 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30, delay: 0.35 }}
        style={{ transformOrigin: '100% 100%' }}
      >
        <span className="msg__text">{text}</span>
      </motion.div>
    </div>
  )
}

export function MessagesChat({ track }: { track: PlayerTrack }): React.JSX.Element {
  const [data, setData] = useState<LyricsData | null>(null)
  useEffect(() => {
    let alive = true
    setData(null)
    void getLyrics({
      id: track.id,
      name: track.name,
      artists: track.artists.map((a) => a.name),
      album: track.album.name,
      durationMs: track.durationMs
    }).then((d) => alive && setData(d))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id])

  return (
    <div className="npmsg">
      <Contact track={track} />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={track.id + (data ? data.kind : 'loading')}
          className="npmsg__body"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.18 } }}
          transition={{ duration: 0.3 }}
        >
          {!data ? (
            <div className="npmsg__list">
              <Typing side="in" />
            </div>
          ) : data.kind === 'synced' ? (
            <LiveChat track={track} lines={data.lines} />
          ) : data.kind === 'plain' ? (
            <StillChat track={track} lines={data.lines} />
          ) : (
            <NoWords track={track} text={pickLine(data.kind === 'instrumental' ? INSTRUMENTAL : NO_LYRICS, track.id)} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
