// Achievements: badges earned by listening, worked out from the listening history Pulse keeps
// (nothing is sent anywhere). Each has a goal and shows how close you are; a new one pops up as a
// toast the first time it is earned.
import { artistKey, songKey, useHistory, type Play } from './history'
import { useApp } from './store'

export interface Achievement {
  id: string
  title: string
  text: string
  /** An emoji drawn on the badge. */
  icon: string
  /** 0–1. */
  progress: number
  /** "640 / 1,000". */
  count: string
  done: boolean
  tier: 'bronze' | 'silver' | 'gold'
}

const dayStart = (t: number): number => {
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}
const nextDay = (s: number): number => {
  const d = new Date(s)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
}
const fmt = (n: number): string => Math.floor(n).toLocaleString('en-US')
/** The biggest value (without spreading a huge list into Math.max). */
const maxOf = (it: Iterable<number>): number => {
  let m = 0
  for (const v of it) if (v > m) m = v
  return m
}

/** Everything that the badges need, in one pass over the history. */
function measure(plays: Play[]): Record<string, number> {
  const real = plays.filter((p) => p.ms >= 30_000)
  const artists = new Map<string, number>()
  const songs = new Set<string>()
  const days = new Map<number, number>()
  const perSongDay = new Map<string, number>()
  const months = new Map<string, Set<string>>()
  const seenArtist = new Set<string>()
  let night = 0
  let morning = 0
  let weekend = 0
  for (const p of [...real].sort((a, b) => a.at - b.at)) {
    const d = new Date(p.at)
    const h = d.getHours()
    if (h < 4) night++
    if (h >= 5 && h < 8) morning++
    if (d.getDay() === 0 || d.getDay() === 6) weekend++
    const day = dayStart(p.at)
    days.set(day, (days.get(day) ?? 0) + p.ms)
    songs.add(songKey(p))
    const k = `${day}|${songKey(p)}`
    perSongDay.set(k, (perSongDay.get(k) ?? 0) + 1)
    const month = `${d.getFullYear()}-${d.getMonth()}`
    for (const a of p.artists) {
      const ak = artistKey(a)
      artists.set(ak, (artists.get(ak) ?? 0) + 1)
      if (!seenArtist.has(ak)) {
        seenArtist.add(ak)
        if (!months.has(month)) months.set(month, new Set())
        months.get(month)!.add(ak)
      }
    }
  }
  // the longest run of days in a row
  const sorted = [...days.keys()].sort((a, b) => a - b)
  let best = sorted.length ? 1 : 0
  let run = 1
  for (let i = 1; i < sorted.length; i++) {
    run = nextDay(sorted[i - 1]) === sorted[i] ? run + 1 : 1
    best = Math.max(best, run)
  }
  const totalMs = real.reduce((n, p) => n + p.ms, 0)
  return {
    plays: real.length,
    hours: totalMs / 3_600_000,
    artists: artists.size,
    songs: songs.size,
    streak: best,
    loyal: maxOf(artists.values()),
    bigDay: maxOf(days.values()) / 3_600_000,
    repeat: maxOf(perSongDay.values()),
    explorer: maxOf([...months.values()].map((s) => s.size)),
    night,
    morning,
    weekend
  }
}

/** Each badge: its goals (bronze, silver, gold) and how it's measured. */
const BADGES: {
  id: string
  key: string
  title: string
  text: (goal: number) => string
  icon: string
  goals: [number, number, number]
  unit?: string
}[] = [
  {
    id: 'plays',
    key: 'plays',
    title: 'Heavy rotation',
    text: (g) => `Play ${fmt(g)} songs`,
    icon: '🎧',
    goals: [500, 5000, 25000]
  },
  {
    id: 'hours',
    key: 'hours',
    title: 'Time well spent',
    text: (g) => `Listen for ${fmt(g)} hours`,
    icon: '⏳',
    goals: [50, 500, 2000]
  },
  {
    id: 'streak',
    key: 'streak',
    title: 'On a roll',
    text: (g) => `Listen ${g} days in a row`,
    icon: '🔥',
    goals: [7, 30, 100]
  },
  {
    id: 'artists',
    key: 'artists',
    title: 'Wide ears',
    text: (g) => `Hear ${fmt(g)} different artists`,
    icon: '🌍',
    goals: [100, 500, 1500]
  },
  {
    id: 'songs',
    key: 'songs',
    title: 'Deep crate',
    text: (g) => `Play ${fmt(g)} different songs`,
    icon: '💿',
    goals: [300, 2000, 8000]
  },
  {
    id: 'loyal',
    key: 'loyal',
    title: 'Superfan',
    text: (g) => `Play one artist ${fmt(g)} times`,
    icon: '💜',
    goals: [100, 500, 2000]
  },
  {
    id: 'bigday',
    key: 'bigDay',
    title: 'Marathon',
    text: (g) => `Listen ${g} hours in one day`,
    icon: '🏃',
    goals: [4, 8, 12]
  },
  {
    id: 'repeat',
    key: 'repeat',
    title: 'Can’t stop',
    text: (g) => `Play one song ${g} times in a day`,
    icon: '🔁',
    goals: [5, 15, 30]
  },
  {
    id: 'explorer',
    key: 'explorer',
    title: 'Explorer',
    text: (g) => `Find ${g} new artists in one month`,
    icon: '🧭',
    goals: [20, 60, 150]
  },
  {
    id: 'night',
    key: 'night',
    title: 'Night owl',
    text: (g) => `Play ${fmt(g)} songs between midnight and 4 AM`,
    icon: '🦉',
    goals: [50, 300, 1000]
  },
  {
    id: 'morning',
    key: 'morning',
    title: 'Early bird',
    text: (g) => `Play ${fmt(g)} songs between 5 and 8 AM`,
    icon: '🌅',
    goals: [50, 300, 1000]
  },
  {
    id: 'weekend',
    key: 'weekend',
    title: 'Weekend warrior',
    text: (g) => `Play ${fmt(g)} songs on weekends`,
    icon: '🎉',
    goals: [300, 2000, 8000]
  }
]

const TIERS = ['bronze', 'silver', 'gold'] as const

export function achievements(plays: Play[]): Achievement[] {
  const m = measure(plays)
  return BADGES.map((b) => {
    const v = m[b.key] ?? 0
    // the highest goal reached, and the next one to aim for
    let reached = -1
    b.goals.forEach((g, i) => v >= g && (reached = i))
    const nextGoal = b.goals[Math.min(2, reached + 1)]
    const done = reached >= 0
    return {
      id: b.id,
      title: b.title,
      text: b.text(reached === 2 ? b.goals[2] : nextGoal),
      icon: b.icon,
      progress: reached === 2 ? 1 : Math.min(1, v / nextGoal),
      count: `${fmt(v)} / ${fmt(reached === 2 ? b.goals[2] : nextGoal)}`,
      done,
      tier: TIERS[Math.max(0, reached)]
    }
  })
}

/* ---------- New ones ---------- */

const SEEN = 'pulse-achievements1'

/** Toasts badges (and tiers) earned since the last look; the first time just remembers them. */
export function checkNewAchievements(): void {
  const plays = useHistory.getState().plays
  if (!plays.length) return
  const now = achievements(plays)
    .filter((a) => a.done)
    .map((a) => `${a.id}:${a.tier}`)
  let seen: string[] | null = null
  try {
    seen = JSON.parse(localStorage.getItem(SEEN) ?? 'null') as string[] | null
  } catch {
    seen = null
  }
  try {
    localStorage.setItem(SEEN, JSON.stringify(now))
  } catch {
    /* not remembered */
  }
  if (!seen) return
  const fresh = now.filter((k) => !seen!.includes(k))
  const list = achievements(plays)
  for (const k of fresh.slice(0, 2)) {
    const a = list.find((x) => `${x.id}:${x.tier}` === k)
    if (a) useApp.getState().toast(`${a.icon} Achievement: ${a.title} (${a.tier})`)
  }
}
