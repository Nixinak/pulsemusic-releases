// Someone else's page: their Pulse profile when they use Pulse, and their public playlists
// from Spotify.
import { useEffect, useState } from 'react'
import { TasteMatch } from '@/components/TasteMatch'
import { useApp } from '@/lib/store'
import { prefetch, useQuery } from '@/lib/useQuery'
import * as sp from '@/lib/spotify'
import { playContext, playUris } from '@/lib/player'
import { prefetchArtist } from '@/lib/loaders'
import type { FavoriteItem, PulseItem, PulseProfile } from '@shared/types'
import { Cover, ErrorState, MediaCard, Shelf, usePagePalette, ShelfRow } from '@/components/common'
import { HeaderSkeleton } from '@/views/Collections'
import { Glass } from '@/components/Glass'
import { PulseBadge } from '@/components/PulseBadge'
import { ImageWall } from '@/components/ImageWall'
import { ProfileLinks } from '@/components/ProfileExtras'
import { FriendButton } from '@/components/FriendButton'
import { prefetchUser, pulseServerOn, rememberPeople, usePulseUsers } from '@/lib/people'
import { listenWith, nowPosition, stopListeningWith, useListenWith, useNowOf } from '@/lib/friends'
import { joinParty } from '@/lib/listenAlong'
import { usePlayer } from '@/lib/player'
import { formatTime } from '@/lib/format'
import { FollowCounts } from './FollowsView'
import { resolveColors } from '@/components/PalettePicker'
import { paletteFromColors } from '@/lib/colors'
import { HeadphonesIcon, MoreIcon, PlayIcon } from '@/components/Icons'

/** The big panel on someone's page: the song they play right now, its cover with a record
 *  sliding out of it (turning while it plays), and Listen along. When nothing plays, the song on
 *  their profile takes its place. */
function NowPanel({ id, name, song }: { id: string; name: string; song: FavoriteItem | null }): React.JSX.Element | null {
  const n = useNowOf(id)
  const listening = useListenWith((s) => s.with?.id === id)
  const myUri = usePlayer((s) => (s.paused ? null : s.track?.uri))
  const [, tick] = useState(0)
  useEffect(() => {
    if (!n?.track || n.paused) return
    const t = window.setInterval(() => tick((x) => x + 1), 1000)
    return () => window.clearInterval(t)
  }, [n])
  const live = n?.track ?? null
  if (!live && !song) return null
  const playing = live ? !n!.paused : myUri === song?.uri
  const image = live ? live.image : (song?.image ?? null)
  const pos = live && n ? nowPosition(n) : 0
  const pct = live && live.durationMs ? Math.min(100, (pos / live.durationMs) * 100) : 0
  return (
    <div className={`nowpanel ${playing ? 'is-playing' : ''} ${live ? 'is-live' : 'is-song'}`}>
      <div className="nowpanel__sleeve">
        <span className="nowpanel__disc" aria-hidden="true" style={image ? { backgroundImage: `url("${image}")` } : undefined} />
        <Cover src={image} radius={14} />
      </div>
      <div className="nowpanel__body">
        <span className="nowpanel__state">
          {live ? (
            <>
              <i className={n!.paused ? '' : 'is-on'} aria-hidden="true" />
              {n!.paused ? `${name} paused` : `${name} is listening`}
            </>
          ) : (
            'On their profile'
          )}
        </span>
        <b className="nowpanel__title">{live ? live.name : song!.name}</b>
        <span className="nowpanel__artist">{live ? live.artists : song!.subtitle}</span>
        {live && live.durationMs > 0 && (
          <div className="nowpanel__time">
            <span className="nowpanel__bar">
              <i style={{ width: `${pct}%` }} />
            </span>
            <small>
              {formatTime(pos)} / {formatTime(live.durationMs)}
            </small>
          </div>
        )}
        <div className="nowpanel__actions">
          {live ? (
            <button className={`btn ${listening ? '' : 'btn--accent'}`} onClick={() => (listening ? stopListeningWith() : listenWith(id, name))}>
              <HeadphonesIcon size={18} />
              {listening ? 'Stop listening' : 'Listen along'}
            </button>
          ) : (
            <button className="btn btn--accent" onClick={() => void playUris([song!.uri])}>
              <PlayIcon size={18} />
              Play
            </button>
          )}
          {live && n?.party && (
            <button className="btn" onClick={() => joinParty(n.party!)}>
              Join party
            </button>
          )}
          {live && song && song.uri !== live.uri && (
            <button className="nowpanel__song" onClick={() => void playUris([song.uri])} title={`Play ${song.name}`}>
              <Cover src={song.image} size={32} radius={8} />
              <span>
                <small>On their profile</small>
                {song.name}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const maxOf = (a: number | null | undefined, b: number | undefined): number | null => (a == null && b == null ? null : Math.max(a ?? 0, b ?? 0))

export function UserView({ id }: { id: string }): React.JSX.Element {
  const me = useApp((s) => s.me)
  const navigate = useApp((s) => s.navigate)
  const openMenu = useApp((s) => s.openMenu)
  const toast = useApp((s) => s.toast)
  const [serverOn, setServerOn] = useState(false)
  useEffect(() => void pulseServerOn().then(setServerOn), [])
  const pulseQ = useQuery(`pulse-user:${id}`, () => window.pulse.people.pulseProfile(id))
  // keep their profile fresh while it's open (a new banner, bio or blocks show up within a minute)
  useEffect(() => {
    const t = window.setInterval(() => !document.hidden && pulseQ.reload(), 60_000)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  // the follower lists from their Spotify page take a few seconds: start reading them now,
  // so they're ready when the counts are clicked
  useEffect(() => {
    const t = window.setTimeout(() => {
      prefetch(`sp-follows:followers:${id}`, () => window.pulse.people.spotifyFollows(id, 'followers'))
      prefetch(`sp-follows:following:${id}`, () => window.pulse.people.spotifyFollows(id, 'following'))
    }, 1500)
    return () => window.clearTimeout(t)
  }, [id])
  const spotifyQ = useQuery(`spotify-user:${id}`, () => window.pulse.people.spotifyUser(id))
  const pulse = pulseQ.data ?? null
  const followsQ = useQuery(serverOn ? `follows-of:${id}` : null, () => window.pulse.people.followsOf(id))
  // the name and picture come in well under a second; the playlists take a few seconds
  const quickQ = useQuery(spotifyQ.data ? null : `spotify-user-quick:${id}`, () => window.pulse.people.spotifyUserQuick(id))
  const page = spotifyQ.data ?? null
  const head = page ?? quickQ.data ?? null
  // a profile read before comes back at once with its playlists, while the page is read again
  const known = page ?? (quickQ.data && !quickQ.data.partial && quickQ.data.playlists.length ? quickQ.data : null)
  // remembered, so they can be found by name in Search later
  useEffect(() => {
    if (head) rememberPeople([{ id, name: head.name, image: head.image }, ...(page?.people ?? [])])
  }, [head, page, id])
  // Pulse badges for the people on their page
  const pulseIds = usePulseUsers((spotifyQ.data?.people ?? quickQ.data?.people ?? []).map((u) => u.id))

  const chosen = pulse?.customColors ? resolveColors(pulse.palette, pulse.customColors) : null
  usePagePalette(pulse?.banner ?? pulse?.avatar ?? head?.image ?? null, chosen ? paletteFromColors(chosen) : null)

  // your own page is the editable one
  const mine = !!me && me.id === id
  useEffect(() => {
    if (mine) navigate({ name: 'profile' })
  }, [mine, navigate])
  if (mine) return <HeaderSkeleton />
  // Spotify's page takes a few seconds; show the Pulse profile as soon as it's there
  const pulsePending = pulseQ.data === undefined && !pulseQ.error
  const spotifyPending = spotifyQ.data === undefined && !spotifyQ.error
  if (!pulse && !head && (pulsePending || spotifyPending)) return <HeaderSkeleton />
  if (!pulse && !head && !spotifyPending)
    return (
      <ErrorState
        text="Couldn’t load this profile. Spotify may have changed its pages."
        onRetry={() => {
          pulseQ.reload()
          spotifyQ.reload()
        }}
      />
    )

  const name = pulse?.displayName || head?.name || id
  const avatar = pulse?.avatar ?? head?.image ?? null
  const playlists = known?.playlists ?? []

  return (
    <div className="profile profile--view profile--sleeve">
      <header className="profile__hero">
        <div className="profile__banner bleed">
          {pulse?.banner ? (
            <img decoding="async" src={pulse.banner} alt="" />
          ) : avatar ? (
            // no cover picture: their profile picture, large and soft, so the face sits on its own colours
            <img decoding="async" className="profile__banner-soft" src={avatar} alt="" />
          ) : (
            <div className="profile__banner-fallback" />
          )}
        </div>
        <div className="uprof">
          {/* who they are: the picture like a record cover, the name, the numbers, the buttons */}
          <aside className="uprof__id">
            <div className="uprof__portrait">
              <Cover src={avatar} radius={36} />
            </div>
            <h1 className="uprof__name">{name}</h1>
            {pulse?.tagline && <p className="uprof__tagline">{pulse.tagline}</p>}
            <div className="uprof__meta">
              {pulse && <PulseBadge />}
              {known && !known.partial && (
                <span className="pstat">
                  <b>{playlists.length}</b> {playlists.length === 1 ? 'playlist' : 'playlists'}
                </span>
              )}
              <FollowCounts
                id={id}
                followers={maxOf(page?.followers, followsQ.data?.followers.length)}
                following={maxOf(page?.following, followsQ.data?.following.length)}
              />
            </div>
            <div className="uprof__actions">
              {me && serverOn && <FriendButton id={id} name={name} image={avatar} />}
              <button
                className="icon-btn uprof__more"
                aria-label="More"
                title="More"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect()
                  openMenu(r.left, r.bottom + 6, [
                    {
                      label: 'Copy username',
                      onSelect: () => {
                        void navigator.clipboard.writeText(id).then(
                          () => toast('Username copied'),
                          () => toast('Couldn’t copy the username', 'error')
                        )
                      }
                    },
                    {
                      label: 'Copy profile link',
                      onSelect: () => void navigator.clipboard.writeText(`https://open.spotify.com/user/${id}`).then(() => toast('Link copied'))
                    },
                    {
                      label: 'Open in Spotify',
                      onSelect: () => window.pulse.openExternal(`https://open.spotify.com/user/${id}`)
                    }
                  ])
                }}
              >
                <MoreIcon size={20} />
              </button>
            </div>
            {pulse?.bio && <p className="uprof__bio">{pulse.bio}</p>}
            {pulse?.links?.length ? <ProfileLinks links={pulse.links} /> : null}
          </aside>

          {/* what they play: now, the song on their profile, and how your tastes meet */}
          <section className="uprof__side">
            {pulse && <NowPanel id={id} name={name} song={pulse.anthem ?? null} />}
            {pulse && <TasteMatch profile={pulse} name={name} />}
            {pulse && pulse.blocks.length > 0 && (
              <div className="profile__blocks">
                {pulse.blocks.map((b) => (
                  <section key={b.id} className={`pblock pblock--${b.type}`}>
                    <ReadBlock block={b} profile={pulse} />
                  </section>
                ))}
              </div>
            )}
            {!pulse && <p className="uprof__plain">Not on Pulse yet. Their public playlists and the people they follow are below.</p>}
          </section>
        </div>
      </header>

      {playlists.length > 0 && (
        <Shelf title="Public playlists">
          {playlists.map((p) => (
            <MediaCard
              key={p.id}
              image={p.image}
              title={p.name}
              subtitle={p.followers ? `${p.followers} saves` : 'Playlist'}
              onOpen={() => navigate({ name: 'playlist', id: p.id })}
              onPlay={() => void playContext(`spotify:playlist:${p.id}`)}
            />
          ))}
        </Shelf>
      )}
      {(known?.people?.length ?? 0) > 0 && (
        <Shelf title="Followers and following">
          {known!.people!.map((u) => (
            <MediaCard
              key={u.id}
              round
              image={u.image}
              title={u.name}
              subtitle={pulseIds.has(u.id) ? <PulseBadge small /> : 'Profile'}
              onOpen={() => navigate({ name: 'user', id: u.id })}
              onPrefetch={() => prefetchUser(u.id)}
            />
          ))}
        </Shelf>
      )}
      {spotifyPending && !playlists.length && (
        <section className="shelf uskel" aria-label="Loading public playlists">
          <header className="shelf__head">
            <h2>Public playlists</h2>
          </header>
          <div className="uskel__row">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="uskel__card">
                <span className="skeleton__block uskel__art" />
                <span className="skeleton__line" />
                <span className="skeleton__line uskel__short" />
              </div>
            ))}
          </div>
        </section>
      )}
      {(spotifyQ.error || page?.partial) && <p className="muted">Couldn’t read the public playlists from Spotify.</p>}
    </div>
  )
}

function ItemRow({ item, onOpen }: { item: PulseItem; onOpen: () => void }): React.JSX.Element {
  return (
    <div className="qrow" role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      <Cover src={item.image} size={44} radius={8} />
      <span className="qrow__text">
        <span className="qrow__title">{item.name}</span>
        <span className="qrow__artist">{item.subtitle}</span>
      </span>
    </div>
  )
}

/** A block of someone else's profile (read-only; live blocks show what the owner published). */
function ReadBlock({ block, profile }: { block: PulseProfile['blocks'][number]; profile: PulseProfile }): React.JSX.Element | null {
  const navigate = useApp((s) => s.navigate)
  switch (block.type) {
    case 'text':
      return (
        <Glass radius={22} tone="clear" bezel={14} refraction={30} className="pblock__card">
          {block.title && <h2 className="pblock__title">{block.title}</h2>}
          <p className="pblock__text">{block.text}</p>
        </Glass>
      )
    case 'image':
      return (
        <figure className="pblock__figure">
          <img decoding="async" src={block.src} alt={block.caption} />
          {block.caption && <figcaption>{block.caption}</figcaption>}
        </figure>
      )
    case 'wall':
      return (
        <section className="pblock__wall">
          {block.title && <h2 className="pblock__heading">{block.title}</h2>}
          <ImageWall images={block.images} />
        </section>
      )
    case 'top-artists':
      if (!profile.snapshot.topArtists.length) return null
      return (
        <>
          <h2 className="pblock__heading">Top artists</h2>
          <ShelfRow>
            {profile.snapshot.topArtists.map((a) => (
              <MediaCard
                key={a.id}
                round
                artistId={a.id}
                image={a.image}
                title={a.name}
                onOpen={() => navigate({ name: 'artist', id: a.id })}
                onPrefetch={() => prefetchArtist(a.id, a.name)}
                onPlay={() => void playContext(a.uri)}
              />
            ))}
          </ShelfRow>
        </>
      )
    case 'top-tracks': {
      const list = profile.snapshot.topTracks.slice(0, 5)
      if (!list.length) return null
      return (
        <>
          <h2 className="pblock__heading">Top songs this month</h2>
          {list.map((t) => (
            <ItemRow
              key={t.id}
              item={t}
              onOpen={() =>
                void playUris(
                  list.map((x) => x.uri),
                  t.uri
                )
              }
            />
          ))}
        </>
      )
    }
    case 'playlist':
      return <PlaylistCard id={block.playlistId} />
    case 'favorites':
      if (!block.items.length) return null
      return (
        <>
          <h2 className="pblock__heading">{block.title}</h2>
          <div className="fav__grid">
            {block.items.map((it) => (
              <button
                key={it.id}
                className="fav"
                title={it.name}
                onClick={() =>
                  block.kind === 'artist'
                    ? navigate({ name: 'artist', id: it.id })
                    : block.kind === 'album'
                      ? navigate({ name: 'album', id: it.id })
                      : void playUris([it.uri])
                }
              >
                <Cover src={it.image} round={block.kind === 'artist'} radius={14} />
                <span className="fav__name">{it.name}</span>
                {it.subtitle && <span className="fav__sub">{it.subtitle}</span>}
              </button>
            ))}
          </div>
        </>
      )
    default:
      return null
  }
}

function PlaylistCard({ id }: { id: string }): React.JSX.Element | null {
  const navigate = useApp((s) => s.navigate)
  const q = useQuery(`playlist-head:${id}`, () => sp.getPlaylist(id))
  const p = q.data
  if (!p) return null
  return (
    <Glass radius={22} tone="clear" bezel={14} refraction={30} className="pblock__card pblock__playlist" onClick={() => navigate({ name: 'playlist', id })}>
      <Cover src={sp.pickImage(p.images, 300)} size={120} radius={14} />
      <div className="pblock__pl-text">
        <span className="phead__kind">Playlist</span>
        <span className="pblock__pl-name">{p.name}</span>
        <span className="muted">{sp.playlistSongs(p)}</span>
      </div>
      <button
        className="play-fab"
        aria-label={`Play ${p.name}`}
        onClick={(e) => {
          e.stopPropagation()
          void playContext(p.uri)
        }}
      >
        <PlayIcon size={22} />
      </button>
    </Glass>
  )
}
