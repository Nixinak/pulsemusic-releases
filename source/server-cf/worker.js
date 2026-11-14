// Pulse server on Cloudflare Workers (free plan): keeps the Pulse profiles people publish, so
// other Pulse users can see them and every Pulse user gets the Pulse badge.
//
// Who you are is proven with your Spotify sign-in: the app sends its Spotify access token, the
// server asks Spotify whose it is and only lets you change your own profile. Tokens aren't stored.
//
// Storage: Workers KV (binding PULSE) holds the profiles ("p:<spotifyId>"). Everything that
// changes often or must never get lost lives in one Durable Object (binding PRESENCE): the list
// of Pulse users (for search and badges), who follows whom, and what people play right now.
// (Those used to be in KV too, but KV is only "eventually" up to date: a friend request could
// vanish and come back, and two people saving at once could knock each other off the list.)

const MAX_BODY = 3 * 1024 * 1024
const ID = /^[A-Za-z0-9._-]{1,64}$/

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
  })

/* ---------- Checking what people send ---------- */

const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max) : '')
// Pictures: an uploaded JPEG/PNG/WebP/GIF (data URL) or a picture on Spotify's image servers.
const IMG = /^(data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+|https:\/\/([a-z0-9-]+\.)*(scdn\.co|spotifycdn\.com)\/[^\s"'<>]+)$/
const img = (v, max = 1_000_000) => (typeof v === 'string' && v.length <= max && IMG.test(v) ? v : null)
const color = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : null)
const spId = (v) => (typeof v === 'string' && /^[A-Za-z0-9]{10,40}$/.test(v) ? v : '')
const item = (x) => ({ id: spId(x?.id), uri: str(x?.uri, 80), name: str(x?.name, 200), subtitle: str(x?.subtitle, 200), image: img(x?.image, 200_000) })

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
    banner: img(p.banner, 1_500_000),
    bio: str(p.bio, 2000),
    tagline: str(p.tagline, 80),
    links: (Array.isArray(p.links) ? p.links : [])
      .slice(0, 6)
      .map((l) => (typeof l?.url === 'string' && /^https:\/\/[^\s"'<>]{3,300}$/.test(l.url) ? { url: l.url } : null))
      .filter(Boolean),
    anthem: p.anthem && spId(p.anthem.id) ? item(p.anthem) : null,
    bannerY: Number.isFinite(p.bannerY) ? Math.max(0, Math.min(100, Math.round(p.bannerY))) : 50,
    palette: str(p.palette, 40) || 'auto',
    customColors: colors.length === 4 && colors.every(Boolean) ? colors : null,
    blocks: (Array.isArray(p.blocks) ? p.blocks : []).slice(0, 30).map(block).filter(Boolean),
    snapshot: {
      topArtists: (Array.isArray(s.topArtists) ? s.topArtists : []).slice(0, 10).map(item),
      topTracks: (Array.isArray(s.topTracks) ? s.topTracks : []).slice(0, 10).map(item),
      minutes: Number.isFinite(s.minutes) ? Math.max(0, Math.round(s.minutes)) : null
    },
    updatedAt: Date.now()
  }
}

/* ---------- Spotify sign-in check ---------- */

const tokenCache = new Map()

async function whoIs(req) {
  const m = /^Bearer\s+(\S{20,600})$/.exec(req.headers.get('authorization') || '')
  if (!m) return null
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(m[1]))
  const key = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  const hit = tokenCache.get(key)
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.id
  const res = await fetch('https://api.spotify.com/v1/me', { headers: { Authorization: `Bearer ${m[1]}` } })
  if (!res.ok) return null
  const me = await res.json()
  if (!ID.test(me?.id ?? '')) return null
  if (tokenCache.size > 2000) tokenCache.clear()
  tokenCache.set(key, { id: me.id, at: Date.now() })
  return me.id
}

/* ---------- Index (for search and badges) ---------- */

/** Everyone who published a Pulse profile: { id: { id, displayName, thumb, updatedAt } } */
const readIndex = (env) => hub(env, 'index.all')

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()

/* ---------- Following and friends ---------- */
// You can follow anyone (a Spotify user id). Two people who follow each other are friends.
// "f:<id>" = { following: [ids], followers: [ids], meta: { id: { displayName, thumb } } }
// (meta: name and picture of people who don't use Pulse, as the follower's app saw them)

const MAX_FOLLOWING = 1000
const MAX_FOLLOWERS = 5000
const readFollows = (env, id) => hub(env, 'follows.get', { id })

/** Old KV records had friends / incoming / outgoing. */
function normFollows(f) {
  f = f ?? {}
  const following = new Set([...(f.following ?? []), ...(f.friends ?? []), ...(f.outgoing ?? [])])
  const followers = new Set([...(f.followers ?? []), ...(f.friends ?? []), ...(f.incoming ?? [])])
  return { following: [...following], followers: [...followers], meta: f.meta ?? {} }
}

/** Your lists, each person with name and picture, plus what the people you follow are playing. */
async function followsView(env, f, index) {
  const one = (id) => index[id] ?? { id, displayName: f.meta[id]?.displayName || id, thumb: f.meta[id]?.thumb ?? null, updatedAt: 0, pulse: false }
  const mark = (id) => ({ ...one(id), pulse: !!index[id] })
  const following = new Set(f.following)
  const followers = new Set(f.followers)
  return {
    friends: f.following.filter((x) => followers.has(x)).map(mark),
    incoming: f.followers.filter((x) => !following.has(x)).map(mark),
    outgoing: f.following.filter((x) => !followers.has(x)).map(mark),
    // everyone you follow who shares what they play (not only people already in the index)
    now: await hub(env, 'GET', { ids: f.following })
  }
}

async function friendsRoute(req, env, path) {
  const me = await whoIs(req)
  if (!me) return json(401, { error: 'Sign in with Spotify again.' })
  if (path === '/v1/friends' && req.method === 'GET') return json(200, await followsView(env, await readFollows(env, me), await readIndex(env)))

  const m = /^\/v1\/friends\/(follow|unfollow|dismiss)$/.exec(path)
  if (!m || req.method !== 'POST') return json(404, { error: 'Not found' })
  const body = await req.json().catch(() => ({}))
  const other = typeof body?.id === 'string' ? body.id : ''
  if (!ID.test(other) || other === me) return json(400, { error: 'Bad request' })

  // done inside the Durable Object, so both people's lists change together
  const r = await hub(env, 'follows.act', {
    action: m[1],
    me,
    other,
    meta: { displayName: str(body.name, 60).trim() || other, thumb: img(body.image, 1000) }
  })
  if (r.error) return json(409, { error: r.error })
  return json(200, await followsView(env, r.mine, await readIndex(env)))
}

/* ---------- Live: what people are playing ---------- */
// Kept by one Durable Object (Workers KV allows too few writes a day for this).

async function hub(env, method, body = {}) {
  if (!env.PRESENCE) throw new Error('The PRESENCE Durable Object is missing (see wrangler.toml).')
  const stub = env.PRESENCE.get(env.PRESENCE.idFromName('everyone'))
  const res = await stub.fetch('https://presence/', { method: 'POST', body: JSON.stringify({ method, ...body }) })
  return res.json()
}

function cleanNow(b) {
  const t = b?.track
  const track =
    t && typeof t.uri === 'string' && /^spotify:(track|episode):[A-Za-z0-9]{10,40}$/.test(t.uri)
      ? {
          uri: t.uri,
          name: str(t.name, 200),
          artists: str(t.artists, 300),
          image: img(t.image, 1000),
          durationMs: Number.isFinite(t.durationMs) ? Math.max(0, Math.round(t.durationMs)) : 0
        }
      : null
  return {
    track,
    positionMs: Number.isFinite(b?.positionMs) ? Math.max(0, Math.round(b.positionMs)) : 0,
    paused: !!b?.paused,
    // their party link, when they have one on (others can join it)
    party: typeof b?.party === 'string' && /^https:\/\/[^\s"'<>]{4,300}$/.test(b.party) ? b.party : null
  }
}

async function nowRoute(req, env, path) {
  const me = await whoIs(req)
  if (!me) return json(401, { error: 'Sign in with Spotify again.' })
  if (path === '/v1/now' && req.method === 'PUT') {
    await hub(env, 'PUT', { id: me, now: cleanNow(await req.json().catch(() => ({}))) })
    return json(200, { ok: true })
  }
  if (path === '/v1/now' && req.method === 'DELETE') {
    await hub(env, 'DELETE', { id: me })
    return json(200, { ok: true })
  }
  const m = /^\/v1\/now\/([^/]+)$/.exec(path)
  if (m && req.method === 'GET') {
    const id = decodeURIComponent(m[1])
    if (!ID.test(id)) return json(404, { error: 'Not found' })
    const mine = await readFollows(env, me)
    if (!mine.following.includes(id)) return json(403, { error: 'Follow them first.' })
    const now = await hub(env, 'GET', { ids: [id] })
    return json(200, { now: now[id] ?? null })
  }
  return json(404, { error: 'Not found' })
}

// One object for the whole server (idFromName('everyone')). Requests reach it one at a time,
// so read-change-write here can't be cut in half by someone else's request.
export class Presence {
  constructor(ctx, env) {
    this.ctx = ctx
    this.env = env
    this.mem = new Map()
    this.index = null
    // First start after the update: copy the user list and follows over from KV, once.
    ctx.blockConcurrencyWhile(() => this.migrate())
  }

  async migrate() {
    if (await this.ctx.storage.get('migrated:v2')) return
    const kv = this.env.PULSE
    if (kv) {
      const old = (await kv.get('index', 'json')) ?? {}
      const entries = Object.values(old).filter((e) => e && typeof e.id === 'string')
      for (let i = 0; i < entries.length; i += 128) {
        await this.ctx.storage.put(Object.fromEntries(entries.slice(i, i + 128).map((e) => [`i:${e.id}`, e])))
      }
      let cursor
      do {
        const page = await kv.list({ prefix: 'f:', cursor })
        for (const k of page.keys) {
          const f = await kv.get(k.name, 'json')
          if (f) await this.ctx.storage.put(k.name, normFollows(f))
        }
        cursor = page.list_complete ? undefined : page.cursor
      } while (cursor)
    }
    await this.ctx.storage.put('migrated:v2', Date.now())
  }

  async loadIndex() {
    if (!this.index) {
      this.index = new Map()
      for (const [k, v] of await this.ctx.storage.list({ prefix: 'i:' })) this.index.set(k.slice(2), v)
    }
    return this.index
  }

  async follows(id) {
    return normFollows(await this.ctx.storage.get(`f:${id}`))
  }

  async fetch(req) {
    const b = await req.json()
    const FRESH = 4 * 60_000
    switch (b.method) {
      /* what people play right now */
      case 'PUT': {
        const now = { ...b.now, at: Date.now() }
        this.mem.set(b.id, now)
        await this.ctx.storage.put(`n:${b.id}`, now)
        return Response.json({ ok: true })
      }
      case 'DELETE':
        this.mem.delete(b.id)
        await this.ctx.storage.delete(`n:${b.id}`)
        return Response.json({ ok: true })
      case 'GET': {
        const ids = (Array.isArray(b.ids) ? b.ids : []).slice(0, 1000)
        const missing = ids.filter((x) => !this.mem.has(x))
        for (let i = 0; i < missing.length; i += 128) {
          const got = await this.ctx.storage.get(missing.slice(i, i + 128).map((x) => `n:${x}`))
          for (const [k, v] of got) this.mem.set(k.slice(2), v)
        }
        const out = {}
        for (const id of ids) {
          const n = this.mem.get(id)
          if (n && Date.now() - n.at < FRESH) out[id] = n
        }
        return Response.json(out)
      }

      /* the list of Pulse users */
      case 'index.all':
        return Response.json(Object.fromEntries(await this.loadIndex()))
      case 'index.set': {
        const e = b.entry
        const index = await this.loadIndex()
        index.set(e.id, e)
        await this.ctx.storage.put(`i:${e.id}`, e)
        return Response.json({ ok: true })
      }
      case 'index.del': {
        const index = await this.loadIndex()
        index.delete(b.id)
        await this.ctx.storage.delete(`i:${b.id}`)
        return Response.json({ ok: true })
      }

      /* who follows whom */
      case 'follows.get':
        return Response.json(await this.follows(b.id))
      case 'follows.act': {
        const { me, other, action } = b
        const [mine, theirs] = await Promise.all([this.follows(me), this.follows(other)])
        const without = (list, id) => list.filter((x) => x !== id)
        if (action === 'follow') {
          if (!mine.following.includes(other)) {
            if (mine.following.length >= MAX_FOLLOWING) return Response.json({ error: 'You follow too many people.' })
            mine.following.push(other)
          }
          if (!theirs.followers.includes(me) && theirs.followers.length < MAX_FOLLOWERS) theirs.followers.push(me)
          mine.meta[other] = b.meta
        } else if (action === 'unfollow') {
          mine.following = without(mine.following, other)
          theirs.followers = without(theirs.followers, me)
          delete mine.meta[other]
        } else if (action === 'dismiss') {
          // remove someone who follows you
          mine.followers = without(mine.followers, other)
          theirs.following = without(theirs.following, me)
        }
        await this.ctx.storage.put({ [`f:${me}`]: mine, [`f:${other}`]: theirs })
        return Response.json({ mine })
      }
    }
    return Response.json({ error: 'Unknown method' }, { status: 400 })
  }
}

/* ---------- Routes ---------- */

async function handle(req, env) {
  const u = new URL(req.url)
  const path = u.pathname.replace(/\/+$/, '')

  if (path === '/v1/health') return json(200, { ok: true, profiles: Object.keys(await readIndex(env)).length })

  if (path === '/v1/me' && (req.method === 'PUT' || req.method === 'DELETE')) {
    const id = await whoIs(req)
    if (!id) return json(401, { error: 'Sign in with Spotify again.' })
    if (req.method === 'DELETE') {
      await env.PULSE.delete(`p:${id}`)
      await hub(env, 'index.del', { id })
      return json(200, { ok: true })
    }
    const text = await req.text()
    if (text.length > MAX_BODY) return json(413, { error: 'The profile is too big. Use smaller pictures.' })
    let body
    try {
      body = JSON.parse(text || '{}')
    } catch {
      return json(400, { error: 'Bad request' })
    }
    const p = clean(id, body)
    await env.PULSE.put(`p:${id}`, JSON.stringify(p))
    await hub(env, 'index.set', { entry: { id, displayName: p.displayName, thumb: p.thumb, updatedAt: p.updatedAt } })
    return json(200, { ok: true, updatedAt: p.updatedAt })
  }

  // someone's follow lists, for anyone signed in (like on Spotify)
  const fm = /^\/v1\/users\/([^/]+)\/follows$/.exec(path)
  if (fm && req.method === 'GET') {
    if (!(await whoIs(req))) return json(401, { error: 'Sign in with Spotify again.' })
    const id = decodeURIComponent(fm[1])
    if (!ID.test(id)) return json(404, { error: 'Not found' })
    const [f, index] = await Promise.all([readFollows(env, id), readIndex(env)])
    const one = (x) => (index[x] ? { ...index[x], pulse: true } : { id: x, displayName: f.meta[x]?.displayName || x, thumb: f.meta[x]?.thumb ?? null, updatedAt: 0, pulse: false })
    return json(200, { followers: f.followers.slice(0, 500).map(one), following: f.following.slice(0, 500).map(one) })
  }

  const m = /^\/v1\/users\/([^/]+)$/.exec(path)
  if (m && req.method === 'GET') {
    const id = decodeURIComponent(m[1])
    if (!ID.test(id)) return json(404, { error: 'Not a Pulse user.' })
    const p = await env.PULSE.get(`p:${id}`, 'json')
    return p ? json(200, p) : json(404, { error: 'Not a Pulse user.' })
  }

  if (path === '/v1/lookup' && req.method === 'POST') {
    const body = await req.json().catch(() => ({}))
    const ids = (Array.isArray(body?.ids) ? body.ids : []).slice(0, 100).filter((x) => typeof x === 'string' && ID.test(x))
    const index = ids.length ? await readIndex(env) : {}
    return json(200, { users: ids.filter((x) => index[x]).map((x) => index[x]) })
  }

  if (path === '/v1/search' && req.method === 'GET') {
    const q = norm(u.searchParams.get('q')).replace(/^@/, '').slice(0, 60)
    if (q.length < 2) return json(200, { users: [] })
    const found = []
    for (const s of Object.values(await readIndex(env))) {
      const name = norm(s.displayName)
      const id = s.id.toLowerCase()
      const score = id === q ? 0 : name === q ? 1 : id.startsWith(q) || name.startsWith(q) ? 2 : name.includes(q) || id.includes(q) ? 3 : -1
      if (score >= 0) found.push([score, s])
    }
    found.sort((a, b) => a[0] - b[0] || b[1].updatedAt - a[1].updatedAt)
    return json(200, { users: found.slice(0, 20).map((x) => x[1]) })
  }

  if (path === '/v1/friends' || path.startsWith('/v1/friends/')) return friendsRoute(req, env, path)
  if (path === '/v1/now' || path.startsWith('/v1/now/')) return nowRoute(req, env, path)

  return json(404, { error: 'Not found' })
}

export default {
  async fetch(req, env) {
    try {
      return await handle(req, env)
    } catch (e) {
      console.error(e)
      return json(500, { error: 'Something went wrong.' })
    }
  }
}
