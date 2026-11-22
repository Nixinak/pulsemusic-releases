// Achievements: 1,000 goals worked out from everything you've listened to on Spotify (the
// Spotify data download you imported plus what Pulse has seen since) and from your Spotify
// library. Most come as ladders: one goal that gets harder step by step, up to levels almost
// nobody reaches.
//
// Each goal says how rare it is among Spotify listeners. Spotify doesn't publish who earned
// what, so the share is an estimate: for each measure, a typical Spotify listener and a top-1%
// listener are pinned to Spotify's public figures (Wrapped and listening-time studies), and the
// share in between follows the usual long-tailed spread of listening habits.
import { artistKey, songKey, useHistory, type Play } from './history'
import { useApp } from './store'

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic'
export const RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic']
export const RARITY_NAME: Record<Rarity, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
  mythic: 'Mythic'
}

export type Category = 'time' | 'variety' | 'devotion' | 'habits' | 'library' | 'artists' | 'moments'
export const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'time', label: 'Listening time' },
  { id: 'variety', label: 'Variety' },
  { id: 'devotion', label: 'Devotion' },
  { id: 'habits', label: 'Habits' },
  { id: 'library', label: 'Library' },
  { id: 'artists', label: 'Your artists' },
  { id: 'moments', label: 'Moments' }
]

export interface Tier {
  /** Stable id, for remembering what was already announced. */
  key: string
  goal: number
  done: boolean
  /** Estimated share of Spotify listeners who reached it (0–1). */
  share: number
  rarity: Rarity
}

export interface Ladder {
  id: string
  cat: Category
  title: string
  icon: string
  /** What a goal asks for: "Listen 40,000 minutes in one calendar year". */
  ask: (goal: number) => string
  value: number
  tiers: Tier[]
  /** How many tiers are reached. */
  reached: number
  /** The next tier to aim for, if any is left. */
  next: Tier | null
  /** 0–1 towards the next tier. */
  progress: number
  /** A cover or photo for "Your artists". */
  art?: string | null
}

export interface Board {
  ladders: Ladder[]
  total: number
  earned: number
  rarest: { ladder: Ladder; tier: Tier } | null
  byRarity: Record<Rarity, { earned: number; total: number }>
}

/** What the library goals need (from Spotify; null while unknown). */
export interface LibraryCounts {
  saved: number
  albums: number
  following: number
  playlists: number
  playlistSongs: number
}

/* ---------- Rarity ---------- */

/** Standard normal cumulative distribution (Abramowitz–Stegun, accurate to 1e-7). */
function phi(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const d = 0.3989423 * Math.exp((-x * x) / 2)
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  return x > 0 ? 1 - p : p
}
/** Share of listeners at or above `goal`, given the typical listener and the top-1% listener. */
const shareAbove = (goal: number, [typical, top1]: [number, number]): number => {
  const sigma = Math.log(top1 / typical) / 2.3263
  return 1 - phi((Math.log(Math.max(goal, 1e-9)) - Math.log(typical)) / sigma)
}
export const rarityOf = (share: number): Rarity =>
  share > 0.4 ? 'common' : share > 0.15 ? 'uncommon' : share > 0.05 ? 'rare' : share > 0.01 ? 'epic' : share > 0.001 ? 'legendary' : 'mythic'

/** "Top 0.4% of Spotify listeners" / "38% of Spotify listeners". */
export function shareText(share: number): string {
  if (share >= 0.5) return `${Math.round(share * 100)}% of Spotify listeners`
  const pct = share * 100
  const shown = pct >= 10 ? Math.round(pct) : pct >= 1 ? Math.round(pct * 10) / 10 : Math.max(0.0001, Number(pct.toPrecision(pct >= 0.01 ? 2 : 1)))
  return `Top ${shown}% of Spotify listeners`
}

/** How far up an artist's listeners you are, from your minutes with them over `days`. A typical
 *  listener of an artist plays about 40 minutes of them a year and the top 1% about 2,500 (the
 *  same long-tailed spread as the goals above), scaled to the time span. */
export function fanShare(minutes: number, days: number): number {
  const years = Math.max(7, days) / 365
  return Math.min(0.99, Math.max(1e-5, shareAbove(minutes, [Math.max(0.5, 40 * years), Math.max(8, 2500 * years)])))
}

/** "Top 0.4%" / "Top 12%". */
export function topPercent(share: number): string {
  const pct = share * 100
  const shown = pct >= 10 ? Math.round(pct) : pct >= 1 ? Math.round(pct * 10) / 10 : Number(pct.toPrecision(2))
  return `Top ${shown}%`
}

/* ---------- Goals ---------- */

const fmt = (n: number): string => Math.floor(n).toLocaleString('en-US')
const NICE = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10]
const nice = (x: number): number => {
  if (x < 10) return Math.round(x)
  const mag = 10 ** Math.floor(Math.log10(x))
  const r = x / mag
  const best = NICE.reduce((a, b) => (Math.abs(b - r) < Math.abs(a - r) ? b : a))
  return Math.round(best * mag)
}
/** `n` goals from `from` to `to`: evenly spread for small ranges, otherwise step by step bigger. */
function goals(from: number, to: number, n: number): number[] {
  const out: number[] = []
  if (to - from + 1 <= n * 1.5) {
    for (let i = 0; i < n; i++) out.push(Math.round(from + ((to - from) * i) / Math.max(1, n - 1)))
  } else {
    for (let i = 0; i < n; i++) out.push(nice(from * (to / from) ** (i / Math.max(1, n - 1))))
  }
  // strictly rising
  for (let i = 1; i < out.length; i++) if (out[i] <= out[i - 1]) out[i] = out[i - 1] + 1
  out[out.length - 1] = Math.max(out[out.length - 1], to)
  return out
}

interface Family {
  id: string
  cat: Category
  title: string
  icon: string
  ask: (g: number) => string
  metric: keyof Measures
  range: [number, number]
  n: number
  /** The typical Spotify listener, and the top-1% one. */
  model: [number, number]
}

const FAMILIES: Family[] = [
  // listening time
  {
    id: 'year-min',
    cat: 'time',
    title: 'Year in minutes',
    icon: '🗓️',
    ask: (g) => `Listen ${fmt(g)} minutes in one calendar year`,
    metric: 'yearMinutes',
    range: [2000, 500_000],
    n: 30,
    model: [12_000, 110_000]
  },
  {
    id: 'month-min',
    cat: 'time',
    title: 'Month of music',
    icon: '📆',
    ask: (g) => `Listen ${fmt(g)} minutes in one month`,
    metric: 'monthMinutes',
    range: [300, 43_000],
    n: 26,
    model: [1000, 11_000]
  },
  {
    id: 'week-min',
    cat: 'time',
    title: 'Big week',
    icon: '📅',
    ask: (g) => `Listen ${fmt(g)} minutes in one week`,
    metric: 'weekMinutes',
    range: [100, 10_000],
    n: 22,
    model: [250, 2600]
  },
  {
    id: 'day-min',
    cat: 'time',
    title: 'Marathon',
    icon: '🏃',
    ask: (g) => `Listen ${fmt(g)} minutes in one day`,
    metric: 'dayMinutes',
    range: [60, 1380],
    n: 20,
    model: [240, 900]
  },
  {
    id: 'hours',
    cat: 'time',
    title: 'Time well spent',
    icon: '⏳',
    ask: (g) => `Listen ${fmt(g)} hours in total`,
    metric: 'hours',
    range: [10, 25_000],
    n: 25,
    model: [500, 7000]
  },
  {
    id: 'plays',
    cat: 'time',
    title: 'Heavy rotation',
    icon: '🎧',
    ask: (g) => `Play ${fmt(g)} songs`,
    metric: 'plays',
    range: [100, 400_000],
    n: 26,
    model: [8000, 120_000]
  },
  {
    id: 'big-days',
    cat: 'time',
    title: 'Long days',
    icon: '🌞',
    ask: (g) => `Listen 8 hours or more on ${fmt(g)} ${g === 1 ? 'day' : 'days'}`,
    metric: 'bigDays',
    range: [1, 600],
    n: 20,
    model: [3, 150]
  },
  {
    id: 'session',
    cat: 'time',
    title: 'Unbroken',
    icon: '🔗',
    ask: (g) => `Listen ${g} ${g === 1 ? 'hour' : 'hours'} without a break of 10 minutes`,
    metric: 'session',
    range: [1, 24],
    n: 18,
    model: [3, 14]
  },
  {
    id: 'active-days',
    cat: 'time',
    title: 'Regular',
    icon: '✅',
    ask: (g) => `Listen on ${fmt(g)} different days`,
    metric: 'activeDays',
    range: [10, 5000],
    n: 26,
    model: [500, 3000]
  },
  {
    id: 'streak',
    cat: 'time',
    title: 'On a roll',
    icon: '🔥',
    ask: (g) => `Listen ${fmt(g)} days in a row`,
    metric: 'streak',
    range: [3, 2500],
    n: 26,
    model: [25, 700]
  },
  {
    id: 'years',
    cat: 'time',
    title: 'Long haul',
    icon: '🕰️',
    ask: (g) => `Listen in ${g} different ${g === 1 ? 'year' : 'years'}`,
    metric: 'years',
    range: [1, 15],
    n: 15,
    model: [3, 11]
  },
  // variety
  {
    id: 'year-artists',
    cat: 'variety',
    title: 'Wide ears',
    icon: '🌍',
    ask: (g) => `Hear ${fmt(g)} artists in one calendar year`,
    metric: 'yearArtists',
    range: [50, 15_000],
    n: 26,
    model: [500, 5000]
  },
  {
    id: 'year-songs',
    cat: 'variety',
    title: 'Deep crate',
    icon: '💿',
    ask: (g) => `Hear ${fmt(g)} different songs in one calendar year`,
    metric: 'yearSongs',
    range: [100, 30_000],
    n: 26,
    model: [1000, 10_000]
  },
  {
    id: 'artists',
    cat: 'variety',
    title: 'World tour',
    icon: '🧳',
    ask: (g) => `Hear ${fmt(g)} different artists`,
    metric: 'artists',
    range: [100, 60_000],
    n: 28,
    model: [1500, 20_000]
  },
  {
    id: 'songs',
    cat: 'variety',
    title: 'Endless shelf',
    icon: '📚',
    ask: (g) => `Hear ${fmt(g)} different songs`,
    metric: 'songs',
    range: [200, 150_000],
    n: 28,
    model: [3000, 45_000]
  },
  {
    id: 'albums',
    cat: 'variety',
    title: 'Album hopper',
    icon: '💽',
    ask: (g) => `Hear songs from ${fmt(g)} different albums`,
    metric: 'albums',
    range: [50, 60_000],
    n: 24,
    model: [1200, 18_000]
  },
  {
    id: 'new-month',
    cat: 'variety',
    title: 'Explorer',
    icon: '🧭',
    ask: (g) => `Find ${fmt(g)} new artists in one month`,
    metric: 'newMonth',
    range: [5, 1500],
    n: 22,
    model: [25, 300]
  },
  {
    id: 'clock',
    cat: 'variety',
    title: 'Round the clock',
    icon: '🕛',
    ask: (g) => `Play 100 songs or more in each of ${g} hours of the day`,
    metric: 'hoursCovered',
    range: [2, 24],
    n: 12,
    model: [10, 22]
  },
  // devotion
  {
    id: 'loyal',
    cat: 'devotion',
    title: 'Superfan',
    icon: '💜',
    ask: (g) => `Play one artist ${fmt(g)} times`,
    metric: 'loyal',
    range: [50, 60_000],
    n: 26,
    model: [300, 6000]
  },
  {
    id: 'artist-year',
    cat: 'devotion',
    title: 'Fan of the year',
    icon: '🏅',
    ask: (g) => `Listen to one artist for ${fmt(g)} minutes in one year`,
    metric: 'artistYear',
    range: [60, 60_000],
    n: 24,
    model: [300, 6000]
  },
  {
    id: 'song-plays',
    cat: 'devotion',
    title: 'Can’t let go',
    icon: '🫶',
    ask: (g) => `Play one song ${fmt(g)} times`,
    metric: 'songPlays',
    range: [20, 5000],
    n: 22,
    model: [60, 1000]
  },
  {
    id: 'repeat-day',
    cat: 'devotion',
    title: 'Stuck on it',
    icon: '🔁',
    ask: (g) => `Play one song ${g} times in one day`,
    metric: 'repeatDay',
    range: [3, 150],
    n: 18,
    model: [5, 50]
  },
  {
    id: 'in-a-row',
    cat: 'devotion',
    title: 'Replay button',
    icon: '⏮️',
    ask: (g) => `Play the same song ${g} times in a row`,
    metric: 'inARow',
    range: [2, 200],
    n: 18,
    model: [3, 40]
  },
  {
    id: 'inner-circle',
    cat: 'devotion',
    title: 'Inner circle',
    icon: '⭕',
    ask: (g) => `Play ${fmt(g)} ${g === 1 ? 'artist' : 'artists'} 100 times or more`,
    metric: 'heavyArtists',
    range: [1, 500],
    n: 20,
    model: [5, 150]
  },
  {
    id: 'hall-of-fame',
    cat: 'devotion',
    title: 'Hall of fame',
    icon: '🏛️',
    ask: (g) => `Play ${fmt(g)} ${g === 1 ? 'song' : 'songs'} 50 times or more`,
    metric: 'heavySongs',
    range: [1, 2000],
    n: 20,
    model: [10, 400]
  },
  {
    id: 'comeback',
    cat: 'devotion',
    title: 'Comeback',
    icon: '↩️',
    ask: (g) => `Return to ${fmt(g)} ${g === 1 ? 'song' : 'songs'} after a year without it`,
    metric: 'comeback',
    range: [1, 2000],
    n: 18,
    model: [20, 800]
  },
  // habits
  {
    id: 'night',
    cat: 'habits',
    title: 'Night owl',
    icon: '🦉',
    ask: (g) => `Play ${fmt(g)} songs between midnight and 4 AM`,
    metric: 'night',
    range: [10, 60_000],
    n: 24,
    model: [150, 8000]
  },
  {
    id: 'morning',
    cat: 'habits',
    title: 'Early bird',
    icon: '🌅',
    ask: (g) => `Play ${fmt(g)} songs between 5 and 8 AM`,
    metric: 'morning',
    range: [10, 40_000],
    n: 22,
    model: [150, 6000]
  },
  {
    id: 'weekend',
    cat: 'habits',
    title: 'Weekend warrior',
    icon: '🎉',
    ask: (g) => `Play ${fmt(g)} songs on weekends`,
    metric: 'weekend',
    range: [50, 150_000],
    n: 24,
    model: [2500, 40_000]
  },
  {
    id: 'full',
    cat: 'habits',
    title: 'Completionist',
    icon: '🎯',
    ask: (g) => `Hear ${fmt(g)} songs all the way to the end`,
    metric: 'full',
    range: [100, 300_000],
    n: 24,
    model: [5000, 90_000]
  },
  // library
  {
    id: 'saved',
    cat: 'library',
    title: 'Collector',
    icon: '❤️',
    ask: (g) => `Have ${fmt(g)} liked songs`,
    metric: 'saved',
    range: [25, 15_000],
    n: 24,
    model: [400, 8000]
  },
  {
    id: 'shelf',
    cat: 'library',
    title: 'Shelf',
    icon: '🗄️',
    ask: (g) => `Save ${fmt(g)} albums`,
    metric: 'savedAlbums',
    range: [5, 3000],
    n: 18,
    model: [15, 600]
  },
  {
    id: 'following',
    cat: 'library',
    title: 'Following',
    icon: '👣',
    ask: (g) => `Follow ${fmt(g)} artists`,
    metric: 'following',
    range: [5, 5000],
    n: 20,
    model: [25, 1500]
  },
  {
    id: 'curator',
    cat: 'library',
    title: 'Curator',
    icon: '🎛️',
    ask: (g) => `Make ${fmt(g)} ${g === 1 ? 'playlist' : 'playlists'}`,
    metric: 'playlists',
    range: [1, 1000],
    n: 20,
    model: [8, 250]
  },
  {
    id: 'builder',
    cat: 'library',
    title: 'Playlist builder',
    icon: '🧱',
    ask: (g) => `Put ${fmt(g)} songs in your own playlists`,
    metric: 'playlistSongs',
    range: [50, 50_000],
    n: 22,
    model: [300, 10_000]
  }
]

/** Your top artists each get a ladder (Spotify's "top % of listeners" for one artist). */
const ARTIST_SLOTS = 20
const ARTIST_GOALS = [60, 150, 300, 600, 1000, 2000, 3500, 6000, 10_000, 20_000]
const ARTIST_MODEL: [number, number] = [60, 3000]

/** One-off moments, with a fixed share of Spotify listeners who'd have one. */
const MOMENTS: { id: string; title: string; icon: string; ask: string; metric: keyof Measures; share: number }[] = [
  { id: 'new-year', title: 'First song of the year', icon: '🎆', ask: 'Play a song in the first ten minutes of a new year', metric: 'newYear', share: 0.04 },
  { id: 'nye', title: 'Last song of the year', icon: '🥂', ask: 'Play a song in the last hour of December 31', metric: 'nye', share: 0.12 },
  { id: 'xmas', title: 'Silent night', icon: '🎄', ask: 'Listen on Christmas Eve', metric: 'xmas', share: 0.45 },
  { id: 'halloween', title: 'Spooky season', icon: '🎃', ask: 'Listen on Halloween', metric: 'halloween', share: 0.5 },
  { id: 'valentine', title: 'Love songs', icon: '💌', ask: 'Listen on Valentine’s Day', metric: 'valentine', share: 0.5 },
  { id: 'leap', title: 'Leap day', icon: '🐸', ask: 'Listen on February 29', metric: 'leap', share: 0.08 },
  { id: 'friday13', title: 'Unlucky day', icon: '🐈‍⬛', ask: 'Listen on a Friday the 13th', metric: 'friday13', share: 0.3 },
  { id: 'sunrise', title: 'Before sunrise', icon: '🌄', ask: 'Start a song between 4 and 5 AM', metric: 'sunrise', share: 0.2 },
  { id: 'all-nighter', title: 'All-nighter', icon: '🌙', ask: 'Listen 4 hours between midnight and 6 AM in one night', metric: 'allNighter', share: 0.02 },
  { id: 'full-day', title: 'Twenty-four seven', icon: '🔄', ask: 'Play songs in every hour of one day', metric: 'fullDay', share: 0.002 },
  { id: 'double-century', title: 'Double century', icon: '💯', ask: 'Play 200 songs in one day', metric: 'doubleCentury', share: 0.006 },
  { id: 'every-day-month', title: 'Perfect month', icon: '🗓️', ask: 'Listen on every day of a calendar month', metric: 'perfectMonth', share: 0.25 },
  { id: 'every-day-year', title: 'Perfect year', icon: '🏆', ask: 'Listen on every day of a calendar year', metric: 'perfectYear', share: 0.008 },
  { id: 'decade', title: 'Ten years in', icon: '🎂', ask: 'Have ten years between your first and latest song', metric: 'decade', share: 0.06 },
  { id: 'imported', title: 'Whole story', icon: '📦', ask: 'Bring your Spotify data download into Pulse', metric: 'imported', share: 0.03 },
  { id: 'week-loop', title: 'Song of the week', icon: '📻', ask: 'Play the same song every day for seven days', metric: 'weekLoop', share: 0.05 }
]

/* ---------- Measuring ---------- */

interface Measures {
  yearMinutes: number
  monthMinutes: number
  weekMinutes: number
  dayMinutes: number
  hours: number
  plays: number
  bigDays: number
  session: number
  activeDays: number
  streak: number
  years: number
  yearArtists: number
  yearSongs: number
  artists: number
  songs: number
  albums: number
  newMonth: number
  hoursCovered: number
  loyal: number
  artistYear: number
  songPlays: number
  repeatDay: number
  inARow: number
  heavyArtists: number
  heavySongs: number
  comeback: number
  night: number
  morning: number
  weekend: number
  full: number
  saved: number
  savedAlbums: number
  following: number
  playlists: number
  playlistSongs: number
  newYear: number
  nye: number
  xmas: number
  halloween: number
  valentine: number
  leap: number
  friday13: number
  sunrise: number
  allNighter: number
  fullDay: number
  doubleCentury: number
  perfectMonth: number
  perfectYear: number
  decade: number
  imported: number
  weekLoop: number
}

const DAY = 86_400_000
const dayStart = (t: number): number => {
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}
const nextDay = (s: number): number => {
  const d = new Date(s)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
}
const maxOf = (it: Iterable<number>): number => {
  let m = 0
  for (const v of it) if (v > m) m = v
  return m
}
const bump = <K>(m: Map<K, number>, k: K, by = 1): void => void m.set(k, (m.get(k) ?? 0) + by)
const daysIn = (y: number, m: number): number => new Date(y, m + 1, 0).getDate()

/** Everything the goals need, in one pass over the history (oldest first). */
function measure(all: Play[], lib: LibraryCounts | null, imported: boolean): Measures {
  const plays = all.filter((p) => p.ms >= 30_000).sort((a, b) => a.at - b.at)
  const yearMin = new Map<number, number>()
  const monthMin = new Map<string, number>()
  const weekMin = new Map<number, number>()
  const dayMin = new Map<number, number>()
  const dayPlays = new Map<number, number>()
  const dayHours = new Map<number, Set<number>>()
  const nightMin = new Map<number, number>()
  const yearArtists = new Map<number, Set<string>>()
  const yearSongs = new Map<number, Set<string>>()
  const artistPlays = new Map<string, number>()
  const artistYear = new Map<string, number>()
  const songPlays = new Map<string, number>()
  const songDay = new Map<string, number>()
  const songLast = new Map<string, number>()
  const songRun = new Map<string, { day: number; run: number }>()
  let weekLoop = 0
  const albums = new Set<string>()
  const firstSeen = new Set<string>()
  const newPerMonth = new Map<string, number>()
  const hourPlays = new Map<number, number>()
  const monthDays = new Map<string, Set<number>>()
  const yearDays = new Map<number, Set<number>>()
  const m: Partial<Measures> = {}
  let night = 0
  let morning = 0
  let weekend = 0
  let full = 0
  let comeback = 0
  let inARow = 0
  let run = 0
  let prevSong = ''
  let session = 0
  let bestSession = 0
  let prevEnd = 0
  const flags = { newYear: 0, nye: 0, xmas: 0, halloween: 0, valentine: 0, leap: 0, friday13: 0, sunrise: 0 }
  for (const p of plays) {
    const d = new Date(p.at)
    const y = d.getFullYear()
    const mo = d.getMonth()
    const date = d.getDate()
    const h = d.getHours()
    const min = p.ms / 60_000
    const day = dayStart(p.at)
    const sk = songKey(p)
    bump(yearMin, y, min)
    bump(monthMin, `${y}-${mo}`, min)
    // weeks start on Monday
    bump(weekMin, Math.floor((day + 4 * DAY) / (7 * DAY)), min)
    bump(dayMin, day, min)
    bump(dayPlays, day)
    if (!dayHours.has(day)) dayHours.set(day, new Set())
    dayHours.get(day)!.add(h)
    if (h < 6) bump(nightMin, day, min)
    if (!yearSongs.has(y)) yearSongs.set(y, new Set())
    yearSongs.get(y)!.add(sk)
    if (!yearArtists.has(y)) yearArtists.set(y, new Set())
    for (const a of p.artists) {
      const ak = artistKey(a)
      yearArtists.get(y)!.add(ak)
      bump(artistPlays, ak)
      bump(artistYear, `${y}|${ak}`, min)
      if (!firstSeen.has(ak)) {
        firstSeen.add(ak)
        bump(newPerMonth, `${y}-${mo}`)
      }
    }
    if (p.album?.name) albums.add(`${p.album.name.toLowerCase()}|${(p.artists[0]?.name ?? '').toLowerCase()}`)
    bump(songPlays, sk)
    bump(songDay, `${day}|${sk}`)
    const last = songLast.get(sk)
    if (last && p.at - last > 365 * DAY) comeback++
    songLast.set(sk, p.at)
    const sr = songRun.get(sk)
    if (!sr) songRun.set(sk, { day, run: 1 })
    else if (sr.day !== day) {
      sr.run = nextDay(sr.day) === day ? sr.run + 1 : 1
      sr.day = day
      if (sr.run >= 7) weekLoop = 1
    }
    run = sk === prevSong ? run + 1 : 1
    prevSong = sk
    inARow = Math.max(inARow, run)
    session = prevEnd && p.at - prevEnd < 10 * 60_000 ? session + p.ms : p.ms
    bestSession = Math.max(bestSession, session)
    prevEnd = p.at + p.ms
    bump(hourPlays, h)
    if (!monthDays.has(`${y}-${mo}`)) monthDays.set(`${y}-${mo}`, new Set())
    monthDays.get(`${y}-${mo}`)!.add(date)
    if (!yearDays.has(y)) yearDays.set(y, new Set())
    yearDays.get(y)!.add(day)
    if (h < 4) night++
    if (h >= 5 && h < 8) morning++
    if (d.getDay() === 0 || d.getDay() === 6) weekend++
    if (p.durationMs && p.ms >= p.durationMs * 0.95) full++
    if (mo === 0 && date === 1 && h === 0 && d.getMinutes() < 10) flags.newYear = 1
    if (mo === 11 && date === 31 && h === 23) flags.nye = 1
    if (mo === 11 && date === 24) flags.xmas = 1
    if (mo === 9 && date === 31) flags.halloween = 1
    if (mo === 1 && date === 14) flags.valentine = 1
    if (mo === 1 && date === 29) flags.leap = 1
    if (date === 13 && d.getDay() === 5) flags.friday13 = 1
    if (h === 4) flags.sunrise = 1
  }
  // the longest run of days in a row
  const days = [...dayMin.keys()].sort((a, b) => a - b)
  let streak = days.length ? 1 : 0
  let r = 1
  for (let i = 1; i < days.length; i++) {
    r = nextDay(days[i - 1]) === days[i] ? r + 1 : 1
    streak = Math.max(streak, r)
  }
  let perfectMonth = 0
  for (const [k, set] of monthDays) {
    const [y, mo] = k.split('-').map(Number)
    if (set.size >= daysIn(y, mo)) perfectMonth = 1
  }
  let perfectYear = 0
  for (const [y, set] of yearDays) if (set.size >= (new Date(y, 1, 29).getMonth() === 1 ? 366 : 365)) perfectYear = 1
  Object.assign(m, flags)
  return {
    ...(m as Measures),
    yearMinutes: maxOf(yearMin.values()),
    monthMinutes: maxOf(monthMin.values()),
    weekMinutes: maxOf(weekMin.values()),
    dayMinutes: maxOf(dayMin.values()),
    hours: plays.reduce((n, p) => n + p.ms, 0) / 3_600_000,
    plays: plays.length,
    bigDays: [...dayMin.values()].filter((v) => v >= 480).length,
    session: Math.floor(bestSession / 3_600_000),
    activeDays: dayMin.size,
    streak,
    years: yearMin.size,
    yearArtists: maxOf([...yearArtists.values()].map((s) => s.size)),
    yearSongs: maxOf([...yearSongs.values()].map((s) => s.size)),
    artists: firstSeen.size,
    songs: songPlays.size,
    albums: albums.size,
    newMonth: maxOf(newPerMonth.values()),
    hoursCovered: [...hourPlays.values()].filter((v) => v >= 100).length,
    loyal: maxOf(artistPlays.values()),
    artistYear: maxOf(artistYear.values()),
    songPlays: maxOf(songPlays.values()),
    repeatDay: maxOf(songDay.values()),
    inARow,
    heavyArtists: [...artistPlays.values()].filter((v) => v >= 100).length,
    heavySongs: [...songPlays.values()].filter((v) => v >= 50).length,
    comeback,
    night,
    morning,
    weekend,
    full,
    saved: lib?.saved ?? 0,
    savedAlbums: lib?.albums ?? 0,
    following: lib?.following ?? 0,
    playlists: lib?.playlists ?? 0,
    playlistSongs: lib?.playlistSongs ?? 0,
    allNighter: maxOf(nightMin.values()) >= 240 ? 1 : 0,
    fullDay: [...dayHours.values()].some((s) => s.size >= 24) ? 1 : 0,
    doubleCentury: maxOf(dayPlays.values()) >= 200 ? 1 : 0,
    perfectMonth,
    perfectYear,
    decade: plays.length && plays[plays.length - 1].at - plays[0].at >= 3652 * DAY ? 1 : 0,
    imported: imported ? 1 : 0,
    weekLoop
  }
}

/** Your top artists by time, with a picture. */
function topArtists(plays: Play[]): { key: string; name: string; minutes: number; art: string | null }[] {
  const m = new Map<string, { name: string; minutes: number; art: string | null }>()
  for (const p of plays) {
    if (p.ms < 30_000) continue
    const a = p.artists[0]
    if (!a) continue
    const k = artistKey(a)
    const e = m.get(k) ?? { name: a.name, minutes: 0, art: null }
    e.minutes += p.ms / 60_000
    if (!e.art && p.art) e.art = p.art
    m.set(k, e)
  }
  return [...m.entries()]
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, ARTIST_SLOTS)
}

const TOTAL = 1000

function ladder(
  id: string,
  cat: Category,
  title: string,
  icon: string,
  ask: (g: number) => string,
  value: number,
  list: number[],
  share: (g: number) => number,
  art?: string | null
): Ladder {
  const tiers = list.map((g) => {
    const s = Math.min(0.99, Math.max(1e-7, share(g)))
    return { key: `${id}:${g}`, goal: g, done: value >= g, share: s, rarity: rarityOf(s) }
  })
  const reached = tiers.filter((t) => t.done).length
  const next = tiers.find((t) => !t.done) ?? null
  const prev = reached ? tiers[reached - 1].goal : 0
  return {
    id,
    cat,
    title,
    icon,
    ask,
    value,
    tiers,
    reached,
    next,
    progress: next ? Math.max(0, Math.min(1, (value - prev) / (next.goal - prev))) : 1,
    art
  }
}

export function buildBoard(plays: Play[], lib: LibraryCounts | null, imported: boolean): Board {
  const m = measure(plays, lib, imported)
  const ladders: Ladder[] = []
  const fixed = FAMILIES.reduce((n, f) => n + f.n, 0) + MOMENTS.length + ARTIST_SLOTS * ARTIST_GOALS.length
  for (const f of FAMILIES) {
    // the biggest ladder takes up the rest, so there are always exactly 1,000
    const n = f.id === 'plays' ? f.n + (TOTAL - fixed) : f.n
    ladders.push(ladder(f.id, f.cat, f.title, f.icon, f.ask, m[f.metric], goals(f.range[0], f.range[1], n), (g) => shareAbove(g, f.model)))
  }
  const top = topArtists(plays)
  for (let i = 0; i < ARTIST_SLOTS; i++) {
    const a = top[i]
    ladders.push(
      ladder(
        a ? `artist-${a.key}` : `artist-slot-${i}`,
        'artists',
        a ? a.name : `Your number ${i + 1} artist`,
        '🎤',
        (g) => `Listen to ${a?.name ?? 'this artist'} for ${fmt(g)} minutes`,
        a ? a.minutes : 0,
        ARTIST_GOALS,
        (g) => shareAbove(g, ARTIST_MODEL),
        a?.art ?? null
      )
    )
  }
  for (const mo of MOMENTS)
    ladders.push(
      ladder(
        mo.id,
        'moments',
        mo.title,
        mo.icon,
        () => mo.ask,
        m[mo.metric],
        [1],
        () => mo.share
      )
    )
  const byRarity = Object.fromEntries(RARITIES.map((r) => [r, { earned: 0, total: 0 }])) as Board['byRarity']
  let rarest: Board['rarest'] = null
  let total = 0
  let earned = 0
  for (const l of ladders)
    for (const t of l.tiers) {
      total++
      byRarity[t.rarity].total++
      if (!t.done) continue
      earned++
      byRarity[t.rarity].earned++
      if (!rarest || t.share < rarest.tier.share) rarest = { ladder: l, tier: t }
    }
  return { ladders, total, earned, rarest, byRarity }
}

/* ---------- Library counts (from Spotify, kept for the toasts) ---------- */

const LIB_KEY = 'pulse-lib-counts1'
export const savedLibraryCounts = (): LibraryCounts | null => {
  try {
    return JSON.parse(localStorage.getItem(LIB_KEY) ?? 'null') as LibraryCounts | null
  } catch {
    return null
  }
}
export const rememberLibraryCounts = (c: LibraryCounts): void => {
  try {
    localStorage.setItem(LIB_KEY, JSON.stringify(c))
  } catch {
    /* storage unavailable */
  }
}

/* ---------- New ones ---------- */

const SEEN = 'pulse-achievements2'

/** Toasts goals earned since the last look (the rarest two); the first time just remembers them. */
export function checkNewAchievements(): void {
  const h = useHistory.getState()
  if (!h.plays.length) return
  const board = buildBoard(h.plays, savedLibraryCounts(), !!h.imported)
  const now = board.ladders.flatMap((l) => l.tiers.filter((t) => t.done).map((t) => ({ l, t })))
  let seen: string[] | null = null
  try {
    seen = JSON.parse(localStorage.getItem(SEEN) ?? 'null') as string[] | null
  } catch {
    seen = null
  }
  try {
    localStorage.setItem(SEEN, JSON.stringify(now.map((x) => x.t.key)))
  } catch {
    /* not remembered */
  }
  if (!seen) return
  const old = new Set(seen)
  const fresh = now.filter((x) => !old.has(x.t.key)).sort((a, b) => a.t.share - b.t.share)
  for (const { l, t } of fresh.slice(0, 2)) useApp.getState().toast(`${l.icon} ${l.title}: ${l.ask(t.goal)} (${RARITY_NAME[t.rarity]}: ${shareText(t.share)})`)
}
