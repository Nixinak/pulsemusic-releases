// Small app-wide settings that don't belong to one page:
//  - Start page: Pulse can open on the page you were on last time (Settings → General),
//  - Song notifications: a Windows notification with the cover when the song changes while
//    Pulse isn't the window in front,
//  - Achievements: a toast when a new one is earned.
import type { Settings } from '@shared/types'
import { useApp, type Route } from './store'
import { usePlayer } from './player'
import { useHistory } from './history'
import { checkNewAchievements } from './achievements'

const LAST_ROUTE = 'pulse-last-route'
let restored = false
let started = false

/** Pages it makes no sense to open on (they need something that isn't there at start). */
const SKIP = new Set<Route['name']>(['settings', 'party', 'dj', 'discover'])

/** Called once the settings have loaded: opens the last page when that is wanted. */
export function restoreStartPage(s: Settings): void {
  if (restored) return
  restored = true
  if (s.startPage !== 'last') return
  try {
    const r = JSON.parse(localStorage.getItem(LAST_ROUTE) ?? 'null') as Route | null
    if (r && typeof r.name === 'string' && r.name !== 'home' && !SKIP.has(r.name)) useApp.getState().navigate(r)
  } catch {
    /* nothing saved */
  }
}

/** Remembers the page on screen and sends song notifications. Runs once for the app. */
export function startAppExtras(): () => void {
  if (started) return () => {}
  started = true
  const offRoute = useApp.subscribe((s, p) => {
    if (s.index === p.index && s.history === p.history) return
    const r = s.history[s.index]
    if (!r || SKIP.has(r.name)) return
    try {
      localStorage.setItem(LAST_ROUTE, JSON.stringify(r))
    } catch {
      /* storage full */
    }
  })

  let lastId: string | null = usePlayer.getState().track?.id ?? null
  let shown: Notification | null = null
  const offSong = usePlayer.subscribe((s) => {
    const t = s.track
    if (!t || t.id === lastId) return
    const first = lastId === null
    lastId = t.id
    if (first || !useApp.getState().settings.songNotifications) return
    if (document.hasFocus() || s.paused) return
    try {
      shown?.close()
      shown = new Notification(t.name, {
        body: t.artists.map((a) => a.name).join(', '),
        icon: t.artUrlSmall ?? t.artUrl ?? undefined,
        silent: true,
        tag: 'pulse-song'
      })
      shown.onclick = () => window.focus()
    } catch {
      /* notifications not available */
    }
  })
  // new achievements: once the history is there, then every 10 minutes
  const offHist = useHistory.subscribe((h, p) => {
    if (h.loaded && !p.loaded) window.setTimeout(checkNewAchievements, 8000)
  })
  if (useHistory.getState().loaded) window.setTimeout(checkNewAchievements, 8000)
  const achTimer = window.setInterval(checkNewAchievements, 10 * 60_000)
  return () => {
    offRoute()
    offSong()
    offHist()
    window.clearInterval(achTimer)
    started = false
  }
}
