// Song recommendations for a playlist. Spotify's recommendation endpoint is closed to apps, so
// Pulse builds its own, from what the playlist actually contains:
//  1. Artist affinity: artists that appear in the playlist (main or featured) and how often.
//  2. Neighbours: artists similar to the playlist's main artists (Deezer), and artists the
//     playlist's artists work with.
//  3. Sound: tempo and key measured from 30 s previews. Candidates close to the playlist's
//     tempos and in compatible keys (Camelot wheel) rank higher.
// Final score = 55 % artist affinity + 25 % tempo match + 20 % key match.
import * as sp from './spotify'
import type { STrack } from './types'
import { bpmMatch, keyMatch, songFeatures, type Features } from './audioFeatures'

export interface Rec {
  track: STrack
  score: number
  /** Why it was picked, for a tooltip. */
  reason: string
  features: Features | null
}

const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s*[([].*?[)\]]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Runs `fn` over `items`, `n` at a time. */
async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    })
  )
  return out
}

export async function recommend(tracks: STrack[], onStage?: (s: string) => void): Promise<Rec[]> {
  const songs = tracks.filter((t) => t?.id && !t.is_local)
  if (songs.length === 0) return []

  // 1. Artist weights (main artist counts fully, featured ones a bit less).
  const weight = new Map<string, { id: string; name: string; w: number }>()
  for (const t of songs) {
    t.artists.forEach((a, i) => {
      if (!a.id) return
      const e = weight.get(a.id) ?? { id: a.id, name: a.name, w: 0 }
      e.w += i === 0 ? 1 : 0.6
      weight.set(a.id, e)
    })
  }
  const ranked = [...weight.values()].sort((a, b) => b.w - a.w)
  const maxW = ranked[0]?.w ?? 1
  const inPlaylist = new Set(songs.map((t) => t.id))
  const inPlaylistNames = new Set(songs.map((t) => `${norm(t.name)}|${norm(t.artists[0]?.name ?? '')}`))

  // 2. Neighbours of the three biggest artists.
  onStage?.('Finding similar artists')
  const related = new Map<string, { name: string; via: string; w: number }>()
  for (const seed of ranked.slice(0, 3)) {
    const names = await window.pulse.recs.related(seed.name).catch(() => [] as string[])
    names.slice(0, 6).forEach((n, i) => {
      const k = norm(n)
      if ([...weight.values()].some((a) => norm(a.name) === k)) return
      const e = related.get(k) ?? { name: n, via: seed.name, w: 0 }
      e.w += (seed.w / maxW) * (1 - i * 0.1)
      related.set(k, e)
    })
  }
  const neighbours = [...related.values()].sort((a, b) => b.w - a.w)

  // 3. Candidates: popular songs of the playlist's artists and of their neighbours.
  onStage?.('Looking for songs')
  const sources = [
    ...ranked.slice(0, 6).map((a) => ({ name: a.name, id: a.id as string | null })),
    ...neighbours.slice(0, 6).map((a) => ({ name: a.name, id: null as string | null }))
  ]
  const seen = new Set<string>()
  const cands: { track: STrack; pre: number; reason: string }[] = []
  for (const src of sources) {
    const r = await sp.searchTracks(`artist:"${src.name}"`, 0).catch(() => null)
    await pause(120)
    const items = (r?.tracks?.items ?? []).filter((t): t is STrack => !!t?.id)
    items.forEach((t, idx) => {
      if (!t.artists.some((a) => (src.id ? a.id === src.id : norm(a.name) === norm(src.name)))) return
      const nameKey = `${norm(t.name)}|${norm(t.artists[0]?.name ?? '')}`
      if (inPlaylist.has(t.id) || inPlaylistNames.has(nameKey) || seen.has(nameKey) || t.is_playable === false) return
      seen.add(nameKey)
      // Affinity: every artist on the song that the playlist already has, plus neighbours.
      let aff = 0
      let reason = ''
      for (const a of t.artists) {
        const w = weight.get(a.id)
        if (w) {
          aff += w.w / maxW
          if (!reason) reason = t.artists[0]?.id === a.id ? `More from ${a.name}` : `With ${a.name}, who is in this playlist`
        }
        const n = related.get(norm(a.name))
        if (n) {
          aff += 0.55 * Math.min(1, n.w)
          if (!reason) reason = `Similar to ${n.via}`
        }
      }
      const popular = 0.25 * (1 - idx / 10)
      cands.push({ track: t, pre: Math.min(1.4, aff) + popular, reason })
    })
  }
  if (!cands.length) return []

  // Keep variety before the sound check: at most 3 songs per main artist.
  cands.sort((a, b) => b.pre - a.pre)
  const perArtist = new Map<string, number>()
  const shortlist = cands.filter((c) => {
    const id = c.track.artists[0]?.id ?? ''
    const n = perArtist.get(id) ?? 0
    if (n >= 3) return false
    perArtist.set(id, n + 1)
    return true
  }).slice(0, 26)

  // 4. Sound: tempo and key of a sample of the playlist and of the shortlist.
  onStage?.('Listening to tempo and key')
  const sample = [...songs].sort(() => Math.random() - 0.5).slice(0, 12)
  const [mine, theirs] = await Promise.all([
    pool(sample, 2, (t) => songFeatures(t)),
    pool(shortlist, 3, (c) => songFeatures(c.track))
  ])
  const profile = mine.filter((f): f is Features => !!f)

  const maxPre = shortlist[0]?.pre || 1
  const out: Rec[] = shortlist.map((c, i) => {
    const f = theirs[i]
    let tempoFit = 0.5
    let keyFit = 0.5
    if (f && profile.length) {
      // Best few matches against the playlist, so a mixed playlist isn't punished.
      const tb = profile.map((p) => bpmMatch(f.bpm, p.bpm)).sort((a, b) => b - a)
      const kb = profile.map((p) => keyMatch(f, p)).sort((a, b) => b - a)
      const top = Math.min(3, profile.length)
      tempoFit = tb.slice(0, top).reduce((s, v) => s + v, 0) / top
      keyFit = kb.slice(0, top).reduce((s, v) => s + v, 0) / top
    }
    const score = 0.55 * (c.pre / maxPre) + 0.25 * tempoFit + 0.2 * keyFit
    const sound = f && profile.length ? `${Math.round(tempoFit * 100)}% tempo match, ${Math.round(keyFit * 100)}% key match` : ''
    return { track: c.track, score, reason: [c.reason, sound].filter(Boolean).join(' · '), features: f }
  })
  return out.sort((a, b) => b.score - a.score)
}
