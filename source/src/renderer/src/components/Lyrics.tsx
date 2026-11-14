import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, animate, motion } from 'motion/react'
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
  return <SyncedLyrics track={track} lines={data.lines} />
}

function PlainLyrics({
  track,
  data
}: {
  track: PlayerTrack
  data: Extract<LyricsData, { kind: 'plain' }>
}): React.JSX.Element {
  const share = useShare(track)
  return (
    <div className={`lyrics lyrics--plain ${share.selecting ? 'is-selecting' : ''}`}>
      <div className="lyrics__scroll" data-own-scroll>
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

function SyncedLyrics({ track, lines }: { track: PlayerTrack; lines: SyncedLine[] }): React.JSX.Element {
  const scroller = useRef<HTMLDivElement>(null)
  const lineRefs = useRef<(HTMLElement | null)[]>([])
  const [active, setActive] = useState(-1)
  const userScrollUntil = useRef(0)
  const anim = useRef<ReturnType<typeof animate> | null>(null)
  const wordMode = useApp((s) => s.settings.wordLyrics)
  const share = useShare(track)

  // Follow playback.
  useEffect(() => {
    let raf = 0
    const loop = (): void => {
      const idx = activeIndex(lines, livePosition(usePlayer.getState()))
      setActive((prev) => (prev === idx ? prev : idx))
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [lines])

  // Keep the active line about a third of the way down, with a soft spring.
  useEffect(() => {
    const el = scroller.current
    const line = lineRefs.current[Math.max(0, active)]
    if (!el || !line || Date.now() < userScrollUntil.current || share.selecting) return
    // where the sung line sits (a third down; near the top in the side panel)
    const anchor = Number(getComputedStyle(el).getPropertyValue('--lyrics-anchor')) || 0.34
    const target = line.offsetTop - el.clientHeight * anchor
    anim.current?.stop()
    anim.current = animate(el.scrollTop, Math.max(0, target), {
      type: 'spring',
      stiffness: 90,
      damping: 22,
      onUpdate: (v) => {
        el.scrollTop = v
      }
    })
  }, [active, share.selecting])

  const onUserScroll = (): void => {
    anim.current?.stop()
    userScrollUntil.current = Date.now() + 3500
  }

  return (
    <div className={`lyrics ${wordMode ? 'lyrics--words' : ''} ${share.selecting ? 'is-selecting' : ''}`}>
      <div className="lyrics__scroll" data-own-scroll ref={scroller} onWheel={onUserScroll} onTouchMove={onUserScroll}>
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
        <footer className="lyrics__source">Synced lyrics from LRCLIB</footer>
      </div>
      {share.bar(lines.map((l) => l.text))}
    </div>
  )
}
