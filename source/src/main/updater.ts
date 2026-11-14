// Updates from GitHub Releases (Nixinak/pulsemusic-releases).
// With automatic updates on (Settings → System), the installed app looks for a new version at
// start, every hour and when you come back to it, downloads it in the background and offers to
// restart; otherwise it installs itself the next time Pulse is closed. With them off, nothing
// happens until you press "Check for updates", which looks, downloads and shows the progress.
import { app, type BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '@shared/types'

let status: UpdateStatus = { state: 'idle' }
let win: () => BrowserWindow | null = () => null
let lastCheck = 0
let ready = false
let auto = true
let firstTimer: ReturnType<typeof setTimeout> | null = null
let hourly: ReturnType<typeof setInterval> | null = null

function set(next: UpdateStatus): void {
  status = next
  const w = win()
  if (w && !w.isDestroyed()) w.webContents.send('update:status', status)
}

export function updateStatus(): UpdateStatus {
  return app.isPackaged ? status : { state: 'dev' }
}

let checkingSince = 0
/** Busy or done: another check would only get in the way (a check stuck for 2 minutes isn't). */
const settled = (): boolean =>
  (status.state === 'checking' && Date.now() - checkingSince < 120_000) || status.state === 'downloading' || status.state === 'ready'

async function check(): Promise<void> {
  if (!ready || settled()) return
  lastCheck = Date.now()
  checkingSince = Date.now()
  set({ state: 'checking' })
  try {
    const result = await autoUpdater.checkForUpdates()
    // No release feed (or nothing returned): don't stay stuck on "checking".
    if (!result && status.state === 'checking') set({ state: 'latest', version: app.getVersion() })
  } catch (e) {
    set({ state: 'error', message: friendly(e) })
  }
}

const friendly = (e: unknown): string => {
  const m = e instanceof Error ? e.message : String(e)
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|net::ERR_/i.test(m)) return 'no connection to GitHub. Try again later.'
  return m.split('\n')[0].slice(0, 160)
}

/** Looks for a new version now and downloads it when there is one. */
export async function checkForUpdatesNow(): Promise<UpdateStatus> {
  if (!app.isPackaged) return { state: 'dev' }
  await check()
  return status
}

function onFocus(): void {
  // back at the app after a while: look again (at most every 20 minutes)
  if (auto && Date.now() - lastCheck > 20 * 60_000) void check()
}

/** Turns the automatic checks on or off (the "Automatic updates" switch). */
export function setAutoUpdates(on: boolean): void {
  auto = on
  if (!ready) return
  if (firstTimer) clearTimeout(firstTimer)
  if (hourly) clearInterval(hourly)
  firstTimer = null
  hourly = null
  if (!on) return
  // Just switched on (or the app started): look soon, then every hour.
  firstTimer = setTimeout(() => void check(), Date.now() - lastCheck > 60_000 ? 3_000 : 60_000)
  hourly = setInterval(() => void check(), 3600_000)
}

export function initUpdates(getWindow: () => BrowserWindow | null, autoOn: boolean): void {
  win = getWindow
  // Only the installed app updates itself (not "npm run dev").
  if (!app.isPackaged) return
  ready = true
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => {
    if (status.state !== 'downloading' && status.state !== 'ready') set({ state: 'checking' })
  })
  autoUpdater.on('update-available', (info) => set({ state: 'downloading', version: info.version, percent: 0 }))
  autoUpdater.on('update-not-available', () => set({ state: 'latest', version: app.getVersion() }))
  autoUpdater.on('download-progress', (p) =>
    set({ state: 'downloading', version: status.version, percent: Math.max(0, Math.min(100, Math.round(p.percent))) })
  )
  autoUpdater.on('update-downloaded', (info) => {
    set({ state: 'ready', version: info.version })
    const w = getWindow()
    if (w && !w.isDestroyed()) w.webContents.send('update:ready', info.version)
  })
  autoUpdater.on('error', (e) => {
    console.warn('[update]', e?.message ?? e)
    // a failed download can be tried again; a ready update stays ready
    if (status.state !== 'ready') set({ state: 'error', message: friendly(e) })
  })
  app.on('browser-window-focus', onFocus)
  // the first look waits a little so it doesn't slow down the start
  lastCheck = Date.now() - 40_000
  auto = autoOn
  if (autoOn) {
    firstTimer = setTimeout(() => void check(), 20_000)
    hourly = setInterval(() => void check(), 3600_000)
  }
}

export function installUpdateNow(): void {
  if (status.state !== 'ready') return
  // Silent install, then start the new version.
  setImmediate(() => autoUpdater.quitAndInstall(true, true))
}
