// The Words look: the lyrics on black, word by word, the way animated-lyrics videos do it. Each
// word lands on its own line as it's sung, the word being sung wears a highlight in the cover's
// colour and bumps on the kick, and some words bring a small picture (📷 camera, 💵 cash). A new
// line of the song starts a fresh stack, a step to the side of the last one. Behind the words the
// cover's colours drift slowly and glow on the beat.
import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { getLyrics, type Lyrics as LyricsData, type SyncedLine } from '@/lib/lyrics'
import { livePosition, usePlayer, type PlayerTrack } from '@/lib/player'
import { Emo } from './Emoji'
import { readBeat, useBeat } from '@/lib/beat'
import { useApp } from '@/lib/store'

interface Word {
  i: number
  text: string
  start: number
  end: number
  /** Which line of the song it belongs to. */
  line: number
}

/** Pictures for common words: before things, after people (as in the video: "📷 camera", "you 👤"). */
const BEFORE: Record<string, string> = {
  camera: '📷',
  cash: '💵',
  money: '💸',
  dollar: '💵',
  film: '🎞️',
  phone: '📱',
  iphone: '📱',
  call: '📞',
  text: '💬',
  car: '🚗',
  road: '🛣️',
  city: '🏙️',
  home: '🏠',
  house: '🏠',
  heart: '❤️',
  love: '❤️',
  kiss: '💋',
  lips: '💋',
  fire: '🔥',
  night: '🌙',
  moon: '🌙',
  star: '⭐',
  sun: '☀️',
  rain: '🌧️',
  sky: '🌌',
  ocean: '🌊',
  sea: '🌊',
  wave: '🌊',
  water: '💧',
  splash: '💦',
  ice: '🧊',
  diamond: '💎',
  chain: '⛓️',
  watch: '⌚',
  time: '⏰',
  clock: '🕒',
  crown: '👑',
  king: '👑',
  queen: '👑',
  eyes: '👀',
  smoke: '💨',
  drink: '🍸',
  cup: '🥤',
  party: '🎉',
  dance: '💃',
  music: '🎵',
  song: '🎵',
  radio: '📻',
  plane: '✈️',
  flight: '✈️',
  bag: '👜',
  shoes: '👟',
  key: '🔑',
  door: '🚪',
  ghost: '👻',
  devil: '😈',
  angel: '😇',
  gold: '🥇',
  rose: '🌹',
  flower: '🌸',
  snow: '❄️',
  cold: '🥶',
  world: '🌍'
}
const AFTER: Record<string, string> = {
  you: '👤',
  me: '🙋',
  she: '💁‍♀️',
  her: '💁‍♀️',
  he: '🙎‍♂️',
  him: '🙎‍♂️',
  sweetie: '👱‍♀️',
  baby: '👶',
  girl: '👧',
  boy: '👦',
  mama: '👩',
  bro: '🫂',
  friends: '🫂'
}
function pictureOf(text: string): { before?: string; after?: string } {
  const w = text.toLowerCase().replace(/[^a-z']/g, '')
  const base = w.replace(/'s$/, '').replace(/s$/, '')
  return { before: BEFORE[w] ?? BEFORE[base], after: AFTER[w] }
}

/** When each word is sung: exact with word timings, estimated from its length otherwise. */
function toWords(lines: SyncedLine[]): Word[] {
  const out: Word[] = []
  lines.forEach((l, li) => {
    const text = l.text.trim()
    if (!text || /^[♪♫\s.…-]+$/.test(text)) return
    const next = lines[li + 1]?.timeMs
    if (l.words?.length) {
      l.words.forEach((w, k) => {
        const t = w.text.trim()
        if (!t) return
        out.push({ i: out.length, text: t, start: w.timeMs, end: l.words![k + 1]?.timeMs ?? Math.min(next ?? w.timeMs + 900, w.timeMs + 1400), line: li })
      })
      return
    }
    const parts = text.split(/\s+/).filter(Boolean)
    const natural = text.length * 62 + 600
    const span = Math.max(400, Math.min(next ?? l.timeMs + natural, l.timeMs + natural) - l.timeMs)
    const total = parts.reduce((n, p) => n + p.length + 2, 0) || 1
    let t = l.timeMs
    for (const p of parts) {
      const d = ((p.length + 2) / total) * span
      out.push({ i: out.length, text: p, start: t, end: t + d, line: li })
      t += d
    }
  })
  return out
}

/** How many words stay on screen. */
const KEEP = 5

/** Each line of the song sits a little to the side of the last one. */
const SWAY = ['0em', '-0.7em', '0.55em', '-0.3em', '0.75em']
/** A slight tilt per word, so the stack looks set by hand. */
const TILT = [0, -1.6, 1.2, -0.8, 1.8, -1.2, 0.6]

function Token({ w, now, old }: { w: Word; now: boolean; old: boolean }): React.JSX.Element {
  const pic = useMemo(() => pictureOf(w.text), [w.text])
  const tilt = TILT[w.i % TILT.length]
  return (
    <motion.span
      layout="position"
      className={`kw ${now ? 'is-now' : ''} ${old ? 'is-old' : ''}`}
      initial={{ opacity: 0, y: '0.7em', scale: 0.55, rotate: tilt * 5, filter: 'blur(10px)' }}
      animate={{ opacity: old ? 0.42 : 1, y: 0, x: SWAY[w.line % SWAY.length], scale: now ? 1.06 : 1, rotate: now ? 0 : tilt, filter: 'blur(0px)' }}
      exit={{ opacity: 0, y: '-0.6em', scale: 0.85, filter: 'blur(8px)', transition: { duration: 0.24 } }}
      transition={{ type: 'spring', stiffness: 560, damping: 26, mass: 0.6 }}
    >
      {pic.before && (
        <span className="kw__pic">
          <Emo>{pic.before}</Emo>
        </span>
      )}
      <span className="kw__text">{w.text}</span>
      {pic.after && (
        <span className="kw__pic">
          <Emo>{pic.after}</Emo>
        </span>
      )}
    </motion.span>
  )
}

function Live({ lines, glow }: { lines: SyncedLine[]; glow: React.RefObject<HTMLDivElement | null> }): React.JSX.Element {
  const words = useMemo(() => toWords(lines), [lines])
  const [state, setState] = useState<{ idx: number; singing: boolean }>({ idx: -1, singing: false })
  const last = useRef(state)
  useEffect(() => {
    let raf = 0
    let kick = 0
    const tick = (): void => {
      raf = requestAnimationFrame(tick)
      const beat = readBeat()
      kick += (beat.kick - kick) * (beat.kick > kick ? 0.6 : 0.14)
      glow.current?.style.setProperty('--kick', kick.toFixed(3))
      const pos = livePosition(usePlayer.getState()) + 40
      let lo = 0
      let hi = words.length - 1
      let idx = -1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (words[mid].start <= pos) {
          idx = mid
          lo = mid + 1
        } else hi = mid - 1
      }
      const w = words[idx]
      // the stack clears in a long pause, so the screen goes black between parts of the song
      const cleared = !!w && pos > w.end + 2600 && (!words[idx + 1] || words[idx + 1].start - w.end > 2600)
      const singing = !!w && pos <= w.end + 250
      const next = { idx: cleared ? -1 : idx, singing }
      if (next.idx !== last.current.idx || next.singing !== last.current.singing) {
        last.current = next
        setState(next)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [words, glow])

  const cur = words[state.idx]
  // the last few words; words from the line before are dimmed, and a line after a breath starts
  // the stack again
  const shown: Word[] = []
  for (let k = state.idx; k >= 0 && shown.length < KEEP; k--) {
    const w = words[k]
    const after = words[k + 1]
    if (k < state.idx && after && after.start - w.end > 1200) break
    shown.unshift(w)
  }
  return (
    <div className="kw-stack">
      <AnimatePresence initial={false}>
        {shown.map((w) => (
          <Token key={w.i} w={w} now={w.i === state.idx && state.singing} old={!!cur && w.line !== cur.line} />
        ))}
      </AnimatePresence>
    </div>
  )
}

/** No timed lyrics: the song's name in the same type, quietly. */
function Title({ track, note }: { track: PlayerTrack; note: string | null }): React.JSX.Element {
  return (
    <div className="kw-stack kw-stack--title">
      {track.name.split(/\s+/).map((t, i) => (
        <motion.span key={i} className="kw" initial={{ opacity: 0, y: '0.3em' }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}>
          <span className="kw__text">{t}</span>
        </motion.span>
      ))}
      <motion.span className="kw-note" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}>
        {track.artists.map((a) => a.name).join(', ')}
        {note ? `, ${note}` : ''}
      </motion.span>
    </div>
  )
}

export function WordsLyrics({ track }: { track: PlayerTrack }): React.JSX.Element {
  const [data, setData] = useState<LyricsData | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const reduce = useApp((s) => s.settings.reduceMotion)
  const paused = usePlayer((s) => s.paused)
  useBeat(!reduce && !paused)
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
    <div ref={root} className={`kwords ${paused ? 'is-paused' : ''}`}>
      <div className="kwords__glow" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      {data?.kind === 'synced' ? (
        <Live key={track.id} lines={data.lines} glow={root} />
      ) : data ? (
        <Title track={track} note={data.kind === 'instrumental' ? 'instrumental' : null} />
      ) : null}
    </div>
  )
}
