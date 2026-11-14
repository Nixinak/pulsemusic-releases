// Friends: who's listening right now (with Listen along), people waiting for a follow back,
// your friends, and everyone else you follow. Two people who follow each other are friends.
import { useEffect, useState } from 'react'
import { useApp } from '@/lib/store'
import { listenWith, markFollowersSeen, stopListeningWith, useFriends, useListenWith, watchFriendsClosely } from '@/lib/friends'
import { joinParty } from '@/lib/listenAlong'
import { prefetchUser, pulseServerOn } from '@/lib/people'
import type { NowPlaying, PulseSummary } from '@shared/types'
import { Cover, Skeleton } from '@/components/common'
import { PulseBadge } from '@/components/PulseBadge'
import { FollowCounts } from './FollowsView'
import { HeadphonesIcon, SearchIcon, UserPlusIcon, UsersIcon } from '@/components/Icons'

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

  return (
    <div className="friends">
      <header className="friends__hero">
        <div className="friends__title">
          <h1>Friends</h1>
          <p className="muted">
            {!loaded
              ? ' '
              : live.length
                ? `${live.length} ${live.length === 1 ? 'person is' : 'people are'} listening right now`
                : friends.length
                  ? `${friends.length} ${friends.length === 1 ? 'friend' : 'friends'}`
                  : 'Follow people and see what they play'}
          </p>
          {me && loaded && server !== false && <FollowCounts id={me.id} followers={friends.length + incoming.length} following={following.length} />}
        </div>
      </header>

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
                <h2>Listening now</h2>
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
              <h2>Your friends</h2>
            </header>
            {friends.length ? (
              <div className="ptiles">
                {friends.map((u) => (
                  <PersonTile key={u.id} user={u} now={now[u.id]} />
                ))}
              </div>
            ) : (
              <div className="friends__empty">
                <UsersIcon size={34} />
                <p>Follow someone from their profile. When they follow you back, you’re friends and can listen along.</p>
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

          <button className="btn btn--accent friends__find" onClick={() => navigate({ name: 'search' })}>
            <SearchIcon size={16} /> Find people
          </button>
        </>
      )}
    </div>
  )
}
