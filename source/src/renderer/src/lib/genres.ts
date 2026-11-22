// The genres you listen to, for Your stats: each of your top artists brings its genres (from
// Spotify, or from MusicBrainz when Spotify gives none), weighted by how much you played them.
// An artist's genres hardly change, so they're kept for a month (a miss for a few days).
import { useEffect, useMemo, useState } from 'react'
import * as sp from './spotify'

export interface GenreArtist {
  id: string
  name: string
  /** How much this artist counts: minutes played, or a weight from their rank. */
  weight: number
}

export interface GenreRow {
  genre: string
  /** Share of the weighted listening that has genres (0–1). */
  share: number
  /** The artists bringing most of it. */
  artists: string[]
}

const KEY = 'pulse-genres1'
const MONTH = 30 * 86_400_000
const FEW_DAYS = 3 * 86_400_000
/** How many of the top artists are looked at. */
export const GENRE_ARTISTS = 30

type Cache = Record<string, { g: string[]; at: number }>
let cache: Cache | null = null
const load = (): Cache => {
  if (cache) return cache
  try {
    cache = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Cache
  } catch {
    cache = {}
  }
  return cache
}
let saveTimer = 0
const save = (): void => {
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(load()))
    } catch {
      /* storage unavailable */
    }
  }, 800)
}
const keyOf = (a: GenreArtist): string => (/^[A-Za-z0-9]{22}$/.test(a.id) ? a.id : `n:${a.name.toLowerCase()}`)
const fresh = (k: string): boolean => {
  const c = load()[k]
  return !!c && Date.now() - c.at < (c.g.length ? MONTH : FEW_DAYS)
}

/** One artist's genres: Spotify's when it has them, MusicBrainz's otherwise. */
async function lookUp(a: GenreArtist): Promise<string[]> {
  const real = /^[A-Za-z0-9]{22}$/.test(a.id)
  if (real) {
    const s = await sp.api<{ genres?: string[] }>(`/artists/${a.id}`).catch(() => null)
    if (s?.genres?.length) return s.genres.slice(0, 4).map((g) => g.toLowerCase())
  }
  return window.pulse.artistGenres(real ? a.id : null, a.name).catch(() => [])
}

let running: Promise<void> | null = null
/** The latest list asked for (another time range can ask while a lookup is running). */
let wanted: GenreArtist[] = []
const listeners = new Set<() => void>()
/** Looks up the artists that aren't known yet, a few at a time, telling the page as they come. */
function fill(list: GenreArtist[]): void {
  wanted = list
  if (running) return
  const todo = list.filter((a) => !fresh(keyOf(a)))
  if (!todo.length) return
  running = (async () => {
    let i = 0
    const worker = async (): Promise<void> => {
      while (i < todo.length) {
        const a = todo[i++]
        const g = await lookUp(a).catch(() => [])
        load()[keyOf(a)] = { g, at: Date.now() }
        save()
        for (const l of listeners) l()
      }
    }
    await Promise.all([worker(), worker(), worker()])
  })().finally(() => {
    running = null
    // every attempt leaves an entry, so this ends once the latest list is looked up
    if (wanted.some((a) => !fresh(keyOf(a)))) fill(wanted)
  })
}

const pretty = (g: string): string => g.charAt(0).toUpperCase() + g.slice(1)
/** How a genre's share is split when an artist has several (the first one counts most). */
const SPLIT = [0.5, 0.3, 0.2]

export function useGenres(artists: GenreArtist[]): { rows: GenreRow[]; pending: number } {
  const [tick, setTick] = useState(0)
  const list = useMemo(() => artists.slice(0, GENRE_ARTISTS), [artists])
  useEffect(() => {
    const on = (): void => setTick((n) => n + 1)
    listeners.add(on)
    fill(list)
    return () => void listeners.delete(on)
  }, [list])
  return useMemo(() => {
    const c = load()
    const by = new Map<string, { w: number; artists: Map<string, number> }>()
    let total = 0
    let pending = 0
    for (const a of list) {
      const e = c[keyOf(a)]
      if (!e) {
        pending++
        continue
      }
      const g = e.g.slice(0, 3)
      if (!g.length) continue
      total += a.weight
      const parts = SPLIT.slice(0, g.length)
      const sum = parts.reduce((x, y) => x + y, 0)
      g.forEach((name, k) => {
        const w = (a.weight * parts[k]) / sum
        const row = by.get(name) ?? { w: 0, artists: new Map<string, number>() }
        row.w += w
        row.artists.set(a.name, (row.artists.get(a.name) ?? 0) + w)
        by.set(name, row)
      })
    }
    const rows = [...by.entries()]
      .map(([genre, r]) => ({
        genre: pretty(genre),
        share: total ? r.w / total : 0,
        artists: [...r.artists.entries()].sort((x, y) => y[1] - x[1]).map(([n]) => n)
      }))
      .sort((x, y) => y.share - x.share)
    return { rows, pending }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, tick])
}
