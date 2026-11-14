// Automatic updates from GitHub Releases (Nixinak/pulsemusic-releases). The installed app
// checks at start and every few hours, downloads a new version in the background and offers
// to restart; otherwise it installs itself the next time the app is closed.
import { app, type BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'

export function initUpdates(getWindow: () => BrowserWindow | null): void {
  // Only the installed app updates itself (not "npm run dev").
  if (!app.isPackaged) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-downloaded', (info) => {
    getWindow()?.webContents.send('update:ready', info.version)
  })
  autoUpdater.on('error', (e) => console.warn('[update]', e?.message ?? e))
  const check = (): void => {
    autoUpdater.checkForUpdates().catch((e) => console.warn('[update] check failed', e?.message ?? e))
  }
  setTimeout(check, 20_000)
  setInterval(check, 6 * 3600_000)
}

export function installUpdateNow(): void {
  // Silent install, then start the new version.
  autoUpdater.quitAndInstall(true, true)
}
