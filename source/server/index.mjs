// Pulse server: stores the Pulse profiles people choose to publish, so other Pulse users can
// see them and Pulse users get their badge. Runs on any machine with Node 20+ (no packages).
//
// Who you are is proven with your Spotify sign-in: the app sends its Spotify access token,
// the server asks Spotify whose it is (GET /v1/me) and only lets you change your own profile.
// The token itself is never stored.
//
//   PORT       port to listen on (default 8787; put Caddy or another HTTPS proxy in front)
//   DATA_DIR   where profiles are kept (default ./data)
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'

const PORT = Number(process.env.PORT || 8787)
const DATA = process.env.DATA_DIR || join(process.cwd(), 'data')
const SPOTIFY_ME = process.env.SPOTIFY_ME_URL || 'https://api.spotify.com/v1/me'
const MAX_BODY = 4 * 1024 * 1024
const DIR = join(DATA, 'profiles')
mkdirSync(DIR, { recursive: true })

/* ---------- Storage: one JSON file per profile, a small index in memory ---------- */

const ID = /^[A-Za-z0-9._-]{1,64}$/
const fileOf = (id) => join(DIR, `${id}.json`)
/** id -> { id, displayName, thumb, updatedAt } (for search and badges) */
const index = new Map()
const summary = (p) => ({ id: p.id, displayName: p.displayName, thumb: p.thumb ?? null, updatedAt: p.updatedAt })

for (const f of readdirSync(DIR)) {
  if (!f.endsWith('.json')) continue
  try {
    const p = JSON.parse(readFileSync(join(DIR, f), 'utf8'))
    if (p?.id) index.set(p.id, summary(p))
  } catch (e) {
    console.warn('[store] skipped', f, e.message)
  }
}
console.log(`[pulse] ${index.size} profiles loaded`)

function save(p) {
  const tmp = fileOf(p.id) + '.tmp'
  writeFileSync(tmp, JSON.stringify(p))
  renameSync(tmp, fileOf(p.id))
  index.set(p.id, summary(p))
}

function load(id) {
  try {
    return JSON.parse(readFileSync(fileOf(id), 'utf8'))
  } catch {
    return null
  }
}

/* ---------- Checking what people send ---------- */

const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max) : '')
// Pictures: an uploaded JPEG/PNG/WebP/GIF (data URL) or a picture on Spotify's image servers.
const IMG = /^(data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+|https:\/\/([a-z0-9-]+\.)*(scdn\.co|spotifycdn\.com)\/[^\s"'<>]+)$/
const img = (v, max = 1_500_000) => (typeof v === 'string' && v.length <= max && IMG.test(v) ? v : null)
const color = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : null)
const spId = (v) => (typeof v === 'string' && /^[A-Za-z0-9]{10,40}$/.test(v) ? v : '')

const item = (x) => ({ id: spId(x?.id), uri: str(x?.uri, 80), name: str(x?.name, 200), subtitle: str(x?.subtitle, 200), image: img(x?.image, 300_000) })

function block(b) {
  const id = str(b?.id, 40) || 'b'
  switch (b?.type) {
    case 'text':
      return { id, type: 'text', title: str(b.title, 120), text: str(b.text, 4000) }
    case 'image':
      return img(b.src) ? { id, type: 'image', src: img(b.src), caption: str(b.caption, 300) } : null
    case 'top-artists':
    case 'top-tracks':
    case 'stats':
      return { id, type: b.type }
    case 'playlist':
      return spId(b.playlistId) ? { id, type: 'playlist', playlistId: spId(b.playlistId) } : null
    case 'favorites': {
      const kind = ['artist', 'album', 'track'].includes(b.kind) ? b.kind : 'track'
      return { id, type: 'favorites', title: str(b.title, 120), kind, items: (Array.isArray(b.items) ? b.items : []).slice(0, 24).map(item) }
    }
    default:
      return null
  }
}

function clean(id, body) {
  const p = body?.profile ?? {}
  const s = body?.snapshot ?? {}
  const colors = Array.isArray(p.customColors) ? p.customColors.slice(0, 4).map(color) : []
  return {
    id,
    displayName: str(p.displayName, 60).trim() || id,
    avatar: img(p.avatar),
    thumb: img(body?.thumb, 40_000),
    banner: img(p.banner, 2_000_000),
    bio: str(p.bio, 2000),
    palette: str(p.palette, 40) || 'auto',
    customColors: colors.length === 4 && colors.every(Boolean) ? colors : null,
    blocks: (Array.isArray(p.blocks) ? p.blocks : []).slice(0, 30).map(block).filter(Boolean),
    // what the profile's live blocks show, captured by the owner's app (others can't ask Spotify)
    snapshot: {
      topArtists: (Array.isArray(s.topArtists) ? s.topArtists : []).slice(0, 10).map(item),
      topTracks: (Array.isArray(s.topTracks) ? s.topTracks : []).slice(0, 10).map(item),
      minutes: Number.isFinite(s.minutes) ? Math.max(0, Math.round(s.minutes)) : null
    },
    updatedAt: Date.now()
  }
}

/* ---------- Spotify sign-in check ---------- */

const tokenCache = new Map() // sha256(token) -> { id, at }

async function whoIs(req) {
  const m = /^Bearer\s+(\S{20,600})$/.exec(req.headers.authorization || '')
  if (!m) return null
  const key = createHash('sha256').update(m[1]).digest('hex')
  const hit = tokenCache.get(key)
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.id
  try {
    const res = await fetch(SPOTIFY_ME, { headers: { Authorization: `Bearer ${m[1]}` }, signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const me = await res.json()
    if (!ID.test(me?.id ?? '')) return null
    if (tokenCache.size > 5000) tokenCache.clear()
    tokenCache.set(key, { id: me.id, at: Date.now() })
    return me.id
  } catch {
    return null
  }
}

/* ---------- HTTP ---------- */

const hits = new Map() // ip -> { n, at }
function limited(ip, max = 120) {
  const now = Date.now()
  const h = hits.get(ip)
  if (!h || now - h.at > 60_000) {
    hits.set(ip, { n: 1, at: now })
    if (hits.size > 20_000) hits.clear()
    return false
  }
  return ++h.n > max
}

function send(res, status, body) {
  const data = body === null ? '' : JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  })
  res.end(data)
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      // too big: keep reading (and dropping) so the answer still reaches the app
      if (size <= MAX_BODY) chunks.push(c)
    })
    req.on('end', () => {
      if (size > MAX_BODY) return reject(Object.assign(new Error('The profile is too big. Use smaller pictures.'), { status: 413 }))
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        reject(Object.assign(new Error('bad json'), { status: 400 }))
      }
    })
    req.on('error', reject)
  })
}

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()

async function handle(req, res) {
  const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim()
  if (limited(ip)) return send(res, 429, { error: 'Too many requests, try again in a minute.' })
  const u = new URL(req.url ?? '/', 'http://x')
  const path = u.pathname.replace(/\/+$/, '')

  if (path === '/v1/health') return send(res, 200, { ok: true, profiles: index.size })

  // publish or remove your own profile
  if (path === '/v1/me' && (req.method === 'PUT' || req.method === 'DELETE')) {
    const id = await whoIs(req)
    if (!id) return send(res, 401, { error: 'Sign in with Spotify again.' })
    if (req.method === 'DELETE') {
      rmSync(fileOf(id), { force: true })
      index.delete(id)
      return send(res, 200, { ok: true })
    }
    const body = await readJson(req)
    const p = clean(id, body)
    save(p)
    return send(res, 200, { ok: true, updatedAt: p.updatedAt })
  }

  // someone's public Pulse profile
  const m = /^\/v1\/users\/([^/]+)$/.exec(path)
  if (m && req.method === 'GET') {
    const id = decodeURIComponent(m[1])
    if (!ID.test(id) || !index.has(id)) return send(res, 404, { error: 'Not a Pulse user.' })
    const p = load(id)
    return p ? send(res, 200, p) : send(res, 404, { error: 'Not a Pulse user.' })
  }

  // which of these Spotify users use Pulse (for badges)
  if (path === '/v1/lookup' && req.method === 'POST') {
    const body = await readJson(req)
    const ids = (Array.isArray(body?.ids) ? body.ids : []).slice(0, 100).filter((x) => typeof x === 'string' && ID.test(x))
    return send(res, 200, { users: ids.filter((x) => index.has(x)).map((x) => index.get(x)) })
  }

  // find Pulse users by name or @username
  if (path === '/v1/search' && req.method === 'GET') {
    const q = norm(u.searchParams.get('q')).replace(/^@/, '').slice(0, 60)
    if (q.length < 2) return send(res, 200, { users: [] })
    const found = []
    for (const s of index.values()) {
      const name = norm(s.displayName)
      const id = s.id.toLowerCase()
      const score = id === q ? 0 : name === q ? 1 : id.startsWith(q) || name.startsWith(q) ? 2 : name.includes(q) || id.includes(q) ? 3 : -1
      if (score >= 0) found.push([score, s])
    }
    found.sort((a, b) => a[0] - b[0] || b[1].updatedAt - a[1].updatedAt)
    return send(res, 200, { users: found.slice(0, 20).map((x) => x[1]) })
  }

  return send(res, 404, { error: 'Not found' })
}

createServer((req, res) => {
  handle(req, res).catch((e) => {
    if (!res.headersSent) send(res, e.status ?? 500, { error: e.status ? e.message : 'Something went wrong.' })
    if (!e.status) console.error('[pulse]', e)
  })
}).listen(PORT, '127.0.0.1', () => console.log(`[pulse] listening on 127.0.0.1:${PORT}, data in ${DATA}`))
