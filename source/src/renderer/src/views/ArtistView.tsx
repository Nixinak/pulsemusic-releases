// Artist page: the photo as a card next to the big name (Spotify's photos are often only 640 px,
// so it is never stretched across the page), top songs next to the latest release, every album, EP and single, and an About card with the bio, numbers
// and profile links. Spotify gives apps no links or bio, so those come from the main process
// (MusicBrainz, Genius, Deezer, Wikipedia) and fill in when they arrive.
import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, useTransform } from 'motion/react'
import { useApp } from '@/lib/store'
import { useQuery } from '@/lib/useQuery'
import * as sp from '@/lib/spotify'
import { playContext, playUris } from '@/lib/player'
import { plural, year } from '@/lib/format'
import type { SAlbumRef, STrack } from '@/lib/types'
import type { ArtistInfo, ArtistLink, PageAlbum, PageArtist, PageTrack } from '@shared/types'
import { ErrorState, MediaCard, Shelf, Skeleton, usePagePalette, usePageScroll } from '@/components/common'
import { keys, loadArtistPopular, loadArtistReleases, loadTopTracks, prefetchAlbum } from '@/lib/loaders'
import { TrackList } from '@/components/TrackList'
import { contextMenuFor } from '@/components/menus'
import { ArrowUpRightIcon, PinIcon, PlayIcon } from '@/components/Icons'
import { BrandIcon } from '@/components/BrandIcons'
import { HeartFollow } from '@/components/HeartFollow'
import { HeaderSkeleton, PlayActions } from './Collections'

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const longDate = (d?: string): string => {
  if (!d) return ''
  if (d.length <= 4) return d
  const date = new Date(`${d.length === 7 ? `${d}-01` : d}T12:00:00`)
  return date.toLocaleDateString('en', d.length === 7 ? { month: 'long', year: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
}

type Kind = 'album' | 'ep' | 'single' | 'compilation'
/** Spotify files EPs under "single"; by its own rule, 4 songs or more makes it an EP. */
function kindOf(a: SAlbumRef): Kind {
  if (a.album_type === 'compilation' || a.album_group === 'compilation') return 'compilation'
  if (a.album_type === 'album') return 'album'
  return (a.total_tracks ?? 1) >= 4 ? 'ep' : 'single'
}
const KIND_LABEL: Record<Kind, string> = { album: 'Album', ep: 'EP', single: 'Single', compilation: 'Compilation' }

/** Newest first, without the duplicate copies Spotify keeps (clean/explicit, regional). */
function tidy(list: SAlbumRef[]): SAlbumRef[] {
  const seen = new Set<string>()
  return [...list]
    .sort((a, b) => (b.release_date ?? '').localeCompare(a.release_date ?? ''))
    .filter((a) => {
      const key = `${kindOf(a)}:${a.name.toLowerCase().trim()}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

/* ---------- Pieces ---------- */

const BRAND: Record<string, string> = {
  instagram: '#e1306c',
  tiktok: '#25f4ee',
  youtube: '#ff3b30',
  x: '#d9d9d9',
  facebook: '#1877f2',
  soundcloud: '#ff5500',
  bandcamp: '#1da0c3',
  twitch: '#9146ff',
  apple: '#fa243c',
  deezer: '#a238ff',
  genius: '#ffff64',
  wikipedia: '#c8c8c8',
  website: 'var(--accent)'
}

/** "@riad" from a profile link, when the link has one. */
function handleOf(l: ArtistLink): string {
  try {
    const u = new URL(l.url)
    const part = u.pathname.split('/').filter(Boolean)
    if (l.kind === 'website') return u.hostname.replace(/^www\./, '')
    if (l.kind === 'wikipedia') return decodeURIComponent(part[part.length - 1] ?? '').replace(/_/g, ' ')
    if (['instagram', 'tiktok', 'x', 'soundcloud', 'twitch', 'facebook'].includes(l.kind) && part[0]) return '@' + part[0].replace(/^@/, '')
    if (l.kind === 'youtube' && part[0]?.startsWith('@')) return part[0]
    if (l.kind === 'bandcamp') return u.hostname.split('.')[0]
  } catch {
    /* not a URL */
  }
  return ''
}

const open = (url: string): void => window.pulse.openExternal(url)

/** Round logo buttons next to the play buttons: the main profiles only. */
function SocialLinks({ links }: { links: ArtistLink[] }): React.JSX.Element | null {
  const main = links.filter((l) => ['instagram', 'tiktok', 'youtube', 'x', 'soundcloud', 'facebook', 'twitch', 'website'].includes(l.kind)).slice(0, 5)
  if (!main.length) return null
  return (
    <motion.nav className="artist__links" aria-label="Artist profiles" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}>
      {main.map((l) => (
        <button
          key={l.url}
          className="artist__link"
          style={{ '--brand': BRAND[l.kind] } as React.CSSProperties}
          aria-label={l.label}
          title={`${l.label}${handleOf(l) ? ` · ${handleOf(l)}` : ''}`}
          onClick={() => open(l.url)}
        >
          <BrandIcon kind={l.kind} size={19} />
        </button>
      ))}
    </motion.nav>
  )
}

/** Every link as a card with the handle, in the About section. */
function SocialCards({ links }: { links: ArtistLink[] }): React.JSX.Element | null {
  if (!links.length) return null
  return (
    <div className="socials">
      {links.map((l) => {
        const h = handleOf(l)
        return (
          <button key={l.url} className="social" style={{ '--brand': BRAND[l.kind] } as React.CSSProperties} title={l.url} onClick={() => open(l.url)}>
            <span className="social__dot">
              <BrandIcon kind={l.kind} size={17} />
            </span>
            <span className="social__text">
              <b>{l.label}</b>
              {h && <small>{h}</small>}
            </span>
            <ArrowUpRightIcon size={16} className="social__go" />
          </button>
        )
      })}
    </div>
  )
}

function LatestRelease({ album }: { album: SAlbumRef }): React.JSX.Element {
  const navigate = useApp((s) => s.navigate)
  const kind = kindOf(album)
  return (
    <div
      className="latest"
      role="button"
      tabIndex={0}
      onClick={() => navigate({ name: 'album', id: album.id })}
      onMouseEnter={() => prefetchAlbum(album.id)}
      onKeyDown={(e) => e.key === 'Enter' && navigate({ name: 'album', id: album.id })}
    >
      <div className="latest__art">
        <img src={sp.pickImage(album.images, 640) ?? undefined} alt="" />
        <button
          className="latest__play"
          aria-label={`Play ${album.name}`}
          onClick={(e) => {
            e.stopPropagation()
            void playContext(album.uri)
          }}
        >
          <PlayIcon size={20} />
        </button>
      </div>
      <span className="latest__when">{longDate(album.release_date)}</span>
      <b className="latest__name">{album.name}</b>
      <span className="latest__meta">
        {KIND_LABEL[kind]}
        {album.total_tracks ? ` · ${plural(album.total_tracks, 'song')}` : ''}
      </span>
    </div>
  )
}

function ReleaseShelf({ title, list, showKind }: { title: string; list: SAlbumRef[]; showKind?: boolean }): React.JSX.Element | null {
  const navigate = useApp((s) => s.navigate)
  const openMenu = useApp((s) => s.openMenu)
  if (!list.length) return null
  return (
    <Shelf title={title} action={list.length > 6 ? <span className="shelf__count">{list.length}</span> : undefined}>
      {list.map((a) => (
        <MediaCard
          key={a.id}
          image={sp.pickImage(a.images, 300)}
          title={a.name}
          subtitle={showKind ? `${year(a.release_date)} · ${KIND_LABEL[kindOf(a)]}` : year(a.release_date)}
          onOpen={() => navigate({ name: 'album', id: a.id })}
          onPrefetch={() => prefetchAlbum(a.id)}
          onPlay={() => void playContext(a.uri)}
          onContextMenu={(e) => {
            e.preventDefault()
            openMenu(e.clientX, e.clientY, contextMenuFor('album', a.uri, a.name))
          }}
        />
      ))}
    </Shelf>
  )
}

function About({
  name,
  info,
  page,
  image,
  genres,
  releases
}: {
  name: string
  info: ArtistInfo | undefined
  page: PageArtist | null
  image: string | null
  genres: string[]
  releases: SAlbumRef[]
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [clamped, setClamped] = useState(false)
  const text = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    const el = text.current
    if (el) setClamped(el.scrollHeight > el.clientHeight + 4)
  }, [info?.bio?.text, page?.bio])

  const first = releases.length ? releases.reduce((a, b) => ((a.release_date ?? '9') < (b.release_date ?? '9') ? a : b)) : null
  const count = (k: Kind): number => releases.filter((r) => kindOf(r) === k).length

  // Big numbers over the photo.
  const stats: [string, string][] = []
  if (page?.monthlyListeners) stats.push([compact.format(page.monthlyListeners), 'monthly listeners'])
  if (page?.followers) stats.push([compact.format(page.followers), 'followers'])
  if (page?.worldRank) stats.push([`#${page.worldRank}`, 'in the world'])
  if (info?.fans) stats.push([compact.format(info.fans), 'fans on Deezer'])
  if (info?.followers && info.followers > 10) stats.push([compact.format(info.followers), 'followers on Genius'])
  if (releases.length) stats.push([String(releases.length), releases.length === 1 ? 'release' : 'releases'])
  const since = info?.since ?? (first?.release_date ? year(first.release_date) : null)
  if (since) stats.push([since, info?.since ? (info.kind === 'Group' ? 'formed' : 'active since') : 'first release'])

  const facts: [string, string][] = []
  if (info?.from) facts.push(['From', info.from])
  if (genres.length) facts.push(['Genres', genres.slice(0, 4).join(', ')])
  const parts = [
    count('album') && plural(count('album'), 'album'),
    count('ep') && `${count('ep')} ${count('ep') === 1 ? 'EP' : 'EPs'}`,
    count('single') && plural(count('single'), 'single')
  ].filter(Boolean)
  if (parts.length) facts.push(['Discography', parts.join(' · ')])
  if (info?.aka.length) facts.push(['Also known as', info.aka.join(', ')])
  if (page?.topCities.length)
    facts.push(['Most listened in', page.topCities.slice(0, 3).map((c) => `${c.city} (${compact.format(c.listeners)})`).join(', ')])

  if (!info && !page && !releases.length) return null
  return (
    <section className="shelf about">
      <header className="shelf__head">
        <h2>About</h2>
      </header>
      <div className="about__grid">
        <div className="about__photo">
          {image && <img src={image} alt="" />}
          <div className="about__shade" />
          <div className="about__stats">
            {stats.slice(0, 3).map(([v, k]) => (
              <div key={k}>
                <b>{v}</b>
                <span>{k}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="about__body">
          <h3>{name}</h3>
          {info?.from && (
            <p className="about__from">
              <PinIcon size={14} /> {info.from}
            </p>
          )}
          {/* Spotify's own bio first, as soon as the page has it */}
          {page?.bio && (page.bio.length > 20 || !info?.bio) ? (
            <>
              <p ref={text} className={`about__bio ${open ? 'is-open' : ''}`}>
                {page.bio}
              </p>
              <div className="about__more">
                {(clamped || open) && (
                  <button className="link" onClick={() => setOpen((v) => !v)}>
                    {open ? 'Show less' : 'Read more'}
                  </button>
                )}
                <span className="muted">From Spotify</span>
              </div>
            </>
          ) : info?.bio ? (
            <>
              <p ref={text} className={`about__bio ${open ? 'is-open' : ''}`}>
                {info.bio.text}
              </p>
              <div className="about__more">
                {(clamped || open) && (
                  <button className="link" onClick={() => setOpen((v) => !v)}>
                    {open ? 'Show less' : 'Read more'}
                  </button>
                )}
                <span className="muted">From {info.bio.source}</span>
              </div>
            </>
          ) : info ? (
            <p className="about__bio muted">No biography yet.</p>
          ) : (
            <Skeleton rows={3} />
          )}
          {facts.length > 0 && (
            <dl className="about__facts">
              {facts.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          )}
          {info && info.links.length > 0 && (
            <>
              <h4 className="about__sub">Find {name} on</h4>
              <SocialCards links={info.links} />
            </>
          )}
        </div>
      </div>
    </section>
  )
}

/* ---------- Data from the artist's public Spotify page ---------- */

const pageTrack = (t: PageTrack): STrack => ({
  id: t.id,
  uri: t.uri,
  name: t.name,
  duration_ms: t.durationMs,
  explicit: t.explicit,
  artists: t.artists.map((a) => ({ id: a.id, name: a.name, uri: `spotify:artist:${a.id}` })),
  album: t.album
    ? { id: t.album.id, uri: t.album.uri, name: t.album.name ?? '', images: t.album.image ? [{ url: t.album.image, width: 300, height: 300 }] : [], artists: [], type: 'album' }
    : undefined,
  type: 'track'
})

const pageAlbum = (a: PageAlbum): SAlbumRef => ({
  id: a.id,
  uri: a.uri,
  name: a.name,
  images: a.image ? [{ url: a.image, width: 300, height: 300 }] : [],
  artists: [],
  release_date: a.date,
  album_type: a.type === 'ep' ? 'single' : a.type,
  total_tracks: a.type === 'ep' ? Math.max(4, a.tracks) : a.type === 'single' ? Math.min(3, a.tracks || 1) : a.tracks,
  type: 'album'
})

const count = new Intl.NumberFormat('en')

async function retry<T>(fn: () => Promise<T>, times = 2): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn()
    } catch (e) {
      if (i >= times || (e instanceof Error && 'status' in e && (e as { status: number }).status === 429)) throw e
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)))
    }
  }
}

/* ---------- Page ---------- */

export function ArtistView({ id }: { id: string }): React.JSX.Element {
  const [allSongs, setAllSongs] = useState(false)
  const artistQ = useQuery(keys.artist(id), () => sp.getArtist(id))
  const artist = artistQ.data
  // The public page: header image, top tracks with play counts, stats, discography.
  // (null when the page gave nothing, so an empty answer isn't kept on disk)
  const pageQ = useQuery(keys.artistPage(id), async () => {
    const p = (await window.pulse.artistPage?.(id)) ?? null
    console.info(
      `[artist page] ${id}:`,
      p
        ? `${p.topTracks.length} songs (${p.topTracks.filter((t) => t.album?.image).length} with covers), ${p.albums.length + p.singles.length + p.compilations.length} releases, latest: ${p.latest?.name ?? 'none'}`
        : 'nothing from the page',
      p?.source ? `· via ${p.source}` : ''
    )
    return p && (p.header || p.topTracks.length) ? p : null
  })
  const page = pageQ.data
  const pageDone = pageQ.data !== undefined || !!pageQ.error
  // shown while the full page data loads (about a second, from the small embed page)
  const quickQ = useQuery(`artist-quick2:${id}`, async () => {
    const q = await window.pulse.artistQuick?.(id)
    return { tracks: q?.tracks ?? [], avatar: q?.avatar ?? null }
  })
  // The page usually brings the whole discography; the Web API (several requests, which count
  // against Spotify's limit) is only asked when it didn't.
  const pageHasReleases = !!page && page.albums.length + page.singles.length + page.compilations.length > 0
  // releases through search (the albums endpoint is often refused); the endpoint only as a last try
  // started right away (in parallel with the page): whichever answers first is shown
  const albumsQ = useQuery(artist ? keys.artistAlbums(id) : null, () => loadArtistReleases(id, artist!.name))
  // "Appears on" has no search equivalent and its endpoint is the one Spotify refuses most:
  // it's left out rather than risking a block
  const appearsQ = { data: undefined as SAlbumRef[] | undefined }
  // Search-based top songs only when the page has none.
  const needSearch = pageDone && !(page?.topTracks.length)
  // search songs, also started right away: covers for the page/quick list, or the list itself
  const popularQ = useQuery(artist ? keys.artistPopular(id) : null, () => loadArtistPopular(id, artist!.name))

  const best = useMemo(() => {
    const imgs = artist?.images ?? []
    return imgs.length ? imgs.reduce((a, b) => ((b.width ?? 0) > (a.width ?? 0) ? b : a)) : null
  }, [artist])
  // The Web API's list, or the page's discography when the API fails or comes back empty.
  const releases = useMemo(() => {
    if (pageHasReleases) return tidy([...page!.albums, ...page!.singles, ...page!.compilations].map(pageAlbum))
    return tidy(albumsQ.data ?? [])
  }, [albumsQ.data, page, pageHasReleases])
  // Spotify's own "Popular" list, in its order. The page's list already has covers and play
  // counts; full details from the Web API only when it came without covers (older answer).
  // covers through search (two requests) when the page list came without them
  // songs read from the page may come without artist names: they're this artist's songs
  const withArtist = (t: STrack): STrack =>
    t.artists.length || !artist ? t : { ...t, artists: [{ id: artist.id, name: artist.name, uri: artist.uri }] }
  const popularRaw = useMemo<STrack[]>(() => {
    const full = new Map((popularQ.data ?? []).map((t) => [t.id, t]))
    const fill = (t: STrack): STrack => {
      const f = full.get(t.id)
      return f && !t.album?.images?.length ? { ...t, album: f.album } : t
    }
    if (page?.topTracks.length) return page.topTracks.map(pageTrack).map(fill)
    if (!pageDone && quickQ.data?.tracks.length) return quickQ.data.tracks.map(pageTrack).map(fill)
    if (!pageDone && !quickQ.data) return []
    return popularQ.data ?? []
  }, [page, pageDone, quickQ.data, popularQ.data])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const popular = useMemo(() => {
    // still no cover: a release with the same name (usually the single) lends its own
    const byName = new Map(releases.map((a) => [a.name.toLowerCase().trim(), a]))
    return popularRaw.map(withArtist).map((t) => {
      if (t.album?.images?.length) return t
      const rel = byName.get(t.name.toLowerCase().replace(/\s*[([].*?[)\]]\s*/g, ' ').trim()) ?? byName.get(t.name.toLowerCase().trim())
      return rel ? { ...t, album: { ...rel } } : t
    })
  }, [popularRaw, artist, releases])
  const plays = useMemo(() => {
    const m = new Map((page?.topTracks ?? []).filter((t) => t.playcount > 0).map((t) => [t.id, t.playcount]))
    return m.size ? m : null
  }, [page])
  // Wait for a few song titles: they confirm that name matches on other sites are this artist.
  const infoReady = !!artist && (popular.length > 0 || !!popularQ.error || (pageDone && !needSearch)) && (pageHasReleases || !!albumsQ.data || !!albumsQ.error)
  const infoQ = useQuery(infoReady ? keys.artistInfo(id) : null, () =>
    window.pulse.artistInfo({
      id,
      name: artist!.name,
      titles: [...popular.map((t) => t.name), ...releases.slice(0, 30).map((a) => a.name)],
      spotifyImage: best ? { url: best.url, width: best.width ?? 640, height: best.height ?? 640 } : null
    })
  )
  const info = infoQ.data

  // some artists come without a picture from the Web API: the embed page, the full page or Deezer has one
  const photo = best?.url ?? quickQ.data?.avatar ?? page?.avatar ?? info?.images.find((i) => i.source === 'deezer')?.url ?? null
  usePagePalette(sp.pickImage(artist?.images, 640))
  const scrollY = usePageScroll()
  const textY = useTransform(scrollY, [0, 400], [0, 30])
  const textOpacity = useTransform(scrollY, [0, 320], [1, 0.4])

  if (artistQ.error) return <ErrorState text={artistQ.error} onRetry={artistQ.reload} />
  if (!artist) return <HeaderSkeleton />

  const shown = popular.slice(0, allSongs ? 20 : 5)
  // songs show as soon as the page list is there; covers from the details fill in afterwards
  const songsLoading = !popular.length && (!pageDone || (needSearch && !popularQ.data && !popularQ.error))
  // the page's own "Latest release" (it knows about releases the list may sort differently)
  const latest = page?.latest ? pageAlbum(page.latest) : releases[0]
  const byKind = (k: Kind): SAlbumRef[] => releases.filter((a) => kindOf(a) === k)
  const appears = tidy(appearsQ.data ?? [])
  const genres = artist.genres ?? []
  const meta = [
    page?.monthlyListeners ? `${count.format(page.monthlyListeners)} monthly listeners` : null,
    genres.length ? genres.slice(0, 2).join(', ') : null
  ].filter(Boolean)
  const deezer = info?.images.find((i) => i.source === 'deezer')?.url ?? null
  // The About photo: another picture than the banner when there is one.
  const aboutImage = page?.gallery[0] ?? info?.images.find((i) => i.source === 'genius')?.url ?? deezer ?? page?.avatar ?? photo

  return (
    <div className="collection artist">
      <header className="ahero">
        <div className="ahero__glow bleed" aria-hidden="true" />
        <motion.div
          className="ahero__photo"
          initial={{ opacity: 0, scale: 0.94, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 140, damping: 22 }}
        >
          {photo ? <img src={photo} alt="" /> : <span className="ahero__empty" />}
        </motion.div>
        <motion.div className="ahero__text" style={{ y: textY, opacity: textOpacity }}>
          <span className="phead__kind">{info?.from ? `Artist · ${info.from}` : 'Artist'}</span>
          <motion.h1
            className={`artist__name ${artist.name.length > 16 ? 'is-mid' : ''}`}
            initial={{ opacity: 0, y: 30, letterSpacing: '0.02em' }}
            animate={{ opacity: 1, y: 0, letterSpacing: '-0.05em' }}
            transition={{ type: 'spring', stiffness: 120, damping: 20 }}
          >
            {artist.name}
          </motion.h1>
          {meta.length > 0 && (
            <motion.p className="artist__meta" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              {meta.join('  ·  ')}
            </motion.p>
          )}
          <div className="ahero__actions">
            <PlayActions contextUri={artist.uri} uris={popular.map((t) => t.uri)} extra={<HeartFollow uri={artist.uri} name={artist.name} />} />
            {info && <SocialLinks links={info.links} />}
          </div>
        </motion.div>
      </header>

      <div className={`artist__top ${latest ? '' : 'is-solo'}`}>
        <section className="shelf artist__songs">
          <header className="shelf__head">
            <h2>Top songs</h2>
            {popular.length > 5 && (
              <button className="link" onClick={() => setAllSongs((v) => !v)}>
                {allSongs ? 'Show less' : 'Show more'}
              </button>
            )}
          </header>
          {needSearch && popularQ.error ? (
            <p className="muted">
              Couldn’t load the top songs.{' '}
              <button className="link" onClick={popularQ.reload}>
                Try again
              </button>
            </p>
          ) : !songsLoading ? (
            shown.length > 0 ? (
              <TrackList
                tracks={shown}
                plays={plays ?? undefined}
                showAlbum={!plays}
                onPlay={(i) => void playUris(popular.map((t) => t.uri), shown[i].uri)}
              />
            ) : (
              <p className="muted">No popular songs found.</p>
            )
          ) : (
            <Skeleton rows={5} />
          )}
        </section>
        {latest && (
          <section className="shelf artist__latest">
            <header className="shelf__head">
              <h2>Latest release</h2>
            </header>
            <LatestRelease album={latest} />
          </section>
        )}
      </div>

      {!releases.length && !albumsQ.error && !(pageDone && albumsQ.data) && <Skeleton rows={3} />}
      {!releases.length && albumsQ.error && pageDone && (
        <p className="muted">
          Couldn’t load the releases ({albumsQ.error}).{' '}
          <button className="link" onClick={albumsQ.reload}>
            Try again
          </button>
        </p>
      )}
      <ReleaseShelf title="Albums" list={byKind('album')} />
      <ReleaseShelf title="EPs" list={byKind('ep')} />
      <ReleaseShelf title="Singles" list={byKind('single')} />
      <ReleaseShelf title="Compilations" list={byKind('compilation')} />
      <ReleaseShelf title="Appears on" list={appears} showKind />

      <About name={artist.name} info={info} page={page ?? null} image={aboutImage} genres={genres} releases={releases} />
    </div>
  )
}
