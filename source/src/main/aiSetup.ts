// The AI DJ's built-in brain: llama.cpp's small server (shipped with the app, a few dozen MB)
// running a 3-billion-parameter model (about 2 GB, downloaded once). It replaces Ollama,
// which needed several GB more. The server uses the graphics card through Vulkan when there
// is one and the processor otherwise, starts when the DJ is used and stops when idle.
import { app, type WebContents } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { AiSetupProgress, DjChatRequest, DjChatResult } from '@shared/types'

/** Same file and folder as resources/setup-ai.ps1 (the installer's optional step). */
const MODEL = {
  file: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
  url: 'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf',
  minBytes: 1_900_000_000
}
const modelDir = (): string => join(app.getPath('userData'), 'dj-model')
const modelPath = (): string => join(modelDir(), MODEL.file)
const engineDir = (): string => (app.isPackaged ? join(process.resourcesPath, 'llama') : join(app.getAppPath(), 'resources', 'llama'))
const serverExe = (): string => join(engineDir(), 'llama-server.exe')

/** The model is downloaded and complete. */
export function localReady(): boolean {
  try {
    return statSync(modelPath()).size >= MODEL.minBytes
  } catch {
    return false
  }
}

/* ---------- Download ---------- */

let downloading: Promise<boolean> | null = null

const gb = (n: number): string => (n / 1e9).toFixed(n >= 1e10 ? 0 : 1) + ' GB'

/** Downloads the model (continuing an unfinished download), with progress on 'dj:ai-progress'. */
export function setupLocal(sender: WebContents): Promise<boolean> {
  if (downloading) return downloading
  const send = (p: AiSetupProgress): void => {
    if (!sender.isDestroyed()) sender.send('dj:ai-progress', p)
  }
  downloading = (async () => {
    if (localReady()) {
      send({ step: 'The AI DJ is ready', done: true })
      return true
    }
    mkdirSync(modelDir(), { recursive: true })
    const part = modelPath() + '.part'
    let have = 0
    try {
      have = statSync(part).size
    } catch {
      /* fresh download */
    }
    send({ step: 'Downloading the DJ’s brain (about 2 GB)', percent: 0 })
    const res = await fetch(MODEL.url, { headers: have ? { Range: `bytes=${have}-` } : {} })
    if (res.status === 416) have = 0 // the part file is complete or broken: the size check decides below
    else if (!res.ok || !res.body) throw new Error(`The download failed (${res.status}).`)
    // a server that ignores Range sends everything again: start over
    if (have && res.status !== 206) have = 0
    const total = have + Number(res.headers.get('content-length') ?? 0)
    if (res.body && res.status !== 416) {
      let got = have
      let lastSent = 0
      const counter = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, ctrl) {
          got += chunk.byteLength
          if (Date.now() - lastSent > 300) {
            lastSent = Date.now()
            send({ percent: total ? Math.floor((got / total) * 100) : undefined, line: total ? `${gb(got)} of ${gb(total)}` : gb(got) })
          }
          ctrl.enqueue(chunk)
        }
      })
      await pipeline(Readable.fromWeb(res.body.pipeThrough(counter) as never), createWriteStream(part, { flags: have ? 'a' : 'w' }))
    }
    if (statSync(part).size < MODEL.minBytes) throw new Error('The download was incomplete. Try again to continue it.')
    renameSync(part, modelPath())
    send({ step: 'The AI DJ is ready', done: true })
    return true
  })()
    .catch((e) => {
      const msg = e instanceof Error ? e.message : String(e)
      // a dropped connection keeps what arrived; the next try continues from there
      send({ error: /terminated|fetch failed|ECONNRESET|socket/i.test(msg) ? 'The download was interrupted. Try again to continue it.' : msg })
      return false
    })
    .finally(() => {
      downloading = null
    })
  return downloading
}

/* ---------- Server ---------- */

let proc: ChildProcess | null = null
let base = ''
let starting: Promise<string> | null = null
let idle: NodeJS.Timeout | null = null
/** Frees the memory (about 2.5 GB) when the DJ hasn't been used for a while. */
const IDLE_MS = 20 * 60_000

function touch(): void {
  if (idle) clearTimeout(idle)
  idle = setTimeout(stopEngine, IDLE_MS)
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port
      s.close(() => resolve(port))
    })
  })
}

async function healthy(url: string): Promise<boolean> {
  try {
    return (await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) })).ok
  } catch {
    return false
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Starts the server with `layers` on the graphics card; resolves with its address. */
async function launch(layers: number): Promise<string> {
  const port = await freePort()
  const p = spawn(
    serverExe(),
    ['-m', modelPath(), '--host', '127.0.0.1', '--port', String(port), '-c', '4096', '-ngl', String(layers)],
    { cwd: engineDir(), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] }
  )
  let log = ''
  p.stderr?.on('data', (b: Buffer) => (log = (log + b.toString('utf8')).slice(-3000)))
  let exited = false
  p.once('exit', () => {
    exited = true
    if (proc === p) {
      proc = null
      base = ''
    }
  })
  p.once('error', () => (exited = true))
  const url = `http://127.0.0.1:${port}`
  // loading 2 GB from disk takes a few seconds, longer on a slow drive
  for (let i = 0; i < 360; i++) {
    if (exited) throw new Error(log.trim().split('\n').pop() || 'The DJ engine stopped.')
    if (await healthy(url)) {
      proc = p
      base = url
      return url
    }
    await sleep(500)
  }
  p.kill()
  throw new Error('The DJ engine took too long to start.')
}

/** Starts the engine if it isn't running and returns its address. */
export function ensureEngine(): Promise<string> {
  touch()
  if (proc && base) return Promise.resolve(base)
  if (starting) return starting
  starting = (async () => {
    if (!localReady()) throw new Error('The AI DJ isn’t set up yet.')
    if (!existsSync(serverExe())) throw new Error('The DJ engine is missing. Reinstall Pulse Music.')
    try {
      return await launch(99) // everything on the graphics card
    } catch (e) {
      console.warn('[llm] graphics card start failed, using the processor', e)
      return await launch(0)
    }
  })().finally(() => {
    starting = null
  })
  return starting
}

export function stopEngine(): void {
  if (idle) clearTimeout(idle)
  idle = null
  proc?.kill()
  proc = null
  base = ''
}

export async function localChat(req: DjChatRequest): Promise<DjChatResult> {
  let url: string
  try {
    url = await ensureEngine()
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  const res = await fetch(`${url}/v1/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(120_000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'system', content: req.system }, ...req.messages],
      temperature: 0.8,
      max_tokens: 700,
      ...(req.json ? { response_format: { type: 'json_object' } } : {})
    })
  })
  touch()
  if (!res.ok) return { ok: false, error: `The DJ engine answered ${res.status}: ${(await res.text()).slice(0, 200)}` }
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  return { ok: true, text: j.choices?.[0]?.message?.content ?? '' }
}
