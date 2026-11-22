// Home: a greeting with a line to the AI DJ, the cover ring of what you played lately (it
// loops forever), friends listening right now, the mixes made for you (Daily Mixes, Discover
// Weekly…), your songs on repeat, new releases from the
// artists you play, then your artists and playlists.
import { Emo } from '@/components/Emoji'
import { useEffect, useMemo, useRef, useState } from 'react'
import { homePalette, setPagePalette } from '@/lib/colors'
import { useApp } from '@/lib/store'
import { motion } from 'motion/react'
import { useQuery } from '@/lib/useQuery'
import * as sp from '@/lib/spotify'
import { prefetchAlbum, prefetchArtist } from '@/lib/loaders'
import { playContext, playUris, usePlayer } from '@/lib/player'
import { greeting } from '@/lib/format'
import { FRESH } from '@/lib/djIntent'
import { Cover, EqBars, MediaCard, Shelf, Skeleton, usePagePalette } from '@/components/common'
import { CoverRing, type RingItem } from '@/components/CoverRing'
import { FollowingFeed } from './HomeFeed'
import { MadeForYou, YearBanner, MonthCard, MoodRow, NewReleases, QuickTiles, RecentlyPlayed, SavedAlbums, YourMixes } from './HomeExtras'
import { contextMenuFor } from '@/components/menus'
import type { SAlbumRef, SArtist, STrack } from '@/lib/types'

/** Albums and singles from your top artists released this year or last, newest first. */
async function freshReleases(artists: SArtist[]): Promise<SAlbumRef[]> {
  const pages = await Promise.all(
    artists.slice(0, 8).map((a) =>
      sp
        .search(`artist:"${a.name}" ${FRESH}`)
        .then((r) => (r.albums?.items ?? []).filter((al): al is SAlbumRef => !!al?.id && al.artists.some((x) => x.id === a.id)))
        .catch(() => [] as SAlbumRef[])
    )
  )
  const seen = new Set<string>()
  return pages
    .flat()
    .filter((al) => {
      const k = `${al.artists[0]?.id}:${al.name.toLowerCase()}`
      return !seen.has(k) && !!seen.add(k)
    })
    .sort((a, b) => (b.release_date ?? '').localeCompare(a.release_date ?? ''))
    .slice(0, 14)
}

const ago = (date?: string): string => {
  if (!date) return ''
  const days = Math.floor((Date.now() - Date.parse(date)) / 86400_000)
  if (!Number.isFinite(days)) return date.slice(0, 4)
  if (days < 1) return 'out today'
  if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`
  if (days < 45) return `${Math.round(days / 7)} weeks ago`
  return new Date(date).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

export function Home(): React.JSX.Element {
  const settings = useApp((s) => s.settings)
  // A palette limited to the home page is shown only here.
  useEffect(() => {
    const p = homePalette()
    if (!p) return
    const owner = Symbol('home')
    setPagePalette(p, owner)
    return () => setPagePalette(null, owner)
  }, [settings.bgPalette, settings.bgScope, settings.customColors])
  // The background takes the colours (and picture) of the cover in the middle of the ring,
  // a moment after it settles there.
  const [focusArt, setFocusArt] = useState<string | null>(null)
  const focusTimer = useRef(0)
  const onRingFocus = (it: RingItem): void => {
    window.clearTimeout(focusTimer.current)
    focusTimer.current = window.setTimeout(() => setFocusArt(it.image), 450)
  }
  useEffect(() => () => window.clearTimeout(focusTimer.current), [])
  usePagePalette(homePalette() ? null : focusArt)
  const me = useApp((s) => s.me)
  const playlists = useApp((s) => s.playlists)
  const navigate = useApp((s) => s.navigate)
  const openMenu = useApp((s) => s.openMenu)
  const recent = useQuery('home:recent', sp.getRecentlyPlayed)
  const top = useQuery('home:top', sp.getTopTracks)
  const artists = useQuery('home:artists', sp.getTopArtists)
  // more of your songs for the mixes (6 months, 50)
  const mixTracks = useQuery('stats:tracks50:medium_term', () => sp.getTopTracks('medium_term', 50))
  const fresh = useQuery(
    `stats:fresh:${(artists.data?.items ?? [])
      .map((a) => a.id)
      .slice(0, 8)
      .join()}`,
    () => (artists.data ? freshReleases(artists.data.items) : Promise.resolve([] as SAlbumRef[]))
  )
  const currentId = usePlayer((s) => s.track?.id)
  const paused = usePlayer((s) => s.paused)
  const topTracks = top.data?.items ?? []

  // The ring: new releases from the artists you play first, then albums from recent listening
  // and your top songs. It loops, so nothing is ever at the end.
  const ring = useMemo<RingItem[]>(() => {
    const seen = new Set<string>()
    const menu = (al: SAlbumRef) => (e: React.MouseEvent) => {
      e.preventDefault()
      openMenu(e.clientX, e.clientY, contextMenuFor('album', al.uri, al.name))
    }
    const open = (al: SAlbumRef) => () => {
      prefetchAlbum(al.id)
      navigate({ name: 'album', id: al.id })
    }
    const out: RingItem[] = []
    for (const al of fresh.data ?? []) {
      if (seen.has(al.id)) continue
      seen.add(al.id)
      out.push({
        key: al.id,
        image: sp.pickImage(al.images, 300),
        title: al.name,
        subtitle: `New from ${al.artists[0]?.name ?? ''}, ${ago(al.release_date)}`,
        onOpen: open(al),
        onPlay: () => void playContext(al.uri),
        onContextMenu: menu(al)
      })
    }
    for (const t of [...(recent.data?.items ?? []).map((r) => r.track), ...topTracks]) {
      const al = t?.album
      if (!al?.id || seen.has(al.id)) continue
      seen.add(al.id)
      out.push({
        key: al.id,
        image: sp.pickImage(al.images, 300),
        title: al.name,
        subtitle: al.artists.map((a) => a.name).join(', '),
        onOpen: open(al),
        onPlay: () => void playContext(al.uri, t.uri),
        onContextMenu: menu(al)
      })
    }
    return out.slice(0, 30)
  }, [fresh.data, recent.data, topTracks, navigate, openMenu])

  const name = me?.display_name?.split(' ')[0]

  return (
    <div className="home">
      <section className="home__hero">
        <h1 className="home__hello" aria-label={`${greeting()}${name ? `, ${name}` : ''}`}>
          {`${greeting()}${name ? `, ${name}` : ''}`.split(' ').map((w, i) => (
            <motion.span
              key={i}
              aria-hidden="true"
              className="home__word"
              initial={{ opacity: 0, y: '0.4em', filter: 'blur(10px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ delay: 0.08 * i, type: 'spring', stiffness: 260, damping: 26 }}
            >
              {w}{' '}
            </motion.span>
          ))}
        </h1>
      </section>

      {recent.loading && !recent.data ? <div className="ring ring--loading" /> : <CoverRing items={ring} onFocus={onRingFocus} />}

      <YearBanner />

      <QuickTiles recent={recent.data?.items ?? []} />

      <FollowingFeed />

      <MadeForYou
        fallback={
          <YourMixes
            artists={artists.data?.items ?? []}
            tracks={[...topTracks, ...(mixTracks.data?.items ?? [])].filter((t, i, l) => t?.id && l.findIndex((x) => x.id === t.id) === i)}
          />
        }
      />

      {topTracks.length > 0 && (
        <section className="shelf">
          <header className="shelf__head">
            <h2>On repeat</h2>
            <button className="shelf__more" onClick={() => void playUris(topTracks.map((x) => x.uri))}>
              Play all
            </button>
          </header>
          <div className="chips">
            {topTracks.slice(0, 12).map((t, i) => (
              <button
                key={t.id}
                className={`chip ${t.id === currentId ? 'is-active' : ''}`}
                onClick={() =>
                  void playUris(
                    topTracks.map((x) => x.uri),
                    t.uri
                  )
                }
                title={`${t.name} by ${t.artists.map((a) => a.name).join(', ')}`}
              >
                <Cover src={sp.pickImage(t.album?.images, 64)} size={52} radius={10} />
                <span className="chip__text">
                  <span className="chip__title">
                    <Emo>{t.name}</Emo>
                  </span>
                  <span className="chip__sub">{t.artists.map((a) => a.name).join(', ')}</span>
                </span>
                {t.id === currentId ? <EqBars playing={!paused} /> : <span className="chip__rank">{i + 1}</span>}
              </button>
            ))}
          </div>
        </section>
      )}

      <MoodRow />

      <RecentlyPlayed recent={recent.data?.items ?? []} />

      <NewReleases albums={fresh.data ?? []} />

      <MonthCard />

      {(artists.data?.items.length ?? 0) > 0 && (
        <Shelf title="Your artists">
          {artists.data!.items.map((a) => (
            <MediaCard
              key={a.id}
              round
              artistId={a.id}
              image={sp.pickImage(a.images, 300)}
              title={a.name}
              onOpen={() => navigate({ name: 'artist', id: a.id })}
              onPrefetch={() => prefetchArtist(a.id, a.name)}
              onPlay={() => void playContext(a.uri)}
            />
          ))}
        </Shelf>
      )}

      {!playlists.length && recent.loading && <Skeleton rows={3} />}

      <SavedAlbums />
    </div>
  )
}
