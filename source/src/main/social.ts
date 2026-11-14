// People: finding Spotify users, their public playlists, and Pulse profiles.
//
// Since February 2026 Spotify's Web API doesn't let apps look up other users, list their
// playlists or search for people. Their public web pages still show all of that, so (like the
// artist pages in spotifyPage.ts) Pulse opens them in a hidden window and reads the page's own
// data answers. Song lists of other people's playlists come from the small public embed page.
// If Spotify changes its pages these come back empty and the app says so.
//
// Pulse profiles live on the Pulse server (server/ in this repository), set with
// MAIN_VITE_PULSE_SERVER at build time.
import { BrowserWindow, session } from 'electron'
import { getAccessToken } from './auth'
import type { PulseProfile, PulseSummary, SpotifyUserPage, SpotifyUserHit, EmbedPlaylist, FriendsState, FriendAction, NowPlaying, FollowLists, Listener } from '@shared/types'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'

/* ---------- Reading Spotify's public pages ---------- */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

function walk(x: Json, visit: (o: Json) => void, depth = 0): void {
  if (!x || typeof x !== 'object' || depth > 14) return
  visit(x)
  for (const v of Array.isArray(x) ? x : Object.values(x)) walk(v, visit, depth + 1)
}

/** The largest picture in any of the shapes Spotify uses. */
function pictureOf(o: Json): string | null {
  if (!o || typeof o !== 'object') return null
  if (typeof o.image_url === 'string' && o.image_url) return o.image_url
  const lists: Json[] = [o.avatar?.sources, o.images?.items?.[0]?.sources, o.coverArt?.sources, o.sources, Array.isArray(o.images) ? o.images : null]
  for (const list of lists) {
    if (!Array.isArray(list) || !list.length) continue
    const best = list.reduce((a: Json, b: Json) => ((b?.width ?? b?.maxWidth ?? 0) > (a?.width ?? a?.maxWidth ?? 0) ? b : a))
    if (typeof best?.url === 'string') return best.url
  }
  return null
}

let chain: Promise<unknown> = Promise.resolve()
let blocking = false

/**
 * Opens `url` in a hidden window, hands every JSON answer the page receives to `onJson`, and
 * runs `readDom` (page script returning T) until `enough` says so or `maxMs` passes.
 * One window at a time.
 */
/** `p`, or `fallback` when it hasn't settled after `ms` (a stuck page must never stall everything). */
function within<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))])
}

function readPage<T>(url: string, onJson: (j: Json) => void, readDom: string, enough: (dom: T | null) => boolean, maxMs = 14_000, ownLane = false): Promise<T | null> {
  let win: BrowserWindow | null = null
  const work = async (): Promise<T | null> => {
    const started = Date.now()
    console.info('[people] reading', url)
    const ses = session.fromPartition('spotify-people')
    ses.setUserAgent(UA, 'en-US,en')
    if (!blocking) {
      blocking = true
      // only the page's script and data matter: skip pictures, video and fonts
      ses.webRequest.onBeforeRequest((d, cb) => cb({ cancel: ['image', 'media', 'font'].includes(d.resourceType) }))
    }
    win = new BrowserWindow({ show: false, width: 1400, height: 900, webPreferences: { session: ses, backgroundThrottling: false, images: false, sandbox: true } })
    const w = win
    w.webContents.setAudioMuted(true)
    const dbg = w.webContents.debugger
    const watched = new Set<string>()
    let answers = 0
    try {
      dbg.attach('1.3')
      await within(dbg.sendCommand('Network.enable'), 3000, null)
      void dbg.sendCommand('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }).catch(() => {})
      dbg.on('message', (_e, method: string, params: Json, sessionId?: string) => {
        if (method === 'Target.attachedToTarget' && params.sessionId) {
          void dbg.sendCommand('Network.enable', {}, params.sessionId).catch(() => {})
          void dbg.sendCommand('Runtime.runIfWaitingForDebugger', {}, params.sessionId).catch(() => {})
          return
        }
        const key = `${sessionId ?? ''}|${params.requestId}`
        if (method === 'Network.responseReceived' && /pathfinder|api-partner|spclient|user-profile/.test(params.response?.url ?? '')) watched.add(key)
        if (method === 'Network.loadingFinished' && watched.has(key)) {
          watched.delete(key)
          dbg
            .sendCommand('Network.getResponseBody', { requestId: params.requestId }, sessionId)
            .then((b: { body: string; base64Encoded: boolean }) => {
              const text = b.base64Encoded ? Buffer.from(b.body, 'base64').toString('utf8') : b.body
              try {
                onJson(JSON.parse(text))
                answers++
              } catch {
                /* not JSON */
              }
            })
            .catch(() => {})
        }
      })
    } catch (e) {
      console.warn('[people] could not watch the page data', e)
    }
    // a redirect (to a localized page, say) rejects loadURL although the page then loads fine
    await within(
      w.loadURL(url, { userAgent: UA }).catch((e) => console.info('[people] page load:', e instanceof Error ? e.message : e)),
      maxMs,
      undefined
    )
    let dom: T | null = null
    const until = started + maxMs
    while (Date.now() < until && !w.isDestroyed()) {
      dom = (await within(w.webContents.executeJavaScript(readDom).catch(() => null), 2500, null)) as T | null
      if (enough(dom)) break
      await new Promise((r) => setTimeout(r, 200))
    }
    console.info(`[people] read ${w.isDestroyed() ? '' : w.webContents.getURL()} in ${Date.now() - started} ms, ${answers} data answers`)
    return dom
  }
  const go = (): Promise<T | null> =>
    within(
      work().catch((e) => (console.warn('[people] page read failed', e), null)),
      maxMs + 8000,
      null
    ).finally(() => {
      if (win && !win.isDestroyed()) win.destroy()
    })
  // a list someone is waiting for on screen doesn't queue behind other page reads
  if (ownLane) return go()
  const run = chain.then(go)
  chain = run.catch(() => {})
  return run
}

const userSearchCache = new Map<string, { at: number; hits: SpotifyUserHit[] }>()

/** Spotify users whose name matches `q` (from Spotify's own search page). */
export async function searchSpotifyUsers(q: string): Promise<SpotifyUserHit[]> {
  const key = q.toLowerCase().trim()
  const hit = userSearchCache.get(key)
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.hits
  const found = new Map<string, SpotifyUserHit>()
  const add = (h: SpotifyUserHit): void => {
    const old = found.get(h.id)
    found.set(h.id, { id: h.id, name: h.name || old?.name || h.id, image: h.image ?? old?.image ?? null })
  }
  const readDom = `(() => [...(document.querySelector('main') || document).querySelectorAll('a[href*="/user/"]')].map((a) => {
      const id = decodeURIComponent((a.getAttribute('href') || '').split('/user/')[1] || '').split(/[/?#]/)[0];
      const card = a.closest('[data-encore-id="card"], [role="group"], [data-testid*="card"]') || a.parentElement;
      const img = card && card.querySelector('img');
      return { id, name: (a.getAttribute('title') || a.textContent || '').trim(), image: img ? img.getAttribute('src') : null };
    }).filter((x) => x.id))()`
  const dom = await readPage<SpotifyUserHit[]>(
    `https://open.spotify.com/search/${encodeURIComponent(q)}/users`,
    (j) =>
      walk(j, (o) => {
        if (typeof o.uri === 'string' && o.uri.startsWith('spotify:user:') && (o.displayName || o.name || o.username))
          add({ id: o.uri.slice('spotify:user:'.length), name: String(o.displayName ?? o.name ?? o.username), image: pictureOf(o) })
      }),
    readDom,
    (d) => found.size > 0 || (d?.length ?? 0) > 0,
    8000
  ).catch(() => null)
  for (const d of dom ?? []) add(d)
  const hits = [...found.values()].slice(0, 20)
  console.info(`[people] user search "${q}": ${hits.length} found`)
  userSearchCache.set(key, { at: hits.length ? Date.now() : Date.now() - 4 * 60_000, hits })
  return hits
}

const userCache = new Map<string, { at: number; page: SpotifyUserPage | null }>()

/** Someone's public Spotify profile: name, picture and public playlists. */
export async function getSpotifyUser(id: string): Promise<SpotifyUserPage | null> {
  const hit = userCache.get(id)
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.page
  const me = `spotify:user:${id}`
  let name: string | null = null
  let image: string | null = null
  let followers: number | null = null
  let following: number | null = null
  const lists = new Map<string, SpotifyUserPage['playlists'][number]>()
  let readyAt = 0
  const readDom = `(() => {
      const main = document.querySelector('main') || document.body;
      const meta = (p) => { const m = document.querySelector('meta[property="' + p + '"]'); return m ? m.getAttribute('content') : null; };
      // the sidebar has its own h1 ("Your Library"): only the profile's title counts
      const titled = main.querySelector('[data-testid="entityTitle"] h1, [data-testid="entityTitle"]');
      const h1 = [...main.querySelectorAll('h1')].map((h) => h.textContent.trim()).find((t) => t && !/^your library$/i.test(t));
      const og = (meta('og:title') || '').replace(/\\s*\\|\\s*Spotify$/i, '').trim();
      const name = (titled && titled.textContent.trim()) || h1 || og || null;
      const pic = main.querySelector('[data-testid="entity-image"] img, [data-testid="user-image"] img, [data-testid="hero-image"] img');
      const image = (pic && pic.getAttribute('src')) || meta('og:image');
      const f = (main.textContent || '').match(/([\\d][\\d,.\\s]*)\\s+Followers?\\b/i);
      const followers = f ? Number(f[1].replace(/[^\\d]/g, '')) : null;
      const g = (main.textContent || '').match(/([\\d][\\d,.\\s]*)\\s+Following\\b/i);
      const following = g ? Number(g[1].replace(/[^\\d]/g, '')) : null;
      const cardOf = (a) => a.closest('[data-encore-id="card"], [role="group"], [data-testid*="card"]') || a.parentElement;
      const lists = [...main.querySelectorAll('a[href*="/playlist/"]')].map((a) => {
        const id = (a.getAttribute('href') || '').split('/playlist/')[1]?.split(/[/?#]/)[0] || '';
        const img = cardOf(a) && cardOf(a).querySelector('img');
        return { id, name: (a.getAttribute('title') || a.textContent || '').trim(), image: img ? img.getAttribute('src') : null };
      }).filter((x) => x.id && x.name);
      const people = [...main.querySelectorAll('a[href*="/user/"]')].map((a) => {
        const id = decodeURIComponent((a.getAttribute('href') || '').split('/user/')[1] || '').split(/[/?#]/)[0];
        const img = cardOf(a) && cardOf(a).querySelector('img');
        return { id, name: (a.getAttribute('title') || a.textContent || '').trim(), image: img ? img.getAttribute('src') : null };
      }).filter((x) => x.id && x.name && x.id !== ${JSON.stringify(id)});
      return { name, image, followers, following, lists, people, ready: !!(titled || h1) };
    })()`
  type Dom = { name: string | null; image: string | null; followers: number | null; following: number | null; lists: { id: string; name: string; image: string | null }[]; people: { id: string; name: string; image: string | null }[]; ready: boolean }
  const dom = await readPage<Dom>(
    `https://open.spotify.com/user/${encodeURIComponent(id)}`,
    (j) => {
      // the profile answer ("user-profile-view") or the page's GraphQL data
      if (j?.uri === me) {
        name = j.name ?? j.displayName ?? name
        image = pictureOf(j) ?? image
        if (typeof j.followers_count === 'number') followers = j.followers_count
        if (typeof j.following_count === 'number') following = j.following_count
      }
      walk(j, (o) => {
        if (o.uri === me && (o.displayName || o.name)) {
          name = String(o.displayName ?? o.name)
          image = pictureOf(o) ?? image
        }
        if (typeof o.uri === 'string' && o.uri.startsWith('spotify:playlist:') && typeof o.name === 'string') {
          const pid = o.uri.slice('spotify:playlist:'.length)
          lists.set(pid, { id: pid, name: o.name, image: pictureOf(o) ?? lists.get(pid)?.image ?? null, followers: typeof o.followers_count === 'number' ? o.followers_count : null })
        }
      })
    },
    readDom,
    (d) => {
      if (!d?.ready) return false
      readyAt ||= Date.now()
      const waited = Date.now() - readyAt
      // playlists and the followers row (it shows a moment later); someone without public
      // playlists: don't wait the whole time
      if ((lists.size > 0 || d.lists.length > 0) && (d.people.length > 0 || waited > 1000)) return true
      return waited > 2000
    },
    12_000
  ).catch(() => null)
  for (const l of dom?.lists ?? []) if (!lists.has(l.id)) lists.set(l.id, { ...l, followers: null })
  const people = new Map<string, { id: string; name: string; image: string | null }>()
  for (const p of dom?.people ?? []) if (!people.has(p.id)) people.set(p.id, p)
  let page: SpotifyUserPage | null =
    name || dom?.name || lists.size
      ? {
          id,
          name: name ?? dom?.name ?? id,
          image: image ?? dom?.image ?? null,
          followers: followers ?? dom?.followers ?? null,
          following: following ?? dom?.following ?? null,
          playlists: [...lists.values()],
          people: [...people.values()].slice(0, 30)
        }
      : null
  if (!page) {
    // the full page showed nothing (a login wall, or Spotify changed it): the page's link preview
    // still has the name and picture, and sometimes its data
    page = await userFromHtml(id).catch((e) => (console.warn('[people] user page HTML:', e), null))
  }
  console.info(`[people] user ${id}:`, page ? `${page.name}, ${page.playlists.length} playlists${page.partial ? ' (name only)' : ''}` : 'nothing', '· page h1:', dom?.name ?? 'none')
  // don't keep a failure for long
  userCache.set(id, { at: page && !page.partial ? Date.now() : Date.now() - 9 * 60_000, page })
  return page
}

const followsCache = new Map<string, { at: number; people: { id: string; name: string; image: string | null }[] }>()

/** Someone's followers or the people they follow, from their public Spotify pages. */
export async function getSpotifyFollows(id: string, kind: 'followers' | 'following'): Promise<{ id: string; name: string; image: string | null }[]> {
  const key = `${kind}:${id}`
  const hit = followsCache.get(key)
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.people
  const found = new Map<string, { id: string; name: string; image: string | null }>()
  const owner = `spotify:user:${id}`
  const readDom = `(() => {
      const main = document.querySelector('main') || document.body;
      const cardOf = (a) => a.closest('[data-encore-id="card"], [role="group"], [data-testid*="card"]') || a.parentElement;
      return [...main.querySelectorAll('a[href*="/user/"]')].map((a) => {
        const uid = decodeURIComponent((a.getAttribute('href') || '').split('/user/')[1] || '').split(/[/?#]/)[0];
        const img = cardOf(a) && cardOf(a).querySelector('img');
        return { id: uid, name: (a.getAttribute('title') || a.textContent || '').trim(), image: img ? img.getAttribute('src') : null };
      }).filter((x) => x.id && x.name && x.id !== ${JSON.stringify(id)});
    })()`
  let settledAt = 0
  let last = -1
  const dom = await readPage<{ id: string; name: string; image: string | null }[]>(
    `https://open.spotify.com/user/${encodeURIComponent(id)}/${kind}`,
    (j) =>
      walk(j, (o) => {
        if (typeof o.uri === 'string' && o.uri.startsWith('spotify:user:') && o.uri !== owner && (o.name || o.displayName)) {
          const uid = o.uri.slice('spotify:user:'.length)
          found.set(uid, { id: uid, name: String(o.name ?? o.displayName), image: pictureOf(o) ?? found.get(uid)?.image ?? null })
        }
      }),
    readDom,
    (d) => {
      const n = Math.max(found.size, d?.length ?? 0)
      // the list stopped growing for a moment: that's all of it
      if (n !== last) {
        last = n
        settledAt = Date.now()
        return false
      }
      return n > 0 ? Date.now() - settledAt > 1200 : Date.now() - settledAt > 3500
    },
    10_000,
    true
  ).catch(() => null)
  for (const p of dom ?? []) if (!found.has(p.id)) found.set(p.id, p)
  const people = [...found.values()].slice(0, 300)
  console.info(`[people] ${kind} of ${id}: ${people.length}`)
  followsCache.set(key, { at: people.length ? Date.now() : Date.now() - 9 * 60_000, people })
  return people
}

const decodeHtml = (s: string): string =>
  s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')

/** Name, picture (and playlists when the page carries its data) from the plain HTML of the profile page. */
export async function userFromHtml(id: string): Promise<SpotifyUserPage | null> {
  const res = await fetch(`https://open.spotify.com/user/${encodeURIComponent(id)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)', 'Accept-Language': 'en-US,en;q=0.9' },
    signal: AbortSignal.timeout(10_000)
  })
  if (!res.ok) return null
  const html = await res.text()
  const meta = (p: string): string | null => {
    const m = new RegExp(`<meta[^>]+(?:property|name)="${p}"[^>]+content="([^"]*)"`, 'i').exec(html) ?? new RegExp(`<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="${p}"`, 'i').exec(html)
    return m ? decodeHtml(m[1]) : null
  }
  const me = `spotify:user:${id}`
  let name = meta('og:title')
  let image = meta('og:image')
  const lists = new Map<string, SpotifyUserPage['playlists'][number]>()
  // the page's own data, when it has it (base64 JSON)
  const state = /<script[^>]*id="initialState"[^>]*>([^<]+)<\/script>/.exec(html)
  if (state) {
    try {
      walk(JSON.parse(Buffer.from(state[1], 'base64').toString('utf8')), (o) => {
        if (o.uri === me && (o.displayName || o.name)) {
          name = String(o.displayName ?? o.name)
          image = pictureOf(o) ?? image
        }
        if (typeof o.uri === 'string' && o.uri.startsWith('spotify:playlist:') && typeof o.name === 'string') {
          const pid = o.uri.slice('spotify:playlist:'.length)
          lists.set(pid, { id: pid, name: o.name, image: pictureOf(o), followers: null })
        }
      })
    } catch {
      /* not readable */
    }
  }
  // links to playlists in the HTML itself
  for (const m of html.matchAll(/href="\/playlist\/([A-Za-z0-9]{10,40})"[^>]*>(?:<[^>]+>)*([^<]{1,200})</g))
    if (!lists.has(m[1])) lists.set(m[1], { id: m[1], name: decodeHtml(m[2]).trim(), image: null, followers: null })
  if (!name || /^spotify/i.test(name.trim())) return null
  return { id, name: name.replace(/\s*\|\s*Spotify$/i, '').trim(), image, followers: null, playlists: [...lists.values()], partial: lists.size === 0 }
}

/** Another person's playlist from the public embed page (the Web API hides its songs). */
export async function getEmbedPlaylist(id: string): Promise<EmbedPlaylist | null> {
  const res = await fetch(`https://open.spotify.com/embed/playlist/${encodeURIComponent(id)}`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    signal: AbortSignal.timeout(10_000)
  })
  if (!res.ok) return null
  const m = /<script[^>]*id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/.exec(await res.text())
  if (!m) return null
  const entity: Json = JSON.parse(m[1])?.props?.pageProps?.state?.data?.entity
  if (!entity) return null
  return {
    name: String(entity.name ?? entity.title ?? ''),
    owner: String(entity.subtitle ?? ''),
    image: pictureOf(entity) ?? pictureOf(entity.visualIdentity?.image ? { sources: entity.visualIdentity.image } : null),
    tracks: ((entity.trackList ?? []) as Json[])
      .filter((t) => typeof t?.uri === 'string' && t.uri.startsWith('spotify:track:'))
      .map((t) => ({
        id: t.uri.split(':').pop(),
        uri: t.uri,
        name: String(t.title ?? ''),
        artists: String(t.subtitle ?? '')
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean),
        durationMs: Number(t.duration ?? 0),
        explicit: !!t.isExplicit
      }))
  }
}

/* ---------- Pulse server ---------- */

const SERVER = (import.meta.env.MAIN_VITE_PULSE_SERVER ?? '').replace(/\/+$/, '')
export const pulseServerOn = (): boolean => !!SERVER

async function server<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!SERVER) throw new Error('The Pulse server isn’t set up.')
  const res = await fetch(`${SERVER}${path}`, { ...init, signal: AbortSignal.timeout(12_000) })
  const body = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw Object.assign(new Error(body.error ?? `The Pulse server answered ${res.status}.`), { status: res.status })
  return body
}

export async function getPulseProfile(id: string): Promise<PulseProfile | null> {
  if (!SERVER) return null
  try {
    return await server<PulseProfile>(`/v1/users/${encodeURIComponent(id)}`)
  } catch (e) {
    if ((e as { status?: number }).status === 404) return null
    throw e
  }
}

const badgeCache = new Map<string, { at: number; on: PulseSummary | null }>()

/** Which of these Spotify users use Pulse (cached for 10 minutes). */
export async function lookupPulse(ids: string[]): Promise<PulseSummary[]> {
  if (!SERVER || !ids.length) return []
  const fresh = (id: string): boolean => Date.now() - (badgeCache.get(id)?.at ?? 0) < 10 * 60_000
  const ask = [...new Set(ids)].filter((id) => !fresh(id)).slice(0, 100)
  if (ask.length) {
    const r = await server<{ users: PulseSummary[] }>('/v1/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: ask }) }).catch(() => null)
    if (r) {
      for (const id of ask) badgeCache.set(id, { at: Date.now(), on: null })
      for (const u of r.users) badgeCache.set(u.id, { at: Date.now(), on: u })
    }
  }
  return ids.map((id) => badgeCache.get(id)?.on).filter((u): u is PulseSummary => !!u)
}

export async function searchPulse(q: string): Promise<PulseSummary[]> {
  if (!SERVER) return []
  return (await server<{ users: PulseSummary[] }>(`/v1/search?q=${encodeURIComponent(q.slice(0, 60))}`)).users
}

/** Publishes (or with `null`, removes) your own Pulse profile. */
export async function publishPulse(body: { profile: unknown; snapshot: unknown; thumb: string | null } | null): Promise<void> {
  if (!SERVER) return
  const token = await getAccessToken()
  if (!token) {
    console.warn('[people] profile not published: no Spotify sign-in')
    throw new Error('Sign in with Spotify first.')
  }
  const text = body ? JSON.stringify(body) : undefined
  try {
    await server('/v1/me', {
      method: body ? 'PUT' : 'DELETE',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: text
    })
    console.info(body ? `[people] profile published (${Math.round((text?.length ?? 0) / 1024)} kB)` : '[people] profile removed from the Pulse server')
  } catch (e) {
    console.warn(`[people] profile not published (${Math.round((text?.length ?? 0) / 1024)} kB):`, e instanceof Error ? e.message : e)
    throw e
  }
}

/* ---------- Friends ---------- */

async function signedIn<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken()
  if (!token) throw new Error('Sign in with Spotify first.')
  return server<T>(path, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } })
}

export async function getFriends(): Promise<FriendsState> {
  if (!SERVER) return { friends: [], incoming: [], outgoing: [], now: {} }
  return signedIn<FriendsState>('/v1/friends')
}

export async function friendAction(action: FriendAction, id: string, who?: { name: string; image: string | null }): Promise<FriendsState> {
  if (!SERVER) throw new Error('The Pulse server isn’t set up.')
  return signedIn<FriendsState>(`/v1/friends/${action}`, { method: 'POST', body: JSON.stringify({ id, name: who?.name, image: who?.image }) })
}

export async function shareNow(now: Omit<NowPlaying, 'at'> | null): Promise<Listener[]> {
  if (!SERVER) return []
  const r = await signedIn<{ listeners?: Listener[] }>('/v1/now', now ? { method: 'PUT', body: JSON.stringify(now) } : { method: 'DELETE' })
  return Array.isArray(r?.listeners) ? r.listeners : []
}

export async function getListeners(): Promise<Listener[]> {
  if (!SERVER) return []
  const r = await signedIn<{ listeners?: Listener[] }>('/v1/listeners')
  return Array.isArray(r?.listeners) ? r.listeners : []
}

/** Someone's Pulse follow lists (null when the server doesn't have them yet). */
export async function followsOf(id: string): Promise<FollowLists | null> {
  if (!SERVER) return null
  try {
    return await signedIn<FollowLists>(`/v1/users/${encodeURIComponent(id)}/follows`)
  } catch (e) {
    console.info('[people] follow lists:', e instanceof Error ? e.message : e)
    return null
  }
}

export async function nowOf(id: string): Promise<NowPlaying | null> {
  if (!SERVER) return null
  return (await signedIn<{ now: NowPlaying | null }>(`/v1/now/${encodeURIComponent(id)}`)).now
}
