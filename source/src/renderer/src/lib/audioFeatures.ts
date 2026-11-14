// Tempo (BPM) and musical key of a song, worked out from its 30-second preview. Spotify no
// longer gives apps these "audio features", so Pulse measures them itself:
//  - tempo: how often the sound gets suddenly louder/brighter (onsets), and which beat
//    period repeats most (autocorrelation);
//  - key: how strongly each of the 12 notes sounds (a "chroma" profile), compared with the
//    typical profile of every major and minor key (Krumhansl–Schmuckler).
// Results are saved on disk, so each song is analysed once.
import { readSaved, writeSaved } from './persist'

export interface Features {
  bpm: number
  /** Camelot wheel code, e.g. "8A" (A minor) or "8B" (C major). DJs use it to mix in key. */
  camelot: string
  /** 1–12 on the Camelot wheel. */
  num: number
  minor: boolean
}

const SR = 22050

/* ---------- FFT (radix 2, in place) ---------- */

function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k
        const b = a + len / 2
        const tr = re[b] * cr - im[b] * ci
        const ti = re[b] * ci + im[b] * cr
        re[b] = re[a] - tr
        im[b] = im[a] - ti
        re[a] += tr
        im[a] += ti
        const nr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = nr
      }
    }
  }
}

function hann(n: number): Float32Array {
  const w = new Float32Array(n)
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))
  return w
}

/* ---------- Tempo ---------- */

function tempo(x: Float32Array): number {
  const N = 1024
  const hop = 512
  const win = hann(N)
  const re = new Float32Array(N)
  const im = new Float32Array(N)
  let prev = new Float32Array(N / 2)
  const flux: number[] = []
  for (let s = 0; s + N <= x.length; s += hop) {
    for (let i = 0; i < N; i++) {
      re[i] = x[s + i] * win[i]
      im[i] = 0
    }
    fft(re, im)
    const mag = new Float32Array(N / 2)
    let f = 0
    for (let k = 1; k < N / 2; k++) {
      mag[k] = Math.log1p(10 * Math.hypot(re[k], im[k]))
      const d = mag[k] - prev[k]
      if (d > 0) f += d
    }
    flux.push(f)
    prev = mag
  }
  // Remove the slow trend so only the beats stand out.
  const m = flux.length
  const env = new Float32Array(m)
  for (let i = 0; i < m; i++) {
    let sum = 0
    let c = 0
    for (let j = Math.max(0, i - 8); j <= Math.min(m - 1, i + 8); j++) (sum += flux[j]), c++
    env[i] = Math.max(0, flux[i] - sum / c)
  }
  const fps = SR / hop
  // Autocorrelation of the onset envelope for every lag up to four beats at 55 BPM.
  const maxLagAll = Math.ceil((fps * 60 * 4) / 55)
  const ac = new Float32Array(maxLagAll + 2)
  for (let lag = 1; lag <= maxLagAll + 1 && lag < m; lag++) {
    let s = 0
    for (let i = 0; i + lag < m; i++) s += env[i] * env[i + lag]
    ac[lag] = s / (m - lag)
  }
  const at = (l: number): number => {
    const i = Math.floor(l)
    const f = l - i
    return i + 1 < ac.length ? ac[i] * (1 - f) + ac[i + 1] * f : 0
  }
  // A real beat also repeats at 2, 3 and 4 beats; a wrong guess (like 2/3 of the tempo) doesn't
  // line up with all of them. Score each tempo by its beat and those multiples.
  let best = 0
  let bestBpm = 120
  for (let bpm = 60; bpm <= 200; bpm += 0.5) {
    const lag = (fps * 60) / bpm
    const comb = at(lag) + at(2 * lag) * 0.8 + at(3 * lag) * 0.6 + at(4 * lag) * 0.5
    // Prefer common tempos a little (a broad bump around 120 BPM).
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 1.1, 2))
    const v = comb * prior
    if (v > best) (best = v), (bestBpm = bpm)
  }
  let bpm = bestBpm
  while (bpm < 70) bpm *= 2
  while (bpm >= 180) bpm /= 2
  return Math.round(bpm)
}

/* ---------- Key ---------- */

const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

function corr(a: number[], b: number[]): number {
  const ma = a.reduce((s, v) => s + v, 0) / a.length
  const mb = b.reduce((s, v) => s + v, 0) / b.length
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb)
    da += (a[i] - ma) ** 2
    db += (b[i] - mb) ** 2
  }
  return num / Math.sqrt(da * db || 1)
}

function key(x: Float32Array): { pc: number; minor: boolean } {
  const N = 4096
  const hop = 2048
  const win = hann(N)
  const re = new Float32Array(N)
  const im = new Float32Array(N)
  const chroma = new Array(12).fill(0)
  // Which pitch class each FFT bin belongs to (only 55 Hz – 2 kHz, where notes are clear).
  const binPc = new Int8Array(N / 2).fill(-1)
  for (let k = 1; k < N / 2; k++) {
    const f = (k * SR) / N
    if (f < 55 || f > 2000) continue
    binPc[k] = (((Math.round(12 * Math.log2(f / 440)) + 9) % 12) + 12) % 12
  }
  for (let s = 0; s + N <= x.length; s += hop) {
    for (let i = 0; i < N; i++) {
      re[i] = x[s + i] * win[i]
      im[i] = 0
    }
    fft(re, im)
    for (let k = 1; k < N / 2; k++) if (binPc[k] >= 0) chroma[binPc[k]] += Math.sqrt(Math.hypot(re[k], im[k]))
  }
  let best = -Infinity
  let out = { pc: 0, minor: false }
  for (let pc = 0; pc < 12; pc++) {
    const rotated = chroma.slice(pc).concat(chroma.slice(0, pc))
    const maj = corr(rotated, MAJOR)
    const min = corr(rotated, MINOR)
    if (maj > best) (best = maj), (out = { pc, minor: false })
    if (min > best) (best = min), (out = { pc, minor: true })
  }
  return out
}

/** Camelot number for a key: C major = 8B, A minor = 8A, one step = a fifth. */
function camelot(pc: number, minor: boolean): { num: number; code: string } {
  const majorPc = minor ? (pc + 3) % 12 : pc
  const num = (((majorPc * 7) % 12) + 7) % 12 + 1
  return { num, code: `${num}${minor ? 'A' : 'B'}` }
}

/* ---------- Public ---------- */

/** Tempo and key of mono audio at 22 050 Hz. */
export async function analyse(x: Float32Array): Promise<Features> {
  // Let the page breathe between the two heavy steps.
  await new Promise((r) => setTimeout(r, 0))
  const bpm = tempo(x)
  await new Promise((r) => setTimeout(r, 0))
  const kk = key(x)
  const c = camelot(kk.pc, kk.minor)
  return { bpm, camelot: c.code, num: c.num, minor: kk.minor }
}

async function decode(base64: string): Promise<Float32Array> {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  const ctx = new OfflineAudioContext(1, SR * 31, SR)
  const buf = await ctx.decodeAudioData(bytes.buffer)
  if (buf.numberOfChannels === 1) return buf.getChannelData(0)
  const a = buf.getChannelData(0)
  const b = buf.getChannelData(1)
  const mono = new Float32Array(a.length)
  for (let i = 0; i < a.length; i++) mono[i] = (a[i] + b[i]) / 2
  return mono
}

const running = new Map<string, Promise<Features | null>>()

/** Tempo and key of a song (null when no preview exists). Cached on disk. */
export function songFeatures(t: { id: string; name: string; artists: { name: string }[] }): Promise<Features | null> {
  const k = `feat:${t.id}`
  let p = running.get(k)
  if (p) return p
  p = (async () => {
    const saved = await readSaved<Features | 'none'>(k)
    if (saved) return saved.d === 'none' ? null : saved.d
    const b64 = await window.pulse.recs.preview(t.name, t.artists[0]?.name ?? '')
    if (!b64) {
      void writeSaved(k, 'none')
      return null
    }
    const f = await analyse(await decode(b64))
    void writeSaved(k, f)
    return f
  })().catch((e) => {
    console.warn('[features] failed', e)
    return null
  })
  running.set(k, p)
  return p
}

/** How well two keys mix, 0–1 (same key, neighbours on the wheel, or relative major/minor). */
export function keyMatch(a: Features, b: Features): number {
  const d = Math.min(Math.abs(a.num - b.num), 12 - Math.abs(a.num - b.num))
  if (d === 0) return a.minor === b.minor ? 1 : 0.85
  if (d === 1) return a.minor === b.minor ? 0.8 : 0.45
  if (d === 2) return 0.35
  return 0.1
}

/** How close two tempos are, 0–1; half and double time count as close. */
export function bpmMatch(a: number, b: number): number {
  const d = Math.min(Math.abs(a - b), Math.abs(a * 2 - b), Math.abs(a - b * 2))
  return Math.exp(-(d * d) / (2 * 7 * 7))
}
