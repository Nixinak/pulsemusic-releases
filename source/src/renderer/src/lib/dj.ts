// AI DJ: picks sets from your own music with a language model (built in, or Claude), then talks
// between songs like a radio host, with the music ducked under its voice.
import { create } from 'zustand'
import type { DjVoiceId } from '@shared/types'
import * as sp from './spotify'
import type { SAlbumRef, STrack } from './types'
import { useApp } from './store'
import { useProfile } from './profile'
import { computeStats, isRealId, useHistory } from './history'
import { duck, livePosition, nextTrack, onUserPlay, playContext, playUris, setDjContinuation, setPresenceMode, takeDjContinuation, usePlayer } from './player'
import { loadArtistPopular } from './loaders'
import { FRESH, albumRequest, findMood, findScope, norm as normKeep, segmentKnown, splitNames, type Mood } from './djIntent'

export interface DjPick {
  uri: string
  id: string
  name: string
  artist: string
  /** The artists with their ids, so their names can be opened. */
  artists?: { id: string; name: string }[]
  image: string | null
  note: string
  discovered?: boolean
}

/** The same song, whatever version or album it comes from ("Song - Remastered", "Song (feat. X)"). */
function songKey(name: string, artist: string): string {
  const title = name
    .toLowerCase()
    .replace(/\s*[([].*?[)\]]/g, '')
    .replace(/\s+-\s+.*$/, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
  return `${title}|${artist.split(',')[0].trim().toLowerCase()}`
}

/** Drops songs that are already in `against` or earlier in the list: the DJ never plays a song twice. */
function uniquePicks(picks: DjPick[], against: DjPick[] = []): DjPick[] {
  const seen = new Set(against.flatMap((p) => [p.id, songKey(p.name, p.artist)]))
  const out: DjPick[] = []
  for (const p of picks) {
    const key = songKey(p.name, p.artist)
    if (seen.has(p.id) || seen.has(key)) continue
    seen.add(p.id)
    seen.add(key)
    out.push(p)
  }
  return out
}

export interface DjMessage {
  id: number
  from: 'dj' | 'you'
  text: string
}

type Status = 'idle' | 'thinking' | 'speaking' | 'playing' | 'error'

interface DjState {
  active: boolean
  status: Status
  /** What the DJ is saying right now (subtitles). */
  line: string
  error: string | null
  set: DjPick[]
  log: DjMessage[]
}

export const useDj = create<DjState>(() => ({ active: false, status: 'idle', line: '', error: null, set: [], log: [] }))
// The Discord status says when the DJ is on air.
useDj.subscribe((s, p) => {
  if (s.active !== p.active) setPresenceMode(s.active ? 'dj' : null)
})
const set = useDj.setState
const get = useDj.getState

let msgId = 0
const say = (from: DjMessage['from'], text: string): void =>
  set((s) => ({ log: [...s.log.slice(-40), { id: ++msgId, from, text }] }))

/* ---------- Voice ---------- */

let level = 0
/** Loudness of the DJ's voice right now (0..1), for the animated orb. */
export const voiceLevel = (): number => level

let audioCtx: AudioContext | null = null
let currentAudio: HTMLAudioElement | null = null
let speechStart = 0
let speechMs = 0

/** How far through the current line the DJ is (0..1), for word-by-word subtitles. */
export function voiceProgress(): number {
  if (currentAudio && currentAudio.duration > 0) return Math.min(1, currentAudio.currentTime / currentAudio.duration)
  if (!speechMs) return 0
  return Math.min(1, (performance.now() - speechStart) / speechMs)
}

/** Subtitles-only mode: a gentle made-up level so the animations still breathe. */
let speechToken = 0
function fakeLevel(ms: number): Promise<void> {
  const token = speechToken
  return new Promise((resolve) => {
    const start = performance.now()
    const tick = (now: number): void => {
      const t = (now - start) / 1000
      if (now - start >= ms || token !== speechToken) {
        level = 0
        return resolve()
      }
      level = 0.25 + 0.25 * Math.abs(Math.sin(t * 7.3)) * (0.6 + 0.4 * Math.sin(t * 2.1))
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

/** Plays WAV audio. Resolves false when the audio could not be played. */
function playWav(base64: string): Promise<boolean> {
  return new Promise((resolve) => {
    // A blob: URL, because the app's security policy doesn't allow data: audio.
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))
    const audio = new Audio(url)
    currentAudio = audio
    try {
      audioCtx ??= new AudioContext()
      if (audioCtx.state === 'suspended') void audioCtx.resume()
      const src = audioCtx.createMediaElementSource(audio)
      const an = audioCtx.createAnalyser()
      an.fftSize = 256
      src.connect(an)
      an.connect(audioCtx.destination)
      const data = new Uint8Array(an.fftSize)
      const tick = (): void => {
        if (audio.ended || audio.paused) {
          level = 0
          return
        }
        an.getByteTimeDomainData(data)
        let sum = 0
        for (const v of data) sum += ((v - 128) / 128) ** 2
        level = Math.min(1, Math.sqrt(sum / data.length) * 4)
        requestAnimationFrame(tick)
      }
      audio.addEventListener('play', () => requestAnimationFrame(tick))
    } catch {
      /* no analyser: the orb just breathes */
    }
    let finished = false
    const done = (ok: boolean): void => {
      if (finished) return
      finished = true
      level = 0
      currentAudio = null
      URL.revokeObjectURL(url)
      resolve(ok)
    }
    audio.onended = () => done(true)
    // stopSpeaking() pauses the audio; that ends this line too.
    audio.onpause = () => done(true)
    audio.onerror = () => {
      console.error('[dj] could not play the voice', audio.error)
      done(false)
    }
    void audio.play().catch((e) => {
      console.error('[dj] could not start the voice', e)
      done(false)
    })
  })
}

/** Turns text into audio with the natural voice, so the DJ can start talking right away. */
let lastVoiceError: string | null = null
async function render(text: string): Promise<string | null> {
  const st = useApp.getState().settings
  if (st.djVoice !== 'natural') return null
  const r = await speakWithTimeout(text).catch((e) => ({ ok: false as const, error: String(e) }))
  if (r.ok) return r.wav
  if (r.error !== lastVoiceError) {
    lastVoiceError = r.error
    console.warn('[dj] voice failed, showing subtitles only:', r.error)
    useApp.getState().toast(`The DJ voice didn’t work, showing subtitles: ${r.error}`, 'error')
  }
  return null
}

/** Never waits on the voice for more than `ms`; a stuck voice must not freeze the DJ. */
function speakWithTimeout(text: string, voice?: DjVoiceId, ms = 60_000): Promise<{ ok: true; wav: string } | { ok: false; error: string }> {
  return Promise.race([
    window.pulse.dj.speak(text, voice),
    new Promise<{ ok: false; error: string }>((r) => setTimeout(() => r({ ok: false, error: 'The voice took too long to answer.' }), ms))
  ])
}

const SAMPLE = 'Hey, welcome back. I picked a few songs for tonight that I think you’re going to love.'
const samples = new Map<string, string>()

/** Plays a sample of one voice (made once, then kept). Resolves with an error, or null. */
export async function previewVoice(voice: DjVoiceId): Promise<string | null> {
  let wav = samples.get(voice)
  if (!wav) {
    const r = await speakWithTimeout(SAMPLE, voice)
    if (!r.ok) return r.error
    wav = r.wav
    samples.set(voice, wav)
  }
  stopSpeaking()
  return (await playWav(wav)) ? null : 'The voice was made but could not be played.'
}

/** How long subtitles stay up when there is no audio. */
const readingTime = (text: string): number => Math.min(9000, 1500 + text.length * 45)

async function speak(text: string, prepared?: string | null): Promise<void> {
  if (!text.trim()) return
  const st = useApp.getState().settings
  // Make the audio first, so the animation starts exactly with the voice.
  const wav = st.djVoice === 'natural' ? (prepared ?? (await render(text))) : null
  set({ line: text, status: 'speaking' })
  say('dj', text)
  const playing = !usePlayer.getState().paused
  speechStart = performance.now()
  speechMs = readingTime(text)
  if (wav) {
    if (playing) await duck(0.22)
    const played = await playWav(wav)
    if (!played) await fakeLevel(readingTime(text))
    if (playing) await duck(1, 900)
  } else {
    await fakeLevel(readingTime(text))
  }
  speechMs = 0
  set({ status: get().active ? 'playing' : 'idle' })
}

export function stopSpeaking(): void {
  speechToken++
  currentAudio?.pause()
  level = 0
  void duck(1, 300)
}

/* ---------- Language model ---------- */

function systemPrompt(): string {
  return [
    'You are the AI radio DJ in the listener’s music app.',
    'Never say the listener’s name, the app’s name, "Pulse" or "Pulse Music", and never introduce yourself by name. Just talk to the listener as "you".',
    'Speak English, casual and warm, like a late-night radio host who knows their stuff.',
    'Spoken lines are very short: ONE sentence, at most 15 words, punchy and easy to say out loud. No emoji, no hashtags, no stage directions.',
    'Be warm and a little witty. Only state facts you are given or that are well known. Never make up facts about artists.',
    'The listener may write in any language (often Czech). Understand it, but always answer in English.',
    'Reply with JSON only, exactly in the shape you are asked for.'
  ].join('\n')
}

async function ask<T>(prompt: string): Promise<T> {
  const st = useApp.getState().settings
  const res = await window.pulse.dj.chat({
    provider: st.djProvider,
    model: st.djProvider === 'local' ? '' : st.djClaudeModel,
    apiKey: st.djClaudeKey,
    system: systemPrompt(),
    messages: [{ role: 'user', content: prompt }],
    json: true
  })
  if (!res.ok) throw new Error(res.error)
  const text = res.text
  const a = text.indexOf('{')
  const b = text.lastIndexOf('}')
  if (a < 0 || b < a) throw new Error('The AI did not answer in the expected format. Try again.')
  const out = JSON.parse(text.slice(a, b + 1)) as Record<string, unknown>
  // the model doesn't always keep it short: anything it says out loud is cut down here
  for (const k of ['intro', 'line'] as const) if (typeof out[k] === 'string') out[k] = brief(scrub(out[k] as string))
  return out as T
}

const escapeRe = (x: string): string => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Takes the listener's name and the app's name out of a spoken line, in case the model says them anyway. */
function scrub(text: string): string {
  const full = useProfile.getState().profile.displayName || useApp.getState().me?.display_name || ''
  const names = [...new Set([full, full.split(/\s+/)[0]].map((n) => n.trim()).filter((n) => n.length >= 2))].sort((a, b) => b.length - a.length)
  let t = text
    // "This is Pulse DJ…", "Pulse DJ here", "I'm your Pulse DJ"
    .replace(/\b(?:this is|it'?s|it’s|i'?m|i’m|here'?s|here’s)\s+(?:your\s+)?(?:the\s+)?Pulse(?:\s+(?:Music|DJ|Radio))*(?:\s+here)?\b[,!.]?\s*/gi, '')
    .replace(/\bPulse(?:\s+(?:Music|DJ|Radio))*\s+here\b[,!.]?\s*/gi, '')
  t = t.replace(/\s*\b(?:(?:right )?here )?(?:on|to|at|in|with|from)?\s*(?:the\s+)?Pulse(?:\s+(?:Music|DJ|Radio))?\b/gi, '')
  for (const n of names) t = t.replace(new RegExp(`(^|[\\s,])${escapeRe(n)}(?=$|[\\s,.!?;:])`, 'gi'), '$1')
  return t
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/([,;:])(?=[,.!?;:])/g, '')
    .replace(/^[\s,.;:–-]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/^./, (c) => c.toUpperCase())
}

/** Keeps a spoken line short: the first sentence (two if the first is tiny), at most ~22 words. */
function brief(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  const sentences = t.match(/[^.!?]+[.!?]+["”’)]*|[^.!?]+$/g)?.map((x) => x.trim()) ?? [t]
  let out = sentences[0] ?? t
  if (out.split(' ').length < 6 && sentences[1]) out += ' ' + sentences[1]
  const words = out.split(' ')
  if (words.length > 22) out = words.slice(0, 20).join(' ').replace(/[,;:–-]+$/, '') + '.'
  return out
}

/* ---------- Choosing music ---------- */

let likedCache: Promise<STrack[]> | null = null
const usedIds = new Set<string>()

const shuffle = <T,>(a: T[]): T[] => {
  const o = a.slice()
  for (let i = o.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[o[i], o[j]] = [o[j], o[i]]
  }
  return o
}

/* The listener's songs (top tracks and likes), kept on disk so the DJ never waits for them:
   a saved copy is used at once and refreshed in the background when it's over an hour old. */
interface Pool {
  at: number
  user: string
  short: STrack[]
  medium: STrack[]
  liked: STrack[]
}
const POOL_KEY = 'pulse-dj-pool'
const slim = (t: STrack): STrack =>
  ({
    id: t.id,
    uri: t.uri,
    name: t.name,
    duration_ms: t.duration_ms,
    explicit: t.explicit,
    is_local: t.is_local,
    artists: (t.artists ?? []).map((a) => ({ id: a.id, name: a.name, uri: a.uri })),
    album: t.album ? { id: t.album.id, name: t.album.name, uri: t.album.uri, images: (t.album.images ?? []).slice(-2) } : t.album
  }) as STrack
let poolMem: Pool | null = null
let poolLoading: Promise<Pool> | null = null
const me = (): string => useApp.getState().me?.id ?? ''
function savedPool(): Pool | null {
  if (poolMem?.user === me()) return poolMem
  try {
    const p = JSON.parse(localStorage.getItem(POOL_KEY) ?? 'null') as Pool | null
    if (p && p.user === me() && Date.now() - p.at < 7 * 86400_000) return (poolMem = p)
  } catch {
    /* no saved copy */
  }
  return null
}
function fetchPool(): Promise<Pool> {
  poolLoading ??= Promise.all([
    sp.getTopTracks('short_term', 50).then((r) => r.items).catch(() => [] as STrack[]),
    sp.getTopTracks('medium_term', 50).then((r) => r.items).catch(() => [] as STrack[]),
    sp.getAllSavedTracks(600).then((r) => r.map((i) => i.track)).catch(() => [] as STrack[])
  ])
    .then(([short, medium, liked]) => {
      const p: Pool = { at: Date.now(), user: me(), short: short.filter(Boolean).map(slim), medium: medium.filter(Boolean).map(slim), liked: liked.filter(Boolean).map(slim) }
      if (p.short.length + p.medium.length + p.liked.length) {
        poolMem = p
        try {
          localStorage.setItem(POOL_KEY, JSON.stringify(p))
        } catch {
          /* storage full: memory copy only */
        }
      }
      return p
    })
    .finally(() => {
      poolLoading = null
    })
  return poolLoading
}
async function getPool(): Promise<Pool> {
  const saved = savedPool()
  if (saved) {
    if (Date.now() - saved.at > 3600_000) void fetchPool().catch(() => {})
    return saved
  }
  return fetchPool()
}

async function candidates(): Promise<STrack[]> {
  const pool = getPool()
  likedCache ??= pool.then((p) => p.liked).catch(() => [])
  const { short, medium, liked } = await pool
  const recentCut = Date.now() - 2 * 3600_000
  const recent = new Set(useHistory.getState().plays.filter((p) => p.at > recentCut).map((p) => p.id))
  const seen = new Set<string>()
  const out: STrack[] = []
  for (const t of [...shuffle(short).slice(0, 25), ...shuffle(medium).slice(0, 20), ...shuffle(liked).slice(0, 60)]) {
    if (!t?.id || t.is_local || seen.has(t.id) || usedIds.has(t.id) || recent.has(t.id)) continue
    seen.add(t.id)
    out.push(t)
  }
  return shuffle(out).slice(0, 80)
}

function listenerContext(): string {
  const plays = useHistory.getState().plays
  const stats = computeStats(plays, Date.now() - 30 * 86400_000)
  const now = new Date()
  const parts = [
    `Now: ${now.toLocaleDateString('en-GB', { weekday: 'long' })}, ${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.`
  ]
  if (stats.artists.length) parts.push(`Most played artists this month: ${stats.artists.slice(0, 8).map((a) => `${a.item.name} (${a.plays})`).join(', ')}.`)
  if (stats.songs.length) parts.push(`Most played songs this month: ${stats.songs.slice(0, 6).map((s) => `${s.item.name} by ${s.item.artists[0]?.name} (${s.plays}×)`).join('; ')}.`)
  return parts.join('\n')
}

const playCount = (id: string): number => useHistory.getState().plays.filter((p) => p.id === id).length

function toPick(t: STrack, note: string, discovered = false): DjPick {
  return {
    uri: t.uri,
    id: t.id,
    name: t.name,
    artist: t.artists.map((a) => a.name).join(', '),
    artists: t.artists.map((a) => ({ id: a.id, name: a.name })),
    image: sp.pickImage(t.album?.images, 300),
    note,
    discovered
  }
}

interface SetAnswer {
  intro?: string
  picks?: { n: number; note?: string }[]
  discover?: { artist: string; title: string; note?: string }[]
}

const blockSize = (): number => 5 + Math.floor(Math.random() * 3)

function dedupe(list: STrack[]): STrack[] {
  const seen = new Set<string>()
  return list.filter((t) => t?.id && !t.is_local && !seen.has(t.id) && !!seen.add(t.id))
}

/** Songs Spotify files under a genre or matches for a mood, to choose from besides the library.
 *  Recent releases come first: Spotify ranks search results by popularity, so a search limited
 *  to this year and last finds what is big right now. */
async function searchPool(theme: string, mood?: Mood | null): Promise<STrack[]> {
  const q = theme.replace(/^songs?\s+(like|in the style of)\s+/i, '').slice(0, 80)
  const base = mood ? mood.queries : [`genre:"${q}"`, q]
  // older music (an era, "classics") gets no "this year and last" searches
  const fresh = mood?.fresh === false ? [] : base.map((x) => `${x} ${FRESH}`)
  const out: STrack[] = []
  const seen = new Set<string>()
  // fresh first, then the all-time results; every query and page at once (one round trip)
  const plan: [string, number][] = [...fresh.flatMap((x) => [[x, 0], [x, 10]] as [string, number][]), ...base.flatMap((x) => [[x, 0], [x, 10]] as [string, number][])]
  const answers = await Promise.all(plan.map(([query, offset]) => sp.searchTracks(query, offset).catch(() => null)))
  for (const r of answers) for (const t of r?.tracks?.items ?? []) if (t?.id && !t.is_local && !seen.has(t.id) && !usedIds.has(t.id)) (seen.add(t.id), out.push(t))
  // too little for a country and era: try the genres without the years (the era is still
  // checked below), then the country's name as plain text
  if (out.length < 8 && mood?.country && !mood.id.startsWith('retry:')) {
    const looser: Mood = { ...mood, id: `retry:${mood.id}`, queries: [...mood.queries.map((x) => x.replace(/\s*year:\S+/, '')), `${mood.country} ${mood.era ? 'classics' : 'hits'}`] }
    for (const t of await searchPool(theme, looser)) if (!seen.has(t.id)) (seen.add(t.id), out.push(t))
  }
  // an era: only songs from those years (Spotify's year filter goes by the album, which
  // compilations can bend)
  if (mood?.era) {
    const [a, b] = mood.era
    return out.filter((t) => {
      const y = Number((t.album?.release_date ?? '').slice(0, 4))
      return !y || (y >= a && y <= b + 1)
    })
  }
  return out
}

/** New songs from the artists the listener plays most (this year and last), so the show
 *  isn't only old favourites. Kept for an hour. */
let freshCache: { at: number; list: STrack[] } | null = null
async function freshFromArtists(): Promise<STrack[]> {
  if (freshCache && Date.now() - freshCache.at < 3600_000) return freshCache.list
  const stats = computeStats(useHistory.getState().plays, Date.now() - 30 * 86400_000)
  let names = stats.artists.slice(0, 6).map((a) => a.item)
  if (names.length < 3) {
    const top = await sp.getTopArtists('short_term', 6).catch(() => null)
    names = (top?.items ?? []).map((a) => ({ id: a.id, name: a.name }))
  }
  const pages = await Promise.all(names.map((a) => sp.searchTracks(`artist:"${a.name}" ${FRESH}`, 0).catch(() => null)))
  const list: STrack[] = []
  pages.forEach((p, i) => {
    for (const t of (p?.tracks?.items ?? []).slice(0, 4)) if (t?.id && t.artists.some((a) => a.id === names[i].id)) list.push(t)
  })
  freshCache = { at: Date.now(), list }
  return list
}

const isFresh = (t: STrack): boolean => {
  const y = Number((t.album?.release_date ?? '').slice(0, 4))
  return y >= new Date().getFullYear() - 1
}

/**
 * Builds the next block of songs (5 to 7) around one theme: what the listener asked for, or a
 * new genre the DJ picks itself (`switchFrom` set), which the intro then announces.
 */
async function buildSet(
  theme: string,
  continuing: boolean,
  opts: { switchFrom?: string; size?: number; opening?: boolean; mood?: Mood | null; seeds?: STrack[] } = {}
): Promise<{ intro: string; picks: DjPick[]; theme: string }> {
  const size = opts.size ?? blockSize()
  if (opts.switchFrom !== undefined) {
    // Let the model choose where the show goes next.
    const pick = await ask<{ genre?: string }>(
      [
        listenerContext(),
        opts.switchFrom ? `The last few songs were ${opts.switchFrom}.` : '',
        'Pick the next genre or style for the show: clearly different from the last one, something this listener would enjoy (look at their artists), and preferably a style that is popular right now. Use a short genre name Spotify knows, like "phonk", "drill", "house", "lo-fi", "pop punk", "trap", "r&b", "jersey club", "afrobeats".',
        'Return JSON: {"genre": "..."}'
      ]
        .filter(Boolean)
        .join('\n')
    ).catch(() => ({ genre: '' }))
    theme = (pick.genre ?? '').trim() || theme
  }
  const mood = opts.mood ?? (theme ? (findScope(theme) ?? findMood(theme)) : null)
  const [library, found, fresh] = await Promise.all([
    candidates(),
    theme ? searchPool(theme, mood) : Promise.resolve([] as STrack[]),
    mood?.fresh === false ? Promise.resolve([] as STrack[]) : freshFromArtists().catch(() => [] as STrack[])
  ])
  // With a theme, the library only adds songs by artists that turned up for it, so a request
  // for "late night drive" isn't filled with favourites that have nothing to do with it.
  const themeArtists = new Set(found.flatMap((t) => t.artists.map((a) => a.id)))
  const seeds = (opts.seeds ?? []).filter((t) => !usedIds.has(t.id))
  // an era without a country also takes the listener's own songs from those years
  const inEra = (t: STrack): boolean => {
    if (!mood?.era) return false
    const y = Number((t.album?.release_date ?? '').slice(0, 4))
    return y >= mood.era[0] && y <= mood.era[1]
  }
  const own = theme ? library.filter((t) => t.artists.some((a) => themeArtists.has(a.id)) || (!mood?.country && inEra(t))) : library
  const newOnes = theme ? fresh.filter((t) => t.artists.some((a) => themeArtists.has(a.id))) : fresh
  // a shorter list makes the model answer much sooner
  const pool = dedupe([...seeds, ...found.slice(0, theme ? 45 : 30), ...newOnes.slice(0, 12), ...own]).slice(0, 70)
  if (pool.length < 5) throw new Error('Your library is too small for the DJ yet. Like a few more songs first.')
  const fromSearch = new Set(found.map((t) => t.id))
  const list = pool
    .map((t, i) => {
      const plays = playCount(t.id)
      return `${i + 1}. ${t.artists[0]?.name} – ${t.name}${fromSearch.has(t.id) && theme ? ` [${theme}]` : ''}${isFresh(t) ? ' [new]' : ''}${plays ? ` [played ${plays}×]` : ''}`
    })
    .join('\n')
  const prev = get()
    .set.slice(-4)
    .map((p) => `${p.artist} – ${p.name}`)
    .join('; ')
  const switching = opts.switchFrom !== undefined
  const prompt = [
    listenerContext(),
    continuing ? `You are continuing the show. The last songs were: ${prev}.` : 'You are starting a new set.',
    theme
      ? `This block is: "${mood ? mood.label : theme}".${mood ? ` It should sound like: ${mood.sound}.` : ''} EVERY song must clearly fit it. Do not add songs of another genre or mood just because the listener likes them. Songs marked [${theme}] were found on Spotify for it.${mood?.rule ? ` ${mood.rule}` : ''}`
      : 'No special request: make a block that fits the moment, mixing favourites with less played songs, all in one style.',
    mood?.fresh === false
      ? 'This block is about older music: well-known songs from those years, not new releases.'
      : 'Keep it current: about half the block should be songs marked [new] (released this year or last) when they fit, the rest proven favourites.',
    '',
    'Songs to choose from (number. artist – title):',
    list,
    '',
    mood?.country || mood?.era
      ? `Choose exactly ${size} songs in a good order (no artist twice in a row), only from the list (the list was found for this request). Prefer the listener's own songs when they fit.`
      : `Choose exactly ${size} songs in a good order (no artist twice in a row). Prefer the listener's own songs when they fit; you may also name real songs that are not in the list (up to ${size}) when the list doesn't have enough that fit.`,
    switching
      ? `The "intro" must tell the listener you are switching the vibe to ${theme || 'something new'}, in one short sentence (at most 15 words).`
      : opts.opening
        ? 'The "intro" opens the show: greet the listener like a regular coming back (for example "Welcome back" or "Good to have you back") and lead into the music, in one short sentence (at most 15 words).'
        : 'The "intro" is what you say before the block starts: one short sentence, at most 15 words.',
    'Return JSON: {"intro": "...", "picks": [{"n": number from the list, "note": "a few words why"}], "discover": [{"artist": "...", "title": "...", "note": "..."}]}'
  ].join('\n')
  const ans = await ask<SetAnswer>(prompt)
  const picks: DjPick[] = []
  for (const p of ans.picks ?? []) {
    const t = pool[Number(p.n) - 1]
    if (t && !picks.some((x) => x.id === t.id)) picks.push(toPick(t, p.note ?? '', fromSearch.has(t.id)))
  }
  // for a country or an era only songs actually found for it (the model's own ideas can stray)
  const wanted = mood?.country || mood?.era ? [] : (ans.discover ?? []).slice(0, Math.max(0, size + 1 - picks.length))
  const looked = await Promise.all(wanted.map((d) => findTrack(d.title, d.artist).catch(() => null)))
  for (const [i, d] of wanted.entries()) {
    if (picks.length >= size + 1) break
    const t = looked[i]
    if (t && !picks.some((x) => x.id === t.id)) picks.splice(Math.min(picks.length, 1 + Math.floor(Math.random() * picks.length)), 0, toPick(t, d.note ?? 'Something new', true))
  }
  if (picks.length < 3) {
    // The model ignored the list: take songs found for the theme (else the library).
    for (const t of (found.length ? found : pool).slice(0, size - picks.length)) if (!picks.some((x) => x.id === t.id)) picks.push(toPick(t, ''))
  }
  // the same song from another album, or one already in this show, doesn't play again
  const block = uniquePicks(picks, get().set).slice(0, size + 1)
  block.forEach((p) => usedIds.add(p.id))
  return { intro: (ans.intro ?? '').trim(), picks: block, theme }
}

/* ---------- Talking between songs ---------- */

interface Prepared {
  forId: string
  text: string
  wav: string | null
}
let prepared: Promise<Prepared | null> | null = null
let preparedFor: string | null = null
const pendingIntros = new Map<string, string>()

function shouldTalk(index: number): boolean {
  const c = useApp.getState().settings.djChattiness
  if (index === 0) return false
  if (c === 'often') return true
  if (c === 'sometimes') return index % 3 === 0
  return false
}

function prepareTalk(prev: DjPick, next: DjPick): Promise<Prepared | null> {
  const plays = playCount(next.id)
  const prompt = [
    listenerContext(),
    `The song "${prev.name}" by ${prev.artist} just ended.`,
    `Next up: "${next.name}" by ${next.artist}${next.note ? ` (${next.note})` : ''}. ${plays ? `The listener has played it ${plays} times.` : 'The listener has not played it before.'}${next.discovered ? ' It is a new discovery, not from their library.' : ''}`,
    'Say one short sentence (at most 15 words) to link the two songs and introduce the next one.',
    'Return JSON: {"line": "..."}'
  ].join('\n')
  return ask<{ line?: string }>(prompt)
    .then(async (a) => {
      const text = (a.line ?? '').trim()
      if (!text) return null
      return { forId: next.id, text, wav: await render(text) }
    })
    .catch((e) => {
      console.warn('[dj] talk-up failed', e)
      return null
    })
}

let extending = false
/** After a failed extend, wait before trying again (each try sends many requests). */
let extendRetryAt = 0
/** The album the DJ is playing as a whole, if any (other contexts mean the listener took over). */
let djContext: string | null = null
// Playing anything yourself ends the show and drops the DJ's upcoming songs.
onUserPlay(() => {
  if (get().active) stopDj()
})
let watcher: (() => void) | null = null
let ticker = 0

function watch(): void {
  watcher?.()
  let lastId = usePlayer.getState().track?.id ?? null
  watcher = usePlayer.subscribe((s, prev) => {
    // The listener started a playlist, album or artist somewhere else (another device): the show ends.
    if (
      s.contextUri &&
      s.contextUri !== prev.contextUri &&
      s.contextUri !== djContext &&
      /^spotify:(playlist|album|artist|show|user:[^:]+:collection)/.test(s.contextUri) &&
      get().active
    ) {
      stopDj()
      return
    }
    const id = s.track?.id ?? null
    // Skipping faster than the DJ could line up its next songs ran past the end of the show,
    // and Spotify started its own random "autoplay" music. Bring the show back right away.
    if (id && id !== lastId && get().active && !djContext && get().status !== 'thinking' && !get().set.some((p) => p.id === id) && !s.upNext.some((q) => q.id === id) && !skipIds.has(id)) {
      void recoverShow()
    }
    if (id === lastId) return
    lastId = id
    // taken out of the show in the queue: go straight past it
    if (id && skipIds.has(id) && get().active) {
      skipIds.delete(id)
      void nextTrack()
      return
    }
    // Skipped (the old song still had more than a few seconds left): the DJ stays on
    // but keeps quiet for this change.
    const left = prev.track ? prev.track.durationMs - livePosition(prev) : 0
    const skipped = left > 6000
    if (skipped) {
      stopSpeaking()
      if (get().status === 'speaking') set({ status: 'playing' })
    }
    void onTrack(id, skipped)
  })
  // Prepare the next talk-up before the song ends, and extend the show near its end.
  ticker = window.setInterval(() => {
    const p = usePlayer.getState()
    const st = get()
    if (!st.active || !p.track) return
    const idx = st.set.findIndex((x) => x.id === p.track!.id)
    if (idx < 0) return
    const left = p.track.durationMs - livePosition(p)
    const next = st.set[idx + 1]
    if (next && left < 40_000 && preparedFor !== next.id && shouldTalk(idx + 1) && !pendingIntros.has(next.uri)) {
      preparedFor = next.id
      prepared = prepareTalk(st.set[idx], next)
    }
    if (idx >= st.set.length - 3 && !extending && !followingUp && Date.now() > extendRetryAt) void extend()
  }, 2000)
}

let recovering = false
async function recoverShow(): Promise<void> {
  if (recovering) return
  recovering = true
  try {
    let uris = takeDjContinuation()
    if (!uris) {
      const picks = uniquePicks(
        (await candidates()).map((t) => toPick(t, '')),
        get().set
      ).slice(0, 6)
      if (!picks.length || !get().active) return
      set((s) => ({ set: [...s.set, ...picks] }))
      uris = picks.map((p) => p.uri)
    }
    if (get().active) await playUris(uris, undefined, { source: 'dj' })
  } catch (e) {
    console.warn('[dj] could not bring the show back', e)
  } finally {
    recovering = false
  }
}

async function onTrack(id: string | null, skipped = false): Promise<void> {
  const st = get()
  if (!st.active || !id) return
  const idx = st.set.findIndex((x) => x.id === id)
  if (idx < 0) return
  const pick = st.set[idx]
  if (skipped) return
  const intro = pendingIntros.get(pick.uri)
  if (intro) {
    pendingIntros.delete(pick.uri)
    await new Promise((r) => setTimeout(r, 1200))
    await speak(intro)
    return
  }
  if (!shouldTalk(idx)) return
  const ready = preparedFor === id && prepared ? await prepared : await prepareTalk(st.set[idx - 1] ?? pick, pick)
  if (!get().active || usePlayer.getState().track?.id !== id) return
  if (ready) {
    await new Promise((r) => setTimeout(r, 1500))
    await speak(ready.text, ready.wav)
  }
}

/** Lines up the next block of songs so the show never stops. It starts when the current
 *  block's last song ends (Spotify's own queue is not used, so nothing is left behind). */
async function extend(): Promise<void> {
  extending = true
  try {
    const last = get().set[get().set.length - 1]
    // After a requested song, artist or album: more like it. After that, every block is one
    // genre, and after 5 to 7 songs the DJ moves on to a new one and says so.
    const follow = nextTheme
    nextTheme = null
    // a request for a country or an era ("Czech classics") stays the whole show
    const { intro, picks, theme } = stickyMood
      ? await buildSet(stickyMood.label, true, { mood: stickyMood })
      : follow
        ? await buildSet(follow, true)
        : await buildSet('', true, { switchFrom: flavour })
    flavour = theme
    if (!get().active) return
    setDjContinuation(last?.id ?? null, picks.map((p) => p.uri))
    if (intro && picks[0]) pendingIntros.set(picks[0].uri, intro)
    set((s) => ({ set: [...s.set, ...picks] }))
  } catch (e) {
    console.warn('[dj] could not extend the show', e)
    extendRetryAt = Date.now() + 30_000
  } finally {
    extending = false
  }
}

/* ---------- Public controls ---------- */

async function waitForTrack(uri: string, ms = 6000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < ms) {
    if (usePlayer.getState().track?.uri === uri) return
    await new Promise((r) => setTimeout(r, 200))
  }
}

/** Starts the DJ, or answers a request with a fresh set when it is already on. */
/* ---------- Understanding requests ---------- */

/** What the current block is about (a genre or the listener's request). */
let flavour = ''
/** The show keeps to this (a country or an era the listener asked for) until the next request. */
let stickyMood: Mood | null = null
/** The theme of the next block when it should follow a request rather than switch genre. */
let nextTheme: string | null = null

const norm = (x: string): string =>
  x
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s*[([].*?[)\]]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** Finds the best Spotify match for a song title (and artist, when known). */
async function findTrack(title: string, artist = ''): Promise<STrack | null> {
  const queries = artist ? [`track:"${title}" artist:"${artist}"`, `${title} ${artist}`, title] : [title]
  const known = await knownArtists()
  for (const q of queries) {
    // Without the artist in the query, only an exact title counts (the model may have guessed the artist wrong).
    const titleOnly = artist !== '' && q === title
    const items = (await sp.searchTracks(q, 0)).tracks?.items ?? []
    let best: STrack | null = null
    let bestScore = -1
    items.forEach((t, i) => {
      const n = norm(t.name)
      const want = norm(title)
      let score = n === want ? 6 : n.startsWith(want) || want.startsWith(n) ? 4 : n.includes(want) ? 2 : 0
      if (artist && t.artists.some((a) => norm(a.name) === norm(artist))) score += 5
      else if (artist && t.artists.some((a) => norm(a.name).includes(norm(artist)) || norm(artist).includes(norm(a.name)))) score += 3
      if (t.artists.some((a) => known.has(a.id))) score += 2 // an artist the listener plays
      score -= i * 0.3 // Spotify's own ranking breaks ties
      if (score > bestScore) {
        bestScore = score
        best = t
      }
    })
    if (best && bestScore >= (titleOnly ? 6 : 2)) return best
  }
  return null
}

/** Artists the listener actually plays or saved, by id, so look-alike names resolve to theirs. */
async function knownArtists(): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const p of useHistory.getState().plays) for (const a of p.artists) if (isRealId(a.id)) out.set(a.id, a.name)
  likedCache ??= sp.getAllSavedTracks(600).then((r) => r.map((i) => i.track)).catch(() => [])
  for (const t of await likedCache) for (const a of t?.artists ?? []) out.set(a.id, a.name)
  return out
}

// Words around a request that aren't part of the name: "play …", "pusť něco od …", "some … songs".
const LEAD =
  /^(?:(?:hey|ok|okay|please|prosim|pls)\s+)*(?:(?:can|could) you\s+)?(?:play|put on|queue|start|spin|i want(?: to hear)?|let me hear|pust(?:ime|te|it)?|zahraj(?:te)?|spust|dej(?: mi)?|chci(?: slyset)?|hraj)\s+(?:me\s+|mi\s+)?(?:(?:some(?:thing)?|anything|a song|songs?|music|tracks?|neco|nejakou|nejakej|nejaky|pisnicku|pisen|songy?|hudbu)\s+)?(?:(?:by|from|of|od)\s+)?/
const TAIL = /\s+(?:please|pls|prosim|for me|songs?|music|tracks?|pisnicky?|songy)$/

const GENRE_WORDS = new Set(
  (
    'phonk drift brazilian funk funky trap drill rap hiphop hip hop rnb r b soul jazz blues rock metal punk emo grunge indie pop kpop k jpop ' +
    'house techno trance edm dnb drum bass dubstep garage uk jersey club grime plugg pluggnb rage cloud lofi lo fi chill chillout ambient ' +
    'classical piano acoustic folk country reggae reggaeton latin afrobeats afrobeat amapiano dancehall disco synthwave hyperpop ' +
    'electronic dance gym workout study focus sleep sad happy party summer winter night drive driving love oldschool old school ' +
    'czech czechia slovak cz sk polish german french english russian ukrainian 80s 90s 2000s 2010s songs song music mix vibes vibe ' +
    'something some energy hype hard soft deep slow fast new upbeat underground'
  ).split(' ')
)
const GENRE_CORE = /\b(phonk|trap|drill|rap|hip ?hop|r ?b|rnb|soul|jazz|blues|rock|metal|punk|emo|grunge|indie|pop|house|techno|trance|edm|dnb|dubstep|garage|grime|plugg|rage|lo ?fi|ambient|classical|folk|country|reggae|reggaeton|latin|afrobeats?|amapiano|dancehall|disco|synthwave|hyperpop|electronic|funk)\b/
/** True when the request is only genre or mood words, like "phonk" or "czech drill". */
const isGenre = (q: string): boolean => GENRE_CORE.test(q) && q.split(' ').every((w) => GENRE_WORDS.has(w))

/** The request without command words; `asked` is true when it started with "play" or similar. */
function cleanRequest(request: string): { q: string; asked: boolean } {
  const n = norm(request)
  const q = n.replace(LEAD, '').replace(TAIL, '').trim()
  return { q, asked: q !== n }
}

/** Spotify artists for typed names: the listener's own first, then an exact match on Spotify. */
async function resolveArtists(names: string[], known: Map<string, string>): Promise<{ id: string; name: string }[] | null> {
  const byName = new Map<string, { id: string; name: string }>()
  for (const [id, name] of known) if (!byName.has(norm(name))) byName.set(norm(name), { id, name })
  const out = await Promise.all(
    names.map(async (n) => {
      const want = norm(n)
      if (!want) return null
      const mine = byName.get(want)
      if (mine) return mine
      const list = await sp.searchArtists(n).catch(() => [])
      const exact = list.filter((a) => norm(a.name) === want)
      const hit = exact.find((a) => known.has(a.id)) ?? exact[0] ?? (list[0] && norm(list[0].name).startsWith(want) && want.length >= 4 ? list[0] : null)
      return hit ? { id: hit.id, name: hit.name } : null
    })
  )
  if (out.some((x) => !x)) return null
  const seen = new Set<string>()
  return (out as { id: string; name: string }[]).filter((a) => !seen.has(a.id) && !!seen.add(a.id))
}

/** Known artists whose names appear in the text ("chill riad" → Riad). */
function artistsIn(q: string, known: Map<string, string>): { id: string; name: string }[] {
  const padded = ` ${q} `
  const out: { id: string; name: string }[] = []
  for (const [id, name] of known) {
    const n = norm(name)
    if (n.length >= 3 && padded.includes(` ${n} `) && !out.some((a) => a.id === id)) out.push({ id, name })
  }
  return out.slice(0, 4)
}

/**
 * Looks the request up on Spotify before asking the model, so names in any language (Czech,
 * Slovak, Polish rappers and so on) are taken as they are instead of being guessed. Clear
 * matches play straight away; otherwise the search results go to the model as hints.
 * Order matters: an exact artist, then "title by artist", an album, several artists, a mood,
 * a genre, and only then loose matches (so "late night drive" is a mood, not a song of that name).
 */
async function ground(request: string): Promise<{ direct: Intent | null; hints: string }> {
  const { q, asked } = cleanRequest(request)
  if (!q || q.length < 2) return { direct: null, hints: '' }
  const known = await knownArtists()

  // An artist the listener plays whose name is exactly the request.
  const libArtist = [...known].find(([, name]) => norm(name) === q)
  if (libArtist) return { direct: { intent: 'artist', artist: libArtist[1], artistId: libArtist[0] }, hints: '' }

  // "title by artist", "title od artist", "artist - title" (the dash is gone after norm()).
  const dashed = request
    .toLowerCase()
    .replace(/^\s*(play|put on|pus\S*|zahraj\S*|dej( mi)?|spus\S*)\s+/, '')
    .split(/\s+[-–—]\s+/)
  const split = /^(.+?)\s+(?:by|od|from)\s+(.+)$/.exec(q) ?? (dashed.length === 2 ? ['', dashed[0], dashed[1]] : null)
  const album = albumRequest(q)
  if (split && !album) {
    const [, x, y] = split.map((v) => norm(v ?? ''))
    const sameName = (t: STrack, title: string, who: string): boolean =>
      norm(t.name) === title && t.artists.some((a) => norm(a.name) === who || norm(a.name).includes(who) || who.includes(norm(a.name)))
    let hit: STrack | undefined
    for (const [title, who] of [
      [x, y],
      [y, x]
    ]) {
      const r = await sp.searchTracks(`track:"${title}" artist:"${who}"`, 0).catch(() => null)
      const items = (r?.tracks?.items ?? []).filter((t): t is STrack => !!t?.id)
      hit = items.find((t) => sameName(t, title, who)) ?? items.find((t) => norm(t.name).startsWith(title))
      if (hit) break
    }
    if (hit) return { direct: { intent: 'song', title: hit.name, artist: hit.artists[0]?.name, trackId: hit.id, track: hit }, hints: '' }
    // "something chill by riad": a mood with that artist in it
    const mood = findScope(x) ?? findMood(x)
    const who = await resolveArtists([y], known).catch(() => null)
    if (mood && who?.length) return { direct: { intent: 'mood', mood, seedArtists: who }, hints: '' }
    // an album by them
    const al = await findAlbum(x, y)
    if (al) return { direct: { intent: 'album', album: al.name, artist: al.artists[0]?.name, albumRef: al }, hints: '' }
  }

  // "album X (od Y)"
  if (album) {
    const al = await findAlbum(album.album, album.artist)
    if (al) return { direct: { intent: 'album', album: al.name, artist: al.artists[0]?.name, albumRef: al }, hints: '' }
  }

  // Several artists: "riad, yzomandias a calin", "riad x calin", or just "riad yzomandias calin".
  const raw = normKeep(request).replace(LEAD, '').replace(TAIL, '').trim()
  const parts = splitNames(raw)
  const names = parts.length >= 2 ? parts.map(norm) : segmentKnown(q, known)
  if (names && names.length >= 2 && names.length <= 8) {
    // one artist whose name has "&" or "x" in it ("Simon & Garfunkel") wins over a split
    const whole = parts.length >= 2 ? (await sp.searchArtists(raw).catch(() => [])).find((a) => normKeep(a.name) === raw) : undefined
    if (whole) return { direct: { intent: 'artist', artist: whole.name, artistId: whole.id }, hints: '' }
    const list = await resolveArtists(names, known).catch(() => null)
    if (list && list.length >= 2) return { direct: { intent: 'artists', artists: list }, hints: '' }
  }

  // A country, a language or an era: "classic czech songs", "polský rap", "90s rock".
  const scope = findScope(q)
  if (scope) return { direct: { intent: 'mood', mood: scope, seedArtists: artistsIn(q, known) }, hints: '' }

  // A mood or situation: "late night drive", "do posilovny", "něco na učení".
  const mood = findMood(q)
  if (mood) return { direct: { intent: 'mood', mood, seedArtists: artistsIn(q, known) }, hints: '' }
  // A genre ("phonk", "czech drill"): a set of it, never a song or an artist with that name.
  if (isGenre(q)) return { direct: { intent: 'mood' }, hints: '' }

  const res = await sp.search(q).catch(() => null)
  const artists = (res?.artists?.items ?? []).filter((a): a is NonNullable<typeof a> => !!a)
  const tracks = (res?.tracks?.items ?? []).filter((t): t is STrack => !!t?.id)
  const albums = (res?.albums?.items ?? []).filter((a) => !!a)
  const mine = <T extends { id: string }>(list: T[], ids: (x: T) => string[]): T[] => [
    ...list.filter((x) => ids(x).some((id) => known.has(id))),
    ...list.filter((x) => !ids(x).some((id) => known.has(id)))
  ]
  const exactArtist = artists.find((a) => norm(a.name) === q)
  if (exactArtist && (asked || known.has(exactArtist.id) || !tracks.some((t) => norm(t.name) === q)))
    return { direct: { intent: 'artist', artist: exactArtist.name, artistId: exactArtist.id }, hints: '' }

  const fullName = (t: STrack): string[] => [norm(t.name), ...t.artists.flatMap((a) => [`${norm(t.name)} ${norm(a.name)}`, `${norm(a.name)} ${norm(t.name)}`])]
  const exactSong = mine(tracks, (t) => t.artists.map((a) => a.id)).find((t) => fullName(t).includes(q))
  if (exactSong) return { direct: { intent: 'song', title: exactSong.name, artist: exactSong.artists[0]?.name, trackId: exactSong.id, track: exactSong }, hints: '' }
  // The album's name exactly (or "album artist" / "artist album").
  const exactAlbum = albums.find((a) => [norm(a.name), ...a.artists.flatMap((x) => [`${norm(a.name)} ${norm(x.name)}`, `${norm(x.name)} ${norm(a.name)}`])].includes(q))
  if (exactAlbum && exactAlbum.album_type !== 'single')
    return { direct: { intent: 'album', album: exactAlbum.name, artist: exactAlbum.artists[0]?.name, albumRef: exactAlbum }, hints: '' }

  const lines: string[] = []
  if (artists.length) lines.push(`Artists: ${mine(artists, (a) => [a.id]).slice(0, 6).map((a) => a.name).join('; ')}`)
  if (tracks.length)
    lines.push(`Songs: ${mine(tracks, (t) => t.artists.map((a) => a.id)).slice(0, 8).map((t) => `"${t.name}" by ${t.artists.map((a) => a.name).join(', ')}`).join('; ')}`)
  if (albums.length) lines.push(`Albums: ${albums.slice(0, 4).map((a) => `"${a.name}" by ${a.artists[0]?.name}`).join('; ')}`)
  const fav = [...new Set(known.values())].slice(0, 40)
  if (fav.length) lines.push(`Artists the listener plays: ${fav.join(', ')}`)
  return { direct: null, hints: lines.join('\n') }
}

/** An album by its name (and artist, when given), preferring the listener's artists. */
async function findAlbum(name: string, artist?: string): Promise<SAlbumRef | null> {
  const r = await sp.search(`album:"${name}"${artist ? ` artist:"${artist}"` : ''}`).catch(() => null)
  const list = (r?.albums?.items ?? []).filter((a): a is SAlbumRef => !!a?.id)
  const want = norm(name)
  const who = artist ? norm(artist) : ''
  const fits = (a: SAlbumRef): boolean => !who || a.artists.some((x) => norm(x.name) === who || norm(x.name).includes(who) || who.includes(norm(x.name)))
  return list.find((a) => norm(a.name) === want && fits(a)) ?? list.find((a) => norm(a.name).startsWith(want) && fits(a)) ?? null
}

interface Intent {
  intent?: 'song' | 'songs' | 'artist' | 'artists' | 'album' | 'mood'
  title?: string
  artist?: string
  album?: string
  list?: { title: string; artist?: string }[]
  /** Several artists at once. */
  artists?: { id: string; name: string }[]
  line?: string
  /** Set when the request was matched on Spotify directly. */
  artistId?: string
  trackId?: string
  /** The song itself when it was found while reading the request. */
  track?: STrack
  albumRef?: SAlbumRef
  mood?: Mood
  /** Artists named together with a mood ("chill riad"). */
  seedArtists?: { id: string; name: string }[]
}

async function understand(request: string, hints: string): Promise<Intent> {
  return ask<Intent>(
    [
      `The listener typed: "${request}"`,
      hints ? `Spotify search results for that text (spelling as on Spotify):\n${hints}` : '',
      'Names are often not English: Czech, Slovak, Polish, German, Spanish and other artists are common. Never translate a name or swap it for a better known English artist or song with a similar name. When the text matches an artist, song or album in the search results or in the listener’s artists, use exactly that one.',
      'Work out what they want:',
      '- "song": one specific song (a title, maybe with the artist, maybe "play ..."). Fill "title" and "artist" (the real artist if you know it).',
      '- "songs": several specific songs. Put them in "list".',
      '- "artist": music by one artist. Fill "artist".',
      '- "artists": music by two or more artists named together. Put each name in "list" as {"title": "", "artist": "name"}.',
      '- "album": one specific album. Fill "album" and "artist".',
      '- "mood": a vibe, situation, genre, activity, era, or anything else.',
      'Write "line": what you say out loud as it starts (one short sentence, mention what is playing).',
      'Return JSON: {"intent": "...", "title": "", "artist": "", "album": "", "list": [{"title": "", "artist": ""}], "line": ""}'
    ]
      .filter(Boolean)
      .join('\n')
  )
}

/** Plays a list of picks and has the DJ introduce them. */
async function playPicks(all: DjPick[], line: string, context?: string, ready?: string | null): Promise<void> {
  if (!get().active) return
  // played as a context (an album), the list must stay as it is
  const picks = context ? all : uniquePicks(all)
  set({ set: picks })
  picks.forEach((p) => usedIds.add(p.id))
  // the voice is made while the music starts, not before
  const voice = ready !== undefined ? Promise.resolve(ready) : line ? render(line) : Promise.resolve(null)
  djContext = context ?? null
  setDjContinuation(null)
  if (context) await playContext(context, picks[0]?.uri, undefined, { source: 'dj' })
  else await playUris(picks.map((p) => p.uri), undefined, { source: 'dj' })
  set({ status: 'playing' })
  if (picks[0]) await waitForTrack(picks[0].uri)
  if (line && get().active) await speak(line, await voice)
}

/** Takes turns between lists (a, b, c, a, b, c…) so no artist runs twice in a row. */
function interleave<T>(lists: T[][]): T[] {
  const out: T[] = []
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i])
  return out
}

/** Builds the rest of a mood block while the first song already plays. */
let followingUp = false
function followUp(first: DjPick, theme: string, mood: Mood | null, seeds: STrack[]): void {
  followingUp = true
  void buildSet(theme, true, { mood, seeds })
    .then(({ intro, picks, theme: t }) => {
      if (!get().active || get().set[0]?.id !== first.id) return
      const rest = uniquePicks(picks, get().set)
      flavour = t
      setDjContinuation(first.id, rest.map((p) => p.uri))
      set((s) => ({ set: [...s.set, ...rest] }))
      if (intro && rest[0] && shouldTalk(1)) pendingIntros.set(rest[0].uri, intro)
    })
    .catch((e) => console.warn('[dj] could not finish the block', e))
    .finally(() => {
      followingUp = false
    })
}

async function handleRequest(request: string): Promise<void> {
  stickyMood = null
  let intent: Intent
  const grounded = await ground(request).catch((e) => {
    console.warn('[dj] could not read the request', e)
    return { direct: null, hints: '' }
  })
  try {
    intent = grounded.direct ?? (await understand(request, grounded.hints))
  } catch {
    // The model didn't answer: if the text is a song title, still play it.
    const t = await findTrack(request).catch(() => null)
    intent = t && norm(request).includes(norm(t.name)) ? { intent: 'song', title: t.name, artist: t.artists[0]?.name } : { intent: 'mood' }
  }
  const line = (intent.line ?? '').trim()

  if (intent.intent === 'song' && intent.title) {
    const t =
      intent.track ??
      (intent.trackId ? await sp.getTrack(intent.trackId).then((x) => (x?.id ? x : null)).catch(() => null) : null) ??
      (await findTrack(intent.title, intent.artist)) ??
      (await findTrack(cleanRequest(request).q || request))
    if (t) {
      nextTheme = flavour = `songs that flow well after "${t.name}" by ${t.artists[0]?.name}, in a similar style`
      return playPicks([toPick(t, 'You asked for it')], line || `Here’s ${t.name} by ${t.artists[0]?.name}.`)
    }
  }
  if (intent.intent === 'songs' && intent.list?.length) {
    const found = (await Promise.all(intent.list.slice(0, 12).map((x) => findTrack(x.title, x.artist).catch(() => null)))).filter(
      (t): t is STrack => !!t
    )
    if (found.length) {
      nextTheme = flavour = `songs in the style of ${found.map((t) => t.artists[0]?.name).join(', ')}`
      return playPicks(found.map((t) => toPick(t, 'You asked for it')), line)
    }
  }
  // the model may name several artists in "list"
  if (intent.intent === 'artists' && !intent.artists?.length && intent.list?.length) {
    intent.artists = (await resolveArtists(intent.list.map((x) => x.artist || x.title).filter(Boolean), await knownArtists()).catch(() => null)) ?? undefined
  }
  if (intent.intent === 'artists' && intent.artists && intent.artists.length >= 2) {
    const who = intent.artists
    const lib = await candidates().catch(() => [] as STrack[])
    const perArtist = await Promise.all(
      who.map(async (a) => {
        const popular = await loadArtistPopular(a.id, a.name).catch(() => [] as STrack[])
        const mine = lib.filter((t) => t.artists.some((x) => x.id === a.id))
        return dedupe([...popular.slice(0, 2), ...shuffle([...mine, ...popular.slice(2, 8)])]).slice(0, Math.max(3, Math.ceil(14 / who.length)))
      })
    )
    const list = dedupe(interleave(perArtist)).slice(0, 14)
    if (list.length) {
      const names = who.map((a) => a.name)
      const said = names.length === 2 ? `${names[0]} and ${names[1]}` : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
      nextTheme = flavour = `more from ${said}, mixed with artists that sound like them`
      return playPicks(list.map((t) => toPick(t, t.artists[0]?.name ?? '')), line || `${said}, back to back.`)
    }
  }
  if (intent.intent === 'album' && (intent.albumRef || intent.album)) {
    const al = intent.albumRef ?? (await findAlbum(intent.album!, intent.artist))
    if (al) {
      const tracks = await sp.getAlbumTracks(al.id)
      nextTheme = flavour = `songs that go with the album ${al.name} by ${al.artists[0]?.name}`
      const picks = tracks.map((t) => toPick({ ...t, album: { ...al, images: al.images } } as STrack, al.name))
      return playPicks(picks, line || `Here’s ${al.name} by ${al.artists[0]?.name}, from the top.`, al.uri)
    }
  }
  if (intent.intent === 'artist' && intent.artist) {
    let ar: { id: string; name: string } | null | undefined = intent.artistId ? { id: intent.artistId, name: intent.artist } : null
    if (!ar) ar = (await resolveArtists([intent.artist], await knownArtists()).catch(() => null))?.[0]
    if (ar) {
      const popular = await loadArtistPopular(ar.id, ar.name).catch(() => [] as STrack[])
      const mine = (await candidates()).filter((t) => t.artists.some((a) => a.id === ar.id))
      const list = dedupe([...popular.slice(0, 3), ...shuffle([...mine, ...popular.slice(3)])]).slice(0, 10)
      if (list.length) {
        nextTheme = flavour = `more ${ar.name} mixed with similar artists`
        return playPicks(list.map((t) => toPick(t, mine.includes(t) ? 'From your library' : 'Popular')), line || `A set of ${ar.name}, coming up.`)
      }
    }
  }

  // A mood, a genre, or nothing specific could be found: start right away with the best match
  // for it, and line up the rest while that plays.
  nextTheme = null
  const theme = intent.mood?.label ?? (cleanRequest(request).q || request)
  const mood = intent.mood ?? findScope(theme) ?? findMood(theme)
  if (mood?.country || mood?.era) stickyMood = mood
  const seedLists = await Promise.all((intent.seedArtists ?? []).map((a) => loadArtistPopular(a.id, a.name).catch(() => [] as STrack[])))
  const found = await searchPool(theme, mood).catch(() => [] as STrack[])
  const known = await knownArtists()
  const seeds = interleave(seedLists.map((l) => l.slice(0, 6)))
  // the first song: one by an artist they named, else a fresh hit by someone they play, else the top hit
  const first =
    seeds[0] ??
    (mood?.fresh === false
      ? (found.find((t) => t.artists.some((a) => known.has(a.id))) ?? found[0])
      : (found.find((t) => isFresh(t) && t.artists.some((a) => known.has(a.id))) ?? found.find((t) => isFresh(t)) ?? found[0]))
  if (first) {
    flavour = theme
    const pick = toPick(first, mood ? mood.label : theme)
    const said = mood ? `${mood.label.replace(/^./, (c) => c.toUpperCase())}, coming right up.` : `${theme.replace(/^./, (c) => c.toUpperCase())}, here we go.`
    const playing = playPicks([pick], line || said)
    followUp(pick, theme, mood, seeds.slice(1))
    return playing
  }
  const built = await buildSet(theme, false, { mood, seeds })
  flavour = built.theme
  return playPicks(built.picks, built.intro || line)
}

/** Starts the DJ, or answers a request (a song, an artist, an album or a mood). */
export async function startDj(request = ''): Promise<void> {
  const wasActive = get().active
  if (request) say('you', request)
  // "surprise me", "cokoliv": the DJ's own choice
  if (/^(?:(?:just )?surprise me|anything|whatever|random|cokoliv|neco|prekvap me|nahodne|co chces)$/.test(norm(request))) request = ''
  set({ active: true, status: 'thinking', error: null, line: '' })
  if (!wasActive) watch()
  try {
    if (request) await handleRequest(request)
    else {
      flavour = ''
      nextTheme = null
      // Use the show prepared when the app started, so the first song starts right away.
      if (warming) await warming
      const w = warm && Date.now() - warm.at < 3 * 3600_000 ? warm : null
      warm = null
      if (w) {
        flavour = w.theme
        await playPicks(w.picks, w.intro, undefined, w.wav)
      } else {
        const { intro, picks, theme } = await buildSet('', false, { opening: true })
        flavour = theme
        await playPicks(picks, intro)
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    set({ status: 'error', error: msg })
    say('dj', msg)
    if (!wasActive) stopDj(true)
  }
}

/* ---------- Ready before you press Start ---------- */

let warm: { at: number; intro: string; picks: DjPick[]; wav: string | null; theme: string } | null = null
let warming: Promise<void> | null = null

/** Prepares the first set (songs, intro line and its voice) in the background, so pressing
 *  Start plays at once instead of waiting for the model. Called shortly after the app starts. */
export function warmDj(): void {
  if (warm && Date.now() - warm.at > 3 * 3600_000) warm = null
  if (warming || warm || get().active) return
  const st = useApp.getState().settings
  if (st.djProvider === 'claude' && !st.djClaudeKey) return
  if (st.djProvider === 'local') void window.pulse.dj.preload()
  warming = (async () => {
    try {
      const { intro, picks, theme } = await buildSet('', false, { opening: true })
      const wav = intro ? await render(intro) : null
      warm = { at: Date.now(), intro, picks, wav, theme }
    } catch (e) {
      console.info('[dj] warm-up skipped:', e instanceof Error ? e.message : e)
    } finally {
      warming = null
    }
  })()
}

export function stopDj(keepError = false): void {
  watcher?.()
  watcher = null
  clearInterval(ticker)
  stopSpeaking()
  prepared = null
  preparedFor = null
  pendingIntros.clear()
  setDjContinuation(null)
  stickyMood = null
  djContext = null
  set((s) => ({ active: false, status: keepError ? s.status : 'idle', line: '', error: keepError ? s.error : null }))
  // the next Start should be instant again
  window.setTimeout(() => warmDj(), 4000)
}

/** Checks that the chosen model answers; used by Settings. */
export async function testDj(): Promise<string> {
  const a = await ask<{ line?: string }>('Say hello to the listener in one short sentence. Return JSON: {"line": "..."}')
  return a.line ?? ''
}

/** Songs taken out of the show in the queue; skipped if Spotify still reaches them. */
const skipIds = new Set<string>()

/** Takes a song out of the DJ's upcoming songs. */
export function removeFromDjSet(id: string): void {
  skipIds.add(id)
  set((s) => ({ set: s.set.filter((p, i) => p.id !== id || s.set.findIndex((x) => x.id === usePlayer.getState().track?.id) >= i) }))
}

export { speak as djSpeak }
