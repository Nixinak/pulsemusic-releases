// Automatic updates from GitHub Releases (Nixinak/pulsemusic-releases). The installed app
// checks at start, every hour and when you come back to it, downloads a new version in the
// background and offers to restart; otherwise it installs itself the next time it's closed.
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
  let lastCheck = 0
  const check = (): void => {
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
