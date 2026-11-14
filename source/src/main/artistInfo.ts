// Everything Spotify's Web API no longer tells apps about an artist: social links, a bio,
// where they're from, and a sharper banner image. Gathered from open sources:
//  - MusicBrainz, looked up by the exact Spotify artist link (no name guessing), for links,
//    country and start year, plus the artist's Deezer, Genius and Wikidata pages when known.
//  - Genius for socials, a bio and a large header image (needs the Genius token from Settings).
//  - Deezer for a 1000 px portrait and fan count.
//  - Wikipedia for a short bio when Genius has none.
// Name-based matches (Genius, Deezer) must share at least one song title with Spotify, so a
// different artist with the same name is not shown.
import { getSettings } from './settings'
import { geniusSearch } from './lyrics'
import { getArtistPage } from './spotifyPage'
import type { ArtistInfo, ArtistInfoQuery, ArtistLink, ArtistLinkKind } from '@shared/types'

const UA = { 'User-Agent': 'PulseMusic/1.0 (https://github.com/nixqc/pulsemusic)', Accept: 'application/json' }
const cache = new Map<string, Promise<ArtistInfo>>()

async function json<T>(url: string, headers: Record<string, string> = {}, ms = 8000): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(ms) })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)|\[.*?\]|-.*$/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const overlaps = (a: string[], b: string[]): boolean => {
  const set = new Set(a.map(norm).filter(Boolean))
  return b.some((x) => set.has(norm(x)))
}

/* ---------- Links ---------- */

const KINDS: [RegExp, ArtistLinkKind, string][] = [
  [/(^|\.)instagram\.com$/, 'instagram', 'Instagram'],
  [/(^|\.)tiktok\.com$/, 'tiktok', 'TikTok'],
  [/(^|\.)(twitter|x)\.com$/, 'x', 'X'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'youtube', 'YouTube'],
  [/(^|\.)facebook\.com$/, 'facebook', 'Facebook'],
  [/(^|\.)soundcloud\.com$/, 'soundcloud', 'SoundCloud'],
  [/(^|\.)bandcamp\.com$/, 'bandcamp', 'Bandcamp'],
  [/(^|\.)twitch\.tv$/, 'twitch', 'Twitch'],
  [/(^|\.)music\.apple\.com$/, 'apple', 'Apple Music'],
  [/(^|\.)deezer\.com$/, 'deezer', 'Deezer'],
  [/(^|\.)genius\.com$/, 'genius', 'Genius'],
  [/(^|\.)wikipedia\.org$/, 'wikipedia', 'Wikipedia']
]
// Not useful to show: databases and stores the listener doesn't care about.
const SKIP = /(^|\.)(spotify\.com|musicbrainz\.org|wikidata\.org|discogs\.com|allmusic\.com|last\.fm|setlist\.fm|songkick\.com|viaf\.org|imdb\.com|rateyourmusic\.com|secondhandsongs\.com|bbc\.co\.uk|itunes\.apple\.com|tidal\.com|amazon\.\w+|napster\.com|qobuz\.com|beatport\.com|whosampled\.com)$/

function classify(url: string, homepage = false): ArtistLink | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  const host = u.hostname.replace(/^www\.|^m\./, '')
  if (SKIP.test(host)) return null
  for (const [re, kind, label] of KINDS) if (re.test(host)) return { kind, label, url: u.href }
  return homepage ? { kind: 'website', label: host, url: u.href } : null
}

function addLink(list: ArtistLink[], link: ArtistLink | null): void {
  if (!link || list.some((l) => l.kind === link.kind && link.kind !== 'website')) return
  if (list.some((l) => l.url === link.url)) return
  list.push(link)
}

/* ---------- MusicBrainz ---------- */

interface MbRel {
  type: string
  url?: { resource: string }
}
interface MbArtist {
  id: string
  type?: string
  area?: { name: string } | null
  'begin-area'?: { name: string } | null
  'life-span'?: { begin?: string; end?: string; ended?: boolean }
  relations?: MbRel[]
  aliases?: { name: string }[]
}

async function musicBrainz(spotifyId: string): Promise<MbArtist | null> {
  const resource = encodeURIComponent(`https://open.spotify.com/artist/${spotifyId}`)
  const url = await json<{ relations?: { artist?: { id: string } }[] }>(
    `https://musicbrainz.org/ws/2/url?resource=${resource}&inc=artist-rels&fmt=json`
  )
  const mbid = url?.relations?.find((r) => r.artist)?.artist?.id
  if (!mbid) return null
  return json<MbArtist>(`https://musicbrainz.org/ws/2/artist/${mbid}?inc=url-rels+aliases&fmt=json`)
}

/* ---------- Genius ---------- */

interface GeniusArtist {
  id: number
  name: string
  url: string
  image_url?: string
  header_image_url?: string
  instagram_name?: string | null
  twitter_name?: string | null
  facebook_name?: string | null
  followers_count?: number
  alternate_names?: string[]
  description?: { plain?: string }
}

async function genius(name: string, titles: string[], knownId: string | null): Promise<GeniusArtist | null> {
  // Works without a token (the website's public endpoints); a personal token is used when set.
  const token = getSettings().geniusToken.trim()
  const auth: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
  let id = knownId
  if (!id) {
    const found = await geniusSearch(name, 20)
    if ('error' in found) return null
    const hits = found.filter((r) => norm(r.primary_artist.name) === norm(name))
    if (!hits.length) return null
    const byArtist = new Map<number, string[]>()
    for (const h of hits) byArtist.set(h.primary_artist.id, [...(byArtist.get(h.primary_artist.id) ?? []), h.title])
    // Only trust the match when a song title lines up with what Spotify has.
    const match = [...byArtist].find(([, songs]) => overlaps(songs, titles))
    if (!match) return null
    id = String(match[0])
  }
  const res =
    (token ? await json<{ response: { artist: GeniusArtist } }>(`https://api.genius.com/artists/${id}?text_format=plain`, auth) : null) ??
    (await json<{ response: { artist: GeniusArtist } }>(`https://genius.com/api/artists/${id}?text_format=plain`))
  return res?.response?.artist ?? null
}

/* ---------- Deezer ---------- */

interface DeezerArtist {
  id: number
  name: string
  picture_xl?: string
  nb_fan?: number
}

async function deezer(name: string, titles: string[], knownId: string | null): Promise<DeezerArtist | null> {
  const top = async (id: number): Promise<string[]> =>
    ((await json<{ data?: { title: string }[] }>(`https://api.deezer.com/artist/${id}/top?limit=25`))?.data ?? []).map((t) => t.title)
  if (knownId) return json<DeezerArtist>(`https://api.deezer.com/artist/${knownId}`)
  const res = await json<{ data?: DeezerArtist[] }>(`https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=10`)
  const same = (res?.data ?? []).filter((a) => norm(a.name) === norm(name)).slice(0, 3)
  for (const a of same) if (overlaps(await top(a.id), titles)) return a
  return null
}

/* ---------- Wikipedia ---------- */

async function wikipedia(wikidataUrl: string | undefined, wikipediaUrl: string | undefined): Promise<{ text: string; url: string } | null> {
  let lang = ''
  let title = ''
  if (wikipediaUrl) {
    const m = /^https?:\/\/(\w+)\.wikipedia\.org\/wiki\/(.+)$/.exec(wikipediaUrl)
    if (m) [, lang, title] = m
  }
  if (!title && wikidataUrl) {
    const q = /Q\d+/.exec(wikidataUrl)?.[0]
    if (!q) return null
    const data = await json<{ entities: Record<string, { sitelinks?: Record<string, { title: string }> }> }>(
      `https://www.wikidata.org/wiki/Special:EntityData/${q}.json`
    )
    const links = data?.entities[q]?.sitelinks ?? {}
    const pick = ['enwiki', 'cswiki', 'skwiki', 'dewiki'].find((k) => links[k])
    if (!pick) return null
    lang = pick.replace('wiki', '')
    title = encodeURIComponent(links[pick].title.replace(/ /g, '_'))
  }
  if (!title) return null
  const sum = await json<{ extract?: string; content_urls?: { desktop?: { page?: string } } }>(
    `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${title}`
  )
  if (!sum?.extract) return null
  return { text: sum.extract, url: sum.content_urls?.desktop?.page ?? `https://${lang}.wikipedia.org/wiki/${title}` }
}

/* ---------- Banner ---------- */

/** Pixel size encoded in Genius image file names, e.g. "abc.1000x563x1.jpg". */
function geniusSize(url: string): { w: number; h: number } | null {
  const m = /\.(\d+)x(\d+)x\d+\.\w+$/.exec(url)
  return m ? { w: +m[1], h: +m[2] } : null
}

function pickBanner(candidates: ArtistInfo['images']): ArtistInfo['images'][number] | null {
  if (!candidates.length) return null
  // Wide images suit the banner best; among similar shapes, more pixels win.
  const score = (c: ArtistInfo['images'][number]): number => c.width * (c.width / c.height >= 1.3 ? 1.6 : 1)
  return [...candidates].sort((a, b) => score(b) - score(a))[0]
}

/* ---------- All together ---------- */

/** `p`, or null when it takes longer than `ms` (it keeps running and may fill a cache). */
const capped = <T>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))])

/** How long About waits for any one source before showing what it has. */
const WAIT_MS = 3500

async function load(q: ArtistInfoQuery): Promise<ArtistInfo & { partial: boolean }> {
  // Everything starts at once. MusicBrainz knows the exact Deezer and Wikipedia pages, so those
  // two follow it; Genius and the Spotify page don't need it.
  const mbP = musicBrainz(q.id).catch(() => null)
  const relsOf = (mb: MbArtist | null): MbRel[] => (mb?.relations ?? []).filter((r) => r.url?.resource)
  const relUrlIn = (mb: MbArtist | null, re: RegExp): string | undefined => relsOf(mb).find((r) => re.test(r.url!.resource))?.url?.resource
  const gP = genius(q.name, q.titles, null).catch(() => null)
  const dP = mbP.then((mb) => deezer(q.name, q.titles, /deezer\.com\/(?:\w+\/)?artist\/(\d+)/.exec(relUrlIn(mb, /deezer\.com/) ?? '')?.[1] ?? null)).catch(() => null)
  const wP = mbP.then((mb) => wikipedia(relUrlIn(mb, /wikidata\.org/), relUrlIn(mb, /wikipedia\.org/))).catch(() => null)
  // the full page opens a hidden browser window and can take a while: About doesn't wait for
  // it (the artist page shows its bio and links on its own when it arrives)
  const pageP = getArtistPage(q.id)
  const [mb, g, d, wiki, page] = await Promise.all([capped(mbP, WAIT_MS), capped(gP, WAIT_MS), capped(dP, WAIT_MS + 1500), capped(wP, WAIT_MS + 1500), capped(pageP, WAIT_MS)])
  const partial = page === null
  const rels = relsOf(mb)
  const relUrl = (re: RegExp): string | undefined => relUrlIn(mb, re)
  const geniusSlug = relUrl(/genius\.com\/artists\//)

  const links: ArtistLink[] = []
  // The artist's own links from their Spotify profile come first.
  for (const l of page?.links ?? []) addLink(links, classify(l.url, true))
  for (const r of rels) addLink(links, classify(r.url!.resource, r.type === 'official homepage'))
  if (g?.instagram_name) addLink(links, { kind: 'instagram', label: 'Instagram', url: `https://www.instagram.com/${g.instagram_name}/` })
  if (g?.twitter_name) addLink(links, { kind: 'x', label: 'X', url: `https://x.com/${g.twitter_name}` })
  if (g?.facebook_name) addLink(links, { kind: 'facebook', label: 'Facebook', url: `https://www.facebook.com/${g.facebook_name}` })
  if (g?.url || geniusSlug) addLink(links, { kind: 'genius', label: 'Genius', url: g?.url ?? geniusSlug! })
  if (d) addLink(links, { kind: 'deezer', label: 'Deezer', url: `https://www.deezer.com/artist/${d.id}` })
  if (wiki) addLink(links, { kind: 'wikipedia', label: 'Wikipedia', url: wiki.url })
  const order: ArtistLinkKind[] = ['instagram', 'tiktok', 'youtube', 'x', 'facebook', 'soundcloud', 'twitch', 'bandcamp', 'website', 'apple', 'deezer', 'genius', 'wikipedia']
  links.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))

  const images: ArtistInfo['images'] = []
  if (q.spotifyImage) images.push({ url: q.spotifyImage.url, width: q.spotifyImage.width, height: q.spotifyImage.height, source: 'spotify' })
  if (d?.picture_xl && !/\/artist\/\//.test(d.picture_xl)) images.push({ url: d.picture_xl, width: 1000, height: 1000, source: 'deezer' })
  for (const url of [g?.header_image_url, g?.image_url]) {
    if (!url || /default_avatar|default_cover/.test(url) || images.some((i) => i.url === url)) continue
    const size = geniusSize(url)
    if (size) images.push({ url, width: size.w, height: size.h, source: 'genius' })
  }

  const geniusBio = g?.description?.plain?.trim()
  const bio =
    page?.bio && page.bio.length > 20
      ? { text: page.bio, source: 'Spotify' }
      : geniusBio && geniusBio.length > 40
        ? { text: geniusBio, source: 'Genius' }
        : wiki
          ? { text: wiki.text, source: 'Wikipedia' }
          : null
  if (page?.header) images.unshift({ url: page.header.url, width: page.header.width, height: page.header.height, source: 'spotify' })
  const begin = mb?.['life-span']?.begin
  return {
    partial,
    links,
    images,
    banner: pickBanner(images),
    bio,
    from: mb?.['begin-area']?.name ?? mb?.area?.name ?? null,
    area: mb?.area?.name ?? null,
    since: begin ? begin.slice(0, 4) : null,
    kind: mb?.type ?? null,
    fans: d?.nb_fan ?? null,
    followers: g?.followers_count ?? null,
    aka: [...new Set([...(g?.alternate_names ?? []), ...(mb?.aliases ?? []).map((a) => a.name)])]
      .filter((n) => norm(n) !== norm(q.name))
      .slice(0, 4)
  }
}

export function getArtistInfo(q: ArtistInfoQuery): Promise<ArtistInfo> {
  const key = q.id
  const hit = cache.get(key)
  if (hit) return hit
  const p = load(q)
  cache.set(key, p)
  // Don't keep an empty or partial result forever: a network hiccup or a slow page shouldn't
  // stick for the session (the page lands in its own cache meanwhile, so the next look is full).
  p.then((r) => {
    if (r.partial || (!r.links.length && !r.bio && r.images.length <= 1)) setTimeout(() => cache.delete(key), 60_000)
  }).catch(() => cache.delete(key))
  return p.then(({ partial: _partial, ...info }) => info)
}
