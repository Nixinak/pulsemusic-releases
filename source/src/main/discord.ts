// Discord Rich Presence: "Listening to <song>". Shows the song with its cover in full size,
// a live progress bar, links the title to Spotify and the artist to their page, and puts a
// round badge on the cover that changes with what Pulse is doing: playing, paused, liked,
// the AI DJ on air or a party running. The badge opens the Pulse Music page.
import { app } from 'electron'
import { Client } from '@xhayper/discord-rpc'
import type { PlaybackSnapshot } from '@shared/types'
import { DISCORD_CLIENT_ID } from './config'
import { partySummary } from './party'

let client: Client | null = null
let ready = false
let enabled = false
let retryTimer: NodeJS.Timeout | null = null
let last: PlaybackSnapshot | null = null
let lastKey = ''
let pushTimer: NodeJS.Timeout | null = null
/** What the last attempt did, for Settings and the log. */
let lastError: string | null = null
let shown = false

export interface DiscordStatus {
  state: 'off' | 'connecting' | 'connected' | 'not-running'
  /** the status is on your profile right now */
  shown: boolean
  error: string | null
}
export function discordStatus(): DiscordStatus {
  return {
    state: !enabled ? 'off' : ready ? 'connected' : client ? 'connecting' : 'not-running',
    shown,
    error: lastError
  }
}

const LISTENING = 2 // ActivityType.Listening

async function connect(): Promise<void> {
  if (!enabled || client) return
  const c = new Client({ clientId: DISCORD_CLIENT_ID, transport: { type: 'ipc' } })
  client = c
  c.on('ready', () => {
    ready = true
    lastError = null
    console.info('[discord] connected as', c.user?.username ?? '?')
    lastKey = ''
    if (last) schedulePush()
  })
  c.on('disconnected', () => {
    console.info('[discord] disconnected')
    shown = false
    ready = false
    client = null
    scheduleRetry()
  })
  try {
    await c.login()
  } catch (e) {
    // Discord is not running; try again later.
    const msg = e instanceof Error ? e.message : String(e)
    if (msg !== lastError) console.info('[discord] could not connect:', msg)
    lastError = msg
    ready = false
    client = null
    scheduleRetry()
  }
}

function scheduleRetry(): void {
  if (!enabled || retryTimer) return
  retryTimer = setTimeout(() => {
    retryTimer = null
    void connect()
  }, 15_000)
}

const clip = (s: string, max = 128): string => (s.length > max ? s.slice(0, max - 1) + '…' : s)

/** Where people land when they click the badge or the "Get Pulse Music" button. */
const PULSE_URL = 'https://nixinak.github.io/pulsemusic-releases/'
const ASSETS = 'https://raw.githubusercontent.com/Nixinak/pulsemusic-releases/main/assets'
const PULSE_LOGO = `${ASSETS}/icon.png`
/** Round badges drawn for Discord (it crops the small image to a circle). */
const BADGE = {
  playing: `${ASSETS}/discord/playing.png`,
  paused: `${ASSETS}/discord/paused.png`,
  liked: `${ASSETS}/discord/liked.png`,
  dj: `${ASSETS}/discord/dj.png`,
  party: `${ASSETS}/discord/party.png`
} as const

/** Paused this long and the status goes away, like Spotify's own. */
const PAUSED_HIDE_MS = 10 * 60_000
let pausedSince = 0
let hideTimer: NodeJS.Timeout | null = null

/** Spotify serves covers at 64, 300 and 640 px from the same id; ask for the sharp one. */
function hdCover(url: string | null): string | null {
  if (!url) return null
  return url.replace(/(i\.scdn\.co\/image\/ab67616d0000)(1e02|4851)/, '$1b273')
}

/** Discord rejects texts shorter than 2 characters (a song called "7" would fail). */
const atLeast2 = (s: string): string => (s.length >= 2 ? s : `${s}\u2800`.padEnd(2, '\u2800'))

let showGetButton = true

/** The round badge on the cover and its tooltip say what Pulse is doing right now. */
function badge(s: PlaybackSnapshot): { image: string; text: string } {
  const party = partySummary()
  const version = `Pulse Music ${app.getVersion()}`
  if (s.paused) return { image: BADGE.paused, text: `Paused · ${version}` }
  if (party.on)
    return {
      image: BADGE.party,
      text: party.guests > 1 ? `Party mode · ${party.guests} friends adding songs` : 'Party mode · friends add the songs'
    }
  if (s.mode === 'dj') return { image: BADGE.dj, text: 'On air with the Pulse AI DJ' }
  if (s.liked) return { image: BADGE.liked, text: `In my Liked Songs · ${version}` }
  return { image: BADGE.playing, text: version }
}

function push(): void {
  if (!client || !ready || !enabled) return
  const s = last
  const hideForPause = !!s?.paused && pausedSince > 0 && Date.now() - pausedSince >= PAUSED_HIDE_MS
  if (!s || !s.hasTrack || hideForPause) {
    void client.user?.clearActivity().catch(() => {})
    shown = false
    return
  }
  const startTimestamp = s.sampledAt - s.positionMs
  const trackUrl = s.trackId ? `https://open.spotify.com/track/${s.trackId}` : undefined
  const artistUrl = s.artistId ? `https://open.spotify.com/artist/${s.artistId}` : undefined
  // Discord shows at most two buttons. Others see them; your own profile doesn't.
  const buttons = [
    ...(trackUrl ? [{ label: 'Listen on Spotify', url: trackUrl }] : []),
    ...(showGetButton ? [{ label: 'Get Pulse Music', url: PULSE_URL }] : [])
  ]
  const prefix = s.paused ? 'Paused · ' : s.mode === 'dj' ? 'DJ · ' : ''
  const b = badge(s)
  const cover = hdCover(s.artUrl)

  void client.user
    ?.setActivity({
      type: LISTENING,
      details: atLeast2(clip(s.title)),
      detailsUrl: trackUrl,
      state: atLeast2(clip(`${prefix}${s.artists}`)),
      stateUrl: artistUrl,
      largeImageKey: cover ?? PULSE_LOGO,
      largeImageText: atLeast2(clip(s.album ? `💿 ${s.album}` : s.title)),
      largeImageUrl: trackUrl,
      smallImageKey: b.image,
      smallImageText: atLeast2(clip(b.text)),
      smallImageUrl: PULSE_URL,
      ...(s.paused ? {} : { startTimestamp, endTimestamp: startTimestamp + s.durationMs }),
      statusDisplayType: 2,
      buttons: buttons.length ? buttons : undefined
    })
    .then(() => {
      shown = true
      lastError = null
    })
    .catch((e) => {
      shown = false
      lastError = e instanceof Error ? e.message : String(e)
      console.warn('[discord] Discord refused the status:', lastError)
    })
}

/** Discord rate-limits presence updates; coalesce bursts. */
function schedulePush(): void {
  if (pushTimer) return
  pushTimer = setTimeout(() => {
    pushTimer = null
    push()
  }, 1500)
}

function trackPause(s: PlaybackSnapshot): void {
  if (!s.paused) {
    pausedSince = 0
    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = null
    return
  }
  if (pausedSince) return
  pausedSince = Date.now()
  if (hideTimer) clearTimeout(hideTimer)
  // Re-check once the pause has lasted long enough, so the status is taken down.
  hideTimer = setTimeout(() => {
    hideTimer = null
    lastKey = ''
    schedulePush()
  }, PAUSED_HIDE_MS + 500)
}

export function updatePresence(s: PlaybackSnapshot): void {
  last = s
  trackPause(s)
  // Only push on meaningful changes: track, pause state, a seek, liked, DJ or party.
  const start = Math.round((s.sampledAt - s.positionMs) / 3000)
  const party = partySummary()
  const key = `${s.trackId}|${s.paused}|${s.paused ? '' : start}|${s.liked}|${s.mode ?? ''}|${party.on}|${party.guests}`
  if (key === lastKey) return
  lastKey = key
  schedulePush()
}

/** Re-sends the status, e.g. when a party starts or a friend adds a song. */
export function refreshPresence(): void {
  if (!last) return
  lastKey = ''
  updatePresence(last)
}

/** Turns the "Get Pulse Music" button on or off. */
export function setDiscordGetButton(on: boolean): void {
  if (on === showGetButton) return
  showGetButton = on
  lastKey = ''
  schedulePush()
}

export function setDiscordEnabled(on: boolean): void {
  enabled = on
  if (on) {
    void connect()
  } else {
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = null
    const c = client
    client = null
    ready = false
    if (c) {
      void c.user?.clearActivity().catch(() => {})
      void c.destroy().catch(() => {})
    }
  }
}
