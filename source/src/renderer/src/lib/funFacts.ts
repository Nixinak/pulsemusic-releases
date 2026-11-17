// Little discoveries in the listening history for Your stats: the longest run of days with music,
// the song played most in one day, the longest session, the biggest day, your hour and weekday,
// artists heard for the first time and the song skipped most. All worked out here from the plays
// Pulse already keeps (no requests).
import { artistKey, songKey, type Play } from './history'

export interface Fact {
  id: string
  /** The big part: "12 days", "14×", "3 h 20 min". */
  value: string
  /** What it is. */
  label: string
  /** The detail under it: a song, a date. */
  detail?: string
  art?: string | null
  /** A small picture of the number. */
  viz?:
    | { kind: 'days'; days: boolean[] }
    | { kind: 'bars'; values: number[]; labels: string[]; peak: number }
    | { kind: 'clock'; values: number[]; peak: number }
    | { kind: 'share'; value: number }
    | { kind: 'span'; from: number; to: number }
}

const dayStart = (t: number): number => {
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}
const nextDay = (start: number): number => {
  const d = new Date(start)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
}
const shortDate = (t: number): string => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const hourLabel = (h: number): string => new Date(2000, 0, 1, h).toLocaleTimeString('en-US', { hour: 'numeric' })
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function duration(ms: number): string {
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

/** The facts for the plays from `from` on (the whole history is used to tell what is new). */
export function funFacts(all: Play[], from: number): Fact[] {
  const plays = all.filter((p) => p.at >= from && p.ms > 0).sort((a, b) => a.at - b.at)
  if (plays.length < 15) return []
  const out: Fact[] = []

  // the longest run of days in a row with music, and the one going on now
  const days = [...new Set(plays.map((p) => dayStart(p.at)))].sort((a, b) => a - b)
  let best = { len: 1, from: days[0], to: days[0] }
  let run = { len: 1, from: days[0] }
  for (let i = 1; i < days.length; i++) {
    run = nextDay(days[i - 1]) === days[i] ? { len: run.len + 1, from: run.from } : { len: 1, from: days[i] }
    if (run.len > best.len) best = { len: run.len, from: run.from, to: days[i] }
  }
  const today = dayStart(Date.now())
  const last = days[days.length - 1]
  const current = last === today || nextDay(last) === today ? run.len : 0
  const lit = new Set(days)
  const recentDays: boolean[] = []
  for (let k = 20; k >= 0; k--) {
    const d = new Date(today)
    d.setDate(d.getDate() - k)
    recentDays.push(lit.has(dayStart(d.getTime())))
  }
  if (best.len >= 2)
    out.push({
      viz: { kind: 'days', days: recentDays },
      id: 'streak',
      value: `${best.len} days`,
      label: 'Longest streak',
      detail:
        current >= 2 && current !== best.len
          ? `${shortDate(best.from)} – ${shortDate(best.to)} · now on ${current}`
          : current === best.len
            ? 'And it is still going'
            : `${shortDate(best.from)} – ${shortDate(best.to)}`
    })

  // the song played most times in one day
  const perDay = new Map<string, { n: number; p: Play; day: number }>()
  for (const p of plays) {
    if (p.ms < 30_000) continue
    const k = `${dayStart(p.at)}|${songKey(p)}`
    const e = perDay.get(k)
    if (e) e.n++
    else perDay.set(k, { n: 1, p, day: dayStart(p.at) })
  }
  const repeat = [...perDay.values()].sort((a, b) => b.n - a.n)[0]
  if (repeat && repeat.n >= 3)
    out.push({
      id: 'repeat',
      value: `${repeat.n}×`,
      label: 'On repeat in one day',
      detail: `${repeat.p.name} · ${shortDate(repeat.day)}`,
      art: repeat.p.art
    })

  // the longest session: music with no break longer than 15 minutes
  let session = { ms: 0, from: plays[0].at, end: plays[0].at }
  let cur = { ms: 0, from: plays[0].at, end: plays[0].at }
  for (const p of plays) {
    if (p.at - cur.end > 15 * 60_000) cur = { ms: 0, from: p.at, end: p.at }
    cur.ms += p.ms
    cur.end = Math.max(cur.end, p.at + p.ms)
    if (cur.ms > session.ms) session = { ms: cur.ms, from: cur.from, end: cur.end }
  }
  if (session.ms >= 30 * 60_000) {
    // where in the day it was (fractions of 24 hours; a session past midnight runs to the end)
    const d0 = dayStart(session.from)
    const f = (t: number): number => Math.max(0, Math.min(1, (t - d0) / 86_400_000))
    const hm = (t: number): string =>
      new Date(t).toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit'
      })
    out.push({
      id: 'session',
      value: duration(session.ms),
      label: 'Longest session',
      detail: `${shortDate(session.from)}, ${hm(session.from)}–${hm(session.end)}`,
      viz: { kind: 'span', from: f(session.from), to: f(session.end) }
    })
  }

  // the day with the most music
  const dayMs = new Map<number, number>()
  for (const p of plays) dayMs.set(dayStart(p.at), (dayMs.get(dayStart(p.at)) ?? 0) + p.ms)
  const biggest = [...dayMs.entries()].sort((a, b) => b[1] - a[1])[0]
  if (biggest && days.length >= 2) {
    // the last two weeks, day by day, with the biggest one marked when it is among them
    const vals: number[] = []
    const labels: string[] = []
    let peakAt = -1
    for (let k = 13; k >= 0; k--) {
      const d = new Date(today)
      d.setDate(d.getDate() - k)
      const key = dayStart(d.getTime())
      if (key === biggest[0]) peakAt = vals.length
      vals.push(dayMs.get(key) ?? 0)
      labels.push(String(d.getDate()))
    }
    const top = Math.max(...vals, 1)
    out.push({
      id: 'day',
      value: duration(biggest[1]),
      label: 'Your biggest day',
      detail: new Date(biggest[0]).toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long'
      }),
      viz: {
        kind: 'bars',
        values: vals.map((v) => v / top),
        labels,
        peak: peakAt >= 0 ? peakAt : vals.indexOf(Math.max(...vals))
      }
    })
  }

  // your hour and your weekday
  const hours = new Array(24).fill(0) as number[]
  const weekdays = new Array(7).fill(0) as number[]
  for (const p of plays) {
    const d = new Date(p.at)
    hours[d.getHours()] += p.ms
    weekdays[d.getDay()] += p.ms
  }
  const total = hours.reduce((a, b) => a + b, 0) || 1
  const peak = hours.indexOf(Math.max(...hours))
  const night = hours.slice(0, 5).reduce((a, b) => a + b, 0) / total
  const morning = hours.slice(5, 10).reduce((a, b) => a + b, 0) / total
  const kind = night >= 0.18 ? 'Night owl' : morning >= 0.25 ? 'Early bird' : peak >= 17 ? 'Evening listener' : 'Daytime listener'
  out.push({
    viz: {
      kind: 'clock',
      values: hours.map((h) => h / (Math.max(...hours) || 1)),
      peak
    },
    id: 'hour',
    value: hourLabel(peak),
    label: 'Your hour',
    detail:
      night >= 0.18 ? `${kind}: ${Math.round(night * 100)}% after midnight` : morning >= 0.25 ? `${kind}: ${Math.round(morning * 100)}% before 10 AM` : kind
  })
  if (days.length >= 7) {
    const wd = weekdays.indexOf(Math.max(...weekdays))
    // Monday first
    const order = [1, 2, 3, 4, 5, 6, 0]
    const top = Math.max(...weekdays) || 1
    out.push({
      id: 'weekday',
      value: WEEKDAYS[wd],
      label: 'Your favourite day',
      detail: `${Math.round((weekdays[wd] / total) * 100)}% of your listening`,
      viz: {
        kind: 'bars',
        values: order.map((d) => weekdays[d] / top),
        labels: order.map((d) => WEEKDAYS[d][0]),
        peak: order.indexOf(wd)
      }
    })
  }

  // artists heard for the first time in this time
  if (from > 0) {
    const seenBefore = new Set<string>()
    for (const p of all) if (p.at < from) for (const a of p.artists) seenBefore.add(artistKey(a))
    if (seenBefore.size > 20) {
      const fresh = new Map<string, { name: string; ms: number }>()
      for (const p of plays)
        for (const a of p.artists) {
          const k = artistKey(a)
          if (seenBefore.has(k)) continue
          fresh.set(k, { name: a.name, ms: (fresh.get(k)?.ms ?? 0) + p.ms })
        }
      if (fresh.size) {
        const top = [...fresh.values()].sort((a, b) => b.ms - a.ms)[0]
        out.push({
          id: 'new',
          value: String(fresh.size),
          label: fresh.size === 1 ? 'New artist' : 'New artists',
          detail: `Most played: ${top.name}`
        })
      }
    }
  }

  // the song skipped the most (left within 30 seconds)
  const skips = new Map<string, { n: number; p: Play }>()
  for (const p of plays) {
    if (p.ms >= 30_000 || p.durationMs < 60_000 || p.src === 'export') continue
    const k = songKey(p)
    const e = skips.get(k)
    if (e) e.n++
    else skips.set(k, { n: 1, p })
  }
  const skipped = [...skips.values()].sort((a, b) => b.n - a.n)[0]
  if (skipped && skipped.n >= 3)
    out.push({
      id: 'skip',
      value: `${skipped.n}×`,
      label: 'Skipped the most',
      detail: skipped.p.name,
      art: skipped.p.art
    })

  // how many different songs and how much of it was the top artist
  const songs = new Set(plays.map(songKey)).size
  const byArtist = new Map<string, { name: string; ms: number }>()
  for (const p of plays) {
    const a = p.artists[0]
    if (!a) continue
    const k = artistKey(a)
    byArtist.set(k, { name: a.name, ms: (byArtist.get(k)?.ms ?? 0) + p.ms })
  }
  const lead = [...byArtist.values()].sort((a, b) => b.ms - a.ms)[0]
  out.push({
    id: 'variety',
    value: songs.toLocaleString('en-US'),
    label: 'Different songs',
    detail: lead ? `${Math.round((lead.ms / total) * 100)}% of the time: ${lead.name}` : undefined,
    viz: lead ? { kind: 'share', value: lead.ms / total } : undefined
  })

  return out
}
