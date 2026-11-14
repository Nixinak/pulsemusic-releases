// Discord Rich Presence: "Listening to Pulse Music". Shows the song with its cover, links
// the title to Spotify and the artist to their page, and puts the Pulse logo on the cover:
// it says whether the AI DJ or a party is running and opens the Pulse Music GitHub page.
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

/** Where people land when they click the Pulse logo or the "Get Pulse Music" button. */
const PULSE_URL = 'https://github.com/Nixinak/pulsemusic-releases'
const PULSE_LOGO = 'https://raw.githubusercontent.com/Nixinak/pulsemusic-releases/main/assets/icon.png'

let showGetButton = true

/** The small badge on the cover says what Pulse is doing right now. */
function badgeText(s: PlaybackSnapshot): string {
  const party = partySummary()
  if (party.on) return party.guests > 1 ? `Party mode · ${party.guests} friends adding songs` : 'Party mode · friends add the songs'
  if (s.mode === 'dj') return 'On air with the Pulse AI DJ'
  return `Pulse Music ${app.getVersion()}`
}

function push(): void {
  if (!client || !ready || !enabled) return
  const s = last
  if (!s || !s.hasTrack) {
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

  void client.user
    ?.setActivity({
      type: LISTENING,
      details: clip(s.title),
      detailsUrl: trackUrl,
      state: clip(`${prefix}${s.artists}`),
      stateUrl: artistUrl,
      largeImageKey: s.artUrl ?? PULSE_LOGO,
      largeImageText: clip(s.album || s.title),
      largeImageUrl: trackUrl,
      smallImageKey: PULSE_LOGO,
      smallImageText: clip(badgeText(s)),
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

export function updatePresence(s: PlaybackSnapshot): void {
  last = s
  // Only push on meaningful changes: track, pause state, or a seek.
  const start = Math.round((s.sampledAt - s.positionMs) / 3000)
  const party = partySummary()
  const key = `${s.trackId}|${s.paused}|${s.paused ? '' : start}|${s.mode ?? ''}|${party.on}|${party.guests}`
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
