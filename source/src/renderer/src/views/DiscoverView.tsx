// Discover: new music one song at a time, like a short-video feed. Scroll (or press ↓) to the next
// song; each one plays its 30-second preview on its own (your Spotify playback pauses while the
// feed is open and carries on when you leave). Like it, queue it, play it in full, or say it's
// not for you. The songs come from your Made for you mixes (Discover Weekly, Release Radar, Deep
// Cuts and the Daily Mixes), so the feed costs no extra Spotify requests.
import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import type { STrack } from '@/lib/types'
import * as sp from '@/lib/spotify'
import { useMadeForYou, type MixKind } from '@/lib/madeForYou'
import { addToQueue, playUris, togglePlay, usePlayer } from '@/lib/player'
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

/** Where the feed's songs come from, the most "new to you" first. */
const ORDER: MixKind[] = ['discover', 'radar', 'deep', 'daily', 'capsule']

/** Songs mixed from the mixes, taking turns between them, without repeats or skipped ones. */
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
  }, [mixes])
}

/** The 30 s previews, fetched as audio a couple of songs ahead. */
const previews = new Map<string, Promise<string | null>>()
function previewUrl(t: STrack): Promise<string | null> {
  let p = previews.get(t.id)
  if (!p) {
    p = window.pulse.recs
      .preview(t.name, t.artists[0]?.name ?? '')
      .then((b64) =>
        b64
          ? URL.createObjectURL(
              new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], {
                type: 'audio/mpeg'
              })
            )
          : null
      )
      .catch(() => null)
    previews.set(t.id, p)
  }
  return p
}

export function DiscoverView(): React.JSX.Element {
  const feed = useFeed()
  const loaded = useMadeForYou((s) => s.loaded)
  const [index, setIndex] = useState(0)
  const [liked, setLiked] = useState<Set<string>>(new Set())
  const [muted, setMuted] = useState(false)
  const [progress, setProgress] = useState(0)
  const [noPreview, setNoPreview] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const audio = useRef<HTMLAudioElement | null>(null)
  const toast = useApp((s) => s.toast)
  const current = feed[index]

  // your own music pauses while the feed plays, and carries on when you leave
  useEffect(() => {
    const was = !usePlayer.getState().paused
    if (was) void togglePlay()
    return () => {
      audio.current?.pause()
      if (was && usePlayer.getState().paused) void togglePlay()
    }
  }, [])

  // the song on screen plays its preview (and the next two are fetched)
  useEffect(() => {
    if (!current) return
    let alive = true
    setProgress(0)
    setNoPreview(null)
    for (const it of feed.slice(index + 1, index + 3)) void previewUrl(it.track)
    void previewUrl(current.track).then((url) => {
      if (!alive) return
      if (!url) return setNoPreview(current.track.id)
      const a = audio.current ?? new Audio()
      audio.current = a
      a.src = url
      a.loop = true
      a.muted = muted
      a.volume = 0
      void a.play().catch(() => undefined)
      // a short fade in
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
    return () => {
      alive = false
      audio.current?.pause()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.track.id])

  useEffect(() => {
    if (audio.current) audio.current.muted = muted
  }, [muted])

  // the preview's progress
  useEffect(() => {
    const t = window.setInterval(() => {
      const a = audio.current
      if (a && a.duration) setProgress(a.currentTime / a.duration)
    }, 200)
    return () => window.clearInterval(t)
  }, [])

  // which card is on screen
  const onScroll = (): void => {
    const el = scroller.current
    if (!el) return
    const i = Math.round(el.scrollTop / el.clientHeight)
    if (i !== index) setIndex(Math.max(0, Math.min(feed.length - 1, i)))
  }
  const go = (d: number): void => {
    const el = scroller.current
    if (!el) return
    el.scrollTo({
      top: Math.max(0, Math.min(feed.length - 1, index + d)) * el.clientHeight,
      behavior: 'smooth'
    })
  }

  const like = async (t: STrack): Promise<void> => {
    setLiked((s) => new Set(s).add(t.id))
    try {
      await sp.saveToLibrary([t.uri])
      toast(`Added “${t.name}” to Liked Songs`)
    } catch (e) {
      setLiked((s) => {
        const n = new Set(s)
        n.delete(t.id)
        return n
      })
      toast(errorText(e), 'error')
    }
  }
  const skip = (t: STrack): void => {
    try {
      localStorage.setItem(SKIP_KEY, JSON.stringify([...readSkips(), t.id].slice(-800)))
    } catch {
      /* not remembered */
    }
    go(1)
  }

  // keys: ↑ ↓ to move, Space for the preview, L to like
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement)?.closest('input, textarea')) return
      if (e.key === 'ArrowDown' || e.key === 'j') (e.preventDefault(), go(1))
      else if (e.key === 'ArrowUp' || e.key === 'k') (e.preventDefault(), go(-1))
      else if (e.key === 'l' && current) void like(current.track)
      else if (e.code === 'Space' && audio.current) {
        e.preventDefault()
        e.stopPropagation()
        if (audio.current.paused) void audio.current.play()
        else audio.current.pause()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  if (!feed.length)
    return (
      <div className="disc disc--empty">
        <h1 className="page-title">Discover</h1>
        <p className="muted">{loaded ? 'Your feed fills up as Pulse learns what you play. Listen for a bit and come back.' : 'Getting your feed ready…'}</p>
      </div>
    )

  return (
    <div className="disc">
      <div className="disc__feed" ref={scroller} onScroll={onScroll}>
        {feed.map((it, i) => {
          const t = it.track
          const art = sp.pickImage(t.album?.images, 640)
          const near = Math.abs(i - index) <= 2
          const isLiked = liked.has(t.id)
          return (
            <section key={t.id} className={`disc__card ${i === index ? 'is-on' : ''}`}>
              {near && (
                <>
                  <span className="disc__bg" aria-hidden="true">
                    {art && <img src={art} alt="" />}
                  </span>
                  <motion.div
                    className="disc__stage"
                    initial={false}
                    animate={i === index ? { scale: 1, opacity: 1 } : { scale: 0.9, opacity: 0.4 }}
                    transition={{ type: 'spring', stiffness: 200, damping: 24 }}
                  >
                    <div className="disc__art">
                      {art && <img src={art} alt="" draggable={false} />}
                      {i === index && (
                        <span className="disc__progress" aria-hidden="true">
                          <i style={{ width: `${progress * 100}%` }} />
                        </span>
                      )}
                    </div>
                    <div className="disc__info">
                      <span className="disc__why">{it.why}</span>
                      <h2>
                        <Emo>{t.name}</Emo>
                      </h2>
                      <p>{t.artists.map((a) => a.name).join(', ')}</p>
                      {i === index && noPreview === t.id && <small className="muted">No preview for this one. Press play to hear it on Spotify.</small>}
                    </div>
                  </motion.div>
                  <div className="disc__rail">
                    <button className={`disc__act ${isLiked ? 'is-on' : ''}`} aria-label="Like" title="Like (L)" onClick={() => !isLiked && void like(t)}>
                      <HeartIcon size={26} filled={isLiked} />
                      <span>{isLiked ? 'Liked' : 'Like'}</span>
                    </button>
                    <button className="disc__act" aria-label="Add to queue" title="Add to queue" onClick={() => addToQueue(t)}>
                      <PlusIcon size={26} />
                      <span>Queue</span>
                    </button>
                    <button
                      className="disc__act"
                      aria-label="Play in full"
                      title="Play the whole song"
                      onClick={() => (audio.current?.pause(), void playUris([t.uri]))}
                    >
                      <PlayIcon size={26} />
                      <span>Play</span>
                    </button>
                    <button className="disc__act" aria-label="Not for me" title="Not for me" onClick={() => skip(t)}>
                      <span className="disc__nope">✕</span>
                      <span>Nope</span>
                    </button>
                  </div>
                </>
              )}
            </section>
          )
        })}
      </div>
      <button className={`disc__mute ${muted ? 'is-on' : ''}`} aria-label={muted ? 'Sound on' : 'Mute'} onClick={() => setMuted((m) => !m)}>
        <VolumeIcon size={18} level={muted ? 0 : 1} />
      </button>
      <span className="disc__hint">↑ ↓ to scroll · Space pauses · L likes</span>
    </div>
  )
}
