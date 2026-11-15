// Listening history: every song you listen to, wherever you play it. Pulse logs what it plays
// itself (30 s or half the song), pulls in what Spotify played on your other devices every few
// minutes, and can import your Spotify data download for the time before Pulse.
// It powers Stats, Replay, Recap and the profile.
import { create } from 'zustand'
import { usePlayer, type PlayerTrack } from './player'
import * as sp from './spotify'
import { getRecentlyPlayed, pickImage } from './spotify'
import type { STrack } from './types'

/** Where a play was seen: in Pulse, in another Spotify app (recently played), or in the
 *  Spotify data download. */
export type PlaySource = 'pulse' | 'spotify' | 'export'

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
  src?: PlaySource
}

interface HistoryState {
  plays: Play[]
  loaded: boolean
  /** When the Spotify data download was last imported, and what it covered. */
  imported: { at: number; from: number; to: number; plays: number } | null
}

export const useHistory = create<HistoryState>(() => ({ plays: [], loaded: false, imported: null }))

const MAX_PLAYS = 80_000
const MIN_LISTEN_MS = 30_000

/** Ids made up for plays that came without a Spotify id (the data download has names only). */
export const isRealId = (id: string | undefined): id is string => !!id && !id.startsWith('x:')
const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
/** One key per artist, so plays with and without ids count together. */
export const artistKey = (a: { name: string }): string => norm(a.name)
/** One key per song (title + main artist), the same across sources and re-releases. */
export const songKey = (p: { name: string; artists: { name: string }[] }): string => `${norm(p.name)}|${norm(p.artists[0]?.name ?? '')}`
const fakeId = (s: string): string => `x:${s}`

const sourceOf = (p: Play): PlaySource => p.src ?? 'pulse'
const RANK: Record<PlaySource, number> = { spotify: 1, export: 2, pulse: 3 }

let saveTimer: number | null = null
function save(): void {
  const { plays, imported } = useHistory.getState()
  void window.pulse.store.set('history', { version: 2, plays, imported })
}
function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    saveTimer = null
    save()
  }, 2000)
}

/** The same listen seen twice (by Pulse and by Spotify, or imported again): starts close together. */
const sameListen = (a: Play, b: Play): boolean =>
  !(sourceOf(a) === 'pulse' && sourceOf(b) === 'pulse') &&
  Math.abs(a.at - b.at) < Math.max(90_000, Math.min(6 * 60_000, Math.max(a.durationMs, b.durationMs) * 0.6))

/** Adds plays, merging any listen that's already there: the better source wins
 *  (Pulse's own log over the data download over Spotify's recently played). */
function add(incoming: Play[]): number {
  if (incoming.length === 0) return 0
  let added = 0
  useHistory.setState((s) => {
    const all = [...s.plays]
    const index = new Map<string, number[]>()
    all.forEach((p, i) => {
      const k = songKey(p)
      const list = index.get(k)
      if (list) list.push(i)
      else index.set(k, [i])
    })
    const drop = new Set<number>()
    for (const p of incoming) {
      const k = songKey(p)
      const list = index.get(k) ?? []
      const twin = list.find((i) => !drop.has(i) && sameListen(all[i], p))
      if (twin !== undefined) {
        if (RANK[sourceOf(p)] <= RANK[sourceOf(all[twin])]) continue
        drop.add(twin)
      }
      all.push(p)
      list.push(all.length - 1)
      index.set(k, list)
      added++
    }
    if (!added) return s
    const plays = all.filter((_, i) => !drop.has(i)).sort((a, b) => a.at - b.at)
    return { plays: plays.slice(-MAX_PLAYS) }
  })
  if (added) scheduleSave()
  return added
}

/** Pulls in what Spotify played lately (its last 50 plays), on this or any other device. */
async function importRecent(): Promise<void> {
  try {
    const page = await getRecentlyPlayed()
    const fresh: Play[] = []
    for (const it of page.items) {
      const t = it.track
      if (!t?.id) continue
      const ended = Date.parse(it.played_at)
      fresh.push({
        id: t.id,
        name: t.name,
        artists: t.artists.map((a) => ({ id: a.id, name: a.name })),
        album: { id: t.album?.id ?? '', name: t.album?.name ?? '' },
        art: pickImage(t.album?.images, 300),
        at: ended - t.duration_ms,
        ms: t.duration_ms,
        durationMs: t.duration_ms,
        src: 'spotify'
      })
    }
    // The song Pulse is playing right now is logged by Pulse when it ends.
    const now = usePlayer.getState().track
    add(fresh.filter((p) => !(now && p.id === now.id && Date.now() - p.at < p.durationMs + 60_000)))
  } catch (e) {
    console.warn('[history] could not import recently played', e)
  }
}

/* ---------- Spotify data download ---------- */

interface ExtendedRow {
  ts?: string
  ms_played?: number
  master_metadata_track_name?: string | null
  master_metadata_album_artist_name?: string | null
  master_metadata_album_album_name?: string | null
  spotify_track_uri?: string | null
}
interface BasicRow {
  endTime?: string
  artistName?: string
  trackName?: string
  msPlayed?: number
}

/** Reads Spotify's own history files: "Extended streaming history" (Streaming_History_Audio_*.json)
 *  or "Account data" (StreamingHistory_music_*.json). Podcasts and skips under 30 s are left out. */
export function parseSpotifyExport(rows: unknown, since: number): Play[] {
  if (!Array.isArray(rows)) return []
  const out: Play[] = []
  for (const r of rows as (ExtendedRow & BasicRow)[]) {
    if (!r || typeof r !== 'object') continue
    let name: string | null | undefined
    let artist: string | null | undefined
    let album = ''
    let ms = 0
    let end = NaN
    let id = ''
    if (typeof r.ts === 'string') {
      name = r.master_metadata_track_name
      artist = r.master_metadata_album_artist_name
      album = r.master_metadata_album_album_name ?? ''
      ms = Number(r.ms_played) || 0
      end = Date.parse(r.ts)
      const m = /^spotify:track:([A-Za-z0-9]+)$/.exec(r.spotify_track_uri ?? '')
      if (m) id = m[1]
    } else if (typeof r.endTime === 'string') {
      name = r.trackName
      artist = r.artistName
      ms = Number(r.msPlayed) || 0
      end = Date.parse(r.endTime.replace(' ', 'T') + 'Z')
    }
    if (!name || !artist || !Number.isFinite(end) || ms < MIN_LISTEN_MS) continue
    const at = end - ms
    if (at < since) continue
    out.push({
      id: id || fakeId(`${norm(name)}|${norm(artist)}`),
      name,
      artists: [{ id: fakeId(norm(artist)), name: artist }],
      album: { id: album ? fakeId(`${norm(album)}|${norm(artist)}`) : '', name: album },
      art: null,
      at,
      ms,
      durationMs: ms,
      src: 'export'
    })
  }
  return out
}

/** The history files inside the zip Spotify sends (or the JSON files themselves). */
async function readExportFiles(files: File[]): Promise<unknown[][]> {
  const wanted = (n: string): boolean => /(StreamingHistory|Streaming_History_Audio)[^/]*\.json$/i.test(n)
  const out: unknown[][] = []
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      for (const entry of await unzip(await f.arrayBuffer(), wanted)) out.push(JSON.parse(entry) as unknown[])
    } else if (/\.json$/i.test(f.name)) {
      out.push(JSON.parse(await f.text()) as unknown[])
    }
  }
  return out
}

/** A small zip reader (stored and deflated entries), enough for Spotify's download. */
async function unzip(buf: ArrayBuffer, want: (name: string) => boolean): Promise<string[]> {
  const v = new DataView(buf)
  let eocd = -1
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66_000); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('This zip file looks damaged.')
  const count = v.getUint16(eocd + 10, true)
  let p = v.getUint32(eocd + 16, true)
  const dec = new TextDecoder()
  const out: string[] = []
  for (let n = 0; n < count && v.getUint32(p, true) === 0x02014b50; n++) {
    const method = v.getUint16(p + 10, true)
    const size = v.getUint32(p + 20, true)
    const nameLen = v.getUint16(p + 28, true)
    const extraLen = v.getUint16(p + 30, true)
    const commentLen = v.getUint16(p + 32, true)
    const local = v.getUint32(p + 42, true)
    const name = dec.decode(new Uint8Array(buf, p + 46, nameLen))
    p += 46 + nameLen + extraLen + commentLen
    if (!want(name)) continue
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true)
    const data = new Uint8Array(buf, start, size)
    if (method === 0) out.push(dec.decode(data))
    else if (method === 8) {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
      out.push(await new Response(stream).text())
    }
  }
  return out
}

export interface ImportResult {
  added: number
  found: number
  from: number | null
  to: number | null
}

/** Imports Spotify's data download (the zip or its JSON files), from January last year on. */
export async function importSpotifyExport(files: File[]): Promise<ImportResult> {
  const since = new Date(new Date().getFullYear() - 1, 0, 1).getTime()
  const groups = await readExportFiles(files)
  const plays = groups.flatMap((g) => parseSpotifyExport(g, since))
  if (!plays.length) return { added: 0, found: 0, from: null, to: null }
  const from = Math.min(...plays.map((p) => p.at))
  const to = Math.max(...plays.map((p) => p.at))
  const added = add(plays)
  useHistory.setState({ imported: { at: Date.now(), from, to, plays: plays.length } })
  scheduleSave()
  void enrich()
  return { added, found: plays.length, from, to }
}

/* ---------- Filling in ids and covers ---------- */

let enriching: Promise<void> | null = null
/* What was already looked up (found or not) is remembered across restarts for two weeks, and
   each round looks up only a few: an imported history of thousands of songs used to send
   hundreds of requests every few minutes, which got the whole app blocked for hours. */
const TRIED_KEY = 'pulse-enrich-tried'
const TRIED_MS = 14 * 86_400_000
const triedAt = new Map<string, number>(
  (() => {
    try {
      const raw = JSON.parse(localStorage.getItem(TRIED_KEY) ?? '[]') as [string, number][]
      return raw.filter((r) => Array.isArray(r) && Date.now() - r[1] < TRIED_MS)
    } catch {
      return []
    }
  })()
)
const tried = {
  has: (k: string): boolean => {
    const at = triedAt.get(k)
    return !!at && Date.now() - at < TRIED_MS
  },
  add: (k: string): void => {
    triedAt.set(k, Date.now())
  }
}
function saveTried(): void {
  try {
    const list = [...triedAt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6000)
    localStorage.setItem(TRIED_KEY, JSON.stringify(list))
  } catch {
    /* storage unavailable */
  }
}
/** Songs and artists looked up per round, and how often a round may run. */
const SONGS_PER_ROUND = 30
const ARTISTS_PER_ROUND = 15
const ROUND_EVERY = 30 * 60_000
let lastRound = 0
// background work that waits for room in Spotify's limits instead of crowding out the app
const bgTrack = (id: string): Promise<STrack> => sp.api<STrack>(`/tracks/${id}`, { background: true, patient: true })
const bgSearchTrack = (q: string): Promise<STrack[]> =>
  sp
    .api<{ tracks?: { items: (STrack | null)[] } }>('/search', { query: { q, type: 'track', limit: 5 }, background: true, patient: true })
    .then((r) => (r.tracks?.items ?? []).filter((t): t is STrack => !!t?.id))
const bgSearchArtist = (q: string): Promise<{ id: string; name: string }[]> =>
  sp
    .api<{ artists?: { items: ({ id: string; name: string } | null)[] } }>('/search', { query: { q, type: 'artist', limit: 5 }, background: true, patient: true })
    .then((r) => (r.artists?.items ?? []).filter((a): a is { id: string; name: string } => !!a?.id))

/** Imported plays come with names only. For the songs and artists you play most, this finds
 *  them on Spotify so they get covers, photos and play buttons. */
export function enrich(): Promise<void> {
  if (enriching) return enriching
  if (Date.now() - lastRound < ROUND_EVERY) return Promise.resolve()
  lastRound = Date.now()
  enriching = (async () => {
    try {
      await enrichSongs()
      await enrichArtists()
    } catch (e) {
      console.warn('[history] could not fill in imported plays', e)
    } finally {
      saveTried()
      enriching = null
    }
  })()
  return enriching
}

async function pool<T>(items: T[], run: (t: T) => Promise<void>, size = 2): Promise<void> {
  let i = 0
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (i < items.length) {
        const t = items[i++]
        await run(t).catch(() => undefined)
      }
    })
  )
}

async function enrichSongs(): Promise<void> {
  const plays = useHistory.getState().plays
  const known = new Map<string, Play>()
  for (const p of plays) if (p.art && isRealId(p.id)) known.set(songKey(p), p)
  const totals = new Map<string, { ms: number; p: Play }>()
  for (const p of plays) {
    if (p.art) continue
    const k = songKey(p)
    const t = totals.get(k) ?? { ms: 0, p }
    t.ms += p.ms
    totals.set(k, t)
  }
  const found = new Map<string, Pick<Play, 'id' | 'name' | 'artists' | 'album' | 'art' | 'durationMs'>>()
  const todo: Play[] = []
  for (const [k, t] of [...totals].sort((a, b) => b[1].ms - a[1].ms)) {
    const own = known.get(k)
    if (own) found.set(k, own)
    else if (!tried.has(k) && todo.length < SONGS_PER_ROUND) todo.push(t.p)
  }
  // two at a time: it's background work
  await pool(todo, async (p) => {
    const k = songKey(p)
    tried.add(k)
    // one request per song: by its id when the import had it, otherwise one search
    let t: STrack | null = null
    if (isRealId(p.id)) t = await bgTrack(p.id).catch(() => null)
    else {
      const items = await bgSearchTrack(`track:"${p.name}" artist:"${p.artists[0]?.name ?? ''}"`).catch(() => [] as STrack[])
      t = items.find((x) => songKey({ name: x.name, artists: x.artists }) === k) ?? null
    }
    if (!t?.id) return
    found.set(k, {
      id: t.id,
      name: t.name,
      artists: t.artists.map((a) => ({ id: a.id, name: a.name })),
      album: { id: t.album?.id ?? '', name: t.album?.name ?? '' },
      art: pickImage(t.album?.images, 300),
      durationMs: t.duration_ms
    })
  })
  if (!found.size) return
  useHistory.setState((s) => ({
    plays: s.plays.map((p) => {
      if (p.art) return p
      const f = found.get(songKey(p))
      return f ? { ...p, id: f.id, name: f.name, artists: f.artists, album: f.album, art: f.art, durationMs: f.durationMs || p.durationMs } : p
    })
  }))
  scheduleSave()
}

async function enrichArtists(): Promise<void> {
  const plays = useHistory.getState().plays
  const real = new Map<string, string>()
  const totals = new Map<string, { ms: number; name: string }>()
  for (const p of plays)
    for (const a of p.artists) {
      const k = artistKey(a)
      if (isRealId(a.id)) real.set(k, a.id)
      else {
        const t = totals.get(k) ?? { ms: 0, name: a.name }
        t.ms += p.ms
        totals.set(k, t)
      }
    }
  const todo = [...totals]
    .filter(([k]) => !real.has(k) && !tried.has(`a:${k}`))
    .sort((a, b) => b[1].ms - a[1].ms)
    .slice(0, ARTISTS_PER_ROUND)
  await pool(todo, async ([k, t]) => {
    tried.add(`a:${k}`)
    const hit = (await bgSearchArtist(t.name).catch(() => [])).find((a) => artistKey(a) === k)
    if (hit) real.set(k, hit.id)
  })
  let changed = false
  const fixed = useHistory.getState().plays.map((p) => {
    if (p.artists.every((a) => isRealId(a.id))) return p
    const artists = p.artists.map((a) => (isRealId(a.id) ? a : { ...a, id: real.get(artistKey(a)) ?? a.id }))
    if (artists.every((a, i) => a.id === p.artists[i].id)) return p
    changed = true
    return { ...p, artists }
  })
  if (!changed) return
  useHistory.setState({ plays: fixed })
  scheduleSave()
}

/** Starts logging. Call once after sign-in; returns a stop function. */
export function startHistory(): () => void {
  let current: PlayerTrack | null = null
  let startedAt = 0
  let listened = 0
  let lastTick = performance.now()

  void window.pulse.store.get<{ version?: number; plays: Play[]; imported?: HistoryState['imported'] }>('history').then((d) => {
    // Version 1 didn't say where a play came from: Spotify's ones were logged at full length.
    const saved = (d?.plays ?? []).map((p): Play => (p.src || (d?.version ?? 1) >= 2 ? p : { ...p, src: p.ms === p.durationMs ? 'spotify' : 'pulse' }))
    useHistory.setState((s) => ({
      plays: [...saved, ...s.plays].sort((a, b) => a.at - b.at),
      imported: d?.imported ?? null,
      loaded: true
    }))
    void importRecent().then(() => enrich())
  })

  // What you play in other Spotify apps shows up every few minutes (Spotify keeps only the
  // last 50 plays, so this can't wait for long).
  let lastImport = Date.now()
  const pull = (): void => {
    if (Date.now() - lastImport < 60_000) return
    lastImport = Date.now()
    void importRecent()
  }
  // Spotify keeps the last 50 plays (two hours or more of music), so every 8 minutes is plenty,
  // and every 20 while the window is hidden.
  let lastTimed = Date.now()
  const poll = window.setInterval(() => {
    if (Date.now() - lastTimed < (document.hidden ? 20 : 8) * 60_000) return
    lastTimed = Date.now()
    lastImport = 0
    pull()
  }, 60_000)
  window.addEventListener('focus', pull)

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
          durationMs: current.durationMs,
          src: 'pulse'
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
    save()
  }
  window.addEventListener('beforeunload', onUnload)

  return () => {
    clearInterval(tick)
    clearInterval(poll)
    window.removeEventListener('focus', pull)
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
  /** Time by where it was played. */
  bySource: Record<PlaySource, number>
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
  const bySource: Record<PlaySource, number> = { pulse: 0, spotify: 0, export: 0 }
  let ms = 0
  for (const p of list) {
    ms += p.ms
    bySource[sourceOf(p)] += p.ms
    // Songs and artists count together by name, whether or not a play has its Spotify id;
    // the version with an id (and a cover) is the one shown.
    const sk = songKey(p)
    const song = songs.get(sk) ?? { item: p, plays: 0, ms: 0 }
    if ((!song.item.art && p.art) || (!isRealId(song.item.id) && isRealId(p.id))) song.item = p
    song.plays++
    song.ms += p.ms
    songs.set(sk, song)
    p.artists.forEach((a, i) => {
      const ak = artistKey(a)
      const r = artists.get(ak) ?? { item: a, plays: 0, ms: 0 }
      if (!isRealId(r.item.id) && isRealId(a.id)) r.item = a
      r.plays++
      // The main artist gets the full credit, featured artists a share.
      r.ms += i === 0 ? p.ms : p.ms * 0.35
      artists.set(ak, r)
    })
    if (p.album.name) {
      const bk = `${norm(p.album.name)}|${artistKey(p.artists[0] ?? { name: '' })}`
      const r = albums.get(bk) ?? {
        item: { ...p.album, art: p.art, artist: p.artists[0]?.name ?? '' },
        plays: 0,
        ms: 0
      }
      if (!r.item.art && p.art) r.item = { ...p.album, art: p.art, artist: p.artists[0]?.name ?? '' }
      r.plays++
      r.ms += p.ms
      albums.set(bk, r)
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
    bySource,
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
