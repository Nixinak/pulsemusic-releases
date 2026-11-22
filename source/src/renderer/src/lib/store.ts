import { create } from 'zustand'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'
import type { SPlaylist, SUser } from './types'
import { ApiError, getMe, getMyPlaylists, rateLimitedUntil } from './spotify'

const PLAYLISTS_KEY = 'pulse-playlists'
let refreshingPlaylists: Promise<void> | null = null

export type Route =
  | { name: 'home' }
  | { name: 'search' }
  | { name: 'library'; tab?: LibraryTab }
  | { name: 'liked' }
  | { name: 'album'; id: string }
  | { name: 'artist'; id: string }
  | { name: 'playlist'; id: string }
  | { name: 'settings' }
  | { name: 'profile' }
  | { name: 'mix' }
  | { name: 'stats' }
  /** 1,000 goals in ladders, with how rare each is among Spotify listeners. */
  | { name: 'achievements' }
  | { name: 'dj' }
  | { name: 'party' }
  | { name: 'user'; id: string }
  | { name: 'friends' }
  | { name: 'follows'; id: string; kind: 'followers' | 'following' }
  /** A playlist Pulse made for you (lib/madeForYou). */
  | { name: 'made'; id: string }

/** What Now Playing shows next to the cover; 'none' centres the cover. */
export type NpPanel = 'lyrics' | 'queue' | 'none'

export type LibraryTab = 'playlists' | 'albums' | 'artists'

export interface MenuItem {
  label: string
  onSelect?: () => void
  danger?: boolean
  disabled?: boolean
  submenu?: MenuItem[]
  separator?: boolean
}

export type Modal =
  { type: 'create-playlist'; addUris?: string[] } | { type: 'edit-playlist'; playlist: SPlaylist } | { type: 'delete-playlist'; playlist: SPlaylist }

interface Toast {
  id: number
  text: string
  tone: 'info' | 'error'
}

interface AppState {
  history: Route[]
  index: number
  navigate: (r: Route) => void
  back: () => void
  forward: () => void

  me: SUser | null
  playlists: SPlaylist[]
  /** The list came from Spotify at least once this session (or the public page stood in). */
  playlistsLoaded: boolean
  /** Why the list couldn't be loaded, while it can't. */
  playlistsError: string | null
  loadMe: () => Promise<void>
  refreshPlaylists: () => Promise<void>

  settings: Settings
  setSettingsLocal: (s: Settings) => void
  updateSettings: (patch: Partial<Settings>) => Promise<void>

  nowPlaying: boolean
  setNowPlaying: (open: boolean) => void
  npPanel: NpPanel
  setNpPanel: (p: NpPanel) => void
  queueOpen: boolean
  setQueueOpen: (open: boolean) => void
  /** Lyrics docked at the right edge (remembered between starts). */
  lyricsOpen: boolean
  setLyricsOpen: (open: boolean) => void

  searchQuery: string
  setSearchQuery: (q: string) => void

  /** Ctrl+K quick search. */
  paletteOpen: boolean
  setPaletteOpen: (open: boolean) => void
  /** Full-screen Recap stories. */
  recapOpen: boolean
  /** Which period Recap opens on: 'month', 'year', 'all' or one month ('m:2026-10'). */
  recapPeriod: string
  setRecapOpen: (open: boolean, period?: string) => void

  toasts: Toast[]
  toast: (text: string, tone?: Toast['tone']) => void

  modal: Modal | null
  setModal: (m: Modal | null) => void

  menu: { x: number; y: number; items: MenuItem[] } | null
  openMenu: (x: number, y: number, items: MenuItem[]) => void
  closeMenu: () => void

  /** Bumped whenever the Liked Songs collection changes. */
  likedVersion: number
  bumpLiked: () => void
}

let toastId = 0

export const useApp = create<AppState>((set, get) => ({
  history: [{ name: 'home' }],
  index: 0,
  navigate: (r) => {
    const { history, index } = get()
    const cur = history[index]
    if (JSON.stringify(cur) === JSON.stringify(r)) return
    set({
      history: [...history.slice(0, index + 1), r],
      index: index + 1,
      nowPlaying: false
    })
  },
  back: () => set((s) => ({ index: Math.max(0, s.index - 1) })),
  forward: () => set((s) => ({ index: Math.min(s.history.length - 1, s.index + 1) })),

  me: null,
  // shown straight away from the last session while the fresh list loads
  // (saved with the account id; another account never sees them)
  playlists: (() => {
    try {
      const saved = JSON.parse(localStorage.getItem(PLAYLISTS_KEY) ?? 'null') as { user: string; playlists: SPlaylist[] } | null
      return saved?.playlists ?? []
    } catch {
      return []
    }
  })(),
  loadMe: async () => {
    const me = await getMe()
    // the remembered list belongs to someone else: don't show it
    try {
      const saved = JSON.parse(localStorage.getItem(PLAYLISTS_KEY) ?? 'null') as { user: string } | null
      if (saved && saved.user !== me.id) {
        localStorage.removeItem(PLAYLISTS_KEY)
        set({ playlists: [] })
      }
    } catch {
      /* storage unavailable */
    }
    set({ me })
    await get().refreshPlaylists()
  },
  playlistsLoaded: false,
  playlistsError: null,
  refreshPlaylists: async () => {
    if (refreshingPlaylists) return refreshingPlaylists
    refreshingPlaylists = (async () => {
      // Other errors: a few tries with growing pauses. Spotify limiting requests: wait the
      // block out and try again, however long it takes (the list must never stay empty).
      // Meanwhile (and when Spotify answers with an empty list) your public profile page
      // stands in, so your playlists show up either way.
      let errors = 0
      let filled = false
      const standIn = async (): Promise<void> => {
        if (filled || get().playlists.length) return
        filled = true
        const fromPage = await publicPlaylists(get().me)
        if (fromPage.length && !get().playlists.length) set({ playlists: fromPage, playlistsLoaded: true })
      }
      for (;;) {
        try {
          let playlists = (await getMyPlaylists()).filter((p) => !!p?.id && !!p.owner)
          if (!playlists.length) {
            const fromPage = await publicPlaylists(get().me)
            if (fromPage.length) {
              console.warn('[playlists] Spotify gave an empty list; using the public profile page')
              playlists = fromPage
            }
          }
          set({ playlists, playlistsLoaded: true, playlistsError: null })
          try {
            const user = get().me?.id
            if (user) localStorage.setItem(PLAYLISTS_KEY, JSON.stringify({ user, playlists }))
          } catch {
            /* storage full or unavailable */
          }
          return
        } catch (e) {
          console.error('[playlists] load failed', e)
          set({ playlistsError: errorText(e) })
          void standIn()
          const limited = e instanceof ApiError && e.status === 429
          if (limited) {
            const until = rateLimitedUntil()
            await new Promise((r) => setTimeout(r, Math.max(5000, until - Date.now() + 1500)))
            continue
          }
          if (++errors >= 8) return get().toast(`Could not load your playlists: ${errorText(e)}`, 'error')
          await new Promise((r) => setTimeout(r, Math.min(30_000, 2500 * 2 ** errors)))
        }
      }
    })().finally(() => {
      refreshingPlaylists = null
    })
    return refreshingPlaylists
  },

  settings: DEFAULT_SETTINGS,
  setSettingsLocal: (settings) => set({ settings }),
  updateSettings: async (patch) => {
    set((s) => ({ settings: { ...s.settings, ...patch } }))
    const saved = await window.pulse.settings.set(patch)
    set({ settings: saved })
  },

  nowPlaying: false,
  setNowPlaying: (nowPlaying) => set({ nowPlaying }),
  npPanel: 'lyrics',
  setNpPanel: (npPanel) => set({ npPanel }),
  queueOpen: false,
  // one side panel at a time
  setQueueOpen: (queueOpen) => set(queueOpen ? { queueOpen, lyricsOpen: false } : { queueOpen }),
  lyricsOpen: (() => {
    try {
      return localStorage.getItem('pulse-lyrics-docked') === '1'
    } catch {
      return false
    }
  })(),
  setLyricsOpen: (lyricsOpen) => {
    try {
      localStorage.setItem('pulse-lyrics-docked', lyricsOpen ? '1' : '0')
    } catch {
      /* not remembered */
    }
    set(lyricsOpen ? { lyricsOpen, queueOpen: false } : { lyricsOpen })
  },

  searchQuery: '',
  setSearchQuery: (searchQuery) => set({ searchQuery }),

  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  recapOpen: false,
  recapPeriod: 'month',
  setRecapOpen: (recapOpen, period) =>
    set({
      recapOpen,
      nowPlaying: false,
      ...(recapOpen ? { recapPeriod: period ?? 'month' } : {})
    }),

  toasts: [],
  toast: (text, tone = 'info') => {
    if (get().toasts.some((t) => t.text === text)) return
    const id = ++toastId
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, tone }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3200)
  },

  modal: null,
  setModal: (modal) => set({ modal }),

  menu: null,
  openMenu: (x, y, items) => set({ menu: { x, y, items } }),
  closeMenu: () => set({ menu: null }),

  likedVersion: 0,
  bumpLiked: () => set((s) => ({ likedVersion: s.likedVersion + 1 }))
}))

export const currentRoute = (s: AppState): Route => s.history[s.index]

/** Your public playlists from your Spotify profile page, shaped like Web API playlists. */
async function publicPlaylists(me: SUser | null): Promise<SPlaylist[]> {
  if (!me) return []
  try {
    const page = await window.pulse.people.spotifyUser(me.id)
    return (page?.playlists ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      uri: `spotify:playlist:${p.id}`,
      description: null,
      images: p.image ? [{ url: p.image, width: null, height: null }] : [],
      owner: { id: me.id, display_name: me.display_name ?? undefined },
      collaborative: false,
      public: true,
      type: 'playlist' as const
    }))
  } catch (e) {
    console.warn('[playlists] public profile page unreadable', e)
    return []
  }
}

/** Playlists you made (or collaborate on), and ones by other people you saved. */
export const isOwnPlaylist = (p: SPlaylist, meId: string | undefined): boolean => p.owner.id === meId || p.collaborative

/** Playlists the signed-in user can edit. */
export const editablePlaylists = (s: AppState): SPlaylist[] => s.playlists.filter((p) => p.owner.id === s.me?.id || p.collaborative)

export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))
