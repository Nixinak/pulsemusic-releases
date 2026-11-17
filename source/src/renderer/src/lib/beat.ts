// The music's beat, for things that move with it (the DJ orb, the visualizer).
// Spotify's audio is protected, so the page can't listen to it directly. In order of preference:
//  1. what the computer plays (Windows loopback audio: only levels are measured, nothing is
//     recorded or saved), with the kicks found in the low end,
//  2. Spotify's own analysis of the song (when your Spotify account is connected in Pulse): every
//     beat, and the loudness and sound of each slice of the song, followed at the exact position,
//  3. the song's tempo (measured from its preview, lib/audioFeatures).
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
  /** Where it comes from: the sound itself, Spotify's analysis of the song, or the tempo. */
  source: 'sound' | 'analysis' | 'tempo'
}

const frame: BeatFrame = {
  level: 0,
  kick: 0,
  bands: new Float32Array(BANDS),
  live: false,
  source: 'tempo'
}

let users = 0
let starting: Promise<void> | null = null
let stream: MediaStream | null = null
let ctx: AudioContext | null = null
let analyser: AnalyserNode | null = null
let freq: Uint8Array<ArrayBuffer> | null = null
/** Band edges in FFT bins (log spaced, 40 Hz – 14 kHz). */
let edges: number[] = []
/** When capturing the sound last failed (it is tried again after a while). */
let failedAt = 0
let lastAt = 0
let bassAvg = 0
let bassVar = 0
let lastKick = 0
/** When the captured sound last had something in it. */
let loudAt = 0
/** Each band's recent loudest, so quiet highs move as much as loud lows (it sinks slowly). */
const peaks = new Float32Array(BANDS).fill(0.3)
let stopTimer = 0

/** What the computer plays: Electron's display capture with loopback audio (the main process
 *  hands over the screen and the sound), or Chromium's older desktop capture as a fallback. The
 *  picture is required by both but stopped straight away. */
async function captureOutput(): Promise<MediaStream> {
  const id = await window.pulse.recs?.loopbackSource?.().catch(() => null)
  if (!id) throw new Error('no loopback here')
  try {
    return await navigator.mediaDevices.getDisplayMedia({
      audio: true,
      video: { width: 16, height: 16, frameRate: 1 }
    })
  } catch (e) {
    console.info('[beat] display capture refused, trying desktop capture:', e instanceof Error ? e.message : e)
  }
  return navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'desktop' } },
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: id,
        maxWidth: 16,
        maxHeight: 16,
        maxFrameRate: 1
      }
    }
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
  analyser.smoothingTimeConstant = 0.3
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
    if (!stream && !starting && Date.now() - failedAt > 60_000) {
      starting = startLoopback()
        .catch((e) => {
          failedAt = Date.now()
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

/* ---------- Spotify's analysis of the song ---------- */

let analysisFor = ''
let analysis: { beats: number[]; bars: number[]; segments: number[][] } | null = null
let segAt = 0
let beatAt = 0
let lastPos = -1

function analysisOf(): typeof analysis {
  const t = usePlayer.getState().track
  if (!t) return null
  if (analysisFor !== t.id) {
    analysisFor = t.id
    analysis = null
    segAt = 0
    beatAt = 0
    const id = t.id
    void window.pulse.spotifyAccount
      ?.analysis(id)
      .then((a) => {
        if (analysisFor === id && a?.segments?.length) analysis = a
      })
      .catch(() => undefined)
  }
  return analysis
}

/** dB (about -60 to 0) to 0–1. */
const fromDb = (db: number): number => Math.max(0, Math.min(1, (db + 42) / 38))

/** The beat at the song's position, from Spotify's analysis. */
function fromAnalysis(a: NonNullable<typeof analysis>, posSec: number, now: number): void {
  const segs = a.segments
  // a jump (seek, new song): find the place again
  if (posSec < lastPos - 0.5 || posSec > lastPos + 2) {
    segAt = 0
    beatAt = 0
  }
  lastPos = posSec
  while (segAt < segs.length - 1 && segs[segAt + 1][0] <= posSec) segAt++
  while (beatAt < a.beats.length && a.beats[beatAt] <= posSec) {
    beatAt++
    // a beat: harder on the first of a bar
    const onBar = a.bars.some((b) => Math.abs(b - a.beats[beatAt - 1]) < 0.05)
    frame.kick = Math.max(frame.kick, onBar ? 1 : 0.75)
    lastKick = now
  }
  const s = segs[segAt]
  if (!s) return
  const [start, maxDb, startDb, maxT] = s
  const next = segs[segAt + 1]
  const into = posSec - start
  // loudness rises to its peak inside the slice, then falls towards the next one
  const db =
    into < maxT
      ? startDb + (maxDb - startDb) * (into / Math.max(0.01, maxT))
      : maxDb + ((next ? next[2] : maxDb - 20) - maxDb) * Math.min(1, (into - maxT) / Math.max(0.05, (next ? next[0] : start + 0.5) - start - maxT))
  const level = fromDb(db)
  frame.level += (level - frame.level) * 0.5
  const pitches = s.slice(4, 16)
  const timbre = s.slice(16, 28)
  // timbre[1] is how bright the sound is, timbre[2] how flat (noisy), timbre[3] how sharp the attack
  const bright = Math.max(0, Math.min(1, ((timbre[1] ?? 0) + 60) / 220))
  const attack = Math.max(0, Math.min(1, ((timbre[3] ?? 0) + 40) / 120))
  for (let b = 0; b < BANDS; b++) {
    const x = b / (BANDS - 1)
    let v: number
    if (x < 0.22) {
      // the low end: the loudness and the beat
      v = level * (0.75 + 0.25 * Math.cos(x * 9)) + frame.kick * 0.55 * (1 - x / 0.22)
    } else if (x < 0.72) {
      // the middle: the notes being played (12 pitch classes spread over the bands)
      const p = pitches[Math.floor(((x - 0.22) / 0.5) * 24) % 12] ?? 0
      v = level * (0.35 + 0.75 * p)
    } else {
      // the top: brightness and the attack of each hit
      v = level * (0.2 + 0.7 * bright) * (0.6 + 0.4 * attack) * (1 - (x - 0.72) * 0.9)
    }
    // a little shimmer so neighbouring bars don't move in lockstep
    v *= 0.88 + 0.12 * Math.sin(now / 90 + b * 1.7)
    const shaped = Math.max(0, Math.min(1, v))
    frame.bands[b] += (shaped - frame.bands[b]) * (shaped > frame.bands[b] ? 0.7 : 0.2)
  }
}

/* ---------- The tempo guess ---------- */

let shapeBeat = -1
const shape = new Float32Array(BANDS)

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
  // the captured sound stays silent while music plays (some systems hand over nothing):
  // then the analysis below is used instead
  if (analyser && freq && playing) {
    analyser.getByteFrequencyData(freq)
    let sum = 0
    for (let i = 0; i < freq.length; i += 8) sum += freq[i]
    if (sum > freq.length * 0.4) loudAt = now
  }
  const soundWorks = !!analyser && !!freq && (now - loudAt < 2500 || !playing)
  if (analyser && freq && soundWorks) {
    analyser.getByteFrequencyData(freq)
    let total = 0
    for (let b = 0; b < BANDS; b++) {
      let sum = 0
      let n = 0
      for (let i = edges[b]; i < edges[b + 1] && i < freq.length; i++, n++) sum += freq[i]
      const v = n ? sum / n / 255 : 0
      // each band against its own recent loudest: the shape of the music, not just its volume
      peaks[b] = Math.max(v, peaks[b] * Math.exp(-dt / 2500), 0.12)
      const rel = v / peaks[b]
      // a curve that makes the hits stand out from what's always there
      const shaped = Math.min(1, Math.pow(rel, 1.6) * 0.92 + v * 0.15)
      frame.bands[b] += (shaped - frame.bands[b]) * (shaped > frame.bands[b] ? 0.85 : 0.22)
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
    frame.source = 'sound'
    return frame
  }

  // no sound to listen to: Spotify's analysis of the song, at the exact position
  const an = playing ? analysisOf() : null
  if (an) {
    frame.source = 'analysis'
    fromAnalysis(an, livePosition(usePlayer.getState()) / 1000, now)
    return frame
  }
  frame.source = 'tempo'

  // no sound to listen to: pulse at the song's tempo while it plays
  const tempo = playing ? tempoOf() : 0
  if (tempo > 0) {
    const beatMs = 60_000 / tempo
    const phase = (livePosition(usePlayer.getState()) % beatMs) / beatMs
    frame.kick = Math.max(frame.kick, Math.pow(1 - phase, 5))
  }
  const target = playing ? 0.45 : 0
  frame.level += (target - frame.level) * 0.05
  // a new random shape on every beat that falls away until the next one (like music does),
  // instead of a rolling wave
  const beatNo = tempo > 0 ? Math.floor(livePosition(usePlayer.getState()) / (60_000 / tempo)) : Math.floor(now / 500)
  if (beatNo !== shapeBeat) {
    shapeBeat = beatNo
    for (let b = 0; b < BANDS; b++) shape[b] = 0.35 + Math.random() * 0.65 * (b < 12 ? 1 : 0.75)
  }
  for (let b = 0; b < BANDS; b++) {
    const want = playing ? 0.12 + shape[b] * (0.25 + frame.kick * 0.75) : 0
    frame.bands[b] += (want - frame.bands[b]) * (want > frame.bands[b] ? 0.7 : 0.16)
  }
  return frame
}
