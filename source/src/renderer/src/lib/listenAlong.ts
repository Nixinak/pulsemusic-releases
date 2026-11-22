// Joining a friend's party from this app: see what plays there, add songs, and (optionally)
// play the same song at the same moment here, on a device you pick. Each listener plays it
// on their own Spotify account; Pulse only keeps the two in step.
//
// Requests: the party state is read from the friend's computer every 3 s (free); Spotify is
// only asked when something has to change here (new song, a jump, pause or resume).
import { listenWith } from './friends'
import { create } from 'zustand'
import type { PartyControl, PartyState, PartyTrack } from '@shared/types'
import * as sp from './spotify'
import { livePosition, setPartySteer, usePlayer } from './player'
import { stopDj } from './dj'
import { useApp, errorText } from './store'

interface ListenAlong {
  /** The friend's party link, or null when not in a party. */
  url: string | null
  state: PartyState | null
  /** When `state` arrived (its position is from that moment). */
  at: number
  error: string | null
  /** Play the party here too. */
  sync: boolean
  /** Where to play it: a Spotify device id (this app's own player by default). */
  deviceId: string | null
  /** Short status for the UI ("Playing along", "Catching up…"). */
  status: string
  /** Your thumbs at this party: song → 1 or -1. */
  votes: Record<string, number>
}

export const useListenAlong = create<ListenAlong>(() => ({
  url: null,
  state: null,
  at: 0,
  error: null,
  sync: true,
  deviceId: null,
  status: '',
  votes: {}
}))
const set = useListenAlong.setState
const get = useListenAlong.getState

let timer = 0
let soon = 0
let lastAction = 0
/** The song we last asked Spotify to play here, and when: never asked twice in a row for the
 *  same song (failed or not) until the host moves on or the retry pause is over. */
let tried: { uri: string; at: number; fails: number } | null = null

/** Join a party (from a pulsemusic:// link or a pasted link). */
export function joinParty(url: string): void {
  window.clearInterval(timer)
  set({
    url,
    state: null,
    error: null,
    sync: true,
    deviceId: get().deviceId ?? usePlayer.getState().localDeviceId,
    status: 'Connecting…',
    votes: get().url === url ? get().votes : {}
  })
  stopDj()
  // while playing along, your own play, skip and seek buttons steer the party for everyone
  setPartySteer((c) => {
    if (!get().url || !get().sync) return false
    void partyControl(c)
    return true
  })
  void tick()
  timer = window.setInterval(() => void tick(), 3000)
}

export function leaveParty(): void {
  window.clearInterval(timer)
  window.clearTimeout(soon)
  setPartySteer(null)
  set({ url: null, state: null, error: null, status: '' })
}

export function setSync(on: boolean): void {
  set({ sync: on, status: on ? 'Catching up…' : 'Not playing here' })
  lastAction = 0
  tried = null
  if (on) void tick()
}

export function setListenDevice(id: string): void {
  set({ deviceId: id })
  lastAction = 0
  tried = null
  // move playback right away when it's already playing along
  if (get().sync) void sp.transferPlayback(id, true).catch(() => {})
}

async function tick(): Promise<void> {
  const url = get().url
  if (!url) return
  const asked = Date.now()
  let st: PartyState
  try {
    st = await window.pulse.party.remoteState(url)
  } catch (e) {
    set({ error: errorText(e), status: 'The party is not reachable' })
    return
  }
  if (get().url !== url) return
  if (st.ended) {
    leaveParty()
    useApp.getState().toast('The host ended the party')
    return
  }
  const rtt = Date.now() - asked
  set({ state: st, at: Date.now(), error: null })
  if (!get().sync) return
  const np = st.nowPlaying
  if (!np?.uri) return set({ status: 'Waiting for the host to play something' })
  // Don't stack commands: give Spotify a few seconds to carry out the last one.
  if (Date.now() - lastAction < 5000 || sp.rateLimited()) return
  const target = (np.positionMs ?? 0) + (np.paused ? 0 : Math.round(rtt / 2))
  const me = usePlayer.getState()
  const device = get().deviceId ?? me.localDeviceId ?? undefined
  if (np.uri.startsWith('spotify:local:')) return set({ status: 'The host is playing a local file' })
  try {
    if (me.track?.uri !== np.uri) {
      // already asked for this song: give Spotify (and our own player poll) time; after a
      // failure wait 30 s, then 60 s, then stop trying this song
      if (tried?.uri === np.uri) {
        const pause = tried.fails ? 30_000 * tried.fails : 25_000
        if (tried.fails >= 3 || Date.now() - tried.at < pause) return
      }
      set({ status: 'Catching up…' })
      lastAction = Date.now()
      tried = {
        uri: np.uri,
        at: Date.now(),
        fails: tried?.uri === np.uri ? tried.fails : 0
      }
      await sp.play({ uris: [np.uri], positionMs: target + 600 }, device)
      if (np.paused) await sp.pause(device)
      return
    }
    const drift = livePosition(me) - target
    if (np.paused && !me.paused) {
      lastAction = Date.now()
      await sp.pause(device)
    } else if (!np.paused && me.paused) {
      lastAction = Date.now()
      await sp.resume(device)
    } else if (!np.paused && Math.abs(drift) > 4000) {
      lastAction = Date.now()
      await sp.seek(target + 300, device)
    }
    set({ status: np.paused ? 'Paused by the host' : 'Playing along' })
  } catch (e) {
    if (tried?.uri === np.uri) tried.fails++
    const status = e instanceof sp.ApiError ? e.status : 0
    const msg = errorText(e)
    // no Premium / nothing to play on: retrying can't help, stop playing along
    if (status === 403 || /premium|NO_ACTIVE_DEVICE|no active device/i.test(msg)) {
      set({
        sync: false,
        status: /premium/i.test(msg) || status === 403 ? 'Playing along needs Spotify Premium' : 'Pick a device to play on'
      })
      return
    }
    set({ status: msg })
  }
}

const guestName = (): string => useApp.getState().me?.display_name || 'Guest'

/** Play/pause, skip, seek or remove a song at the party you joined; everyone hears it. */
export async function partyControl(c: PartyControl): Promise<void> {
  const url = get().url
  if (!url) return
  try {
    await window.pulse.party.remoteControl(url, c, guestName())
    // follow the change here right away instead of waiting for the next check
    lastAction = 0
    tried = null
    window.clearTimeout(soon)
    soon = window.setTimeout(() => void tick(), 700)
  } catch (e) {
    useApp.getState().toast(errorText(e), 'error')
  }
}

/** Thumbs up (1) or down (-1) at the party you joined; the same again takes it back. */
export async function remoteVote(uri: string, v: 1 | -1): Promise<void> {
  const url = get().url
  if (!url) return
  const was = get().votes[uri] ?? 0
  const next = was === v ? 0 : v
  // show it right away, with the score moved by the change
  set((s) => ({
    votes: { ...s.votes, [uri]: next },
    state: s.state ? { ...s.state, queue: s.state.queue.map((q) => (q.uri === uri ? { ...q, score: (q.score ?? 0) - was + next } : q)) } : s.state
  }))
  try {
    await window.pulse.party.remoteVote(url, uri, next, guestName())
  } catch (e) {
    set((s) => ({ votes: { ...s.votes, [uri]: was } }))
    useApp.getState().toast(errorText(e), 'error')
  }
  window.clearTimeout(soon)
  soon = window.setTimeout(() => void tick(), 700)
}

export async function remoteSearch(q: string): Promise<PartyTrack[]> {
  const url = get().url
  if (!url) return []
  return (await window.pulse.party.remoteSearch(url, q)).tracks ?? []
}

export async function remoteAdd(t: PartyTrack): Promise<void> {
  const url = get().url
  if (!url) return
  try {
    await window.pulse.party.remoteAdd(url, t.uri, guestName())
    useApp.getState().toast(`Added “${t.name}” to the party`)
    void tick()
  } catch (e) {
    useApp.getState().toast(errorText(e), 'error')
  }
}

/** Opens links from the party page ("Open in Pulse Music") and the one Pulse was started with. */
export function listenForJoins(): () => void {
  // the link waits in the main process until it's taken here, so none get lost while
  // the app is still signing in
  const take = (): void => {
    void window.pulse.party.pendingJoin().then((url) => {
      if (!url) return
      // a friend's Listen along button (Discord): follow what they play
      const m = /^listen:([^:]+):(.*)$/.exec(url)
      if (m) {
        const name = decodeURIComponent(m[2]) || 'your friend'
        useApp.getState().navigate({ name: 'friends' })
        listenWith(m[1], name)
        return
      }
      useApp.getState().navigate({ name: 'party' })
      joinParty(url)
    })
  }
  take()
  return window.pulse.party.onJoin(take)
}
