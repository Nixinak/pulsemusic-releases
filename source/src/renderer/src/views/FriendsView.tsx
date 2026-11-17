// Friends: one feed of what the people you follow are playing, on Pulse and on Spotify (Friend
// Activity, once your Spotify account is connected), with no line between the two: people who
// use Pulse just wear its badge (and can be listened along with). Below it: people waiting for a
// follow back, and everyone you follow on Pulse. Two people who follow each other are friends.
import { useEffect, useMemo, useState } from 'react'
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
import { motion } from 'motion/react'

/** One person in the feed: whoever they are, wherever they listen. */
interface Activity {
  id: string
  name: string
  image: string | null
  /** Uses Pulse (shows the badge; Listen along works). */
  pulse: boolean
  user: PulseSummary | null
  at: number
  now: boolean
  paused: boolean
  party: string | null
  track: {
    uri: string
    name: string
    artist: string
    artistId: string | null
    albumId: string | null
    image: string | null
    context: { uri: string; name: string } | null
  }
}

function playActivity(a: Activity): void {
  const ctx = a.track.context?.uri
  if (ctx && /^spotify:(playlist|album):/.test(ctx)) void playContext(ctx, a.track.uri)
  else void playUris([a.track.uri])
}

/** A big card for someone listening right now. */
function NowCardBig({ a, i }: { a: Activity; i: number }): React.JSX.Element {
  const navigate = useApp((s) => s.navigate)
  const listening = useListenWith((s) => s.with?.id === a.id)
  return (
    <motion.article
      className={`fz-live ${listening ? 'is-on' : ''}`}
      initial={{ opacity: 0, y: 18, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        delay: i * 0.05,
        type: 'spring',
        stiffness: 260,
        damping: 26
      }}
    >
      <span className="fz-live__bg" aria-hidden="true">
        {a.track.image && <img src={a.track.image} alt="" draggable={false} />}
      </span>
      <button className="fz-live__art" aria-label={`Play ${a.track.name}`} onClick={() => playActivity(a)}>
        <Cover src={a.track.image} radius={16} />
        <span className="fz-live__play">
          <PlayIcon size={22} />
        </span>
        <span className="fz-eq" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </button>
      <div className="fz-live__text">
        <button className="fz-who" onClick={() => navigate({ name: 'user', id: a.id })} onMouseEnter={() => prefetchUser(a.id)}>
          <span className="fz-who__pic">
            <Cover src={a.image} round size={30} />
          </span>
          <b>{a.name}</b>
          {a.pulse && <PulseBadge small />}
        </button>
        <button className="fz-live__song" onClick={() => a.track.albumId && navigate({ name: 'album', id: a.track.albumId })}>
          {a.track.name}
        </button>
        <button className="fz-live__artist" onClick={() => a.track.artistId && navigate({ name: 'artist', id: a.track.artistId })}>
          {a.track.artist}
        </button>
        {a.track.context?.name && <small className="fz-live__ctx">from {a.track.context.name}</small>}
      </div>
      <div className="fz-live__actions">
        {a.pulse && (
          <button className={`btn btn--sm ${listening ? 'btn--accent' : ''}`} onClick={() => (listening ? stopListeningWith() : listenWith(a.id, a.name))}>
            <HeadphonesIcon size={16} />
            {listening ? 'Stop' : 'Listen along'}
          </button>
        )}
        {a.party && (
          <button className="btn btn--sm" onClick={() => joinParty(a.party!)}>
            Join party
          </button>
        )}
      </div>
    </motion.article>
  )
}

/** A row for someone who played something a while ago. */
function ActivityRow({ a, i }: { a: Activity; i: number }): React.JSX.Element {
  const navigate = useApp((s) => s.navigate)
  const when = a.now ? 'Now' : whenPlayed(a.at).text
  return (
    <motion.li
      className="fz-row"
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{
        delay: Math.min(i, 12) * 0.03,
        type: 'spring',
        stiffness: 300,
        damping: 30
      }}
      onDoubleClick={() => playActivity(a)}
    >
      <button className="fz-row__pic" onClick={() => navigate({ name: 'user', id: a.id })} onMouseEnter={() => prefetchUser(a.id)} aria-label={a.name}>
        <Cover src={a.image} round size={46} />
        <span className="fz-row__cover">
          <Cover src={a.track.image} radius={6} size={22} />
        </span>
      </button>
      <div className="fz-row__text">
        <span className="fz-row__name">
          <button onClick={() => navigate({ name: 'user', id: a.id })}>{a.name}</button>
          {a.pulse && <PulseBadge small />}
        </span>
        <span className="fz-row__song">
          <button onClick={() => a.track.albumId && navigate({ name: 'album', id: a.track.albumId })}>{a.track.name}</button>
          <span className="fz-row__sep">·</span>
          <button className="muted" onClick={() => a.track.artistId && navigate({ name: 'artist', id: a.track.artistId })}>
            {a.track.artist}
          </button>
        </span>
        {a.track.context?.name && <small className="fz-row__ctx">{a.track.context.name}</small>}
      </div>
      <span className="fz-row__when">{when}</span>
      <button className="fz-row__play" aria-label={`Play ${a.track.name}`} onClick={() => playActivity(a)}>
        <PlayIcon size={16} />
      </button>
    </motion.li>
  )
}

/** Asks to connect the Spotify account, so Spotify friends join the feed. */
function ConnectSpotify(): React.JSX.Element {
  const { connecting, error } = useSpotifyFriends()
  return (
    <section className="fz-connect">
      <span className="fz-connect__art" aria-hidden="true">
        <UsersIcon size={26} />
      </span>
      <div>
        <b>Add your Spotify friends</b>
        <p>
          Sign in to Spotify once, right here. Everyone you follow on Spotify joins this feed, next to your Pulse friends. Your sign-in stays on this computer.
        </p>
        {error && <p className="fx__error">{error}</p>}
      </div>
      <button className="btn btn--accent" disabled={connecting} onClick={() => void connectSpotifyFriends()}>
        {connecting ? 'Waiting for Spotify…' : 'Connect Spotify'}
      </button>
    </section>
  )
}

const who = (u: PulseSummary): { name: string; image: string | null } => ({
  name: u.displayName,
  image: u.thumb
})

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
  useSpotifyFriendsLive()
  const { connected, list: spotify } = useSpotifyFriends()
  useEffect(() => {
    void pulseServerOn().then(setServer)
    return watchFriendsClosely()
  }, [])
  // what's on this page isn't news any more
  useEffect(() => {
    if (loaded) markFollowersSeen()
  }, [loaded, incoming])
  const following = useMemo(() => [...friends, ...outgoing], [friends, outgoing])

  // one feed: Spotify's Friend Activity and Pulse's live plays, one entry per person
  const feed = useMemo(() => {
    const pulseUsers = new Map(following.map((u) => [u.id, u]))
    const byId = new Map<string, Activity>()
    for (const f of spotify ?? []) {
      const u = pulseUsers.get(f.id) ?? null
      byId.set(f.id, {
        id: f.id,
        name: u?.displayName || f.name,
        image: f.image ?? u?.thumb ?? null,
        pulse: !!u && u.pulse !== false,
        user: u,
        at: f.at,
        now: whenPlayed(f.at).now,
        paused: false,
        party: null,
        track: {
          uri: f.track.uri,
          name: f.track.name,
          artist: f.track.artist.name,
          artistId: f.track.artist.id || null,
          albumId: f.track.album.id || null,
          image: f.track.image,
          context: f.track.context
        }
      })
    }
    for (const u of following) {
      const n = now[u.id]
      if (!n?.track) continue
      const was = byId.get(u.id)
      const live = !n.paused
      // Pulse knows it live; it wins over an older Spotify entry
      if (was && was.at > n.at && !live) {
        was.pulse = true
        continue
      }
      byId.set(u.id, {
        id: u.id,
        name: u.displayName,
        image: u.thumb ?? was?.image ?? null,
        pulse: true,
        user: u,
        at: n.at || Date.now(),
        now: live,
        paused: n.paused,
        party: n.party,
        track: {
          uri: n.track.uri,
          name: n.track.name,
          artist: n.track.artists,
          artistId: null,
          albumId: null,
          image: n.track.image,
          context: null
        }
      })
    }
    return [...byId.values()].sort((a, b) => Number(b.now) - Number(a.now) || b.at - a.at)
  }, [spotify, following, now])
  const live = feed.filter((a) => a.now)
  const recent = feed.filter((a) => !a.now)
  const people = following.filter((u) => u.pulse !== false)

  return (
    <div className="friends fz">
      <header className="fz-hero">
        <span className="fz-hero__glow" aria-hidden="true" />
        <div className="fz-hero__text">
          <h1>Friends</h1>
          <p>
            {live.length
              ? `${live.length} ${live.length === 1 ? 'person is' : 'people are'} listening right now`
              : feed.length
                ? `${feed.length} ${feed.length === 1 ? 'person' : 'people'} played something lately`
                : 'See what the people you follow are playing'}
          </p>
          <div className="fz-hero__row">
            <button className="btn btn--accent" onClick={() => navigate({ name: 'search' })}>
              <SearchIcon size={16} /> Find people
            </button>
            {me && loaded && server !== false && <FollowCounts id={me.id} followers={friends.length + incoming.length} following={following.length} />}
          </div>
        </div>
        {feed.length > 0 && (
          <div className="fz-hero__faces" aria-hidden="true">
            {feed.slice(0, 7).map((a, i) => (
              <span key={a.id} className={`fz-hero__face ${a.now ? 'is-now' : ''}`} style={{ ['--i' as string]: i }}>
                <Cover src={a.image} round />
              </span>
            ))}
          </div>
        )}
      </header>

      {connected === false && <ConnectSpotify />}

      {live.length > 0 && (
        <section className="fz-section">
          <h2 className="fz-h">
            <i className="fz-h__dot" aria-hidden="true" />
            Listening now
          </h2>
          <div className="fz-lives">
            {live.map((a, i) => (
              <NowCardBig key={a.id} a={a} i={i} />
            ))}
          </div>
        </section>
      )}

      {(recent.length > 0 || !live.length) && (
        <section className="fz-section">
          <h2 className="fz-h">{live.length ? 'Earlier' : 'Recently played'}</h2>
          {spotify === null && connected ? (
            <Skeleton rows={4} />
          ) : recent.length ? (
            <ul className="fz-rows">
              {recent.map((a, i) => (
                <ActivityRow key={a.id} a={a} i={i} />
              ))}
            </ul>
          ) : !live.length ? (
            <div className="fz-empty">
              <HeadphonesIcon size={26} />
              <p>Nobody you follow has played anything lately, or they keep their listening private.</p>
            </div>
          ) : null}
        </section>
      )}

      {server === false ? null : !loaded ? (
        <Skeleton rows={3} />
      ) : (
        <>
          {incoming.length > 0 && (
            <section className="fz-section">
              <h2 className="fz-h">
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
          {people.length > 0 && (
            <section className="fz-section">
              <h2 className="fz-h">
                People you follow <span className="shelf__count">{people.length}</span>
              </h2>
              <div className="ptiles">
                {people.map((u) => (
                  <PersonTile key={u.id} user={u} now={now[u.id]}>
                    {!friends.some((f) => f.id === u.id) && (
                      <button className="btn btn--sm" disabled={busy === u.id} onClick={() => void act('unfollow', u.id, who(u))}>
                        Unfollow
                      </button>
                    )}
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
