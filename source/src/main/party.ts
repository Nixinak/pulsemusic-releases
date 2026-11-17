// Party mode: friends open a link on their phone, search for songs and add them to the queue.
// Nothing to install: this computer serves the page, and a Cloudflare quick tunnel makes it
// reachable from anywhere (not just the same Wi-Fi). Each party has a random code in its
// address, so only people who got the link can join.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import { randomBytes } from 'node:crypto'
import type { WebContents } from 'electron'
import { getAccessToken } from './auth'
import type { PartyControl, PartyQueueItem, PartyState, PartyTrack, PlaybackSnapshot } from '@shared/types'
import { partyPage } from './partyPage'
import { startTunnel, stopTunnel } from './tunnel'
import type { PartyInfo } from '@shared/types'

const PORTS = [43900, 43901, 43902, 43903, 43904]
/** Songs one guest may have waiting in the queue at the same time. */
const PER_GUEST = 3

let server: Server | null = null
let code = ''
let url = ''
let port = 0
let publicUrl: string | null = null
let linkStatus: PartyInfo['status'] = 'starting'
let linkMessage = ''
let host: WebContents | null = null
let nowPlaying: PlaybackSnapshot | null = null
let queue: PartyQueueItem[] = []
/** Songs that came from a search here: only these can be added (by uri). */
const known = new Map<string, PartyTrack>()
const searchCache = new Map<string, { at: number; tracks: PartyTrack[] }>()
const lastSearch = new Map<string, number>()
const lastControl = new Map<string, number>()
const partySearches: number[] = []
/** Party votes: song → voter → +1 or -1. A voter is a phone (its address) plus the name used. */
const votes = new Map<string, Map<string, number>>()
const lastVote = new Map<string, number>()

const scoreOf = (uri: string): number => {
  let n = 0
  for (const v of votes.get(uri)?.values() ?? []) n += v
  return n
}
/** The queue as guests see it: with scores, the best voted first (the app does the same). */
const scored = (q: PartyQueueItem[]): PartyQueueItem[] =>
  q
    .map((x, i) => ({ x: { ...x, score: scoreOf(x.uri) }, i }))
    .sort((a, b) => b.x.score - a.x.score || a.i - b.i)
    .map((y) => y.x)

/** A thumb up (1), down (-1) or taken back (0); tells the app the new scores. */
export function partyVote(voter: string, uri: string, v: number): void {
  if (!uri || !queue.some((q) => q.uri === uri)) return
  const m = votes.get(uri) ?? new Map<string, number>()
  if (v > 0) m.set(voter, 1)
  else if (v < 0) m.set(voter, -1)
  else m.delete(voter)
  votes.set(uri, m)
  queue = scored(queue)
  const scores: Record<string, number> = {}
  for (const q of queue) scores[q.uri] = q.score ?? 0
  if (host && !host.isDestroyed())
    host.send('party:control', {
      control: { action: 'votes', scores },
      guest: ''
    })
}
/** Spotify refused a search: no more searches until then (knocking keeps a block going). */
let partyBlockedUntil = 0

function lanAddress(): string {
  const all = Object.values(networkInterfaces()).flat()
  const ok = all.filter((i) => i && i.family === 'IPv4' && !i.internal)
  // Prefer home-network ranges (192.168.x, 10.x, 172.16–31.x) over VPNs and virtual adapters.
  const priv =
    ok.find((i) => /^192\.168\./.test(i!.address)) ?? ok.find((i) => /^10\./.test(i!.address)) ?? ok.find((i) => /^172\.(1[6-9]|2\d|3[01])\./.test(i!.address))
  return (priv ?? ok[0])?.address ?? '127.0.0.1'
}

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json'): void {
  const data = type === 'application/json' ? JSON.stringify(body) : String(body)
  res.writeHead(status, {
    'Content-Type': `${type}; charset=utf-8`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  })
  res.end(data)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (c: Buffer) => {
      data += c.toString('utf8')
      if (data.length > 4000) req.destroy()
    })
    req.on('end', () => resolve(data))
    req.on('error', () => resolve(''))
  })
}

async function search(q: string): Promise<PartyTrack[]> {
  const key = q.toLowerCase().trim()
  const hit = searchCache.get(key)
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.tracks
  // All guests together get at most 6 Spotify searches per 30 s (the app's allowance is shared
  // with the host's own Pulse); beyond that guests see "busy" and try again in a moment.
  const cutoff = Date.now() - 30_000
  while (partySearches.length && partySearches[0] < cutoff) partySearches.shift()
  if (partySearches.length >= 6 || Date.now() < partyBlockedUntil) throw new Error('busy')
  partySearches.push(Date.now())
  const token = await getAccessToken()
  if (!token) return []
  const u = new URL('https://api.spotify.com/v1/search')
  u.searchParams.set('q', q)
  u.searchParams.set('type', 'track')
  u.searchParams.set('limit', '10')
  const res = await fetch(u, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000)
  })
  if (res.status === 429) {
    const after = Number(res.headers.get('retry-after') ?? '') || 60
    partyBlockedUntil = Date.now() + after * 1000
    throw new Error('busy')
  }
  if (!res.ok) throw new Error(`search ${res.status}`)
  const j = (await res.json()) as {
    tracks?: {
      items?: ({
        id: string
        uri: string
        name: string
        duration_ms: number
        explicit: boolean
        artists: { name: string }[]
        album?: { images?: { url: string; width: number | null }[] }
      } | null)[]
    }
  }
  const tracks: PartyTrack[] = (j.tracks?.items ?? [])
    .filter((t): t is NonNullable<typeof t> => !!t?.id)
    .map((t) => {
      const imgs = [...(t.album?.images ?? [])].sort((a, b) => (a.width ?? 0) - (b.width ?? 0))
      return {
        id: t.id,
        uri: t.uri,
        name: t.name,
        artists: t.artists.map((a) => a.name).join(', '),
        image: (imgs.find((i) => (i.width ?? 0) >= 120) ?? imgs[imgs.length - 1])?.url ?? null,
        durationMs: t.duration_ms,
        explicit: t.explicit
      }
    })
  for (const t of tracks) known.set(t.uri, t)
  searchCache.set(key, { at: Date.now(), tracks })
  return tracks
}

const livePos = (s: PlaybackSnapshot): number => Math.min(s.durationMs, s.positionMs + (s.paused ? 0 : Date.now() - s.sampledAt))

/** Accepts only well-formed controls (anything from the internet is untrusted). */
function toControl(b: Record<string, unknown>): PartyControl | null {
  switch (b.action) {
    case 'toggle':
    case 'next':
    case 'previous':
      return { action: b.action }
    case 'seek': {
      const ms = Number(b.positionMs)
      if (!Number.isFinite(ms) || !nowPlaying?.hasTrack) return null
      return {
        action: 'seek',
        positionMs: Math.round(Math.min(Math.max(0, ms), nowPlaying.durationMs))
      }
    }
    case 'remove':
      return typeof b.uri === 'string' && /^spotify:track:[A-Za-z0-9]{10,40}$/.test(b.uri) ? { action: 'remove', uri: b.uri } : null
    default:
      return null
  }
}

const cleanName = (s: unknown): string =>
  String(s ?? '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, 24) || 'Guest'

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const u = new URL(req.url ?? '/', 'http://x')
  const parts = u.pathname.split('/').filter(Boolean)
  if (parts[0] !== 'p' || parts[1] !== code) return send(res, 404, 'Not found', 'text/plain')
  const route = parts.slice(2).join('/')
  if (route === '' && req.method === 'GET') return send(res, 200, partyPage(), 'text/html')
  if (route === 'api/state' && req.method === 'GET') {
    const state: PartyState = {
      nowPlaying: nowPlaying?.hasTrack
        ? {
            name: nowPlaying.title,
            artists: nowPlaying.artists,
            image: nowPlaying.artUrl,
            paused: nowPlaying.paused,
            uri: nowPlaying.uri,
            durationMs: nowPlaying.durationMs,
            positionMs: livePos(nowPlaying)
          }
        : null,
      queue: scored(queue)
    }
    return send(res, 200, state)
  }
  if (route === 'api/search' && req.method === 'GET') {
    const q = (u.searchParams.get('q') ?? '').slice(0, 80).trim()
    if (q.length < 2) return send(res, 200, { tracks: [] })
    // One search per second per phone is plenty and keeps Spotify happy.
    // behind the tunnel every visit comes from 127.0.0.1; Cloudflare passes the real address
    const who = String(req.headers['cf-connecting-ip'] ?? req.socket.remoteAddress ?? '')
    if (Date.now() - (lastSearch.get(who) ?? 0) < 900) return send(res, 429, { error: 'slow down' })
    lastSearch.set(who, Date.now())
    try {
      return send(res, 200, { tracks: await search(q) })
    } catch (e) {
      return send(res, 503, {
        error: e instanceof Error && e.message === 'busy' ? 'Spotify is busy, try again in a moment.' : 'Search failed.'
      })
    }
  }
  if (route === 'api/add' && req.method === 'POST') {
    let body: { uri?: string; guest?: string } = {}
    try {
      body = JSON.parse(await readBody(req))
    } catch {
      return send(res, 400, { error: 'Bad request' })
    }
    const track = body.uri ? known.get(body.uri) : undefined
    if (!track) return send(res, 400, { error: 'Search for the song first.' })
    const guest = cleanName(body.guest)
    if (queue.filter((q) => q.addedBy === guest).length >= PER_GUEST)
      return send(res, 429, {
        error: `You already have ${PER_GUEST} songs waiting. Wait until one plays.`
      })
    if (queue.some((q) => q.uri === track.uri)) return send(res, 409, { error: 'That song is already in the queue.' })
    if (!host || host.isDestroyed()) return send(res, 503, { error: 'The party host is offline.' })
    host.send('party:add', { track, guest })
    // Show it right away; the app sends the real queue a moment later.
    queue = [
      ...queue,
      {
        uri: track.uri,
        name: track.name,
        artists: track.artists,
        image: track.image,
        addedBy: guest
      }
    ]
    return send(res, 200, { ok: true })
  }
  if (route === 'api/vote' && req.method === 'POST') {
    let body: { uri?: string; v?: number; guest?: string } = {}
    try {
      body = JSON.parse(await readBody(req))
    } catch {
      return send(res, 400, { error: 'Bad request' })
    }
    const who = String(req.headers['cf-connecting-ip'] ?? req.socket.remoteAddress ?? '')
    if (Date.now() - (lastVote.get(who) ?? 0) < 250) return send(res, 429, { error: 'Slow down a little.' })
    lastVote.set(who, Date.now())
    if (!body.uri || !queue.some((q) => q.uri === body.uri))
      return send(res, 404, {
        error: 'That song isn’t in the queue any more.'
      })
    partyVote(`${who}|${cleanName(body.guest)}`, body.uri, Number(body.v) || 0)
    return send(res, 200, { ok: true, score: scoreOf(body.uri) })
  }
  if (route === 'api/control' && req.method === 'POST') {
    let body: Record<string, unknown> = {}
    try {
      body = JSON.parse(await readBody(req))
    } catch {
      return send(res, 400, { error: 'Bad request' })
    }
    // a few presses a second per phone, so a stuck finger can't skip through the whole queue
    const who = String(req.headers['cf-connecting-ip'] ?? req.socket.remoteAddress ?? '')
    if (Date.now() - (lastControl.get(who) ?? 0) < 350) return send(res, 429, { error: 'Slow down a little.' })
    lastControl.set(who, Date.now())
    const control = toControl(body)
    if (!control) return send(res, 400, { error: 'Bad request' })
    if (!host || host.isDestroyed()) return send(res, 503, { error: 'The party host is offline.' })
    host.send('party:control', { control, guest: cleanName(body.guest) })
    // Show the change right away; the app sends the real state a moment later.
    if (nowPlaying?.hasTrack && control.action === 'toggle')
      nowPlaying = {
        ...nowPlaying,
        positionMs: livePos(nowPlaying),
        sampledAt: Date.now(),
        paused: !nowPlaying.paused
      }
    if (nowPlaying?.hasTrack && control.action === 'seek')
      nowPlaying = {
        ...nowPlaying,
        positionMs: control.positionMs,
        sampledAt: Date.now()
      }
    if (control.action === 'remove') queue = queue.filter((q) => q.uri !== control.uri)
    return send(res, 200, { ok: true })
  }
  return send(res, 404, { error: 'Not found' })
}

export const partyInfo = (): PartyInfo | null =>
  server
    ? {
        url: publicUrl ?? url,
        lanUrl: url,
        publicUrl,
        code,
        status: linkStatus,
        message: linkMessage
      }
    : null

function announce(): void {
  const info = partyInfo()
  if (info && host && !host.isDestroyed()) host.send('party:link', info)
}

async function goOnline(): Promise<void> {
  linkStatus = 'starting'
  linkMessage = 'Putting your party online…'
  announce()
  try {
    const base = await startTunnel(port, (m) => {
      linkMessage = m
      announce()
    })
    if (!server) return stopTunnel()
    publicUrl = `${base}/p/${code}`
    linkStatus = 'online'
    linkMessage = ''
  } catch (e) {
    console.warn('[party] tunnel failed', e)
    linkStatus = 'offline'
    linkMessage = 'Could not put the party online. Friends on the same Wi-Fi can still use the link below.'
  }
  announce()
}

export async function startParty(sender: WebContents): Promise<PartyInfo> {
  host = sender
  if (server) return partyInfo()!
  code = randomBytes(4).toString('hex')
  const srv = createServer((req, res) => {
    handle(req, res).catch(() => send(res, 500, { error: 'Something went wrong.' }))
  })
  for (const p of PORTS) {
    const ok = await new Promise<boolean>((resolve) => {
      srv.once('error', () => resolve(false))
      srv.listen(p, '0.0.0.0', () => resolve(true))
    })
    if (ok) {
      server = srv
      port = p
      url = `http://${lanAddress()}:${p}/p/${code}`
      publicUrl = null
      void goOnline()
      return partyInfo()!
    }
  }
  throw new Error('Could not start the party: all ports are busy.')
}

export function stopParty(): void {
  stopTunnel()
  publicUrl = null
  server?.close()
  server = null
  queue = []
  nowPlaying = null
  known.clear()
  lastSearch.clear()
  lastControl.clear()
  votes.clear()
  lastVote.clear()
  code = ''
  url = ''
}

export function setPartyNowPlaying(s: PlaybackSnapshot): void {
  nowPlaying = s
}

export function setPartyQueue(q: PartyQueueItem[]): void {
  queue = q.slice(0, 50)
  // votes for songs that have played (or left) are forgotten
  for (const uri of [...votes.keys()]) if (!queue.some((x) => x.uri === uri)) votes.delete(uri)
}

/** For the Discord status: is a party on, and how many friends have added songs. */
export function partySummary(): { on: boolean; guests: number } {
  // songs autoplay lined up aren't from a guest
  return {
    on: !!server,
    guests: new Set(queue.map((q) => q.addedBy).filter((g) => g && g !== 'Autoplay')).size
  }
}
