// Help for playlist recommendations, from Deezer's public API (no account needed):
//  - artists similar to a given artist (Spotify no longer offers "related artists" to apps),
//  - a song's 30-second preview, which the page analyses for tempo and key (Spotify's audio
//    features are gone for apps too).
const DEEZER = 'https://api.deezer.com'

async function json<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
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
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const relatedCache = new Map<string, Promise<string[]>>()

/** Names of artists similar to `name`, best first. */
export function relatedArtists(name: string): Promise<string[]> {
  const key = norm(name)
  let p = relatedCache.get(key)
  if (!p) {
    p = (async () => {
      const found = await json<{ data?: { id: number; name: string; nb_fan?: number }[] }>(
        `${DEEZER}/search/artist?q=${encodeURIComponent(name)}&limit=5`
      )
      const same = (found?.data ?? []).filter((a) => norm(a.name) === key).sort((a, b) => (b.nb_fan ?? 0) - (a.nb_fan ?? 0))[0]
      if (!same) return []
      const rel = await json<{ data?: { name: string }[] }>(`${DEEZER}/artist/${same.id}/related?limit=12`)
      return (rel?.data ?? []).map((a) => a.name)
    })()
    relatedCache.set(key, p)
  }
  return p
}

const previewCache = new Map<string, Promise<string | null>>()

/** The 30 s preview of a song as base64 MP3, or null when Deezer doesn't have it. */
export function songPreview(title: string, artist: string): Promise<string | null> {
  const key = `${norm(title)}|${norm(artist)}`
  let p = previewCache.get(key)
  if (!p) {
    p = (async () => {
      const q = `artist:"${artist}" track:"${title.replace(/\s*[([].*?[)\]]/g, '')}"`
      const r = await json<{ data?: { title: string; preview?: string; artist?: { name: string } }[] }>(
        `${DEEZER}/search?q=${encodeURIComponent(q)}&limit=5`
      )
      const list = (r?.data ?? []).filter((t) => t.preview)
      const hit = list.find((t) => norm(t.artist?.name ?? '') === norm(artist)) ?? list[0]
      if (!hit?.preview) return null
      const res = await fetch(hit.preview, { signal: AbortSignal.timeout(10_000) }).catch(() => null)
      if (!res?.ok) return null
      return Buffer.from(await res.arrayBuffer()).toString('base64')
    })().catch(() => null)
    previewCache.set(key, p)
    // Previews are large; keep only the promise for a short while.
    setTimeout(() => previewCache.delete(key), 120_000)
  }
  return p
}
