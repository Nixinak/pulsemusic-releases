// Downloads the AI DJ's engine (llama.cpp's server, Windows x64, Vulkan build) into
// resources/llama before packaging, so the installer already contains it. Only the server
// and its DLLs are kept (a few dozen MB). Skips when it's already there.
const { existsSync, mkdirSync, createWriteStream, readdirSync, copyFileSync, rmSync, writeFileSync, statSync } = require('node:fs')
const { join } = require('node:path')
const { spawnSync } = require('node:child_process')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')

const root = join(__dirname, '..')
const dir = join(root, 'resources', 'llama')
const exe = join(dir, 'llama-server.exe')
const RELEASES = 'https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=20'

;(async () => {
  if (existsSync(exe)) return console.log('[llama] already there')
  console.log('[llama] looking for the latest Windows Vulkan build…')
  const res = await fetch(RELEASES, { headers: { 'User-Agent': 'pulse-music-build', Accept: 'application/vnd.github+json' } })
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
  const releases = await res.json()
  let asset = null
  let tag = ''
  for (const r of releases) {
    asset = (r.assets || []).find((a) => /win.*vulkan.*x64\.zip$/i.test(a.name))
    if (asset) {
      tag = r.tag_name
      break
    }
  }
  if (!asset) throw new Error('no Windows Vulkan build found in the recent llama.cpp releases')

  const tmp = join(root, 'resources', '.llama-tmp')
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  const zip = join(tmp, 'engine.zip')
  console.log(`[llama] downloading ${asset.name} (${Math.round(asset.size / 1e6)} MB)…`)
  const dl = await fetch(asset.browser_download_url)
  if (!dl.ok || !dl.body) throw new Error(`download failed (${dl.status})`)
  await pipeline(Readable.fromWeb(dl.body), createWriteStream(zip))

  // Windows 10 and 11 come with tar, which also unpacks zip files.
  const out = join(tmp, 'x')
  mkdirSync(out)
  const t = spawnSync('tar', ['-xf', zip, '-C', out], { stdio: 'inherit' })
  if (t.status !== 0) throw new Error('could not unpack the engine')

  // the files may sit in a sub folder of the zip
  const files = []
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name))
      else files.push(join(d, e.name))
    }
  }
  walk(out)
  const server = files.find((f) => /[\\/]llama-server\.exe$/i.test(f))
  if (!server) throw new Error('llama-server.exe is not in the download')
  mkdirSync(dir, { recursive: true })
  for (const f of files) if (f === server || /\.dll$/i.test(f)) copyFileSync(f, join(dir, f.split(/[\\/]/).pop()))
  // the Vulkan loader normally comes with the graphics driver; Electron ships one too
  const loader = join(root, 'node_modules', 'electron', 'dist', 'vulkan-1.dll')
  if (!existsSync(join(dir, 'vulkan-1.dll')) && existsSync(loader)) copyFileSync(loader, join(dir, 'vulkan-1.dll'))
  writeFileSync(join(dir, 'VERSION'), `${tag}\n${asset.name}\n`)
  rmSync(tmp, { recursive: true, force: true })
  const size = readdirSync(dir).reduce((n, f) => n + statSync(join(dir, f)).size, 0)
  console.log(`[llama] ok, ${tag}, ${Math.round(size / 1e6)} MB`)
})().catch((e) => {
  console.error('[llama]', e.message)
  process.exit(1)
})
