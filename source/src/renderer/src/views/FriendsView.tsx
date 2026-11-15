// Friends: what the people you follow on Spotify are playing (Friend Activity, once your Spotify
// account is connected), who's listening on Pulse right now (with Listen along), people waiting
// for a follow back, your friends, and everyone else you follow. Two people who follow each
// other on Pulse are friends.
import { useEffect, useState } from 'react'
import { useApp } from '@/lib/store'
import { listenWith, markFollowersSeen, stopListeningWith, useFriends, useListenWith, watchFriendsClosely } from '@/lib/friends'
import { joinParty } from '@/lib/listenAlong'
import { prefetchUser, pulseServerOn } from '@/lib/people'
import type { NowPlaying, PulseSummary } from '@shared/types'
import { Cover, Skeleton } from '@/components/common'
import { PulseBadge } from '@/components/PulseBadge'
import { FollowCounts } from './FollowsView'
import { HeadphonesIcon, PlayIcon, SearchIcon, UserPlusIcon, UsersIcon } from '@/components/Icons'
import { playContext, playUris } from '@/lib/player'
import { connectSpotifyFriends, useSpotifyFriends, useSpotifyFriendsLive, whenPlayed } from '@/lib/spotifyFriends'
import type { SpotifyFriend } from '@shared/types'

/** One of your Spotify friends and the song they last played. */
function SpotifyFriendCard({ f, pulse }: { f: SpotifyFriend; pulse: boolean }): React.JSX.Element {
  const navigate = useApp((s) => s.navigate)
  const when = whenPlayed(f.at)
  const t = f.track
  const play = (): void => {
    const ctx = t.context?.uri
    if (ctx && /^spotify:(playlist|album):/.test(ctx)) void playContext(ctx, t.uri)
    else void playUris([t.uri])
  }
  return (
    <article className={`sfcard ${when.now ? 'is-now' : ''}`}>
      <span className="sfcard__bg" aria-hidden="true">
        {t.image && <img src={t.image} alt="" draggable={false} />}
      </span>
      <button className="sfcard__art" aria-label={`Play ${t.name}`} onClick={play}>
        <Cover src={t.image} radius={14} />
        <span className="sfcard__play">
          <PlayIcon size={20} />
        </span>
      </button>
      <div className="sfcard__body">
        <button className="sfcard__who" onClick={() => navigate({ name: 'user', id: f.id })} onMouseEnter={() => prefetchUser(f.id)}>
          <Cover src={f.image} round size={26} />
          <b>{f.name}</b>
          {pulse && <PulseBadge small />}
        </button>
        <button className="sfcard__song" onClick={() => t.album.id && navigate({ name: 'album', id: t.album.id })}>
          {t.name}
        </button>
        <button className="sfcard__artist" onClick={() => t.artist.id && navigate({ name: 'artist', id: t.artist.id })}>
          {t.artist.name}
        </button>
        <small className="sfcard__when">
          {when.now && <i className="sfcard__dot" aria-hidden="true" />}
          {when.text}
          {t.context?.name ? <span className="sfcard__ctx"> · {t.context.name}</span> : null}
        </small>
      </div>
    </article>
  )
}

/** What your Spotify friends are playing, or the button that connects your Spotify account. */
function SpotifyFriendsSection({ pulseIds }: { pulseIds: Set<string> }): React.JSX.Element | null {
  useSpotifyFriendsLive()
  const { connected, list, connecting, error } = useSpotifyFriends()
  if (connected === null) return null
  if (!connected)
    return (
      <section className="fx__connect">
        <span className="fx__connect-art" aria-hidden="true">
          <UsersIcon size={30} />
        </span>
        <div className="fx__connect-text">
          <h2>See what your Spotify friends are playing</h2>
          <p>
            Sign in to Spotify once, right here in Pulse. You’ll see the same Friend Activity the Spotify app shows, and get Spotify’s synced lyrics for
            more songs. Your sign-in stays on this computer.
          </p>
          {error && <p className="fx__error">{error}</p>}
        </div>
        <button className="btn btn--accent fx__connect-btn" disabled={connecting} onClick={() => void connectSpotifyFriends()}>
          {connecting ? 'Waiting for Spotify…' : 'Connect Spotify'}
        </button>
      </section>
    )
  const live = (list ?? []).filter((f) => whenPlayed(f.at).now).length
  return (
    <section className="shelf fx__spotify">
      <header className="shelf__head">
        <h2>On Spotify</h2>
        {list && <span className="shelf__count">{live ? `${live} listening now` : `${list.length}`}</span>}
      </header>
      {!list ? (
        <Skeleton rows={3} />
      ) : list.length ? (
        <div className="sfcards">
          {list.map((f) => (
            <SpotifyFriendCard key={f.id} f={f} pulse={pulseIds.has(f.id)} />
          ))}
        </div>
      ) : (
        <div className="fx__empty">
          <HeadphonesIcon size={28} />
          <p>Nobody you follow on Spotify has played anything lately, or they keep their listening private.</p>
        </div>
      )}
    </section>
  )
}

const who = (u: PulseSummary): { name: string; image: string | null } => ({ name: u.displayName, image: u.thumb })

/** A big card for someone playing music right now. */
function LiveCard({ user, now }: { user: PulseSummary; now: NowPlaying }): React.JSX.Element {
  const navigate = useApp((s) => s.navigate)
  const listening = useListenWith((s) => s.with?.id === user.id)
  const t = now.track!
  return (
    <article className={`flive ${listening ? 'is-on' : ''}`}>
      <button className="flive__art" onClick={() => navigate({ name: 'user', id: user.id })} onMouseEnter={() => prefetchUser(user.id)}>
        <Cover src={t.image} radius={18} />
        <span className="flive__face">
          <Cover src={user.thumb} round size={44} />
        </span>
      </button>
      <div className="flive__text">
        <b>{t.name}</b>
        <span className="muted">{t.artists}</span>
        <small>
          <i className="nowcard__live" aria-hidden="true" />
          {user.displayName}
        </small>
      </div>
      <div className="flive__actions">
        <button className={`btn ${listening ? 'btn--accent' : ''}`} onClick={() => (listening ? stopListeningWith() : listenWith(user.id, user.displayName))}>
          <HeadphonesIcon size={17} />
          {listening ? 'Stop' : 'Listen along'}
        </button>
        {now.party && (
          <button className="btn" onClick={() => joinParty(now.party!)}>
            Join party
          </button>
        )}
      </div>
    </article>
  )
}

/** A person tile: picture, name, and what they're doing. */
function PersonTile({ user, now, children }: { user: PulseSummary; now?: NowPlaying; children?: React.ReactNode }): React.JSX.Element {
  const navigate = useApp((s) => s.navigate)
  const line = now?.track ? `${now.paused ? 'Paused' : 'Playing'} ${now.track.name}` : null
  return (
    <div className="ptile">
      <button className="ptile__who" onClick={() => navigate({ name: 'user', id: user.id })} onMouseEnter={() => prefetchUser(user.id)}>
        <span className="ptile__pic">
          <Cover src={user.thumb} round />
          {now?.track && !now.paused && <i className="ptile__dot" aria-hidden="true" />}
        </span>
        <b>{user.displayName}</b>
        <small>{line ?? (user.pulse !== false ? <PulseBadge small /> : 'Spotify')}</small>
      </button>
      {children && <div className="ptile__actions">{children}</div>}
    </div>
  )
}

export function FriendsView(): React.JSX.Element {
  const { friends, incoming, outgoing, now, loaded, busy, act } = useFriends()
  const navigate = useApp((s) => s.navigate)
  const me = useApp((s) => s.me)
  const [server, setServer] = useState<boolean | null>(null)
  useEffect(() => {
    void pulseServerOn().then(setServer)
    return watchFriendsClosely()
  }, [])
  // what's on this page isn't news any more
  useEffect(() => {
    if (loaded) markFollowersSeen()
  }, [loaded, incoming])
  const following = [...friends, ...outgoing]
  const live = following.filter((u) => now[u.id]?.track && !now[u.id]?.paused)
  const spotify = useSpotifyFriends((s) => s.list)
  const spotifyLive = (spotify ?? []).filter((f) => whenPlayed(f.at).now)
  const pulseIds = new Set(following.map((u) => u.id))
  // faces of everyone listening right now, on Pulse or on Spotify
  const faces = [...live.map((u) => ({ id: u.id, image: u.thumb })), ...spotifyLive.map((f) => ({ id: f.id, image: f.image }))]
    .filter((x, i, l) => l.findIndex((y) => y.id === x.id) === i)
    .slice(0, 6)
  const listening = faces.length

  return (
    <div className="friends fx">
      <header className="fx__hero">
        <span className="fx__glow" aria-hidden="true" />
        <div className="fx__hero-text">
          <h1>Friends</h1>
          <p>
            {!loaded
              ? ' '
              : listening
                ? `${listening} ${listening === 1 ? 'person is' : 'people are'} listening right now`
                : friends.length
                  ? `${friends.length} ${friends.length === 1 ? 'friend' : 'friends'} on Pulse`
                  : 'Follow people and see what they play'}
          </p>
          <div className="fx__hero-row">
            <button className="btn btn--accent" onClick={() => navigate({ name: 'search' })}>
              <SearchIcon size={16} /> Find people
            </button>
            {me && loaded && server !== false && <FollowCounts id={me.id} followers={friends.length + incoming.length} following={following.length} />}
          </div>
        </div>
        {faces.length > 0 && (
          <div className="fx__faces" aria-hidden="true">
            {faces.map((f, i) => (
              <span key={f.id} className="fx__face" style={{ ['--i' as string]: i }}>
                <Cover src={f.image} round />
              </span>
            ))}
          </div>
        )}
      </header>

      <SpotifyFriendsSection pulseIds={pulseIds} />

      {server === false ? (
        <p className="muted">Following isn’t available in this build of Pulse.</p>
      ) : !loaded ? (
        <Skeleton rows={4} />
      ) : (
        <>
          {incoming.length > 0 && (
            <section className="friends__requests">
              <h2>
                Follows you <span className="shelf__count">{incoming.length}</span>
              </h2>
              <div className="ptiles">
                {incoming.map((u) => (
                  <PersonTile key={u.id} user={u} now={now[u.id]}>
                    <button className="btn btn--accent btn--sm" disabled={busy === u.id} onClick={() => void act('follow', u.id, who(u))}>
                      <UserPlusIcon size={16} />
                      Follow back
                    </button>
                    <button className="btn btn--sm" disabled={busy === u.id} onClick={() => void act('dismiss', u.id, who(u))}>
                      Remove
                    </button>
                  </PersonTile>
                ))}
              </div>
            </section>
          )}

          {live.length > 0 && (
            <section className="shelf">
              <header className="shelf__head">
                <h2>Listening now on Pulse</h2>
              </header>
              <div className="flives">
                {live.map((u) => (
                  <LiveCard key={u.id} user={u} now={now[u.id]!} />
                ))}
              </div>
            </section>
          )}

          <section className="shelf">
            <header className="shelf__head">
              <h2>Your friends on Pulse</h2>
            </header>
            {friends.length ? (
              <div className="ptiles">
                {friends.map((u) => (
                  <PersonTile key={u.id} user={u} now={now[u.id]} />
                ))}
              </div>
            ) : (
              <div className="fx__empty">
                <UsersIcon size={28} />
                <p>Follow someone from their profile. When they follow you back, you’re friends on Pulse and can listen along.</p>
              </div>
            )}
          </section>

          {outgoing.length > 0 && (
            <section className="shelf">
              <header className="shelf__head">
                <h2>Following</h2>
                <span className="shelf__count">{outgoing.length}</span>
              </header>
              <div className="ptiles">
                {outgoing.map((u) => (
                  <PersonTile key={u.id} user={u} now={now[u.id]}>
                    <button className="btn btn--sm" disabled={busy === u.id} onClick={() => void act('unfollow', u.id, who(u))}>
                      Unfollow
                    </button>
                  </PersonTile>
                ))}
              </div>
            </section>
          )}

        </>
      )}
    </div>
  )
}
