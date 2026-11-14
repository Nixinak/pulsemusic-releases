// Ctrl+K quick search: songs, artists, albums, your playlists, app pages, settings and actions.
import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { FontChoice, Settings } from '@shared/types'
import { useApp, type Route } from '@/lib/store'
import * as sp from '@/lib/spotify'
import {
  cycleRepeat,
  nextTrack,
  playContext,
  playUris,
  previousTrack,
  setSleepTimer,
  toggleLike,
  togglePlay,
  toggleShuffle,
  usePlayer
} from '@/lib/player'
import type { SearchResults } from '@/lib/types'
import { startDj } from '@/lib/dj'
import { Glass } from './Glass'
import { Cover } from './common'
import {
  ChartIcon,
  CommandIcon,
  HeartIcon,
  HomeIcon,
  LibraryIcon,
  MicIcon,
  MoonIcon,
  NoteIcon,
  PlayIcon,
  SearchIcon,
  SettingsIcon,
  SparkleIcon,
  WandIcon
} from './Icons'

interface Item {
  id: string
  group: string
  label: string
  sub?: string
  /** Extra words to match on. */
  keywords?: string
  image?: string | null
  round?: boolean
  icon?: React.ReactNode
  hint?: string
  run: () => void
}

export const FONTS: { id: FontChoice; label: string }[] = [
  { id: 'figtree', label: 'Figtree' },
  { id: 'bricolage', label: 'Bricolage Grotesque' },
  { id: 'inter', label: 'Inter' },
  { id: 'manrope', label: 'Manrope' },
  { id: 'outfit', label: 'Outfit' },
  { id: 'system', label: 'System (Segoe UI)' }
]

function score(item: Item, q: string): number {
  if (!q) return 1
  const hay = `${item.label} ${item.sub ?? ''} ${item.keywords ?? ''}`.toLowerCase()
  const label = item.label.toLowerCase()
  let s = 0
  for (const tok of q.toLowerCase().split(/\s+/).filter(Boolean)) {
    const at = hay.indexOf(tok)
    if (at < 0) return 0
    s += label.startsWith(tok) ? 6 : label.includes(` ${tok}`) ? 4 : at < label.length ? 3 : 1
  }
  return s
}

function useStaticItems(close: () => void): Item[] {
  const navigate = useApp((s) => s.navigate)
  const settings = useApp((s) => s.settings)
  const update = useApp((s) => s.updateSettings)
  const playlists = useApp((s) => s.playlists)
  const me = useApp((s) => s.me)

  return useMemo(() => {
    const go = (r: Route) => () => {
      navigate(r)
      close()
    }
    const set = (patch: Partial<Settings>, label: string) => () => {
      void update(patch)
      useApp.getState().toast(label)
    }
    const page = (id: string, label: string, r: Route, icon: React.ReactNode, keywords = ''): Item => ({
      id: `page:${id}`,
      group: 'Go to',
      label,
      icon,
      keywords: `page open ${keywords}`,
      run: go(r)
    })
    const items: Item[] = [
      page('home', 'Home', { name: 'home' }, <HomeIcon size={18} />),
      page('search', 'Search', { name: 'search' }, <SearchIcon size={18} />, 'find browse'),
      page('library', 'Library', { name: 'library' }, <LibraryIcon size={18} />, 'playlists albums artists'),
      page('albums', 'Library: Albums', { name: 'library', tab: 'albums' }, <LibraryIcon size={18} />),
      page('artists', 'Library: Artists', { name: 'library', tab: 'artists' }, <LibraryIcon size={18} />, 'following'),
      page('liked', 'Liked Songs', { name: 'liked' }, <HeartIcon size={18} filled />, 'favourites saved'),
      page('stats', 'Your stats', { name: 'stats' }, <ChartIcon size={18} />, 'listening history top hours minutes'),
      page('dj', 'Pulse DJ', { name: 'dj' }, <MicIcon size={18} />, 'ai radio host voice'),
      page('mix', 'Mix generator', { name: 'mix' }, <WandIcon size={18} />, 'make playlist shuffle generate'),
      page('profile', 'Your profile', { name: 'profile' }, <NoteIcon size={18} />, 'me account card'),
      page('settings', 'Settings', { name: 'settings' }, <SettingsIcon size={18} />, 'preferences options'),
      {
        id: 'act:recap',
        group: 'Actions',
        label: 'Play your Recap',
        icon: <SparkleIcon size={18} />,
        keywords: 'wrapped stories year month stats',
        run: () => {
          useApp.getState().setRecapOpen(true)
          close()
        }
      },
      { id: 'act:play', group: 'Actions', label: 'Play / pause', icon: <PlayIcon size={18} />, hint: 'Space', run: () => void togglePlay() },
      { id: 'act:next', group: 'Actions', label: 'Next song', keywords: 'skip', hint: 'Ctrl →', run: () => void nextTrack() },
      { id: 'act:prev', group: 'Actions', label: 'Previous song', keywords: 'back', hint: 'Ctrl ←', run: () => void previousTrack() },
      { id: 'act:shuffle', group: 'Actions', label: 'Shuffle on/off', run: () => void toggleShuffle() },
      { id: 'act:repeat', group: 'Actions', label: 'Repeat: next mode', keywords: 'loop', run: () => void cycleRepeat() },
      { id: 'act:like', group: 'Actions', label: 'Like / unlike this song', keywords: 'heart save', icon: <HeartIcon size={18} />, run: () => void toggleLike() },
      {
        id: 'act:np',
        group: 'Actions',
        label: 'Open Now Playing',
        keywords: 'lyrics full screen',
        run: () => {
          useApp.getState().setNowPlaying(true)
          close()
        }
      },
      {
        id: 'act:queue',
        group: 'Actions',
        label: 'Show queue',
        keywords: 'up next',
        run: () => {
          useApp.getState().setQueueOpen(true)
          close()
        }
      },
      { id: 'act:mini', group: 'Actions', label: 'Mini player', run: () => window.pulse.window.toggleMini() },
      ...[15, 30, 45, 60].map<Item>((m) => ({
        id: `sleep:${m}`,
        group: 'Sleep timer',
        label: `Stop music in ${m} minutes`,
        keywords: 'sleep timer night',
        icon: <MoonIcon size={18} />,
        run: () => setSleepTimer(m)
      })),
      {
        id: 'sleep:track',
        group: 'Sleep timer',
        label: 'Stop music at the end of this song',
        keywords: 'sleep timer night',
        icon: <MoonIcon size={18} />,
        run: () => setSleepTimer('track')
      },
      { id: 'sleep:off', group: 'Sleep timer', label: 'Turn the sleep timer off', keywords: 'sleep cancel', icon: <MoonIcon size={18} />, run: () => setSleepTimer(null) },
      { id: 'set:dark', group: 'Settings', label: 'Theme: Dark', keywords: 'appearance mode', run: set({ theme: 'dark' }, 'Dark theme') },
      { id: 'set:light', group: 'Settings', label: 'Theme: Light', keywords: 'appearance mode', run: set({ theme: 'light' }, 'Light theme') },
      { id: 'set:system', group: 'Settings', label: 'Theme: Match Windows', keywords: 'appearance mode system', run: set({ theme: 'system' }, 'Theme follows Windows') },
      {
        id: 'set:glass',
        group: 'Settings',
        label: `Glass: ${settings.glassQuality === 'full' ? 'switch to Lite' : 'switch to Full'}`,
        keywords: 'liquid refraction performance',
        run: set({ glassQuality: settings.glassQuality === 'full' ? 'lite' : 'full' }, 'Glass quality changed')
      },
      {
        id: 'set:compact',
        group: 'Settings',
        label: `Compact mode: ${settings.density === 'compact' ? 'off' : 'on'}`,
        keywords: 'density dense small spacing',
        run: set({ density: settings.density === 'compact' ? 'comfortable' : 'compact' }, settings.density === 'compact' ? 'Comfortable spacing' : 'Compact mode on')
      },
      {
        id: 'set:words',
        group: 'Settings',
        label: `Word-by-word lyrics: ${settings.wordLyrics ? 'off' : 'on'}`,
        keywords: 'karaoke apple music',
        run: set({ wordLyrics: !settings.wordLyrics }, settings.wordLyrics ? 'Line-by-line lyrics' : 'Word-by-word lyrics')
      },
      {
        id: 'set:fade',
        group: 'Settings',
        label: `Song transitions: ${settings.crossfade ? 'off' : 'on'}`,
        keywords: 'crossfade fade',
        run: set({ crossfade: !settings.crossfade }, settings.crossfade ? 'Transitions off' : 'Transitions on')
      },
      {
        id: 'set:motion',
        group: 'Settings',
        label: `Reduce motion: ${settings.reduceMotion ? 'off' : 'on'}`,
        keywords: 'animation accessibility',
        run: set({ reduceMotion: !settings.reduceMotion }, 'Motion setting changed')
      },
      ...FONTS.map<Item>((f) => ({
        id: `font:${f.id}`,
        group: 'Settings',
        label: `Font: ${f.label}`,
        keywords: 'typeface typography text',
        hint: settings.font === f.id ? 'Current' : undefined,
        run: set({ font: f.id }, `Font: ${f.label}`)
      })),
      ...playlists.map<Item>((p) => ({
        id: `pl:${p.id}`,
        group: 'Your playlists',
        label: p.name,
        sub: p.owner.id === me?.id ? sp.playlistSongs(p) : `By ${p.owner.display_name ?? 'Spotify'}`,
        keywords: 'playlist',
        image: sp.pickImage(p.images, 64),
        hint: 'Shift+Enter to play',
        run: go({ name: 'playlist', id: p.id })
      }))
    ]
    return items
  }, [navigate, settings, update, playlists, me, close])
}

function remoteItems(r: SearchResults, close: () => void): Item[] {
  const navigate = useApp.getState().navigate
  const out: Item[] = []
  const tracks = r.tracks?.items ?? []
  for (const t of tracks.slice(0, 6)) {
    out.push({
      id: `t:${t.id}`,
      group: 'Songs',
      label: t.name,
      sub: t.artists.map((a) => a.name).join(', '),
      image: sp.pickImage(t.album?.images, 64),
      hint: 'Enter to play',
      run: () => {
        void playUris(
          tracks.map((x) => x.uri),
          t.uri
        )
        close()
      }
    })
  }
  for (const a of (r.artists?.items ?? []).slice(0, 3)) {
    out.push({
      id: `a:${a.id}`,
      group: 'Artists',
      label: a.name,
      sub: 'Artist',
      image: sp.pickImage(a.images, 64),
      round: true,
      run: () => {
        navigate({ name: 'artist', id: a.id })
        close()
      }
    })
  }
  for (const a of (r.albums?.items ?? []).slice(0, 3)) {
    out.push({
      id: `al:${a.id}`,
      group: 'Albums',
      label: a.name,
      sub: a.artists.map((x) => x.name).join(', '),
      image: sp.pickImage(a.images, 64),
      run: () => {
        navigate({ name: 'album', id: a.id })
        close()
      }
    })
  }
  for (const p of (r.playlists?.items ?? []).filter(Boolean).slice(0, 3)) {
    out.push({
      id: `sp:${p!.id}`,
      group: 'Playlists',
      label: p!.name,
      sub: `By ${p!.owner.display_name ?? 'Spotify'}`,
      image: sp.pickImage(p!.images, 64),
      run: () => {
        navigate({ name: 'playlist', id: p!.id })
        close()
      }
    })
  }
  return out
}

export function CommandPalette(): React.JSX.Element {
  const open = useApp((s) => s.paletteOpen)
  const setOpen = useApp((s) => s.setPaletteOpen)
  const close = useMemo(() => () => setOpen(false), [setOpen])
  const [q, setQ] = useState('')
  const [remote, setRemote] = useState<Item[]>([])
  const [loading, setLoading] = useState(false)
  const [sel, setSel] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const staticItems = useStaticItems(close)
  const hasTrack = usePlayer((s) => !!s.track)

  // Ctrl+K / Ctrl+P anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K' || e.key === 'p')) {
        e.preventDefault()
        setOpen(!useApp.getState().paletteOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setOpen])

  useEffect(() => {
    if (open) {
      setQ('')
      setSel(0)
      setRemote([])
    }
  }, [open])

  // Spotify search, debounced.
  useEffect(() => {
    const query = q.trim()
    if (!open || query.length < 2 || query.startsWith('/')) {
      setRemote([])
      setLoading(false)
      return
    }
    setLoading(true)
    let alive = true
    const t = window.setTimeout(() => {
      sp.search(query)
        .then((r) => alive && setRemote(remoteItems(r, close)))
        .catch(() => alive && setRemote([]))
        .finally(() => alive && setLoading(false))
    }, 220)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [q, open, close])

  const results = useMemo(() => {
    const query = q.trim()
    // "/dj late night drive": a request for the AI DJ, straight from here
    const slash = /^\/(\w*)\s*(.*)$/.exec(query)
    if (slash) {
      const [, cmd, rest] = slash
      if ('dj'.startsWith(cmd.toLowerCase()) && cmd.length <= 2) {
        const prompt = cmd.toLowerCase() === 'dj' ? rest.trim() : ''
        return [
          {
            id: 'dj:ask',
            group: 'AI DJ',
            label: prompt ? `Ask the DJ for “${prompt}”` : 'Start the DJ',
            sub: prompt ? 'Plays it now, then keeps the show going' : 'Type what you want after /dj, or press Enter for a show picked for you',
            icon: <MicIcon size={18} />,
            hint: 'Enter',
            run: () => {
              void startDj(prompt)
              close()
            }
          }
        ] as Item[]
      }
      return []
    }
    const local = staticItems
      .map((it) => ({ it, s: score(it, query) }))
      .filter((x) => x.s > 0 && (hasTrack || !x.it.id.startsWith('act:') || x.it.id === 'act:recap'))
      .sort((a, b) => b.s - a.s)
      .map((x) => x.it)
    if (!query) {
      // Empty: a short, useful starting list.
      return [
        ...local.filter((i) => i.group === 'Go to').slice(0, 8),
        ...local.filter((i) => i.id === 'act:recap'),
        ...local.filter((i) => i.group === 'Your playlists').slice(0, 6)
      ]
    }
    const top = local.slice(0, 12)
    // Songs first when the query looks like music, app items first otherwise.
    const appFirst = top.length > 0 && score(top[0], query) >= 6
    return appFirst ? [...top, ...remote] : [...remote, ...top]
  }, [q, staticItems, remote, hasTrack])

  useEffect(() => {
    setSel(0)
  }, [q])

  useEffect(() => {
    listRef.current?.querySelector('.cmd__item.is-sel')?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const runItem = (it: Item, alt = false): void => {
    if (alt && it.id.startsWith('pl:')) {
      const p = useApp.getState().playlists.find((x) => `pl:${x.id}` === it.id)
      if (p) void playContext(p.uri)
      close()
      return
    }
    it.run()
    if (!it.id.startsWith('set:') && !it.id.startsWith('font:')) close()
  }

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min(results.length - 1, s + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(0, s - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const it = results[sel]
      if (it) runItem(it, e.shiftKey)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  let lastGroup = ''
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="cmd-layer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
          onMouseDown={(e) => e.target === e.currentTarget && close()}
        >
          <motion.div
            initial={{ opacity: 0, y: -16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 520, damping: 36 }}
          >
            <Glass radius={24} tone="thick" bezel={18} refraction={46} className="cmd">
              <div className="cmd__bar">
                <SearchIcon size={20} />
                <input
                  autoFocus
                  className="cmd__input"
                  placeholder="Search, or type /dj and what you want to hear"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={onKey}
                  spellCheck={false}
                />
                {loading && <span className="cmd__spin" />}
                <kbd>Esc</kbd>
              </div>
              <div className="cmd__list" ref={listRef} data-own-scroll>
                {results.length === 0 && !loading && <div className="cmd__empty">Nothing found for “{q}”</div>}
                {results.map((it, i) => {
                  const header = it.group !== lastGroup ? it.group : null
                  lastGroup = it.group
                  return (
                    <div key={it.id}>
                      {header && <div className="cmd__group">{header}</div>}
                      <button
                        className={`cmd__item ${i === sel ? 'is-sel' : ''}`}
                        onMouseMove={() => i !== sel && setSel(i)}
                        onClick={(e) => runItem(it, e.shiftKey)}
                      >
                        <span className="cmd__icon">
                          {it.image !== undefined ? <Cover src={it.image} size={36} radius={it.round ? 999 : 7} round={it.round} /> : (it.icon ?? <CommandIcon size={18} />)}
                        </span>
                        <span className="cmd__text">
                          <span className="cmd__label">{it.label}</span>
                          {it.sub && <span className="cmd__sub">{it.sub}</span>}
                        </span>
                        {it.hint && i === sel && <span className="cmd__hint">{it.hint}</span>}
                      </button>
                    </div>
                  )
                })}
              </div>
              <div className="cmd__foot">
                <span>
                  <kbd>↑</kbd>
                  <kbd>↓</kbd> to move
                </span>
                <span>
                  <kbd>Enter</kbd> to open
                </span>
                <span>
                  <kbd>Ctrl</kbd>
                  <kbd>K</kbd> anywhere
                </span>
              </div>
            </Glass>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
