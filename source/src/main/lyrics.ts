// Lyrics providers, fetched from the main process (no CORS, custom User-Agent).
import type { GeniusResponse, LrclibQuery, LrclibResult } from '@shared/types'
import { USER_AGENT } from './config'
import { getSettings } from './settings'

interface LrclibRecord {
  trackName: string
  artistName: string
  duration: number
  instrumental: boolean
  plainLyrics: string | null
  syncedLyrics: string | null
}

const headers = { 'User-Agent': USER_AGENT }

const toResult = (r: LrclibRecord): LrclibResult => ({
  syncedLyrics: r.syncedLyrics,
  plainLyrics: r.plainLyrics,
  instrumental: r.instrumental
})

/** Exact match first, then a fuzzy search picking the closest duration. */
export async function fetchLrclib(q: LrclibQuery): Promise<LrclibResult | null> {
  try {
    const exact = new URLSearchParams({
      track_name: q.trackName,
      artist_name: q.artistName,
      album_name: q.albumName,
      duration: String(Math.round(q.durationSec))
    })
    // (asked ahead for the next song, the length may not be known: then any length will do)
    const anyLength = !q.durationSec
    const res = anyLength ? null : await fetch(`https://lrclib.net/api/get?${exact}`, { headers })
    let plainOnly: LrclibRecord | null = null
    if (res?.ok) {
      const r = (await res.json()) as LrclibRecord
      if (r.syncedLyrics || r.instrumental) return toResult(r)
      // plain only: another upload of the same song often has the timings, so look on
      if (r.plainLyrics) plainOnly = r
    }

    const search = new URLSearchParams({
      track_name: q.trackName,
      artist_name: q.artistName
    })
    const sres = await fetch(`https://lrclib.net/api/search?${search}`, {
      headers
    })
    let list = sres.ok ? ((await sres.json()) as LrclibRecord[]) : []
    // nothing synced by title and artist: a looser search by words (other spellings, features)
    const fits = (r: LrclibRecord): boolean => anyLength || Math.abs(r.duration - q.durationSec) <= 4
    if (!list.some((r) => r.syncedLyrics && fits(r))) {
      const loose = await fetch(`https://lrclib.net/api/search?${new URLSearchParams({ q: `${q.artistName} ${q.trackName}` })}`, { headers }).catch(() => null)
      if (loose?.ok) list = [...list, ...((await loose.json()) as LrclibRecord[])]
    }
    const candidates = list.filter(fits).sort((a, b) => {
      // Prefer synced lyrics, then the closest duration.
      const sa = a.syncedLyrics ? 0 : 1
      const sb = b.syncedLyrics ? 0 : 1
      if (sa !== sb) return sa - sb
      return Math.abs(a.duration - q.durationSec) - Math.abs(b.duration - q.durationSec)
    })
    const best = candidates[0]
    if (best?.syncedLyrics) return toResult(best)
    return plainOnly ? toResult(plainOnly) : best ? toResult(best) : null
  } catch (e) {
    console.error('[lyrics] lrclib failed', e)
    return null
  }
}

const normalize = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/\s+-\s+.*$/, '')
    .replace(/\b(feat|ft|featuring)\b.*$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** lyrics.ovh: free public lyrics API (plain text, not synced). */
export async function fetchLyricsOvh(q: { title: string; artist: string }): Promise<string | null> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 8000)
    const res = await fetch(`https://api.lyrics.ovh/v1/${encodeURIComponent(q.artist)}/${encodeURIComponent(q.title)}`, { headers, signal: ctrl.signal })
    clearTimeout(t)
    if (!res.ok) return null
    const j = (await res.json()) as { lyrics?: string }
    const text = j.lyrics?.replace(/^Paroles de la chanson.*\r?\n/i, '').trim()
    return text ? text : null
  } catch {
    return null
  }
}

export interface GeniusSong {
  url: string
  title: string
  primary_artist: { id: number; name: string }
}

function pickSong(songs: GeniusSong[], title: string, artist: string): GeniusSong | null {
  const t = normalize(title)
  const a = normalize(artist)
  let best: { s: GeniusSong; score: number } | null = null
  for (const s of songs) {
    const st = normalize(s.title)
    const sa = normalize(s.primary_artist.name)
    if (!st || !(st === t || st.includes(t) || t.includes(st))) continue
    const artistOk = sa === a || sa.includes(a) || a.includes(sa) || sa.split(' ')[0] === a.split(' ')[0]
    const score = (st === t ? 3 : 2) + (artistOk ? 2 : 0)
    if (!best || score > best.score) best = { s, score }
  }
  // A title match alone is too risky for common song names.
  return best && best.score >= 4 ? best.s : null
}

/**
 * Searches Genius. Without a token it uses the same public search the genius.com website
 * uses (no sign-up needed); a personal token, if one is set in Settings, goes through the
 * official API instead.
 */
export async function geniusSearch(query: string, perPage = 10): Promise<GeniusSong[] | { error: string }> {
  const token = getSettings().geniusToken.trim()
  const tryFetch = async (url: string, auth: boolean): Promise<Response | null> => {
    try {
      return await fetch(url, {
        headers: auth ? { ...headers, Authorization: `Bearer ${token}` } : headers,
        signal: AbortSignal.timeout(10_000)
      })
    } catch {
      return null
    }
  }
  let res: Response | null = null
  if (token) {
    res = await tryFetch(`https://api.genius.com/search?q=${encodeURIComponent(query)}&per_page=${perPage}`, true)
    if (res && !res.ok) res = null // a bad token falls back to the public search
  }
  res ??= await tryFetch(`https://genius.com/api/search/song?q=${encodeURIComponent(query)}&per_page=${perPage}`, false)
  if (!res) return { error: 'Could not reach Genius.' }
  if (!res.ok) return { error: `Genius search failed (${res.status}).` }
  type Hit = { type?: string; index?: string; result: GeniusSong }
  const json = (await res.json().catch(() => null)) as {
    response?: { hits?: Hit[]; sections?: { hits?: Hit[] }[] }
  } | null
  // the official API answers with `hits`, the website's search with `sections[].hits`
  const hits = [...(json?.response?.hits ?? []), ...(json?.response?.sections ?? []).flatMap((x) => x.hits ?? [])]
  return hits.filter((h) => (h.type ?? h.index ?? 'song') === 'song' && h.result?.url).map((h) => h.result)
}

export async function fetchGenius(q: { title: string; artist: string }): Promise<GeniusResponse> {
  try {
    const found = await geniusSearch(`${q.title} ${q.artist}`)
    if ('error' in found) return { ok: false, reason: found.error }
    const songs = found
    if (!songs.length) return { ok: false, reason: 'Genius has no results for this song.' }
    const song = pickSong(songs, q.title, q.artist)
    if (!song) return { ok: false, reason: 'Genius has no matching song.' }

    const page = await fetch(song.url, { headers })
    if (!page.ok) {
      // Genius sometimes refuses non-browser requests; offer the page link instead.
      return {
        ok: false,
        reason: 'Genius did not send the lyrics page.',
        url: song.url
      }
    }
    return {
      ok: true,
      url: song.url,
      title: song.title,
      artist: song.primary_artist.name,
      html: await page.text()
    }
  } catch (e) {
    console.error('[lyrics] genius failed', e)
    return { ok: false, reason: 'Could not reach Genius.' }
  }
}
