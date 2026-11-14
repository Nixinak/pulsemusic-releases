// Follow / Following / Follow back / Friends, on someone's profile.
import { useApp } from '@/lib/store'
import { useFriends, useFriendStatus } from '@/lib/friends'
import { CheckIcon, UserPlusIcon } from './Icons'

export function FriendButton({ id, name, image }: { id: string; name: string; image: string | null }): React.JSX.Element {
  const status = useFriendStatus(id)
  const busy = useFriends((s) => s.busy === id)
  const act = useFriends((s) => s.act)
  const openMenu = useApp((s) => s.openMenu)
  const who = { name, image }

  if (status === 'none' || status === 'follower')
    return (
      <button className="btn btn--accent friend-btn" disabled={busy} onClick={() => void act('follow', id, who)}>
        <UserPlusIcon size={17} />
        {status === 'follower' ? 'Follow back' : 'Follow'}
      </button>
    )
  return (
    <button
      className={`btn friend-btn ${status === 'friend' ? 'is-friend' : ''}`}
      disabled={busy}
      aria-haspopup="menu"
      title={status === 'friend' ? 'You follow each other' : 'You follow them'}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        openMenu(r.left, r.bottom + 6, [{ label: 'Unfollow', danger: true, onSelect: () => void act('unfollow', id, who) }])
      }}
    >
      <CheckIcon size={17} />
      {status === 'friend' ? 'Friends' : 'Following'}
    </button>
  )
}
