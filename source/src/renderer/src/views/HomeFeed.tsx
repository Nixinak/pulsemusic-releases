// Home: news from the people you follow. What they're playing now or played lately (Spotify's
// Friend Activity and Pulse), and playlists they made since you last looked. The whole row
// stays away when there's nothing to show.
//
// Requests: Friend Activity goes through your Spotify web sign-in and the playlists come from
// people's public pages; neither touches Pulse's Web API allowance. Pages are read at most
// eight people at a time and kept for a while.
import { useEffect, useMemo } from 'react'
import { useApp } from '@/lib/store'
import { useFriends } from '@/lib/friends'
import { useQuery } from '@/lib/useQuery'
import { refreshSpotifyFriends, useSpotifyFriends } from '@/lib/spotifyFriends'
import { prefetchUser } from '@/lib/people'
import { playContext } from '@/lib/player'
import { Cover, ShelfRow } from '@/components/common'
import { PlayIcon } from '@/components/Icons'
import { FriendCard, useFriendsFeed } from './FriendsView'
import type { PulseSummary } from '@shared/types'

const SEEN_KEY = 'pulse.seenPlaylists'
const WEEK = 7 * 86_400_000

type Seen = Record<string, Record<string, number>>
function loadSeen(): Seen {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Seen
  } catch {
    return {}
  }
}

interface NewList {
  user: PulseSummary
  id: string
  name: string
  image: string | null
  at: number
}

/** Playlists that showed up on a followed person's page in the last week. The first look at a
 *  person only learns what's there, so nothing old is called new. */
function useNewPlaylists(people: PulseSummary[]): NewList[] {
  const ids = people.slice(0, 8).map((p) => p.id)
  const q = useQuery(ids.length ? `home:people-pages:${ids.join()}` : null, () =>
    Promise.all(ids.map((id) => window.pulse.people.spotifyUserQuick(id).catch(() => null)))
  )
  return useMemo(() => {
    if (!q.data) return []
    const seen = loadSeen()
    const now = Date.now()
    const out: NewList[] = []
    q.data.forEach((page, i) => {
      const user = people[i]
      if (!page || !user) return
      const first = !seen[user.id]
      const mine = (seen[user.id] ??= {})
      for (const pl of page.playlists) {
        if (mine[pl.id] === undefined) mine[pl.id] = first ? 0 : now
        if (mine[pl.id] && now - mine[pl.id] < WEEK) out.push({ user, id: pl.id, name: pl.name, image: pl.image, at: mine[pl.id] })
      }
    })
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify(seen))
    } catch {
      /* storage unavailable */
    }
    return out.sort((a, b) => b.at - a.at).slice(0, 8)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data])
}

function NewPlaylistCard({ n }: { n: NewList }): React.JSX.Element {
  const navigate = useApp((s) => s.navigate)
  return (
    <article className="hfeed__pl">
      <button className="hfeed__pl-art" aria-label={`Open ${n.name}`} onClick={() => navigate({ name: 'playlist', id: n.id })}>
        <Cover src={n.image} radius={18} />
        <span className="hfeed__tag">New playlist</span>
        <span
          className="hfeed__play"
          role="button"
          aria-label={`Play ${n.name}`}
          onClick={(e) => {
            e.stopPropagation()
            void playContext(`spotify:playlist:${n.id}`)
          }}
        >
          <PlayIcon size={22} />
        </span>
      </button>
      <div className="hfeed__pl-body">
        <button className="hfeed__face" onClick={() => navigate({ name: 'user', id: n.user.id })} onMouseEnter={() => prefetchUser(n.user.id)}>
          <Cover src={n.user.thumb} round size={40} />
        </button>
        <span>
          <b>{n.name}</b>
          <small>
            {n.user.displayName} made it {n.at > Date.now() - 86_400_000 ? 'today' : 'this week'}
          </small>
        </span>
      </div>
    </article>
  )
}

export function FollowingFeed(): React.JSX.Element | null {
  const navigate = useApp((s) => s.navigate)
  const { friends, outgoing, now } = useFriends()
  const spotify = useSpotifyFriends((s) => s.list)
  const connected = useSpotifyFriends((s) => s.connected)
  // Friend Activity: once on arrival, then every 90 s while Home is open
  useEffect(() => {
    void refreshSpotifyFriends()
    const t = window.setInterval(() => !document.hidden && void refreshSpotifyFriends(), 90_000)
    return () => window.clearInterval(t)
  }, [])
  const following = useMemo(() => [...friends, ...outgoing], [friends, outgoing])
  const feed = useFriendsFeed(connected ? spotify : null, following, now)
  // today's plays only: older ones aren't news
  const fresh = feed.filter((a) => a.now || Date.now() - a.at < 18 * 3_600_000).slice(0, 10)
  const lists = useNewPlaylists(following)
  if (!fresh.length && !lists.length) return null
  const live = fresh.filter((a) => a.now).length
  return (
    <section className="shelf hfeed">
      <header className="shelf__head">
        <h2>
          From people you follow
          {live > 0 && (
            <span className="hfeed__live">
              <i /> {live} listening now
            </span>
          )}
        </h2>
        <button className="shelf__more" onClick={() => navigate({ name: 'friends' })}>
          Friends
        </button>
      </header>
      <ShelfRow className="hfeed__row" loop={false}>
        {fresh.map((a, i) => (
          <div key={a.id} className="hfeed__item">
            <FriendCard a={a} i={i} />
          </div>
        ))}
        {lists.map((n) => (
          <div key={n.id} className="hfeed__item">
            <NewPlaylistCard n={n} />
          </div>
        ))}
      </ShelfRow>
    </section>
  )
}
