// The AI DJ's voice: Kokoro-82M, an open neural voice model that sounds close to a real
// person. It runs inside the app (ONNX on the processor), needs no Python, and downloads
// its model once (about 330 MB) into the user data folder.
import { app, type WebContents } from 'electron'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { DjVoiceId, VoiceStatus } from '@shared/types'

type Kokoro = import('kokoro-js').KokoroTTS

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX'
const cacheDir = (): string => join(app.getPath('userData'), 'voice-model')

/** The six voices offered: the best-rated ones from the model card. */
export const VOICES: { id: DjVoiceId; name: string; gender: 'female' | 'male'; accent: string }[] = [
  { id: 'af_heart', name: 'Heart', gender: 'female', accent: 'American' },
  { id: 'af_bella', name: 'Bella', gender: 'female', accent: 'American' },
  { id: 'bf_emma', name: 'Emma', gender: 'female', accent: 'British' },
  { id: 'am_michael', name: 'Michael', gender: 'male', accent: 'American' },
  { id: 'am_fenrir', name: 'Fenrir', gender: 'male', accent: 'American' },
  { id: 'bm_george', name: 'George', gender: 'male', accent: 'British' }
]

export const voiceInstalled = (): boolean => {
  try {
    const dir = join(cacheDir(), ...MODEL.split('/'), 'onnx')
    return existsSync(dir) && readdirSync(dir).some((f) => f.endsWith('.onnx'))
  } catch {
    return false
  }
}

let model: Promise<Kokoro> | null = null

function load(sender?: WebContents): Promise<Kokoro> {
  if (model) return model
  model = (async () => {
    mkdirSync(cacheDir(), { recursive: true })
    // Loaded lazily so the app starts fast; require keeps one shared copy of the library.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tf = require('@huggingface/transformers') as typeof import('@huggingface/transformers')
    tf.env.cacheDir = cacheDir()
    tf.env.allowLocalModels = false
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { KokoroTTS } = require('kokoro-js') as typeof import('kokoro-js')
    const files = new Map<string, { loaded: number; total: number }>()
    return KokoroTTS.from_pretrained(MODEL, {
      dtype: 'fp32',
      device: 'cpu',
      progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (!sender || sender.isDestroyed() || p.status !== 'progress' || !p.file) return
        files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 })
        let loaded = 0
        let total = 0
        for (const f of files.values()) {
          loaded += f.loaded
          total += f.total
        }
        sender.send('dj:install-progress', { stage: 'Downloading the voice model', done: loaded, total })
      }
    })
  })()
  model.catch(() => {
    model = null
  })
  return model
}

export async function installVoice(sender: WebContents): Promise<boolean> {
  try {
    await load(sender)
    if (!sender.isDestroyed()) sender.send('dj:install-progress', { stage: 'Ready', done: 0, total: 0 })
    return true
  } catch (e) {
    console.error('[voice] install failed', e)
    if (!sender.isDestroyed()) sender.send('dj:install-progress', { stage: `Failed: ${e instanceof Error ? e.message : String(e)}`, done: 0, total: 0 })
    return false
  }
}

export function voiceStatus(): VoiceStatus {
  return { installed: voiceInstalled(), voices: VOICES }
}

/** Removes files left by earlier voice engines (Piper, XTTS). */
export function cleanOldVoices(): void {
  for (const dir of ['piper', 'voice']) rmSync(join(app.getPath('userData'), dir), { recursive: true, force: true })
}

export async function speak(text: string, voice: DjVoiceId): Promise<{ ok: true; wav: string } | { ok: false; error: string }> {
  try {
    if (!voiceInstalled() && !model) return { ok: false, error: 'The voice isn’t installed yet. Install it in Settings → AI DJ.' }
    const tts = await load()
    const id = VOICES.some((v) => v.id === voice) ? voice : 'af_heart'
    // Sentence by sentence (long lines would be cut off), joined with short pauses. The
    // library's own stream() never releases the last sentence, so the text is split here.
    const sentences = (text.replace(/\s+/g, ' ').trim().match(/[^.!?…]+[.!?…]*["”’)]*\s*/g) ?? [text])
      .map((x) => x.trim())
      .filter(Boolean)
    const parts: Float32Array[] = []
    const pause = new Float32Array(Math.round(24000 * 0.18))
    for (const sentence of sentences) {
      const audio = await tts.generate(sentence, { voice: id, speed: 1 })
      parts.push((audio as unknown as { audio: Float32Array }).audio, pause)
    }
    const length = parts.reduce((n, p) => n + p.length, 0)
    const all = new Float32Array(length)
    let o = 0
    for (const p of parts) {
      all.set(p, o)
      o += p.length
    }
    return { ok: true, wav: encodeWav(all, 24000).toString('base64') }
  } catch (e) {
    console.error('[voice] speak failed', e)
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function encodeWav(samples: Float32Array, rate: number): Buffer {
  const buf = Buffer.alloc(44 + samples.length * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + samples.length * 2, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(samples.length * 2, 40)
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2)
  return buf
}
