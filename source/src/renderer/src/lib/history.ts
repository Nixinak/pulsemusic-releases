// Listening history: every song you actually listen to (30 s or half the song) is logged
// locally, on any device Pulse Music can see. It powers Recap and the profile stats.
import { create } from 'zustand'
import { usePlayer, type PlayerTrack } from './player'
import { getRecentlyPlayed, pickImage } from './spotify'

export interface Play {
  id: string
  name: string
  artists: { id: string; name: string }[]
  album: { id: string; name: string }
  art: string | null
  /** When the song started (epoch ms). */
  at: number
  /** How long it was actually listened to. */
  ms: number
  durationMs: number
}

interface HistoryState {
  plays: Play[]
  loaded: boolean
}

export const useHistory = create<HistoryState>(() => ({ plays: [], loaded: false }))

const MAX_PLAYS = 25_000
const MIN_LISTEN_MS = 30_000

let saveTimer: number | null = null
function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    saveTimer = null
    void window.pulse.store.set('history', { version: 1, plays: useHistory.getState().plays })
  }, 2000)
}

function add(plays: Play[]): void {
  if (plays.length === 0) return
  useHistory.setState((s) => {
    const all = [...s.plays, ...plays].sort((a, b) => a.at - b.at)
    return { plays: all.slice(-MAX_PLAYS) }
  })
  scheduleSave()
}

/** Pulls Spotify's last 50 plays in, so Recap has something to show from day one. */
async function importRecent(): Promise<void> {
  try {
    const page = await getRecentlyPlayed()
    const have = useHistory.getState().plays
    const fresh: Play[] = []
    for (const it of page.items) {
      const t = it.track
      const ended = Date.parse(it.played_at)
      const at = ended - t.duration_ms
      // Skip anything we already logged ourselves (same song within a few minutes).
      if (have.some((p) => p.id === t.id && Math.abs(p.at - at) < 6 * 60_000)) continue
      fresh.push({
        id: t.id,
        name: t.name,
        artists: t.artists.map((a) => ({ id: a.id, name: a.name })),
        album: { id: t.album?.id ?? '', name: t.album?.name ?? '' },
        art: pickImage(t.album?.images, 300),
        at,
        ms: t.duration_ms,
        durationMs: t.duration_ms
      })
    }
    add(fresh)
  } catch (e) {
    console.warn('[history] could not import recently played', e)
  }
}

/** Starts logging. Call once after sign-in; returns a stop function. */
export function startHistory(): () => void {
  let current: PlayerTrack | null = null
  let startedAt = 0
  let listened = 0
  let lastTick = performance.now()

  void window.pulse.store.get<{ plays: Play[] }>('history').then((d) => {
    useHistory.setState((s) => ({
      plays: [...(d?.plays ?? []), ...s.plays].sort((a, b) => a.at - b.at),
      loaded: true
    }))
    void importRecent()
  })

  const flush = (): void => {
    if (!current) return
    // Last.fm applies its own rules (half the song or 4 minutes) in the main process.
    window.pulse.lastfm?.scrobble({
      artist: current.artists[0]?.name ?? '',
      track: current.name,
      album: current.album.name || undefined,
      startedAt,
      durationMs: current.durationMs,
      listenedMs: Math.round(listened)
    })
    const enough = listened >= MIN_LISTEN_MS || listened >= current.durationMs * 0.5
    if (enough) {
      add([
        {
          id: current.id,
          name: current.name,
          artists: current.artists.map((a) => ({ id: a.id, name: a.name })),
          album: { id: current.album.id, name: current.album.name },
          art: current.artUrl,
          at: startedAt,
          ms: Math.round(Math.min(listened, current.durationMs)),
          durationMs: current.durationMs
        }
      ])
    }
  }

  // Count only time that is really playing.
  const tick = window.setInterval(() => {
    const now = performance.now()
    const dt = now - lastTick
    lastTick = now
    const s = usePlayer.getState()
    if (!s.paused && s.track && current && s.track.id === current.id && dt < 5000) listened += dt
  }, 1000)

  const unsub = usePlayer.subscribe((s, p) => {
    if (s.track?.id === p.track?.id) return
    flush()
    current = s.track
    startedAt = Date.now()
    listened = 0
    if (current) {
      window.pulse.lastfm?.nowPlaying({
        artist: current.artists[0]?.name ?? '',
        track: current.name,
        album: current.album.name || undefined,
        durationMs: current.durationMs
      })
    }
  })
  current = usePlayer.getState().track
  startedAt = Date.now()

  const onUnload = (): void => {
    flush()
    current = null
    void window.pulse.store.set('history', { version: 1, plays: useHistory.getState().plays })
  }
  window.addEventListener('beforeunload', onUnload)

  return () => {
    clearInterval(tick)
    unsub()
    window.removeEventListener('beforeunload', onUnload)
  }
}

/* ---------- Stats ---------- */

export interface Ranked<T> {
  item: T
  plays: number
  ms: number
}

export interface Stats {
  plays: number
  ms: number
  songs: Ranked<Play>[]
  artists: Ranked<{ id: string; name: string }>[]
  albums: Ranked<{ id: string; name: string; art: string | null; artist: string }>[]
  /** Minutes listened per hour of the day (0–23). */
  hours: number[]
  /** Minutes listened per weekday (0 = Monday). */
  weekdays: number[]
  /** Distinct days with listening. */
  days: number
  /** Longest run of consecutive days with listening. */
  streak: number
  firstAt: number | null
}

function rank<T>(map: Map<string, Ranked<T>>): Ranked<T>[] {
  return [...map.values()].sort((a, b) => b.ms - a.ms || b.plays - a.plays)
}

export function computeStats(plays: Play[], from = 0, to = Number.MAX_SAFE_INTEGER): Stats {
  const list = plays.filter((p) => p.at >= from && p.at < to)
  const songs = new Map<string, Ranked<Play>>()
  const artists = new Map<string, Ranked<{ id: string; name: string }>>()
  const albums = new Map<string, Ranked<{ id: string; name: string; art: string | null; artist: string }>>()
  const hours = new Array<number>(24).fill(0)
  const weekdays = new Array<number>(7).fill(0)
  const dayKeys = new Set<string>()
  let ms = 0
  for (const p of list) {
    ms += p.ms
    const song = songs.get(p.id) ?? { item: p, plays: 0, ms: 0 }
    song.plays++
    song.ms += p.ms
    songs.set(p.id, song)
    p.artists.forEach((a, i) => {
      const r = artists.get(a.id) ?? { item: a, plays: 0, ms: 0 }
      r.plays++
      // The main artist gets the full credit, featured artists a share.
      r.ms += i === 0 ? p.ms : p.ms * 0.35
      artists.set(a.id, r)
    })
    if (p.album.id) {
      const r = albums.get(p.album.id) ?? {
        item: { ...p.album, art: p.art, artist: p.artists[0]?.name ?? '' },
        plays: 0,
        ms: 0
      }
      r.plays++
      r.ms += p.ms
      albums.set(p.album.id, r)
    }
    const d = new Date(p.at)
    hours[d.getHours()] += p.ms / 60_000
    weekdays[(d.getDay() + 6) % 7] += p.ms / 60_000
    dayKeys.add(d.toDateString())
  }
  // Longest streak of consecutive days.
  const days = [...dayKeys].map((k) => new Date(k).getTime()).sort((a, b) => a - b)
  let streak = days.length ? 1 : 0
  let run = 1
  for (let i = 1; i < days.length; i++) {
    run = Math.round((days[i] - days[i - 1]) / 86_400_000) === 1 ? run + 1 : 1
    streak = Math.max(streak, run)
  }
  return {
    plays: list.length,
    ms,
    songs: rank(songs),
    artists: rank(artists),
    albums: rank(albums),
    hours,
    weekdays,
    days: dayKeys.size,
    streak,
    firstAt: list[0]?.at ?? null
  }
}

export const startOfMonth = (d = new Date()): number => new Date(d.getFullYear(), d.getMonth(), 1).getTime()
export const startOfYear = (d = new Date()): number => new Date(d.getFullYear(), 0, 1).getTime()
