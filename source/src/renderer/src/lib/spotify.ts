// Thin Spotify Web API client. Endpoints follow the February 2026 Development Mode rules.
import type {
  CursorPaging,
  Paging,
  SAlbum,
  SAlbumRef,
  SArtist,
  SDevice,
  SPlaybackState,
  SPlaylist,
  SPlaylistItem,
  SearchResults,
  STrack,
  SUser
} from './types'

const BASE = 'https://api.spotify.com/v1'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
  }
}

type Query = Record<string, string | number | boolean | undefined | null>

interface Options {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  query?: Query
  body?: unknown
  /** Polls and prefetches: they give way when the app is busy, so taps always get through. */
  background?: boolean
  /** Background work that can wait (made-for-you mixes): it waits for room in the long
   *  windows instead of giving up. */
  patient?: boolean
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** When Spotify says "too many requests", every call waits until it allows them again,
 *  instead of each one retrying on its own and making it worse. */
/** Kept across restarts: reopening the app during a long block must not knock again. */
const BLOCK_KEY = 'pulse-blocked-until'
let blockedUntil = (() => {
  try {
    return Number(localStorage.getItem(BLOCK_KEY) ?? 0) || 0
  } catch {
    return 0
  }
})()
const setBlocked = (until: number): void => {
  blockedUntil = Math.max(blockedUntil, until)
  try {
    localStorage.setItem(BLOCK_KEY, String(blockedUntil))
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new CustomEvent('pulse:rate-limit', { detail: blockedUntil }))
}
/** 429 answers in a row; each one doubles the pause. */
let strikes = 0
/** When the last refusal came in (requests sent before it don't escalate again). */
let lastRefusalAt = 0
/** Only one Retry-After probe at a time. */
let probing: Promise<void> | null = null
/** Asks the main process how long Spotify really blocks us (it can read Retry-After). */
const learnRealBlock = (): Promise<void> =>
  (probing ??= (async () => {
    const secs = await window.pulse.auth.retryAfter?.().catch(() => null)
    if (secs && secs > 0) {
      setBlocked(Date.now() + secs * 1000)
      console.warn(`[api] Spotify blocks this app for ${Math.round(secs / 60)} min (Retry-After ${secs} s)`)
    }
  })().finally(() => {
    probing = null
  }))
export const rateLimited = (): boolean => Date.now() < blockedUntil
/** When Spotify allows requests again (epoch ms), or 0. The UI shows a notice until then. */
export const rateLimitedUntil = (): number => (rateLimited() ? blockedUntil : 0)

/* ---------- Request budget ----------
 * Spotify counts requests per app in a rolling 30 s window. Going over gets the whole app
 * blocked (minutes, sometimes hours). Pulse adapts instead of guessing one fixed number:
 *  - it starts generous (BUDGET per 30 s, enough for any page to load at once),
 *  - every refusal halves the allowance, and it grows back slowly while all is well, so it
 *    settles just under whatever Spotify really allows,
 *  - background work (polling, prefetch, the DJ) stops at a lower share, leaving room for taps,
 *  - the same GET asked twice at once is sent once, and a GET answered in the last few
 *    seconds is answered again from memory.
 */
const WINDOW = 30_000
const BUDGET = 60
const BG_BUDGET = 12
const MIN_SCALE = 0.25
/** Fraction of the budget in use: halves after a refusal, grows back 10 % every 2 minutes. */
let scale = (() => {
  try {
    return Math.min(1, Math.max(MIN_SCALE, Number(localStorage.getItem('pulse-budget2') ?? 1) || 1))
  } catch {
    return 1
  }
})()
const saveScale = (): void => {
  try {
    localStorage.setItem('pulse-budget2', String(scale))
  } catch {
    /* storage unavailable */
  }
}
setInterval(() => {
  if (scale < 1 && !rateLimited()) {
    scale = Math.min(1, scale + 0.1)
    saveScale()
  }
}, 2 * 60_000)

/** Thrown when a tap would have to wait for its turn: better a "slow down" than a ban. */
export class SlowDownError extends ApiError {
  constructor() {
    super(429, 'Easy there! Spotify only allows so many actions at once. Try again in a few seconds.')
  }
}
const sent: number[] = []
const prune = (): void => {
  const cutoff = Date.now() - WINDOW
  while (sent.length && sent[0] < cutoff) sent.shift()
}
/**
 * Waits for a free slot in the 30 s window. Taps (play, skip, like…) never queue up for
 * long: if no slot opens within 1.5 s the tap is refused, so hammering a button can't build
 * a backlog that keeps firing at Spotify.
 */
async function takeTurn(background: boolean, isTap = false, patient = false, poll = false): Promise<void> {
  // the long windows first (asking what is playing keeps the player right: it only counts
  // toward the overall caps, not the background ones)
  for (;;) {
    const wait = Math.max(overallWait(), background && !poll ? backgroundWait() : 0)
    if (!wait) break
    // a poll or prefetch just skips this round; patient work waits; a tap says so
    if (background && !patient) throw new DeferredError()
    if (isTap) throw new SlowDownError()
    await sleep(Math.min(wait, 60_000) + Math.random() * 2000)
  }
  // taps may use the whole budget; page loads leave 4 slots free for taps; polls stop at BG_BUDGET
  const cap = Math.max(isTap ? 3 : 2, Math.floor((isTap ? BUDGET : background ? BG_BUDGET : BUDGET - 10) * scale))
  const giveUpAt = Date.now() + 1500
  for (;;) {
    // while Spotify is refusing, nobody takes a slot (waiting requests must not all fire the
    // moment the block ends: each one still waits for its own turn after it)
    const blocked = blockedUntil - Date.now()
    if (blocked > 0) {
      if (isTap) throw new ApiError(429, 'Spotify is pausing Pulse for a moment. Try again when the notice is gone.')
      await sleep(blocked + Math.random() * 400)
      continue
    }
    prune()
    if (sent.length < cap) break
    const free = sent[0] + WINDOW - Date.now() + 50
    if (isTap && Date.now() + free > giveUpAt) throw new SlowDownError()
    await sleep(free)
  }
  sent.push(Date.now())
  count(background && !poll)
}

/* ---------- Long windows ----------
 * Spotify also blocks an app for hours (not minutes) when it keeps sending a lot over a longer
 * time, even if no 30 s window was ever full. So every request is also counted per minute for
 * the last 24 hours, kept across restarts, and:
 *  - background work (polls, prefetches, the made-for-you mixes) has small hard caps per
 *    10 minutes, hour and day, smaller still while the window is hidden (Pulse in the tray),
 *  - everything, taps included, waits in the rare case the app as a whole gets near what a
 *    long block was seen at; a person clicking around never gets close to that,
 *  - after any refusal, background work rests for two hours.
 */
const LEDGER_KEY = 'pulse-ledger1'
const BG_REST_KEY = 'pulse-bg-rest'
const MIN = 60_000
/** Requests per minute (epoch minute → count), last 24 h. */
const ledger = new Map<number, { all: number; bg: number }>(
  (() => {
    try {
      const raw = JSON.parse(localStorage.getItem(LEDGER_KEY) ?? '[]') as [number, number, number][]
      const from = Math.floor(Date.now() / MIN) - 24 * 60
      return raw.filter((r) => Array.isArray(r) && r[0] > from).map(([m, a, b]) => [m, { all: a, bg: b }] as [number, { all: number; bg: number }])
    } catch {
      return []
    }
  })()
)
let ledgerDirty = false
setInterval(() => {
  if (!ledgerDirty) return
  ledgerDirty = false
  const from = Math.floor(Date.now() / MIN) - 24 * 60
  for (const k of ledger.keys()) if (k <= from) ledger.delete(k)
  try {
    localStorage.setItem(LEDGER_KEY, JSON.stringify([...ledger.entries()].map(([m, c]) => [m, c.all, c.bg])))
  } catch {
    /* storage unavailable */
  }
}, 15_000)
function count(background: boolean): void {
  const m = Math.floor(Date.now() / MIN)
  const c = ledger.get(m) ?? { all: 0, bg: 0 }
  c.all++
  if (background) c.bg++
  ledger.set(m, c)
  ledgerDirty = true
}
function since(minutes: number): { all: number; bg: number } {
  const from = Math.floor(Date.now() / MIN) - minutes
  let all = 0
  let bg = 0
  for (const [m, c] of ledger) {
    if (m <= from) continue
    all += c.all
    bg += c.bg
  }
  return { all, bg }
}
/** Background caps: per 10 min, per hour, per day (the first one is lower while hidden). */
const BG_CAPS = { tenMin: 70, tenMinHidden: 25, hour: 260, day: 1600 }
/** Caps for everything together: far above what a person does, well below a long block. */
const ALL_CAPS = { tenMin: 700, hour: 2400, day: 12_000 }
let bgRestUntil = (() => {
  try {
    return Number(localStorage.getItem(BG_REST_KEY) ?? 0) || 0
  } catch {
    return 0
  }
})()
function restBackground(ms: number): void {
  bgRestUntil = Math.max(bgRestUntil, Date.now() + ms)
  try {
    localStorage.setItem(BG_REST_KEY, String(bgRestUntil))
  } catch {
    /* storage unavailable */
  }
}
/* The first two minutes after a start (an update restarts the app) belong to what's on screen:
   background work waits, so the start never sends everything at once. */
const appStartedAt = Date.now()
const START_CALM = 2 * 60_000

/** How long background work must wait for room (0 = it may go now). */
function backgroundWait(): number {
  if (Date.now() < bgRestUntil) return bgRestUntil - Date.now()
  if (Date.now() - appStartedAt < START_CALM) return START_CALM - (Date.now() - appStartedAt)
  const ten = since(10)
  const cap10 = document.hidden ? BG_CAPS.tenMinHidden : BG_CAPS.tenMin
  if (ten.bg >= cap10 || ten.all >= ALL_CAPS.tenMin * 0.6) return 60_000
  const hour = since(60)
  if (hour.bg >= BG_CAPS.hour || hour.all >= ALL_CAPS.hour * 0.6) return 5 * 60_000
  const day = since(24 * 60)
  if (day.bg >= BG_CAPS.day || day.all >= ALL_CAPS.day * 0.6) return 30 * 60_000
  return 0
}
/** How long anything must wait because the app as a whole sent a lot lately (0 = go). */
function overallWait(): number {
  if (since(10).all >= ALL_CAPS.tenMin) return 20_000
  if (since(60).all >= ALL_CAPS.hour) return 60_000
  if (since(24 * 60).all >= ALL_CAPS.day) return 5 * 60_000
  return 0
}
/** Thrown to background work when it has to wait for room (callers just skip that round). */
export class DeferredError extends ApiError {
  constructor() {
    super(503, 'Waiting for room in Spotify’s limits.')
  }
}
/** A different Spotify app key has its own allowance: forget the block and the counts. */
export function clearRateLimit(): void {
  blockedUntil = 0
  strikes = 0
  bgRestUntil = 0
  ledger.clear()
  scale = 1
  try {
    for (const k of [BLOCK_KEY, BG_REST_KEY, LEDGER_KEY, 'pulse-budget2']) localStorage.removeItem(k)
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new CustomEvent('pulse:rate-limit', { detail: 0 }))
}

/** For the Settings page or a debug line: requests in the last hour and day. */
export const requestCounts = (): { hour: { all: number; bg: number }; day: { all: number; bg: number } } => ({ hour: since(60), day: since(24 * 60) })

const inflight = new Map<string, Promise<unknown>>()
const recent = new Map<string, { at: number; value: unknown }>()
const RECENT_MS = 4000
/** Searches, songs, artists and album track lists hardly change: the same one asked again
 *  within 20 minutes (the DJ, autoplay and artist pages often ask the same) is answered from memory. */
const STATIC_MS = 20 * 60_000
const isStatic = (path: string): boolean => /^\/(search|tracks\/[A-Za-z0-9]+|artists\/[A-Za-z0-9]+|albums\/[A-Za-z0-9]+(\/tracks)?)$/.test(path)
/** Requests per endpoint in the last minutes, for spotting what eats the allowance. */
const usage = new Map<string, number>()
setInterval(() => {
  if (!usage.size) return
  const top = [...usage.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  console.info('[api] requests in the last 2 min:', top.map(([k, n]) => `${k} ${n}`).join(', '))
  usage.clear()
}, 120_000)

// Only the "what is playing" polls run in the background; opening the queue is a user action.
const isPlayerPoll = (path: string): boolean => /^\/me\/player(\/currently-playing)?(\?|$)/.test(path)

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const method = opts.method ?? 'GET'
  const background = opts.background ?? (method === 'GET' && isPlayerPoll(path))
  if (method !== 'GET') {
    // During a block a tap must not sit waiting for hours and then fire.
    if (rateLimited()) throw new ApiError(429, 'Spotify is pausing Pulse for a moment. Try again when the notice is gone.')
    // a change makes cached answers stale (searches, songs and artists stay)
    for (const k of [...recent.keys()]) if (!isStatic(k.slice(0, k.indexOf('?')))) recent.delete(k)
    await takeTurn(false, true)
    return rawApi<T>(path, opts)
  }
  const key = path + '?' + JSON.stringify(opts.query ?? {})
  const hit = recent.get(key)
  if (hit && Date.now() - hit.at < (isPlayerPoll(path) ? 1500 : isStatic(path) ? STATIC_MS : RECENT_MS)) return structuredClone(hit.value) as T
  // everyone gets their own copy, so a caller changing its answer can't change the cache
  const running = inflight.get(key)
  if (running) return running.then((v) => structuredClone(v)) as Promise<T>
  const p = (async () => {
    await takeTurn(background, false, !!opts.patient, isPlayerPoll(path))
    const value = await rawApi<T>(path, opts)
    recent.set(key, { at: Date.now(), value })
    if (recent.size > 500) recent.delete(recent.keys().next().value as string)
    return value
  })().finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p.then((v) => structuredClone(v))
}

async function rawApi<T = unknown>(path: string, opts: Options = {}, attempt = 0): Promise<T> {
  const token = await window.pulse.auth.token()
  if (!token) throw new ApiError(401, 'You are signed out.')

  const url = new URL(path.startsWith('http') ? path : BASE + path)
  usage.set(url.pathname.replace(/[A-Za-z0-9]{22}/g, ':id'), (usage.get(url.pathname.replace(/[A-Za-z0-9]{22}/g, ':id')) ?? 0) + 1)
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
  }

  const started = performance.now()
  const sentAt = Date.now()
  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {})
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
  })

  const took = Math.round(performance.now() - started)
  if (took > 1000) console.warn(`[api] slow: ${opts.method ?? 'GET'} ${url.pathname} ${res.status} in ${took} ms`)

  if (res.status === 429) {
    // The browser can't read Spotify's Retry-After header (CORS), so back off on our own:
    // 5 s, 10 s, 20 s… up to 2 minutes while Spotify keeps refusing. Requests made meanwhile
    // wait instead of adding to the pile, which is what keeps the block going.
    const header = Number(res.headers.get('Retry-After') ?? '')
    // Several requests refused in the same burst are one episode: only the first one that was
    // sent after the last refusal escalates (otherwise ten parallel refusals = ten halvings).
    if (sentAt < lastRefusalAt) throw new ApiError(429, 'Spotify is limiting requests for a moment. Try again shortly.')
    lastRefusalAt = Date.now()
    strikes++
    // background work rests for two hours after any refusal, so it can't keep a block going
    restBackground(2 * 3600_000)
    const after = header > 0 ? header : Math.min(120, 5 * 2 ** (strikes - 1))
    setBlocked(Date.now() + after * 1000)
    scale = Math.max(MIN_SCALE, scale * 0.5)
    saveScale()
    console.warn(`[api] rate limited, pausing ${after} s (${url.pathname})`)
    // The pause above is a guess; from the second refusal on, ask for the real length
    // (a long block can be hours, and knocking every 2 minutes keeps it going).
    if (!(header > 0) && strikes >= 2) void learnRealBlock()
    throw new ApiError(429, 'Spotify is limiting requests for a moment. Try again shortly.')
  }
  if (res.ok) strikes = 0
  // Spotify occasionally answers 500/502/503/504 for a moment; retry with backoff.
  if (res.status >= 500 && attempt < 3) {
    await sleep(350 * (attempt + 1) ** 2)
    return rawApi<T>(path, opts, attempt + 1)
  }
  if (res.status === 401 && attempt < 1) {
    await sleep(300)
    return rawApi<T>(path, opts, attempt + 1)
  }
  if (!res.ok) {
    let message =
      res.status >= 500 ? 'Spotify is not responding right now. Try again in a moment.' : `Spotify returned ${res.status}`
    try {
      const j = (await res.json()) as { error?: { message?: string } }
      if (j.error?.message) message = j.error.message
    } catch {
      /* empty body */
    }
    throw new ApiError(res.status, message)
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  if (!text) return undefined as T
  // Some player commands (shuffle, repeat) now answer 200 with a plain-text id, not JSON.
  try {
    return JSON.parse(text) as T
  } catch {
    return text as T
  }
}

/** Follows `next` links until everything (or `max` items) is loaded. */
async function all<T>(first: string, query: Query, max = 1000): Promise<T[]> {
  const out: T[] = []
  const page = await api<Paging<T>>(first, { query })
  out.push(...page.items)
  // the first page tells how many there are: fetch the rest all at once, not one by one
  const limit = page.limit || page.items.length || 50
  const total = Math.min(page.total ?? 0, max)
  if (!page.next) return out
  if (!total || typeof page.offset !== 'number') {
    // no count given: follow the pages one by one
    let p: Paging<T> = page
    while (p.next && out.length < max) {
      p = await api<Paging<T>>(p.next)
      out.push(...p.items)
    }
    return out
  }
  const offsets: number[] = []
  for (let o = (page.offset ?? 0) + limit; o < total; o += limit) offsets.push(o)
  const rest = await Promise.all(offsets.map((offset) => api<Paging<T>>(first, { query: { ...query, offset, limit } }).catch(() => null)))
  for (const r of rest) if (r) out.push(...r.items)
  return out.slice(0, max)
}

/* ---------- User & library ---------- */

export const getMe = (): Promise<SUser> => api<SUser>('/me')

export const getMyPlaylists = (): Promise<SPlaylist[]> =>
  all<SPlaylist>('/me/playlists', { limit: 50 }, 500)

export const getSavedTracks = (offset = 0): Promise<Paging<{ added_at: string; track: STrack }>> =>
  api('/me/tracks', { query: { limit: 50, offset } })

export const getSavedAlbums = (): Promise<{ added_at: string; album: SAlbumRef }[]> =>
  all('/me/albums', { limit: 50 }, 500)

export async function getFollowedArtists(): Promise<SArtist[]> {
  const out: SArtist[] = []
  let res = await api<{ artists: CursorPaging<SArtist> }>('/me/following', {
    query: { type: 'artist', limit: 50 }
  })
  out.push(...res.artists.items)
  while (res.artists.next && out.length < 500) {
    res = await api(res.artists.next)
    out.push(...res.artists.items)
  }
  return out
}

export const getRecentlyPlayed = (): Promise<CursorPaging<{ track: STrack; played_at: string }>> =>
  api('/me/player/recently-played', { query: { limit: 50 }, background: true, patient: true })

export type TimeRange = 'short_term' | 'medium_term' | 'long_term'

export const getTopTracks = (range: TimeRange = 'short_term', limit = 20): Promise<Paging<STrack>> =>
  api('/me/top/tracks', { query: { limit, time_range: range } })

export const getTopArtists = (range: TimeRange = 'medium_term', limit = 20): Promise<Paging<SArtist>> =>
  api('/me/top/artists', { query: { limit, time_range: range } })

/** All liked songs (up to `max`), newest first. */
export const getAllSavedTracks = (max = 2000): Promise<{ added_at: string; track: STrack }[]> =>
  all('/me/tracks', { limit: 50 }, max)

/** Generic library endpoints (Feb 2026): URIs, max 40 per call. */
/** Tells the player (and anything else) that these songs were liked or unliked, from anywhere. */
const libraryChanged = (uris: string[], saved: boolean): void => {
  window.dispatchEvent(new CustomEvent('pulse:library-changed', { detail: { uris, saved } }))
}

export const saveToLibrary = (uris: string[]): Promise<void> =>
  api<void>('/me/library', { method: 'PUT', query: { uris: uris.slice(0, 40).join(',') } }).then(() => libraryChanged(uris, true))

export const removeFromLibrary = (uris: string[]): Promise<void> =>
  api<void>('/me/library', { method: 'DELETE', query: { uris: uris.slice(0, 40).join(',') } }).then(() => libraryChanged(uris, false))

export const libraryContains = (uris: string[]): Promise<boolean[]> =>
  api('/me/library/contains', { query: { uris: uris.slice(0, 40).join(',') } })

/* ---------- Catalog ---------- */

export const getAlbum = (id: string): Promise<SAlbum> => api(`/albums/${id}`)

export const getAlbumTracks = (id: string): Promise<STrack[]> =>
  all<STrack>(`/albums/${id}/tracks`, { limit: 50 })

export const getTrack = (id: string): Promise<STrack> => api(`/tracks/${id}`)

export const getArtist = (id: string): Promise<SArtist> => api(`/artists/${id}`)

/** An artist's releases, newest first. Spotify now caps these pages at 10 for apps, so more
 *  pages follow one by one; if a later page fails, what already arrived is still shown. */
async function artistAlbums(id: string, groups: string, max: number): Promise<SAlbumRef[]> {
  const path = `/artists/${id}/albums`
  let page = await api<Paging<SAlbumRef>>(path, { query: { include_groups: groups, limit: 10 } })
  const out = [...page.items]
  while (page.next && out.length < max) {
    await sleep(150)
    try {
      page = await api<Paging<SAlbumRef>>(page.next)
    } catch (e) {
      console.warn('[api] stopped loading more releases', e)
      break
    }
    out.push(...page.items)
  }
  return out.filter((a) => a?.id)
}

export const getArtistAlbums = (id: string): Promise<SAlbumRef[]> => artistAlbums(id, 'album,single', 30) // 3 requests at most; the page usually brings the discography

export const getArtistAppearsOn = (id: string): Promise<SAlbumRef[]> => artistAlbums(id, 'appears_on', 10)

/**
 * An artist's albums and singles found through search. Spotify often refuses
 * /artists/{id}/albums for development-mode apps while search keeps working, so this is the
 * first choice (one to three requests).
 */
export async function getArtistReleasesBySearch(id: string, name: string, pages = 3): Promise<SAlbumRef[]> {
  // all pages at once (one round trip instead of three)
  const answers = await Promise.all(
    Array.from({ length: pages }, (_, p) =>
      api<SearchResults>('/search', { query: { q: `artist:"${name}"`, type: 'album', limit: 10, offset: p * 10 } }).catch(() => null)
    )
  )
  if (answers.every((a) => a === null)) throw new ApiError(503, 'Could not load the releases.')
  const seen = new Set<string>()
  return answers
    .flatMap((r) => r?.albums?.items ?? [])
    .filter((a): a is SAlbumRef => !!a?.id && a.artists?.some((x) => x.id === id) && !seen.has(a.id) && !!seen.add(a.id))
}

export const getPlaylist = (id: string): Promise<SPlaylist> => api(`/playlists/${id}`)

export const getPlaylistItems = (id: string): Promise<STrack[]> =>
  all<SPlaylistItem>(`/playlists/${id}/items`, { limit: 50 }, 2000).then((items) =>
    items.map((i) => i.item ?? i.track).filter((t): t is STrack => !!t && !!t.id)
  )

export interface PlaylistEntry {
  track: STrack
  addedAt: string | null
  /** Real position in the playlist (local files and removed songs are skipped in `track`). */
  pos: number
}

/** Playlist songs with the date each was added (for reordering, sorting and cleanup). */
export const getPlaylistEntries = (id: string): Promise<{ entries: PlaylistEntry[]; hidden: number }> =>
  all<SPlaylistItem>(`/playlists/${id}/items`, { limit: 50 }, 5000).then((items) => {
    const entries: PlaylistEntry[] = []
    items.forEach((i, pos) => {
      const t = i.item ?? i.track
      if (t && t.id) entries.push({ track: t, addedAt: i.added_at ?? null, pos })
    })
    return { entries, hidden: items.length - entries.length }
  })

export const search = (q: string, offset = 0): Promise<SearchResults> =>
  api('/search', { query: { q, type: 'track,artist,album,playlist', limit: 10, offset } })

/** Playlist owners whose name matches `q`, from a few pages of playlist results (users have
 *  no search of their own in the Web API). */
export async function searchPlaylistOwners(q: string): Promise<{ id: string; name: string }[]> {
  const norm = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  const want = norm(q)
  const pages = await Promise.all(
    [0, 10, 20, 30].map((offset) => api<SearchResults>('/search', { query: { q, type: 'playlist', limit: 10, offset } }).catch(() => null))
  )
  const out = new Map<string, { id: string; name: string }>()
  for (const p of pages)
    for (const pl of p?.playlists?.items ?? []) {
      const o = pl?.owner
      if (!o?.id || o.id === 'spotify') continue
      if (norm(o.display_name ?? '').includes(want) || norm(o.id).includes(want)) out.set(o.id, { id: o.id, name: o.display_name ?? o.id })
    }
  return [...out.values()]
}

export const searchArtists = (q: string): Promise<SArtist[]> =>
  api<SearchResults>('/search', { query: { q, type: 'artist', limit: 8 } }).then((r) => (r.artists?.items ?? []).filter((a): a is SArtist => !!a?.id))

export const searchTracks = (q: string, offset: number): Promise<SearchResults> =>
  api('/search', { query: { q, type: 'track', limit: 10, offset } })

/* ---------- Playlists ---------- */

export const createPlaylist = (name: string, description = ''): Promise<SPlaylist> =>
  api('/me/playlists', { method: 'POST', body: { name, description, public: false } })

export const updatePlaylist = (id: string, patch: { name?: string; description?: string }): Promise<void> =>
  api(`/playlists/${id}`, { method: 'PUT', body: patch })

export const addToPlaylist = (id: string, uris: string[], position?: number): Promise<{ snapshot_id: string }> =>
  api(`/playlists/${id}/items`, { method: 'POST', body: { uris, position } })

/** Adds any number of songs, 100 per request, in order. */
export async function addManyToPlaylist(id: string, uris: string[]): Promise<void> {
  for (let i = 0; i < uris.length; i += 100) await addToPlaylist(id, uris.slice(i, i + 100))
}

/** Moves one song inside a playlist. `insertBefore` uses Spotify's meaning (index before the move). */
export const movePlaylistItem = (
  id: string,
  rangeStart: number,
  insertBefore: number,
  snapshotId?: string
): Promise<{ snapshot_id: string }> =>
  api(`/playlists/${id}/items`, {
    method: 'PUT',
    body: { range_start: rangeStart, insert_before: insertBefore, range_length: 1, snapshot_id: snapshotId }
  })

/** Replaces the whole song list (first 100 in one call, the rest appended). */
export async function replacePlaylistItems(id: string, uris: string[]): Promise<void> {
  await api(`/playlists/${id}/items`, { method: 'PUT', body: { uris: uris.slice(0, 100) } })
  for (let i = 100; i < uris.length; i += 100) await addToPlaylist(id, uris.slice(i, i + 100))
}

/** Uploads a playlist cover: base64 JPEG (no data: prefix), at most 256 KB. */
export async function uploadPlaylistCover(id: string, base64Jpeg: string): Promise<void> {
  const token = await window.pulse.auth.token()
  const res = await fetch(`${BASE}/playlists/${id}/images`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg' },
    body: base64Jpeg
  })
  if (!res.ok) {
    let message = `Spotify returned ${res.status}`
    try {
      const j = (await res.json()) as { error?: { message?: string } }
      if (j.error?.message) message = j.error.message
    } catch {
      /* empty body */
    }
    throw new ApiError(res.status, message)
  }
}

export const removeFromPlaylist = (id: string, uris: string[]): Promise<void> =>
  api(`/playlists/${id}/items`, { method: 'DELETE', body: { items: uris.map((uri) => ({ uri })) } })

/** Removes every copy of these songs, 100 per request. */
export async function removeManyFromPlaylist(id: string, uris: string[]): Promise<void> {
  for (let i = 0; i < uris.length; i += 100) await removeFromPlaylist(id, uris.slice(i, i + 100))
}

/** Spotify has no hard delete; removing a playlist from your library unfollows it. */
export const deletePlaylist = (id: string): Promise<void> =>
  removeFromLibrary([`spotify:playlist:${id}`])

/* ---------- Player ---------- */

export const getPlaybackState = (): Promise<SPlaybackState | undefined> =>
  api('/me/player', { query: { additional_types: 'track,episode' } })

export const getDevices = (): Promise<{ devices: SDevice[] }> => api('/me/player/devices')

export const transferPlayback = (deviceId: string, play: boolean): Promise<void> =>
  api('/me/player', { method: 'PUT', body: { device_ids: [deviceId], play } })

export interface PlayRequest {
  contextUri?: string
  uris?: string[]
  offsetUri?: string
  offsetPosition?: number
  positionMs?: number
}

export const play = (req: PlayRequest, deviceId?: string): Promise<void> =>
  api('/me/player/play', {
    method: 'PUT',
    query: { device_id: deviceId },
    body: {
      context_uri: req.contextUri,
      uris: req.uris,
      offset: req.offsetUri
        ? { uri: req.offsetUri }
        : req.offsetPosition !== undefined
          ? { position: req.offsetPosition }
          : undefined,
      position_ms: req.positionMs
    }
  })

export const resume = (deviceId?: string): Promise<void> =>
  api('/me/player/play', { method: 'PUT', query: { device_id: deviceId } })

// Each command names the device explicitly, so it reaches the phone/speaker that is
// actually playing instead of whatever Spotify last considered active.
export const pause = (deviceId?: string): Promise<void> =>
  api('/me/player/pause', { method: 'PUT', query: { device_id: deviceId } })
export const next = (deviceId?: string): Promise<void> =>
  api('/me/player/next', { method: 'POST', query: { device_id: deviceId } })
export const previous = (deviceId?: string): Promise<void> =>
  api('/me/player/previous', { method: 'POST', query: { device_id: deviceId } })
export const seek = (ms: number, deviceId?: string): Promise<void> =>
  api('/me/player/seek', { method: 'PUT', query: { position_ms: Math.round(ms), device_id: deviceId } })
export const setVolume = (pct: number, deviceId?: string): Promise<void> =>
  api('/me/player/volume', { method: 'PUT', query: { volume_percent: Math.round(pct), device_id: deviceId } })
export const setShuffle = (on: boolean, deviceId?: string): Promise<void> =>
  api('/me/player/shuffle', { method: 'PUT', query: { state: on, device_id: deviceId } })
export const setRepeat = (state: 'off' | 'track' | 'context', deviceId?: string): Promise<void> =>
  api('/me/player/repeat', { method: 'PUT', query: { state, device_id: deviceId } })

/** What plays next. When nothing follows, Spotify fills the list with the current song over
 *  and over: those copies (and repeats) are dropped, so an empty list means "nothing next". */
export const getQueue = async (): Promise<{ currently_playing: STrack | null; queue: STrack[] }> => {
  const r = await api<{ currently_playing: STrack | null; queue: STrack[] }>('/me/player/queue')
  const cur = r.currently_playing?.id
  const seen = new Set<string>()
  const queue = (r.queue ?? []).filter((t) => t?.id && t.id !== cur && !seen.has(t.id) && !!seen.add(t.id))
  return { ...r, queue }
}

export const addToQueue = (uri: string): Promise<void> =>
  api('/me/player/queue', { method: 'POST', query: { uri } })

/* ---------- Helpers ---------- */

export function pickImage(images: { url: string; width: number | null }[] | null | undefined, size: number): string | null {
  if (!images || images.length === 0) return null
  const sorted = [...images].sort((a, b) => (a.width ?? 640) - (b.width ?? 640))
  return (sorted.find((i) => (i.width ?? 640) >= size) ?? sorted[sorted.length - 1]).url
}

export const idFromUri = (uri: string): string => uri.split(':').pop() ?? ''

export const playlistTotal = (p: SPlaylist): number => p.items?.total ?? p.tracks?.total ?? 0

/** "24 songs", or just "Playlist" when Spotify didn't say how many. */
export const playlistSongs = (p: SPlaylist): string => {
  const n = playlistTotal(p)
  return n ? `${n} ${n === 1 ? 'song' : 'songs'}` : 'Playlist'
}
