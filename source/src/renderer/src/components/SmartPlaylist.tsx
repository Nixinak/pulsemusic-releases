// Smart playlists: a playlist made by rules ("liked songs, 120–140 BPM, from 2020 on, played at
// most twice"), built on the spot from your library and your listening history. The tempo is
// measured from each song's preview (lib/audioFeatures, kept on disk), so a tempo rule takes a
// moment the first time.
import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { STrack } from '@/lib/types'
import * as sp from '@/lib/spotify'
import { songFeatures } from '@/lib/audioFeatures'
import { songKey, useHistory } from '@/lib/history'
import { playUris } from '@/lib/player'
import { useApp, errorText } from '@/lib/store'
import { coverNewPlaylist } from '@/lib/playlistCover'
import { Cover } from './common'
import { PlayIcon } from './Icons'

type Source = 'liked' | 'top' | 'history'
type Played = 'any' | 'never' | 'rarely' | 'often'
type Order = 'shuffle' | 'newest' | 'oldest' | 'most'

interface Rules {
  sources: Source[]
  yearFrom: string
  yearTo: string
  bpm: boolean
  bpmFrom: string
  bpmTo: string
  artist: string
  noExplicit: boolean
  played: Played
  maxMinutes: string
  limit: number
  order: Order
  name: string
}

const START: Rules = {
  sources: ['liked'],
  yearFrom: '',
  yearTo: '',
  bpm: false,
  bpmFrom: '120',
  bpmTo: '140',
  artist: '',
  noExplicit: false,
  played: 'any',
  maxMinutes: '',
  limit: 50,
  order: 'shuffle',
  name: ''
}

/** A few ready-made rule sets to start from. */
const PRESETS: { label: string; rules: Partial<Rules> }[] = [
  {
    label: 'Workout (120–140 BPM)',
    rules: {
      sources: ['liked', 'top'],
      bpm: true,
      bpmFrom: '120',
      bpmTo: '140',
      order: 'shuffle',
      name: 'Workout'
    }
  },
  {
    label: 'Forgotten likes',
    rules: {
      sources: ['liked'],
      played: 'never',
      order: 'shuffle',
      name: 'Forgotten likes'
    }
  },
  {
    label: 'Fresh (2024+)',
    rules: {
      sources: ['liked', 'top'],
      yearFrom: '2024',
      order: 'newest',
      name: 'Fresh'
    }
  },
  {
    label: 'Throwback (before 2015)',
    rules: {
      sources: ['liked', 'top'],
      yearTo: '2014',
      order: 'oldest',
      name: 'Throwback'
    }
  },
  {
    label: 'Chill (70–100 BPM)',
    rules: {
      sources: ['liked'],
      bpm: true,
      bpmFrom: '70',
      bpmTo: '100',
      name: 'Chill'
    }
  },
  {
    label: 'Clean only',
    rules: { sources: ['liked', 'top'], noExplicit: true, name: 'Clean' }
  }
]

const yearOf = (t: STrack): number | null => {
  const y = Number(t.album?.release_date?.slice(0, 4))
  return Number.isFinite(y) && y > 1900 ? y : null
}

function shuffle<T>(a: T[]): T[] {
  const b = a.slice()
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[b[i], b[j]] = [b[j], b[i]]
  }
  return b
}

export function SmartPlaylist(): React.JSX.Element {
  const [r, setR] = useState<Rules>(START)
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<STrack[] | null>(null)
  const [saving, setSaving] = useState(false)
  const plays = useHistory((s) => s.plays)
  const toast = useApp((s) => s.toast)
  const navigate = useApp((s) => s.navigate)
  const refreshPlaylists = useApp((s) => s.refreshPlaylists)
  const set = <K extends keyof Rules>(k: K, v: Rules[K]): void => setR((x) => ({ ...x, [k]: v }))
  const toggleSource = (s: Source): void =>
    setR((x) => ({
      ...x,
      sources: x.sources.includes(s) ? (x.sources.length > 1 ? x.sources.filter((y) => y !== s) : x.sources) : [...x.sources, s]
    }))

  // how often each song was played (from the history), for the "played" rule and the order
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of plays) if (p.ms >= 30_000) m.set(songKey(p), (m.get(songKey(p)) ?? 0) + 1)
    return m
  }, [plays])
  const playsOf = (t: STrack): number => counts.get(songKey({ name: t.name, artists: t.artists })) ?? 0

  const build = async (): Promise<void> => {
    setResult(null)
    try {
      // 1. gather
      setBusy('Gathering your songs…')
      const pool = new Map<string, STrack>()
      if (r.sources.includes('liked')) for (const i of await sp.getAllSavedTracks(1500).catch(() => [])) i.track?.id && pool.set(i.track.id, i.track)
      if (r.sources.includes('top'))
        for (const range of ['short_term', 'medium_term', 'long_term'] as const)
          for (const t of (await sp.getTopTracks(range, 50).catch(() => null))?.items ?? []) t?.id && pool.set(t.id, t)
      if (r.sources.includes('history')) {
        // songs from the history, as tracks (without a release year)
        const seen = new Set<string>()
        for (const p of [...plays].reverse()) {
          if (!p.id || p.id.startsWith('x:') || seen.has(p.id) || pool.has(p.id)) continue
          seen.add(p.id)
          pool.set(p.id, {
            id: p.id,
            name: p.name,
            uri: `spotify:track:${p.id}`,
            duration_ms: p.durationMs,
            explicit: false,
            artists: p.artists.map((a) => ({
              id: a.id,
              name: a.name,
              uri: `spotify:artist:${a.id}`
            })) as STrack['artists'],
            album: {
              id: p.album.id,
              name: p.album.name,
              uri: '',
              images: p.art ? [{ url: p.art, width: 300, height: 300 }] : [],
              artists: [],
              type: 'album'
            },
            type: 'track'
          })
          if (seen.size > 1500) break
        }
      }
      // 2. the quick rules
      const yf = Number(r.yearFrom) || 0
      const yt = Number(r.yearTo) || 9999
      const maxMs = (Number(r.maxMinutes) || 0) * 60_000
      const who = r.artist.trim().toLowerCase()
      let list = [...pool.values()].filter((t) => {
        if (t.is_local) return false
        if (r.noExplicit && t.explicit) return false
        if (maxMs && t.duration_ms > maxMs) return false
        if (who && !t.artists.some((a) => a.name.toLowerCase().includes(who))) return false
        if (yf || yt < 9999) {
          const y = yearOf(t)
          if (y === null || y < yf || y > yt) return false
        }
        const n = playsOf(t)
        if (r.played === 'never' && n > 0) return false
        if (r.played === 'rarely' && n > 2) return false
        if (r.played === 'often' && n < 5) return false
        return true
      })
      // 3. the tempo (measured, so only for as many songs as needed)
      if (r.bpm) {
        const lo = Number(r.bpmFrom) || 0
        const hi = Number(r.bpmTo) || 999
        const want = r.limit
        const kept: STrack[] = []
        const queue = shuffle(list).slice(0, 260)
        let done = 0
        const worker = async (): Promise<void> => {
          while (queue.length && kept.length < want) {
            const t = queue.shift()!
            const f = await songFeatures({
              id: t.id,
              name: t.name,
              artists: t.artists
            }).catch(() => null)
            done++
            setBusy(`Measuring the tempo… ${done} songs, ${kept.length} fit`)
            if (!f) continue
            // half and double time count too (a 70 BPM song feels like 140)
            const fits = (b: number): boolean => b >= lo && b <= hi
            if (fits(f.bpm) || fits(f.bpm * 2) || fits(f.bpm / 2)) kept.push(t)
          }
        }
        await Promise.all([worker(), worker(), worker()])
        list = kept
      }
      // 4. order and limit
      if (r.order === 'shuffle') list = shuffle(list)
      else if (r.order === 'newest') list.sort((a, b) => (yearOf(b) ?? 0) - (yearOf(a) ?? 0))
      else if (r.order === 'oldest') list.sort((a, b) => (yearOf(a) ?? 9999) - (yearOf(b) ?? 9999))
      else list.sort((a, b) => playsOf(b) - playsOf(a))
      setResult(list.slice(0, r.limit))
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  const save = async (): Promise<void> => {
    if (!result?.length) return
    setSaving(true)
    try {
      const name = r.name.trim() || 'Smart playlist'
      const p = await sp.createPlaylist(name, 'A smart playlist made with Pulse Music')
      await sp.addManyToPlaylist(
        p.id,
        result.map((t) => t.uri)
      )
      await coverNewPlaylist(
        p.id,
        result.map((t) => sp.pickImage(t.album?.images, 300)),
        name
      )
      await refreshPlaylists()
      toast(`Saved ${name}`)
      navigate({ name: 'playlist', id: p.id })
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  const chip = (on: boolean, label: string, onClick: () => void): React.JSX.Element => (
    <button key={label} className={`chip ${on ? 'is-on' : ''}`} onClick={onClick}>
      {label}
    </button>
  )

  return (
    <div className="smart">
      <div className="smart__rules">
        <div className="smart__presets">
          {PRESETS.map((p) => (
            <button key={p.label} className="smart__preset" onClick={() => setR({ ...START, ...p.rules })}>
              {p.label}
            </button>
          ))}
        </div>

        <section className="smart__group">
          <h3>From</h3>
          <div className="smart__chips">
            {chip(r.sources.includes('liked'), 'Liked songs', () => toggleSource('liked'))}
            {chip(r.sources.includes('top'), 'Your top songs', () => toggleSource('top'))}
            {chip(r.sources.includes('history'), 'Everything you played', () => toggleSource('history'))}
          </div>
        </section>

        <div className="smart__row">
          <section className="smart__group">
            <h3>Released</h3>
            <div className="smart__range">
              <input
                className="field"
                inputMode="numeric"
                placeholder="from"
                value={r.yearFrom}
                onChange={(e) => set('yearFrom', e.target.value.replace(/\D/g, '').slice(0, 4))}
              />
              <span>–</span>
              <input
                className="field"
                inputMode="numeric"
                placeholder="to"
                value={r.yearTo}
                onChange={(e) => set('yearTo', e.target.value.replace(/\D/g, '').slice(0, 4))}
              />
            </div>
          </section>
          <section className="smart__group">
            <h3>
              <label className="smart__check">
                <input type="checkbox" checked={r.bpm} onChange={(e) => set('bpm', e.target.checked)} />
                Tempo (BPM)
              </label>
            </h3>
            <div className={`smart__range ${r.bpm ? '' : 'is-off'}`}>
              <input
                className="field"
                inputMode="numeric"
                value={r.bpmFrom}
                disabled={!r.bpm}
                onChange={(e) => set('bpmFrom', e.target.value.replace(/\D/g, '').slice(0, 3))}
              />
              <span>–</span>
              <input
                className="field"
                inputMode="numeric"
                value={r.bpmTo}
                disabled={!r.bpm}
                onChange={(e) => set('bpmTo', e.target.value.replace(/\D/g, '').slice(0, 3))}
              />
            </div>
          </section>
          <section className="smart__group">
            <h3>Longest song</h3>
            <div className="smart__range">
              <input
                className="field"
                inputMode="numeric"
                placeholder="any"
                value={r.maxMinutes}
                onChange={(e) => set('maxMinutes', e.target.value.replace(/\D/g, '').slice(0, 2))}
              />
              <span>min</span>
            </div>
          </section>
        </div>

        <section className="smart__group">
          <h3>How often you played it</h3>
          <div className="smart__chips">
            {chip(r.played === 'any', 'Any', () => set('played', 'any'))}
            {chip(r.played === 'never', 'Never', () => set('played', 'never'))}
            {chip(r.played === 'rarely', 'Once or twice', () => set('played', 'rarely'))}
            {chip(r.played === 'often', 'A lot (5+)', () => set('played', 'often'))}
          </div>
        </section>

        <div className="smart__row">
          <section className="smart__group">
            <h3>Artist</h3>
            <input className="field" placeholder="any artist" value={r.artist} onChange={(e) => set('artist', e.target.value)} />
          </section>
          <section className="smart__group">
            <h3>Order</h3>
            <div className="smart__chips">
              {chip(r.order === 'shuffle', 'Shuffled', () => set('order', 'shuffle'))}
              {chip(r.order === 'newest', 'Newest', () => set('order', 'newest'))}
              {chip(r.order === 'oldest', 'Oldest', () => set('order', 'oldest'))}
              {chip(r.order === 'most', 'Most played', () => set('order', 'most'))}
            </div>
          </section>
        </div>

        <div className="smart__row">
          <section className="smart__group">
            <h3>Songs</h3>
            <div className="smart__chips">{[25, 50, 100].map((n) => chip(r.limit === n, String(n), () => set('limit', n)))}</div>
          </section>
          <section className="smart__group">
            <h3>&nbsp;</h3>
            <label className="smart__check">
              <input type="checkbox" checked={r.noExplicit} onChange={(e) => set('noExplicit', e.target.checked)} />
              No explicit songs
            </label>
          </section>
        </div>

        <div className="smart__go">
          <input className="field" placeholder="Name (optional)" value={r.name} onChange={(e) => set('name', e.target.value)} />
          <button className="btn btn--accent" disabled={!!busy} onClick={() => void build()}>
            {busy ? 'Building…' : 'Build playlist'}
          </button>
        </div>
        {busy && <p className="smart__busy muted">{busy}</p>}
      </div>

      <AnimatePresence>
        {result && (
          <motion.section className="smart__result" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <header>
              <div>
                <h3>{r.name.trim() || 'Smart playlist'}</h3>
                <span className="muted">{result.length ? `${result.length} songs fit your rules` : 'No songs fit these rules. Try wider ones.'}</span>
              </div>
              {result.length > 0 && (
                <div className="smart__actions">
                  <button className="btn btn--accent" onClick={() => void playUris(result.map((t) => t.uri))}>
                    <PlayIcon size={16} /> Play
                  </button>
                  <button className="btn" disabled={saving} onClick={() => void save()}>
                    {saving ? 'Saving…' : 'Save as playlist'}
                  </button>
                </div>
              )}
            </header>
            <ol className="smart__list">
              {result.map((t, i) => (
                <li
                  key={t.id}
                  onDoubleClick={() =>
                    void playUris(
                      result.map((x) => x.uri),
                      t.uri
                    )
                  }
                >
                  <span className="smart__n">{i + 1}</span>
                  <Cover src={sp.pickImage(t.album?.images, 64)} size={40} radius={8} />
                  <span className="smart__t">
                    <b>{t.name}</b>
                    <small>
                      {t.artists.map((a) => a.name).join(', ')}
                      {yearOf(t) ? ` · ${yearOf(t)}` : ''}
                    </small>
                  </span>
                </li>
              ))}
            </ol>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  )
}
