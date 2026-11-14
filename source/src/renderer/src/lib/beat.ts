// The music's beat, for things that move with it (the DJ orb and its ring).
// Spotify's audio is protected, so the page can't listen to it directly. On Windows Pulse
// listens to what the computer plays instead (loopback audio: only levels are measured, nothing
// is recorded or saved) and finds the kicks in the low end. Elsewhere, or when that isn't
// possible, it pulses at the song's tempo (measured from its preview, lib/audioFeatures).
import { useEffect } from 'react'
import { livePosition, usePlayer } from './player'
import { songFeatures } from './audioFeatures'

export const BANDS = 56

export interface BeatFrame {
  /** How loud it is now, 0–1. */
  level: number
  /** 1 on a kick, fading out quickly. */
  kick: number
  /** Loudness per frequency band (low to high), 0–1, for a spectrum ring. */
  bands: Float32Array
  /** True when this comes from the real sound (not the tempo guess). */
  live: boolean
}

const frame: BeatFrame = { level: 0, kick: 0, bands: new Float32Array(BANDS), live: false }

let users = 0
let starting: Promise<void> | null = null
let stream: MediaStream | null = null
let ctx: AudioContext | null = null
let analyser: AnalyserNode | null = null
let freq: Uint8Array<ArrayBuffer> | null = null
/** Band edges in FFT bins (log spaced, 40 Hz – 14 kHz). */
let edges: number[] = []
let failed = false
let lastAt = 0
let bassAvg = 0
let bassVar = 0
let lastKick = 0
let stopTimer = 0

/** What the computer plays: Electron's display capture with loopback audio (the main process
 *  hands over the screen and the sound), or Chromium's older desktop capture as a fallback. The
 *  picture is required by both but stopped straight away. */
async function captureOutput(): Promise<MediaStream> {
  const id = await window.pulse.recs?.loopbackSource?.().catch(() => null)
  if (!id) throw new Error('no loopback here')
  try {
    return await navigator.mediaDevices.getDisplayMedia({ audio: true, video: { width: 16, height: 16, frameRate: 1 } })
  } catch (e) {
    console.info('[beat] display capture refused, trying desktop capture:', e instanceof Error ? e.message : e)
  }
  return navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'desktop' } },
    video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: id, maxWidth: 16, maxHeight: 16, maxFrameRate: 1 } }
  } as unknown as MediaStreamConstraints)
}

async function startLoopback(): Promise<void> {
  const s = await captureOutput()
  s.getVideoTracks().forEach((t) => t.stop())
  const audio = s.getAudioTracks()
  if (!audio.length) {
    s.getTracks().forEach((t) => t.stop())
    throw new Error('no audio track')
  }
  if (users === 0) {
    // nobody needs it any more
    s.getTracks().forEach((t) => t.stop())
    return
  }
  stream = s
  ctx = new AudioContext({ latencyHint: 'interactive' })
  const src = ctx.createMediaStreamSource(new MediaStream(audio))
  analyser = ctx.createAnalyser()
  analyser.fftSize = 2048
  analyser.smoothingTimeConstant = 0.55
  analyser.minDecibels = -85
  analyser.maxDecibels = -20
  src.connect(analyser)
  // silent output keeps the graph running without playing the sound twice
  const mute = ctx.createGain()
  mute.gain.value = 0
  analyser.connect(mute).connect(ctx.destination)
  freq = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount))
  const hz = ctx.sampleRate / analyser.fftSize
  edges = Array.from({ length: BANDS + 1 }, (_, i) => Math.max(1, Math.round((40 * Math.pow(14000 / 40, i / BANDS)) / hz)))
  for (let i = 1; i < edges.length; i++) if (edges[i] <= edges[i - 1]) edges[i] = edges[i - 1] + 1
  frame.live = true
}

function stopLoopback(): void {
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
  void ctx?.close().catch(() => undefined)
  ctx = null
  analyser = null
  freq = null
  frame.live = false
}

/** Keeps the beat running while a component that shows it is on screen. */
export function useBeat(on = true): void {
  useEffect(() => {
    if (!on) return
    users++
    window.clearTimeout(stopTimer)
    if (!stream && !starting && !failed) {
      starting = startLoopback()
        .catch((e) => {
          failed = true
          console.info('[beat] following the tempo instead of the sound:', e instanceof Error ? e.message : e)
        })
        .finally(() => (starting = null))
    }
    return () => {
      users--
      // a moment's grace, so going back and forth between pages doesn't restart it
      if (users === 0) stopTimer = window.setTimeout(() => users === 0 && stopLoopback(), 4000)
    }
  }, [on])
}

/* ---------- The tempo guess ---------- */

let tempoFor = ''
let bpm = 0
function tempoOf(): number {
  const t = usePlayer.getState().track
  if (!t) return 0
  if (tempoFor !== t.id) {
    tempoFor = t.id
    bpm = 0
    const id = t.id
    void songFeatures({ id: t.id, name: t.name, artists: t.artists })
      .then((f) => {
        if (tempoFor === id && f) bpm = f.bpm
      })
      .catch(() => undefined)
  }
  return bpm
}

/** The beat right now. Call it from an animation frame; it does the work once per frame. */
export function readBeat(): BeatFrame {
  const now = performance.now()
  if (now - lastAt < 8) return frame
  const dt = Math.min(100, now - lastAt)
  lastAt = now
  const fade = Math.exp(-dt / 140)
  frame.kick *= fade

  const playing = !usePlayer.getState().paused && !!usePlayer.getState().track
  if (analyser && freq) {
    analyser.getByteFrequencyData(freq)
    let total = 0
    for (let b = 0; b < BANDS; b++) {
      let sum = 0
      let n = 0
      for (let i = edges[b]; i < edges[b + 1] && i < freq.length; i++, n++) sum += freq[i]
      const v = n ? sum / n / 255 : 0
      // a little tilt, so the highs aren't always shorter than the lows
      const shaped = Math.min(1, v * (0.85 + (b / BANDS) * 0.45))
      frame.bands[b] += (shaped - frame.bands[b]) * (shaped > frame.bands[b] ? 0.6 : 0.18)
      total += v
    }
    const level = total / BANDS
    frame.level += (level - frame.level) * 0.3
    // the low end (about 40–150 Hz): a kick is a jump well above its recent average
    let bass = 0
    for (let b = 0; b < 10; b++) bass += frame.bands[b]
    bass /= 10
    const diff = bass - bassAvg
    bassAvg += diff * 0.06
    bassVar += (diff * diff - bassVar) * 0.06
    if (diff > Math.max(0.045, Math.sqrt(bassVar) * 1.3) && now - lastKick > 240) {
      lastKick = now
      frame.kick = 1
    }
    return frame
  }

  // no sound to listen to: pulse at the song's tempo while it plays
  const tempo = playing ? tempoOf() : 0
  if (tempo > 0) {
    const beatMs = 60_000 / tempo
    const phase = (livePosition(usePlayer.getState()) % beatMs) / beatMs
    frame.kick = Math.max(frame.kick, Math.pow(1 - phase, 5))
  }
  const target = playing ? 0.45 : 0
  frame.level += (target - frame.level) * 0.05
  for (let b = 0; b < BANDS; b++) {
    const wave = playing ? 0.25 + 0.2 * Math.sin(now / 420 + b * 0.55) + frame.kick * 0.45 * (1 - b / BANDS) : 0
    frame.bands[b] += (wave - frame.bands[b]) * 0.2
  }
  return frame
}
