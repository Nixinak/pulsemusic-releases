// Your Spotify web account, signed in once inside Pulse (its own window, its own cookies on
// this computer). It unlocks two things Spotify's Web API doesn't offer:
//  - Friend Activity: what the people you follow on Spotify are playing (the list the Spotify
//    desktop app shows on the right),
//  - Spotify's own lyrics, line-synced for many songs LRCLIB doesn't have.
// Both are read the way the Spotify web player reads them. Nothing here counts against Pulse's
// Web API allowance, and the sign-in never leaves this computer.
import { app, BrowserWindow, session } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SpotifyFriend, SpotifyLyrics } from '@shared/types'

const PARTITION = 'persist:spotify-account'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'

const ses = (): Electron.Session => {
  const s = session.fromPartition(PARTITION)
  s.setUserAgent(UA, 'en-US,en')
  return s
}

/** Signed in: Spotify's login cookie is there. */
async function signedIn(): Promise<boolean> {
  const c = await ses()
    .cookies.get({ name: 'sp_dc' })
    .catch(() => [])
  return c.some((x) => !!x.value)
}

/* ---------- The web player's token ----------
 * The web player sends its own short-lived token with every request it makes. Pulse opens the
 * web player hidden for a moment, notes that token from the requests, and closes it again. */
let token: { value: string; clientToken: string | null; at: number } | null = null
let fetching: Promise<string | null> | null = null
const TOKEN_MS = 40 * 60_000

function captureToken(): Promise<string | null> {
  return new Promise((resolve) => {
    const s = ses()
    let done = false
    const win = new BrowserWindow({
      show: false,
      width: 1200,
      height: 800,
      webPreferences: {
        session: s,
        backgroundThrottling: false,
        sandbox: true
      }
    })
    win.webContents.setAudioMuted(true)
    const finish = (v: string | null): void => {
      if (done) return
      done = true
      s.webRequest.onBeforeSendHeaders(null)
      clearTimeout(timer)
      if (!win.isDestroyed()) win.destroy()
      resolve(v)
    }
    s.webRequest.onBeforeSendHeaders({ urls: ['https://*.spotify.com/*'] }, (d, cb) => {
      const h = d.requestHeaders
      const auth = h.Authorization ?? h.authorization
      if (auth && /^Bearer\s+\S{40,}/.test(auth)) {
        token = {
          value: auth.replace(/^Bearer\s+/, ''),
          clientToken: h['client-token'] ?? h['Client-Token'] ?? null,
          at: Date.now()
        }
        // the next tick, so this request still goes through
        setTimeout(() => finish(token!.value), 0)
      }
      cb({ requestHeaders: h })
    })
    const timer = setTimeout(() => finish(null), 25_000)
    win.loadURL('https://open.spotify.com/', { userAgent: UA }).catch(() => undefined)
  })
}

async function webToken(fresh = false): Promise<string | null> {
  if (!fresh && token && Date.now() - token.at < TOKEN_MS) return token.value
  if (!(await signedIn())) return null
  fetching ??= captureToken().finally(() => (fetching = null))
  return fetching
}

async function webGet<T>(url: string, extra: Record<string, string> = {}, body?: unknown): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const t = await webToken(attempt > 0)
    if (!t) return null
    const res = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        Authorization: `Bearer ${t}`,
        'User-Agent': UA,
        Accept: 'application/json',
        'app-platform': 'WebPlayer',
        ...(token?.clientToken ? { 'client-token': token.clientToken } : {}),
        ...extra
      },
      signal: AbortSignal.timeout(10_000)
    }).catch(() => null)
    if (!res) return null
    if (res.status === 401) continue
    if (!res.ok) return null
    return (await res.json().catch(() => null)) as T | null
  }
  return null
}

/* ---------- The Web API through the web player's token ----------
 * Spotify gives every developer app a small daily quota; going over blocks the app for most of
 * a day. Requests sent with the web player's token are the web player's own, so they don't
 * count against Pulse's quota at all. The page sends its Web API calls here first and uses
 * Pulse's own key only when this says no (not signed in, refused, or blocked). */
export interface WebApiAnswer {
  status: number
  body: string
  /** Seconds, from Spotify's Retry-After header (0 when missing). */
  retryAfter: number
}
export async function spotifyWebApi(method: string, url: string, body?: string): Promise<WebApiAnswer | null> {
  if (!/^https:\/\/api\.spotify\.com\/v1\//.test(url) || !/^(GET|POST|PUT|DELETE)$/.test(method)) return null
  for (let attempt = 0; attempt < 2; attempt++) {
    const t = await webToken(attempt > 0)
    if (!t) return null
    const res = await fetch(url, {
      method,
      body: body === undefined ? undefined : body,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        Authorization: `Bearer ${t}`,
        'User-Agent': UA,
        Accept: 'application/json',
        'app-platform': 'WebPlayer'
      },
      signal: AbortSignal.timeout(12_000)
    }).catch(() => null)
    if (!res) return null
    if (res.status === 401 && attempt === 0) continue
    return { status: res.status, body: await res.text().catch(() => ''), retryAfter: Number(res.headers.get('retry-after') ?? 0) || 0 }
  }
  return null
}

/* ---------- Signing in ---------- */

let loginWin: BrowserWindow | null = null

/** Opens Spotify's sign-in page; resolves true once signed in (false if the window is closed). */
export function connectSpotifyAccount(parent: BrowserWindow | null): Promise<boolean> {
  if (loginWin && !loginWin.isDestroyed()) {
    loginWin.focus()
    return Promise.resolve(false)
  }
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 480,
      height: 760,
      parent: parent ?? undefined,
      title: 'Sign in to Spotify',
      autoHideMenuBar: true,
      backgroundColor: '#121212',
      webPreferences: { session: ses(), sandbox: true }
    })
    loginWin = win
    let settled = false
    const check = setInterval(async () => {
      if (win.isDestroyed() || !(await signedIn())) return
      clearInterval(check)
      settled = true
      token = null
      win.destroy()
      resolve(true)
    }, 800)
    win.on('closed', () => {
      clearInterval(check)
      loginWin = null
      if (!settled) void signedIn().then(resolve)
    })
    win.loadURL('https://accounts.spotify.com/login?continue=https%3A%2F%2Fopen.spotify.com%2F', { userAgent: UA }).catch(() => undefined)
  })
}

export async function disconnectSpotifyAccount(): Promise<void> {
  token = null
  await ses()
    .clearStorageData()
    .catch(() => undefined)
}

export async function spotifyAccountStatus(): Promise<{ connected: boolean }> {
  return { connected: await signedIn() }
}

/* ---------- Friend Activity ---------- */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any
const idOf = (uri: unknown): string =>
  String(uri ?? '')
    .split(':')
    .pop() ?? ''

let friendsCache: { at: number; list: SpotifyFriend[] } | null = null

/** The last answer, without anything personal beyond names, for a support question later. */
function noteRaw(how: string, j: Json): void {
  try {
    const sample = Array.isArray(j?.friends) ? { friends: j.friends.length, first: j.friends[0] ?? null } : { keys: j ? Object.keys(j) : null }
    writeFileSync(join(app.getPath('userData'), 'spotify-friends-debug.json'), JSON.stringify({ at: new Date().toISOString(), how, sample }, null, 2))
  } catch {
    /* only a note */
  }
}

/** Reads one entry of the list, whichever shape Spotify sends. */
function toFriend(f: Json): SpotifyFriend | null {
  const user = f?.user ?? f?.userInfo
  const track = f?.track ?? f?.trackInfo ?? f?.currentTrack
  if (!user?.uri || !track?.uri) return null
  return {
    id: decodeURIComponent(idOf(user.uri)),
    name: String(user.name ?? user.displayName ?? ''),
    image: user.imageUrl || user.image || null,
    at: Number(f.timestamp ?? f.lastUpdate) || 0,
    track: {
      id: idOf(track.uri),
      uri: String(track.uri),
      name: String(track.name ?? ''),
      image: track.imageUrl || track.album?.imageUrl || null,
      artist: {
        id: idOf(track.artist?.uri),
        name: String(track.artist?.name ?? '')
      },
      album: {
        id: idOf(track.album?.uri),
        name: String(track.album?.name ?? '')
      },
      context: track.context?.uri
        ? {
            uri: String(track.context.uri),
            name: String(track.context.name ?? '')
          }
        : null
    }
  }
}

const parse = (j: Json): SpotifyFriend[] | null =>
  Array.isArray(j?.friends)
    ? (j.friends as Json[])
        .map(toFriend)
        .filter((x): x is SpotifyFriend => !!x)
        .sort((a, b) => b.at - a.at)
    : null

/**
 * The list the web player itself loads, read from inside it: the web player is opened hidden
 * (wide, so its Friend Activity panel is there), and its own buddylist answer is noted. Used when
 * asking directly gives nothing, which happens when Spotify changes how it wants to be asked.
 */
function fromWebPlayer(): Promise<Json | null> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      show: false,
      width: 1800,
      height: 1100,
      webPreferences: {
        session: ses(),
        backgroundThrottling: false,
        sandbox: true
      }
    })
    win.webContents.setAudioMuted(true)
    const dbg = win.webContents.debugger
    let done = false
    const finish = (v: Json | null): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        dbg.detach()
      } catch {
        /* already */
      }
      if (!win.isDestroyed()) win.destroy()
      resolve(v)
    }
    const timer = setTimeout(() => finish(null), 30_000)
    const wanted = new Set<string>()
    try {
      dbg.attach('1.3')
    } catch {
      return finish(null)
    }
    dbg.on('message', (_e, method: string, params: Json) => {
      if (method === 'Network.responseReceived' && /buddylist/i.test(String(params?.response?.url ?? ''))) wanted.add(params.requestId)
      if (method === 'Network.loadingFinished' && wanted.has(params?.requestId)) {
        void dbg
          .sendCommand('Network.getResponseBody', {
            requestId: params.requestId
          })
          .then((r: { body: string; base64Encoded: boolean }) => {
            const text = r.base64Encoded ? Buffer.from(r.body, 'base64').toString('utf8') : r.body
            const j = JSON.parse(text) as Json
            if (Array.isArray(j?.friends)) finish(j)
          })
          .catch(() => undefined)
      }
    })
    void dbg.sendCommand('Network.enable').catch(() => undefined)
    win.loadURL('https://open.spotify.com/', { userAgent: UA }).catch(() => undefined)
  })
}

/* ---------- The listening activity feed ----------
 * What Spotify's own Friend Activity reads now (the old buddylist leaves out many people and is
 * often days behind). The feed has only ids, so names and pictures are looked up (and kept). */
const B62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
const idToGid = (id: string): string => {
  let n = 0n
  for (const ch of id) n = n * 62n + BigInt(B62.indexOf(ch))
  return n.toString(16).padStart(32, '0')
}
const gidToId = (gid: string): string => {
  let n = BigInt(`0x${gid}`)
  let id = ''
  while (n > 0n) {
    id = B62[Number(n % 62n)] + id
    n /= 62n
  }
  return id.padStart(22, '0')
}
const lookups = new Map<string, Promise<Json | null>>()
const lookup = (key: string, load: () => Promise<Json | null>): Promise<Json | null> => {
  let p = lookups.get(key)
  if (!p) {
    p = load().then((v) => {
      if (!v) lookups.delete(key)
      return v
    })
    lookups.set(key, p)
  }
  return p
}
const coverOf = (album: Json): string | null => {
  const imgs: Json[] = album?.cover_group?.image ?? album?.cover ?? []
  const best = imgs.find((i) => i.size === 'DEFAULT') ?? imgs.find((i) => i.size === 'LARGE') ?? imgs[0]
  return best?.file_id ? `https://i.scdn.co/image/${best.file_id}` : null
}

async function fromFeed(): Promise<SpotifyFriend[] | null> {
  const feed = await webGet<Json>('https://spclient.wg.spotify.com/listening-activity/v1/feed', {}, { unused: true, resultLimit: 100 })
  if (!feed || !Array.isArray(feed.entities)) return null
  noteRaw('feed', { friends: feed.entities })
  const list = await Promise.all(
    (feed.entities as Json[]).map(async (item): Promise<SpotifyFriend | null> => {
      const e = item.userEntity ?? item.followEntity
      const a = e?.activity
      if (!e?.uri || !String(a?.entityUri ?? '').startsWith('spotify:track:')) return null
      const userId = idOf(e.uri)
      const trackId = idOf(a.entityUri)
      const [profile, track] = await Promise.all([
        lookup(e.uri, () => webGet<Json>(`https://spclient.wg.spotify.com/user-profile-view/v3/profile/${encodeURIComponent(userId)}`)),
        lookup(a.entityUri, () => webGet<Json>(`https://spclient.wg.spotify.com/metadata/4/track/${idToGid(trackId)}?market=from_token`))
      ])
      if (!track) return null
      const artist = (track.artist ?? [])[0]
      const ctxUri = String(a.contextUri ?? '')
      let context: SpotifyFriend['track']['context'] = null
      if (ctxUri.endsWith(':collection')) context = { uri: ctxUri, name: 'Liked Songs' }
      else if (/^spotify:(album|artist):/.test(ctxUri)) {
        const [, type, cid] = ctxUri.split(':')
        const meta = await lookup(ctxUri, () => webGet<Json>(`https://spclient.wg.spotify.com/metadata/4/${type}/${idToGid(cid)}?market=from_token`))
        if (meta?.name) context = { uri: ctxUri, name: String(meta.name) }
      } else if (ctxUri.startsWith('spotify:playlist:')) context = { uri: ctxUri, name: 'a playlist' }
      return {
        id: decodeURIComponent(userId),
        name: String(profile?.name ?? userId),
        image: profile?.image_url || null,
        at: Date.parse(a.timestamp) || Number(a.timestamp) || 0,
        playing: a.isPlaying === true,
        track: {
          id: trackId,
          uri: String(a.entityUri),
          name: String(track.name ?? ''),
          image: coverOf(track.album),
          artist: { id: artist?.gid ? gidToId(artist.gid) : '', name: String(artist?.name ?? '') },
          album: { id: track.album?.gid ? gidToId(track.album.gid) : '', name: String(track.album?.name ?? '') },
          context
        }
      }
    })
  )
  return list.filter((x): x is SpotifyFriend => !!x).sort((x, y) => Number(!!y.playing) - Number(!!x.playing) || y.at - x.at)
}

let deepAt = 0

export async function spotifyFriends(): Promise<SpotifyFriend[] | null> {
  // at most every 30 s, however many pages ask
  if (friendsCache && Date.now() - friendsCache.at < 30_000) return friendsCache.list
  // Spotify's current feed first; the old buddylist only when that doesn't answer
  let list: SpotifyFriend[] | null = await fromFeed().catch(() => null)
  if (!list?.length) {
    let raw: Json = null
    for (const host of ['https://guc-spclient.spotify.com', 'https://spclient.wg.spotify.com']) {
      raw = await webGet<Json>(`${host}/presence-view/v1/buddylist`)
      const old = parse(raw)
      if (old?.length) {
        list = old
        break
      }
    }
    noteRaw('buddylist', raw)
  }
  // nothing either way: ask the web player (at most every 5 minutes, it takes a few seconds)
  if (!list?.length && Date.now() - deepAt > 5 * 60_000 && (await signedIn())) {
    deepAt = Date.now()
    const j = await fromWebPlayer()
    if (j) {
      noteRaw('web player', j)
      list = parse(j)
    }
  }
  if (!list) return friendsCache?.list ?? null
  friendsCache = { at: Date.now(), list }
  return list
}

/* ---------- Canvas: the short looping video an artist puts on a song ----------
 * Read like the Spotify app reads it (a small protobuf request); only the video's address is
 * taken from the answer. */
const canvasCache = new Map<string, Promise<string | null>>()
export function spotifyCanvas(trackId: string): Promise<string | null> {
  if (!/^[A-Za-z0-9]{22}$/.test(trackId)) return Promise.resolve(null)
  let p = canvasCache.get(trackId)
  if (!p) {
    p = (async () => {
      if (!(await signedIn())) return null
      const uri = Buffer.from(`spotify:track:${trackId}`)
      // EntityCanvazRequest { entities: [{ entity_uri }] }
      const entity = Buffer.concat([Buffer.from([0x0a, uri.length]), uri])
      const body = Buffer.concat([Buffer.from([0x0a, entity.length]), entity])
      for (let attempt = 0; attempt < 2; attempt++) {
        const t = await webToken(attempt > 0)
        if (!t) return null
        const res = await fetch('https://spclient.wg.spotify.com/canvaz-cache/v0/canvases', {
          method: 'POST',
          body,
          headers: {
            Authorization: `Bearer ${t}`,
            'User-Agent': UA,
            'Content-Type': 'application/x-protobuf',
            Accept: 'application/protobuf',
            ...(token?.clientToken ? { 'client-token': token.clientToken } : {})
          },
          signal: AbortSignal.timeout(8000)
        }).catch(() => null)
        if (!res) return null
        if (res.status === 401) continue
        if (!res.ok) return null
        const text = Buffer.from(await res.arrayBuffer()).toString('latin1')
        return /https:\/\/canvaz\.scdn\.co\/[!-~]+?\.mp4/.exec(text)?.[0] ?? null
      }
      return null
    })().catch(() => null)
    canvasCache.set(trackId, p)
    if (canvasCache.size > 300) canvasCache.delete(canvasCache.keys().next().value as string)
  }
  return p
}

/* ---------- Spotify's analysis of a song ----------
 * Beats, and for every short slice of the song its loudness and its sound (12 pitch classes and
 * 12 timbre values), as the web player gets it. The visualizer follows this when it can't listen
 * to the computer's sound. */
const analysisCache = new Map<string, Promise<Json | null>>()
export function spotifyAnalysis(trackId: string): Promise<Json | null> {
  if (!/^[A-Za-z0-9]{22}$/.test(trackId)) return Promise.resolve(null)
  let p = analysisCache.get(trackId)
  if (!p) {
    p = (async () => {
      if (!(await signedIn())) return null
      const j = await webGet<Json>(`https://spclient.wg.spotify.com/audio-attributes/v1/audio-analysis/${trackId}?format=json`)
      if (!j || !Array.isArray(j.segments)) return null
      // only what the visualizer needs, rounded, to keep it small
      const r = (n: number): number => Math.round(n * 1000) / 1000
      return {
        beats: (j.beats ?? []).map((b: Json) => r(b.start)),
        bars: (j.bars ?? []).map((b: Json) => r(b.start)),
        segments: (j.segments as Json[]).map((s) => [
          r(s.start),
          r(s.loudness_max),
          r(s.loudness_start),
          r(s.loudness_max_time),
          ...(s.pitches ?? []).map(r),
          ...(s.timbre ?? []).map(r)
        ])
      }
    })().catch(() => null)
    analysisCache.set(trackId, p)
    void p.then((v) => {
      if (!v) analysisCache.delete(trackId)
      if (analysisCache.size > 40) analysisCache.delete(analysisCache.keys().next().value as string)
    })
  }
  return p
}

/* ---------- Spotify's lyrics ---------- */

const lyricsCache = new Map<string, SpotifyLyrics | null>()

export async function spotifyLyrics(trackId: string): Promise<SpotifyLyrics | null> {
  if (!/^[A-Za-z0-9]{22}$/.test(trackId)) return null
  if (lyricsCache.has(trackId)) return lyricsCache.get(trackId) ?? null
  if (!(await signedIn())) return null
  const j = await webGet<Json>(`https://spclient.wg.spotify.com/color-lyrics/v2/track/${trackId}?format=json&vocalRemoval=false&market=from_token`)
  const l = j?.lyrics
  let out: SpotifyLyrics | null = null
  if (l && Array.isArray(l.lines) && l.lines.length) {
    const synced = l.syncType === 'LINE_SYNCED' || l.syncType === 'SYLLABLE_SYNCED'
    out = {
      synced,
      lines: (l.lines as Json[])
        .map((x) => ({
          timeMs: Number(x.startTimeMs) || 0,
          text: String(x.words ?? '')
            .replace(/♪/g, '')
            .trim()
        }))
        .filter((x, i, all) => x.text || (i > 0 && all[i - 1].text)),
      provider: String(l.providerDisplayName ?? l.provider ?? 'Spotify')
    }
  }
  // a song without lyrics is remembered; a failed request is tried again next time
  if (j) lyricsCache.set(trackId, out)
  if (lyricsCache.size > 300) lyricsCache.delete(lyricsCache.keys().next().value as string)
  return out
}
