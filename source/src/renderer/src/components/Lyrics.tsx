import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { getLyrics, type Lyrics as LyricsData, type SyncedLine } from '@/lib/lyrics'
import { livePosition, seekTo, usePlayer, type PlayerTrack } from '@/lib/player'
import { useApp } from '@/lib/store'
import { renderLyricsCard } from '@/lib/cards'
import { ShareSheet } from './ShareSheet'
import { CloseIcon, ShareIcon } from './Icons'

/** Index of the line being sung at `ms`. */
function activeIndex(lines: { timeMs: number }[], ms: number): number {
  let lo = 0
  let hi = lines.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].timeMs <= ms + 250) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}

const MAX_SHARE_LINES = 6

/** Selection state for "share lyrics": the user taps lines, then makes a card. */
function useShare(track: PlayerTrack): {
  selecting: boolean
  selected: Set<number>
  toggle: (i: number) => void
  start: () => void
  cancel: () => void
  bar: (lines: string[]) => React.JSX.Element
} {
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [open, setOpen] = useState(false)
  const toast = useApp((s) => s.toast)
  useEffect(() => {
    setSelecting(false)
    setSelected(new Set())
  }, [track.id])
  const toggle = (i: number): void =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else if (next.size >= MAX_SHARE_LINES) toast(`Pick up to ${MAX_SHARE_LINES} lines`)
      else next.add(i)
      return next
    })
  const bar = (lines: string[]): React.JSX.Element => {
    const chosen = [...selected].sort((a, b) => a - b).map((i) => lines[i])
    return (
      <>
        <div className="lyrics__tools">
          <AnimatePresence mode="popLayout" initial={false}>
            {selecting ? (
              <motion.div
                key="sel"
                className="lyrics__selbar"
                initial={{ opacity: 0, y: 12, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.95 }}
              >
                <span>{selected.size ? `${selected.size} of ${MAX_SHARE_LINES} lines` : 'Tap lines to share'}</span>
                <button className="btn btn--accent" disabled={!selected.size} onClick={() => setOpen(true)}>
                  Create card
                </button>
                <button className="icon-btn" aria-label="Cancel" onClick={() => (setSelecting(false), setSelected(new Set()))}>
                  <CloseIcon size={16} />
                </button>
              </motion.div>
            ) : (
              <motion.button
                key="btn"
                className="lyrics__share"
                title="Share lyrics as an image"
                onClick={() => setSelecting(true)}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
              >
                <ShareIcon size={16} />
                Share
              </motion.button>
            )}
          </AnimatePresence>
        </div>
        <ShareSheet
          open={open}
          title="Share lyrics"
          fileName={`${track.name} lyrics`}
          onClose={() => setOpen(false)}
          render={(format, style) =>
            renderLyricsCard({
              lines: chosen,
              title: track.name,
              artist: track.artists.map((a) => a.name).join(', '),
              artUrl: track.artUrl,
              format,
              style
            })
          }
        />
      </>
    )
  }
  return {
    selecting,
    selected,
    toggle,
    start: () => setSelecting(true),
    cancel: () => setSelecting(false),
    bar
  }
}

const NO_LYRICS = [
  'No lyrics for this one. Freestyle it.',
  'The words are a secret. Hum along.',
  'Nobody wrote these lyrics down yet.',
  'No lyrics found. Your turn to make some up.',
  'Lyrics went missing. The beat stayed.',
  'Can’t find the words. Neither can we sometimes.',
  'This one’s lyrics are off the record.',
  'No lyrics here. Just vibes.'
]
const INSTRUMENTAL = ['No words, just music.', 'Instrumental. Let it talk.', 'Nothing to sing here. Close your eyes.']

/** The same line for the same song every time, a different one from song to song. */
function pickLine(lines: string[], id: string): string {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0
  return lines[Math.abs(h) % lines.length]
}

export function Lyrics({ track }: { track: PlayerTrack }): React.JSX.Element {
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

  if (!data) {
    return (
      <div className="lyrics lyrics--loading" aria-busy="true">
        {[72, 54, 80, 40, 66].map((w, i) => (
          <div key={i} className="lyrics__ghost" style={{ width: `${w}%`, animationDelay: `${i * 90}ms` }} />
        ))}
      </div>
    )
  }
  if (data.kind === 'instrumental') return <div className="lyrics__empty">{pickLine(INSTRUMENTAL, track.id)}</div>
  if (data.kind === 'none')
    return (
      <div className="lyrics__empty">
        {pickLine(NO_LYRICS, track.id)}
        {data.reason && <small>{data.reason}</small>}
        {data.geniusUrl && (
          <button className="btn lyrics__open" onClick={() => window.pulse.openExternal(data.geniusUrl!)}>
            Open lyrics on Genius
          </button>
        )}
      </div>
    )
  if (data.kind === 'plain') return <PlainLyrics track={track} data={data} />
  return <SyncedLyrics track={track} lines={data.lines} source={data.source} />
}

function PlainLyrics({
  track,
  data
}: {
  track: PlayerTrack
  data: Extract<LyricsData, { kind: 'plain' }>
}): React.JSX.Element {
  const share = useShare(track)
  const scroller = useRef<HTMLDivElement>(null)
  const selecting = share.selecting
  // Lyrics without timings still move with the song: they glide through at the song's pace (a
  // little after the intro, done a little before the end). Scrolling yourself takes over for a
  // few seconds.
  const glide = useRef<HTMLDivElement>(null)
  const plainState = useRef({ pos: 0, target: 0, userUntil: 0, wheel: false })
  useEffect(() => {
    const el = scroller.current
    const tr = glide.current
    if (!el || !tr) return
    const f = plainState.current
    let raf = 0
    let last = performance.now()
    const tick = (): void => {
      raf = requestAnimationFrame(tick)
      const now = performance.now()
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const room = Math.max(0, tr.scrollHeight - el.clientHeight)
      const st = usePlayer.getState()
      const dur = st.track?.durationMs ?? track.durationMs
      if (Date.now() >= f.userUntil && !selecting && dur && st.track?.id === track.id) {
        const pos = livePosition(st)
        const intro = Math.min(15_000, dur * 0.08)
        const outro = Math.min(20_000, dur * 0.1)
        const p = Math.max(0, Math.min(1, (pos - intro) / Math.max(1, dur - intro - outro)))
        f.target = p * room
        f.wheel = false
      }
      f.target = Math.max(0, Math.min(room, f.target))
      // on the GPU, a fraction of a pixel at a time: no stepping
      f.pos += (f.target - f.pos) * (1 - Math.exp(-dt * (f.wheel ? 14 : 2.2)))
      tr.style.transform = `translate3d(0, ${-f.pos}px, 0)`
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [track.id, track.durationMs, selecting])
  const onWheel = (e: React.WheelEvent): void => {
    const f = plainState.current
    f.target += e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY
    f.wheel = true
    f.userUntil = Date.now() + 6000
  }
  return (
    <div className={`lyrics lyrics--plain ${share.selecting ? 'is-selecting' : ''}`}>
      <div className="lyrics__scroll lyrics__scroll--glide" data-own-scroll ref={scroller} onWheel={onWheel}>
        <div className="lyrics__track lyrics__track--plain" ref={glide}>
          {data.lines.map((l, i) =>
            /^\[.*\]$/.test(l) ? (
              <div key={i} className="lyrics__section">
                {l.slice(1, -1)}
              </div>
            ) : (
              <p
                key={i}
                className={`lyrics__line lyrics__line--static ${share.selected.has(i) ? 'is-picked' : ''}`}
                onClick={() => share.selecting && l.trim() && share.toggle(i)}
              >
                {l || ' '}
              </p>
            )
          )}
          <footer className="lyrics__source">
            Not synced. Lyrics from{' '}
            {data.url ? (
              <span className="link" onClick={() => window.pulse.openExternal(data.url!)}>
                {data.source}
              </span>
            ) : (
              data.source
            )}
          </footer>
        </div>
      </div>
      {share.bar(data.lines)}
    </div>
  )
}

interface WordTiming {
  text: string
  start: number
  end: number
}

/** Start/end of every word in a line: exact for enhanced LRC, estimated otherwise. */
function wordTimings(line: SyncedLine, nextStart: number | undefined): WordTiming[] {
  if (line.words?.length) {
    return line.words.map((w, i) => ({
      text: w.text,
      start: w.timeMs,
      end: line.words![i + 1]?.timeMs ?? Math.min(nextStart ?? w.timeMs + 900, w.timeMs + 1500)
    }))
  }
  const parts = line.text.split(/(\s+)/).filter((p) => p.length > 0)
  // Singers rarely use the whole gap before the next line; estimate from the length.
  const natural = line.text.length * 62 + 700
  const end = Math.min(nextStart ?? line.timeMs + natural, line.timeMs + natural)
  const span = Math.max(400, end - line.timeMs)
  const weights = parts.map((p) => (/^\s+$/.test(p) ? 0 : p.length + 2))
  const total = weights.reduce((a, b) => a + b, 0) || 1
  let t = line.timeMs
  return parts.map((p, i) => {
    const d = (weights[i] / total) * span
    const w = { text: p, start: t, end: t + d }
    t += d
    return w
  })
}

/** The active line, lit word by word (updated every frame without React re-renders). */
function WordLine({ line, nextStart }: { line: SyncedLine; nextStart?: number }): React.JSX.Element {
  const words = useMemo(() => wordTimings(line, nextStart), [line, nextStart])
  const refs = useRef<(HTMLSpanElement | null)[]>([])
  useEffect(() => {
    let raf = 0
    const last: number[] = words.map(() => -1)
    const loop = (): void => {
      const pos = livePosition(usePlayer.getState()) + 80
      words.forEach((w, i) => {
        const el = refs.current[i]
        if (!el) return
        const p = Math.max(0, Math.min(1, (pos - w.start) / Math.max(1, w.end - w.start)))
        const q = Math.round(p * 100) / 100
        if (q !== last[i]) {
          last[i] = q
          el.style.setProperty('--p', String(q))
        }
      })
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [words])
  return (
    <span className="lw">
      {words.map((w, i) =>
        /^\s+$/.test(w.text) ? (
          <span key={i}> </span>
        ) : (
          <span
            key={i}
            className="lw__w"
            ref={(n) => {
              refs.current[i] = n
            }}
          >
            {w.text}
          </span>
        )
      )}
    </span>
  )
}

function SyncedLyrics({ track, lines, source }: { track: PlayerTrack; lines: SyncedLine[]; source: string }): React.JSX.Element {
  const scroller = useRef<HTMLDivElement>(null)
  const lineRefs = useRef<(HTMLElement | null)[]>([])
  const [active, setActive] = useState(-1)
  const userScrollUntil = useRef(0)
  const wordMode = useApp((s) => s.settings.wordLyrics)
  const share = useShare(track)

  const glide = useRef<HTMLDivElement>(null)
  const selecting = share.selecting
  const following = useRef({ target: 0, pos: 0, wheel: false })

  // Follow playback: the sung line lights up, and the lyrics glide (moved on the GPU, a fraction
  // of a pixel at a time, so it never steps) to keep it in place. The glide starts a quarter of
  // a second before the next line, so it's already moving when the line changes.
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const f = following.current
    const loop = (): void => {
      raf = requestAnimationFrame(loop)
      const now = performance.now()
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const pos = livePosition(usePlayer.getState())
      const idx = activeIndex(lines, pos)
      setActive((prev) => (prev === idx ? prev : idx))
      const el = scroller.current
      const tr = glide.current
      if (!el || !tr) return
      const max = Math.max(0, tr.scrollHeight - el.clientHeight)
      if (Date.now() >= userScrollUntil.current && !selecting) {
        const ahead = activeIndex(lines, pos + 250)
        const line = lineRefs.current[Math.max(0, ahead)]
        if (line) {
          // where the sung line sits (a third down; near the top in the side panel)
          const anchor = Number(getComputedStyle(el).getPropertyValue('--lyrics-anchor')) || 0.34
          f.target = line.offsetTop - el.clientHeight * anchor
        }
        f.wheel = false
      }
      f.target = Math.max(0, Math.min(max, f.target))
      // a smooth ease towards the target: quicker when you scroll yourself
      const k = 1 - Math.exp(-dt * (f.wheel ? 14 : document.documentElement.dataset.render === 'quality' ? 4.4 : 5.5))
      f.pos += (f.target - f.pos) * k
      if (Math.abs(f.target - f.pos) < 0.05) f.pos = f.target
      tr.style.transform = `translate3d(0, ${-f.pos}px, 0)`
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [lines, selecting])

  const onUserScroll = (e: React.WheelEvent): void => {
    const f = following.current
    f.target += e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY
    f.wheel = true
    userScrollUntil.current = Date.now() + 3500
  }

  return (
    <div className={`lyrics ${wordMode ? 'lyrics--words' : ''} ${share.selecting ? 'is-selecting' : ''}`}>
      <div className="lyrics__scroll lyrics__scroll--glide" data-own-scroll ref={scroller} onWheel={onUserScroll}>
        <div className="lyrics__track" ref={glide}>
        <div className="lyrics__pad" />
        {lines.map((l, i) => {
          const d = i - active
          const state = d === 0 ? 'is-active' : d < 0 ? 'is-past' : 'is-future'
          const blur = Math.min(Math.abs(d), 4)
          const picked = share.selected.has(i)
          return (
            <button
              key={i}
              ref={(n) => {
                lineRefs.current[i] = n
              }}
              className={`lyrics__line ${state} ${l.text ? '' : 'lyrics__line--break'} ${picked ? 'is-picked' : ''}`}
              style={{ '--blur': `${d === 0 || share.selecting ? 0 : 0.6 + blur * 0.5}px` } as React.CSSProperties}
              onClick={() => {
                if (share.selecting) {
                  if (l.text) share.toggle(i)
                  return
                }
                userScrollUntil.current = 0
                void seekTo(l.timeMs)
              }}
            >
              {l.text ? (
                d === 0 && wordMode && !share.selecting ? (
                  <WordLine line={l} nextStart={lines[i + 1]?.timeMs} />
                ) : (
                  l.text
                )
              ) : (
                <span className="lyrics__dots" aria-label="Instrumental break">
                  <i />
                  <i />
                  <i />
                </span>
              )}
            </button>
          )
        })}
        <div className="lyrics__pad lyrics__pad--end" />
        <footer className="lyrics__source">Synced lyrics from {source}</footer>
        </div>
      </div>
      {share.bar(lines.map((l) => l.text))}
    </div>
  )
}
