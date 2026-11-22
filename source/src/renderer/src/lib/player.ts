// Playback controller: the local Web Playback SDK device plus remote Spotify Connect devices.
import { create } from 'zustand'
import type { PartyControl, PlaybackSnapshot, PlayerCommand } from '@shared/types'
import * as sp from './spotify'
import { DEFAULT_PALETTE, extractPalette, setTrackPalette } from './colors'
import { useApp, errorText } from './store'
import type { SPlaybackState, STrack } from './types'

export interface PlayerTrack {
  id: string
  uri: string
  name: string
  artists: { id: string; name: string; uri: string }[]
  album: { id: string; name: string; uri: string }
  artUrl: string | null
  artUrlSmall: string | null
  durationMs: number
}

export type Repeat = 'off' | 'context' | 'track'

interface PlayerState {
  sdkReady: boolean
  sdkError: string | null
  localDeviceId: string | null
  activeDevice: { id: string | null; name: string; type: string } | null
  isLocal: boolean
  track: PlayerTrack | null
  contextUri: string | null
  positionMs: number
  sampledAt: number
  paused: boolean
  shuffle: boolean
  repeat: Repeat
  volume: number
  liked: boolean
  /** Bumped when the queue may have changed. */
  queueVersion: number
  /** Current fade multiplier (1 = full volume) applied on top of the user's volume. */
  fadeGain: number
  /** The song after this one, known shortly before a transition. */
  nextUp: {
    id: string
    name: string
    artists: string
    artUrl: string | null
  } | null
  /** Sleep timer: pause at this time (epoch ms), or at the end of the current song. */
  sleep: { mode: 'time'; at: number } | { mode: 'track'; trackId: string } | null
  /** Songs the listener queued ("Next in queue"). Pulse plays them itself, so they can be
   *  reordered, removed and cleared, which Spotify's API does not allow. */
  upNext: QueueItem[]
}

export interface QueueItem {
  uid: string
  id: string
  uri: string
  name: string
  artists: string
  image: string | null
  /** Party mode: the guest who added it. */
  addedBy?: string
}

export const usePlayer = create<PlayerState>(() => ({
  sdkReady: false,
  sdkError: null,
  localDeviceId: null,
  activeDevice: null,
  isLocal: false,
  track: null,
  contextUri: null,
  positionMs: 0,
  sampledAt: Date.now(),
  paused: true,
  shuffle: false,
  repeat: 'off',
  volume: 0.7,
  liked: false,
  queueVersion: 0,
  fadeGain: 1,
  nextUp: null,
  sleep: null,
  upNext: []
}))

export function livePosition(s: Pick<PlayerState, 'paused' | 'positionMs' | 'sampledAt' | 'track'>): number {
  if (s.paused) return s.positionMs
  return Math.min(s.track?.durationMs ?? 0, s.positionMs + (Date.now() - s.sampledAt))
}

let sdk: Spotify.Player | null = null
let pollTimer: number | null = null
let lastTrackId: string | null = null

/* ---------- Song fades (local playback only) ----------
 * The Web Playback SDK cannot overlap two songs, so instead of a true crossfade
 * the end of a song fades out and the next one fades in. */
let gain = 1
let trackStartedAt = 0
/** How long the current song fades in (0: it starts at full volume). */
let fadeInMs = 0
/** Volume curve that sounds even to the ear (linear in decibels, -30 dB to 0). */
const loud = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : Math.pow(10, (x - 1) * 1.5))
let manualFade = false
let wasLocalBeforeDrop = false
/** After a shuffle/repeat click, ignore older state from Spotify until it catches up. */
let togglesLockedUntil = 0
const togglesLocked = (): boolean => Date.now() < togglesLockedUntil
/** Id of the device that is actually playing (for explicit API targeting). */
const activeId = (): string | undefined => get().activeDevice?.id ?? undefined
let fadeTimer: number | null = null

export const fadeMs = (): number => {
  const st = useApp.getState().settings
  if (!st.crossfade) return 0
  if (st.fadeSeconds > 0) return st.fadeSeconds * 1000
  // Auto: about 3.5 % of the song, between 3 and 8 seconds.
  const d = get().track?.durationMs ?? 180_000
  return Math.min(8000, Math.max(3000, d * 0.035))
}

/** Looks up the next song shortly before a transition so the UI can show both covers. */
let nextFetchedFor: string | null = null
// When the queue changes the looked-up next song is dropped: look it up again (once).
queueMicrotask(() =>
  usePlayer.subscribe((st, prev) => {
    if (!st.nextUp && prev.nextUp) nextFetchedFor = null
  })
)
function maybeFetchNext(): void {
  const s = get()
  const f = fadeMs()
  if (!s.track || f <= 0 || s.paused || nextFetchedFor === s.track.id) return
  // (a song only just known has no position yet: not near its end)
  if (!s.sampledAt || s.track.durationMs - livePosition(s) > f + 10_000) return
  nextFetchedFor = s.track.id
  const queued = s.upNext[0]
  if (queued && !queueMode) {
    set({
      nextUp: {
        id: queued.id,
        name: queued.name,
        artists: queued.artists,
        artUrl: queued.image
      }
    })
    return
  }
  sp.getQueue()
    .then((q) => {
      const t = q.queue[0]
      if (get().track?.id !== s.track?.id) return
      set({
        nextUp: t
          ? {
              id: t.id,
              name: t.name,
              artists: t.artists.map((a) => a.name).join(', '),
              artUrl: sp.pickImage(t.album?.images, 300)
            }
          : null
      })
    })
    .catch(() => {
      // Try again in a few seconds, not on the next 100 ms tick.
      window.setTimeout(() => {
        if (nextFetchedFor === s.track?.id) nextFetchedFor = null
      }, 5000)
    })
}

/** Extra multiplier while the sleep timer fades the music out. */
let sleepGain = 1
/** Extra multiplier while the AI DJ talks over the music. */
let duckGain = 1
let duckRaf = 0
let duckRemoteVolume: number | null = null

/** Lowers (or restores) the music under the DJ's voice with a short ramp. */
export function duck(target: number, ms = 450): Promise<void> {
  const s = get()
  cancelAnimationFrame(duckRaf)
  if (!s.isLocal || !sdk) {
    // Another device: one volume change each way.
    if (!s.activeDevice) return Promise.resolve()
    if (target < 1 && duckRemoteVolume === null) {
      duckRemoteVolume = s.volume
      return sp.setVolume(s.volume * target * 100, activeId()).catch(() => {})
    }
    if (target >= 1 && duckRemoteVolume !== null) {
      const v = duckRemoteVolume
      duckRemoteVolume = null
      return sp.setVolume(v * 100, activeId()).catch(() => {})
    }
    return Promise.resolve()
  }
  const from = duckGain
  const start = performance.now()
  return new Promise((resolve) => {
    const step = (now: number): void => {
      const k = Math.min(1, (now - start) / ms)
      duckGain = from + (target - from) * (1 - Math.pow(1 - k, 3))
      applyGain()
      if (k < 1) duckRaf = requestAnimationFrame(step)
      else resolve()
    }
    duckRaf = requestAnimationFrame(step)
  })
}

function applyGain(): void {
  if (sdk && get().isLocal) void sdk.setVolume(loudness(get().volume) * gain * sleepGain * duckGain)
  // Shown in the transition card so it is visible that the fade is happening.
  set({ fadeGain: gain })
}

function fadeTick(): void {
  queueTick()
  maybeFetchNext()
  sleepTick()
  if (manualFade && Date.now() - manualFadeAt > 4000) manualFade = false
  const s = get()
  const f = fadeMs()
  if (!sdk || !s.isLocal || !s.track || f <= 0 || manualFade) {
    if (!manualFade && gain !== 1) {
      gain = 1
      applyGain()
    }
    return
  }
  let target = 1
  const remaining = s.track.durationMs - livePosition(s)
  // the last seconds fade out (not for a song on repeat, it just starts again)
  if (!s.paused && remaining < f && s.repeat !== 'track') target = loud(remaining / f)
  // the next song fades in, but only after a fade-out or a skip (never a jump down)
  const since = Date.now() - trackStartedAt
  if (fadeInMs > 0 && since < fadeInMs) target = Math.min(target, Math.max(0.03, loud(since / fadeInMs)))
  if (Math.abs(target - gain) > 0.008 || (target === 1 && gain !== 1)) {
    gain = target
    applyGain()
  }
}

/** Runs a player command but never waits on it for more than 2 s: the SDK's promises
 *  sometimes never settle, and nothing after a skip may depend on them. */
async function runSafely(action: () => Promise<void> | void): Promise<void> {
  await Promise.race([
    Promise.resolve()
      .then(action)
      .catch((e) => console.error('[player] command failed', e)),
    new Promise((r) => setTimeout(r, 2000))
  ])
}

let manualFadeAt = 0

/** Quickly dips the volume before a manual skip so it doesn't cut hard. */
async function dipThen(action: () => Promise<void> | void): Promise<void> {
  const s = get()
  // Already mid-skip (fast repeated presses), not local, or fades off: just do it.
  if (!sdk || !s.isLocal || s.paused || fadeMs() <= 0 || manualFade) {
    await runSafely(action)
    scheduleHealthCheck()
    return
  }
  manualFade = true
  manualFadeAt = Date.now()
  try {
    const from = gain
    const steps = 5
    for (let i = 1; i <= steps; i++) {
      // Dip, but never to silence: a stuck command must not leave the player muted.
      gain = Math.max(0.2, from * (1 - i / steps))
      applyGain()
      await new Promise((r) => setTimeout(r, 35))
    }
    await runSafely(action)
  } finally {
    trackStartedAt = Date.now()
    // a skip comes back quickly; a long fade-in would sound like the music dropped out
    fadeInMs = 700
    manualFade = false
  }
  scheduleHealthCheck()
}

/** A few seconds after a skip, make sure this computer is really still playing. */
let healthTimer: number | null = null
function scheduleHealthCheck(): void {
  if (healthTimer) clearTimeout(healthTimer)
  healthTimer = window.setTimeout(() => void checkLocalPlayback(), 3000)
}

async function checkLocalPlayback(): Promise<void> {
  healthTimer = null
  const s = get()
  if (!sdk || !s.isLocal || s.paused) return
  // Ask Spotify first: if a phone or speaker is the active device now, leave it alone.
  const api = await sp.getPlaybackState().catch(() => undefined)
  if (api?.device?.id && api.device.id !== get().localDeviceId) {
    set({ isLocal: false })
    void pollRemote()
    return
  }
  let state: Spotify.PlaybackState | null = null
  try {
    state = await Promise.race([sdk.getCurrentState(), new Promise<null>((r) => setTimeout(() => r(null), 2000))])
  } catch {
    state = null
  }
  if (!state) {
    // The in-app player lost its session (the "everything stops" case): re-attach it.
    console.warn('[player] local player lost its session, re-attaching')
    if (s.localDeviceId) await sp.transferPlayback(s.localDeviceId, true).catch(() => {})
    return
  }
  if (state.paused) {
    console.warn('[player] stalled after skip, resuming')
    await runSafely(() => sdk!.resume())
  }
  if (gain < 1 && !manualFade && Date.now() - trackStartedAt > fadeMs()) {
    gain = 1
    applyGain()
  }
}

const set = usePlayer.setState
const get = usePlayer.getState
const toast = (t: string, tone: 'info' | 'error' = 'info'): void => useApp.getState().toast(t, tone)

const repeatFromSdk = (m: 0 | 1 | 2): Repeat => (m === 1 ? 'context' : m === 2 ? 'track' : 'off')

function trackFromSdk(t: Spotify.Track): PlayerTrack {
  const imgs = [...t.album.images].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))
  return {
    id: t.id ?? sp.idFromUri(t.uri),
    uri: t.uri,
    name: t.name,
    artists: t.artists.map((a) => ({
      id: sp.idFromUri(a.uri),
      name: a.name,
      uri: a.uri
    })),
    album: {
      id: sp.idFromUri(t.album.uri),
      name: t.album.name,
      uri: t.album.uri
    },
    artUrl: imgs[0]?.url ?? null,
    artUrlSmall: imgs[imgs.length - 1]?.url ?? null,
    durationMs: t.duration_ms
  }
}

function trackFromApi(s: SPlaybackState): PlayerTrack | null {
  const t = s.item
  if (!t) return null
  return {
    id: t.id,
    uri: t.uri,
    name: t.name,
    artists: t.artists.map((a) => ({ id: a.id, name: a.name, uri: a.uri })),
    album: {
      id: t.album?.id ?? '',
      name: t.album?.name ?? '',
      uri: t.album?.uri ?? ''
    },
    artUrl: sp.pickImage(t.album?.images, 600),
    artUrlSmall: sp.pickImage(t.album?.images, 64),
    durationMs: t.duration_ms
  }
}

/* ---------- Track change side effects ---------- */

/** Liked or not, per song id, for a few minutes (likes made on a phone show up after that). */
const likedCache = new Map<string, boolean>()
const likedAt = new Map<string, number>()
const LIKED_FRESH = 3 * 60_000
const cacheLiked = (id: string, v: boolean): void => {
  likedCache.set(id, v)
  likedAt.set(id, Date.now())
}
// any like or unlike in the app (track menus, album pages…) updates it right away
window.addEventListener('pulse:library-changed', (e) => {
  const { uris, saved } = (e as CustomEvent<{ uris: string[]; saved: boolean }>).detail
  for (const uri of uris) {
    const id = uri.split(':').pop()!
    cacheLiked(id, saved)
    if (get().track?.id === id) set({ liked: saved })
  }
})

async function onTrackChanged(track: PlayerTrack | null): Promise<void> {
  if ((track?.id ?? null) === lastTrackId) return
  const prevId = lastTrackId
  lastTrackId = track?.id ?? null
  if (track) {
    recentIds.push(track.id)
    if (recentIds.length > 80) recentIds.shift()
  }
  trackStartedAt = Date.now()
  // fade in only when the previous song faded out here (or was skipped); a song started
  // on a phone or when the app opens plays at full volume right away
  fadeInMs = !prevId ? 0 : Date.now() - manualFadeAt < 4000 ? 700 : gain < 0.6 ? fadeMs() / 2 : 0
  queueOnTrack(prevId, track)
  set((s) => ({ queueVersion: s.queueVersion + 1, nextUp: null }))
  if (!track) {
    setTrackPalette(DEFAULT_PALETTE)
    return
  }
  if (track.artUrl) {
    extractPalette(track.artUrl)
      .then((p) => {
        if (get().track?.id === track.id) setTrackPalette(p)
      })
      .catch(() => setTrackPalette(DEFAULT_PALETTE))
  }
  // Ask about "liked" only once the song has stayed for a moment, so skipping fast through
  // ten songs doesn't send ten requests, and never twice for the same song.
  const known = likedCache.get(track.id)
  if (known !== undefined && Date.now() - (likedAt.get(track.id) ?? 0) < LIKED_FRESH) return void set({ liked: known })
  // the heart never shows the previous song's like while this one is checked (it used to
  // light up for a second and then go out); a like seen earlier is shown right away
  set({ liked: known ?? false })
  await new Promise((r) => setTimeout(r, 900))
  if (get().track?.id !== track.id) return
  try {
    const [liked] = await sp.libraryContains([track.uri])
    cacheLiked(track.id, !!liked)
    if (get().track?.id === track.id) set({ liked: !!liked })
  } catch {
    if (get().track?.id === track.id) set({ liked: known ?? false })
  }
}

/* ---------- Remote polling ---------- */

async function pollRemote(): Promise<void> {
  if (sp.rateLimited()) return
  try {
    const s = await sp.getPlaybackState()
    if (!s || !s.device) {
      set({ activeDevice: null, paused: true, isLocal: false })
      return
    }
    const isLocal = !!s.device.id && s.device.id === get().localDeviceId
    // Spotify's own answer decides where we are playing. The in-app player does not always
    // announce that a phone took over, so never trust it alone.
    if (isLocal && sdk) {
      if (!get().isLocal) set({ isLocal: true })
      return
    }
    const track = trackFromApi(s)
    const keepToggles = togglesLocked()
    set({
      activeDevice: {
        id: s.device.id,
        name: s.device.name,
        type: s.device.type
      },
      isLocal: false,
      track: track ?? get().track,
      contextUri: s.context?.uri ?? null,
      positionMs: s.progress_ms ?? 0,
      sampledAt: Date.now(),
      paused: !s.is_playing,
      ...(keepToggles ? {} : { shuffle: s.shuffle_state, repeat: s.repeat_state }),
      volume: s.device.volume_percent != null ? s.device.volume_percent / 100 : get().volume
    })
    void onTrackChanged(track)
  } catch (e) {
    console.warn('[player] poll failed', e)
  }
}

function startPolling(): void {
  if (pollTimer) return
  void pollRemote()
  // How often to ask Spotify what is playing (each ask counts against the app's allowance):
  // another device playing 5 s, paused 20 s; this computer playing 30 s (the in-app player
  // reports its own changes, this only notices a phone taking over). Window hidden (Pulse in
  // the tray): 90 s while something plays, 4 min when nothing does (plays on other devices are
  // still counted: the listening history reads Spotify's recently played list).
  let last = 0
  pollTimer = window.setInterval(() => {
    const st = get()
    const every = document.hidden ? (st.paused || !st.track ? 240_000 : 90_000) : st.isLocal ? 30_000 : st.paused ? 20_000 : 5000
    if (Date.now() - last < every) return
    last = Date.now()
    void pollRemote()
  }, 1000)
}

/* ---------- SDK ---------- */

function loadSdkScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Spotify) return resolve()
    window.onSpotifyWebPlaybackSDKReady = () => resolve()
    const s = document.createElement('script')
    s.src = 'https://sdk.scdn.co/spotify-player.js'
    s.async = true
    s.onerror = () => reject(new Error('Could not load the Spotify player. Check your connection.'))
    document.head.appendChild(s)
  })
}

export async function initPlayer(initialVolume: number): Promise<void> {
  set({ volume: initialVolume })
  startPolling()
  if (!fadeTimer) fadeTimer = window.setInterval(fadeTick, 100)
  try {
    await loadSdkScript()
  } catch (e) {
    set({ sdkError: errorText(e) })
    return
  }

  sdk = new window.Spotify.Player({
    name: 'Pulse Music',
    volume: loudness(initialVolume),
    getOAuthToken: (cb) => {
      void window.pulse.auth.token().then((t) => cb(t ?? ''))
    }
  })

  sdk.addListener('ready', ({ device_id }) => {
    const before = get()
    set({ sdkReady: true, sdkError: null, localDeviceId: device_id })
    // After a reconnect the device id can change; continue playback here if it was here.
    if (wasLocalBeforeDrop && before.localDeviceId && before.localDeviceId !== device_id) {
      void sp.transferPlayback(device_id, !before.paused).catch(() => {})
    }
    wasLocalBeforeDrop = false
  })
  sdk.addListener('not_ready', () => {
    // The player dropped its connection; reconnect instead of staying dead.
    wasLocalBeforeDrop = get().isLocal
    set({ sdkReady: false })
    window.setTimeout(() => void sdk?.connect(), 1500)
  })
  sdk.addListener('initialization_error', ({ message }) => {
    console.error('[sdk] init', message)
    set({
      sdkError: 'This build cannot play protected audio. Run Pulse Music with the castLabs Electron build (npm install).'
    })
  })
  sdk.addListener('authentication_error', ({ message }) => {
    console.error('[sdk] auth', message)
    set({
      sdkError: 'Spotify rejected the sign-in. Sign out and sign in again.'
    })
  })
  sdk.addListener('account_error', () => {
    set({ sdkError: 'Playback in Pulse Music needs Spotify Premium.' })
  })
  let playbackErrors: number[] = []
  sdk.addListener('playback_error', ({ message }) => {
    console.error('[sdk] playback', message)
    // A refused DRM licence fails every song, and Spotify skips to the next one each time.
    // After the second failure in a row, stop instead of racing through the playlist.
    const now = Date.now()
    playbackErrors = [...playbackErrors.filter((t) => now - t < 6000), now]
    if (playbackErrors.length >= 2) void runSafely(() => sdk?.pause())
    // Repeated failures right away usually mean the DRM licence was refused (unsigned app).
    toast('Spotify refused to play this. If it keeps happening, sign the app with castLabs EVS.', 'error')
    set({
      sdkError: `Playback failed: ${message}. Run "npm run evs:sign-dev" and restart.`
    })
  })

  sdk.addListener('player_state_changed', (state) => {
    if (!state) {
      // Playback moved to another device.
      set({ isLocal: false })
      void pollRemote()
      return
    }
    const track = state.track_window.current_track ? trackFromSdk(state.track_window.current_track) : null
    // A state from the in-app player while another device is active is stale; ignore it.
    if (!get().isLocal && get().activeDevice && get().activeDevice?.id !== get().localDeviceId) {
      void pollRemote()
      return
    }
    set({
      isLocal: true,
      activeDevice: {
        id: get().localDeviceId,
        name: 'Pulse Music',
        type: 'Computer'
      },
      track,
      contextUri: state.context?.uri ?? null,
      positionMs: state.position,
      sampledAt: Date.now(),
      paused: state.paused,
      ...(togglesLocked() ? {} : { shuffle: state.shuffle, repeat: repeatFromSdk(state.repeat_mode) })
    })
    void onTrackChanged(track)
  })

  const ok = await sdk.connect()
  if (!ok) set({ sdkError: 'The Spotify player failed to start.' })
}

export function disposePlayer(): void {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
  if (fadeTimer) clearInterval(fadeTimer)
  fadeTimer = null
  sdk?.disconnect()
  sdk = null
}

/* ---------- Sleep timer ---------- */

const SLEEP_FADE_MS = 12_000
let sleepRemoteVolume: number | null = null

/** Time left before the sleep timer pauses playback, in ms (null when off). */
export function sleepRemaining(): number | null {
  const s = get()
  if (!s.sleep) return null
  if (s.sleep.mode === 'time') return Math.max(0, s.sleep.at - Date.now())
  if (!s.track || s.track.id !== s.sleep.trackId) return 0
  return Math.max(0, s.track.durationMs - livePosition(s))
}

export function setSleepTimer(minutes: number | 'track' | null): void {
  const s = get()
  restoreSleepVolume()
  if (minutes === null) {
    set({ sleep: null })
    toast('Sleep timer off')
    return
  }
  if (minutes === 'track') {
    if (!s.track) return toast('Start playing something first.', 'error')
    set({ sleep: { mode: 'track', trackId: s.track.id } })
    toast('Music will stop at the end of this song')
    return
  }
  set({ sleep: { mode: 'time', at: Date.now() + minutes * 60_000 } })
  toast(`Music will stop in ${minutes} minutes`)
}

function restoreSleepVolume(): void {
  if (sleepGain !== 1) {
    sleepGain = 1
    applyGain()
  }
  if (sleepRemoteVolume !== null) {
    const v = sleepRemoteVolume
    sleepRemoteVolume = null
    void sp.setVolume(v * 100, activeId()).catch(() => {})
  }
}

let sleepFiring = false
function sleepTick(): void {
  const s = get()
  if (!s.sleep || sleepFiring) return
  // "End of song" follows the song: if the user skips, the timer moves on with them.
  if (s.sleep.mode === 'track' && s.track && s.track.id !== s.sleep.trackId) {
    if (Date.now() - trackStartedAt < 1500) {
      // The song just ended into the next one; stop right here.
      void fireSleep()
      return
    }
    set({ sleep: { mode: 'track', trackId: s.track.id } })
  }
  const left = sleepRemaining()
  if (left === null) return
  if (s.paused) return
  const fade = s.sleep.mode === 'track' ? Math.min(SLEEP_FADE_MS, fadeMs() || 6000) : SLEEP_FADE_MS
  if (left < fade) {
    const g = Math.max(0, left / fade)
    if (s.isLocal && sdk) {
      if (Math.abs(g - sleepGain) > 0.02) {
        sleepGain = g
        applyGain()
      }
    } else if (s.activeDevice) {
      // Remote devices: a few coarse steps so we don't flood the API.
      if (sleepRemoteVolume === null) sleepRemoteVolume = s.volume
      const step = Math.ceil(g * 4) / 4
      if (Math.abs(step - sleepGain) > 0.01) {
        sleepGain = step
        void sp.setVolume(sleepRemoteVolume * step * 100, activeId()).catch(() => {})
      }
    }
  }
  if (left <= (s.sleep.mode === 'track' ? 350 : 0)) void fireSleep()
}

async function fireSleep(): Promise<void> {
  sleepFiring = true
  try {
    const s = get()
    if (s.isLocal && sdk) await runSafely(() => sdk!.pause())
    else if (s.activeDevice) await sp.pause(activeId()).catch(() => {})
    set({
      sleep: null,
      paused: true,
      positionMs: livePosition(s),
      sampledAt: Date.now()
    })
    // Put the volume back for next time, after the pause has landed.
    window.setTimeout(restoreSleepVolume, 800)
    toast('Sleep timer: music paused. Good night.')
  } finally {
    sleepFiring = false
  }
}

/* ---------- Controls ---------- */

async function guard(fn: () => Promise<unknown>, fail = 'That did not work. Try again.'): Promise<void> {
  try {
    await fn()
  } catch (e) {
    const msg = errorText(e)
    if (e instanceof sp.ApiError && e.status === 429) toast(e.message, 'error')
    else if (/NO_ACTIVE_DEVICE|No active device/i.test(msg)) toast('No device is playing. Pick one from the devices menu.', 'error')
    else if (/premium/i.test(msg)) toast('This needs Spotify Premium.', 'error')
    else toast(fail, 'error')
    console.error(e)
  }
}

/** Device to target: the active remote device, or this app. */
function targetDevice(): string | undefined {
  const s = get()
  if (s.activeDevice && !s.isLocal) return undefined
  return s.localDeviceId ?? undefined
}

function requireDevice(): boolean {
  const s = get()
  if (!s.activeDevice && !s.localDeviceId) {
    toast(s.sdkError ?? 'The player is still starting. Try again in a moment.', 'error')
    return false
  }
  return true
}

let softTimer = 0
/** Re-reads the player state shortly after a command; several commands in a row share one read. */
const softRefresh = (): void => {
  clearTimeout(softTimer)
  softTimer = window.setTimeout(() => void pollRemote(), 700)
}

/** True when the in-app player really holds the session (a phone may have taken over
 *  without the SDK telling us). Answers within 400 ms. */
async function localIsActive(): Promise<boolean> {
  if (!sdk || !get().isLocal) return false
  const state = await Promise.race([sdk.getCurrentState().catch(() => null), new Promise<'slow'>((r) => setTimeout(() => r('slow'), 400))])
  if (state === 'slow') return true
  if (state) return true
  // Lost the session: find out which device is playing now before sending the command.
  set({ isLocal: false })
  await pollRemote()
  return false
}

/* While you play along at a friend's party, the play, skip and seek buttons steer that party
 * (returns true when it took the command). */
type Steer = (c: PartyControl) => boolean
let steer: Steer | null = null
export function setPartySteer(fn: Steer | null): void {
  steer = fn
}

export async function togglePlay(): Promise<void> {
  if (steer?.({ action: 'toggle' })) return
  const s = get()
  if (s.isLocal && sdk && (await localIsActive())) return void sdk.togglePlay()
  if (!s.activeDevice) {
    if (!s.track || !requireDevice()) return
    return guard(() =>
      sp.play(
        s.contextUri
          ? {
              contextUri: s.contextUri,
              offsetUri: s.track!.uri,
              positionMs: s.positionMs
            }
          : { uris: [s.track!.uri], positionMs: s.positionMs },
        s.localDeviceId ?? undefined
      )
    )
  }
  set({
    paused: !s.paused,
    positionMs: livePosition(s),
    sampledAt: Date.now()
  })
  await guard(() => (s.paused ? sp.resume(activeId()) : sp.pause(activeId())))
  softRefresh()
}

export async function nextTrack(): Promise<void> {
  if (steer?.({ action: 'next' })) return
  const cur = get().track
  // Pulse's own queue (or the DJ's next block) comes next: start it instead of Spotify's next song.
  if (cur && needsHandoff(cur)) {
    handedFor = cur.id
    return dipThen(() => handoff())
  }
  if (get().isLocal && sdk && (await localIsActive())) return dipThen(() => sdk!.nextTrack())
  if (!remoteSkipAllowed()) return
  await guard(() => sp.next(activeId()))
  softRefresh()
}

let lastRemoteSkip = 0
/** On another device every skip is a request: at most one every 0.6 s, extra presses are ignored. */
function remoteSkipAllowed(): boolean {
  if (Date.now() - lastRemoteSkip < 600) return false
  lastRemoteSkip = Date.now()
  return true
}

export async function previousTrack(): Promise<void> {
  if (steer?.({ action: 'previous' })) return
  const s = get()
  // Restart the track when more than 3 s in, like every music app.
  if (livePosition(s) > 3000) return seekTo(0)
  if (s.isLocal && sdk && (await localIsActive())) return dipThen(() => sdk!.previousTrack())
  if (!remoteSkipAllowed()) return
  await guard(() => sp.previous(activeId()))
  softRefresh()
}

export async function seekTo(ms: number): Promise<void> {
  if (steer?.({ action: 'seek', positionMs: ms })) return
  const s = get()
  set({ positionMs: ms, sampledAt: Date.now() })
  if (s.isLocal && sdk) return void sdk.seek(ms)
  await guard(() => sp.seek(ms, activeId()))
}

let volumeTimer: number | null = null
/**
 * How loud the slider position really is. Ears hear loudness on a curve, so a straight line
 * makes the bottom half of the slider far too loud (a friend at "20 %" heard about half volume).
 * Squaring it puts 50 % at a quarter of the power, close to how Spotify's own app feels.
 * Other devices (a phone, a speaker) keep their own scale, so their slider matches.
 */
export const loudness = (v: number): number => v * v

export function setVolume(v: number): void {
  const vol = Math.max(0, Math.min(1, v))
  set({ volume: vol })
  if (get().isLocal && sdk) void sdk.setVolume(loudness(vol) * gain * sleepGain * duckGain)
  if (volumeTimer) clearTimeout(volumeTimer)
  volumeTimer = window.setTimeout(() => {
    if (!get().isLocal && get().activeDevice) void guard(() => sp.setVolume(vol * 100, activeId()), 'This device does not allow volume control.')
    void window.pulse.settings.set({ volume: vol })
  }, 250)
}

/**
 * Sends a shuffle/repeat change. Some Spotify devices reject the explicit device id
 * (404 or 403), so it retries once without it. On failure the button goes back and the
 * toast shows Spotify's own reason.
 */
async function sendToggle(label: string, send: (deviceId?: string) => Promise<void>, revert: () => void): Promise<void> {
  togglesLockedUntil = Date.now() + 3500
  const id = activeId()
  try {
    await send(id)
    return
  } catch (first) {
    console.warn(`[player] ${label} with device id failed`, first)
    if (id) {
      try {
        await send(undefined)
        return
      } catch (second) {
        console.error(`[player] ${label} failed`, second)
        first = second
      }
    }
    togglesLockedUntil = 0
    revert()
    const msg = errorText(first)
    if (/restriction|disallow/i.test(msg)) toast(`Spotify doesn't allow ${label} for what is playing now.`, 'error')
    else if (/NO_ACTIVE_DEVICE|No active device|not found/i.test(msg)) toast('No device is playing. Start playback first.', 'error')
    else toast(`Could not change ${label}: ${msg}`, 'error')
  }
}

export async function toggleShuffle(): Promise<void> {
  const prev = get().shuffle
  const next = !prev
  set({ shuffle: next })
  await sendToggle(
    'shuffle',
    (d) => sp.setShuffle(next, d),
    () => set({ shuffle: prev })
  )
  set((s) => ({ queueVersion: s.queueVersion + 1 }))
}

export async function cycleRepeat(): Promise<void> {
  const order: Repeat[] = ['off', 'context', 'track']
  const prev = get().repeat
  const next = order[(order.indexOf(prev) + 1) % 3]
  set({ repeat: next })
  await sendToggle(
    'repeat',
    (d) => sp.setRepeat(next, d),
    () => set({ repeat: prev })
  )
}

export interface PlayOptions {
  /** Set by the AI DJ for its own songs; anything else counts as the listener taking over. */
  source?: 'dj'
  /** Start this far into the first song. */
  positionMs?: number
}

export async function playContext(contextUri: string, offsetUri?: string, shuffle?: boolean, opts: PlayOptions = {}): Promise<void> {
  if (!requireDevice()) return
  startedByUser(opts)
  sentList = null
  if (shuffle !== undefined && shuffle !== get().shuffle) {
    set({ shuffle })
    togglesLockedUntil = Date.now() + 3500
    await sp.setShuffle(shuffle, targetDevice() ?? activeId()).catch(() => {})
  }
  await guard(() => sp.play({ contextUri, offsetUri, positionMs: opts.positionMs }, targetDevice()), 'Spotify could not start playback.')
  // A device that was idle can ignore shuffle set before anything played on it (then Shuffle
  // played in order): it is set once more now that the music is on.
  if (shuffle !== undefined) {
    togglesLockedUntil = Date.now() + 3500
    window.setTimeout(() => void sp.setShuffle(shuffle, targetDevice() ?? activeId()).catch(() => {}), 400)
  }
  softRefresh()
}

/** Contexts Spotify can start at a chosen song (an artist can't: it answers with an error). */
const takesOffset = (contextUri: string): boolean => /^spotify:(playlist|album):/.test(contextUri) || contextUri.endsWith(':collection')

/**
 * Shuffle play. Spotify starts a shuffled context at its first song, so a random song
 * from `uris` (when the caller knows them) is used as the starting point where Spotify allows
 * one. An artist always starts at the top of its list, so its songs are played as a shuffled
 * list instead (when the caller knows them).
 */
export async function shufflePlay(contextUri: string, uris?: string[]): Promise<void> {
  const list = (uris ?? []).filter(Boolean)
  if (takesOffset(contextUri) || list.length < 2) {
    const start = list.length && takesOffset(contextUri) ? list[Math.floor(Math.random() * list.length)] : undefined
    return playContext(contextUri, start, true)
  }
  const mixed = list.slice()
  for (let i = mixed.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[mixed[i], mixed[j]] = [mixed[j], mixed[i]]
  }
  if (!get().shuffle) {
    set({ shuffle: true })
    togglesLockedUntil = Date.now() + 3500
    void sp.setShuffle(true, targetDevice() ?? activeId()).catch(() => {})
  }
  await playUris(mixed)
}

export async function playUris(uris: string[], offsetUri?: string, opts: PlayOptions = {}): Promise<void> {
  if (!requireDevice()) return
  // Spotify plays at most 100 songs from a list: a longer one starts at the chosen song
  if (uris.length > 100) {
    const at = offsetUri ? Math.max(0, uris.indexOf(offsetUri)) : 0
    uris = uris.slice(at, at + 100)
  }
  startedByUser(opts)
  sentList = uris.slice(0, 100)
  await guard(() => sp.play({ uris: uris.slice(0, 100), offsetUri, positionMs: opts.positionMs }, targetDevice()), 'Spotify could not start playback.')
  softRefresh()
}

export async function transferTo(deviceId: string): Promise<void> {
  const playing = !get().paused
  await guard(() => sp.transferPlayback(deviceId, playing), 'Could not switch to that device.')
  window.setTimeout(() => void pollRemote(), 1000)
}

/* ---------- Queue ----------
 * Spotify's API can add to its queue but never remove, reorder or clear it, and its queue
 * outlives whatever you play next. So Pulse keeps the listener's queue itself (`upNext`) and
 * plays it like Spotify does: queued songs come after the current song, then the playlist or
 * album carries on exactly where it was, in its own order.
 *
 * How: just before the current song ends (or on Next), Pulse starts a short list made of the
 * queued songs plus the song the playlist would have played next. When that song comes up,
 * playback is handed back to the playlist itself at that song, so order, repeat and shuffle
 * keep working. Spotify's own queue is never used. */

interface Resume {
  /** The playlist/album to return to, or null for a plain list of songs. */
  contextUri: string | null
  /** The song it would have played next. */
  uri: string | null
  /** For plain lists: the songs from `uri` on. */
  rest: string[]
  /** Spotify couldn't be asked what follows (then the playlist is started again). */
  unknown?: boolean
}

/** True while Pulse is playing its own list (queued songs + the song to resume at). */
let queueMode = false
let resume: Resume | null = null
/** The queue changed after its list was sent, so it is re-sent at the next song change. */
let dirty = false
/** The song whose ending was already handled (so it happens once). */
let handedFor: string | null = null
/** What Spotify would play after the current song, read shortly before it ends. */
let upcoming: { forId: string; resume: Resume; tracks: STrack[] } | null = null
/** The AI DJ's next block, started when the song `afterId` ends. */
let djNext: { afterId: string; uris: string[] } | null = null
/** The listener dragged the songs coming up from the playlist or album into a new order: after
 *  the song `afterId` Pulse plays them in that order (then the rest of the playlist). */
let ordered: { afterId: string; tracks: STrack[]; uris: string[] } | null = null
/** Remaining time of the current song at the last tick, to tell an ending from a skip. */
let lastLeft: { id: string; left: number } = { id: '', left: 0 }
let handing = false
let flushing = false
let upcomingTriedFor: string | null = null
/** The AI DJ started what's playing (it picks its own next songs). */
let djPlaying = false

/* ---------- Autoplay ----------
 * When nothing would follow the current song (a single song, the end of an album or
 * playlist), Pulse lines up a few songs like it: the same artist and artists like them
 * (Last.fm's "similar artists"), so the music keeps going in the same style. */
let autoplayFor: string | null = null
const recentIds: string[] = []
const AUTOPLAY_BY = 'Autoplay'
/** Start looking for autoplay songs this long before the end (Deezer + several searches take a moment). */
const AUTOPLAY_LEAD_MS = 45_000
/** The plain list of songs Pulse last started without a playlist/album (null: a context, or unknown). */
let sentList: string[] | null = null
/** Songs of a playlist/album, cached for a few minutes (to tell its own songs from Spotify's extras). */
const ctxCache = new Map<string, { at: number; uris: Promise<string[]> }>()

function cachedContextUris(uri: string): Promise<string[]> {
  const hit = ctxCache.get(uri)
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.uris
  const uris = contextUris(uri).catch(() => [] as string[])
  ctxCache.set(uri, { at: Date.now(), uris })
  return uris
}

/**
 * Whether anything would really play after `cur`.
 * Spotify's queue can't be trusted for this on its own: after a single song (or a list of
 * songs) it fills the queue with its own "autoplay" suggestions, which the Web Playback SDK
 * then never plays, so the music just stopped. So Pulse decides from what it knows itself.
 */
async function somethingFollows(cur: PlayerTrack): Promise<boolean> {
  const s = get()
  if (s.repeat !== 'off' && (s.contextUri || (sentList && sentList.length > 1))) return true
  if (!s.contextUri) {
    // A list Pulse started: only the rest of that list follows.
    if (sentList) {
      const i = sentList.indexOf(cur.uri)
      return i >= 0 && i < sentList.length - 1
    }
    // Started somewhere else (a phone, the Spotify app): Spotify knows best there.
    return (await sp.getQueue()).queue.length > 0
  }
  const [q, ctx] = await Promise.all([sp.getQueue(), cachedContextUris(s.contextUri)])
  // Playlists and albums: only their own songs count, not Spotify's suggestions after them.
  if (ctx.length) {
    const own = new Set(ctx)
    return q.queue.some((t) => own.has(t.uri))
  }
  // Artists, Liked Songs and other contexts: trust Spotify.
  return q.queue.length > 0
}

async function autoplayPicks(cur: PlayerTrack): Promise<STrack[]> {
  const main = cur.artists[0]
  if (!main?.name) return []
  const similar = (await window.pulse.recs.related(main.name).catch(() => [] as string[])).slice(0, 8)
  // a few similar artists, in random order, plus the artist playing now and anyone featured on this song
  const pick = similar.sort(() => Math.random() - 0.5).slice(0, 5)
  const featured = cur.artists.slice(1).map((a) => a.name)
  const artists = [pick[0], main.name, pick[1], featured[0], pick[2], main.name, pick[3], featured[1], pick[4]].filter((x): x is string => !!x)
  const uniq = [...new Set(artists)]
  const results = await Promise.all(
    uniq.map((name) =>
      sp
        .searchTracks(`artist:"${name}"`, 0)
        .then((r) => ({
          name,
          items: (r.tracks?.items ?? []).filter((t) => t?.id && t.artists?.[0]?.name.toLowerCase() === name.toLowerCase())
        }))
        .catch(() => ({ name, items: [] as STrack[] }))
    )
  )
  const pool = new Map(results.map((r) => [r.name, r.items]))
  const used = new Set([cur.id, ...recentIds, ...get().upNext.map((q) => q.id)])
  const names = new Set<string>()
  const out: STrack[] = []
  for (const name of artists) {
    const items = pool.get(name) ?? []
    // popular songs first, but not always the top one
    const t = items
      .slice(0, 8)
      .filter((x) => !used.has(x.id) && !names.has(x.name.toLowerCase()))
      .sort(() => Math.random() - 0.5)[0]
    if (!t) continue
    used.add(t.id)
    names.add(t.name.toLowerCase())
    out.push(t)
  }
  // Nothing similar found (an artist Deezer doesn't know): fall back to the artist's genre.
  if (out.length < 3 && main.id) out.push(...(await genrePicks(main.id, used, names)))
  return out
}

/** A few songs from the same genre as the artist (when Spotify still reports one). */
async function genrePicks(artistId: string, used: Set<string>, names: Set<string>): Promise<STrack[]> {
  try {
    const genre = ((await sp.getArtist(artistId)) as { genres?: string[] }).genres?.[0]
    if (!genre) return []
    const r = await sp.searchTracks(`genre:"${genre}"`, 0)
    const items = (r.tracks?.items ?? []).filter((t) => t?.id && !used.has(t.id) && !names.has(t.name.toLowerCase()))
    return items.sort(() => Math.random() - 0.5).slice(0, 4)
  } catch {
    return []
  }
}

/** Called near the end of each song: lines up similar songs when nothing would follow. */
async function maybeAutoplay(cur: PlayerTrack): Promise<void> {
  autoplayFor = cur.id
  const s = get()
  if (useApp.getState().settings.autoplay === false || djPlaying || djNext || s.upNext.length || s.repeat === 'track') return
  if (queueMode && resume?.uri) return
  try {
    if ((await somethingFollows(cur)) || get().track?.id !== cur.id || get().upNext.length) return
    const picks = await autoplayPicks(cur)
    if (!picks.length || get().track?.id !== cur.id || get().upNext.length) return
    console.info('[autoplay] nothing next, adding', picks.map((t) => `${t.artists[0]?.name} – ${t.name}`).join('; '))
    addToQueue(picks, undefined, { addedBy: AUTOPLAY_BY, quiet: true })
  } catch (e) {
    console.warn('[autoplay] skipped:', e instanceof Error ? e.message : e)
  }
}

const userPlayListeners = new Set<() => void>()
/** Called when the listener starts something themselves (the DJ stops then). */
export function onUserPlay(cb: () => void): () => void {
  userPlayListeners.add(cb)
  return () => userPlayListeners.delete(cb)
}

function startedByUser(opts: PlayOptions): void {
  djPlaying = opts.source === 'dj'
  autoplayFor = null
  queueMode = false
  resume = null
  dirty = false
  handedFor = null
  upcoming = null
  ordered = null
  if (opts.source !== 'dj') {
    djNext = null
    userPlayListeners.forEach((cb) => cb())
  }
}

/** Hands the DJ its prepared next block (and forgets it), e.g. when Spotify wandered off. */
export function takeDjContinuation(): string[] | null {
  const uris = djNext?.uris ?? null
  djNext = null
  return uris
}

/** The DJ's next block of songs, played when the song `afterId` ends (null clears it). */
export function setDjContinuation(afterId: string | null, uris: string[] = []): void {
  djNext = afterId && uris.length ? { afterId, uris } : null
}

const toItem = (
  t: {
    id: string
    uri: string
    name: string
    artists: { name: string }[]
    album?: { images?: { url: string; width: number | null }[] }
  },
  addedBy?: string
): QueueItem => ({
  addedBy,
  uid: `${t.id}-${Math.random().toString(36).slice(2, 8)}`,
  id: t.id,
  uri: t.uri,
  name: t.name,
  artists: t.artists.map((a) => a.name).join(', '),
  image: sp.pickImage(t.album?.images, 64)
})

/** Whether the end of `cur` (or Next) must be handled by Pulse instead of Spotify. */
function needsHandoff(cur: PlayerTrack): boolean {
  const s = get()
  if (!queueMode) return s.upNext.length > 0 || djNext?.afterId === cur.id || ordered?.afterId === cur.id
  // In Pulse's list: re-send it if it changed, and return to the playlist after the last queued song.
  return dirty || (s.upNext.length === 0 && !!resume && cur.uri !== resume.uri)
}

/** What the playlist/album would play after the current song. */
async function readUpcoming(cur: PlayerTrack): Promise<Resume | null> {
  if (upcoming?.forId === cur.id) return upcoming.resume
  const s = get()
  try {
    const q = await sp.getQueue()
    const list = q.queue.filter((t) => t && t.uri)
    const r: Resume = {
      contextUri: s.contextUri,
      uri: list[0]?.uri ?? null,
      rest: list.map((t) => t.uri)
    }
    upcoming = { forId: cur.id, resume: r, tracks: list }
    return r
  } catch {
    return s.contextUri ? { contextUri: s.contextUri, uri: null, rest: [], unknown: true } : null
  }
}

/** Starts what comes after the current song: queued songs first, then the rest. */
async function handoff(): Promise<void> {
  const cur = get().track
  if (!cur || handing) return
  handing = true
  try {
    const queued = get().upNext
    let then: Resume | null
    if (queueMode) then = resume
    else if (djNext?.afterId === cur.id) {
      then = { contextUri: null, uri: djNext.uris[0], rest: djNext.uris }
      djNext = null
    } else if (ordered?.afterId === cur.id) {
      then = { contextUri: null, uri: ordered.uris[0], rest: ordered.uris }
      ordered = null
    } else then = await readUpcoming(cur)

    if (queued.length === 0) {
      queueMode = false
      resume = null
      dirty = false
      if (then) await returnTo(then)
      return
    }
    const uris = [...queued.map((q) => q.uri), ...(then?.uri ? [then.uri] : [])]
    queueMode = true
    resume = then
    dirty = false
    await sp.play({ uris }, targetDevice())
    softRefresh()
  } catch (e) {
    console.error('[queue] handoff failed', e)
    toast('Could not play the next song in your queue.', 'error')
  } finally {
    handing = false
  }
}

/** Goes back to the playlist/album (or song list) at the song it would have played. */
async function returnTo(r: Resume, positionMs = 0): Promise<void> {
  sentList = r.contextUri ? null : r.rest.slice(0, 100)
  if (r.contextUri && r.uri) await sp.play({ contextUri: r.contextUri, offsetUri: r.uri, positionMs }, targetDevice())
  // nothing followed (the end of an album): don't start it over
  else if (r.contextUri && r.unknown) await sp.play({ contextUri: r.contextUri }, targetDevice())
  else if (r.rest.length) await sp.play({ uris: r.rest.slice(0, 100), offsetUri: r.uri ?? undefined, positionMs }, targetDevice())
  softRefresh()
}

function queueTick(): void {
  const s = get()
  const t = s.track
  if (!t || flushing) return
  if (s.paused) {
    // The song ran out and Spotify stopped before Pulse could start what comes next
    // (e.g. autoplay found its songs a moment too late): start it now.
    if (lastLeft.id === t.id && lastLeft.left < 2500 && handedFor !== t.id && !handing && needsHandoff(t)) {
      handedFor = t.id
      void handoff()
    }
    return
  }
  const left = t.durationMs - livePosition(s)
  lastLeft = { id: t.id, left }
  if (left < AUTOPLAY_LEAD_MS && left > 2000 && autoplayFor !== t.id && !handing) void maybeAutoplay(t)
  if (s.repeat === 'track' || !needsHandoff(t)) return
  // Read what the playlist plays next while there is still time.
  // (once per song: a failed read must not be retried every tick)
  if (
    !queueMode &&
    left < 20_000 &&
    upcoming?.forId !== t.id &&
    upcomingTriedFor !== t.id &&
    !handing &&
    !(djNext?.afterId === t.id) &&
    !(ordered?.afterId === t.id)
  ) {
    upcomingTriedFor = t.id
    void readUpcoming(t)
  }
  const lead = s.isLocal ? 450 : 1100
  if (left > lead || handedFor === t.id) return
  handedFor = t.id
  void handoff()
}

/** Keeps the queue in step with what is playing. */
function queueOnTrack(prevId: string | null, t: PlayerTrack | null): void {
  if (!t || flushing) return
  const s = get()
  if (queueMode) {
    if (s.upNext[0]?.id === t.id) {
      set({ upNext: s.upNext.slice(1) })
      return
    }
    if (resume && resume.uri === t.uri) {
      // The last queued song ended before Pulse could switch back: hand over now.
      const r = resume
      queueMode = false
      resume = null
      void returnTo(r, Math.round(livePosition(s))).catch(() => {})
      return
    }
    // Something else is playing (the listener chose a song): leave queue mode.
    queueMode = false
    resume = null
    dirty = false
    return
  }
  // The song ended before Pulse could start the queue: start it now, then come back here.
  if (s.upNext.length && prevId && prevId === lastLeft.id && lastLeft.left < 2500 && handedFor !== prevId) {
    handedFor = t.id
    upcoming = {
      forId: t.id,
      resume: { contextUri: s.contextUri, uri: t.uri, rest: [] },
      tracks: []
    }
    void (async () => {
      const queued = get().upNext
      queueMode = true
      resume = upcoming!.resume
      await sp.play({ uris: [...queued.map((q) => q.uri), t.uri] }, targetDevice()).catch(() => {})
    })()
  }
}

type QueueTrack = Parameters<typeof toItem>[0]

export function addToQueue(t: QueueTrack | QueueTrack[], label?: string, opts: { addedBy?: string; quiet?: boolean } = {}): void {
  if (!get().activeDevice && !get().track) {
    toast('Start playing something first, then add to the queue.', 'error')
    return
  }
  const list = (Array.isArray(t) ? t : [t]).filter((x) => x?.uri && !x.uri.startsWith('spotify:local'))
  if (!list.length) return
  set((s) => ({
    upNext: [...s.upNext, ...list.map((x) => toItem(x, opts.addedBy))],
    nextUp: null
  }))
  if (queueMode) dirty = true
  nextFetchedFor = null
  if (opts.quiet) return
  toast(list.length > 1 ? `Added ${list.length} songs to the queue` : `Added “${label ?? list[0].name}” to the queue`)
}

export function removeFromQueue(uid: string): void {
  set((s) => ({ upNext: s.upNext.filter((q) => q.uid !== uid), nextUp: null }))
  nextFetchedFor = null
  if (queueMode) dirty = true
}

export function moveInQueue(from: number, to: number): void {
  set((s) => {
    const list = s.upNext.slice()
    const [it] = list.splice(from, 1)
    list.splice(to, 0, it)
    return { upNext: list, nextUp: null }
  })
  nextFetchedFor = null
  if (queueMode) dirty = true
}

/** Upcoming songs from the playlist or album the listener took out in the queue's edit mode.
 *  Spotify still has them in its list, so they're skipped the moment they start. */
export const useSkipped = create<{ ids: string[] }>(() => ({ ids: [] }))
export function skipUpcoming(id: string): void {
  useSkipped.setState((s) => ({ ids: [...s.ids, id] }))
}
usePlayer.subscribe((s, p) => {
  const id = s.track?.id
  if (!id || id === p.track?.id) return
  const ids = useSkipped.getState().ids
  if (!ids.includes(id)) return
  useSkipped.setState({ ids: ids.filter((x) => x !== id) })
  void nextTrack()
})

/** Jumps to a song in "Next in queue": it plays now, the queued songs after it follow, then
 *  `after` (what the playlist or album had coming). Songs queued before it are dropped. */
export async function playFromQueue(uid: string, after: string[] = []): Promise<void> {
  const list = get().upNext
  const i = list.findIndex((q) => q.uid === uid)
  if (i < 0) return
  const uris = [...list.slice(i).map((q) => q.uri), ...after]
  set({ upNext: [], nextUp: null })
  nextFetchedFor = null
  await playUris(uris)
}

/** Moves a queued song to the front of "Next in queue". */
export function playNextInQueue(uid: string): void {
  const i = get().upNext.findIndex((q) => q.uid === uid)
  if (i > 0) moveInQueue(i, 0)
}

/** What the playlist/album plays after the queue (for the queue panel). */
export function upcomingFromContext(): STrack[] | null {
  const cur = get().track?.id
  if (!queueMode) return ordered && ordered.afterId === cur ? ordered.tracks : null
  return upcoming?.tracks ?? []
}

/** Drag in "Next from": the songs coming up from the playlist or album play in the new order
 *  (`list` is what the queue panel shows). After them the playlist or album carries on from
 *  where the last of them was (unless shuffle is on: Spotify's shuffled order isn't known). */
export async function reorderUpcoming(list: STrack[], from: number, to: number): Promise<void> {
  const cur = get().track
  if (!cur || from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return
  const next = list.slice()
  const [it] = next.splice(from, 1)
  next.splice(to, 0, it)
  const uris = next.map((t) => t.uri)
  if (queueMode) {
    // in Pulse's own list: what follows the queued songs changes
    const ctx = resume?.contextUri ?? null
    resume = { contextUri: null, uri: uris[0], rest: uris }
    dirty = true
    if (upcoming) upcoming = { ...upcoming, tracks: next }
    set((s) => ({ queueVersion: s.queueVersion + 1, nextUp: null }))
    if (ctx && !get().shuffle) {
      const more = await tail(ctx, list)
      if (resume?.uri === uris[0]) resume.rest = [...uris, ...more].slice(0, 100)
    }
    return
  }
  const ctx = get().contextUri
  const mine = { afterId: cur.id, tracks: next, uris }
  ordered = mine
  set((s) => ({ queueVersion: s.queueVersion + 1, nextUp: null }))
  if (ctx && !get().shuffle) {
    const more = await tail(ctx, list)
    if (ordered === mine) mine.uris = [...uris, ...more].slice(0, 100)
  }
}

/** The songs of a playlist or album after the last of `shown` (in the playlist's own order). */
async function tail(contextUri: string, shown: STrack[]): Promise<string[]> {
  const all = await cachedContextUris(contextUri)
  if (!all.length) return []
  const have = new Set(shown.map((t) => t.uri))
  let last = -1
  all.forEach((u, i) => {
    if (have.has(u)) last = i
  })
  return last < 0 ? [] : all.slice(last + 1).filter((u) => !have.has(u))
}

/** Empties the queue. Songs an older version (or another app) left in Spotify's own queue
 *  are skipped through quietly too, so the playlist really continues next. */
export async function clearQueue(): Promise<void> {
  const had = get().upNext.length
  set({ upNext: [], nextUp: null })
  nextFetchedFor = null
  if (queueMode) dirty = true
  const flushed = await flushSpotifyQueue().catch((e) => {
    console.warn('[queue] flush failed', e)
    return 0
  })
  toast(had || flushed ? 'Queue cleared' : 'The queue is already empty')
}

async function contextUris(uri: string): Promise<string[]> {
  const [, kind, id] = uri.split(':')
  if (kind === 'playlist') return (await sp.getPlaylistItems(id)).map((t) => t.uri)
  if (kind === 'album') return (await sp.getAlbumTracks(id)).map((t) => t.uri)
  return []
}

/** Counts the songs at the front of Spotify's queue that don't belong to the playlist/album
 *  (left there by "add to queue" elsewhere) and skips through them with the sound off. */
async function flushSpotifyQueue(): Promise<number> {
  const s = get()
  if (queueMode || !s.track || !s.contextUri) return 0
  const [q, ctx] = await Promise.all([sp.getQueue(), contextUris(s.contextUri)])
  if (!ctx.length) return 0
  const queue = q.queue.filter((t) => t?.uri)
  let n = 0
  if (!s.shuffle) {
    const i = ctx.indexOf(s.track.uri)
    const expected = i >= 0 ? (ctx[i + 1] ?? (s.repeat === 'context' ? ctx[0] : undefined)) : undefined
    const k = expected ? queue.findIndex((t) => t.uri === expected) : -1
    n = k > 0 ? k : 0
  } else {
    const inCtx = new Set(ctx)
    while (n < queue.length && !inCtx.has(queue[n].uri)) n++
  }
  if (n === 0) return 0
  n = Math.min(n, 30)
  toast('Clearing the queue…')
  const back = {
    uri: s.track.uri,
    ctx: s.contextUri,
    pos: Math.round(livePosition(s)),
    vol: s.volume,
    local: s.isLocal && !!sdk
  }
  flushing = true
  try {
    if (back.local) await sdk!.setVolume(0).catch(() => {})
    else await sp.setVolume(0, activeId()).catch(() => {})
    for (let i = 0; i < n; i++) {
      await sp.next(activeId())
      await new Promise((r) => setTimeout(r, 220))
    }
    await sp.play({ contextUri: back.ctx, offsetUri: back.uri, positionMs: back.pos }, targetDevice())
    await new Promise((r) => setTimeout(r, 450))
  } finally {
    flushing = false
    lastTrackId = null
    if (back.local) applyGain()
    else await sp.setVolume(back.vol * 100, activeId()).catch(() => {})
    softRefresh()
  }
  return n
}

export async function toggleLike(): Promise<void> {
  const t = get().track
  if (!t) return
  const liked = !get().liked
  set({ liked })
  try {
    if (liked) await sp.saveToLibrary([t.uri])
    else await sp.removeFromLibrary([t.uri])
    useApp.getState().bumpLiked()
    toast(liked ? 'Added to Liked Songs' : 'Removed from Liked Songs')
  } catch (e) {
    // it didn't happen: put the heart back
    if (get().track?.id === t.id) set({ liked: !liked })
    await guard(() => Promise.reject(e))
  }
}

export function handleCommand(c: PlayerCommand): void {
  switch (c.type) {
    case 'toggle':
      void togglePlay()
      break
    case 'next':
      void nextTrack()
      break
    case 'previous':
      void previousTrack()
      break
    case 'seek':
      void seekTo(c.positionMs)
      break
    case 'like':
      void toggleLike()
      break
    case 'volume':
      setVolume(Math.min(1, Math.max(0, Math.round((get().volume + c.delta) * 20) / 20)))
      break
  }
}

/* ---------- Publishing to mini player, tray, Discord and Windows ---------- */

let presenceMode: 'dj' | null = null

/** Tells Discord and the tray that the AI DJ is (or no longer is) running the show. */
export function setPresenceMode(mode: 'dj' | null): void {
  if (mode === presenceMode) return
  presenceMode = mode
  window.pulse?.playback.publish(snapshot())
}

function snapshot(): PlaybackSnapshot {
  const s = get()
  return {
    hasTrack: !!s.track,
    trackId: s.track?.id ?? null,
    uri: s.track?.uri ?? null,
    title: s.track?.name ?? '',
    artists: s.track?.artists.map((a) => a.name).join(', ') ?? '',
    artistId: s.track?.artists[0]?.id ?? null,
    mode: presenceMode,
    album: s.track?.album.name ?? '',
    artUrl: s.track?.artUrl ?? null,
    durationMs: s.track?.durationMs ?? 0,
    positionMs: s.positionMs,
    sampledAt: s.sampledAt,
    paused: s.paused,
    liked: s.liked,
    userId: useApp.getState().me?.id ?? null,
    userName: useApp.getState().me?.display_name ?? null,
    accent: getComputedStyle(document.documentElement).getPropertyValue('--accent-dark').trim() || null
  }
}

export function startPublishing(): () => void {
  const ms = navigator.mediaSession
  const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
    ['play', () => void togglePlay()],
    ['pause', () => void togglePlay()],
    ['nexttrack', () => void nextTrack()],
    ['previoustrack', () => void previousTrack()],
    ['seekto', (d) => d.seekTime != null && void seekTo(d.seekTime * 1000)]
  ]
  for (const [a, h] of handlers) {
    try {
      ms.setActionHandler(a, h)
    } catch {
      /* unsupported action */
    }
  }

  let lastMetaId: string | null = null
  const publish = (): void => {
    const snap = snapshot()
    window.pulse.playback.publish(snap)
    const s = get()
    if (s.track && s.track.id !== lastMetaId) {
      lastMetaId = s.track.id
      ms.metadata = new MediaMetadata({
        title: s.track.name,
        artist: snap.artists,
        album: s.track.album.name,
        artwork: s.track.artUrl ? [{ src: s.track.artUrl, sizes: '640x640', type: 'image/jpeg' }] : []
      })
    }
    ms.playbackState = s.track ? (s.paused ? 'paused' : 'playing') : 'none'
    if (s.track) {
      try {
        ms.setPositionState({
          duration: s.track.durationMs / 1000,
          position: Math.min(s.track.durationMs, livePosition(s)) / 1000,
          playbackRate: 1
        })
      } catch {
        /* invalid position while loading */
      }
    }
  }

  const unsub = usePlayer.subscribe((s, p) => {
    if (
      s.track?.id !== p.track?.id ||
      s.paused !== p.paused ||
      s.liked !== p.liked ||
      Math.abs(s.positionMs - p.positionMs) > 1500 ||
      s.sampledAt !== p.sampledAt
    ) {
      publish()
    }
  })
  const offCmd = window.pulse.playback.onCommand(handleCommand)
  return () => {
    unsub()
    offCmd()
  }
}
