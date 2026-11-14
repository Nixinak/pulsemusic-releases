// Recap: your listening as full-screen stories. Each slide has its own loud palette;
// type is the star (huge, variable-width Bricolage that stretches as numbers count up).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from 'motion/react'
import { useApp } from '@/lib/store'
import { buildRecap, formatMinutes, hourLabel, listenerType, periodLabel, type Period, type Recap } from '@/lib/recap'
import { useHistory } from '@/lib/history'
import { livePosition, playContext, playUris, togglePlay, usePlayer } from '@/lib/player'
import { loadImage } from '@/lib/cards'
import { ShareSheet } from './ShareSheet'
import { CloseIcon, PauseIcon, PlayIcon, ShareIcon, VolumeIcon } from './Icons'

const SLIDE_MS = 7000

type Slide = {
  id: string
  colors: [string, string, string, string]
  ink: string
  render: (r: Recap) => React.JSX.Element
}

/* ---------- Building blocks ---------- */

/** A number that counts up while its letters stretch from narrow to wide. */
function CountUp({ value, suffix = '' }: { value: number; suffix?: string }): React.JSX.Element {
  const mv = useMotionValue(0)
  const text = useTransform(mv, (v) => Math.round(v).toLocaleString())
  const wdth = useTransform(mv, [0, value || 1], [75, 100])
  const settings = useTransform(wdth, (w) => `'wdth' ${w}`)
  useEffect(() => {
    const c = animate(mv, value, { duration: 2.2, ease: [0.16, 1, 0.3, 1], delay: 0.35 })
    return () => c.stop()
  }, [mv, value])
  return (
    <span className="rc__count">
      <motion.span style={{ fontVariationSettings: settings }}>{text}</motion.span>
      {suffix && <span className="rc__count-suffix">{suffix}</span>}
    </span>
  )
}

/** Words that rise in one after another. */
function Rise({ text, delay = 0, className = '' }: { text: string; delay?: number; className?: string }): React.JSX.Element {
  return (
    <span className={`rc__rise ${className}`} aria-label={text}>
      {text.split(' ').map((w, i) => (
        <span key={i} className="rc__rise-mask" aria-hidden="true">
          <motion.span
            initial={{ y: '110%', rotate: 4 }}
            animate={{ y: '0%', rotate: 0 }}
            transition={{ type: 'spring', stiffness: 160, damping: 20, delay: delay + i * 0.07 }}
          >
            {w}
          </motion.span>
        </span>
      ))}
    </span>
  )
}

function Art({ src, round, className = '' }: { src: string | null; round?: boolean; className?: string }): React.JSX.Element {
  return (
    <span className={`rc__art ${round ? 'is-round' : ''} ${className}`}>
      {src ? <img src={src} alt="" draggable={false} /> : <span className="rc__art-empty" />}
    </span>
  )
}

/* ---------- Slides ---------- */

const SLIDES: Slide[] = [
  {
    id: 'intro',
    colors: ['#ff2e88', '#ff9a3c', '#7b2cff', '#ffd23f'],
    ink: '#fff',
    render: (r) => (
      <div className="rc__center">
        <motion.div
          className="rc__disc"
          initial={{ scale: 0, rotate: -120 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 90, damping: 14 }}
        >
          {r.topArtists.slice(0, 4).map((a, i) => (
            <motion.span
              key={a.id}
              className="rc__disc-slice"
              style={{ rotate: i * 90 }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 + i * 0.12 }}
            >
              <img src={a.image ?? ''} alt="" />
            </motion.span>
          ))}
        </motion.div>
        <h1 className="rc__mega">
          <Rise text="Your Recap" delay={0.3} />
        </h1>
        <motion.p className="rc__lede" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }}>
          {r.label}. Let’s see what you played.
        </motion.p>
      </div>
    )
  },
  {
    id: 'minutes',
    colors: ['#0047ff', '#00d1ff', '#b6ff3b', '#3b00b8'],
    ink: '#fff',
    render: (r) => (
      <div className="rc__stack">
        <p className="rc__lede">
          <Rise text={r.period === 'all' ? 'So far you’ve listened for' : `In ${r.label} you listened for`} />
        </p>
        <h1 className="rc__giant">
          <CountUp value={r.minutes} />
        </h1>
        <p className="rc__lede rc__lede--big">
          <Rise text="minutes" delay={0.5} />
        </p>
        <motion.div className="rc__bars" initial="hidden" animate="show">
          {Array.from({ length: 28 }, (_, i) => (
            <motion.span
              key={i}
              className="rc__bar"
              style={{ animationDelay: `${(i % 7) * -0.17}s` }}
              variants={{ hidden: { scaleY: 0 }, show: { scaleY: 1, transition: { delay: 0.8 + i * 0.03 } } }}
            />
          ))}
        </motion.div>
        <motion.p className="rc__fine" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.4 }}>
          {r.plays.toLocaleString()} plays across {r.days} {r.days === 1 ? 'day' : 'days'}
          {r.minutes >= 1440 ? `. That’s ${(r.minutes / 1440).toFixed(1)} days of non-stop music.` : '.'}
        </motion.p>
      </div>
    )
  },
  {
    id: 'top-artist',
    colors: ['#ff5f1f', '#ff1f6b', '#ffcf1f', '#a8002f'],
    ink: '#fff',
    render: (r) => {
      const a = r.topArtists[0]
      if (!a) return <Empty />
      return (
        <div className="rc__stack rc__stack--artist">
          <motion.div
            className="rc__hero-img"
            initial={{ clipPath: 'circle(0% at 50% 50%)', scale: 1.3 }}
            animate={{ clipPath: 'circle(75% at 50% 50%)', scale: 1 }}
            transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }}
          >
            <img src={a.image ?? ''} alt="" />
          </motion.div>
          <p className="rc__lede">
            <Rise text="Your top artist" delay={0.6} />
          </p>
          <h1 className={`rc__name ${a.name.length > 14 ? 'is-long' : ''}`}>
            <Rise text={a.name} delay={0.8} />
          </h1>
          {a.minutes !== undefined && (
            <motion.p className="rc__fine" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.6 }}>
              {formatMinutes(a.minutes)} together, {a.plays} plays
            </motion.p>
          )}
        </div>
      )
    }
  },
  {
    id: 'artists',
    colors: ['#ffe600', '#ff7a00', '#ff3d7f', '#00c2a8'],
    ink: '#16130a',
    render: (r) => <Ranked title="Artists on rotation" items={r.topArtists.map((a) => ({ id: a.id, name: a.name, sub: a.minutes !== undefined ? formatMinutes(a.minutes) : '', image: a.image }))} round />
  },
  {
    id: 'top-song',
    colors: ['#5a00ff', '#ff00c8', '#00e0ff', '#1a0050'],
    ink: '#fff',
    render: (r) => {
      const t = r.topTracks[0]
      if (!t) return <Empty />
      return (
        <div className="rc__center">
          <motion.div
            className="rc__vinyl"
            initial={{ x: '-60vw', rotate: -360 }}
            animate={{ x: 0, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 50, damping: 14 }}
          >
            <span className="rc__vinyl-disc" />
            <Art src={t.image} className="rc__vinyl-sleeve" />
          </motion.div>
          <p className="rc__lede">
            <Rise text="The song you couldn’t skip" delay={0.5} />
          </p>
          <h1 className={`rc__name ${t.name.length > 18 ? 'is-long' : ''}`}>
            <Rise text={t.name} delay={0.7} />
          </h1>
          <motion.p className="rc__lede" initial={{ opacity: 0 }} animate={{ opacity: 0.8 }} transition={{ delay: 1.2 }}>
            {t.artist}
            {t.plays ? `. Played ${t.plays} ${t.plays === 1 ? 'time' : 'times'}.` : ''}
          </motion.p>
        </div>
      )
    }
  },
  {
    id: 'songs',
    colors: ['#00e676', '#00b3a4', '#c6ff00', '#004d40'],
    ink: '#03140c',
    render: (r) => <Ranked title="Your top songs" items={r.topTracks.map((t) => ({ id: t.id, name: t.name, sub: t.artist, image: t.image }))} />
  },
  {
    id: 'clock',
    colors: ['#0b1d6b', '#ffb000', '#ff4d00', '#3a0ca3'],
    ink: '#fff',
    render: (r) => <Clock hours={r.hours} />
  },
  {
    id: 'discover',
    colors: ['#ff4ecd', '#b388ff', '#40c4ff', '#ff8a65'],
    ink: '#1a0b24',
    render: (r) => (
      <div className="rc__grid3">
        {[
          { n: r.artistCount, label: r.artistCount === 1 ? 'artist' : 'different artists' },
          { n: r.songCount, label: r.songCount === 1 ? 'song' : 'different songs' },
          { n: r.period === 'all' ? r.days : r.newArtists, label: r.period === 'all' ? 'days with music' : 'artists new to you' },
          { n: r.streak, label: r.streak === 1 ? 'day streak' : 'days in a row, your longest streak' }
        ].map((s, i) => (
          <motion.div
            key={i}
            className="rc__tile"
            initial={{ y: 80, opacity: 0, rotate: i % 2 ? 4 : -4 }}
            animate={{ y: 0, opacity: 1, rotate: i % 2 ? 1.5 : -1.5 }}
            transition={{ type: 'spring', stiffness: 140, damping: 16, delay: 0.2 + i * 0.15 }}
          >
            <span className="rc__tile-n">
              <CountUp value={s.n} />
            </span>
            <span className="rc__tile-l">{s.label}</span>
          </motion.div>
        ))}
      </div>
    )
  }
]

function Empty(): React.JSX.Element {
  return (
    <div className="rc__center">
      <p className="rc__lede rc__lede--big">Not enough listening here yet. Play some music and come back.</p>
    </div>
  )
}

function Ranked({
  title,
  items,
  round
}: {
  title: string
  items: { id: string; name: string; sub: string; image: string | null }[]
  round?: boolean
}): React.JSX.Element {
  if (!items.length) return <Empty />
  return (
    <div className="rc__stack rc__stack--list">
      <h2 className="rc__title">
        <Rise text={title} />
      </h2>
      <ol className="rc__rank">
        {items.map((it, i) => (
          <motion.li
            key={it.id}
            initial={{ x: i % 2 ? 120 : -120, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 130, damping: 17, delay: 0.35 + i * 0.16 }}
          >
            <span className="rc__rank-n">{i + 1}</span>
            <Art src={it.image} round={round} />
            <span className="rc__rank-text">
              <b>{it.name}</b>
              {it.sub && <small>{it.sub}</small>}
            </span>
          </motion.li>
        ))}
      </ol>
    </div>
  )
}

function Clock({ hours }: { hours: number[] }): React.JSX.Element {
  const kind = listenerType(hours)
  const max = Math.max(1, ...hours)
  const R = 120
  return (
    <div className="rc__center">
      <svg className="rc__clock" viewBox="-200 -200 400 400" aria-hidden="true">
        <circle r={R - 8} className="rc__clock-face" />
        {hours.map((m, h) => {
          const a = (h / 24) * Math.PI * 2 - Math.PI / 2
          const len = 14 + (m / max) * 64
          return (
            <motion.line
              key={h}
              x1={Math.cos(a) * R}
              y1={Math.sin(a) * R}
              x2={Math.cos(a) * (R + len)}
              y2={Math.sin(a) * (R + len)}
              className={h === kind.peak ? 'is-peak' : ''}
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ delay: 0.3 + h * 0.05, duration: 0.6 }}
            />
          )
        })}
        <motion.text y="10" textAnchor="middle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.6 }}>
          {hourLabel(kind.peak)}
        </motion.text>
      </svg>
      <p className="rc__lede">
        <Rise text="You’re a" />
      </p>
      <h1 className="rc__name">
        <Rise text={kind.title} delay={0.3} />
      </h1>
      <motion.p className="rc__lede" initial={{ opacity: 0 }} animate={{ opacity: 0.85 }} transition={{ delay: 1.2 }}>
        {kind.text} Your busiest hour is {hourLabel(kind.peak)}.
      </motion.p>
    </div>
  )
}

/* ---------- Summary + share card ---------- */

async function renderSummaryCard(r: Recap, style: 'artwork' | 'color' | 'light'): Promise<string> {
  await document.fonts.load('800 64px "Bricolage Grotesque Variable"').catch(() => {})
  const W = 1080
  const H = 1920
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')!
  const light = style === 'light'
  const ink = light ? '#15121c' : '#fff'
  const soft = light ? 'rgba(21,18,28,0.6)' : 'rgba(255,255,255,0.75)'
  // Background: four slide colours as big soft blobs.
  ctx.fillStyle = light ? '#fbf7ff' : '#14061f'
  ctx.fillRect(0, 0, W, H)
  const hero = await loadImage(r.topArtists[0]?.image)
  if (style === 'artwork' && hero) {
    ctx.save()
    ctx.filter = 'blur(70px) saturate(1.8) brightness(0.7)'
    ctx.drawImage(hero, -200, -200, W + 400, H + 400)
    ctx.restore()
  } else {
    const cols = ['#ff2e88', '#0047ff', '#ffe600', '#00e676']
    ;[
      [0.1, 0.1],
      [0.95, 0.35],
      [0.15, 0.75],
      [0.9, 0.95]
    ].forEach(([x, y], i) => {
      const g = ctx.createRadialGradient(W * x, H * y, 0, W * x, H * y, W * 0.8)
      g.addColorStop(0, cols[i] + (light ? '66' : 'cc'))
      g.addColorStop(1, 'transparent')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, W, H)
    })
  }
  const pad = 90
  ctx.fillStyle = ink
  ctx.font = '800 120px "Bricolage Grotesque Variable", sans-serif'
  ctx.fillText('My Recap', pad, 230)
  ctx.font = '600 40px "Figtree Variable", sans-serif'
  ctx.fillStyle = soft
  ctx.fillText(r.label, pad, 295)
  if (hero) {
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(pad, 360, W - pad * 2, 560, 40)
    ctx.clip()
    const s = Math.max((W - pad * 2) / hero.width, 560 / hero.height)
    ctx.drawImage(hero, pad + (W - pad * 2 - hero.width * s) / 2, 360 + (560 - hero.height * s) / 2, hero.width * s, hero.height * s)
    ctx.restore()
  }
  const col = (title: string, rows: string[], x: number): void => {
    ctx.fillStyle = soft
    ctx.font = '700 36px "Figtree Variable", sans-serif'
    ctx.fillText(title, x, 1010)
    ctx.fillStyle = ink
    ctx.font = '700 40px "Figtree Variable", sans-serif'
    rows.slice(0, 5).forEach((t, i) => {
      let s = `${i + 1}  ${t}`
      while (ctx.measureText(s).width > W / 2 - pad - 20 && s.length > 4) s = `${s.slice(0, -2)}…`
      ctx.fillText(s, x, 1075 + i * 62)
    })
  }
  col('Top artists', r.topArtists.map((a) => a.name), pad)
  col('Top songs', r.topTracks.map((t) => t.name), W / 2 + 10)
  ctx.fillStyle = soft
  ctx.font = '700 36px "Figtree Variable", sans-serif'
  ctx.fillText('Minutes listened', pad, 1480)
  ctx.fillText('Listener type', W / 2 + 10, 1480)
  ctx.fillStyle = ink
  ctx.font = '800 110px "Bricolage Grotesque Variable", sans-serif'
  ctx.fillText(r.minutes.toLocaleString(), pad, 1600)
  ctx.font = '800 64px "Bricolage Grotesque Variable", sans-serif'
  ctx.fillText(listenerType(r.hours).title, W / 2 + 10, 1580)
  ctx.font = '800 34px "Bricolage Grotesque Variable", sans-serif'
  ctx.fillStyle = soft
  ctx.textAlign = 'right'
  ctx.fillText('Pulse Music', W - pad, H - pad)
  return c.toDataURL('image/png')
}

function Summary({ r, onReplay, onShare }: { r: Recap; onReplay: () => void; onShare: () => void }): React.JSX.Element {
  return (
    <div className="rc__summary">
      <motion.div className="rc__sum-card" initial={{ y: 60, opacity: 0, rotate: -2 }} animate={{ y: 0, opacity: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 120, damping: 16 }}>
        <div className="rc__sum-head">
          <Art src={r.topArtists[0]?.image ?? null} />
          <div>
            <h2>My Recap</h2>
            <p>{r.label}</p>
          </div>
        </div>
        <div className="rc__sum-cols">
          <div>
            <h3>Top artists</h3>
            <ol>
              {r.topArtists.map((a) => (
                <li key={a.id}>{a.name}</li>
              ))}
            </ol>
          </div>
          <div>
            <h3>Top songs</h3>
            <ol>
              {r.topTracks.map((t) => (
                <li key={t.id}>{t.name}</li>
              ))}
            </ol>
          </div>
        </div>
        <div className="rc__sum-cols rc__sum-cols--stats">
          <div>
            <h3>Minutes listened</h3>
            <strong>{r.minutes.toLocaleString()}</strong>
          </div>
          <div>
            <h3>Listener type</h3>
            <strong className="is-small">{listenerType(r.hours).title}</strong>
          </div>
        </div>
      </motion.div>
      <div className="rc__sum-actions" onClick={(e) => e.stopPropagation()}>
        <button className="rc__btn rc__btn--solid" onClick={onShare}>
          <ShareIcon size={18} /> Share
        </button>
        {r.topTracks.length > 0 && (
          <button className="rc__btn" onClick={() => void playUris(r.topTracks.map((t) => t.uri))}>
            <PlayIcon size={18} /> Play top songs
          </button>
        )}
        <button className="rc__btn" onClick={onReplay}>
          Replay
        </button>
      </div>
      {r.source === 'spotify' && (
        <p className="rc__fine rc__note">Top lists come from Spotify until Pulse Music has seen more of your listening. Minutes count what you played with Pulse Music open.</p>
      )}
    </div>
  )
}

/* ---------- Music ---------- */

const MUSIC_KEY = 'pulse-recap-music'
const CHORUS_MS = 45_000

/** What plays under each slide: the artist or song it shows, else one of your top songs. */
function songFor(r: Recap, slideId: string | null): { uri: string; context?: boolean } | null {
  const t = r.topTracks
  const byArtist = (name?: string): string | null => (name ? (t.find((x) => x.artist.split(', ').includes(name))?.uri ?? null) : null)
  const artistPick = (i: number): { uri: string; context?: boolean } | null => {
    const a = r.topArtists[i]
    if (!a) return null
    const own = byArtist(a.name)
    return own ? { uri: own } : { uri: a.uri, context: true }
  }
  const song = (i: number): { uri: string } | null => (t[i] ?? t[0] ? { uri: (t[i] ?? t[0]).uri } : null)
  switch (slideId) {
    case 'intro':
      return song(0)
    case 'minutes':
      return song(1)
    case 'top-artist':
      return artistPick(0)
    case 'artists':
      return artistPick(1) ?? song(2)
    case 'top-song':
      return song(0)
    case 'songs':
      return song(2)
    case 'clock':
      return song(3)
    case 'discover':
      return song(4)
    default:
      // the summary keeps whatever is playing
      return null
  }
}

/**
 * Plays the song (or artist) of the slide on screen, from about the chorus, while Recap is
 * open; puts back what you were listening to when it closes.
 */
function useRecapMusic(open: boolean, data: Recap | null, slideId: string | null, on: boolean): void {
  const before = useRef<{ uri: string; context: string | null; position: number; playing: boolean } | null | undefined>(undefined)
  const playing = useRef<string | null>(null)

  // remember what played before Recap
  useEffect(() => {
    if (!open) return
    const s = usePlayer.getState()
    before.current = s.track ? { uri: s.track.uri, context: s.contextUri, position: livePosition(s), playing: !s.paused } : null
    playing.current = null
    return () => {
      const was = before.current
      before.current = undefined
      if (!playing.current) return
      playing.current = null
      // put things back the way they were
      if (was?.playing) {
        if (was.context) void playContext(was.context, was.uri, undefined, { positionMs: was.position })
        else void playUris([was.uri], undefined, { positionMs: was.position })
      } else if (!usePlayer.getState().paused) void togglePlay()
    }
  }, [open])

  // the song for this slide
  useEffect(() => {
    if (!open || !data || !on) return
    const pick = songFor(data, slideId)
    if (!pick || pick.uri === playing.current) return
    // a short wait, so flicking through slides doesn't start a song for each one
    const t = window.setTimeout(() => {
      playing.current = pick.uri
      if (pick.context) void playContext(pick.uri)
      else void playUris([pick.uri], undefined, { positionMs: CHORUS_MS })
    }, 450)
    return () => window.clearTimeout(t)
  }, [open, data, slideId, on])

  // sound turned off: stop the music
  useEffect(() => {
    if (!open || on || !playing.current) return
    if (!usePlayer.getState().paused) void togglePlay()
  }, [open, on])
}

/* ---------- Player ---------- */

export function RecapStories(): React.JSX.Element {
  const open = useApp((s) => s.recapOpen)
  const setOpen = useApp((s) => s.setRecapOpen)
  const historyLoaded = useHistory((s) => s.loaded)
  const startPeriod = useApp((s) => s.recapPeriod) as Period
  const [period, setPeriod] = useState<Period>('month')
  // opened for one month (from the Replay months on Your stats): start there
  useEffect(() => {
    if (open) setPeriod(startPeriod)
  }, [open, startPeriod])
  const [data, setData] = useState<Recap | null>(null)
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [sharing, setSharing] = useState(false)
  const progress = useMotionValue(0)
  const elapsed = useRef(0)
  const [music, setMusic] = useState(() => {
    try {
      return localStorage.getItem(MUSIC_KEY) !== '0'
    } catch {
      return true
    }
  })
  const toggleMusic = (): void =>
    setMusic((m) => {
      try {
        localStorage.setItem(MUSIC_KEY, m ? '0' : '1')
      } catch {
        /* not remembered */
      }
      return !m
    })

  const total = SLIDES.length + 1
  const close = useCallback(() => setOpen(false), [setOpen])

  useEffect(() => {
    if (!open || !historyLoaded) return
    let alive = true
    setData(null)
    setIndex(0)
    elapsed.current = 0
    void buildRecap(period).then((r) => {
      if (!alive) return
      // Pre-load the images so slides don't pop in.
      void Promise.all([...r.topArtists.map((a) => a.image), ...r.topTracks.map((t) => t.image)].map((u) => loadImage(u)))
      setData(r)
    })
    return () => {
      alive = false
    }
  }, [open, period, historyLoaded])

  const go = useCallback(
    (d: 1 | -1) => {
      elapsed.current = 0
      progress.set(0)
      setIndex((i) => {
        const n = i + d
        if (n < 0) return 0
        if (n >= total) return total - 1
        return n
      })
    },
    [progress, total]
  )

  // Auto-advance (the last slide, the summary, waits).
  useEffect(() => {
    if (!open || !data || paused || sharing || index >= total - 1) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number): void => {
      elapsed.current += now - last
      last = now
      progress.set(Math.min(1, elapsed.current / SLIDE_MS))
      if (elapsed.current >= SLIDE_MS) go(1)
      else raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [open, data, paused, sharing, index, total, go, progress])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (sharing) return
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === ' ') {
        e.preventDefault()
        e.stopPropagation()
        setPaused((p) => !p)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, close, go, sharing])

  const slide = index < SLIDES.length ? SLIDES[index] : null
  useRecapMusic(open, data, slide?.id ?? null, music)
  const colors = slide?.colors ?? ['#ff2e88', '#0047ff', '#ffe600', '#00e676']
  const ink = slide?.ink ?? '#fff'
  const style = useMemo(
    () =>
      ({
        '--c1': colors[0],
        '--c2': colors[1],
        '--c3': colors[2],
        '--c4': colors[3],
        '--ink': ink
      }) as React.CSSProperties,
    [colors, ink]
  )

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="rc"
          style={style}
          initial={{ opacity: 0, scale: 1.04 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 1.04 }}
          transition={{ duration: 0.4 }}
        >
          <div className="rc__bg" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
          <div className="rc__grain" aria-hidden="true" />

          <header className="rc__top">
            <div className="rc__progress">
              {Array.from({ length: total }, (_, i) => (
                <span key={i} className="rc__seg">
                  {i < index ? (
                    <span className="rc__seg-fill" style={{ transform: 'scaleX(1)' }} />
                  ) : i === index ? (
                    <motion.span className="rc__seg-fill" style={{ scaleX: index === total - 1 ? 1 : progress }} />
                  ) : null}
                </span>
              ))}
            </div>
            <div className="rc__controls">
              <div className="rc__periods">
                {[...(period.startsWith('m:') ? [period] : startPeriod.startsWith('m:') ? [startPeriod] : []), 'month', 'year', 'all'].map((p) => (
                  <button key={p} className={period === p ? 'is-on' : ''} onClick={() => setPeriod(p as Period)}>
                    {p === 'month' ? 'This month' : p === 'year' ? 'This year' : p === 'all' ? 'All time' : periodLabel(p as Period)}
                  </button>
                ))}
              </div>
              <button className={`rc__icon ${music ? '' : 'is-off'}`} aria-label={music ? 'Turn music off' : 'Turn music on'} title={music ? 'Music on' : 'Music off'} onClick={toggleMusic}>
                <VolumeIcon size={18} level={music ? 1 : 0} />
              </button>
              <button className="rc__icon" aria-label={paused ? 'Resume' : 'Pause'} onClick={() => setPaused((p) => !p)}>
                {paused ? <PlayIcon size={18} /> : <PauseIcon size={18} />}
              </button>
              <button className="rc__icon" aria-label="Close Recap" onClick={close}>
                <CloseIcon size={20} />
              </button>
            </div>
          </header>

          {/* Tap left / right halves to move, like stories. */}
          <button className="rc__tap rc__tap--prev" aria-label="Previous" onClick={() => go(-1)} />
          <button className="rc__tap rc__tap--next" aria-label="Next" onClick={() => go(1)} />

          <main className="rc__stage">
            {!data ? (
              <div className="rc__center">
                <motion.div className="rc__loader" animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.4, ease: 'linear' }} />
                <p className="rc__lede">Counting your plays…</p>
              </div>
            ) : (
              <AnimatePresence mode="wait">
                <motion.section
                  key={`${period}-${index}`}
                  className="rc__slide"
                  initial={{ opacity: 0, scale: 0.94, filter: 'blur(12px)' }}
                  animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, scale: 1.06, filter: 'blur(12px)' }}
                  transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                >
                  {slide ? slide.render(data) : <Summary r={data} onReplay={() => (setIndex(0), progress.set(0))} onShare={() => setSharing(true)} />}
                </motion.section>
              </AnimatePresence>
            )}
          </main>

          {data && (
            <ShareSheet
              open={sharing}
              title="Share your Recap"
              fileName={`Recap ${data.label}`}
              formats={['story']}
              onClose={() => setSharing(false)}
              render={(_f, s) => renderSummaryCard(data, s)}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}
