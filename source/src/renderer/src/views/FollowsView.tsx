// Followers and Following of anyone (like on Spotify): people who follow them in Pulse, and
// the ones their public Spotify page lists. Opened from the counts on a profile.
import { useEffect, useMemo } from 'react'
import { motion } from 'motion/react'
import { useApp } from '@/lib/store'
import { useQuery } from '@/lib/useQuery'
import { useFriends } from '@/lib/friends'
import { knownPerson, prefetchUser, rememberPeople } from '@/lib/people'
import { Cover, ErrorState } from '@/components/common'
import { Glass } from '@/components/Glass'
import { PulseBadge } from '@/components/PulseBadge'
import { FriendButton } from '@/components/FriendButton'
import { SearchIcon } from '@/components/Icons'

type Kind = 'followers' | 'following'
interface Person {
  id: string
  name: string
  image: string | null
  pulse: boolean
}

/**
 * Both lists for someone. The Pulse lists come first and show straight away; people from
 * their Spotify page (only for the tab that's open: those pages are slow) join when ready.
 * Your own Pulse lists come live from Friends.
 */
export function useFollowLists(
  id: string,
  kind: Kind
): { followers: Person[] | null; following: Person[] | null; spotifyLoading: boolean } {
  const me = useApp((s) => s.me)
  const mine = me?.id === id
  const friends = useFriends()
  const pulseQ = useQuery(mine ? null : `follows-of:${id}`, () => window.pulse.people.followsOf(id))
  const spotifyQ = useQuery(`sp-follows:${kind}:${id}`, () => window.pulse.people.spotifyFollows(id, kind))
  // the other tab's Spotify list, only if it was read before
  return useMemo(() => {
    const fromPulse = (list: { id: string; displayName: string; thumb: string | null; pulse?: boolean }[]): Person[] =>
      list.map((u) => {
        const k = u.displayName === u.id ? knownPerson(u.id) : null
        return { id: u.id, name: k?.name ?? u.displayName, image: u.thumb ?? k?.image ?? null, pulse: u.pulse !== false }
      })
    const merge = (a: Person[], b: { id: string; name: string; image: string | null }[] | undefined): Person[] => {
      const out = new Map(a.map((p) => [p.id, p]))
      for (const p of b ?? []) if (!out.has(p.id) && p.id !== id) out.set(p.id, { ...p, pulse: false })
      return [...out.values()]
    }
    const pulseDone = mine ? friends.loaded : pulseQ.data !== undefined || !!pulseQ.error
    const pulseFollowers = mine ? fromPulse([...friends.friends, ...friends.incoming]) : fromPulse(pulseQ.data?.followers ?? [])
    const pulseFollowing = mine ? fromPulse([...friends.friends, ...friends.outgoing]) : fromPulse(pulseQ.data?.following ?? [])
    const lists = {
      followers: pulseDone ? pulseFollowers : null,
      following: pulseDone ? pulseFollowing : null
    }
    const fromSpotify = spotifyQ.data
    if (fromSpotify?.length) lists[kind] = merge(lists[kind] ?? [], fromSpotify)
    return { ...lists, spotifyLoading: spotifyQ.data === undefined && !spotifyQ.error }
  }, [mine, id, kind, friends, pulseQ.data, pulseQ.error, spotifyQ.data, spotifyQ.error])
}

export function FollowsView({ id, kind }: { id: string; kind: Kind }): React.JSX.Element {
  const me = useApp((s) => s.me)
  const navigate = useApp((s) => s.navigate)
  const mine = me?.id === id
  const head = useQuery(mine ? null : `spotify-user-quick:${id}`, () => window.pulse.people.spotifyUserQuick(id))
  const lists = useFollowLists(id, kind)
  const list = lists[kind]
  const name = mine ? 'You' : (head.data?.name ?? knownPerson(id)?.name ?? id)
  useEffect(() => {
    if (list?.length) rememberPeople(list)
  }, [list])

  return (
    <div className="follows">
      <header className="follows__head">
        <button className="follows__who" onClick={() => navigate(mine ? { name: 'profile' } : { name: 'user', id })}>
          <Cover src={mine ? null : (head.data?.image ?? knownPerson(id)?.image ?? null)} round size={40} />
          <b>{name}</b>
        </button>
        <Glass radius={999} bezel={10} refraction={28} className="segmented">
          {(['followers', 'following'] as Kind[]).map((k) => (
            <button key={k} className={`segmented__btn ${kind === k ? 'is-on' : ''}`} onClick={() => navigate({ name: 'follows', id, kind: k })}>
              {kind === k && <motion.span layoutId="seg-follows" className="segmented__thumb" transition={{ type: 'spring', stiffness: 500, damping: 36 }} />}
              <span>
                {k === 'followers' ? 'Followers' : 'Following'}
                {k === kind && list && !lists.spotifyLoading ? ` ${list.length}` : ''}
              </span>
            </button>
          ))}
        </Glass>
      </header>

      {list && list.length > 0 && (
        <div className="ptiles follows__list">
          {list.map((p) => (
            <motion.div key={p.id} className="ptile" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
              <button className="ptile__who" onClick={() => navigate(p.id === me?.id ? { name: 'profile' } : { name: 'user', id: p.id })} onMouseEnter={() => prefetchUser(p.id)}>
                <span className="ptile__pic">
                  <Cover src={p.image} round />
                </span>
                <b>{p.name}</b>
                <small>{p.pulse ? <PulseBadge small /> : 'Spotify'}</small>
              </button>
              {me && p.id !== me.id && (
                <div className="ptile__actions">
                  <FriendButton id={p.id} name={p.name} image={p.image} />
                </div>
              )}
            </motion.div>
          ))}
        </div>
      )}
      {lists.spotifyLoading ? (
        <p className="follows__more muted">
          <span className="cmd__spin" /> {list?.length ? 'Looking for more on Spotify…' : 'Loading…'}
        </p>
      ) : (
        list?.length === 0 && (
          <ErrorState text={kind === 'followers' ? `Nobody follows ${mine ? 'you' : name} yet.` : `${mine ? 'You don’t' : `${name} doesn’t`} follow anyone yet.`} />
        )
      )}
      {mine && kind === 'following' && (
        <button className="btn follows__find" onClick={() => navigate({ name: 'search' })}>
          <SearchIcon size={16} /> Find people
        </button>
      )}
    </div>
  )
}

/** "12 followers · 30 following", each opening its list. */
export function FollowCounts({ id, followers, following }: { id: string; followers: number | null; following: number | null }): React.JSX.Element | null {
  const navigate = useApp((s) => s.navigate)
  if (followers == null && following == null) return null
  return (
    <span className="followcounts">
      <button onClick={() => navigate({ name: 'follows', id, kind: 'followers' })}>
        <b>{followers ?? '–'}</b> {followers === 1 ? 'follower' : 'followers'}
      </button>
      <span aria-hidden="true">·</span>
      <button onClick={() => navigate({ name: 'follows', id, kind: 'following' })}>
        <b>{following ?? '–'}</b> following
      </button>
    </span>
  )
}
