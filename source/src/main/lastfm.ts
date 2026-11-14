// Last.fm scrobbling: sends what you listen to Last.fm for long-term stats.
// The app's Last.fm API key and secret are baked in at build time from .env.local
// (MAIN_VITE_LASTFM_KEY / MAIN_VITE_LASTFM_SECRET). Each listener connects their own account
// in the browser; Pulse only keeps the session key Last.fm hands back.
// Rules (Last.fm's own): songs longer than 30 s count once you've heard half of them or 4 minutes.
import { app, shell } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LastfmStatus, ScrobbleInput } from '@shared/types'

const API = 'https://ws.audioscrobbler.com/2.0/'
const KEY: string = import.meta.env.MAIN_VITE_LASTFM_KEY ?? ''
const SECRET: string = import.meta.env.MAIN_VITE_LASTFM_SECRET ?? ''

interface Stored {
  session: string | null
  user: string | null
  enabled: boolean
  /** Scrobbles that couldn't be sent yet (offline), sent later. */
  pending: ScrobbleInput[]
}

const file = (): string => join(app.getPath('userData'), 'data', 'lastfm.json')
let store: Stored | null = null

function load(): Stored {
  if (store) return store
  try {
    store = existsSync(file()) ? { pending: [], enabled: true, session: null, user: null, ...JSON.parse(readFileSync(file(), 'utf8')) } : null
  } catch {
    store = null
  }
  store ??= { session: null, user: null, enabled: true, pending: [] }
  return store
}

function save(): void {
  try {
    mkdirSync(join(app.getPath('userData'), 'data'), { recursive: true })
    writeFileSync(file(), JSON.stringify(load()))
  } catch (e) {
    console.warn('[lastfm] could not save', e)
  }
}

/** Last.fm signs requests: md5 of all parameters (sorted, name+value) followed by the secret. */
function sign(params: Record<string, string>): string {
  const base = Object.keys(params)
    .filter((k) => k !== 'format' && k !== 'callback')
    .sort()
    .map((k) => k + params[k])
    .join('')
  return createHash('md5').update(base + SECRET, 'utf8').digest('hex')
}

async function call<T>(method: string, params: Record<string, string>, post = false): Promise<T> {
  const all: Record<string, string> = { ...params, method, api_key: KEY }
  all.api_sig = sign(all)
  all.format = 'json'
  const body = new URLSearchParams(all)
  const res = post
    ? await fetch(API, { method: 'POST', body, signal: AbortSignal.timeout(10_000) })
    : await fetch(`${API}?${body}`, { signal: AbortSignal.timeout(10_000) })
  const j = (await res.json()) as T & { error?: number; message?: string }
  if (j.error) throw Object.assign(new Error(j.message ?? `Last.fm error ${j.error}`), { code: j.error })
  return j
}

export const lastfmAvailable = (): boolean => !!KEY && !!SECRET

export function lastfmStatus(): LastfmStatus {
  const s = load()
  return { available: lastfmAvailable(), connected: !!s.session, user: s.user, enabled: s.enabled, pending: s.pending.length }
}

let connecting: Promise<LastfmStatus> | null = null

/** Opens Last.fm in the browser to allow Pulse Music, then waits (up to 3 minutes) for the OK. */
export function connectLastfm(): Promise<LastfmStatus> {
  if (connecting) return connecting
  connecting = (async () => {
    if (!lastfmAvailable()) throw new Error('This build has no Last.fm API key.')
    const { token } = await call<{ token: string }>('auth.getToken', {})
    await shell.openExternal(`https://www.last.fm/api/auth/?api_key=${KEY}&token=${token}`)
    const until = Date.now() + 3 * 60_000
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 3000))
      try {
        const r = await call<{ session: { key: string; name: string } }>('auth.getSession', { token })
        const s = load()
        s.session = r.session.key
        s.user = r.session.name
        s.enabled = true
        save()
        void flushPending()
        return lastfmStatus()
      } catch (e) {
        // 14 = not authorised yet: keep waiting. Anything else ends the attempt.
        if ((e as { code?: number }).code !== 14) throw e
      }
    }
    throw new Error('Last.fm was not connected in time. Try again.')
  })().finally(() => {
    connecting = null
  })
  return connecting
}

export function disconnectLastfm(): LastfmStatus {
  const s = load()
  s.session = null
  s.user = null
  s.pending = []
  save()
  return lastfmStatus()
}

export function setLastfmEnabled(on: boolean): LastfmStatus {
  load().enabled = on
  save()
  return lastfmStatus()
}

const active = (): string | null => {
  const s = load()
  return lastfmAvailable() && s.session && s.enabled ? s.session : null
}

export async function lastfmNowPlaying(t: { artist: string; track: string; album?: string; durationMs?: number }): Promise<void> {
  const sk = active()
  if (!sk || !t.artist || !t.track) return
  const p: Record<string, string> = { artist: t.artist, track: t.track, sk }
  if (t.album) p.album = t.album
  if (t.durationMs) p.duration = String(Math.round(t.durationMs / 1000))
  await call('track.updateNowPlaying', p, true).catch((e) => console.warn('[lastfm] now playing', e.message))
}

/** Scrobbles a finished play when it meets Last.fm's rules; keeps it for later if offline. */
export async function lastfmScrobble(s: ScrobbleInput): Promise<void> {
  if (!active()) return
  if (s.durationMs <= 30_000) return
  if (s.listenedMs < Math.min(s.durationMs / 2, 240_000)) return
  const st = load()
  st.pending.push(s)
  st.pending = st.pending.slice(-500)
  save()
  await flushPending()
}

let flushing = false
async function flushPending(): Promise<void> {
  const sk = active()
  if (!sk || flushing) return
  flushing = true
  try {
    const st = load()
    while (st.pending.length) {
      // Last.fm takes up to 50 scrobbles per request.
      const batch = st.pending.slice(0, 50)
      const p: Record<string, string> = { sk }
      batch.forEach((b, i) => {
        p[`artist[${i}]`] = b.artist
        p[`track[${i}]`] = b.track
        p[`timestamp[${i}]`] = String(Math.floor(b.startedAt / 1000))
        if (b.album) p[`album[${i}]`] = b.album
        p[`duration[${i}]`] = String(Math.round(b.durationMs / 1000))
      })
      try {
        await call('track.scrobble', p, true)
      } catch (e) {
        const code = (e as { code?: number }).code
        // 9 = session no longer valid: the listener must connect again.
        if (code === 9) {
          st.session = null
          st.user = null
          save()
        }
        console.warn('[lastfm] scrobble failed, will retry', (e as Error).message)
        break
      }
      st.pending = st.pending.slice(batch.length)
      save()
    }
  } finally {
    flushing = false
  }
}

/** Sends scrobbles saved while offline (called at start and now and then). */
export function startLastfm(): void {
  void flushPending()
  setInterval(() => void flushPending(), 10 * 60_000)
}
