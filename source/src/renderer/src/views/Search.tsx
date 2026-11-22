import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/store'
import * as sp from '@/lib/spotify'
import { prefetchAlbum, prefetchArtist } from '@/lib/loaders'
import { playContext, playUris, usePlayer } from '@/lib/player'
import type { SearchResults, STrack } from '@/lib/types'
import { Cover, ErrorState, MediaCard, Shelf, Skeleton } from '@/components/common'
import { TrackList } from '@/components/TrackList'
import { contextMenuFor, trackMenu } from '@/components/menus'
import { PlayIcon } from '@/components/Icons'
import { formatTime } from '@/lib/format'
import { PulseBadge } from '@/components/PulseBadge'
import { prefetchUser, rememberPeople, searchKnownPeople, usePulseUsers } from '@/lib/people'

type Kind = 'all' | 'songs' | 'artists' | 'albums' | 'playlists' | 'people'

const RECENT_KEY = 'pulse.recentSearches'

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

function remember(q: string): void {
  try {
    const list = [q, ...loadRecent().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 10)
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch {
    /* storage unavailable */
  }
}

export function Search(): React.JSX.Element {
  const query = useApp((s) => s.searchQuery)
  const setQuery = useApp((s) => s.setSearchQuery)
  const navigate = useApp((s) => s.navigate)
  const openMenu = useApp((s) => s.openMenu)
  const [results, setResults] = useState<SearchResults | null>(null)
  const [extra, setExtra] = useState<STrack[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recent, setRecent] = useState(loadRecent)
  const [kind, setKind] = useState<Kind>('all')
  const currentId = usePlayer((s) => s.track?.id)
  const { people: found, searching } = usePeople(query)
  // people who made a playlist in the results with a matching name are users too
  const owners = useMemo<Person[]>(() => {
    const q = norm(query)
    if (q.length < 2) return []
    return (results?.playlists?.items ?? [])
      .filter((p): p is NonNullable<typeof p> => !!p?.owner?.id && p.owner.id !== 'spotify')
      .filter((p) => norm(p.owner.display_name ?? '').includes(q) || norm(p.owner.id).includes(q))
      .map((p) => ({ id: p.owner.id, name: p.owner.display_name ?? p.owner.id, image: null, pulse: false }))
  }, [results, query])
  const people = useMemo(() => {
    const byId = new Map<string, Person>()
    for (const p of [...found, ...owners]) {
      const o = byId.get(p.id)
      byId.set(p.id, o ? { ...o, image: o.image ?? p.image, pulse: o.pulse || p.pulse } : p)
    }
    // Pulse users first
    return [...byId.values()].sort((a, b) => Number(b.pulse) - Number(a.pulse))
  }, [found, owners])
  const pulseIds = usePulseUsers(people.map((p) => p.id))
  const pictures = usePictures(
    people
      .filter((p) => !p.image)
      .map((p) => p.id)
      .slice(0, 10)
  )

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults(null)
      setRecent(loadRecent())
      return
    }
    setLoading(true)
    setKind('all')
    let alive = true
    const t = window.setTimeout(() => {
      sp.search(q)
        .then((r) => {
          if (!alive) return
          setResults(r)
          setExtra([])
          setError(null)
          remember(q)
        })
        .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)))
        .finally(() => alive && setLoading(false))
    }, 250)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [query])

  if (!query.trim()) {
    return (
      <div className="search-empty">
        <h1 className="page-title">Search</h1>
        <p className="muted">Find songs, artists, albums, playlists and people. Press Ctrl+F from anywhere.</p>
        {recent.length > 0 && (
          <>
            <h2 className="search-empty__h">Recent searches</h2>
            <div className="pills">
              {recent.map((r) => (
                <button key={r} className="pill" onClick={() => setQuery(r)}>
                  {r}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    )
  }

  if (error && !results) return <ErrorState text={error} />
  if (loading && !results) return <Skeleton rows={10} />
  if (!results) return <Skeleton rows={10} />

  const tracks = [...(results.tracks?.items ?? []), ...extra]
  const artists = results.artists?.items ?? []
  const albums = results.albums?.items ?? []
  const playlists = (results.playlists?.items ?? []).filter((p): p is NonNullable<typeof p> => !!p)
  const topArtist = artists[0]
  const topIsArtist = topArtist && tracks[0] && topArtist.name.toLowerCase() === query.trim().toLowerCase()
  const nothing = !tracks.length && !artists.length && !albums.length && !playlists.length && !people.length

  if (nothing) return <ErrorState text={`Nothing found for “${query}”. Check the spelling or try fewer words.`} />

  const topArtistResult = (topIsArtist || (!tracks[0] && topArtist)) && topArtist ? topArtist : null
  const show = (k: Kind): boolean => kind === 'all' || kind === k
  const kinds: { id: Kind; label: string; n: number }[] = [
    { id: 'all', label: 'All', n: 1 },
    { id: 'songs', label: 'Songs', n: tracks.length },
    { id: 'artists', label: 'Artists', n: artists.length },
    { id: 'albums', label: 'Albums', n: albums.length },
    { id: 'playlists', label: 'Playlists', n: playlists.length },
    { id: 'people', label: 'People', n: people.length }
  ]
  const playTracks = (uri?: string): void =>
    void playUris(
      tracks.map((t) => t.uri),
      uri
    )

  return (
    <div className="search">
      <div className="search__kinds" role="tablist" aria-label="Show">
        {kinds
          .filter((k) => k.n > 0)
          .map((k) => (
            <button
              key={k.id}
              role="tab"
              aria-selected={kind === k.id}
              className={`search__kind ${kind === k.id ? 'is-on' : ''}`}
              onClick={() => setKind(k.id)}
            >
              {k.label}
            </button>
          ))}
      </div>

      {kind === 'all' && (
        <div className="search__top">
          {topArtistResult ? (
            <div className="topresult" onClick={() => navigate({ name: 'artist', id: topArtistResult.id })}>
              <TopBg src={sp.pickImage(topArtistResult.images, 300)} />
              <Cover src={sp.pickImage(topArtistResult.images, 300)} size={148} round />
              <div className="topresult__name">{topArtistResult.name}</div>
              <span className="topresult__kind">Artist</span>
              <button
                className="play-fab topresult__play"
                aria-label={`Play ${topArtistResult.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  void playContext(topArtistResult.uri)
                }}
              >
                <PlayIcon size={22} />
              </button>
            </div>
          ) : (
            tracks[0] && (
              <div className="topresult" onClick={() => playTracks(tracks[0].uri)}>
                <TopBg src={sp.pickImage(tracks[0].album?.images, 300)} />
                <Cover src={sp.pickImage(tracks[0].album?.images, 300)} size={148} radius={12} />
                <div className="topresult__name">{tracks[0].name}</div>
                <span className="topresult__kind">Song, {tracks[0].artists.map((a) => a.name).join(', ')}</span>
                <span className="play-fab topresult__play" aria-hidden="true">
                  <PlayIcon size={22} />
                </span>
              </div>
            )
          )}
          {tracks.length > 0 && (
            <section className="search__songs">
              <header className="search__songs-head">
                <h2>Songs</h2>
                {tracks.length > 5 && (
                  <button className="shelf__more" onClick={() => setKind('songs')}>
                    Show all
                  </button>
                )}
              </header>
              <ol className="songrows">
                {tracks.slice(0, 5).map((t) => (
                  <li
                    key={t.id}
                    className={`songrow ${t.id === currentId ? 'is-current' : ''}`}
                    onDoubleClick={() => playTracks(t.uri)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      openMenu(e.clientX, e.clientY, trackMenu(t, {}))
                    }}
                  >
                    <button className="songrow__art" aria-label={`Play ${t.name}`} onClick={() => playTracks(t.uri)}>
                      <Cover src={sp.pickImage(t.album?.images, 64)} size={46} radius={8} />
                      <span className="songrow__play" aria-hidden="true">
                        <PlayIcon size={16} />
                      </span>
                    </button>
                    <span className="songrow__text">
                      <b>{t.name}</b>
                      <span>{t.artists.map((a) => a.name).join(', ')}</span>
                    </span>
                    <span className="songrow__time">{formatTime(t.duration_ms)}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      )}

      {kind === 'songs' && (
        <section className="search__songs search__songs--all">
          <TrackList tracks={tracks} onPlay={(i) => playTracks(tracks[i].uri)} />
          {results.tracks && tracks.length < Math.min(results.tracks.total, 50) && (
            <button
              className="shelf__more"
              onClick={async () => {
                const r = await sp.searchTracks(query.trim(), tracks.length)
                setExtra((x) => [...x, ...(r.tracks?.items ?? [])])
              }}
            >
              Show more songs
            </button>
          )}
        </section>
      )}

      {show('artists') && artists.length > 0 && (
        <Section all={kind === 'all'} title="Artists">
          {artists.map((a) => (
            <MediaCard
              key={a.id}
              round
              artistId={a.id}
              image={sp.pickImage(a.images, 300)}
              title={a.name}
              subtitle="Artist"
              onOpen={() => navigate({ name: 'artist', id: a.id })}
              onPrefetch={() => prefetchArtist(a.id, a.name)}
              onPlay={() => void playContext(a.uri)}
            />
          ))}
        </Section>
      )}
      {show('albums') && albums.length > 0 && (
        <Section all={kind === 'all'} title="Albums">
          {albums.map((a) => (
            <MediaCard
              key={a.id}
              image={sp.pickImage(a.images, 300)}
              title={a.name}
              subtitle={a.artists.map((x) => x.name).join(', ')}
              onOpen={() => navigate({ name: 'album', id: a.id })}
              onPrefetch={() => prefetchAlbum(a.id)}
              onPlay={() => void playContext(a.uri)}
              onContextMenu={(e) => {
                e.preventDefault()
                openMenu(e.clientX, e.clientY, contextMenuFor('album', a.uri, a.name))
              }}
            />
          ))}
        </Section>
      )}
      {show('playlists') && playlists.length > 0 && (
        <Section all={kind === 'all'} title="Playlists">
          {playlists.map((p) => (
            <MediaCard
              key={p.id}
              image={sp.pickImage(p.images, 300)}
              title={p.name}
              subtitle={`By ${p.owner.display_name ?? 'Spotify'}`}
              onOpen={() => navigate({ name: 'playlist', id: p.id })}
              onPlay={() => void playContext(p.uri)}
            />
          ))}
        </Section>
      )}
      {show('people') && people.length === 0 && searching && (
        <Shelf title="People">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="card card--ghost" aria-hidden="true">
              <div className="card__ghost-art is-round" />
              <div className="card__ghost-line" />
            </div>
          ))}
        </Shelf>
      )}
      {show('people') && people.length > 0 && (
        <Section all={kind === 'all'} title="People">
          {people.map((p) => (
            <MediaCard
              key={p.id}
              round
              image={p.image ?? pictures.get(p.id) ?? pulseIds.get(p.id)?.thumb ?? null}
              title={p.name}
              subtitle={p.pulse || pulseIds.has(p.id) ? <PulseBadge small /> : 'Profile'}
              onOpen={() => navigate({ name: 'user', id: p.id })}
              onPrefetch={() => prefetchUser(p.id)}
            />
          ))}
        </Section>
      )}
    </div>
  )
}

/** The top result's soft, blurred wash of its own picture. */
function TopBg({ src }: { src: string | null | undefined }): React.JSX.Element | null {
  if (!src) return null
  return <span className="topresult__bg" aria-hidden="true" style={{ backgroundImage: `url("${src}")` }} />
}

/** A shelf on the overview, a full grid when one kind is picked. */
function Section({ all, title, children }: { all: boolean; title: string; children: React.ReactNode }): React.JSX.Element {
  if (all) return <Shelf title={title}>{children}</Shelf>
  return <div className="search__grid">{children}</div>
}

interface Person {
  id: string
  name: string
  image: string | null
  pulse: boolean
}

/** People matching the search: Pulse users first (they answer fast), then Spotify's own
 *  user search (it reads Spotify's search page, a few seconds). */
/** Profile pictures for people found without one (from their profile's link preview). */
function usePictures(ids: string[]): Map<string, string> {
  const [pics, setPics] = useState<Map<string, string>>(new Map())
  const key = ids.join(',')
  useEffect(() => {
    let alive = true
    for (const id of key ? key.split(',') : []) {
      if (pics.has(id)) continue
      void window.pulse.people
        .spotifyUserQuick(id)
        .then((u) => {
          if (!alive || !u?.image) return
          rememberPeople([{ id, name: u.name, image: u.image }])
          setPics((m) => new Map(m).set(id, u.image!))
        })
        .catch(() => {})
    }
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return pics
}

const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()

function usePeople(query: string): { people: Person[]; searching: boolean } {
  const [list, setList] = useState<Person[]>([])
  const [searching, setSearching] = useState(false)
  useEffect(() => {
    const q = query.trim()
    setList([])
    setSearching(false)
    if (q.length < 2) return
    // people you've already come across, at once (your playlists' owners, profiles you opened…)
    rememberPeople(useApp.getState().playlists.map((p) => ({ id: p.owner.id, name: p.owner.display_name })))
    setList(searchKnownPeople(q).map((p) => ({ ...p, pulse: false })))
    if (q.length < 3) return
    setSearching(true)
    let alive = true
    const merge = (more: Person[]): void => {
      rememberPeople(more)
      setList((old) => {
        const byId = new Map(old.map((p) => [p.id, p]))
        for (const p of more) {
          const o = byId.get(p.id)
          byId.set(p.id, o ? { ...o, image: o.image ?? p.image, pulse: o.pulse || p.pulse } : p)
        }
        return [...byId.values()]
      })
    }
    const t = window.setTimeout(() => {
      // owners of matching playlists (Spotify's API has no user search)
      void sp
        .searchPlaylistOwners(q)
        .then((r) => alive && merge(r.map((u) => ({ id: u.id, name: u.name, image: null, pulse: false }))))
        .catch(() => {})
      void window.pulse.people
        .pulseSearch(q)
        .then((r) => alive && merge(r.map((u) => ({ id: u.id, name: u.displayName, image: u.thumb, pulse: true }))))
        .catch(() => {})
      void window.pulse.people
        .searchSpotify(q)
        .then((r) => alive && merge(r.map((u) => ({ id: u.id, name: u.name, image: u.image, pulse: false }))))
        .catch(() => {})
        .finally(() => alive && setSearching(false))
    }, 600)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [query])
  return { people: list, searching }
}
