// Friends: one feed of what the people you follow are playing, on Pulse and on Spotify (Friend
// Activity, once your Spotify account is connected), with no line between the two: people who
// use Pulse just wear its badge (and can be listened along with). Below it: people waiting for a
// follow back, and everyone you follow on Pulse. Two people who follow each other are friends.
import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/store'
import { listenWith, markFollowersSeen, stopListeningWith, useFriends, useListenWith, watchFriendsClosely } from '@/lib/friends'
import { joinParty } from '@/lib/listenAlong'
import { prefetchUser, pulseServerOn } from '@/lib/people'
import type { NowPlaying, PulseSummary, SpotifyFriend } from '@shared/types'
import { Cover, Skeleton } from '@/components/common'
import { PulseBadge } from '@/components/PulseBadge'
import { FollowCounts } from './FollowsView'
import { HeadphonesIcon, PlayIcon, SearchIcon, UserPlusIcon, UsersIcon } from '@/components/Icons'
import { playContext, playUris } from '@/lib/player'
import { connectSpotifyFriends, useSpotifyFriends, useSpotifyFriendsLive, whenPlayed } from '@/lib/spotifyFriends'
import { motion } from 'motion/react'

/** One person in the feed: whoever they are, wherever they listen. */
export interface Activity {
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

/** One feed of the people you follow: Spotify's Friend Activity and Pulse's live plays, one
 *  entry per person, whoever is listening right now first. */
export function useFriendsFeed(spotify: SpotifyFriend[] | null, following: PulseSummary[], now: Record<string, NowPlaying | null | undefined>): Activity[] {
  // one feed: Spotify's Friend Activity and Pulse's live plays, one entry per person
  return useMemo(() => {
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
        now: f.playing === true || whenPlayed(f.at).now,
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
}

/** One friend: the cover of what they play, their face on its corner, the song, and when. */
export function FriendCard({ a, i }: { a: Activity; i: number }): React.JSX.Element {
  const navigate = useApp((s) => s.navigate)
  const listening = useListenWith((s) => s.with?.id === a.id)
  const ctx = a.track.context?.name && !/^a (playlist|album)$/i.test(a.track.context.name) ? a.track.context.name : null
  return (
    <motion.article
      className={`fzc ${a.now ? 'is-live' : ''} ${listening ? 'is-on' : ''}`}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(i, 10) * 0.04, type: 'spring', stiffness: 260, damping: 28 }}
    >
      <button className="fzc__art" aria-label={`Play ${a.track.name}`} onClick={() => playActivity(a)}>
        {a.track.image ? <img src={a.track.image} alt="" draggable={false} /> : <i className="fzc__blank" />}
        <span className="fzc__when">
          {a.now ? (
            <>
              <span className="fz-eq" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              Live
            </>
          ) : (
            rowTime(a.at)
          )}
        </span>
        <span className="fzc__play" aria-hidden="true">
          <PlayIcon size={24} />
        </span>
      </button>
      <div className="fzc__body">
        <button className="fzc__pic" aria-label={a.name} onClick={() => navigate({ name: 'user', id: a.id })} onMouseEnter={() => prefetchUser(a.id)}>
          <Cover src={a.image} round size={44} />
        </button>
        <div className="fzc__text">
          <span className="fzc__name">
            <button onClick={() => navigate({ name: 'user', id: a.id })}>{a.name}</button>
            {a.pulse && <PulseBadge small />}
          </span>
          <button className="fzc__song" onClick={() => a.track.albumId && navigate({ name: 'album', id: a.track.albumId })}>
            {a.track.name}
          </button>
          <span className="fzc__by">
            <button onClick={() => a.track.artistId && navigate({ name: 'artist', id: a.track.artistId })}>{a.track.artist}</button>
            {ctx && <small>{ctx}</small>}
          </span>
        </div>
      </div>
      {(a.pulse || a.party) && a.now && (
        <div className="fzc__actions">
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
      )}
    </motion.article>
  )
}

const DAY_MS = 86_400_000
const dayOf = (t: number): number => new Date(new Date(t).toDateString()).getTime()
/** "25 min ago" today, "Yesterday", the weekday this week, the date before that. */
function rowTime(at: number): string {
  const d = (dayOf(Date.now()) - dayOf(at)) / DAY_MS
  if (d < 1) return whenPlayed(at).text
  if (d < 2) return 'Yesterday'
  if (d < 7) return new Date(at).toLocaleDateString('en-US', { weekday: 'long' })
  return new Date(at).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
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

/** Someone you follow (or who follows you): picture, name, and any buttons. */
function PersonTile({ user, now, children }: { user: PulseSummary; now?: NowPlaying; children?: React.ReactNode }): React.JSX.Element {
  const navigate = useApp((s) => s.navigate)
  const live = !!now?.track && !now.paused
  return (
    <div className={`fzp ${live ? 'is-live' : ''}`}>
      <button className="fzp__who" onClick={() => navigate({ name: 'user', id: user.id })} onMouseEnter={() => prefetchUser(user.id)}>
        <span className="fzp__pic">
          <Cover src={user.thumb} round size={56} />
        </span>
        <span className="fzp__text">
          <b>{user.displayName}</b>
          <small>{live ? `Playing ${now!.track!.name}` : user.pulse !== false ? 'On Pulse' : 'On Spotify'}</small>
        </span>
      </button>
      {children && <div className="fzp__actions">{children}</div>}
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

  const feed = useFriendsFeed(spotify, following, now)
  const live = feed.filter((a) => a.now)
  const recent = feed.filter((a) => !a.now)
  const people = following.filter((u) => u.pulse !== false)

  return (
    <div className="friends fz">
      <header className="fz-top">
        <div>
          <h1 className="page-title">Friends</h1>
          <p className="muted fz-top__line">
            {live.length > 0 && (
              <span className="fz-top__faces" aria-hidden="true">
                {live.slice(0, 4).map((a) => (
                  <Cover key={a.id} src={a.image} round size={26} />
                ))}
              </span>
            )}
            {live.length
              ? `${live.length} ${live.length === 1 ? 'person is' : 'people are'} listening right now`
              : feed.length
                ? `${feed.length} ${feed.length === 1 ? 'person' : 'people'} played something lately`
                : 'See what the people you follow are playing'}
          </p>
        </div>
        <div className="fz-top__row">
          {me && loaded && server !== false && <FollowCounts id={me.id} followers={friends.length + incoming.length} following={following.length} />}
          <button className="btn btn--accent" onClick={() => navigate({ name: 'search' })}>
            <SearchIcon size={16} /> Find people
          </button>
        </div>
      </header>

      {connected === false && <ConnectSpotify />}

      <section className="fz-section">
        {spotify === null && connected && !feed.length ? (
          <div className="fzc-grid" aria-hidden="true">
            {[0, 1, 2, 3].map((k) => (
              <div key={k} className="fzc fzc--ghost" />
            ))}
          </div>
        ) : feed.length ? (
          <div className="fzc-grid">
            {[...live, ...recent].map((a, i) => (
              <FriendCard key={a.id} a={a} i={i} />
            ))}
          </div>
        ) : (
          <div className="fz-empty">
            <HeadphonesIcon size={26} />
            <p>Nobody you follow has played anything lately, or they keep their listening private.</p>
          </div>
        )}
      </section>

      {server === false ? null : !loaded ? (
        <Skeleton rows={3} />
      ) : (
        <>
          {incoming.length > 0 && (
            <section className="fz-section">
              <h2 className="fz-h">
                Follows you <span className="shelf__count">{incoming.length}</span>
              </h2>
              <div className="fzp-row">
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
              <div className="fzp-row">
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
