// The sounds of the Now Playing devices, made on the spot with the Web Audio API (no files):
//  - the turntable: the needle dropping onto the record, the soft crackle and hiss of vinyl while
//    it plays, and the click of the arm lifting off,
//  - the CD deck: the lid click and the disc spinning up, the spin-down when it stops, and the
//    quick seek chirp between songs.
// They play quietly under the music and follow Pulse's volume.
import { useEffect, useRef } from 'react'
import type { NpTheme } from '@shared/types'
import { usePlayer } from './player'

let ctx: AudioContext | null = null
let master: GainNode | null = null

function audio(): { ctx: AudioContext; out: GainNode } {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: 'interactive' })
    master = ctx.createGain()
    master.connect(ctx.destination)
  }
  if (ctx.state === 'suspended') void ctx.resume()
  // follows the player's volume (a little lower than the music)
  master!.gain.value = Math.max(0, Math.min(1, usePlayer.getState().volume ?? 0.6)) * 0.9
  return { ctx, out: master! }
}

/** A buffer of noise: white, or with the pops of a record in it. */
function noise(c: AudioContext, seconds: number, kind: 'white' | 'vinyl'): AudioBuffer {
  const len = Math.floor(c.sampleRate * seconds)
  const buf = c.createBuffer(2, len, c.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    let b0 = 0
    let b1 = 0
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1
      if (kind === 'white') {
        d[i] = w
        continue
      }
      // soft brownish hiss
      b0 = 0.995 * b0 + w * 0.05
      b1 = 0.9 * b1 + w * 0.1
      d[i] = (b0 * 0.25 + b1 * 0.12) * 0.5
    }
    if (kind === 'vinyl') {
      // pops and crackles: short decaying clicks, a few big ones, many tiny ones
      const pops = Math.floor(seconds * 9)
      for (let p = 0; p < pops; p++) {
        const at = Math.floor(Math.random() * len)
        const big = Math.random() < 0.12
        const amp = (big ? 0.5 : 0.12) * (0.4 + Math.random() * 0.6) * (Math.random() < 0.5 ? -1 : 1)
        const decay = big ? 0.0025 : 0.0008
        const n = Math.floor(c.sampleRate * decay * 6)
        for (let k = 0; k < n && at + k < len; k++) d[at + k] += amp * Math.exp(-k / (c.sampleRate * decay)) * (k % 2 ? -0.6 : 1)
      }
    }
  }
  return buf
}

let vinylBuf: AudioBuffer | null = null
let whiteBuf: AudioBuffer | null = null

/** A short burst of filtered noise (clicks, thumps). */
function burst(freq: number, q: number, gain: number, ms: number, at = 0, type: BiquadFilterType = 'bandpass'): void {
  const { ctx: c, out } = audio()
  whiteBuf ??= noise(c, 1, 'white')
  const src = c.createBufferSource()
  src.buffer = whiteBuf
  const f = c.createBiquadFilter()
  f.type = type
  f.frequency.value = freq
  f.Q.value = q
  const g = c.createGain()
  const t = c.currentTime + at
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(gain, t + 0.002)
  g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000)
  src.connect(f).connect(g).connect(out)
  src.start(t, Math.random() * 0.5)
  src.stop(t + ms / 1000 + 0.05)
}

/** A low thump (the needle or the lid landing). */
function thump(freq: number, gain: number, ms: number, at = 0): void {
  const { ctx: c, out } = audio()
  const o = c.createOscillator()
  o.type = 'sine'
  const t = c.currentTime + at
  o.frequency.setValueAtTime(freq, t)
  o.frequency.exponentialRampToValueAtTime(freq * 0.5, t + ms / 1000)
  const g = c.createGain()
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(gain, t + 0.004)
  g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000)
  o.connect(g).connect(out)
  o.start(t)
  o.stop(t + ms / 1000 + 0.05)
}

/* ---------- The turntable ---------- */

let crackle: { src: AudioBufferSourceNode; gain: GainNode } | null = null

function startCrackle(delay: number): void {
  if (crackle) return
  const { ctx: c, out } = audio()
  vinylBuf ??= noise(c, 6, 'vinyl')
  const src = c.createBufferSource()
  src.buffer = vinylBuf
  src.loop = true
  const hp = c.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 300
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 9000
  const gain = c.createGain()
  const t = c.currentTime + delay
  gain.gain.setValueAtTime(0, t)
  gain.gain.linearRampToValueAtTime(0.16, t + 0.4)
  src.connect(hp).connect(lp).connect(gain).connect(out)
  src.start(t, Math.random() * 5)
  crackle = { src, gain }
}

function stopCrackle(): void {
  if (!crackle || !ctx) return
  const { src, gain } = crackle
  crackle = null
  const t = ctx.currentTime
  gain.gain.cancelScheduledValues(t)
  gain.gain.setValueAtTime(gain.gain.value, t)
  gain.gain.linearRampToValueAtTime(0, t + 0.25)
  src.stop(t + 0.3)
}

/** The needle lands: a soft thump, a scratch and a pop, then the record's crackle. */
function needleDown(delay = 0.9): void {
  thump(70, 0.35, 180, delay)
  burst(1800, 0.8, 0.12, 60, delay + 0.005)
  burst(4200, 2, 0.08, 25, delay + 0.06)
  startCrackle(delay + 0.05)
}

/** The arm lifts off: a small click and the crackle stops. */
function needleUp(): void {
  stopCrackle()
  burst(3000, 1.5, 0.07, 30)
  thump(140, 0.08, 60, 0.01)
}

/* ---------- The CD deck ---------- */

let whir: { osc: OscillatorNode; gain: GainNode } | null = null

/** The disc spins up: a rising whine with a faint servo buzz. */
function spinUp(): void {
  const { ctx: c, out } = audio()
  burst(2400, 3, 0.08, 18) // the lid / tray click
  thump(120, 0.1, 50)
  const o = c.createOscillator()
  o.type = 'sawtooth'
  const t = c.currentTime + 0.08
  o.frequency.setValueAtTime(90, t)
  o.frequency.exponentialRampToValueAtTime(780, t + 1.1)
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 1400
  const g = c.createGain()
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(0.03, t + 0.3)
  g.gain.linearRampToValueAtTime(0.012, t + 1.1)
  // then it goes quiet, like a real player (the spin-down is heard again when it stops)
  g.gain.linearRampToValueAtTime(0.0001, t + 2.4)
  o.connect(lp).connect(g).connect(out)
  o.start(t)
  // kept, so stopping can wind it down
  stopWhir()
  whir = { osc: o, gain: g }
  // the laser finding the track: a few tiny ticks
  for (let i = 0; i < 3; i++) burst(5200, 4, 0.03, 10, 1.2 + i * 0.07)
}

function stopWhir(): void {
  if (!whir || !ctx) return
  const { osc, gain } = whir
  whir = null
  const t = ctx.currentTime
  gain.gain.cancelScheduledValues(t)
  gain.gain.setValueAtTime(gain.gain.value, t)
  osc.frequency.cancelScheduledValues(t)
  osc.frequency.setValueAtTime(osc.frequency.value, t)
  osc.frequency.exponentialRampToValueAtTime(80, t + 1.1)
  gain.gain.linearRampToValueAtTime(0.02, t + 0.1)
  gain.gain.linearRampToValueAtTime(0, t + 1.2)
  osc.stop(t + 1.3)
}

/** Next song on the CD: the laser jumps (quick ticks). */
function seek(): void {
  for (let i = 0; i < 4; i++) burst(4800 + i * 300, 5, 0.025, 8, i * 0.045)
}

/* ---------- The cassette ---------- */

/** The play key going down (or popping up): a plastic clunk and the motor catching. */
function clunk(down: boolean): void {
  thump(down ? 95 : 130, 0.22, 110)
  burst(down ? 1400 : 2100, 1.2, 0.1, 45, 0.005)
  burst(3800, 3, 0.04, 20, 0.05)
}

/* ---------- Scratching the record ----------
 * Holding the record stops the music (it is turned down to nothing while your hand is on it) and
 * moving it plays the song itself at the speed and in the direction your hand moves it, the way a
 * DJ scratches a record: still = silent, quick back-and-forth = the classic sound. Spotify's own
 * stream can't be read (it's protected), so the sound comes from the song's 30-second preview;
 * when there is none, a short sung phrase made here stands in. */

/** The current song's preview, ready to scratch (mono samples at the context's rate). */
let songBuf: { key: string; data: Float32Array } | null = null
let songLoading: string | null = null

/** Gets the song's preview ready so grabbing the record sounds like the song. */
export async function prepareScratch(key: string, title: string, artist: string): Promise<void> {
  if (songBuf?.key === key || songLoading === key) return
  songLoading = key
  try {
    const b64 = await window.pulse.recs.preview(title, artist)
    if (!b64 || songLoading !== key) return
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))
    const { ctx: c } = audio()
    const decoded = await c.decodeAudioData(bytes.buffer)
    const l = decoded.getChannelData(0)
    const r = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : l
    const data = new Float32Array(l.length)
    let peak = 0
    for (let i = 0; i < l.length; i++) {
      data[i] = (l[i] + r[i]) * 0.5
      peak = Math.max(peak, Math.abs(data[i]))
    }
    if (peak > 0) for (let i = 0; i < data.length; i++) data[i] = (data[i] / peak) * 0.95
    if (songLoading === key) songBuf = { key, data }
  } catch (e) {
    console.warn('[np sounds] preview', e)
  } finally {
    if (songLoading === key) songLoading = null
  }
}

let phrase: Float32Array | null = null

/** About 2.4 s of four vowel syllables at a rising and falling pitch. */
function makePhrase(rate: number): Float32Array {
  const len = Math.floor(rate * 2.4)
  const out = new Float32Array(len)
  // a sawtooth voice through three vowel resonances ("ah"), a puff of breath at each syllable
  const formants = [
    { f: 780, bw: 90, g: 1 },
    { f: 1180, bw: 110, g: 0.55 },
    { f: 2700, bw: 160, g: 0.22 }
  ].map((x) => {
    const r = Math.exp((-Math.PI * x.bw) / rate)
    return { a1: 2 * r * Math.cos((2 * Math.PI * x.f) / rate), a2: -r * r, g: x.g * (1 - r), y1: 0, y2: 0 }
  })
  let phase = 0
  let breath = 0
  const syll = [
    { at: 0.0, len: 0.42, f0: 170 },
    { at: 0.55, len: 0.38, f0: 215 },
    { at: 1.05, len: 0.5, f0: 150 },
    { at: 1.7, len: 0.55, f0: 190 }
  ]
  for (let i = 0; i < len; i++) {
    const t = i / rate
    const s = syll.find((x) => t >= x.at && t < x.at + x.len)
    let src = 0
    let env = 0
    if (s) {
      const u = (t - s.at) / s.len
      env = Math.min(1, u * 25) * Math.pow(1 - u, 0.6)
      const f0 = s.f0 * (1 + 0.12 * Math.sin(u * Math.PI))
      phase += f0 / rate
      if (phase >= 1) phase -= 1
      src = (phase * 2 - 1) * env
      // breath at the start of the syllable
      breath = u < 0.12 ? (1 - u / 0.12) * 0.5 : 0
    } else breath = 0
    let y = 0
    for (const fm of formants) {
      const v = fm.g * src + fm.a1 * fm.y1 + fm.a2 * fm.y2
      fm.y2 = fm.y1
      fm.y1 = v
      y += v
    }
    out[i] = y * 2.2 + (Math.random() * 2 - 1) * breath * 0.25
  }
  // normalise
  let peak = 0
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(out[i]))
  if (peak > 0) for (let i = 0; i < len; i++) out[i] = (out[i] / peak) * 0.9
  return out
}

let scratchNode: ScriptProcessorNode | null = null
let scratchGain: GainNode | null = null
const scr = { target: 0, rate: 0, head: 0, lp: 0 }

/** Your hand is on the record. `key` is the song on it, `at` how far into the song it is (0–1). */
export function scratchStart(key: string | null, at = 0): void {
  try {
    const { ctx: c, out } = audio()
    if (scratchNode) return
    let p: Float32Array
    if (key && songBuf?.key === key) p = songBuf.data
    else p = phrase ??= makePhrase(c.sampleRate)
    scr.head = Math.floor(Math.max(0, Math.min(0.98, at)) * (p.length - 2))
    scr.rate = 0
    scr.target = 0
    // the record stopping under your hand: a soft rub
    burst(900, 0.7, 0.1, 70)
    const node = c.createScriptProcessor(1024, 0, 2)
    node.onaudioprocess = (e) => {
      const l = e.outputBuffer.getChannelData(0)
      const r = e.outputBuffer.getChannelData(1)
      for (let i = 0; i < l.length; i++) {
        // the hand's speed, smoothed over a few milliseconds (a record has weight)
        scr.rate += (scr.target - scr.rate) * 0.004
        scr.head += scr.rate
        if (scr.head < 0) scr.head += p.length
        else if (scr.head >= p.length - 1) scr.head -= p.length - 1
        const k = Math.floor(scr.head)
        const f = scr.head - k
        let v = p[k] * (1 - f) + p[k + 1] * f
        const speed = Math.min(1.5, Math.abs(scr.rate))
        // slow movement sounds duller, like the real thing
        scr.lp += (v - scr.lp) * Math.min(1, 0.05 + speed * 0.6)
        v = scr.lp * Math.min(1, speed * 1.6) + (Math.random() * 2 - 1) * 0.02 * Math.min(1, speed)
        l[i] = v
        r[i] = v
      }
    }
    const g = c.createGain()
    // the scratch takes the music's place, so it is about as loud as the music
    g.gain.value = 1
    node.connect(g).connect(out)
    scratchNode = node
    scratchGain = g
  } catch (e) {
    console.warn('[np sounds] scratch', e)
  }
}

/** How fast the record moves under your hand: 1 = normal speed forwards, negative = backwards. */
export function scratchMove(rate: number): void {
  scr.target = Math.max(-6, Math.min(6, rate))
}

/** Your hand lets go. */
export function scratchStop(): void {
  scr.target = 0
  const node = scratchNode
  const g = scratchGain
  scratchNode = null
  scratchGain = null
  if (!node || !g || !ctx) return
  const t = ctx.currentTime
  g.gain.setValueAtTime(g.gain.value, t)
  g.gain.linearRampToValueAtTime(0, t + 0.12)
  window.setTimeout(() => {
    node.disconnect()
    g.disconnect()
  }, 200)
}

/* ---------- Following the player ---------- */

function stopAll(): void {
  stopCrackle()
  stopWhir()
}

/** Plays the device sounds for the look on screen while Now Playing is open. */
export function useNpSounds(theme: NpTheme, open: boolean, enabled: boolean): void {
  const paused = usePlayer((s) => s.paused)
  const trackId = usePlayer((s) => s.track?.id ?? null)
  const prev = useRef<{ paused: boolean; trackId: string | null; on: boolean; theme: NpTheme }>({ paused: true, trackId: null, on: false, theme })
  const device = theme === 'vinyl' || theme === 'cd' || theme === 'cassette'
  const on = open && enabled && device

  useEffect(() => {
    // another look counts as a fresh start
    const was = prev.current.theme === theme ? prev.current : { ...prev.current, on: false }
    prev.current = { paused, trackId, on, theme }
    if (!on) {
      if (was.on) stopAll()
      return
    }
    const playing = !paused && !!trackId
    try {
      if (theme === 'vinyl') {
        // just opened, or started playing: the needle goes down
        if (playing && (!was.on || was.paused)) needleDown(was.on ? 0.9 : 0.4)
        else if (!playing && was.on && !was.paused) needleUp()
        else if (playing && was.trackId && trackId !== was.trackId) {
          // a new song: the crackle carries on, with a small pop at the change
          burst(2500, 1, 0.08, 40)
          startCrackle(0)
        }
      } else if (theme === 'cassette') {
        if (playing && was.on && was.paused) clunk(true)
        else if (!playing && was.on && !was.paused) clunk(false)
      } else {
        if (playing && (!was.on || was.paused)) spinUp()
        else if (!playing && was.on && !was.paused) stopWhir()
        else if (playing && was.trackId && trackId !== was.trackId) seek()
      }
    } catch (e) {
      console.warn('[np sounds]', e)
    }
  }, [paused, trackId, on, theme])

  // switching looks or closing: everything stops
  useEffect(() => () => stopAll(), [theme, open])
}
