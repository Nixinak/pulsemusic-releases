// Downloads Cloudflare's tunnel program (used by Party mode for internet links) into
// resources/bin before packaging, so the installer already contains it and nobody waits
// for a download the first time they start a party. Skips when it's already there.
const { existsSync, mkdirSync, createWriteStream, renameSync, statSync } = require('node:fs')
const { join } = require('node:path')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')

const URL = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
const dir = join(__dirname, '..', 'resources', 'bin')
const file = join(dir, 'cloudflared.exe')

;(async () => {
  if (existsSync(file) && statSync(file).size > 1_000_000) return console.log('[cloudflared] already there')
  mkdirSync(dir, { recursive: true })
  console.log('[cloudflared] downloading for the installer…')
  const res = await fetch(URL)
  if (!res.ok || !res.body) throw new Error(`download failed (${res.status})`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file + '.part'))
  renameSync(file + '.part', file)
  console.log('[cloudflared] ok', Math.round(statSync(file).size / 1e6), 'MB')
})().catch((e) => {
  console.error('[cloudflared]', e.message)
  process.exit(1)
})
