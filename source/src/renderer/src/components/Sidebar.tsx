import { useEffect } from 'react'
import { Emo } from './Emoji'
import { create } from 'zustand'
import { motion } from 'motion/react'
import { useApp, currentRoute, type Route } from '@/lib/store'
import { usePlayer } from '@/lib/player'
import { pickImage, playlistSongs } from '@/lib/spotify'
import { Glass } from './Glass'
import { useProfile } from '@/lib/profile'
import { Cover } from './common'
import { PartyIcon, ChartIcon, HeartIcon, HomeIcon, LibraryIcon, MicIcon, PlusIcon, SearchIcon, SettingsIcon, UsersIcon, WandIcon } from './Icons'
import { useNewFollowers } from '@/lib/friends'
import { contextMenuFor } from './menus'

const NAV: { label: string; route: Route; icon: typeof HomeIcon }[] = [
  { label: 'Home', route: { name: 'home' }, icon: HomeIcon },
  { label: 'Search', route: { name: 'search' }, icon: SearchIcon },
  { label: 'Library', route: { name: 'library' }, icon: LibraryIcon },
  { label: 'DJ', route: { name: 'dj' }, icon: MicIcon },
  { label: 'Your stats', route: { name: 'stats' }, icon: ChartIcon },
  { label: 'Mix', route: { name: 'mix' }, icon: WandIcon },
  { label: 'Party', route: { name: 'party' }, icon: PartyIcon },
  { label: 'Friends', route: { name: 'friends' }, icon: UsersIcon }
]

/** Collapsed: only icons and playlist covers. Remembered between starts. */
const readCollapsed = (): boolean => {
  try {
    return localStorage.getItem('pulse-sidebar') === 'collapsed'
  } catch {
    return false
  }
}
export const useSidebar = create<{ collapsed: boolean }>(() => ({
  collapsed: readCollapsed()
}))
export function toggleSidebar(): void {
  const collapsed = !useSidebar.getState().collapsed
  useSidebar.setState({ collapsed })
  try {
    localStorage.setItem('pulse-sidebar', collapsed ? 'collapsed' : 'open')
  } catch {
    /* not remembered */
  }
}

const PanelIcon = ({ size = 18 }: { size?: number }): React.JSX.Element => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
    <path d="M9.5 4.5v15" />
  </svg>
)

export function Sidebar(): React.JSX.Element {
  const collapsed = useSidebar((s) => s.collapsed)
  useEffect(() => {
    document.documentElement.dataset.sidebar = collapsed ? 'collapsed' : 'open'
  }, [collapsed])
  // Ctrl+B hides and shows it
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault()
        toggleSidebar()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const route = useApp(currentRoute)
  const navigate = useApp((s) => s.navigate)
  const playlists = useApp((s) => s.playlists)
  const me = useApp((s) => s.me)
  const setModal = useApp((s) => s.setModal)
  const openMenu = useApp((s) => s.openMenu)
  const contextUri = usePlayer((s) => s.contextUri)
  const paused = usePlayer((s) => s.paused)
  const profile = useProfile((s) => s.profile)
  const requests = useNewFollowers()

  const isActive = (r: Route): boolean => r.name === route.name && (!('id' in r) || ('id' in route && route.id === r.id))

  return (
    <Glass className="sidebar" radius={26} bezel={22} refraction={70} blur={14} tone="regular">
      <div className="sidebar__brand">
        <button className="sidebar__home" aria-label="Home" onClick={() => navigate({ name: 'home' })}>
          <span className="sidebar__logo" aria-hidden="true" />
          <span className="sidebar__name">Pulse</span>
        </button>
        <button
          className="icon-btn icon-btn--sm sidebar__toggle"
          aria-label={collapsed ? 'Show sidebar' : 'Hide sidebar'}
          title={collapsed ? 'Show sidebar (Ctrl+B)' : 'Hide sidebar (Ctrl+B)'}
          onClick={toggleSidebar}
        >
          <PanelIcon />
        </button>
      </div>

      <nav className="sidebar__nav">
        {NAV.map(({ label, route: r, icon: Icon }) => (
          <button key={label} className={`navitem ${isActive(r) ? 'is-active' : ''}`} onClick={() => navigate(r)} title={collapsed ? label : undefined}>
            {isActive(r) && <motion.span layoutId="nav-pill" className="navitem__pill" transition={{ type: 'spring', stiffness: 520, damping: 42 }} />}
            <Icon size={20} />
            <span className="navitem__label">{label}</span>
            {r.name === 'friends' && requests > 0 && (
              <span className="navitem__badge" aria-label={`${requests} new followers`}>
                {requests}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="sidebar__section">
        <span>Playlists</span>
        <button className="icon-btn icon-btn--sm" aria-label="Create playlist" onClick={() => setModal({ type: 'create-playlist' })}>
          <PlusIcon size={17} />
        </button>
      </div>

      <div className="sidebar__lists">
        <button className={`plitem ${route.name === 'liked' ? 'is-active' : ''}`} onClick={() => navigate({ name: 'liked' })} title="Liked Songs">
          <span className="plitem__liked">
            <HeartIcon size={15} filled />
          </span>
          <span className="plitem__text">
            <span className="plitem__name">Liked Songs</span>
          </span>
          {me && contextUri === `spotify:user:${me.id}:collection` && !paused && <span className="plitem__dot" />}
        </button>
        {playlists.map((p) => (
          <button
            key={p.id}
            className={`plitem ${isActive({ name: 'playlist', id: p.id }) ? 'is-active' : ''}`}
            onClick={() => navigate({ name: 'playlist', id: p.id })}
            onContextMenu={(e) => {
              e.preventDefault()
              openMenu(e.clientX, e.clientY, contextMenuFor('playlist', p.uri, p.name))
            }}
            title={p.name}
          >
            <Cover src={pickImage(p.images, 64)} size={34} radius={7} />
            <span className="plitem__text">
              <span className="plitem__name">
                <Emo>{p.name}</Emo>
              </span>
              <span className="plitem__meta">{p.owner.id === me?.id ? playlistSongs(p) : (p.owner.display_name ?? 'Playlist')}</span>
            </span>
            {contextUri === p.uri && !paused && <span className="plitem__dot" />}
          </button>
        ))}
      </div>

      <div className="sidebar__footer">
        <button className={`me-btn ${route.name === 'profile' ? 'is-active' : ''}`} onClick={() => navigate({ name: 'profile' })} title="Your profile">
          <Cover src={profile.avatar ?? pickImage(me?.images, 64)} size={34} round />
          <span className="me-btn__name">{profile.displayName || me?.display_name || 'Profile'}</span>
        </button>
        <button
          className={`icon-btn ${route.name === 'settings' ? 'is-on' : ''}`}
          aria-label="Settings"
          title="Settings"
          onClick={() => navigate({ name: 'settings' })}
        >
          <SettingsIcon size={20} />
        </button>
      </div>
    </Glass>
  )
}
