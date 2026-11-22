// More for the home page: quick tiles of what you played lately, mixes made from your top
// artists, mood shortcuts for the DJ, recently played songs, new releases, your month so far
// and the albums you saved.
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '@/lib/store'
import { useQuery } from '@/lib/useQuery'
import * as sp from '@/lib/spotify'
import { playContext, playUris, usePlayer } from '@/lib/player'
import { prefetchAlbum } from '@/lib/loaders'
import { startDj } from '@/lib/dj'
import { computeStats, isRealId, startOfMonth, useHistory } from '@/lib/history'
import { formatMinutes, yearPeriod } from '@/lib/recap'
import { replayYear } from './ReplayMonths'
import { useArtistImage } from '@/lib/artistImage'
import { Cover, EqBars, MediaCard, Shelf, ShelfRow } from '@/components/common'
import { contextMenuFor } from '@/components/menus'
import { HeartIcon, PlayIcon, SparkleIcon } from '@/components/Icons'
import { MoodArt, type MoodArtKind } from '@/components/MoodArt'
import { useMadeForYou } from '@/lib/madeForYou'
import type { SAlbumRef, SArtist, STrack } from '@/lib/types'

type RecentItem = { track: STrack; played_at: string; context?: { type?: string; uri?: string } | null }

/* ---------- Even rows ---------- */

/**
 * How to lay `count` items out so every row is full: as many columns as fit (each at least
 * `minWidth`), `rows` rows of them, never a half-empty last row. Too narrow for `minCols`
 * columns: a sideways slider instead.
 */
export function useEvenGrid(
  count: number,
  minWidth: number,
  gap: number,
  rows: number,
  minCols = 2
): { ref: React.RefObject<HTMLDivElement | null>; cols: number; show: number; slider: boolean } {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = (): void => setWidth(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const fit = Math.max(1, Math.floor((width + gap) / (minWidth + gap)))
  if (!width || fit < minCols) return { ref, cols: fit, show: count, slider: !!width }
  // fewer items than the rows could hold: fewer, wider columns so the rows still fill up
  const cols = Math.min(fit, Math.max(minCols, Math.floor(count / rows)))
  const show = Math.min(count, cols * rows)
  // still not enough for the rows: as many full rows as there are
  const full = show >= cols ? Math.floor(show / cols) * cols : show
  return { ref, cols, show: full, slider: false }
}

/* ---------- Quick tiles ---------- */

interface Tile {
  key: string
  title: string
  image: string | null
  liked?: boolean
  open: () => void
  play: () => void
  uri?: string
}

export function QuickTiles({ recent }: { recent: RecentItem[] }): React.JSX.Element | null {
  const navigate = useApp((s) => s.navigate)
  const playlists = useApp((s) => s.playlists)
  const meId = useApp((s) => s.me?.id)
  const playingUri = usePlayer((s) => s.contextUri ?? null)
  const paused = usePlayer((s) => s.paused)
  const tiles = useMemo<Tile[]>(() => {
    const out: Tile[] = [
      {
        key: 'liked',
        title: 'Liked Songs',
        image: null,
        liked: true,
        uri: meId ? `spotify:user:${meId}:collection` : undefined,
        open: () => navigate({ name: 'liked' }),
        play: () => meId && void playContext(`spotify:user:${meId}:collection`)
      }
    ]
    const seen = new Set<string>()
    const byUri = new Map(playlists.map((p) => [p.uri, p]))
    for (const r of recent) {
      if (out.length >= 16) break
      const ctx = r.context?.uri
      const pl = ctx ? byUri.get(ctx) : undefined
      if (pl) {
        if (seen.has(pl.uri)) continue
        seen.add(pl.uri)
        out.push({
          key: pl.id,
          title: pl.name,
          image: sp.pickImage(pl.images, 120),
          uri: pl.uri,
          open: () => navigate({ name: 'playlist', id: pl.id }),
          play: () => void playContext(pl.uri)
        })
        continue
      }
      const al = r.track?.album
      if (!al?.id || seen.has(al.uri)) continue
      seen.add(al.uri)
      out.push({
        key: al.id,
        title: al.name,
        image: sp.pickImage(al.images, 120),
        uri: al.uri,
        open: () => {
          prefetchAlbum(al.id)
          navigate({ name: 'album', id: al.id })
        },
        play: () => void playContext(al.uri)
      })
    }
    // not much played lately: fill with your playlists
    for (const p of playlists) {
      if (out.length >= 16) break
      if (seen.has(p.uri)) continue
      seen.add(p.uri)
      out.push({
        key: p.id,
        title: p.name,
        image: sp.pickImage(p.images, 120),
        uri: p.uri,
        open: () => navigate({ name: 'playlist', id: p.id }),
        play: () => void playContext(p.uri)
      })
    }
    return out
  }, [recent, playlists, navigate, meId])
  const grid = useEvenGrid(tiles.length, 230, 10, 2)
  const tile = (t: Tile): React.JSX.Element => {
    const on = !!t.uri && t.uri === playingUri
    return (
      <div key={t.key} className={`qtile ${on ? 'is-on' : ''}`} role="button" tabIndex={0} onClick={t.open} onKeyDown={(e) => e.key === 'Enter' && t.open()}>
        {t.liked ? (
          <span className="qtile__liked">
            <HeartIcon size={20} filled />
          </span>
        ) : (
          <Cover src={t.image} size={56} radius={0} />
        )}
        <b>{t.title}</b>
        {on ? (
          <span className="qtile__eq">
            <EqBars playing={!paused} />
          </span>
        ) : (
          <button
            className="qtile__play"
            aria-label={`Play ${t.title}`}
            onClick={(e) => {
              e.stopPropagation()
              t.play()
            }}
          >
            <PlayIcon size={16} />
          </button>
        )}
      </div>
    )
  }
  if (tiles.length < 2) return null
  return (
    <section ref={grid.ref} className="qtiles-wrap">
      {grid.slider ? (
        <ShelfRow className="qtiles qtiles--row">{tiles.map(tile)}</ShelfRow>
      ) : (
        <div className="qtiles" style={{ gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))` }}>
          {tiles.slice(0, grid.show).map(tile)}
        </div>
      )}
    </section>
  )
}

/* ---------- Mixes made from your artists ---------- */

const MIX_HUES = [330, 265, 200, 160, 28, 8]

function MixFace({ artist, i }: { artist: SArtist; i: number }): React.JSX.Element {
  const img = useArtistImage(artist.id, sp.pickImage(artist.images, 160))
  return (
    <span className="mixcard__face" style={{ ['--i' as string]: i }}>
      <Cover src={img} round />
    </span>
  )
}

/** Six mixes: each leads with one of your top artists and adds two more you play. */
export function YourMixes({ artists, tracks }: { artists: SArtist[]; tracks: STrack[] }): React.JSX.Element | null {
  const toast = useApp((s) => s.toast)
  const mixes = useMemo(() => {
    if (artists.length < 3) return []
    const n = Math.min(6, Math.floor(artists.length / 2))
    return Array.from({ length: n }, (_, i) => {
      const group = [artists[i], artists[(i + n) % artists.length], artists[(i + 2 * n) % artists.length]].filter(
        (a, j, l) => a && l.findIndex((x) => x.id === a.id) === j
      )
      const ids = new Set(group.map((a) => a.id))
      const songs = tracks.filter((t) => t.artists.some((a) => ids.has(a.id)))
      return { id: `mix${i}`, n: i + 1, group, songs, hue: MIX_HUES[i % MIX_HUES.length] }
    })
  }, [artists, tracks])
  if (!mixes.length) return null

  const play = async (m: (typeof mixes)[number]): Promise<void> => {
    let uris = m.songs.map((t) => t.uri)
    if (uris.length < 12) {
      // too few of your own top songs: add each artist's popular songs
      const more = await Promise.all(
        m.group.map((a) =>
          sp
            .searchTracks(`artist:"${a.name}"`, 0)
            .then((r) => (r.tracks?.items ?? []).filter((t) => t?.artists?.some((x) => x.id === a.id)))
            .catch(() => [] as STrack[])
        )
      )
      const extra = more.flat().map((t) => t.uri)
      uris = [...new Set([...uris, ...extra])]
    }
    if (!uris.length) return toast('Couldn’t find songs for this mix.', 'error')
    // shuffle, keeping the first song of your own list up front
    const [first, ...rest] = uris
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[rest[i], rest[j]] = [rest[j], rest[i]]
    }
    await playUris([first, ...rest])
  }

  return (
    <Shelf title="Made for you">
      {mixes.map((m) => (
        <div key={m.id} className="mixcard" role="button" tabIndex={0} style={{ ['--h' as string]: m.hue }} onClick={() => void play(m)}>
          <div className="mixcard__art">
            <span className="mixcard__faces">
              {m.group.map((a, i) => (
                <MixFace key={a.id} artist={a} i={i} />
              ))}
            </span>
            <span className="mixcard__label">Mix {m.n}</span>
            <span className="mixcard__play" aria-hidden="true">
              <PlayIcon size={20} />
            </span>
          </div>
          <div className="card__title">{m.group.map((a) => a.name).join(', ')}</div>
          <div className="card__sub">{m.songs.length ? `${m.songs.length} of your top songs and more` : 'Their best songs'}</div>
        </div>
      ))}
    </Shelf>
  )
}

/* ---------- Moods for the DJ ---------- */

export const MOODS: { label: string; ask: string; a: string; b: string; art: MoodArtKind }[] = [
  { label: 'Late night drive', ask: 'late night drive', a: '#1b1f5e', b: '#7a2cff', art: 'drive' },
  { label: 'Gym', ask: 'gym', a: '#ff3d2e', b: '#ff9f1c', art: 'gym' },
  { label: 'Chill', ask: 'something chill', a: '#0c7c8c', b: '#7bdff2', art: 'chill' },
  { label: 'Party', ask: 'party mode', a: '#ff2e88', b: '#ffd23f', art: 'party' },
  { label: 'Focus', ask: 'deep focus', a: '#244b3c', b: '#9be38f', art: 'focus' },
  { label: 'Sad hours', ask: 'sad songs', a: '#283a5e', b: '#8aa6d6', art: 'sad' },
  { label: 'Throwback', ask: 'throwbacks', a: '#7a3b12', b: '#f4b860', art: 'throwback' },
  { label: 'What’s new', ask: 'what’s new', a: '#5a1fd1', b: '#00d1ff', art: 'new' }
]

/** One mood card: tap it and the DJ starts a show in that mood. */
export function MoodTile({ m, disabled = false }: { m: (typeof MOODS)[number]; disabled?: boolean }): React.JSX.Element {
  return (
    <button className="mood" disabled={disabled} style={{ ['--a' as string]: m.a, ['--b' as string]: m.b }} onClick={() => void startDj(m.ask)}>
      <MoodArt kind={m.art} />
      <span className="mood__grain" aria-hidden="true" />
      <b>{m.label}</b>
    </button>
  )
}

export function MoodRow(): React.JSX.Element {
  const grid = useEvenGrid(MOODS.length, 170, 12, 2)
  const mood = (m: (typeof MOODS)[number]): React.JSX.Element => <MoodTile key={m.ask} m={m} />
  return (
    <section className="shelf">
      <header className="shelf__head">
        <h2>Ask the DJ for</h2>
      </header>
      <div ref={grid.ref}>
        {grid.slider ? (
          <ShelfRow className="moods--row">{MOODS.map(mood)}</ShelfRow>
        ) : (
          <div className="moods" style={{ gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))` }}>
            {MOODS.slice(0, grid.show).map(mood)}
          </div>
        )}
      </div>
    </section>
  )
}

/* ---------- Recently played songs ---------- */

export function RecentlyPlayed({ recent }: { recent: RecentItem[] }): React.JSX.Element | null {
  const navigate = useApp((s) => s.navigate)
  const songs = useMemo(() => {
    const seen = new Set<string>()
    return recent
      .map((r) => r.track)
      .filter((t) => t?.id && !seen.has(t.id) && !!seen.add(t.id))
      .slice(0, 20)
  }, [recent])
  if (songs.length < 3) return null
  const uris = songs.map((t) => t.uri)
  return (
    <Shelf
      title="Recently played"
      action={
        <button className="shelf__more" onClick={() => void playUris(uris)}>
          Play all
        </button>
      }
    >
      {songs.map((t) => (
        <MediaCard
          key={t.id}
          image={sp.pickImage(t.album?.images, 300)}
          title={t.name}
          subtitle={t.artists.map((a) => a.name).join(', ')}
          onOpen={() => (t.album?.id ? navigate({ name: 'album', id: t.album.id }) : void playUris(uris, t.uri))}
          onPrefetch={() => t.album?.id && prefetchAlbum(t.album.id)}
          onPlay={() => void playUris(uris, t.uri)}
        />
      ))}
    </Shelf>
  )
}

/* ---------- New releases ---------- */

export function NewReleases({ albums }: { albums: SAlbumRef[] }): React.JSX.Element | null {
  const navigate = useApp((s) => s.navigate)
  const openMenu = useApp((s) => s.openMenu)
  if (albums.length < 2) return null
  return (
    <Shelf title="New from your artists">
      {albums.map((al) => (
        <MediaCard
          key={al.id}
          image={sp.pickImage(al.images, 300)}
          title={al.name}
          subtitle={`${al.album_type === 'single' ? 'Single' : 'Album'} · ${al.artists.map((a) => a.name).join(', ')}`}
          onOpen={() => navigate({ name: 'album', id: al.id })}
          onPrefetch={() => prefetchAlbum(al.id)}
          onPlay={() => void playContext(al.uri)}
          onContextMenu={(e) => {
            e.preventDefault()
            openMenu(e.clientX, e.clientY, contextMenuFor('album', al.uri, al.name))
          }}
        />
      ))}
    </Shelf>
  )
}

/* ---------- Your month so far ---------- */

export function MonthCard(): React.JSX.Element | null {
  const plays = useHistory((s) => s.plays)
  const navigate = useApp((s) => s.navigate)
  const setRecapOpen = useApp((s) => s.setRecapOpen)
  const stats = useMemo(() => computeStats(plays, startOfMonth()), [plays])
  if (stats.plays < 5) return null
  const month = new Date().toLocaleDateString('en-GB', { month: 'long' })
  const art = stats.albums.slice(0, 4).map((a) => a.item.art)
  return (
    <section className="monthcard">
      <div className="monthcard__mosaic" aria-hidden="true">
        {art.map((src, i) => (
          <Cover key={i} src={src} radius={0} />
        ))}
      </div>
      <div className="monthcard__text">
        <small>{month} so far</small>
        <b>{formatMinutes(Math.round(stats.ms / 60_000))}</b>
        <span className="muted">
          {stats.songs.length} songs, {stats.artists.length} artists
          {stats.artists[0] ? ` · mostly ${stats.artists[0].item.name}` : ''}
        </span>
        <div className="monthcard__actions">
          <button className="btn btn--accent" onClick={() => setRecapOpen(true)}>
            <SparkleIcon size={16} /> Play Recap
          </button>
          <button className="btn" onClick={() => navigate({ name: 'stats' })}>
            Your stats
          </button>
        </div>
      </div>
    </section>
  )
}

/* ---------- Saved albums ---------- */

export function SavedAlbums(): React.JSX.Element | null {
  const navigate = useApp((s) => s.navigate)
  // one page is plenty here (the Library loads them all)
  const albums = useQuery('home:albums', () =>
    sp.api<{ items: { added_at: string; album: SAlbumRef }[] }>('/me/albums', { query: { limit: 20 } }).then((r) => r.items)
  )
  const list = (albums.data ?? []).filter((x) => x?.album?.id)
  if (list.length < 2) return null
  return (
    <Shelf
      title="Your albums"
      action={
        <button className="shelf__more" onClick={() => navigate({ name: 'library', tab: 'albums' })}>
          Show all
        </button>
      }
    >
      {list.slice(0, 16).map(({ album: a }) => (
        <MediaCard
          key={a.id}
          image={sp.pickImage(a.images, 300)}
          title={a.name}
          subtitle={a.artists.map((x) => x.name).join(', ')}
          onOpen={() => navigate({ name: 'album', id: a.id })}
          onPrefetch={() => prefetchAlbum(a.id)}
          onPlay={() => void playContext(a.uri)}
        />
      ))}
    </Shelf>
  )
}

/* ---------- Made for you: Daily Mixes, Discover Weekly, Release Radar, On Repeat ---------- */

/** The mixes Pulse made in the background (lib/madeForYou). Until the first ones are ready the
 *  simple artist mixes stand in, so nothing on Home says it's still working on them. */
export function MadeForYou({ fallback }: { fallback: React.ReactNode }): React.JSX.Element {
  const mixes = useMadeForYou((s) => s.mixes)
  const navigate = useApp((s) => s.navigate)
  if (!mixes.length) return <>{fallback}</>
  return (
    <Shelf title="Made for you">
      {mixes.map((m) => (
        <MediaCard
          key={m.id}
          image={m.cover || sp.pickImage(m.tracks[0]?.album?.images, 300)}
          title={m.title}
          subtitle={m.title === m.label ? m.subtitle : `${m.label} · ${m.subtitle}`}
          onOpen={() => navigate({ name: 'made', id: m.id })}
          onPlay={() => void playUris(m.tracks.map((t) => t.uri))}
        />
      ))}
    </Shelf>
  )
}

/* ---------- Your year is here (December and January, like Spotify Wrapped) ---------- */

/** A big card on Home when the year's Replay comes out: from 1 December through January. */
export function YearBanner(): React.JSX.Element | null {
  const plays = useHistory((s) => s.plays)
  const setRecapOpen = useApp((s) => s.setRecapOpen)
  const y = replayYear()
  const key = `pulse.replayBanner.${y}`
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(key) === '1'
    } catch {
      return false
    }
  })
  const stats = useMemo(() => (y ? computeStats(plays, new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime()) : null), [plays, y])
  const lead = stats?.artists.find((a) => isRealId(a.item.id))?.item
  const image = useArtistImage(lead?.id, null)
  if (!y || hidden || !stats || stats.plays < 20) return null
  const hide = (): void => {
    setHidden(true)
    try {
      localStorage.setItem(key, '1')
    } catch {
      /* storage unavailable */
    }
  }
  return (
    <section
      className="yearbanner"
      role="button"
      tabIndex={0}
      onClick={() => setRecapOpen(true, yearPeriod(y))}
      onKeyDown={(e) => e.key === 'Enter' && setRecapOpen(true, yearPeriod(y))}
    >
      <span className="ryear__glow" aria-hidden="true" />
      {image && <img className="yearbanner__bg" src={image} alt="" decoding="async" draggable={false} />}
      <span className="yearbanner__shade" aria-hidden="true" />
      <div className="yearbanner__text">
        <small>Your year in music is here</small>
        <b>{y}</b>
        <p>
          {formatMinutes(Math.round(stats.ms / 60_000))} of music{lead ? `, most of it ${lead.name}` : ''}.
        </p>
      </div>
      <span className="yearbanner__cta">
        <SparkleIcon size={18} /> Play your {y} Recap
      </span>
      <button
        className="yearbanner__x icon-btn"
        aria-label="Hide"
        onClick={(e) => {
          e.stopPropagation()
          hide()
        }}
      >
        ×
      </button>
    </section>
  )
}
