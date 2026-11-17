// Listening summaries for the stats page, Recap stories and the profile.
// Local history (what Pulse Music saw you play) gives minutes, hours and play counts;
// Spotify's own top lists fill in while the local history is still short.
import * as sp from './spotify'
import { artistKey, computeStats, isRealId, startOfMonth, startOfYear, useHistory, type Stats } from './history'
import { artistPicture, songPicture } from './imageFill'
import type { SArtist, STrack } from './types'

/** This month, this year, all time, one month (`m:2026-10`) or one whole year (`y:2025`). */
export type Period = 'month' | 'year' | 'all' | `m:${string}` | `y:${string}`

/** The `m:` period of the month that contains `t`. */
export const monthPeriod = (t: number | Date = new Date()): Period => {
  const d = new Date(t)
  return `m:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const monthOf = (p: Period): Date | null => {
  const m = /^m:(\d{4})-(\d{2})$/.exec(p)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, 1) : null
}
/** The `y:` period of a whole year. */
export const yearPeriod = (year: number): Period => `y:${year}`
const yearOf = (p: Period): number | null => {
  const m = /^y:(\d{4})$/.exec(p)
  return m ? Number(m[1]) : null
}
/** Where the period ends (exclusive). */
export const periodEnd = (p: Period): number => {
  const d = monthOf(p)
  if (d) return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()
  const y = yearOf(p)
  return y !== null ? new Date(y + 1, 0, 1).getTime() : Number.MAX_SAFE_INTEGER
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
  const y = yearOf(p)
  if (y !== null) return new Date(y, 0, 1).getTime()
  return p === 'month' ? startOfMonth() : p === 'year' ? startOfYear() : 0
}

export function periodLabel(p: Period): string {
  const now = new Date()
  const d = monthOf(p)
  if (d) return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const y = yearOf(p)
  if (y !== null) return String(y)
  if (p === 'month')
    return now.toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric'
    })
  if (p === 'year') return String(now.getFullYear())
  return 'All time'
}

const RANGE: Record<'month' | 'year' | 'all', sp.TimeRange> = {
  month: 'short_term',
  year: 'medium_term',
  all: 'long_term'
}

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

/** A promise that gives up after `ms` (with `fallback`), so a slow or limited Spotify never holds Recap. */
const within = <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))])

/**
 * The Recap for a period. It comes back at once from the listening history (it never waits for
 * Spotify longer than a moment); pictures that still have to be looked up arrive afterwards
 * through `onPictures` with the same Recap, filled in.
 */
export async function buildRecap(period: Period, onPictures?: (r: Recap) => void): Promise<Recap> {
  const plays = useHistory.getState().plays
  const from = periodStart(period)
  const to = periodEnd(period)
  const stats = computeStats(plays, from, to)
  // a month or a whole year: only the history counts (Spotify's ranges don't fit it)
  const pastMonth = (period.startsWith('m:') || period.startsWith('y:')) && (to <= Date.now() || period.startsWith('y:'))
  const before = new Set(plays.filter((p) => p.at < from).flatMap((p) => p.artists.map(artistKey)))
  const newArtists = from > 0 ? stats.artists.filter((a) => !before.has(artistKey(a.item))).length : stats.artists.length

  let topArtists: RecapArtist[] = []
  let topTracks: RecapTrack[] = []
  let source: Recap['source'] = 'history'
  const fromHistory = (): void => {
    topArtists = stats.artists.slice(0, 5).map((a) => ({
      id: a.item.id,
      name: a.item.name,
      image: null,
      uri: isRealId(a.item.id) ? `spotify:artist:${a.item.id}` : '',
      plays: a.plays,
      minutes: Math.round(a.ms / 60_000)
    }))
    topTracks = stats.songs.slice(0, 5).map((x) => ({
      id: x.item.id,
      uri: isRealId(x.item.id) ? `spotify:track:${x.item.id}` : '',
      name: x.item.name,
      artist: x.item.artists.map((a) => a.name).join(', '),
      image: x.item.art ?? null,
      plays: x.plays,
      minutes: Math.round(x.ms / 60_000)
    }))
  }

  if (stats.plays >= ENOUGH || (pastMonth && stats.plays > 0)) fromHistory()
  else {
    const range = RANGE[period.startsWith('m:') ? 'month' : period.startsWith('y:') ? 'year' : (period as 'month' | 'year' | 'all')]
    const [a, t] = await Promise.all([within(sp.getTopArtists(range, 10), 3500, null), within(sp.getTopTracks(range, 10), 3500, null)])
    if (a?.items?.length || t?.items?.length) {
      source = 'spotify'
      topArtists = (a?.items ?? []).slice(0, 5).map(fromSpotifyArtist)
      topTracks = (t?.items ?? []).slice(0, 5).map(fromSpotifyTrack)
    } else fromHistory()
  }

  const album = stats.albums[0]
  const recap: Recap = {
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
    topAlbum: album
      ? {
          name: album.item.name,
          artist: album.item.artist,
          image: album.item.art ?? topTracks.find((t) => t.image)?.image ?? null
        }
      : null,
    hours: stats.hours,
    weekdays: stats.weekdays,
    newArtists,
    stats
  }

  // pictures: whatever is found within a moment goes in now, the rest follows
  const missingArtists = topArtists.map((a, i) => (a.image ? null : { a, i })).filter((x): x is { a: RecapArtist; i: number } => !!x)
  const missingTracks = topTracks.map((t, i) => (t.image ? null : { t, i })).filter((x): x is { t: RecapTrack; i: number } => !!x)
  if (!missingArtists.length && !missingTracks.length) return recap
  const lookups = Promise.all([
    Promise.all(
      missingArtists.map(({ a }) =>
        (isRealId(a.id) ? artistById(a.id).then((f) => sp.pickImage(f?.images, 640) ?? null) : Promise.resolve(null))
          .then((u) => u ?? artistPicture(a.name, a.id, true))
          .catch(() => null)
      )
    ),
    Promise.all(missingTracks.map(({ t }) => songPicture(t.name, t.artist.split(', ')[0] ?? '', t.id, true).catch(() => null)))
  ])
  const fill = ([ap, tp]: [(string | null)[], (string | null)[]]): Recap => {
    const next = {
      ...recap,
      topArtists: recap.topArtists.slice(),
      topTracks: recap.topTracks.slice()
    }
    missingArtists.forEach(({ a, i }, k) => (next.topArtists[i] = { ...a, image: ap[k] ?? null }))
    missingTracks.forEach(({ t, i }, k) => (next.topTracks[i] = { ...t, image: tp[k] ?? null }))
    if (next.topAlbum && !next.topAlbum.image)
      next.topAlbum = {
        ...next.topAlbum,
        image: next.topTracks.find((t) => t.image)?.image ?? null
      }
    return next
  }
  const quick = await within(lookups, 1200, null)
  if (quick) return fill(quick)
  void lookups.then((r) => onPictures?.(fill(r)))
  return recap
}

/** A friendly name for when someone listens most. */
export function listenerType(hours: number[]): {
  title: string
  text: string
  peak: number
} {
  const total = hours.reduce((a, b) => a + b, 0)
  const peak = hours.indexOf(Math.max(...hours))
  if (total === 0)
    return {
      title: 'Just getting started',
      text: 'Keep listening and your rhythm shows up here.',
      peak: 12
    }
  const share = (a: number, b: number): number => hours.slice(a, b).reduce((x, y) => x + y, 0) / total
  if (share(22, 24) + share(0, 5) > 0.35)
    return {
      title: 'Night owl',
      text: 'Your music comes alive after dark.',
      peak
    }
  if (share(5, 10) > 0.35)
    return {
      title: 'Early bird',
      text: 'You start the day with the volume up.',
      peak
    }
  if (share(17, 22) > 0.4)
    return {
      title: 'Evening listener',
      text: 'Evenings are when you press play.',
      peak
    }
  if (share(10, 17) > 0.5)
    return {
      title: 'Daytime soundtracker',
      text: 'Music keeps your days moving.',
      peak
    }
  return {
    title: 'All-day listener',
    text: 'Morning, noon or night, something is playing.',
    peak
  }
}

export const hourLabel = (h: number): string => new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' })

export function formatMinutes(min: number): string {
  if (min < 60) return `${min} min`
  const h = min / 60
  return h < 10 ? `${h.toFixed(1)} h` : `${Math.round(h).toLocaleString()} h`
}
