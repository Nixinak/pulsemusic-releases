// Automatic updates from GitHub Releases (Nixinak/pulsemusic-releases). The installed app
// checks at start, every hour and when you come back to it, downloads a new version in the
// background and offers to restart; otherwise it installs itself the next time it's closed.
// Settings has a "Check for updates" button that does the same right away and shows progress.
import { app, type BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '@shared/types'

let status: UpdateStatus = { state: 'idle' }
let win: () => BrowserWindow | null = () => null
let lastCheck = 0

function set(next: UpdateStatus): void {
  status = next
  win()?.webContents.send('update:status', status)
}

export function updateStatus(): UpdateStatus {
  return app.isPackaged ? status : { state: 'dev' }
}

/** Looks for a new version now (it downloads by itself when there is one). */
export async function checkForUpdatesNow(): Promise<UpdateStatus> {
  if (!app.isPackaged) return { state: 'dev' }
  // already on its way or ready: nothing to check
  if (status.state === 'downloading' || status.state === 'ready') return status
  lastCheck = Date.now()
  set({ state: 'checking' })
  try {
    await autoUpdater.checkForUpdates()
  } catch (e) {
    set({ state: 'error', message: e instanceof Error ? e.message : String(e) })
  }
  return status
}

export function initUpdates(getWindow: () => BrowserWindow | null): void {
  win = getWindow
  // Only the installed app updates itself (not "npm run dev").
  if (!app.isPackaged) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => status.state !== 'downloading' && set({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => set({ state: 'downloading', version: info.version, percent: 0 }))
  autoUpdater.on('update-not-available', () => set({ state: 'latest', version: app.getVersion() }))
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', version: status.version, percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => {
    set({ state: 'ready', version: info.version })
    getWindow()?.webContents.send('update:ready', info.version)
  })
  autoUpdater.on('error', (e) => {
    console.warn('[update]', e?.message ?? e)
    set({ state: 'error', message: e?.message ?? String(e) })
  })
  const check = (): void => {
    if (status.state === 'downloading' || status.state === 'ready') return
    lastCheck = Date.now()
    autoUpdater.checkForUpdates().catch((e) => console.warn('[update] check failed', e?.message ?? e))
  }
  setTimeout(check, 20_000)
  setInterval(check, 3600_000)
  // back at the app after a while: look again (at most every 20 minutes)
  app.on('browser-window-focus', () => {
    if (Date.now() - lastCheck > 20 * 60_000) check()
  })
}

export function installUpdateNow(): void {
  // Silent install, then start the new version.
  autoUpdater.quitAndInstall(true, true)
}
