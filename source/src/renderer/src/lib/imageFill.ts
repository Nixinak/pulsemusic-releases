// Pictures for things that came without one: plays imported from a Spotify data download have
// names only, so the months, the year card and Recap had blank artists and covers. They're
// looked up once (by Spotify id when there is one, else by name), a few at a time in the
// background, and remembered on this computer for a month.
import { useEffect, useState } from 'react'
import * as sp from './spotify'
import { artistAvatar } from './artistImage'
import { isRealId } from './history'
import type { STrack } from './types'

const KEY = 'pulse-img-fill1'
const KEEP_MS = 30 * 86_400_000
type Saved = Record<string, { u: string | null; at: number }>
let saved: Saved | null = null
function store(): Saved {
  if (!saved) {
    try {
      saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Saved
    } catch {
      saved = {}
    }
  }
  return saved
}
let saveTimer = 0
function remember(key: string, u: string | null): void {
  const s = store()
  s[key] = { u, at: Date.now() }
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    try {
      const keys = Object.keys(s)
      if (keys.length > 2000) for (const k of keys.sort((a, b) => s[a].at - s[b].at).slice(0, keys.length - 2000)) delete s[k]
      localStorage.setItem(KEY, JSON.stringify(s))
    } catch {
      /* storage unavailable */
    }
  }, 1500)
}
const norm = (x: string): string =>
  x
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const inflight = new Map<string, Promise<string | null>>()
function once(key: string, find: () => Promise<string | null>): Promise<string | null> {
  const hit = store()[key]
  // a picture found is kept a month; "none found" is asked again after a week
  if (hit && Date.now() - hit.at < (hit.u ? KEEP_MS : KEEP_MS / 4)) return Promise.resolve(hit.u)
  let p = inflight.get(key)
  if (!p) {
    p = find()
      .then((u) => {
        remember(key, u)
        return u
      })
      .catch(() => null)
      .finally(() => inflight.delete(key))
    inflight.set(key, p)
  }
  return p
}

const BG = { background: true, patient: true } as const

/** An artist's picture: by id (the embed page, no Web API) or by searching the name. */
export function artistPicture(name: string, id?: string, urgent = false): Promise<string | null> {
  if (isRealId(id)) return artistAvatar(id)
  if (!name) return Promise.resolve(null)
  const bg = urgent ? {} : BG
  return once(`a:${norm(name)}`, async () => {
    const r = await sp.api<{ artists?: { items: ({ name: string; images?: { url: string; width?: number | null }[] } | null)[] } }>('/search', {
      query: { q: name, type: 'artist', limit: 5 },
      ...bg
    })
    const items = (r.artists?.items ?? []).filter((a): a is NonNullable<typeof a> => !!a)
    const hit = items.find((a) => norm(a.name) === norm(name)) ?? null
    return hit ? sp.pickImage(hit.images as never, 640) : null
  })
}

/** A song's cover: by id or by searching "title artist". */
export function songPicture(name: string, artist: string, id?: string, urgent = false): Promise<string | null> {
  if (!name) return Promise.resolve(null)
  const bg = urgent ? {} : BG
  return once(`s:${isRealId(id) ? id : `${norm(name)}|${norm(artist)}`}`, async () => {
    if (isRealId(id)) {
      const t = await sp.api<STrack>(`/tracks/${id}`, bg)
      return sp.pickImage(t.album?.images, 300)
    }
    const r = await sp.api<{ tracks?: { items: (STrack | null)[] } }>('/search', {
      query: { q: `track:"${name}" artist:"${artist}"`, type: 'track', limit: 5 },
      ...bg
    })
    const items = (r.tracks?.items ?? []).filter((t): t is STrack => !!t?.id)
    const hit = items.find((t) => norm(t.name) === norm(name)) ?? items[0]
    return hit ? sp.pickImage(hit.album?.images, 300) : null
  })
}

/** `image`, or the artist's picture found by id or name. */
export function useArtistPicture(name: string | undefined, id: string | undefined, image: string | null = null): string | null {
  const [found, setFound] = useState<string | null>(null)
  useEffect(() => {
    setFound(null)
    if (image || !name) return
    let alive = true
    void artistPicture(name, id).then((u) => alive && setFound(u))
    return () => {
      alive = false
    }
  }, [name, id, image])
  return image ?? found
}

/** `image`, or the song's cover found by id or name. */
export function useSongPicture(name: string | undefined, artist: string | undefined, id: string | undefined, image: string | null = null): string | null {
  const [found, setFound] = useState<string | null>(null)
  useEffect(() => {
    setFound(null)
    if (image || !name) return
    let alive = true
    void songPicture(name, artist ?? '', id).then((u) => alive && setFound(u))
    return () => {
      alive = false
    }
  }, [name, artist, id, image])
  return image ?? found
}
