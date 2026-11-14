// Puts the party page on the internet so friends anywhere can join with a link.
// It uses a Cloudflare "quick tunnel": free, no account, nothing to set up. The page still
// runs on this computer; Cloudflare only forwards visits to it through an address like
// https://random-words.trycloudflare.com that lasts until the party ends.
// The cloudflared program ships inside the installer (resources/bin). When running from
// source it is fetched once in the background when the app starts (prepareTunnel), so a
// party never has to wait for it.
import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const DOWNLOAD =
  process.platform === 'win32'
    ? 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
    : process.platform === 'darwin'
      ? ''
      : 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64'

const binPath = (): string => join(app.getPath('userData'), 'bin', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared')

let child: ChildProcess | null = null
/** Bumped on every start/stop: a start that finishes after a newer one (or a stop) gives up. */
let generation = 0
let downloading: Promise<string> | null = null

const bundled = (): string => join(process.resourcesPath ?? '', 'bin', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared')
const usable = (f: string): boolean => {
  try {
    return existsSync(f) && statSync(f).size > 1_000_000
  } catch {
    return false
  }
}

/** Called at app start: makes sure the program is there before anyone starts a party. */
export function prepareTunnel(): void {
  if (usable(bundled()) || usable(binPath())) return
  void ensureBinary(() => {}).catch((e) => console.warn('[tunnel] could not prepare', e))
}

async function ensureBinary(onStatus: (s: string) => void): Promise<string> {
  if (usable(bundled())) return bundled()
  const file = binPath()
  if (usable(file)) return file
  if (!DOWNLOAD) throw new Error('Internet parties are not available on this system.')
  downloading ??= (async () => {
    onStatus('Getting party links ready…')
    mkdirSync(join(app.getPath('userData'), 'bin'), { recursive: true })
    const res = await fetch(DOWNLOAD, { signal: AbortSignal.timeout(180_000) })
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`)
    const part = file + '.part'
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(part, { mode: 0o755 }))
    renameSync(part, file)
    return file
  })().finally(() => {
    downloading = null
  })
  return downloading
}

/** Starts the tunnel to the local party server and resolves with its public https address. */
export async function startTunnel(port: number, onStatus: (s: string) => void): Promise<string> {
  stopTunnel()
  const gen = generation
  const bin = await ensureBinary(onStatus)
  if (gen !== generation) throw new Error('The party ended.')
  onStatus('Putting your party online…')
  return new Promise<string>((resolve, reject) => {
    const proc = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    child = proc
    let done = false
    const timer = setTimeout(() => {
      if (done) return
      done = true
      proc.kill()
      reject(new Error('Cloudflare did not answer in time.'))
    }, 45_000)
    const scan = (chunk: Buffer): void => {
      const m = chunk.toString('utf8').match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
      if (m && !done) {
        done = true
        clearTimeout(timer)
        resolve(m[0])
      }
    }
    proc.stdout?.on('data', scan)
    proc.stderr?.on('data', scan)
    proc.on('error', (e) => {
      if (done) return
      done = true
      clearTimeout(timer)
      reject(e)
    })
    proc.on('exit', (code) => {
      if (child === proc) child = null
      if (done) return
      done = true
      clearTimeout(timer)
      reject(new Error(`The party link stopped (code ${code}).`))
    })
  })
}

export function stopTunnel(): void {
  generation++
  if (child && !child.killed) child.kill()
  child = null
}

/** Removes a half-finished download. */
export function cleanTunnelDownload(): void {
  try {
    rmSync(binPath() + '.part', { force: true })
  } catch {
    /* nothing to clean */
  }
}
