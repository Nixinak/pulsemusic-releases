// People in Pulse: Pulse badges for Spotify users, and keeping your own published Pulse
// profile up to date on the Pulse server.
import { useEffect, useState } from 'react'
import type { PulseProfile, PulseSummary } from '@shared/types'
import { useProfile } from './profile'
import { useApp } from './store'
import * as sp from './spotify'
import { prefetch } from './useQuery'

let serverOn: Promise<boolean> | null = null
/** False when this build of Pulse has no Pulse server. */
export const pulseServerOn = (): Promise<boolean> => (serverOn ??= window.pulse.people.serverOn().catch(() => false))

/** The Pulse users among `ids`, by id (for badges). */
export function usePulseUsers(ids: string[]): Map<string, PulseSummary> {
  const [found, setFound] = useState<Map<string, PulseSummary>>(new Map())
  const key = [...new Set(ids)].sort().join(',')
  useEffect(() => {
    if (!key) return setFound(new Map())
    let alive = true
    void window.pulse.people
      .pulseLookup(key.split(','))
      .then((list) => alive && setFound(new Map(list.map((u) => [u.id, u]))))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [key])
  return found
}

/* ---------- People you've come across (so you can find them by name) ---------- */

export interface KnownPerson {
  id: string
  name: string
  image: string | null
}
const KNOWN_KEY = 'pulse-known-people'
let known: Map<string, KnownPerson> | null = null
const knownMap = (): Map<string, KnownPerson> => {
  if (known) return known
  try {
    known = new Map((JSON.parse(localStorage.getItem(KNOWN_KEY) ?? '[]') as KnownPerson[]).map((p) => [p.id, p]))
  } catch {
    known = new Map()
  }
  return known
}
let saveTimer = 0

/** Remembers people seen around the app (playlist owners, profiles, followers). */
export function rememberPeople(list: { id: string; name?: string | null; image?: string | null }[]): void {
  const m = knownMap()
  let changed = false
  for (const p of list) {
    if (!p.id || p.id === 'spotify' || !p.name) continue
    const old = m.get(p.id)
    const next = { id: p.id, name: p.name, image: p.image ?? old?.image ?? null }
    if (!old || old.name !== next.name || old.image !== next.image) {
      m.delete(p.id)
      m.set(p.id, next)
      changed = true
    }
  }
  if (!changed) return
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(KNOWN_KEY, JSON.stringify([...m.values()].slice(-3000)))
    } catch {
      /* storage unavailable */
    }
  }, 1000)
}

const fold = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()

/** People you've come across whose name (or username) matches `q`. */
export function searchKnownPeople(q: string): KnownPerson[] {
  const want = fold(q).replace(/^@/, '')
  if (want.length < 2) return []
  const hits: [number, KnownPerson][] = []
  for (const p of knownMap().values()) {
    const name = fold(p.name)
    const id = p.id.toLowerCase()
    const score = name === want || id === want ? 0 : name.startsWith(want) ? 1 : name.split(/\s+/).some((w) => w.startsWith(want)) ? 2 : name.includes(want) || id.includes(want) ? 3 : -1
    if (score >= 0) hits.push([score, p])
  }
  return hits.sort((a, b) => a[0] - b[0]).map((x) => x[1]).slice(0, 20)
}

/** Starts loading someone's profile (e.g. on hover), so opening it is instant. */
export function prefetchUser(id: string): void {
  prefetch(`pulse-user:${id}`, () => window.pulse.people.pulseProfile(id))
  prefetch(`spotify-user-quick:${id}`, () => window.pulse.people.spotifyUserQuick(id))
  prefetch(`spotify-user:${id}`, () => window.pulse.people.spotifyUser(id))
}

/** A small round JPEG of the profile picture for search results and badges. */
async function thumbOf(src: string | null): Promise<string | null> {
  if (!src) return null
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = src
    await img.decode()
    const c = document.createElement('canvas')
    c.width = c.height = 64
    const x = c.getContext('2d')!
    const s = Math.min(img.naturalWidth, img.naturalHeight)
    x.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, 64, 64)
    return c.toDataURL('image/jpeg', 0.8)
  } catch {
    return null
  }
}

async function snapshot(): Promise<PulseProfile['snapshot']> {
  const [artists, tracks] = await Promise.all([sp.getTopArtists('medium_term', 10).catch(() => null), sp.getTopTracks('short_term', 10).catch(() => null)])
  return {
    topArtists: (artists?.items ?? []).map((a) => ({ id: a.id, uri: a.uri, name: a.name, subtitle: 'Artist', image: sp.pickImage(a.images, 300) })),
    topTracks: (tracks?.items ?? []).map((t) => ({
      id: t.id,
      uri: t.uri,
      name: t.name,
      subtitle: t.artists.map((a) => a.name).join(', '),
      image: sp.pickImage(t.album?.images, 300)
    })),
    minutes: null
  }
}

let timer = 0
let lastSent = ''
const schedule = (ms: number): void => {
  window.clearTimeout(timer)
  timer = window.setTimeout(() => void publishNow(), ms)
}

async function publishNow(): Promise<void> {
  const { profile, loaded } = useProfile.getState()
  const me = useApp.getState().me
  if (!loaded || !me) return void schedule(5000)
  if (!(await pulseServerOn())) return void console.info('[people] no Pulse server in this build')
  if (profile.shared === false) {
    if (lastSent !== 'off') await window.pulse.people.publish(null).catch(() => {})
    lastSent = 'off'
    return
  }
  const body = {
    profile: { ...profile, displayName: profile.displayName || me.display_name || '', avatar: profile.avatar ?? sp.pickImage(me.images, 300) },
    snapshot: await snapshot(),
    thumb: await thumbOf(profile.avatar ?? sp.pickImage(me.images, 64))
  }
  const sig = JSON.stringify(body)
  if (sig === lastSent) return
  try {
    await window.pulse.people.publish(body)
    lastSent = sig
  } catch (e) {
    console.warn('[people] could not publish the profile', e)
  }
}

/** Keeps your published Pulse profile in step with your profile (a few seconds after edits). */
export function startProfileSync(): () => void {
  const unsub = useProfile.subscribe((s, p) => {
    if (s.profile !== p.profile || (s.loaded && !p.loaded)) schedule(4000)
  })
  // and once after start (top artists change over time)
  schedule(8000)
  return () => {
    unsub()
    window.clearTimeout(timer)
  }
}

/** Name and picture of someone seen before, if any. */
export const knownPerson = (id: string): KnownPerson | null => knownMap().get(id) ?? null
