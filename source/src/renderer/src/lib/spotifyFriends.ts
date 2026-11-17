// Your Spotify friends' activity (the people you follow on Spotify and what they last played),
// read through your Spotify web account signed in inside Pulse. It doesn't touch Pulse's Web
// API allowance. Refreshed every 45 s while a page shows it.
import { useEffect } from 'react'
import { create } from 'zustand'
import type { SpotifyFriend } from '@shared/types'
import { refreshWebRoute } from './spotify'

interface State {
  /** null until known */
  connected: boolean | null
  list: SpotifyFriend[] | null
  connecting: boolean
  error: string | null
}

export const useSpotifyFriends = create<State>(() => ({ connected: null, list: null, connecting: false, error: null }))
const set = useSpotifyFriends.setState

export async function refreshSpotifyFriends(withList = true): Promise<void> {
  const api = window.pulse.spotifyAccount
  if (!api) return set({ connected: false })
  const st = await api.status().catch(() => null)
  const connected = !!st?.connected
  set({ connected })
  void refreshWebRoute()
  if (!connected) return set({ list: null })
  if (!withList) return
  const list = await api.friends().catch(() => null)
  if (list) set({ list, error: null })
  else if (!useSpotifyFriends.getState().list) set({ error: 'Couldn’t read your Spotify friends right now.' })
}

export async function connectSpotifyFriends(): Promise<boolean> {
  set({ connecting: true, error: null })
  try {
    const ok = await window.pulse.spotifyAccount.connect()
    if (ok) await refreshSpotifyFriends()
    return ok
  } finally {
    set({ connecting: false })
  }
}

export async function disconnectSpotifyFriends(): Promise<void> {
  await window.pulse.spotifyAccount.disconnect()
  set({ connected: false, list: null })
  void refreshWebRoute()
}

/** Keeps the list fresh while the calling page is open. */
export function useSpotifyFriendsLive(): void {
  useEffect(() => {
    void refreshSpotifyFriends()
    const t = window.setInterval(() => !document.hidden && void refreshSpotifyFriends(), 45_000)
    return () => window.clearInterval(t)
  }, [])
}

/** "Listening now" within a few minutes of the last play, otherwise how long ago. */
export function whenPlayed(at: number): { now: boolean; text: string } {
  const mins = Math.floor((Date.now() - at) / 60_000)
  if (mins < 5) return { now: true, text: 'Listening now' }
  if (mins < 60) return { now: false, text: `${mins} min ago` }
  const h = Math.floor(mins / 60)
  if (h < 24) return { now: false, text: `${h} h ago` }
  const d = Math.floor(h / 24)
  return { now: false, text: d === 1 ? 'Yesterday' : `${d} days ago` }
}
