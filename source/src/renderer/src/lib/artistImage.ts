// Some artists come from Spotify's Web API without a picture. Their public embed page still
// has one, so it's read once per artist (about a second) and kept for the session.
import { useEffect, useState } from 'react'

const cache = new Map<string, Promise<string | null>>()

export function artistAvatar(id: string): Promise<string | null> {
  let p = cache.get(id)
  if (!p) {
    p = (window.pulse.artistQuick?.(id) ?? Promise.resolve(null)).then((r) => r?.avatar ?? null).catch(() => null)
    cache.set(id, p)
  }
  return p
}

/** `image`, or the picture from the artist's embed page when Spotify gave none. */
export function useArtistImage(id: string | undefined, image: string | null): string | null {
  const [found, setFound] = useState<string | null>(null)
  useEffect(() => {
    if (image || !id) return
    let alive = true
    void artistAvatar(id).then((u) => alive && setFound(u))
    return () => {
      alive = false
    }
  }, [id, image])
  return image ?? found
}
