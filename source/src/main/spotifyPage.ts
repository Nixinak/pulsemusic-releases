// What the Spotify app shows on an artist page but the Web API doesn't give apps:
//  - the wide header image (the API only has a 640 px square photo),
//  - monthly listeners,
//  - the "Popular" list in Spotify's own order.
// The Popular order comes from Spotify's public embed page (plain HTML with JSON). The header
// image and listener count are only rendered by the full web page, so it is opened in a hidden
// window, read, and closed. Results are cached on disk for a week. If Spotify changes its
// pages, the fields come back empty and the app uses the Web API data instead.
import { app, BrowserWindow, session } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PageAlbum, PageArtist, PageTrack } from '@shared/types'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'
const WEEK = 7 * 24 * 3600_000

type Cached = { at: number; data: PageArtist }
let disk: Record<string, Cached> | null = null
const file = (): string => join(app.getPath('userData'), 'data', 'artist-pages.json')

function readDisk(): Record<string, Cached> {
  if (disk) return disk
  try {
    disk = existsSync(file()) ? (JSON.parse(readFileSync(file(), 'utf8')) as Record<string, Cached>) : {}
  } catch {
    disk = {}
  }
  return disk
}

function writeDisk(): void {
  try {
    mkdirSync(join(app.getPath('userData'), 'data'), { recursive: true })
    const all = readDisk()
    // Keep the file small: newest 300 artists.
    const keep = Object.entries(all)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, 300)
    disk = Object.fromEntries(keep)
    writeFileSync(file(), JSON.stringify(disk))
  } catch (e) {
    console.warn('[artist page] could not save cache', e)
  }
}

/* ---------- Popular list (embed page) ---------- */

async function popular(id: string): Promise<{ tracks: PageTrack[]; avatar: string | null }> {
  const res = await fetch(`https://open.spotify.com/embed/artist/${id}`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    signal: AbortSignal.timeout(10_000)
  })
  if (!res.ok) return { tracks: [], avatar: null }
  const html = await res.text()
  const m = /<script[^>]*id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/.exec(html)
  if (!m) return { tracks: [], avatar: null }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entity: any = JSON.parse(m[1])?.props?.pageProps?.state?.data?.entity
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tracks: PageTrack[] = (entity?.trackList ?? []).map((t: any) => ({
    id: String(t.uri ?? '').split(':').pop() ?? '',
    uri: t.uri,
    name: t.title ?? '',
    playcount: 0,
    durationMs: t.duration ?? 0,
    explicit: !!t.isExplicit,
    artists: String(t.subtitle ?? '')
      .split(',')
      .map((n: string) => ({ id: '', name: n.trim() }))
      .filter((a: { name: string }) => a.name),
    album: null
  }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const imgs: any[] = entity?.visualIdentity?.image ?? []
  const avatar = imgs.length ? imgs.reduce((a, b) => ((b.maxWidth ?? 0) > (a.maxWidth ?? 0) ? b : a)).url : null
  return { tracks: tracks.filter((t) => t.id && t.name), avatar }
}

/* ---------- Everything else: the page's own data (artist overview) ---------- */

// The public artist page loads one big JSON answer ("artist overview") with the popular songs,
// play counts, covers, the whole discography, the bio and the stats. Pulse reads that answer
// while the hidden page loads, so none of it costs requests from the app's Spotify allowance.
type Overview = Partial<Pick<PageArtist, 'topTracks' | 'albums' | 'singles' | 'compilations' | 'latest' | 'bio' | 'links' | 'followers' | 'worldRank' | 'topCities' | 'gallery' | 'monthlyListeners'>> & {
  headerUrl?: string | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bestSrc = (img: any): string | null => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const list: any[] = img?.sources ?? img?.data?.sources ?? []
  if (!list.length) return null
  return list.reduce((a, b) => ((b.width ?? b.maxWidth ?? 0) > (a.width ?? a.maxWidth ?? 0) ? b : a)).url ?? null
}
const idOf = (uri: unknown): string => String(uri ?? '').split(':').pop() ?? ''
const pad = (n: unknown): string => String(n).padStart(2, '0')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function release(r: any): PageAlbum | null {
  if (!r?.uri && !r?.id) return null
  const d = r.date ?? {}
  const date = d.isoString ? String(d.isoString).slice(0, 10) : [d.year, d.month && pad(d.month), d.day && pad(d.day)].filter(Boolean).join('-')
  return {
    id: r.id ?? idOf(r.uri),
    uri: r.uri ?? `spotify:album:${r.id}`,
    name: r.name ?? '',
    type: String(r.type ?? 'album').toLowerCase(),
    date,
    image: bestSrc(r.coverArt),
    tracks: r.tracks?.totalCount ?? 0
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const group = (g: any): PageAlbum[] =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ((g?.items ?? []) as any[])
    .flatMap((i) => i?.releases?.items ?? [i])
    .map(release)
    .filter((x): x is PageAlbum => !!x)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseOverview(au: any): Overview {
  const disc = au?.discography ?? {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tracks: PageTrack[] = ((disc.topTracks?.items ?? []) as any[])
    .map((i) => i?.track)
    .filter(Boolean)
    .map((t) => ({
      id: t.id ?? idOf(t.uri),
      uri: t.uri,
      name: t.name ?? '',
      playcount: Number(t.playcount) || 0,
      durationMs: t.duration?.totalMilliseconds ?? 0,
      explicit: t.contentRating?.label === 'EXPLICIT',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      artists: ((t.artists?.items ?? []) as any[]).map((a) => ({ id: idOf(a.uri), name: a.profile?.name ?? '' })),
      album: t.albumOfTrack
        ? { id: idOf(t.albumOfTrack.uri), uri: t.albumOfTrack.uri, image: bestSrc(t.albumOfTrack.coverArt), name: t.albumOfTrack.name }
        : null
    }))
    .filter((t: PageTrack) => t.id && t.name)
  const stats = au?.stats ?? {}
  const bio = au?.profile?.biography?.text
  return {
    topTracks: tracks,
    latest: release(disc.latest),
    albums: group(disc.albums),
    singles: group(disc.singles),
    compilations: group(disc.compilations),
    bio: bio ? String(bio).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim() : null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    links: ((au?.profile?.externalLinks?.items ?? []) as any[]).map((l) => ({ name: l.name, url: l.url })).filter((l) => l.url),
    followers: typeof stats.followers === 'number' ? stats.followers : null,
    monthlyListeners: typeof stats.monthlyListeners === 'number' ? stats.monthlyListeners : null,
    worldRank: stats.worldRank || null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    topCities: ((stats.topCities?.items ?? []) as any[]).map((c) => ({ city: c.city, country: c.country, listeners: Number(c.numberOfListeners) || 0 })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    gallery: ((au?.visuals?.gallery?.items ?? []) as any[]).map(bestSrc).filter((x): x is string => !!x),
    headerUrl: bestSrc(au?.visuals?.headerImage)
  }
}

/** Second way in: the songs and releases as the page draws them (covers, play counts, years). */
async function readFromDom(win: BrowserWindow): Promise<Overview | null> {
  const js = `(() => {
    const idOf = (href) => (href || '').split('/').pop().split('?')[0];
    const big = (src) => src ? src.replace(/(ab67616d0000)[0-9a-f]{4}/, '$1b273') : null;
    window.scrollTo(0, document.body.scrollHeight);
    document.querySelectorAll('main, [data-testid="artist-page"], .main-view-container__scroll-node, [data-overlayscrollbars-viewport]').forEach((el) => { try { el.scrollTop = el.scrollHeight; } catch (e) {} });
    let rows = [...document.querySelectorAll('[data-testid="tracklist-row"]')];
    if (!rows.length) rows = [...new Set([...document.querySelectorAll('a[href*="/track/"]')].map((a) => a.closest('[role="row"]') || a.parentElement.parentElement))];
    const tracks = rows.map((row) => {
      const a = row.querySelector('a[href*="/track/"]');
      const img = row.querySelector('img');
      const cells = [...row.querySelectorAll('div, span')].map((e) => (e.childElementCount ? '' : (e.textContent || '').trim()));
      const plays = cells.find((t) => /^\d{1,3}([,.\s]\d{3})+$|^\d{4,}$/.test(t)) || '';
      const dur = cells.find((t) => /^\d{1,2}:\d{2}$/.test(t)) || '0:00';
      const [mm, ss] = dur.split(':').map(Number);
      return a ? { id: idOf(a.getAttribute('href')), name: (a.textContent || '').trim(), image: big(img && img.getAttribute('src')), playcount: Number(plays.replace(/\D/g, '')) || 0, durationMs: (mm * 60 + ss) * 1000, explicit: !!row.querySelector('[aria-label="Explicit"], [title="Explicit"]') } : null;
    }).filter(Boolean);
    const cards = [...document.querySelectorAll('a[href*="/album/"]')].map((a) => {
      const card = a.closest('[data-testid="card"], [data-encore-id="card"], [role="group"]') || a.parentElement;
      const img = card && card.querySelector('img');
      const sub = card ? [...card.querySelectorAll('span, div')].map((e) => (e.childElementCount ? '' : (e.textContent || '').trim())).find((t) => /(19|20)\d{2}/.test(t)) || '' : '';
      const year = (sub.match(/(19|20)\d{2}/) || [''])[0];
      const type = /single/i.test(sub) ? 'single' : /\bep\b/i.test(sub) ? 'ep' : /compilation/i.test(sub) ? 'compilation' : 'album';
      return { id: idOf(a.getAttribute('href')), name: (a.textContent || '').trim(), image: big(img && img.getAttribute('src')), date: year, type, latest: !!(card && /latest release/i.test(card.textContent || '')) };
    }).filter((c) => c.id && c.name);
    return { tracks, cards };
  })()`
  // the discography part draws a moment after the top of the page
  for (let i = 0; i < 10; i++) {
    const r = (await win.webContents.executeJavaScript(js)) as {
      tracks: { id: string; name: string; image: string | null; playcount: number; durationMs: number; explicit: boolean }[]
      cards: { id: string; name: string; image: string | null; date: string; type: string; latest: boolean }[]
    }
    if (r.tracks.length && (r.cards.length || i >= 3)) {
      const seenIds = new Set<string>()
      const rel = r.cards.filter((c) => !seenIds.has(c.id) && seenIds.add(c.id))
      const toAlbum = (c: (typeof rel)[number]): PageAlbum => ({ id: c.id, uri: `spotify:album:${c.id}`, name: c.name, type: c.type, date: c.date, image: c.image, tracks: 0 })
      const latest = rel.find((c) => c.latest)
      return {
        topTracks: r.tracks.map((t) => ({
          id: t.id,
          uri: `spotify:track:${t.id}`,
          name: t.name,
          playcount: t.playcount,
          durationMs: t.durationMs,
          explicit: t.explicit,
          artists: [],
          album: t.image ? { id: '', uri: '', image: t.image } : null
        })),
        latest: latest ? toAlbum(latest) : null,
        albums: rel.filter((c) => c.type === 'album' || c.type === 'compilation').map(toAlbum),
        singles: rel.filter((c) => c.type === 'single' || c.type === 'ep').map(toAlbum),
        compilations: []
      }
    }
    await new Promise((res) => setTimeout(res, 400))
  }
  return null
}

/* ---------- Header image + listeners (full page in a hidden window) ---------- */

let chain: Promise<unknown> = Promise.resolve()
/** The hidden page being read right now (closed on timeout). */
let current: BrowserWindow | null = null

/** One hidden window at a time, so opening several artists doesn't spawn several browsers. */
function headerAndStats(id: string): Promise<{ header: PageArtist['header']; monthlyListeners: number | null; overview: Overview | null; source?: string }> {
  // never let one stuck page hold up the next ones: give up after 20 s
  const run = chain.then(() =>
    Promise.race([
      scrape(id),
      new Promise<never>((_, reject) =>
        setTimeout(() => {
          // close the hidden page so the next artist can start
          if (current && !current.isDestroyed()) current.destroy()
          reject(new Error('the page took too long'))
        }, 20_000)
      )
    ])
  )
  chain = run.catch(() => {})
  return run
}

async function scrape(id: string): Promise<{ header: PageArtist['header']; monthlyListeners: number | null; overview: Overview | null; source?: string }> {
  const ses = session.fromPartition('spotify-web')
  ses.setUserAgent(UA, 'en-US,en')
  if (!blocking.has(ses)) {
    blocking.add(ses)
    // Only the page's text and script matter here: skip pictures, video, fonts and audio so
    // the hidden page is ready sooner.
    ses.webRequest.onBeforeRequest((d, cb) => cb({ cancel: ['image', 'media', 'font'].includes(d.resourceType) }))
  }
  const win = new BrowserWindow({
    show: false,
    width: 1400,
    height: 900,
    webPreferences: { session: ses, offscreen: false, backgroundThrottling: false, images: false, sandbox: true }
  })
  current = win
  win.webContents.setAudioMuted(true)
  // Catch the page's own "artist overview" answer as it arrives.
  let overview: Overview | null = null
  const seen: string[] = []
  const dbg = win.webContents.debugger
  const watched = new Set<string>()
  try {
    dbg.attach('1.3')
    await dbg.sendCommand('Network.enable')
    // Spotify's player may fetch from a web worker: watch those too (each gets a session id)
    await dbg.sendCommand('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }).catch(() => {})
    dbg.on(
      'message',
      (_e, method: string, params: { requestId: string; response?: { url: string }; sessionId?: string; targetInfo?: { type: string } }, sessionId?: string) => {
      if (method === 'Target.attachedToTarget' && params.sessionId) {
        void dbg.sendCommand('Network.enable', {}, params.sessionId).catch(() => {})
        void dbg.sendCommand('Runtime.runIfWaitingForDebugger', {}, params.sessionId).catch(() => {})
        return
      }
      const key = `${sessionId ?? ''}|${params.requestId}`
      if (method === 'Network.responseReceived' && /pathfinder|api-partner|spclient/.test(params.response?.url ?? '')) {
        watched.add(key)
        seen.push((params.response?.url ?? '').replace(/^https?:\/\//, '').split('?')[0].slice(0, 60))
      }
      if (method === 'Network.loadingFinished' && watched.has(key)) {
        watched.delete(key)
        dbg
          .sendCommand('Network.getResponseBody', { requestId: params.requestId }, sessionId)
          .then((b: { body: string; base64Encoded: boolean }) => {
            const text = b.base64Encoded ? Buffer.from(b.body, 'base64').toString('utf8') : b.body
            const au = JSON.parse(text)?.data?.artistUnion
            if (au && (au.discography || au.stats)) {
              const o = parseOverview(au)
              // several answers can arrive; keep the richest
              if (!overview || (o.topTracks?.length ?? 0) >= (overview.topTracks?.length ?? 0)) overview = { ...overview, ...o }
            }
          })
          .catch(() => {})
      }
      }
    )
  } catch (e) {
    console.warn('[artist page] could not watch the page data', e)
  }
  try {
    await win.loadURL(`https://open.spotify.com/artist/${id}`, { userAgent: UA })
    const read = `(() => {
      const bg = document.querySelector('[data-testid="background-image"]');
      const m = (bg && (bg.style.backgroundImage || '')).match(/url\\("?([^")]+)"?\\)/);
      const header = m ? m[1] : null;
      const text = [...document.querySelectorAll('[data-testid="entity-header"] span, [data-testid="artist-page"] span, span')]
        .map((e) => e.textContent || '').find((t) => /monthly listeners/i.test(t) && t.length < 80) || '';
      // The text holds both "76.7M" and "76,719,642"; take the exact (largest) number.
      const nums = [...text.matchAll(/(\\d[\\d,.\\s]*)\\s*monthly listeners/gi)].map((x) => Number(x[1].replace(/[^\\d]/g, '')));
      return { header, listeners: nums.length ? Math.max(...nums) : null, ready: !!document.querySelector('[data-testid="entity-header"]') };
    })()`
    // The page builds itself with script; wait until the header is there (at most ~12 s).
    for (let i = 0; i < 40; i++) {
      const r = (await win.webContents.executeJavaScript(read)) as { header: string | null; listeners: number | null; ready: boolean }
      if (r.ready && (r.header || i > 10) && (r.listeners || i > 14) && (overview || i > 20)) {
        let ov = overview as Overview | null
        if (!ov) {
          // the page's data answer wasn't caught: read what the page shows instead
          ov = await readFromDom(win).catch(() => null)
          console.info(`[artist page] ${id}: data answer not seen (${seen.length ? seen.slice(-4).join(', ') : 'no API calls seen'}); read from the page: ${ov?.topTracks?.length ?? 0} songs, ${(ov?.albums?.length ?? 0) + (ov?.singles?.length ?? 0)} releases`)
        }
        const head = r.header ?? ov?.headerUrl ?? null
        const source = overview ? 'data answer' : ov ? 'page content' : `embed only (seen: ${seen.slice(-3).join(', ') || 'no API calls'})`
        return { header: head ? await largest(head) : null, monthlyListeners: r.listeners ?? ov?.monthlyListeners ?? null, overview: ov, source }
      }
      await new Promise((res) => setTimeout(res, 300))
    }
    const ov = overview as Overview | null
    return { header: ov?.headerUrl ? await largest(ov.headerUrl) : null, monthlyListeners: ov?.monthlyListeners ?? null, overview: ov }
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

const blocking = new WeakSet<Electron.Session>()

/** Header image URLs carry a size code; "1016" is Spotify's full 2660 × 1140 version.
 *  Returns that one when it exists, else the size the page used. */
export async function largest(url: string): Promise<{ url: string; width: number; height: number }> {
  const big = url.replace(/(\/image\/ab6761860000)[0-9a-f]{4}/, (_m, head: string) => `${head}1016`)
  if (big !== url) {
    try {
      const res = await fetch(big, { headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(6000) })
      if (res.ok) return { url: big, width: 2660, height: 1140 }
    } catch {
      /* fall back to the size the page used */
    }
  }
  return measure(url)
}

/** Width and height of an image, read from its JPEG header (only the first bytes are fetched). */
async function measure(url: string): Promise<{ url: string; width: number; height: number }> {
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-65535' }, signal: AbortSignal.timeout(8000) })
    const b = Buffer.from(await res.arrayBuffer())
    for (let i = 2; i < b.length - 9; ) {
      if (b[i] !== 0xff) break
      const marker = b[i + 1]
      const len = b.readUInt16BE(i + 2)
      if (marker >= 0xc0 && marker <= 0xc3) return { url, height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) }
      i += 2 + len
    }
  } catch {
    /* unknown size */
  }
  return { url, width: 1500, height: 640 }
}

/* ---------- Public ---------- */

const quick = new Map<string, Promise<{ tracks: PageTrack[]; avatar: string | null }>>()
/** The popular songs from the small embed page (about a second): shown while the full page
 *  data is still loading. Kept in memory for this session. */
export function getArtistQuick(id: string): Promise<{ tracks: PageTrack[]; avatar: string | null }> {
  const hit = readDisk()[id]
  if (hit?.data.topTracks.length) return Promise.resolve({ tracks: hit.data.topTracks, avatar: hit.data.avatar })
  let p = quick.get(id)
  if (!p) {
    p = popular(id).catch(() => ({ tracks: [] as PageTrack[], avatar: null }))
    quick.set(id, p)
  }
  return p
}

const pending = new Map<string, Promise<PageArtist | null>>()

export function getArtistPage(id: string): Promise<PageArtist | null> {
  const hit = readDisk()[id]
  // entries saved before Pulse read the page's full data (no `latest` field) are loaded again
  if (hit && Date.now() - hit.at < WEEK && 'latest' in hit.data) {
    // Entries saved before the full-size banner was known: upgrade them once.
    if (hit.data.header && hit.data.header.width < 2000) {
      return largest(hit.data.header.url).then((h) => {
        hit.data.header = h
        writeDisk()
        return hit.data
      })
    }
    return Promise.resolve(hit.data)
  }
  const running = pending.get(id)
  if (running) return running
  const p = (async () => {
    const [pop, web] = await Promise.all([
      popular(id).catch((e) => {
        console.warn('[artist page] popular failed', e instanceof Error ? e.message : e)
        return { tracks: [] as PageTrack[], avatar: null }
      }),
      headerAndStats(id).catch((e) => {
        console.warn('[artist page] header failed', e instanceof Error ? e.message : e)
        return { header: null, monthlyListeners: null, overview: null, source: 'page failed to load' as string | undefined }
      })
    ])
    const ov = web.overview
    console.info(
      `[artist page] ${id}: ${ov ? `page data ok (${ov.topTracks?.length ?? 0} songs, ${(ov.albums?.length ?? 0) + (ov.singles?.length ?? 0)} releases)` : 'no page data, using the embed list'}`
    )
    const data: PageArtist = {
      header: web.header,
      avatar: pop.avatar,
      gallery: ov?.gallery ?? [],
      monthlyListeners: web.monthlyListeners,
      followers: ov?.followers ?? null,
      worldRank: ov?.worldRank ?? null,
      topCities: ov?.topCities ?? [],
      bio: ov?.bio ?? null,
      links: ov?.links ?? [],
      // the overview has covers and play counts; the embed list is the fallback
      topTracks: ov?.topTracks?.length ? ov.topTracks : pop.tracks,
      // only a complete answer gets `latest` (the disk cache keeps those for a week; without
      // it the page is loaded again next time)
      ...(ov ? { latest: ov.latest ?? null } : {}),
      source: web.source ?? 'embed only',
      albums: ov?.albums ?? [],
      singles: ov?.singles ?? [],
      compilations: ov?.compilations ?? []
    }
    // Only remember complete answers; a failed load is tried again next time.
    if (data.header || data.topTracks.length) {
      readDisk()[id] = { at: Date.now(), data }
      writeDisk()
    }
    return data
  })().finally(() => pending.delete(id))
  pending.set(id, p)
  return p
}
