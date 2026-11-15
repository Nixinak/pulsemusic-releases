// Your Spotify web account, signed in once inside Pulse (its own window, its own cookies on
// this computer). It unlocks two things Spotify's Web API doesn't offer:
//  - Friend Activity: what the people you follow on Spotify are playing (the list the Spotify
//    desktop app shows on the right),
//  - Spotify's own lyrics, line-synced for many songs LRCLIB doesn't have.
// Both are read the way the Spotify web player reads them. Nothing here counts against Pulse's
// Web API allowance, and the sign-in never leaves this computer.
import { BrowserWindow, session } from 'electron'
import type { SpotifyFriend, SpotifyLyrics } from '@shared/types'

const PARTITION = 'persist:spotify-account'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'

const ses = (): Electron.Session => {
  const s = session.fromPartition(PARTITION)
  s.setUserAgent(UA, 'en-US,en')
  return s
}

/** Signed in: Spotify's login cookie is there. */
async function signedIn(): Promise<boolean> {
  const c = await ses().cookies.get({ name: 'sp_dc' }).catch(() => [])
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
    const win = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { session: s, backgroundThrottling: false, sandbox: true } })
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
        token = { value: auth.replace(/^Bearer\s+/, ''), clientToken: h['client-token'] ?? h['Client-Token'] ?? null, at: Date.now() }
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

async function webGet<T>(url: string, extra: Record<string, string> = {}): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const t = await webToken(attempt > 0)
    if (!t) return null
    const res = await fetch(url, {
      headers: {
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
  await ses().clearStorageData().catch(() => undefined)
}

export async function spotifyAccountStatus(): Promise<{ connected: boolean }> {
  return { connected: await signedIn() }
}

/* ---------- Friend Activity ---------- */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any
const idOf = (uri: unknown): string => String(uri ?? '').split(':').pop() ?? ''

let friendsCache: { at: number; list: SpotifyFriend[] } | null = null

export async function spotifyFriends(): Promise<SpotifyFriend[] | null> {
  // at most every 30 s, however many pages ask
  if (friendsCache && Date.now() - friendsCache.at < 30_000) return friendsCache.list
  const j = await webGet<Json>('https://guc-spclient.spotify.com/presence-view/v1/buddylist')
  if (!j || !Array.isArray(j.friends)) return friendsCache?.list ?? null
  const list: SpotifyFriend[] = (j.friends as Json[])
    .filter((f) => f?.user?.uri && f?.track?.uri)
    .map((f) => ({
      id: decodeURIComponent(idOf(f.user.uri)),
      name: String(f.user.name ?? ''),
      image: f.user.imageUrl || null,
      at: Number(f.timestamp) || 0,
      track: {
        id: idOf(f.track.uri),
        uri: String(f.track.uri),
        name: String(f.track.name ?? ''),
        image: f.track.imageUrl || null,
        artist: { id: idOf(f.track.artist?.uri), name: String(f.track.artist?.name ?? '') },
        album: { id: idOf(f.track.album?.uri), name: String(f.track.album?.name ?? '') },
        context: f.track.context?.uri ? { uri: String(f.track.context.uri), name: String(f.track.context.name ?? '') } : null
      }
    }))
    .sort((a, b) => b.at - a.at)
  friendsCache = { at: Date.now(), list }
  return list
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
        .map((x) => ({ timeMs: Number(x.startTimeMs) || 0, text: String(x.words ?? '').replace(/♪/g, '').trim() }))
        .filter((x, i, all) => x.text || (i > 0 && all[i - 1].text)),
      provider: String(l.providerDisplayName ?? l.provider ?? 'Spotify')
    }
  }
  // a song without lyrics is remembered; a failed request is tried again next time
  if (j) lyricsCache.set(trackId, out)
  if (lyricsCache.size > 300) lyricsCache.delete(lyricsCache.keys().next().value as string)
  return out
}
