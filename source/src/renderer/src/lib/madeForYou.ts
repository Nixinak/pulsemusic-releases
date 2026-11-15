// Made for you: personal playlists Pulse puts together by itself and refreshes on its own.
//  - Daily Mix 1–6 (new every day): your artists in groups that belong together (Deezer's
//    "similar artists" decides the groups), mostly songs you love plus some of theirs you
//    haven't saved yet.
//  - On Repeat (every day): what you've played most in the last 30 days.
//  - Repeat Rewind (every day): what you played a lot earlier in the year but not lately.
//  - Discover Weekly (every Monday): artists you don't listen to yet that sound like the ones
//    you do, two of their best songs each.
//  - Release Radar (every Monday): new songs from your artists, from the last six weeks.
//  - Deep Cuts (every Monday): the lesser-known songs of the artists you play most.
//  - Time Capsule (every Monday): your all-time favourites and old likes you haven't played lately.
// Each mix has up to 40 songs.
// Everything is made quietly in the background (the AI DJ's model names the daily mixes when
// it's available) and only appears on Home once it's ready. Each mix gets its own cover,
// drawn here with your name on it.
import { create } from 'zustand'
import * as sp from './spotify'
import { computeStats, isRealId, useHistory, type Play } from './history'
import { useApp } from './store'
import type { STrack } from './types'

export type MixKind = 'daily' | 'repeat' | 'rewind' | 'discover' | 'radar' | 'deep' | 'capsule'

/** Mixes that are made once a week (on Monday); the rest are made every day. */
export const isWeekly = (k: MixKind): boolean => k === 'discover' || k === 'radar' || k === 'deep' || k === 'capsule'

/** How many songs a mix holds at most. */
const SIZE = 40

export interface GenMix {
  id: string
  kind: MixKind
  /** Small label above the title ("Daily Mix 1"). */
  label: string
  title: string
  /** Artists in it, for the card. */
  subtitle: string
  description: string
  /** The cover, drawn for this listener (a data URL). */
  cover: string
  tracks: STrack[]
  madeAt: number
}

interface Saved {
  /** 2: up to 40 songs and all seven kinds. Mixes saved by older versions are made again. */
  version: 1 | 2
  user: string
  /** Day and ISO week the daily and the weekly mixes were made for. */
  day: string
  week: string
  mixes: GenMix[]
}

interface MadeState {
  mixes: GenMix[]
  loaded: boolean
}

export const useMadeForYou = create<MadeState>(() => ({ mixes: [], loaded: false }))

/* ---------- Dates ---------- */

const dayKey = (d = new Date()): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
function weekKey(d = new Date()): string {
  // ISO week: weeks start on Monday
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const start = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  const w = Math.ceil(((t.getTime() - start.getTime()) / 86_400_000 + 1) / 7)
  return `${t.getUTCFullYear()}-W${String(w).padStart(2, '0')}`
}

/* ---------- Small helpers ---------- */

const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s*[([].*?[)\]]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
const songKey = (t: { name: string; artists: { name: string }[] }): string => `${norm(t.name)}|${norm(t.artists[0]?.name ?? '')}`
const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** A random generator seeded by text, so a day's mixes come out the same if made twice. */
function seeded(seed: string): () => number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return (h >>> 0) / 4294967296
  }
}

function shuffle<T>(list: T[], rnd: () => number): T[] {
  const a = list.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Keeps the same main artist from playing twice in a row where it can. */
function spread(list: STrack[]): STrack[] {
  const rest = list.slice()
  const out: STrack[] = []
  while (rest.length) {
    const last = out[out.length - 1]?.artists[0]?.id
    const i = rest.findIndex((t) => t.artists[0]?.id !== last)
    out.push(rest.splice(i < 0 ? 0 : i, 1)[0])
  }
  return out
}

/** A song from the listening history in the shape the rest of the app uses. */
const fromPlay = (p: Play): STrack => ({
  id: p.id,
  name: p.name,
  uri: `spotify:track:${p.id}`,
  duration_ms: p.durationMs,
  explicit: false,
  artists: p.artists.map((a) => ({ id: a.id, name: a.name, uri: `spotify:artist:${a.id}` })),
  album: { id: p.album.id, name: p.album.name, uri: `spotify:album:${p.album.id}`, images: p.art ? [{ url: p.art, width: 300, height: 300 }] : [], artists: [], type: 'album' },
  type: 'track'
})

/** Only what a mix needs to keep (the saved file stays small). */
const slim = (t: STrack): STrack => ({
  id: t.id,
  name: t.name,
  uri: t.uri,
  duration_ms: t.duration_ms,
  explicit: !!t.explicit,
  artists: t.artists.map((a) => ({ id: a.id, name: a.name, uri: a.uri })),
  album: t.album
    ? {
        id: t.album.id,
        name: t.album.name,
        uri: t.album.uri,
        images: (t.album.images ?? []).slice().sort((a, b) => (a.width ?? 0) - (b.width ?? 0)).filter((im, i, l) => (im.width ?? 300) >= 64 || i === l.length - 1).slice(0, 2),
        artists: [],
        release_date: t.album.release_date,
        type: 'album'
      }
    : undefined,
  type: 'track'
})

const searchSongs = (q: string, offset = 0): Promise<STrack[]> =>
  sp
    .api<{ tracks?: { items: (STrack | null)[] } }>('/search', { query: { q, type: 'track', limit: 10, offset }, background: true, patient: true })
    .then((r) => (r.tracks?.items ?? []).filter((t): t is STrack => !!t?.id && t.is_playable !== false))
    .catch(() => [])

const related = (name: string): Promise<string[]> => window.pulse.recs?.related(name).catch(() => [] as string[]) ?? Promise.resolve([])

/* ---------- What the listener plays ---------- */

interface Library {
  /** Songs they know, by song key. */
  songs: Map<string, { track: STrack; score: number }>
  /** Artists by name key, with how much they're played. */
  artists: Map<string, { id: string; name: string; score: number }>
  plays: Play[]
  /** Spotify's all-time top songs and liked songs saved more than a year ago (for Time Capsule). */
  longTop: STrack[]
  oldLiked: STrack[]
}

async function readLibrary(): Promise<Library> {
  const plays = useHistory.getState().plays
  const songs = new Map<string, { track: STrack; score: number }>()
  const artists = new Map<string, { id: string; name: string; score: number }>()
  const addArtist = (a: { id: string; name: string }, score: number): void => {
    if (!isRealId(a.id)) return
    const k = norm(a.name)
    const e = artists.get(k) ?? { id: a.id, name: a.name, score: 0 }
    e.score += score
    artists.set(k, e)
  }
  const addSong = (t: STrack, score: number): void => {
    if (!t?.id || !isRealId(t.id) || t.is_local) return
    const k = songKey(t)
    const e = songs.get(k)
    if (e) e.score += score
    else songs.set(k, { track: t, score })
  }

  // the last 90 days of listening (minutes count)
  const since = Date.now() - 90 * 86_400_000
  for (const p of plays) {
    if (p.at < since || !isRealId(p.id) || !p.art) continue
    const min = p.ms / 60_000
    addSong(fromPlay(p), min)
    p.artists.forEach((a, i) => addArtist(a, i === 0 ? min : min * 0.3))
  }

  // the newest liked songs and Spotify's own top lists
  type LikedPage = { items: { track: STrack | null; added_at?: string }[]; next: string | null; total?: number }
  const yearAgo = Date.now() - 365 * 86_400_000
  const oldLiked: STrack[] = []
  const keepOld = (page: LikedPage): void => {
    for (const i of page.items) if (i.track?.id && Date.parse(i.added_at ?? '') < yearAgo) oldLiked.push(i.track)
  }
  const liked: STrack[] = []
  let likedTotal = 0
  for (let offset = 0; offset < 300; offset += 50) {
    const page = await sp.api<LikedPage>('/me/tracks', { query: { limit: 50, offset }, background: true, patient: true }).catch(() => null)
    if (!page) break
    likedTotal = page.total ?? likedTotal
    liked.push(...page.items.map((i) => i.track).filter((t): t is STrack => !!t?.id))
    keepOld(page)
    if (!page.next) break
  }
  // two pages from further back in the liked songs (different ones each week)
  if (likedTotal > 350) {
    const rnd = seeded(weekKey())
    for (let n = 0; n < 2; n++) {
      const offset = 300 + Math.floor(rnd() * Math.max(1, likedTotal - 350))
      const page = await sp.api<LikedPage>('/me/tracks', { query: { limit: 50, offset }, background: true, patient: true }).catch(() => null)
      if (page) keepOld(page)
    }
  }
  liked.forEach((t, i) => {
    addSong(t, 6 * (1 - i / 400))
    t.artists.forEach((a, j) => addArtist(a, j === 0 ? 4 : 1.5))
  })
  for (const [range, w] of [
    ['short_term', 30],
    ['medium_term', 15]
  ] as const) {
    const top = await sp.api<{ items: STrack[] }>('/me/top/tracks', { query: { limit: 50, time_range: range }, background: true, patient: true }).catch(() => null)
    ;(top?.items ?? []).forEach((t, i) => {
      addSong(t, w * (1 - i / 60))
      t.artists.forEach((a, j) => addArtist(a, (j === 0 ? w : w * 0.3) * (1 - i / 60)))
    })
  }
  const long = await sp.api<{ items: STrack[] }>('/me/top/tracks', { query: { limit: 50, time_range: 'long_term' }, background: true, patient: true }).catch(() => null)
  return { songs, artists, plays, longTop: (long?.items ?? []).filter((t) => t?.id && isRealId(t.id) && !t.is_local), oldLiked }
}

/* ---------- The mixes ---------- */

interface Draft {
  kind: MixKind
  label: string
  title: string
  subtitle: string
  description: string
  tracks: STrack[]
  /** Pictures for the cover. */
  art: string[]
  /** Which look the cover gets. */
  look: number
}

const names = (list: { name: string }[], n = 3): string => {
  const shown = list.slice(0, n).map((a) => a.name)
  return list.length > n ? `${shown.join(', ')} and more` : shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}` : (shown[0] ?? '')
}

async function dailyMixes(lib: Library, day: string): Promise<Draft[]> {
  const rnd = seeded(day)
  const ranked = [...lib.artists.values()].sort((a, b) => b.score - a.score)
  const byArtist = new Map<string, { track: STrack; score: number }[]>()
  for (const s of lib.songs.values()) {
    const k = norm(s.track.artists[0]?.name ?? '')
    const l = byArtist.get(k) ?? []
    l.push(s)
    byArtist.set(k, l)
  }
  const used = new Set<string>()
  const groups: { name: string; id: string }[][] = []
  for (const seed of ranked.slice(0, 24)) {
    if (groups.length >= 6) break
    const sk = norm(seed.name)
    if (used.has(sk) || (byArtist.get(sk)?.length ?? 0) < 3) continue
    const near = new Set((await related(seed.name)).map(norm))
    // artists they play who sound like the seed, or who are on songs with them
    const featured = new Set<string>()
    for (const s of byArtist.get(sk) ?? []) for (const a of s.track.artists.slice(1)) featured.add(norm(a.name))
    const members = ranked.filter((a) => {
      const k = norm(a.name)
      return k !== sk && !used.has(k) && (near.has(k) || featured.has(k)) && (byArtist.get(k)?.length ?? 0) > 0
    })
    const group = [seed, ...members.slice(0, 5)]
    const songs = group.reduce((n, a) => n + (byArtist.get(norm(a.name))?.length ?? 0), 0)
    if (songs < 8) continue
    group.forEach((a) => used.add(norm(a.name)))
    groups.push(group)
  }

  const out: Draft[] = []
  for (const [i, group] of groups.entries()) {
    const own = group
      .flatMap((a) => byArtist.get(norm(a.name)) ?? [])
      .sort((a, b) => b.score - a.score)
    // favourites first, then a shuffle of the rest; about three quarters are songs they know
    const known = [...own.slice(0, 8), ...shuffle(own.slice(8), rnd)].slice(0, 30).map((s) => s.track)
    const knownKeys = new Set([...lib.songs.keys()])
    const fresh: STrack[] = []
    const want = Math.max(10, SIZE - known.length)
    for (const a of group.slice(0, 3)) {
      for (const offset of [0, 10]) {
        if (fresh.length >= want) break
        const found = await searchSongs(`artist:"${a.name}"`, offset)
        for (const t of found) {
          if (fresh.length >= want) break
          if (norm(t.artists[0]?.name ?? '') !== norm(a.name) || knownKeys.has(songKey(t)) || fresh.some((x) => songKey(x) === songKey(t))) continue
          fresh.push(t)
        }
        await pause(150)
        // the second page only when the group is small
        if (known.length >= 20) break
      }
    }
    // the new songs are mixed in after the first few favourites
    const list = known.slice(0, 3)
    const rest = shuffle([...known.slice(3), ...fresh], rnd)
    const tracks = spread([...list, ...rest]).slice(0, SIZE)
    const art = [
      ...group.slice(0, 1).map((a) => a.id),
      ...tracks.map((t) => sp.pickImage(t.album?.images, 300)).filter((x): x is string => !!x)
    ]
    out.push({
      kind: 'daily',
      label: `Daily Mix ${i + 1}`,
      title: `Daily Mix ${i + 1}`,
      subtitle: names(group),
      description: `${names(group, 4)}. Made for you every day.`,
      tracks,
      art,
      look: i
    })
  }
  return out
}

function onRepeat(lib: Library): Draft | null {
  const st = computeStats(lib.plays, Date.now() - 30 * 86_400_000)
  const songs = st.songs.filter((s) => s.plays >= 2 && isRealId(s.item.id) && s.item.art).slice(0, SIZE)
  if (songs.length < 8) return null
  const tracks = songs.map((s) => fromPlay(s.item))
  const artists = st.artists.filter((a) => isRealId(a.item.id)).slice(0, 3).map((a) => a.item)
  return {
    kind: 'repeat',
    label: 'On Repeat',
    title: 'On Repeat',
    subtitle: names(artists),
    description: 'The songs you can’t stop playing, from the last 30 days.',
    tracks,
    art: tracks.map((t) => sp.pickImage(t.album?.images, 300)).filter((x): x is string => !!x),
    look: 6
  }
}

/** Songs played a lot between a year and a month ago that haven't been played in the last month. */
function repeatRewind(lib: Library): Draft | null {
  const now = Date.now()
  const month = now - 30 * 86_400_000
  const recent = new Set(lib.plays.filter((p) => p.at >= month).map((p) => songKey(fromPlay(p))))
  const st = computeStats(lib.plays, now - 365 * 86_400_000, month)
  const songs = st.songs.filter((s) => s.plays >= 3 && isRealId(s.item.id) && s.item.art && !recent.has(songKey(fromPlay(s.item)))).slice(0, SIZE)
  if (songs.length < 10) return null
  const tracks = songs.map((s) => fromPlay(s.item))
  const artists = [...new Map(tracks.map((t) => [t.artists[0]?.id, t.artists[0]])).values()].filter(Boolean) as { name: string }[]
  return {
    kind: 'rewind',
    label: 'Repeat Rewind',
    title: 'Repeat Rewind',
    subtitle: names(artists),
    description: 'Songs you had on repeat earlier this year and haven’t played in a while.',
    tracks,
    art: tracks.map((t) => sp.pickImage(t.album?.images, 300)).filter((x): x is string => !!x),
    look: 7
  }
}

async function discoverWeekly(lib: Library, week: string): Promise<Draft | null> {
  const rnd = seeded(week)
  const known = new Set(lib.artists.keys())
  for (const s of lib.songs.values()) for (const a of s.track.artists) known.add(norm(a.name))
  const seeds = [...lib.artists.values()].sort((a, b) => b.score - a.score).slice(0, 12)
  const fresh = new Map<string, { name: string; w: number; via: string }>()
  for (const [i, seed] of seeds.entries()) {
    const list = await related(seed.name)
    list.slice(0, 10).forEach((n, j) => {
      const k = norm(n)
      if (!k || known.has(k)) return
      const e = fresh.get(k) ?? { name: n, w: 0, via: seed.name }
      e.w += (1 - i * 0.06) * (1 - j * 0.07)
      fresh.set(k, e)
    })
  }
  const picks = [...fresh.values()].sort((a, b) => b.w - a.w).slice(0, 24)
  const knownKeys = new Set(lib.songs.keys())
  const tracks: STrack[] = []
  const vias: string[] = []
  for (const a of picks) {
    if (tracks.length >= SIZE) break
    const found = (await searchSongs(`artist:"${a.name}"`)).filter((t) => norm(t.artists[0]?.name ?? '') === norm(a.name) && !knownKeys.has(songKey(t)))
    tracks.push(...shuffle(found.slice(0, 4), rnd).slice(0, 2))
    if (found.length && !vias.includes(a.via)) vias.push(a.via)
    await pause(150)
  }
  if (tracks.length < 8) return null
  const list = spread(shuffle(tracks, rnd)).slice(0, SIZE)
  const artistNames = [...new Map(list.map((t) => [t.artists[0]?.id, t.artists[0]])).values()].filter(Boolean) as { name: string }[]
  return {
    kind: 'discover',
    label: 'Discover Weekly',
    title: 'Discover Weekly',
    subtitle: names(artistNames),
    description: `New to you, picked for fans of ${names(vias.map((n) => ({ name: n })), 3)}. Fresh every Monday.`,
    tracks: list,
    art: list.map((t) => sp.pickImage(t.album?.images, 300)).filter((x): x is string => !!x),
    look: 8
  }
}

async function releaseRadar(lib: Library): Promise<Draft | null> {
  const year = new Date().getFullYear()
  const since = Date.now() - 42 * 86_400_000
  const artists = [...lib.artists.values()].sort((a, b) => b.score - a.score).slice(0, 24)
  const tracks: STrack[] = []
  const albums = new Map<string, number>()
  for (const a of artists) {
    if (tracks.length >= SIZE + 10) break
    const found = await searchSongs(`artist:"${a.name}" year:${year - 1}-${year}`)
    for (const t of found) {
      const released = Date.parse(t.album?.release_date ?? '')
      if (!t.artists.some((x) => x.id === a.id) || !(released >= since)) continue
      const n = albums.get(t.album?.id ?? t.id) ?? 0
      if (n >= 2 || tracks.some((x) => songKey(x) === songKey(t))) continue
      albums.set(t.album?.id ?? t.id, n + 1)
      tracks.push(t)
    }
    await pause(150)
  }
  if (tracks.length < 5) return null
  const list = tracks.sort((x, y) => (y.album?.release_date ?? '').localeCompare(x.album?.release_date ?? '')).slice(0, SIZE)
  const artistNames = [...new Map(list.map((t) => [t.artists[0]?.id, t.artists[0]])).values()].filter(Boolean) as { name: string }[]
  return {
    kind: 'radar',
    label: 'Release Radar',
    title: 'Release Radar',
    subtitle: names(artistNames),
    description: 'New songs from the artists you play, from the last six weeks. Fresh every Monday.',
    tracks: list,
    art: list.map((t) => sp.pickImage(t.album?.images, 300)).filter((x): x is string => !!x),
    look: 9
  }
}

/** The lesser-known songs of the artists they play most: past the hits Spotify's search shows first. */
async function deepCuts(lib: Library, week: string): Promise<Draft | null> {
  const rnd = seeded(`${week}-deep`)
  const knownKeys = new Set(lib.songs.keys())
  const artists = [...lib.artists.values()].sort((a, b) => b.score - a.score).slice(0, 9)
  const tracks: STrack[] = []
  for (const a of artists) {
    if (tracks.length >= SIZE) break
    const found: STrack[] = []
    for (const offset of [10]) {
      const page = await searchSongs(`artist:"${a.name}"`, offset)
      found.push(...page.filter((t) => t.artists[0]?.id === a.id && !knownKeys.has(songKey(t)) && !found.some((x) => songKey(x) === songKey(t)) && !tracks.some((x) => songKey(x) === songKey(t))))
      await pause(150)
    }
    tracks.push(...shuffle(found, rnd).slice(0, 5))
  }
  if (tracks.length < 10) return null
  const list = spread(shuffle(tracks, rnd)).slice(0, SIZE)
  const artistNames = [...new Map(list.map((t) => [t.artists[0]?.id, t.artists[0]])).values()].filter(Boolean) as { name: string }[]
  return {
    kind: 'deep',
    label: 'Deep Cuts',
    title: 'Deep Cuts',
    subtitle: names(artistNames),
    description: 'The songs your favourite artists don’t play on the radio. Fresh every Monday.',
    tracks: list,
    art: list.map((t) => sp.pickImage(t.album?.images, 300)).filter((x): x is string => !!x),
    look: 10
  }
}

/** All-time favourites and old likes they haven't played in the last two months. */
function timeCapsule(lib: Library, week: string): Draft | null {
  const rnd = seeded(`${week}-capsule`)
  const lately = Date.now() - 60 * 86_400_000
  const recent = new Set(lib.plays.filter((p) => p.at >= lately).map((p) => songKey(fromPlay(p))))
  const seen = new Set<string>()
  const pick = (list: STrack[]): STrack[] =>
    list.filter((t) => {
      const k = songKey(t)
      if (recent.has(k) || seen.has(k)) return false
      seen.add(k)
      return true
    })
  const top = pick(lib.longTop)
  const old = pick(shuffle(lib.oldLiked, rnd))
  const tracks = spread([...top.slice(0, 24), ...old].slice(0, SIZE))
  if (tracks.length < 12) return null
  const artistNames = [...new Map(tracks.map((t) => [t.artists[0]?.id, t.artists[0]])).values()].filter(Boolean) as { name: string }[]
  return {
    kind: 'capsule',
    label: 'Time Capsule',
    title: 'Time Capsule',
    subtitle: names(artistNames),
    description: 'Your all-time favourites and old likes you haven’t played lately. Fresh every Monday.',
    tracks,
    art: tracks.map((t) => sp.pickImage(t.album?.images, 300)).filter((x): x is string => !!x),
    look: 11
  }
}

/* ---------- Names from the AI DJ's model ---------- */

/** Asks the DJ's model for a short name and a line for each daily mix; keeps ours if it can't. */
async function nameWithAi(drafts: Draft[]): Promise<void> {
  const daily = drafts.filter((d) => d.kind === 'daily')
  if (!daily.length) return
  const st = useApp.getState().settings
  try {
    if (st.djProvider === 'local' ? !(await window.pulse.dj.localReady()) : !st.djClaudeKey) return
    const prompt = [
      'Name these personal playlists. Each one is a group of artists that sound alike.',
      ...daily.map((d, i) => `${i + 1}. ${d.subtitle}`),
      'For each, give a short, catchy name of 2 to 4 words that describes the sound or the mood (not the artists’ names, no emoji, no quotes, no "Daily Mix"), and one short sentence about it, at most 14 words.',
      'Reply with JSON only: {"mixes":[{"name":"...","about":"..."}]} in the same order.'
    ].join('\n')
    const res = await Promise.race([
      window.pulse.dj.chat({
        provider: st.djProvider,
        model: st.djProvider === 'local' ? '' : st.djClaudeModel,
        apiKey: st.djClaudeKey,
        system: 'You name playlists for a music app. English only. Reply with JSON only.',
        messages: [{ role: 'user', content: prompt }],
        json: true
      }),
      pause(90_000).then(() => ({ ok: false as const, error: 'timeout' }))
    ])
    if (!res.ok) return
    const a = res.text.indexOf('{')
    const b = res.text.lastIndexOf('}')
    if (a < 0 || b < a) return
    const parsed = JSON.parse(res.text.slice(a, b + 1)) as { mixes?: { name?: unknown; about?: unknown }[] }
    parsed.mixes?.forEach((m, i) => {
      const d = daily[i]
      if (!d) return
      const name = typeof m.name === 'string' ? m.name.replace(/["“”]/g, '').trim() : ''
      if (name.length >= 3 && name.length <= 32 && !/daily mix/i.test(name)) d.title = name.replace(/\b\w/g, (c) => c.toUpperCase())
      const about = typeof m.about === 'string' ? m.about.trim() : ''
      if (about.length >= 8 && about.length <= 140) d.description = `${about} With ${names(d.subtitle.split(/, | and /).map((n) => ({ name: n })), 3)}.`
    })
  } catch (e) {
    console.info('[made for you] the AI could not name the mixes', e)
  }
}

/* ---------- Covers ---------- */

/** Colours for each look: daily mixes 1–6, On Repeat, Repeat Rewind, Discover Weekly,
 *  Release Radar, Deep Cuts, Time Capsule. */
const LOOKS: [string, string, string][] = [
  ['#ff4f8b', '#7a2cff', '#ffd1e3'],
  ['#2ad1c9', '#2a5cff', '#d3fff9'],
  ['#ffb547', '#ff3d6e', '#fff0d6'],
  ['#9be38f', '#1f8f6b', '#eaffe4'],
  ['#c77dff', '#3a0ca3', '#f0e0ff'],
  ['#ffd23f', '#ee4266', '#fff6cc'],
  ['#ff6a3d', '#c4127a', '#ffe1d6'],
  ['#3ddc97', '#00668a', '#d9fff0'],
  ['#7a5cff', '#00c2ff', '#e4e0ff'],
  ['#ff3d5a', '#ffb800', '#ffe9d1'],
  ['#1b1b3a', '#6c63ff', '#dcdaff'],
  ['#d4a373', '#6b3e26', '#fbeee0']
]

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

function coverFit(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number): void {
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight)
  const sw = w / s
  const sh = h / s
  ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, w, h)
}

/** Draws a cover: a picture (the group's artist, or covers) washed in the mix's colours, its
 *  name in big letters and "for {name}" at the top. */
async function drawCover(d: Draft, listener: string): Promise<string> {
  const S = 600
  const canvas = document.createElement('canvas')
  canvas.width = S
  canvas.height = S
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  const [c1, c2, light] = LOOKS[d.look % LOOKS.length]
  await document.fonts.load('800 80px "Bricolage Grotesque Variable"').catch(() => undefined)
  const font = '"Bricolage Grotesque Variable", "Figtree Variable", system-ui, sans-serif'

  // the background: the mix's two colours
  const bg = ctx.createLinearGradient(0, 0, S, S)
  bg.addColorStop(0, c1)
  bg.addColorStop(1, c2)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, S, S)

  // the pictures
  const sources = d.art.slice(0, 8)
  if (d.kind === 'daily' && sources[0] && !sources[0].startsWith('http')) {
    // an artist id: their photo, black and white, washed in colour
    const page = await window.pulse.artistQuick?.(sources[0]).catch(() => null)
    const photo = page?.avatar ? await loadImage(page.avatar) : null
    const img = photo ?? (sources[1] ? await loadImage(sources[1]) : null)
    if (img) {
      ctx.save()
      ctx.filter = 'grayscale(1) contrast(1.15)'
      coverFit(ctx, img, 0, 0, S, S)
      ctx.restore()
      ctx.globalCompositeOperation = 'multiply'
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, S, S)
      ctx.globalCompositeOperation = 'screen'
      ctx.globalAlpha = 0.35
      ctx.fillStyle = c1
      ctx.fillRect(0, 0, S, S)
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
    }
  } else if (d.kind === 'radar') {
    // radar rings with the newest cover in the middle
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'
    for (let r = 60; r < S; r += 60) {
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(S / 2, S * 0.44, r, 0, Math.PI * 2)
      ctx.stroke()
    }
    const img = sources[0] ? await loadImage(sources[0]) : null
    if (img) {
      ctx.save()
      ctx.beginPath()
      ctx.arc(S / 2, S * 0.44, 150, 0, Math.PI * 2)
      ctx.clip()
      coverFit(ctx, img, S / 2 - 150, S * 0.44 - 150, 300, 300)
      ctx.restore()
    }
  } else {
    // a tilted grid of covers, fading into the colour
    const imgs = (await Promise.all(sources.slice(0, 6).map(loadImage))).filter((x): x is HTMLImageElement => !!x)
    if (imgs.length) {
      ctx.save()
      ctx.translate(S / 2, S * 0.42)
      ctx.rotate(-0.16)
      const t = 210
      const gap = 14
      for (let i = 0; i < 6; i++) {
        const img = imgs[i % imgs.length]
        const col = i % 3
        const row = Math.floor(i / 3)
        const x = (col - 1.5) * (t + gap)
        const y = (row - 1) * (t + gap) + (col === 1 ? -40 : 0)
        ctx.save()
        ctx.beginPath()
        ctx.roundRect(x, y, t, t, 18)
        ctx.clip()
        coverFit(ctx, img, x, y, t, t)
        ctx.restore()
      }
      ctx.restore()
      ctx.globalAlpha = 0.5
      ctx.fillStyle = bg
      ctx.globalCompositeOperation = d.kind === 'discover' || d.kind === 'deep' ? 'color' : d.kind === 'capsule' ? 'multiply' : 'soft-light'
      ctx.fillRect(0, 0, S, S)
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
    }
  }

  // a dark fade at the bottom for the title
  const fade = ctx.createLinearGradient(0, S * 0.45, 0, S)
  fade.addColorStop(0, 'rgba(0,0,0,0)')
  fade.addColorStop(1, 'rgba(0,0,0,0.62)')
  ctx.fillStyle = fade
  ctx.fillRect(0, 0, S, S)

  // a light shade at the top too, so "for Nix" reads on busy covers
  const top = ctx.createLinearGradient(0, 0, 0, S * 0.22)
  top.addColorStop(0, 'rgba(0,0,0,0.38)')
  top.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = top
  ctx.fillRect(0, 0, S, S * 0.22)

  // "for Nix" at the top, the Pulse mark at the top right
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.font = `700 30px ${font}`
  ctx.textBaseline = 'top'
  ctx.fillText(listener ? `for ${listener}` : 'made for you', 36, 34)
  ctx.save()
  ctx.translate(S - 64, 50)
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 5
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(-20, 0)
  ctx.lineTo(-8, 0)
  ctx.lineTo(-2, -12)
  ctx.lineTo(6, 12)
  ctx.lineTo(12, 0)
  ctx.lineTo(24, 0)
  ctx.stroke()
  ctx.restore()

  // the name, as big as it fits on up to two lines
  const title = d.kind === 'daily' && d.title === d.label ? 'Daily Mix' : d.title
  const words = title.split(/\s+/)
  let size = 104
  let lines: string[] = []
  for (; size >= 44; size -= 4) {
    ctx.font = `800 ${size}px ${font}`
    lines = []
    let cur = ''
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w
      if (ctx.measureText(test).width > S - 72 && cur) {
        lines.push(cur)
        cur = w
      } else cur = test
    }
    lines.push(cur)
    if (lines.length <= 2 && lines.every((l) => ctx.measureText(l).width <= S - 72)) break
  }
  ctx.fillStyle = '#fff'
  ctx.textBaseline = 'alphabetic'
  const lh = size * 0.92
  const bottom = d.kind === 'daily' ? S - 92 : S - 44
  lines.forEach((l, i) => ctx.fillText(l, 34, bottom - (lines.length - 1 - i) * lh))
  // daily mixes keep their number big and their colour bar
  if (d.kind === 'daily') {
    ctx.fillStyle = light
    ctx.fillRect(36, S - 66, S - 72, 8)
    ctx.font = `800 34px ${font}`
    ctx.fillStyle = '#fff'
    ctx.textBaseline = 'top'
    const n = d.label.replace(/\D+/g, '')
    if (d.title !== d.label) ctx.fillText(d.label, 36, S - 46)
    else if (n) {
      ctx.font = `800 120px ${font}`
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(n, S - 36 - ctx.measureText(n).width, bottom)
    }
  }
  return canvas.toDataURL('image/jpeg', 0.86)
}

/* ---------- Making, saving, refreshing ---------- */

let saved: Saved | null = null
let making: Promise<void> | null = null

function save(): void {
  if (saved) void window.pulse.store.set('mixes', saved)
}

async function make(user: string, listener: string, keepWeekly: GenMix[], keepDaily: GenMix[]): Promise<void> {
  const day = dayKey()
  const week = weekKey()
  const lib = await readLibrary()
  if (lib.songs.size < 15) return // too little to go on yet; try again later
  const drafts: Draft[] = []
  const dailyFresh = !keepDaily.length
  if (dailyFresh) {
    drafts.push(...(await dailyMixes(lib, day)))
    const rep = onRepeat(lib)
    if (rep) drafts.push(rep)
    const rew = repeatRewind(lib)
    if (rew) drafts.push(rew)
  }
  if (!keepWeekly.length) {
    const dw = await discoverWeekly(lib, week)
    if (dw) drafts.push(dw)
    const rr = await releaseRadar(lib)
    if (rr) drafts.push(rr)
    const dc = await deepCuts(lib, week)
    if (dc) drafts.push(dc)
    const tc = timeCapsule(lib, week)
    if (tc) drafts.push(tc)
  }
  await nameWithAi(drafts)
  const made: GenMix[] = []
  for (const d of drafts) {
    const cover = await drawCover(d, listener).catch(() => '')
    made.push({
      id: d.kind === 'daily' ? `daily-${d.look + 1}` : d.kind,
      kind: d.kind,
      label: d.label,
      title: d.title,
      subtitle: d.subtitle,
      description: d.description,
      cover,
      tracks: d.tracks.map(slim),
      madeAt: Date.now()
    })
  }
  const order: MixKind[] = ['daily', 'discover', 'radar', 'repeat', 'deep', 'rewind', 'capsule']
  const all = [...made, ...keepDaily, ...keepWeekly].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.id.localeCompare(b.id))
  if (!all.length) return
  saved = { version: 2, user, day, week, mixes: all }
  save()
  // everything appears at once, when it's all ready
  useMadeForYou.setState({ mixes: all })
}

/* The last try is remembered across restarts: when making the mixes fails or is cut short, it
   isn't started again (with all its requests) every half hour or at every start, only after six
   hours or on a new day or week. */
const ATTEMPT_KEY = 'pulse-mfy-attempt'
function lastAttempt(): { day: string; week: string; at: number } | null {
  try {
    const a = JSON.parse(localStorage.getItem(ATTEMPT_KEY) ?? 'null') as { day: string; week: string; at: number } | null
    return a && typeof a.at === 'number' ? a : null
  } catch {
    return null
  }
}

/** Makes whatever is due: the daily mixes once a day, the weekly ones once a week. */
function refresh(): void {
  if (making) return
  const me = useApp.getState().me
  if (!me?.id) return
  const day = dayKey()
  const week = weekKey()
  const mine = saved?.user === me.id && saved.version === 2 ? saved : null
  const keepDaily = mine && mine.day === day ? mine.mixes.filter((m) => !isWeekly(m.kind)) : []
  const keepWeekly = mine && mine.week === week ? mine.mixes.filter((m) => isWeekly(m.kind)) : []
  const dailyDue = !keepDaily.length
  const weeklyDue = !keepWeekly.length
  if (!dailyDue && !weeklyDue) return
  const tried = lastAttempt()
  if (tried && Date.now() - tried.at < 6 * 3600_000 && (!dailyDue || tried.day === day) && (!weeklyDue || tried.week === week)) return
  try {
    localStorage.setItem(ATTEMPT_KEY, JSON.stringify({ day, week, at: Date.now() }))
  } catch {
    /* storage unavailable */
  }
  const listener = (me.display_name ?? '').split(/\s+/)[0] ?? ''
  making = make(me.id, listener, weeklyDue ? [] : keepWeekly, dailyDue ? [] : keepDaily)
    .catch((e) => console.warn('[made for you] could not make the mixes', e))
    .finally(() => (making = null))
}

/** Loads the saved mixes, then keeps them fresh. Call once after sign-in; returns a stop function. */
export function startMadeForYou(): () => void {
  let stopped = false
  void window.pulse.store.get<Saved>('mixes').then((d) => {
    const me = useApp.getState().me
    if (d && (d.version === 1 || d.version === 2) && Array.isArray(d.mixes)) {
      saved = d
      if (!me || d.user === me.id) useMadeForYou.setState({ mixes: d.mixes })
    }
    useMadeForYou.setState({ loaded: true })
  })
  // wait until the app has settled (and the listening history is read) before making anything
  const first = window.setTimeout(function tryNow() {
    if (stopped) return
    if (!useHistory.getState().loaded || !useApp.getState().me) {
      window.setTimeout(tryNow, 5000)
      return
    }
    refresh()
  }, 25_000)
  // a new day (or week) while Pulse stays open
  const hourly = window.setInterval(() => !document.hidden && refresh(), 30 * 60_000)
  return () => {
    stopped = true
    clearTimeout(first)
    clearInterval(hourly)
  }
}

export const madeMix = (id: string): GenMix | undefined => useMadeForYou.getState().mixes.find((m) => m.id === id)
