// Data loaders shared by pages and hover prefetching, keyed for the useQuery cache.
import * as sp from './spotify'
import { prefetch } from './useQuery'
import type { SAlbumRef, STrack } from './types'

export async function loadAlbum(id: string) {
  const album = await sp.getAlbum(id)
  const tracks = album.tracks.total > album.tracks.items.length ? await sp.getAlbumTracks(id) : album.tracks.items
  return { album, tracks }
}

/** The artist's most played songs. The top-tracks endpoint is gone for apps, so this reads
 *  the first few pages of a search (Spotify ranks those by popularity) and keeps the artist's own. */
export async function loadArtistPopular(id: string, name: string): Promise<STrack[]> {
  // both pages at once (one round trip)
  const pages = await Promise.all([0, 10].map((o) => sp.searchTracks(`artist:"${name}"`, o).catch(() => null)))
  const seen = new Set<string>()
  const out: STrack[] = []
  for (const t of pages.flatMap((p) => p?.tracks?.items ?? [])) {
    if (!t || !t.artists.some((a) => a.id === id)) continue
    const key = t.name.toLowerCase().replace(/\s*[([].*?[)\]]\s*/g, ' ').trim()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out
}

/** Full details for a list of songs, three requests at a time; songs that fail are left out. */
export async function loadTopTracks(ids: string[]): Promise<STrack[]> {
  const out: (STrack | null)[] = new Array(ids.length).fill(null)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < ids.length) {
      const i = next++
      out[i] = await sp.getTrack(ids[i]).then((t) => (t?.id ? t : null)).catch(() => null)
    }
  }
  await Promise.all([worker(), worker(), worker()])
  return out.filter((t): t is STrack => !!t)
}

export const keys = {
  album: (id: string) => `album:${id}`,
  artist: (id: string) => `artist:${id}`,
  artistAlbums: (id: string) => `artist-albums:${id}`,
  artistPopular: (id: string) => `artist-popular:${id}`,
  artistAppears: (id: string) => `artist-appears:${id}`,
  artistInfo: (id: string) => `artist-info:${id}`,
  artistPage: (id: string) => `artist-page:${id}`,
  artistTop: (id: string) => `artist-top:${id}`
}

export function prefetchAlbum(id: string): void {
  prefetch(keys.album(id), () => loadAlbum(id))
}

/** An artist's albums and singles (through search; shared by the artist and album pages). */
export const loadArtistReleases = (id: string, name: string): Promise<SAlbumRef[]> => sp.getArtistReleasesBySearch(id, name)

/** Warms everything the artist page needs, so it opens instantly. */
export function prefetchArtist(id: string, name?: string): void {
  prefetch(keys.artist(id), () => sp.getArtist(id))
  prefetch(`artist-quick2:${id}`, async () => {
    const q = await window.pulse.artistQuick?.(id)
    return { tracks: q?.tracks ?? [], avatar: q?.avatar ?? null }
  })
  if (name) {
    prefetch(keys.artistAlbums(id), () => loadArtistReleases(id, name))
    prefetch(keys.artistPopular(id), () => loadArtistPopular(id, name))
  }
}
