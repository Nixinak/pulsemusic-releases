// Following people in Pulse. You can follow anyone; two people who follow each other are
// friends. People who use Pulse share what they play, so you can see it and listen with them.
import { create } from 'zustand'
import type { FriendAction, FriendsState, Listener, NowPlaying } from '@shared/types'
import { pulseServerOn, rememberPeople } from './people'
import { useApp, errorText } from './store'
import { useProfile } from './profile'
import { livePosition, onUserPlay, playUris, seekTo, togglePlay, usePlayer } from './player'
import { useParty } from './party'

const message = (e: unknown): string => errorText(e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** friend: you follow each other · following: you follow them · follower: they follow you. */
export type FriendStatus = 'friend' | 'following' | 'follower' | 'none'

interface Friends extends FriendsState {
  loaded: boolean
  /** An action for this person is on its way. */
  busy: string | null
  refresh: () => Promise<void>
  act: (action: FriendAction, id: string, who?: { name: string; image: string | null }) => Promise<void>
}

const EMPTY: FriendsState = { friends: [], incoming: [], outgoing: [], now: {} }
const toast = (text: string, tone?: 'info' | 'error'): void => useApp.getState().toast(text, tone)

/** Spotify serves every cover at 64, 300 and 640 px under the same id: ask for the sharp one. */
export const sharpCover = (url: string | null | undefined): string | null =>
  url ? url.replace(/(\/image\/ab67616d0000)(4851|1e02)/, '$1b273') : null

/** Covers from older versions of Pulse were shared at 64 px: show them sharp. */
function sharpNow(now: FriendsState['now']): FriendsState['now'] {
  const out: FriendsState['now'] = {}
  for (const [id, n] of Object.entries(now)) out[id] = n?.track ? { ...n, track: { ...n.track, image: sharpCover(n.track.image) } } : n
  return out
}

/** Goes up with every follow, unfollow or remove: a list loaded before that is out of date. */
let generation = 0
/** People we already said "followed you" about, so it isn't said twice. */
const announced = new Set<string>()

export const useFriends = create<Friends>((set, get) => ({
  ...EMPTY,
  loaded: false,
  busy: null,
  refresh: async () => {
    if (!(await pulseServerOn())) return set({ loaded: true })
    const started = generation
    try {
      const next = await window.pulse.people.friends()
      // you followed or removed someone while this was loading: these lists are older than that
      if (started !== generation) return
      const before = get()
      // someone new follows you since the last look (said once per person)
      const fresh = [...next.incoming, ...next.friends].filter((u) => !announced.has(u.id))
      for (const u of fresh) announced.add(u.id)
      if (before.loaded) {
        const mine = new Set([...before.outgoing, ...before.friends].map((u) => u.id))
        // when you followed first and they follow back, the "now friends" toast says it already
        const news = fresh.filter((u) => !mine.has(u.id))
        if (news.length === 1) toast(`${news[0].displayName} followed you`)
        else if (news.length > 1) toast(`${news.length} people followed you`)
      }
      set({ ...next, now: sharpNow(next.now), loaded: true })
      rememberPeople([...next.friends, ...next.incoming, ...next.outgoing].map((u) => ({ id: u.id, name: u.displayName, image: u.thumb?.startsWith('https://') ? u.thumb : null })))
    } catch (e) {
      console.warn('[friends] could not load', e)
      set({ loaded: true })
    }
  },
  act: async (action, id, who) => {
    set({ busy: id })
    generation++
    try {
      const was = statusOf(get(), id)
      const next = await window.pulse.people.friendAction(action, id, who)
      generation++
      for (const u of [...next.incoming, ...next.friends]) announced.add(u.id)
      set({ ...next, now: sharpNow(next.now), loaded: true })
      const name = who?.name || id
      const now = statusOf(next, id)
      if (now === 'friend' && was !== 'friend') toast(`You and ${name} are now friends`)
      else if (now === 'following' && was === 'none') toast(`Following ${name}`)
    } catch (e) {
      toast(message(e), 'error')
    } finally {
      set({ busy: null })
    }
  }
}))

export function statusOf(s: FriendsState, id: string): FriendStatus {
  if (s.friends.some((u) => u.id === id)) return 'friend'
  if (s.outgoing.some((u) => u.id === id)) return 'following'
  if (s.incoming.some((u) => u.id === id)) return 'follower'
  return 'none'
}

export const useFriendStatus = (id: string): FriendStatus => useFriends((s) => statusOf(s, id))
export const useNowOf = (id: string): NowPlaying | null => useFriends((s) => s.now[id] ?? null)

/** Where they are in the song now (their last report plus the time since). */
export const nowPosition = (n: NowPlaying): number => Math.min(n.track?.durationMs ?? 0, n.positionMs + (n.paused ? 0 : Math.max(0, Date.now() - n.at)))

/* ---------- Keeping the lists fresh ---------- */

let fastUntil = 0
/** Refresh more often for a while (the Friends page is open). */
export function watchFriendsClosely(): () => void {
  fastUntil = Date.now() + 10 * 60_000
  void useFriends.getState().refresh()
  const t = window.setInterval(() => {
    fastUntil = Date.now() + 60_000
    void useFriends.getState().refresh()
  }, 20_000)
  return () => {
    window.clearInterval(t)
    fastUntil = 0
  }
}

/** Loads the lists now, then every couple of minutes and when the window comes back. */
export function startFriendsSync(): () => void {
  const load = (): void => {
    if (Date.now() < fastUntil) return
    void useFriends.getState().refresh()
  }
  const first = window.setTimeout(() => void useFriends.getState().refresh(), 3000)
  const timer = window.setInterval(load, 2 * 60_000)
  window.addEventListener('focus', load)
  const stopSharing = startSharingNow()
  return () => {
    window.clearTimeout(first)
    window.clearInterval(timer)
    window.removeEventListener('focus', load)
    stopSharing()
  }
}

/* ---------- Sharing what you play ---------- */

/** Sends what you play to the Pulse server when it changes, and every 90 s while playing. */
function startSharingNow(): () => void {
  let timer = 0
  let lastSig = ''
  let lastAt = 0
  let stopped = false
  const send = async (): Promise<void> => {
    if (stopped || !(await pulseServerOn())) return
    const off = useProfile.getState().profile.shared === false
    const s = usePlayer.getState()
    if (off || !s.track) {
      if (lastSig !== 'off' && lastSig !== '') await window.pulse.people.shareNow(null).catch(() => {})
      lastSig = 'off'
      return
    }
    const party = useParty.getState().url
    const withId = useListenWith.getState().with?.id ?? null
    const now = {
      track: { uri: s.track.uri, name: s.track.name, artists: s.track.artists.map((a) => a.name).join(', '), image: sharpCover(s.track.artUrl ?? s.track.artUrlSmall), durationMs: s.track.durationMs },
      positionMs: Math.round(livePosition(s)),
      paused: s.paused,
      party: party && party.startsWith('https://') ? party : null,
      // tells the person you listen along with (they get a notice)
      with: withId
    }
    const sig = `${now.track.uri}|${now.paused}|${now.party}|${now.with}`
    // the same song still playing: only a heartbeat now and then
    if (sig === lastSig && Date.now() - lastAt < 85_000) return
    lastSig = sig
    lastAt = Date.now()
    await window.pulse.people
      .shareNow(now)
      .then(gotListeners)
      .catch((e) => console.info('[friends] could not share what plays', message(e)))
  }
  const soon = (ms = 1500): void => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => void send(), ms)
  }
  const unsub = usePlayer.subscribe((s, p) => {
    if (s.track?.id !== p.track?.id || s.paused !== p.paused || Math.abs(livePosition(s) - livePosition(p)) > 5000) soon()
  })
  const beat = window.setInterval(() => !usePlayer.getState().paused && void send(), 90_000)
  const unsubProfile = useProfile.subscribe((s, p) => s.profile.shared !== p.profile.shared && soon(500))
  // starting or stopping Listen along is sent right away, so the other person sees it
  const unsubWith = useListenWith.subscribe((s, p) => s.with?.id !== p.with?.id && soon(200))
  // while music plays, look every 30 s who listens along with you
  const ask = window.setInterval(() => {
    if (stopped || usePlayer.getState().paused || document.hidden) return
    void pulseServerOn().then((on) => {
      if (on) void window.pulse.people.listeners().then(gotListeners).catch(() => {})
    })
  }, 30_000)
  soon(6000)
  return () => {
    stopped = true
    unsub()
    unsubProfile()
    unsubWith()
    window.clearInterval(ask)
    window.clearTimeout(timer)
    window.clearInterval(beat)
  }
}

/* ---------- Listening with someone ---------- */

interface ListenWith {
  /** Who you listen with, or null. */
  with: { id: string; name: string } | null
  now: NowPlaying | null
}
export const useListenWith = create<ListenWith>(() => ({ with: null, now: null }))

let lwTimer = 0
let lwUnsub: (() => void) | null = null
let lwOwnPlay = false

async function syncWith(): Promise<void> {
  const w = useListenWith.getState().with
  if (!w) return
  let n: NowPlaying | null
  try {
    n = await window.pulse.people.nowOf(w.id)
  } catch (e) {
    toast(message(e), 'error')
    return stopListeningWith()
  }
  if (useListenWith.getState().with?.id !== w.id) return
  if (n?.track) n = { ...n, track: { ...n.track, image: sharpCover(n.track.image) } }
  useListenWith.setState({ now: n })
  if (!n?.track) return
  const me = usePlayer.getState()
  const pos = nowPosition(n)
  if (me.track?.uri !== n.track.uri) {
    if (n.paused) return
    lwOwnPlay = true
    try {
      await playUris([n.track.uri])
      // the song starts from the beginning: jump to where they are
      if (pos > 3000) window.setTimeout(() => void seekTo(nowPosition(n!)), 900)
    } finally {
      window.setTimeout(() => (lwOwnPlay = false), 1500)
    }
    return
  }
  if (n.paused !== me.paused) void togglePlay()
  else if (!n.paused && Math.abs(livePosition(me) - pos) > 6000) void seekTo(pos)
}

/** Plays what they play, following along until you stop or start something else. */
export function listenWith(id: string, name: string): void {
  stopListeningWith(true)
  useListenWith.setState({ with: { id, name }, now: null })
  toast(`Listening with ${name}`)
  void syncWith()
  lwTimer = window.setInterval(() => void syncWith(), 6000)
  // you picked something yourself: you're no longer listening with them
  lwUnsub = onUserPlay(() => {
    if (!lwOwnPlay) stopListeningWith()
  })
}

export function stopListeningWith(quiet = false): void {
  window.clearInterval(lwTimer)
  lwUnsub?.()
  lwUnsub = null
  const was = useListenWith.getState().with
  useListenWith.setState({ with: null, now: null })
  if (was && !quiet) toast(`Stopped listening with ${was.name}`)
}

/* ---------- New followers badge ---------- */

const SEEN_KEY = 'pulse-seen-followers'
const readSeen = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}
export const useSeenFollowers = create<{ seen: string[] }>(() => ({ seen: readSeen() }))

/** The Friends page was opened: today's followers are not new any more. */
export function markFollowersSeen(): void {
  const ids = [...useFriends.getState().incoming, ...useFriends.getState().friends].map((u) => u.id)
  const seen = [...new Set([...useSeenFollowers.getState().seen, ...ids])].slice(-2000)
  useSeenFollowers.setState({ seen })
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen))
  } catch {
    /* storage unavailable */
  }
}

/** How many people followed you since you last opened Friends. */
export function useNewFollowers(): number {
  const seen = useSeenFollowers((s) => s.seen)
  const list = useFriends((s) => s.incoming)
  return list.filter((u) => !seen.includes(u.id)).length
}

/* ---------- People listening along with you ---------- */

interface Listeners {
  list: Listener[]
  /** Someone who just started: shown in a big notice for a few seconds. */
  arrived: Listener | null
}
export const useListeners = create<Listeners>(() => ({ list: [], arrived: null }))
let arrivedTimer = 0

function gotListeners(list: Listener[] | void): void {
  if (!Array.isArray(list)) return
  const before = useListeners.getState().list
  const known = new Set(before.map((l) => l.id))
  const fresh = list.filter((l) => !known.has(l.id))
  const gone = before.filter((l) => !list.some((x) => x.id === l.id))
  useListeners.setState({ list })
  if (fresh[0]) {
    window.clearTimeout(arrivedTimer)
    useListeners.setState({ arrived: fresh[0] })
    arrivedTimer = window.setTimeout(() => useListeners.setState({ arrived: null }), 7000)
  }
  for (const l of gone) toast(`${l.displayName} stopped listening along`)
}

/** Hides the big "is listening with you" notice. */
export const dismissArrived = (): void => {
  window.clearTimeout(arrivedTimer)
  useListeners.setState({ arrived: null })
}
