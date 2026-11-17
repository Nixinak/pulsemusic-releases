import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  components,
  desktopCapturer,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  screen,
  session,
  shell,
  Tray,
  webContents,
  globalShortcut
} from 'electron'
import { join, resolve } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { rmSync } from 'node:fs'
import { EMPTY_SNAPSHOT, GLOBAL_KEYS, type GlobalAction, type PlaybackSnapshot, type PlayerCommand, type Settings } from '@shared/types'
import trayIconPath from '../../resources/tray.png?asset'
import appIconPath from '../../build/icon.png?asset'
import { getAccessToken, grantedScopes, isLoggedIn, loadTokens, login, logout, customClientId, setCustomClientId } from './auth'
import { isStoreName, readStore, writeStore } from './datastore'
import { djChat } from './dj'
import {
  friendAction,
  nowOf,
  followsOf,
  getListeners,
  getSpotifyFollows,
  shareNow,
  savedSpotifyUser,
  userFromHtml,
  getEmbedPlaylist,
  getFriends,
  getPulseProfile,
  getSpotifyUser,
  lookupPulse,
  publishPulse,
  pulseServerOn,
  searchPulse,
  searchSpotifyUsers
} from './social'
import { cleanOldVoices, installVoice, speak, voiceStatus } from './voice'
import { discordStatus, refreshPresence, setDiscordEnabled, setDiscordGetButton, updatePresence } from './discord'
import { fetchGenius, fetchLrclib, fetchLyricsOvh } from './lyrics'
import { getArtistInfo } from './artistInfo'
import { ensureEngine, localReady, setupLocal, stopEngine } from './aiSetup'
import { getArtistPage, getArtistQuick } from './spotifyPage'
import {
  connectSpotifyAccount,
  disconnectSpotifyAccount,
  spotifyAccountStatus,
  spotifyAnalysis,
  spotifyCanvas,
  spotifyFriends,
  spotifyLyrics
} from './spotifyAccount'
import { relatedArtists, songPreview } from './recs'
import { connectLastfm, disconnectLastfm, lastfmNowPlaying, lastfmScrobble, lastfmStatus, setLastfmEnabled, startLastfm } from './lastfm'
import { checkForUpdatesNow, initUpdates, installUpdateNow, setAutoUpdates, updateStatus } from './updater'
import { prepareTunnel } from './tunnel'
import { partyInfo, setPartyNowPlaying, setPartyQueue, startParty, stopParty, partyVote } from './party'
import { getSettings, loadSettings, updateSettings } from './settings'
import { loadProfile, saveProfile } from './profile'
import type { Profile } from '@shared/types'

let mainWindow: BrowserWindow | null = null
let miniWindow: BrowserWindow | null = null
let tray: Tray | null = null
/** Quitting for real (Quit in the tray, an update, Windows shutting down). */
let quitting = false
let toldAboutTray = false
/** Opened by Windows at sign-in: start in the tray without showing the window. */
const startedHidden = process.argv.includes('--hidden')
let snapshot: PlaybackSnapshot = EMPTY_SNAPSHOT

const isDev = !app.isPackaged && !!process.env['ELECTRON_RENDERER_URL']

// Look like regular Chrome so Spotify's player does not reject the browser.
app.userAgentFallback = app.userAgentFallback.replace(/\sElectron\/\S+/, '').replace(new RegExp(`\\s${app.getName()}/\\S+`, 'i'), '')

// Smoother rendering: GPU rasterisation even on GPUs Chromium is unsure about. Settings →
// Performance can turn the GPU off for drivers that draw black or flickering windows (read here,
// before the app starts, because it can only be decided then).
if (loadSettings().hardwareAcceleration === false) {
  app.disableHardwareAcceleration()
} else {
  app.commandLine.appendSwitch('enable-gpu-rasterization')
  app.commandLine.appendSwitch('enable-zero-copy')
  app.commandLine.appendSwitch('ignore-gpu-blocklist')
}
// Animated mouse-wheel scrolling, done by the compositor (smooth even while the page is busy).
app.commandLine.appendSwitch('enable-smooth-scrolling')
// The face detector (Shape Detection API, backed by Windows' own), so artist photos can be
// cropped around the face (renderer lib/faceFocus).
app.commandLine.appendSwitch('enable-blink-features', 'ShapeDetection')

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

/* ---------- pulsemusic:// links (join a friend's party in the app) ---------- */
// The party page offers "Open in Pulse Music" (pulsemusic://join?u=<party link>). Windows
// starts Pulse with that link, or hands it to the running one (second-instance).
const PROTOCOL = 'pulsemusic'
if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [resolve(process.argv[1])])
} else {
  app.setAsDefaultProtocolClient(PROTOCOL)
}
/** Accepts only links to a Pulse party page: http(s)://host/p/<8 hex>. */
export function cleanPartyUrl(raw: unknown): string | null {
  try {
    const t = new URL(String(raw))
    if (!/^https?:$/.test(t.protocol)) return null
    if (!/^\/p\/[0-9a-f]{8}\/?$/.test(t.pathname)) return null
    return t.origin + t.pathname.replace(/\/$/, '')
  } catch {
    return null
  }
}
/**
 * The link Pulse was opened with: a party to join (pulsemusic://join?u=<party page>), or a
 * friend to listen along with (pulsemusic://listen?u=<Spotify id>&n=<name>, from the Listen
 * along button on their Discord status). Listen links are handed on as "listen:<id>:<name>".
 */
const joinFromArgv = (argv: string[]): string | null => {
  const link = argv.find((a) => a.startsWith(`${PROTOCOL}://`))
  if (!link) return null
  try {
    const u = new URL(link)
    const kind = (u.hostname || u.pathname.replace(/^\/+/, '')).replace(/\/+$/, '')
    if (kind === 'listen') {
      const id = u.searchParams.get('u') ?? ''
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(id)) return null
      const name = (u.searchParams.get('n') ?? '').slice(0, 60)
      return `listen:${id}:${encodeURIComponent(name)}`
    }
    return cleanPartyUrl(u.searchParams.get('u'))
  } catch {
    return null
  }
}
let pendingJoin: string | null = joinFromArgv(process.argv)
function sendJoin(url: string): void {
  // kept until the app picks it up (it may still be signing in); the event is only a nudge
  pendingJoin = url
  if (mainWindow && !mainWindow.webContents.isLoading()) mainWindow.webContents.send('party:join', url)
}

app.on('second-instance', (_e, argv) => {
  showMain()
  const url = joinFromArgv(argv)
  if (url) sendJoin(url)
})

function loadRenderer(win: BrowserWindow, hash = ''): void {
  if (isDev) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${hash}`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { hash })
  }
}

const darkNow = (): boolean => nativeTheme.shouldUseDarkColors

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 620,
    show: false,
    title: 'Pulse Music',
    icon: appIconPath,
    backgroundColor: darkNow() ? '#0d0e13' : '#eceef4',
    // Frameless: the window buttons are drawn by the app so they match the glass design.
    frame: false,
    roundedCorners: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  })

  mainWindow.webContents.on('did-finish-load', () => applyZoom(getSettings()))
  // Started with Windows: stay in the tray (the app still runs and counts plays); otherwise show.
  mainWindow.once('ready-to-show', () => {
    if (!startedHidden) mainWindow?.show()
  })
  const sendMax = (): void => mainWindow?.webContents.send('window:maximized', mainWindow.isMaximized())
  mainWindow.on('maximize', sendMax)
  mainWindow.on('unmaximize', sendMax)
  const sendFull = (): void => mainWindow?.webContents.send('window:fullscreen-changed', mainWindow.isFullScreen())
  mainWindow.on('enter-full-screen', sendFull)
  mainWindow.on('leave-full-screen', sendFull)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  // Closing the window keeps Pulse running in the tray (Settings → System), so plays on your
  // other devices keep being counted; Quit in the tray menu ends it.
  mainWindow.on('close', (e) => {
    if (quitting || getSettings().closeToTray === false) return
    e.preventDefault()
    mainWindow?.hide()
    if (!toldAboutTray && !getSettings().trayHintShown && tray) {
      toldAboutTray = true
      updateSettings({ trayHintShown: true })
      tray.displayBalloon({
        title: 'Pulse Music is still running',
        content: 'It keeps counting what you play in the tray. Right-click the icon to quit.',
        iconType: 'info'
      })
    }
  })
  // Windows is shutting down or signing out: let the window close
  mainWindow.on('query-session-end', () => {
    quitting = true
  })
  mainWindow.on('session-end', () => {
    quitting = true
  })
  mainWindow.on('closed', () => {
    mainWindow = null
    app.quit()
  })
  loadRenderer(mainWindow)
}

function createMiniWindow(): void {
  const { workArea } = screen.getPrimaryDisplay()
  const width = 380
  const height = 128
  miniWindow = new BrowserWindow({
    width,
    height,
    x: workArea.x + workArea.width - width - 24,
    y: workArea.y + workArea.height - height - 24,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    transparent: process.platform !== 'win32',
    backgroundMaterial: process.platform === 'win32' ? 'acrylic' : undefined,
    backgroundColor: '#00000000',
    roundedCorners: true,
    title: 'Pulse Music Mini Player',
    icon: appIconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  miniWindow.setAlwaysOnTop(true, 'floating')
  miniWindow.once('ready-to-show', () => {
    miniWindow?.show()
    miniWindow?.webContents.send('playback:snapshot', snapshot)
  })
  miniWindow.on('closed', () => {
    miniWindow = null
    mainWindow?.webContents.send('window:mini-changed', false)
    if (mainWindow && !mainWindow.isVisible()) mainWindow.show()
  })
  loadRenderer(miniWindow, '/mini')
  mainWindow?.webContents.send('window:mini-changed', true)
}

function toggleMini(): void {
  if (miniWindow) {
    miniWindow.close()
    showMain()
  } else {
    createMiniWindow()
    mainWindow?.hide()
  }
}

function showMain(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function sendCommand(c: PlayerCommand): void {
  mainWindow?.webContents.send('playback:command', c)
}

function buildTrayMenu(): void {
  if (!tray) return
  const s = snapshot
  tray.setToolTip(s.hasTrack ? `${s.title} — ${s.artists}` : 'Pulse Music')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      ...(s.hasTrack
        ? [{ label: s.title.slice(0, 60), enabled: false }, { label: s.artists.slice(0, 60), enabled: false }, { type: 'separator' as const }]
        : []),
      {
        label: s.paused ? 'Play' : 'Pause',
        click: () => sendCommand({ type: 'toggle' })
      },
      { label: 'Next', click: () => sendCommand({ type: 'next' }) },
      { label: 'Previous', click: () => sendCommand({ type: 'previous' }) },
      { type: 'separator' },
      {
        label: miniWindow ? 'Close mini player' : 'Mini player',
        click: toggleMini
      },
      { label: 'Show Pulse Music', click: showMain },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() }
    ])
  )
}

function createTray(): void {
  const icon = nativeImage.createFromPath(trayIconPath).resize({ width: 16, height: 16 })
  tray = new Tray(icon)
  tray.on('click', showMain)
  buildTrayMenu()
}

function applySettings(s: Settings, prev?: Settings): void {
  nativeTheme.themeSource = s.theme
  if (!prev || prev.discordRpc !== s.discordRpc) setDiscordEnabled(s.discordRpc)
  setDiscordGetButton(s.discordGetButton ?? true)
  if (!prev || prev.launchAtStartup !== s.launchAtStartup) {
    // started by Windows it opens quietly in the tray
    if (app.isPackaged)
      app.setLoginItemSettings({
        openAtLogin: s.launchAtStartup,
        args: ['--hidden']
      })
  }
  if (prev && prev.autoUpdate !== s.autoUpdate) setAutoUpdates(s.autoUpdate !== false)
  applyZoom(s)
  applyGlobalKeys(s)
}

/* ---------- Keyboard shortcuts that work from any app ---------- */
let keysOn = ''
const KEY_COMMANDS: Record<GlobalAction, () => void> = {
  toggle: () => sendCommand({ type: 'toggle' }),
  next: () => sendCommand({ type: 'next' }),
  previous: () => sendCommand({ type: 'previous' }),
  volumeUp: () => sendCommand({ type: 'volume', delta: 0.05 }),
  volumeDown: () => sendCommand({ type: 'volume', delta: -0.05 }),
  like: () => sendCommand({ type: 'like' }),
  show: () => showMain()
}

/** (Re)registers the shortcuts from Settings; keys another app already uses are skipped. */
function applyGlobalKeys(s: Settings): void {
  if (!app.isReady()) return
  const keys = { ...GLOBAL_KEYS, ...(s.globalKeys ?? {}) }
  const sig = s.globalShortcuts === false ? 'off' : JSON.stringify(keys)
  if (sig === keysOn) return
  keysOn = sig
  globalShortcut.unregisterAll()
  if (s.globalShortcuts === false) return
  for (const [action, accel] of Object.entries(keys) as [GlobalAction, string][]) {
    if (!accel) continue
    try {
      if (!globalShortcut.register(accel, KEY_COMMANDS[action])) console.warn('[keys] taken by another app:', accel)
    } catch (e) {
      console.warn('[keys] not a valid shortcut:', accel, e)
    }
  }
}

/** The size the whole app is drawn at (Settings → General → Size). */
function applyZoom(s: Settings): void {
  const z = Number(s.zoom) || 1
  const f = Math.min(1.5, Math.max(0.75, z))
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.getZoomFactor() !== f) mainWindow.webContents.setZoomFactor(f)
}

function registerIpc(): void {
  ipcMain.handle('auth:status', () => ({ loggedIn: isLoggedIn() }))
  ipcMain.handle('auth:login', async () => {
    await login()
    showMain()
    return { loggedIn: isLoggedIn() }
  })
  ipcMain.handle('auth:logout', () => logout())
  ipcMain.handle('auth:client-id', () => customClientId())
  ipcMain.handle('auth:set-client-id', (_e, id: unknown) => setCustomClientId(typeof id === 'string' ? id : null))
  ipcMain.handle('auth:token', () => getAccessToken())
  ipcMain.handle('auth:scopes', () => grantedScopes())
  // One cheap request from Node, where Spotify's Retry-After header is readable.
  ipcMain.handle('auth:retry-after', async () => {
    const token = await getAccessToken()
    if (!token) return null
    try {
      const res = await fetch('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000)
      })
      if (res.status !== 429) return 0
      const s = Number(res.headers.get('retry-after') ?? '')
      return s > 0 ? s : null
    } catch {
      return null
    }
  })

  ipcMain.handle('dj:chat', (_e, req) => djChat(req))
  ipcMain.handle('dj:local-ready', () => localReady())
  ipcMain.handle('dj:setup-ai', (e) => setupLocal(e.sender))
  ipcMain.handle('dj:preload', async () => {
    if (localReady()) await ensureEngine().catch(() => {})
  })
  ipcMain.handle('dj:voice-status', () => voiceStatus())
  ipcMain.handle('dj:install-voice', (e) => installVoice(e.sender))
  ipcMain.handle('dj:speak', (_e, text: string, voice?: string) => speak(String(text).slice(0, 1200), (voice ?? getSettings().djSpeaker) as never))

  ipcMain.handle('store:get', (_e, name: unknown) => (isStoreName(name) ? readStore(name) : null))
  ipcMain.handle('store:set', (_e, name: unknown, data: unknown) => {
    if (isStoreName(name)) writeStore(name, data)
  })

  // Share cards: save a rendered PNG with a save dialog, or put it on the clipboard.
  const pngFromDataUrl = (dataUrl: string): Buffer | null => {
    const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl)
    return m ? Buffer.from(m[1], 'base64') : null
  }
  ipcMain.handle('image:save', async (_e, dataUrl: string, name: string) => {
    const png = pngFromDataUrl(dataUrl)
    if (!png || !mainWindow) return false
    const safe = String(name || 'Pulse Music')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .trim()
      .slice(0, 80)
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Save image',
      defaultPath: join(app.getPath('pictures'), `${safe}.png`),
      filters: [{ name: 'PNG image', extensions: ['png'] }]
    })
    if (res.canceled || !res.filePath) return false
    await writeFile(res.filePath, png)
    return true
  })
  ipcMain.handle('image:copy', async (_e, dataUrl: string) => {
    const png = pngFromDataUrl(dataUrl)
    if (!png) return false
    await clipboard.write([
      new ClipboardItem({
        'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' })
      })
    ])
    return true
  })

  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => {
    const prev = getSettings()
    const next = updateSettings(patch)
    applySettings(next, prev)
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('settings:changed', next)
    return next
  })

  ipcMain.handle('artist:info', (_e, q) => getArtistInfo(q))
  ipcMain.handle('lastfm:status', () => lastfmStatus())
  ipcMain.handle('lastfm:connect', () => connectLastfm())
  ipcMain.handle('lastfm:disconnect', () => disconnectLastfm())
  ipcMain.handle('lastfm:enable', (_e, on: boolean) => setLastfmEnabled(!!on))
  ipcMain.on('lastfm:now', (_e, t) => t && void lastfmNowPlaying(t))
  ipcMain.on('lastfm:scrobble', (_e, s) => s && void lastfmScrobble(s))
  ipcMain.on('update:install', () => installUpdateNow())
  ipcMain.handle('update:check', () => checkForUpdatesNow())
  ipcMain.handle('update:status', () => updateStatus())
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('app:gpu', () => ({
    on: app.isHardwareAccelerationEnabled?.() ?? true,
    wanted: getSettings().hardwareAcceleration !== false
  }))
  ipcMain.handle('app:relaunch', () => {
    quitting = true
    app.relaunch()
    app.exit(0)
  })
  // Settings → Storage: the downloaded pictures and pages Chromium keeps (Pulse's own data stays)
  ipcMain.handle('app:clear-cache', async () => {
    const ses = mainWindow?.webContents.session
    if (!ses) return 0
    const before = await ses.getCacheSize().catch(() => 0)
    await ses.clearCache().catch(() => {})
    return before
  })
  // "Start over": signs out and erases everything Pulse keeps on this computer (settings,
  // history and stats, profile, caches, Last.fm link), then restarts like a fresh install.
  // Big downloads (the DJ's brain and voice, the party helper) are kept.
  ipcMain.handle('discord:status', () => discordStatus())
  ipcMain.handle('app:reset', async () => {
    stopParty()
    logout()
    const ud = app.getPath('userData')
    for (const f of ['auth.bin', 'settings.json', 'profile.json', 'data']) {
      try {
        rmSync(join(ud, f), { recursive: true, force: true })
      } catch (e) {
        console.warn('[reset] could not remove', f, e)
      }
    }
    await session.defaultSession.clearStorageData().catch(() => {})
    await session.defaultSession.clearCache().catch(() => {})
    app.relaunch()
    app.exit(0)
  })
  const sid = (v: unknown): string | null => (typeof v === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(v) ? v : null)
  const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim().length >= 2 ? v.trim().slice(0, max) : null)
  ipcMain.handle('people:search-spotify', (_e, q: unknown) => (text(q, 80) ? searchSpotifyUsers(text(q, 80)!) : []))
  ipcMain.handle('people:spotify-user', (_e, id: unknown) => (sid(id) ? getSpotifyUser(sid(id)!) : null))
  // a profile read before (playlists and all) comes straight from disk; otherwise the page's
  // link preview has the name and picture in well under a second
  ipcMain.handle('people:spotify-user-quick', (_e, id: unknown) => (sid(id) ? (savedSpotifyUser(sid(id)!) ?? userFromHtml(sid(id)!).catch(() => null)) : null))
  ipcMain.handle('people:embed-playlist', (_e, id: unknown) => (typeof id === 'string' && /^[A-Za-z0-9]{10,40}$/.test(id) ? getEmbedPlaylist(id) : null))
  ipcMain.handle('people:server-on', () => pulseServerOn())
  ipcMain.handle('people:pulse-profile', (_e, id: unknown) => (sid(id) ? getPulseProfile(sid(id)!) : null))
  ipcMain.handle('people:pulse-lookup', (_e, ids: unknown) => (Array.isArray(ids) ? lookupPulse(ids.map(sid).filter((x): x is string => !!x)) : []))
  ipcMain.handle('people:pulse-search', (_e, q: unknown) => (text(q, 60) ? searchPulse(text(q, 60)!) : []))
  ipcMain.handle('people:publish', (_e, body: unknown) => publishPulse((body ?? null) as Parameters<typeof publishPulse>[0]))
  ipcMain.handle('people:friends', () => getFriends())
  ipcMain.handle('people:friend-action', (_e, action: unknown, id: unknown, who: unknown) => {
    if (action !== 'follow' && action !== 'unfollow' && action !== 'dismiss') throw new Error('Unknown friend action')
    if (!sid(id)) throw new Error('Bad user id')
    const w = who as { name?: unknown; image?: unknown } | null
    const info =
      w && typeof w === 'object'
        ? {
            name: typeof w.name === 'string' ? w.name.slice(0, 60) : '',
            image: typeof w.image === 'string' ? w.image.slice(0, 1000) : null
          }
        : undefined
    return friendAction(action, sid(id)!, info)
  })
  ipcMain.handle('people:share-now', (_e, now: unknown) => shareNow((now ?? null) as Parameters<typeof shareNow>[0]))
  ipcMain.handle('people:now-of', (_e, id: unknown) => (sid(id) ? nowOf(sid(id)!) : null))
  ipcMain.handle('people:listeners', () => getListeners())
  ipcMain.handle('people:follows-of', (_e, id: unknown) => (sid(id) ? followsOf(sid(id)!) : null))
  ipcMain.handle('people:spotify-follows', (_e, id: unknown, kind: unknown) =>
    sid(id) && (kind === 'followers' || kind === 'following') ? getSpotifyFollows(sid(id)!, kind) : []
  )
  ipcMain.handle('party:start', async (e) => {
    const r = await startParty(e.sender)
    refreshPresence()
    return r
  })
  ipcMain.handle('party:stop', () => {
    stopParty()
    refreshPresence()
  })
  ipcMain.handle('party:info', () => partyInfo())
  ipcMain.handle('party:vote', (_e, uri: unknown, v: unknown) => partyVote('host', String(uri ?? ''), Number(v) || 0))
  // A guest's side: talk to a friend's party (the browser page can't, it's another origin).
  ipcMain.handle('party:pending-join', () => {
    const u = pendingJoin
    pendingJoin = null
    return u
  })
  const remote = async (url: unknown, path: string, init?: RequestInit): Promise<unknown> => {
    const base = cleanPartyUrl(url)
    if (!base) throw new Error('That is not a Pulse party link.')
    const res = await fetch(`${base}/${path}`, {
      ...init,
      signal: AbortSignal.timeout(8000)
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error((body as { error?: string }).error ?? `The party answered ${res.status}.`)
    return body
  }
  ipcMain.handle('party:remote-state', (_e, url: string) => remote(url, 'api/state'))
  ipcMain.handle('party:remote-search', (_e, url: string, q: string) => remote(url, `api/search?q=${encodeURIComponent(String(q).slice(0, 80))}`))
  ipcMain.handle('party:remote-add', (_e, url: string, uri: string, guest: string) =>
    remote(url, 'api/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uri: String(uri),
        guest: String(guest).slice(0, 24)
      })
    })
  )
  ipcMain.handle('party:remote-control', (_e, url: string, control: unknown, guest: string) =>
    remote(url, 'api/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(control as object),
        guest: String(guest).slice(0, 24)
      })
    })
  )
  ipcMain.on('party:queue', (_e, q) => {
    if (!Array.isArray(q)) return
    setPartyQueue(q)
    refreshPresence()
  })
  ipcMain.handle('recs:related', (_e, name: string) => (typeof name === 'string' ? relatedArtists(name.slice(0, 100)) : []))
  ipcMain.handle('recs:preview', (_e, title: string, artist: string) =>
    typeof title === 'string' && typeof artist === 'string' ? songPreview(title.slice(0, 200), artist.slice(0, 100)) : null
  )
  // The DJ orb moves with the music. Spotify's audio is protected, so the page can't read it;
  // on Windows it listens to what the computer plays instead (loopback). Chromium needs a
  // screen named for that, but the page stops the picture at once and nothing is saved.
  ipcMain.handle('recs:loopback-source', async (e) => {
    if (process.platform !== 'win32' || e.sender !== mainWindow?.webContents) return null
    const list = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }).catch(() => [])
    return list[0]?.id ?? null
  })
  ipcMain.handle('artist:page', (_e, id: string) => (/^[A-Za-z0-9]{10,40}$/.test(id) ? getArtistPage(id) : null))
  ipcMain.handle('artist:quick', (_e, id: string) => (/^[A-Za-z0-9]{10,40}$/.test(id) ? getArtistQuick(id) : null))
  ipcMain.handle('spotify-account:status', () => spotifyAccountStatus())
  ipcMain.handle('spotify-account:connect', () => connectSpotifyAccount(mainWindow))
  ipcMain.handle('spotify-account:disconnect', () => disconnectSpotifyAccount())
  ipcMain.handle('spotify-account:friends', () => spotifyFriends().catch(() => null))
  ipcMain.handle('spotify-account:canvas', (_e, id: unknown) => (typeof id === 'string' ? spotifyCanvas(id).catch(() => null) : null))
  ipcMain.handle('spotify-account:analysis', (_e, id: unknown) => (typeof id === 'string' ? spotifyAnalysis(id).catch(() => null) : null))
  ipcMain.handle('spotify-account:lyrics', (_e, id: unknown) => (typeof id === 'string' ? spotifyLyrics(id).catch(() => null) : null))
  ipcMain.handle('lyrics:lrclib', (_e, q) => fetchLrclib(q))
  ipcMain.handle('lyrics:genius', (_e, q) => fetchGenius(q))
  ipcMain.handle('profile:get', () => loadProfile())
  ipcMain.handle('profile:set', (_e, p: Profile) => saveProfile(p))
  ipcMain.handle('lyrics:ovh', (_e, q) => fetchLyricsOvh(q))
  // Some Spotify image hosts send no CORS headers, which blocks colour extraction in the UI.
  ipcMain.handle('image:data', async (_e, url: string) => {
    try {
      const u = new URL(url)
      if (u.protocol !== 'https:' || !/(^|\.)(scdn\.co|spotifycdn\.com|spotify\.com)$/.test(u.hostname)) return null
      const res = await fetch(u)
      if (!res.ok) return null
      const type = res.headers.get('content-type') ?? 'image/jpeg'
      return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`
    } catch {
      return null
    }
  })

  ipcMain.on('playback:publish', (_e, s: PlaybackSnapshot) => {
    const changed = s.trackId !== snapshot.trackId || s.paused !== snapshot.paused || s.title !== snapshot.title
    snapshot = s
    setPartyNowPlaying(s)
    miniWindow?.webContents.send('playback:snapshot', s)
    if (changed) buildTrayMenu()
    if (getSettings().discordRpc) updatePresence(s)
  })
  ipcMain.on('playback:command', (_e, c: PlayerCommand) => sendCommand(c))

  ipcMain.on('window:toggle-mini', toggleMini)
  ipcMain.on('window:show-main', () => {
    if (miniWindow) miniWindow.close()
    showMain()
  })
  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:maximize', () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.on('window:close', () => mainWindow?.close())
  // Now Playing over the whole screen, taskbar included
  // (answers once the window has finished changing, so the page can wait for it)
  ipcMain.handle('window:fullscreen', async (_e, on: unknown) => {
    const win = mainWindow
    if (!win || win.isDestroyed()) return false
    if (win.isFullScreen() !== !!on) {
      const done = new Promise<void>((resolve) => {
        const ev = on ? 'enter-full-screen' : 'leave-full-screen'
        const t = setTimeout(resolve, 700)
        win.once(ev as 'enter-full-screen', () => {
          clearTimeout(t)
          resolve()
        })
      })
      win.setFullScreen(!!on)
      await done
    }
    return !!on
  })
  // The renderer recolours the app icon to match the current song; show it on the taskbar.
  ipcMain.on('window:set-icon', (e, dataUrl: string) => {
    if (!mainWindow || e.sender !== mainWindow.webContents) return
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) return
    const img = nativeImage.createFromDataURL(dataUrl)
    if (!img.isEmpty()) mainWindow.setIcon(img)
  })
  ipcMain.on('open-external', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
  })
}

/** The DJ orb listens to what the computer plays (Windows loopback audio) to move with the
 *  beat. Only the app's own window gets it, and only the sound: no picture is kept. */
function allowLoopbackAudio(): void {
  if (process.platform !== 'win32') return
  session.defaultSession.setDisplayMediaRequestHandler((req, cb) => {
    // only Pulse's own window asks (some Electron builds don't say which frame asked)
    const from = req.frame ? webContents.fromFrame(req.frame) : null
    if (!mainWindow || !req.audioRequested || (from && from !== mainWindow.webContents)) return cb({})
    desktopCapturer
      .getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      .then((list) => cb(list[0] ? { video: list[0], audio: 'loopback' } : {}))
      .catch(() => cb({}))
  })
}

app.whenReady().then(async () => {
  // Widevine (castLabs) must be ready before Spotify playback can start.
  try {
    await components.whenReady()
  } catch (e) {
    console.error('[widevine] component install failed', e)
  }

  loadTokens()
  const s = loadSettings()
  applySettings(s)
  registerIpc()
  allowLoopbackAudio()
  cleanOldVoices()
  createMainWindow()
  createTray()
  startLastfm()
  prepareTunnel()
  initUpdates(() => mainWindow, getSettings().autoUpdate !== false)

  nativeTheme.on('updated', () => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.setBackgroundColor(darkNow() ? '#0d0e13' : '#eceef4')
    }
  })
})

app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => app.quit())

app.on('before-quit', () => {
  quitting = true
  stopParty()
  stopEngine()
  setDiscordEnabled(false)
  tray?.destroy()
})
