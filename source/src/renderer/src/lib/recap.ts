// Listening summaries for the stats page, Recap stories and the profile.
// Local history (what Pulse Music saw you play) gives minutes, hours and play counts;
// Spotify's own top lists fill in while the local history is still short.
import * as sp from './spotify'
import { computeStats, startOfMonth, startOfYear, useHistory, type Stats } from './history'
import type { SArtist, STrack } from './types'

/** This month, this year, all time, or one month (`m:2026-10`). */
export type Period = 'month' | 'year' | 'all' | `m:${string}`

/** The `m:` period of the month that contains `t`. */
export const monthPeriod = (t: number | Date = new Date()): Period => {
  const d = new Date(t)
  return `m:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const monthOf = (p: Period): Date | null => {
  const m = /^m:(\d{4})-(\d{2})$/.exec(p)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, 1) : null
}
/** Where the period ends (exclusive). */
export const periodEnd = (p: Period): number => {
  const d = monthOf(p)
  return d ? new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() : Number.MAX_SAFE_INTEGER
}

export interface RecapArtist {
  id: string
  name: string
  image: string | null
  uri: string
  plays?: number
  minutes?: number
}

export interface RecapTrack {
  id: string
  uri: string
  name: string
  artist: string
  image: string | null
  plays?: number
  minutes?: number
}

export interface Recap {
  period: Period
  label: string
  /** Where the top lists came from. */
  source: 'history' | 'spotify'
  minutes: number
  plays: number
  artistCount: number
  songCount: number
  days: number
  streak: number
  topArtists: RecapArtist[]
  topTracks: RecapTrack[]
  topAlbum: { name: string; artist: string; image: string | null } | null
  hours: number[]
  weekdays: number[]
  /** Artists first heard in this period (history only). */
  newArtists: number
  stats: Stats
}

export const periodStart = (p: Period): number => {
  const d = monthOf(p)
  if (d) return d.getTime()
  return p === 'month' ? startOfMonth() : p === 'year' ? startOfYear() : 0
}

export function periodLabel(p: Period): string {
  const now = new Date()
  const d = monthOf(p)
  if (d) return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  if (p === 'month') return now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  if (p === 'year') return String(now.getFullYear())
  return 'All time'
}

const RANGE: Record<'month' | 'year' | 'all', sp.TimeRange> = { month: 'short_term', year: 'medium_term', all: 'long_term' }

const artistImages = new Map<string, Promise<SArtist | null>>()
function artistById(id: string): Promise<SArtist | null> {
  let p = artistImages.get(id)
  if (!p) {
    p = sp.getArtist(id).catch(() => null)
    artistImages.set(id, p)
  }
  return p
}

const fromSpotifyArtist = (a: SArtist): RecapArtist => ({
  id: a.id,
  name: a.name,
  image: sp.pickImage(a.images, 640),
  uri: a.uri
})
const fromSpotifyTrack = (t: STrack): RecapTrack => ({
  id: t.id,
  uri: t.uri,
  name: t.name,
  artist: t.artists.map((a) => a.name).join(', '),
  image: sp.pickImage(t.album?.images, 640)
})

/** Enough local plays to trust our own ranking. */
const ENOUGH = 25

export async function buildRecap(period: Period): Promise<Recap> {
  const plays = useHistory.getState().plays
  const from = periodStart(period)
  const to = periodEnd(period)
  const stats = computeStats(plays, from, to)
  // a past month: only what Pulse saw then counts (Spotify's ranges don't fit it)
  const pastMonth = period.startsWith('m:') && to <= Date.now()
  const before = new Set(plays.filter((p) => p.at < from).flatMap((p) => p.artists.map((a) => a.id)))
  const newArtists = from > 0 ? stats.artists.filter((a) => !before.has(a.item.id)).length : stats.artists.length

  let topArtists: RecapArtist[]
  let topTracks: RecapTrack[]
  let source: Recap['source'] = 'history'

  if (stats.plays >= ENOUGH || (pastMonth && stats.plays > 0)) {
    const ids = stats.artists.slice(0, 5)
    const full = await Promise.all(ids.map((a) => artistById(a.item.id)))
    topArtists = ids.map((a, i) => ({
      id: a.item.id,
      name: a.item.name,
      image: sp.pickImage(full[i]?.images, 640),
      uri: `spotify:artist:${a.item.id}`,
      plays: a.plays,
      minutes: Math.round(a.ms / 60_000)
    }))
    topTracks = stats.songs.slice(0, 5).map((s) => ({
      id: s.item.id,
      uri: `spotify:track:${s.item.id}`,
      name: s.item.name,
      artist: s.item.artists.map((a) => a.name).join(', '),
      image: s.item.art,
      plays: s.plays,
      minutes: Math.round(s.ms / 60_000)
    }))
  } else {
    source = 'spotify'
    const [a, t] = await Promise.all([
      sp.getTopArtists(RANGE[period.startsWith('m:') ? 'month' : (period as 'month' | 'year' | 'all')], 10).catch(() => null),
      sp.getTopTracks(RANGE[period.startsWith('m:') ? 'month' : (period as 'month' | 'year' | 'all')], 10).catch(() => null)
    ])
    topArtists = (a?.items ?? []).slice(0, 5).map(fromSpotifyArtist)
    topTracks = (t?.items ?? []).slice(0, 5).map(fromSpotifyTrack)
  }

  const album = stats.albums[0]
  return {
    period,
    label: periodLabel(period),
    source,
    minutes: Math.round(stats.ms / 60_000),
    plays: stats.plays,
    artistCount: stats.artists.length,
    songCount: stats.songs.length,
    days: stats.days,
    streak: stats.streak,
    topArtists,
    topTracks,
    topAlbum: album ? { name: album.item.name, artist: album.item.artist, image: album.item.art } : null,
    hours: stats.hours,
    weekdays: stats.weekdays,
    newArtists,
    stats
  }
}

/** A friendly name for when someone listens most. */
export function listenerType(hours: number[]): { title: string; text: string; peak: number } {
  const total = hours.reduce((a, b) => a + b, 0)
  const peak = hours.indexOf(Math.max(...hours))
  if (total === 0) return { title: 'Just getting started', text: 'Keep listening and your rhythm shows up here.', peak: 12 }
  const share = (a: number, b: number): number => hours.slice(a, b).reduce((x, y) => x + y, 0) / total
  if (share(22, 24) + share(0, 5) > 0.35) return { title: 'Night owl', text: 'Your music comes alive after dark.', peak }
  if (share(5, 10) > 0.35) return { title: 'Early bird', text: 'You start the day with the volume up.', peak }
  if (share(17, 22) > 0.4) return { title: 'Evening listener', text: 'Evenings are when you press play.', peak }
  if (share(10, 17) > 0.5) return { title: 'Daytime soundtracker', text: 'Music keeps your days moving.', peak }
  return { title: 'All-day listener', text: 'Morning, noon or night, something is playing.', peak }
}

export const hourLabel = (h: number): string =>
  new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' })

export function formatMinutes(min: number): string {
  if (min < 60) return `${min} min`
  const h = min / 60
  return h < 10 ? `${h.toFixed(1)} h` : `${Math.round(h).toLocaleString()} h`
}
