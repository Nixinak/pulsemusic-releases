// Discover: new music one song at a time, swiped like Tinder. Drag the card right to like the song,
// left to pass, or use the buttons and keys (→ like, ← pass, ↓ next, Q queue). Every card plays
// on its own: the song's 30-second preview, or (when there is none) the song itself on Spotify
// from its chorus. Behind it runs the artist's Canvas, the short looping video they put on the song
// in the Spotify app, when there is one. What was playing before comes back when you leave.
// The songs come from your Made for you mixes (Discover Weekly, Release Radar, Deep Cuts and the
// Daily Mixes), so the feed itself costs no extra Spotify requests.
import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useMotionValue, useTransform, type PanInfo } from 'motion/react'
import type { STrack } from '@/lib/types'
import * as sp from '@/lib/spotify'
import { useMadeForYou, type MixKind } from '@/lib/madeForYou'
import { addToQueue, livePosition, playContext, playUris, togglePlay, usePlayer } from '@/lib/player'
import { useApp, errorText } from '@/lib/store'
import { HeartIcon, PlayIcon, PlusIcon, VolumeIcon } from '@/components/Icons'
import { Emo } from '@/components/Emoji'

interface Item {
  track: STrack
  why: string
}

const SKIP_KEY = 'pulse-discover-skip'
const readSkips = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(SKIP_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}
const remember = (id: string): void => {
  try {
    localStorage.setItem(SKIP_KEY, JSON.stringify([...readSkips(), id].slice(-1500)))
  } catch {
    /* not remembered */
  }
}

/** Where the feed's songs come from, the most "new to you" first. */
const ORDER: MixKind[] = ['discover', 'radar', 'deep', 'daily', 'capsule']

/** Songs mixed from the mixes, taking turns between them, without repeats or ones already seen. */
function useFeed(): Item[] {
  const mixes = useMadeForYou((s) => s.mixes)
  return useMemo(() => {
    const skip = new Set(readSkips())
    const lanes = ORDER.flatMap((k) => mixes.filter((m) => m.kind === k)).map((m) => ({
      why:
        m.kind === 'discover'
          ? 'New to you'
          : m.kind === 'radar'
            ? 'Just released'
            : m.kind === 'deep'
              ? 'A deep cut'
              : m.kind === 'capsule'
                ? 'From your past'
                : `From ${m.title}`,
      list: m.tracks.filter((t) => t?.id && !skip.has(t.id))
    }))
    const seen = new Set<string>()
    const out: Item[] = []
    for (let i = 0; out.length < 200 && lanes.some((l) => i < l.list.length); i++)
      for (const l of lanes) {
        const t = l.list[i]
        if (!t || seen.has(t.id)) continue
        seen.add(t.id)
        out.push({ track: t, why: l.why })
      }
    return out
    // the feed is read once per visit (songs swiped away stay away)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mixes.length])
}

/** The 30 s previews (as audio) and the Canvas videos, fetched a couple of songs ahead. */
const previews = new Map<string, Promise<string | null>>()
function previewUrl(t: STrack): Promise<string | null> {
  let p = previews.get(t.id)
  if (!p) {
    p = window.pulse.recs
      .preview(t.name, t.artists[0]?.name ?? '')
      .then((b64) => (b64 ? URL.createObjectURL(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'audio/mpeg' })) : null))
      .catch(() => null)
    previews.set(t.id, p)
  }
  return p
}
const canvases = new Map<string, Promise<string | null>>()
function canvasUrl(t: STrack): Promise<string | null> {
  let p = canvases.get(t.id)
  if (!p) {
    p = window.pulse.spotifyAccount?.canvas(t.id).catch(() => null) ?? Promise.resolve(null)
    canvases.set(t.id, p)
  }
  return p
}

type Verdict = 'like' | 'nope' | 'next'

/** One card: drag it right to like, left to pass. */
function Card({
  item,
  top,
  canvas,
  progress,
  onDecide
}: {
  item: Item
  top: boolean
  canvas: string | null
  progress: number
  onDecide: (v: Verdict) => void
}): React.JSX.Element {
  const t = item.track
  const art = sp.pickImage(t.album?.images, 640)
  const x = useMotionValue(0)
  const rotate = useTransform(x, [-300, 0, 300], [-16, 0, 16])
  const likeOpacity = useTransform(x, [30, 140], [0, 1])
  const nopeOpacity = useTransform(x, [-140, -30], [1, 0])
  const end = (_e: unknown, info: PanInfo): void => {
    const fling = info.offset.x + info.velocity.x * 0.25
    if (fling > 140) onDecide('like')
    else if (fling < -140) onDecide('nope')
  }
  return (
    <motion.article
      className={`disc__card ${top ? 'is-top' : ''}`}
      style={top ? { x, rotate } : undefined}
      drag={top ? 'x' : false}
      dragSnapToOrigin
      dragElastic={0.9}
      onDragEnd={end}
      initial={top ? { scale: 0.94, y: 18, opacity: 0.6 } : false}
      animate={top ? { scale: 1, y: 0, opacity: 1 } : { scale: 0.94, y: 18, opacity: 0.6 }}
      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
    >
      <span className="disc__media" aria-hidden="true">
        {art && <img className="disc__blur" src={art} alt="" draggable={false} />}
        {top && canvas && <video key={canvas} className="disc__canvas" src={canvas} autoPlay muted loop playsInline />}
      </span>
      <span className="disc__shade" aria-hidden="true" />
      {top && (
        <>
          <motion.span className="disc__stamp disc__stamp--like" style={{ opacity: likeOpacity }}>
            LIKE
          </motion.span>
          <motion.span className="disc__stamp disc__stamp--nope" style={{ opacity: nopeOpacity }}>
            NOPE
          </motion.span>
        </>
      )}
      {!canvas && art && (
        <div className="disc__art">
          <img src={art} alt="" draggable={false} />
        </div>
      )}
      <div className="disc__info">
        {canvas && art && <img className="disc__thumb" src={art} alt="" draggable={false} />}
        <span className="disc__why">{item.why}</span>
        <h2>
          <Emo>{t.name}</Emo>
        </h2>
        <p>{t.artists.map((a) => a.name).join(', ')}</p>
        {top && (
          <span className="disc__progress" aria-hidden="true">
            <i style={{ width: `${progress * 100}%` }} />
          </span>
        )}
      </div>
    </motion.article>
  )
}

export function DiscoverView(): React.JSX.Element {
  const feed = useFeed()
  const loaded = useMadeForYou((s) => s.loaded)
  const [index, setIndex] = useState(0)
  const [muted, setMuted] = useState(false)
  const [progress, setProgress] = useState(0)
  const [canvas, setCanvas] = useState<string | null>(null)
  const [fly, setFly] = useState<Verdict>('next')
  const audio = useRef<HTMLAudioElement | null>(null)
  /** A song this page started on Spotify (when it had no preview). */
  const usedSpotify = useRef(false)
  const toast = useApp((s) => s.toast)
  const current = feed[index]

  // what was playing before: paused now, and put back when you leave
  useEffect(() => {
    const s = usePlayer.getState()
    const before = s.track ? { uri: s.track.uri, context: s.contextUri, position: livePosition(s), playing: !s.paused } : null
    if (before?.playing) void togglePlay()
    return () => {
      audio.current?.pause()
      if (usedSpotify.current && before) {
        const offsetOk = !!before.context && (/^spotify:(playlist|album):/.test(before.context) || before.context.endsWith(':collection'))
        if (offsetOk) void playContext(before.context!, before.uri, undefined, { positionMs: before.position })
        else void playUris([before.uri], undefined, { positionMs: before.position })
        if (!before.playing) window.setTimeout(() => !usePlayer.getState().paused && void togglePlay(), 1500)
      } else if (usedSpotify.current && !usePlayer.getState().paused) void togglePlay()
      else if (before?.playing && usePlayer.getState().paused) void togglePlay()
    }
  }, [])

  // the card on top plays: its preview, or the song itself on Spotify; its Canvas runs behind
  useEffect(() => {
    if (!current) return
    let alive = true
    setProgress(0)
    setCanvas(null)
    for (const it of feed.slice(index + 1, index + 3)) {
      void previewUrl(it.track)
      void canvasUrl(it.track)
    }
    void canvasUrl(current.track).then((c) => alive && setCanvas(c))
    // a short wait, so swiping fast doesn't start every song
    const wait = window.setTimeout(() => {
      void previewUrl(current.track).then((url) => {
        if (!alive) return
        if (!url) {
          // no preview: the song itself, from about its chorus
          audio.current?.pause()
          usedSpotify.current = true
          const at = Math.min(60_000, Math.round((current.track.duration_ms || 180_000) * 0.3))
          void playUris([current.track.uri], undefined, { positionMs: at })
          return
        }
        if (usedSpotify.current && !usePlayer.getState().paused) void togglePlay()
        const a = audio.current ?? new Audio()
        audio.current = a
        a.src = url
        a.loop = true
        a.muted = muted
        a.volume = 0
        void a.play().catch(() => undefined)
        const t0 = performance.now()
        const target = Math.max(0.05, usePlayer.getState().volume ?? 0.7)
        const fade = (): void => {
          if (!alive) return
          const k = Math.min(1, (performance.now() - t0) / 600)
          a.volume = target * k
          if (k < 1) requestAnimationFrame(fade)
        }
        requestAnimationFrame(fade)
      })
    }, 250)
    return () => {
      alive = false
      window.clearTimeout(wait)
      audio.current?.pause()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.track.id])

  useEffect(() => {
    if (audio.current) audio.current.muted = muted
  }, [muted])

  // the preview's (or the song's) progress
  useEffect(() => {
    const t = window.setInterval(() => {
      const a = audio.current
      if (a && !a.paused && a.duration) setProgress(a.currentTime / a.duration)
      else if (usedSpotify.current) {
        const s = usePlayer.getState()
        if (s.track?.id === current?.track.id && s.track?.durationMs) setProgress(livePosition(s) / s.track.durationMs)
      }
    }, 200)
    return () => window.clearInterval(t)
  }, [current?.track.id])

  const decide = (v: Verdict): void => {
    const t = current?.track
    if (!t) return
    setFly(v)
    remember(t.id)
    if (v === 'like')
      void sp
        .saveToLibrary([t.uri])
        .then(() => toast(`Added “${t.name}” to Liked Songs`))
        .catch((e) => toast(errorText(e), 'error'))
    setIndex((i) => Math.min(feed.length, i + 1))
  }

  // keys: → like, ← pass, ↓ next, ↑ back, Q queue, Space pauses
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement)?.closest('input, textarea')) return
      if (e.key === 'ArrowRight') (e.preventDefault(), decide('like'))
      else if (e.key === 'ArrowLeft') (e.preventDefault(), decide('nope'))
      else if (e.key === 'ArrowDown') (e.preventDefault(), decide('next'))
      else if (e.key === 'ArrowUp') (e.preventDefault(), setIndex((i) => Math.max(0, i - 1)))
      else if ((e.key === 'q' || e.key === 'Q') && current) addToQueue(current.track)
      else if (e.code === 'Space') {
        e.preventDefault()
        e.stopPropagation()
        const a = audio.current
        if (a && a.src && !usedSpotify.current) {
          if (a.paused) void a.play()
          else a.pause()
        } else void togglePlay()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  if (!feed.length || index >= feed.length)
    return (
      <div className="disc disc--empty">
        <h1 className="page-title">Discover</h1>
        <p className="muted">
          {index >= feed.length && feed.length
            ? 'That’s everything for now. New songs come with your next mixes.'
            : loaded
              ? 'Your feed fills up as Pulse learns what you play. Listen for a bit and come back.'
              : 'Getting your feed ready…'}
        </p>
      </div>
    )

  const next = feed[index + 1]
  return (
    <div className="disc">
      <div className="disc__stack">
        {next && <Card key={next.track.id} item={next} top={false} canvas={null} progress={0} onDecide={() => {}} />}
        <AnimatePresence custom={fly}>
          <motion.div
            key={current.track.id}
            className="disc__fly"
            custom={fly}
            exit="out"
            variants={{
              out: (v: Verdict) => ({
                x: v === 'like' ? 900 : v === 'nope' ? -900 : 0,
                y: v === 'next' ? -700 : 40,
                rotate: v === 'like' ? 24 : v === 'nope' ? -24 : 0,
                opacity: 0,
                transition: { duration: 0.45, ease: [0.3, 0, 0.2, 1] }
              })
            }}
          >
            <Card item={current} top canvas={canvas} progress={progress} onDecide={decide} />
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="disc__bar">
        <button className="disc__act disc__act--nope" aria-label="Pass" title="Pass (←)" onClick={() => decide('nope')}>
          <span className="disc__x">✕</span>
        </button>
        <button className="disc__act" aria-label="Add to queue" title="Add to queue (Q)" onClick={() => addToQueue(current.track)}>
          <PlusIcon size={24} />
        </button>
        <button
          className="disc__act"
          aria-label="Play in full"
          title="Play the whole song"
          onClick={() => {
            audio.current?.pause()
            usedSpotify.current = true
            void playUris([current.track.uri])
          }}
        >
          <PlayIcon size={24} />
        </button>
        <button className="disc__act disc__act--like" aria-label="Like" title="Like (→)" onClick={() => decide('like')}>
          <HeartIcon size={28} filled />
        </button>
      </div>
      <button className={`disc__mute ${muted ? 'is-on' : ''}`} aria-label={muted ? 'Sound on' : 'Mute'} onClick={() => setMuted((m) => !m)}>
        <VolumeIcon size={18} level={muted ? 0 : 1} />
      </button>
      <span className="disc__hint">Drag right to like, left to pass · ↓ next · Space pauses</span>
    </div>
  )
}
