// The sounds of the Now Playing devices, made on the spot with the Web Audio API (no files):
//  - the turntable: the needle dropping onto the record, the soft crackle and hiss of vinyl while
//    it plays, and the click of the arm lifting off,
//  - the CD deck: the lid click and the disc spinning up, the spin-down when it stops, and the
//    quick seek chirp between songs.
// They play quietly under the music and follow Pulse's volume. Off in Settings → the menu at the
// right edge of Now Playing ("Device sounds").
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
  const device = theme === 'vinyl' || theme === 'cd'
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
