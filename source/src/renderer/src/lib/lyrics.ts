// Lyrics resolution: synced lyrics first, from LRCLIB or (when your Spotify account is connected
// in Pulse) from Spotify itself, then plain ones: LRCLIB, Spotify, Genius, lyrics.ovh, and
// finally a link to Genius.

export interface SyncedWord {
  timeMs: number
  text: string
}

export interface SyncedLine {
  timeMs: number
  text: string
  /** Word timings from enhanced LRC (`<mm:ss.xx>word`), when the source has them. */
  words?: SyncedWord[]
}

const stampMs = (m: string, s: string, f?: string): number =>
  Number(m) * 60_000 + Number(s) * 1000 + (f ? Number(f.padEnd(3, '0').slice(0, 3)) : 0)

export type Lyrics =
  | { kind: 'synced'; source: 'LRCLIB' | 'Spotify'; lines: SyncedLine[] }
  | { kind: 'plain'; source: 'LRCLIB' | 'Spotify' | 'Genius' | 'lyrics.ovh'; lines: string[]; url?: string }
  | { kind: 'instrumental' }
  | { kind: 'none'; reason?: string; geniusUrl?: string }

export interface LyricsTrack {
  id: string
  name: string
  artists: string[]
  album: string
  durationMs: number
}

const cache = new Map<string, Promise<Lyrics>>()

export function parseLrc(lrc: string): SyncedLine[] {
  const out: SyncedLine[] = []
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)]
    if (stamps.length === 0) continue
    const body = raw.replace(/\[[^\]]*\]/g, '')
    const text = body.replace(/<\d{1,2}:\d{2}(?:[.:]\d{1,3})?>/g, '').replace(/\s+/g, ' ').trim()
    let words: SyncedWord[] | undefined
    if (/<\d{1,2}:\d{2}/.test(body)) {
      words = []
      for (const w of body.matchAll(/<(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?>([^<]*)/g)) {
        const t = w[4].replace(/\s+/g, ' ')
        if (t.trim()) words.push({ timeMs: stampMs(w[1], w[2], w[3]), text: t })
      }
      if (words.length === 0) words = undefined
    }
    for (const m of stamps) out.push({ timeMs: stampMs(m[1], m[2], m[3]), text, words })
  }
  return out.sort((a, b) => a.timeMs - b.timeMs)
}

/** Pulls the lyric text out of a Genius song page. */
export function parseGeniusHtml(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const containers = doc.querySelectorAll('[data-lyrics-container="true"]')
  const lines: string[] = []
  containers.forEach((c) => {
    c.querySelectorAll('[data-exclude-from-selection="true"]').forEach((n) => n.remove())
    c.querySelectorAll('br').forEach((br) => br.replaceWith('\n'))
    const text = c.textContent ?? ''
    lines.push(...text.split('\n'))
  })
  // Collapse runs of blank lines.
  return lines
    .map((l) => l.trim())
    .filter((l, i, arr) => l !== '' || (i > 0 && arr[i - 1] !== ''))
}

const primaryTitle = (name: string): string =>
  name.replace(/\s*-\s*(\d{4}\s*)?(remaster(ed)?|live|radio edit|single version|mono|stereo).*$/i, '').trim()

async function resolve(t: LyricsTrack): Promise<Lyrics> {
  // both at once: LRCLIB, and Spotify's own lyrics when the account is connected
  const [lr, spl] = await Promise.all([
    window.pulse.lyrics.lrclib({
      trackName: primaryTitle(t.name),
      artistName: t.artists[0] ?? '',
      albumName: t.album,
      durationSec: t.durationMs / 1000
    }),
    window.pulse.spotifyAccount?.lyrics(t.id).catch(() => null) ?? Promise.resolve(null)
  ])
  if (lr?.syncedLyrics) {
    const lines = parseLrc(lr.syncedLyrics)
    // LRCLIB's word timings are the richest; Spotify's line timings when LRCLIB has none
    if (lines.length > 0 && (lines.some((l) => l.words) || !spl?.synced)) return { kind: 'synced', source: 'LRCLIB', lines }
  }
  if (spl?.synced && spl.lines.length) return { kind: 'synced', source: 'Spotify', lines: spl.lines.map((l) => ({ timeMs: l.timeMs, text: l.text })) }
  if (lr?.syncedLyrics) {
    const lines = parseLrc(lr.syncedLyrics)
    if (lines.length > 0) return { kind: 'synced', source: 'LRCLIB', lines }
  }
  if (lr?.instrumental) return { kind: 'instrumental' }
  if (lr?.plainLyrics) {
    return { kind: 'plain', source: 'LRCLIB', lines: lr.plainLyrics.split(/\r?\n/) }
  }
  if (spl && spl.lines.length) return { kind: 'plain', source: 'Spotify', lines: spl.lines.map((l) => l.text) }

  const q = { title: primaryTitle(t.name), artist: t.artists[0] ?? '' }
  const g = await window.pulse.lyrics.genius(q)
  if (g.ok) {
    const lines = parseGeniusHtml(g.html)
    if (lines.some((l) => l.length > 0)) return { kind: 'plain', source: 'Genius', lines, url: g.url }
  }

  const ovh = await window.pulse.lyrics.ovh(q)
  if (ovh) return { kind: 'plain', source: 'lyrics.ovh', lines: ovh.split(/\r?\n/) }

  if (g.ok) return { kind: 'none', reason: 'The Genius page had no lyrics text.', geniusUrl: g.url }
  return { kind: 'none', reason: g.reason, geniusUrl: g.url }
}

export function getLyrics(t: LyricsTrack): Promise<Lyrics> {
  let p = cache.get(t.id)
  if (!p) {
    p = resolve(t).catch((e: unknown) => ({ kind: 'none', reason: String(e) }) as Lyrics)
    cache.set(t.id, p)
    // Don't remember misses, so a newly added token or source is tried next time.
    void p.then((r) => r.kind === 'none' && cache.delete(t.id))
  }
  return p
}
