// Mix generator: builds a fresh mix from your own library (liked songs, playlists, top songs)
// and any artists you pick (also ones you don't have saved), with a mood, an era and artist
// spacing. Play it or save it as a playlist.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useApp, errorText } from '@/lib/store'
import * as sp from '@/lib/spotify'
import type { STrack } from '@/lib/types'
import { useHistory } from '@/lib/history'
import { playUris } from '@/lib/player'
import { formatDuration, plural } from '@/lib/format'
import { Cover, Slider, usePagePalette } from '@/components/common'
import { CoverStack } from '@/components/CoverWalls'
import { MixMaker, type MixMakerResult, type MixSong } from '@/components/MixMaker'
import { TrackList } from '@/components/TrackList'
import { CloseIcon, HeartIcon, PlayIcon, PlusIcon, SearchIcon, ShuffleIcon, SparkleIcon } from '@/components/Icons'
import { useQuery } from '@/lib/useQuery'
import { loadArtistPopular, loadArtistReleases } from '@/lib/loaders'
import { findMood, FRESH, norm } from '@/lib/djIntent'

interface PickedArtist {
  id: string
  name: string
  image: string | null
}

/** Search box with suggestions for adding artists to the mix. */
function ArtistPicker({
  picked,
  onAdd,
  suggestions
}: {
  picked: PickedArtist[]
  onAdd: (a: PickedArtist) => void
  suggestions: PickedArtist[]
}): React.JSX.Element {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<PickedArtist[] | null>(null)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) return setResults(null)
    let alive = true
    // Wait for a pause in typing so every key doesn't become a request.
    const t = window.setTimeout(() => {
      sp.searchArtists(term)
        .then((list) => alive && setResults(list.map((a) => ({ id: a.id, name: a.name, image: sp.pickImage(a.images, 64) }))))
        .catch(() => alive && setResults([]))
    }, 350)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [q])
  useEffect(() => {
    const close = (e: MouseEvent): void => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [])
  const has = (id: string): boolean => picked.some((p) => p.id === id)
  const add = (a: PickedArtist): void => {
    onAdd(a)
    setQ('')
    setResults(null)
  }
  const list = (results ?? []).filter((a) => !has(a.id))
  return (
    <div className="apick" ref={box}>
      <label className="apick__field">
        <SearchIcon size={16} />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && list[0]) add(list[0])
            if (e.key === 'Escape') setOpen(false)
          }}
          placeholder="Add any artist…"
          spellCheck={false}
          aria-label="Search for an artist"
        />
      </label>
      {open && q.trim().length >= 2 && (
        <div className="apick__menu">
          {results === null ? (
            <div className="apick__empty">Searching…</div>
          ) : list.length === 0 ? (
            <div className="apick__empty">No artists found.</div>
          ) : (
            list.map((a) => (
              <button key={a.id} className="apick__item" onClick={() => add(a)}>
                <Cover src={a.image} size={32} round />
                {a.name}
              </button>
            ))
          )}
        </div>
      )}
      {suggestions.filter((a) => !has(a.id)).length > 0 && (
        <div className="pills apick__suggest">
          {suggestions
            .filter((a) => !has(a.id))
            .slice(0, 12)
            .map((a) => (
              <button key={a.id} className="pill pill--src" onClick={() => onAdd(a)}>
                <Cover src={a.image} size={22} round />
                {a.name}
              </button>
            ))}
        </div>
      )}
    </div>
  )
}

type Vibe = 'balanced' | 'favourites' | 'deep' | 'fresh' | 'throwback' | 'custom'

const VIBES: { id: Vibe; label: string; text: string }[] = [
  { id: 'balanced', label: 'Balanced', text: 'A fair pick from everything' },
  { id: 'favourites', label: 'Favourites', text: 'Songs you play the most' },
  { id: 'deep', label: 'Deep cuts', text: 'Saved songs you rarely play' },
  { id: 'fresh', label: 'Fresh', text: 'Your newest additions' },
  { id: 'throwback', label: 'Throwback', text: 'Songs you saved long ago' }
]

/** A typed feel: songs Spotify finds for it, and the artists behind them. */
interface Described {
  ids: Set<string>
  artists: Set<string>
  words: string[]
  tracks: STrack[]
}
const describedCache = new Map<string, Promise<Described>>()
function describe(text: string): Promise<Described> {
  const key = norm(text)
  let p = describedCache.get(key)
  if (!p) {
    p = (async () => {
      const mood = findMood(text)
      const queries = (mood ? mood.queries.slice(0, 3) : [text]).flatMap((q) => (mood?.id === 'new' ? [`${q} ${FRESH}`] : [q, `${q} ${FRESH}`]))
      const pages = await Promise.all(queries.flatMap((q) => [0, 10].map((o) => sp.searchTracks(q, o).catch(() => null))))
      const tracks = pages.flatMap((r) => (r?.tracks?.items ?? []).filter((t): t is STrack => !!t?.id))
      const words = key.split(' ').filter((w) => w.length > 3)
      return { ids: new Set(tracks.map((t) => t.id)), artists: new Set(tracks.flatMap((t) => t.artists.map((a) => a.id))), words, tracks }
    })()
    p.catch(() => describedCache.delete(key))
    describedCache.set(key, p)
  }
  return p
}

/** The length slider: the first half goes 10–100 songs in fives, the second 100–200 in tens. */
const MAX_SONGS = 200
const posToCount = (pos: number): number =>
  pos <= 50 ? Math.max(10, Math.round((10 + (pos / 50) * 90) / 5) * 5) : Math.min(MAX_SONGS, Math.round((100 + ((pos - 50) / 50) * (MAX_SONGS - 100)) / 10) * 10)
const countToPos = (n: number): number => (n <= 100 ? ((n - 10) / 90) * 50 : 50 + ((n - 100) / (MAX_SONGS - 100)) * 50)

const DECADES = [1960, 1970, 1980, 1990, 2000, 2010, 2020]

interface Candidate {
  track: STrack
  addedAt: number
}

const libraryCache = new Map<string, Promise<Candidate[]>>()
function loadSource(id: string): Promise<Candidate[]> {
  let p = libraryCache.get(id)
  if (!p) {
    p = (async () => {
      if (id === 'liked') {
        const items = await sp.getAllSavedTracks(3000)
        return items.map((i) => ({ track: i.track, addedAt: Date.parse(i.added_at) }))
      }
      if (id.startsWith('top:')) {
        const r = await sp.getTopTracks(id.slice(4) as sp.TimeRange, 50)
        return r.items.map((t) => ({ track: t, addedAt: 0 }))
      }
      const r = await sp.getPlaylistEntries(id)
      return r.entries.map((e) => ({ track: e.track, addedAt: e.addedAt ? Date.parse(e.addedAt) : 0 }))
    })()
    p.catch(() => libraryCache.delete(id))
    libraryCache.set(id, p)
  }
  return p
}

const year = (t: STrack): number => Number((t.album?.release_date ?? '').slice(0, 4)) || 0

function generate(
  pool: Candidate[],
  o: { vibe: Vibe; count: number; decades: number[]; perArtist: number; artists: string[]; described?: Described | null },
  playCounts: Map<string, number>,
  topIds: Set<string>
): STrack[] {
  let list = pool
  if (o.decades.length) list = list.filter((c) => o.decades.some((d) => year(c.track) >= d && year(c.track) < d + 10))
  if (o.artists.length) list = list.filter((c) => c.track.artists.some((a) => o.artists.includes(a.id)))
  if (o.vibe === 'deep') list = list.filter((c) => !topIds.has(c.track.id))
  if (list.length === 0) return []

  const byAdded = [...list].sort((a, b) => b.addedAt - a.addedAt)
  const rank = new Map(byAdded.map((c, i) => [c.track.id, i / Math.max(1, byAdded.length - 1)]))
  const weight = (c: Candidate): number => {
    const plays = playCounts.get(c.track.id) ?? 0
    const r = rank.get(c.track.id) ?? 0.5
    switch (o.vibe) {
      case 'favourites':
        return 1 + plays * 3 + (topIds.has(c.track.id) ? 8 : 0)
      case 'deep':
        return 1 / (1 + plays * 2)
      case 'fresh':
        return Math.exp(-r * 5)
      case 'throwback':
        return Math.exp(-(1 - r) * 5)
      case 'custom': {
        const d = o.described
        if (!d) return 1
        if (d.ids.has(c.track.id)) return 6
        if (c.track.artists.some((a) => d.artists.has(a.id))) return 4 + Math.min(2, plays)
        const title = norm(`${c.track.name} ${c.track.album?.name ?? ''}`)
        if (d.words.some((w) => title.includes(w))) return 3
        return 0.12
      }
      default:
        return 1
    }
  }
  // Weighted sampling without replacement (each song gets a random key, largest keys win).
  const keyed = list.map((c) => ({ c, k: Math.pow(Math.random(), 1 / Math.max(1e-6, weight(c))) })).sort((a, b) => b.k - a.k)
  const perArtist = new Map<string, number>()
  const out: STrack[] = []
  for (const { c } of keyed) {
    if (out.length >= o.count) break
    const main = c.track.artists[0]?.id ?? ''
    const n = perArtist.get(main) ?? 0
    if (o.perArtist > 0 && n >= o.perArtist) continue
    perArtist.set(main, n + 1)
    out.push(c.track)
  }
  // Space artists out: no artist twice in a row when it can be avoided.
  for (let i = 1; i < out.length; i++) {
    if (out[i].artists[0]?.id !== out[i - 1].artists[0]?.id) continue
    const j = out.findIndex((t, k) => k > i && t.artists[0]?.id !== out[i - 1].artists[0]?.id && t.artists[0]?.id !== out[i + 1]?.artists[0]?.id)
    if (j > 0) [out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export function MixView(): React.JSX.Element {
  const allPlaylists = useApp((s) => s.playlists)
  const me = useApp((s) => s.me)
  const playlists = useMemo(() => allPlaylists.filter((p) => p.owner.id === me?.id || p.collaborative), [allPlaylists, me])
  const toast = useApp((s) => s.toast)
  const navigate = useApp((s) => s.navigate)
  const refreshPlaylists = useApp((s) => s.refreshPlaylists)
  const plays = useHistory((s) => s.plays)
  const [sources, setSources] = useState<string[]>(['liked', 'top:medium_term'])
  const [vibe, setVibe] = useState<Vibe>('balanced')
  /** What the listener typed for the feel (vibe is 'custom' while there's text). */
  const [feelText, setFeelText] = useState('')
  const [count, setCount] = useState(40)
  const [decades, setDecades] = useState<number[]>([])
  const [perArtist, setPerArtist] = useState(3)
  const [picked, setPicked] = useState<PickedArtist[]>([])
  /** With artists picked: only their songs (true), or theirs mixed into your library (false). */
  const [onlyPicked, setOnlyPicked] = useState(true)
  const topArtists = useQuery('home:artists', sp.getTopArtists)
  const [pool, setPool] = useState<Candidate[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [mix, setMix] = useState<STrack[] | null>(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  /** The full-screen show while the mix is made (closing it doesn't stop the mix). */
  const [showOpen, setShowOpen] = useState(false)
  const [shown, setShown] = useState<MixMakerResult | null>(null)
  const [showFailed, setShowFailed] = useState(false)
  usePagePalette(mix?.[0] ? sp.pickImage(mix[0].album?.images, 300) : null)

  const playCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of plays) m.set(p.id, (m.get(p.id) ?? 0) + 1)
    return m
  }, [plays])

  const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  const loadPool = async (): Promise<Candidate[]> => {
    // With only the picked artists, the library sources still add those artists' saved songs.
    const lists = await Promise.all(sources.map((s) => loadSource(s).catch(() => [] as Candidate[])))
    // Each picked artist's popular songs from Spotify, so artists you haven't saved work too.
    const want = picked.length ? Math.ceil(count / picked.length) : 0
    for (const a of picked) {
      const songs = await loadArtistPopular(a.id, a.name).catch(() => [] as STrack[])
      lists.push(songs.map((t) => ({ track: t, addedAt: 0 })))
      // Not enough for their share of the mix: add songs from their latest releases too.
      if (onlyPicked && songs.length < want) {
        const releases = await loadArtistReleases(a.id, a.name).catch(() => [])
        let found = songs.length
        for (const r of releases.slice(0, 4)) {
          if (found >= want * 1.5) break
          const tracks = await sp.getAlbumTracks(r.id).catch(() => [] as STrack[])
          const withArt = tracks.filter((t) => t.artists.some((x) => x.id === a.id)).map((t) => ({ ...t, album: t.album ?? r }) as STrack)
          lists.push(withArt.map((t) => ({ track: t, addedAt: 0 })))
          found += withArt.length
        }
      }
    }
    const seen = new Map<string, Candidate>()
    for (const c of lists.flat()) {
      if (!c.track.id || c.track.is_local) continue
      const prev = seen.get(c.track.id)
      if (!prev || c.addedAt > prev.addedAt) seen.set(c.track.id, c)
    }
    return [...seen.values()]
  }

  const run = async (): Promise<void> => {
    if (sources.length === 0 && picked.length === 0) return toast('Pick at least one source or artist.', 'error')
    setLoading(true)
    setShown(null)
    setShowFailed(false)
    setShowOpen(true)
    try {
      const custom = vibe === 'custom' && feelText.trim().length > 1
      const [base, described] = await Promise.all([loadPool(), custom ? describe(feelText.trim()) : Promise.resolve(null)])
      // songs found for the typed feel join the pool, so it fits even beyond your library
      const p = described ? [...base, ...described.tracks.filter((t) => !base.some((c) => c.track.id === t.id)).map((t) => ({ track: t, addedAt: 0 }))] : base
      setPool(p)
      const top = await sp.getTopTracks('short_term', 50).catch(() => null)
      const topIds = new Set((top?.items ?? []).map((t) => t.id))
      const only = picked.length > 0 && onlyPicked
      const result = generate(
        p,
        {
          vibe,
          count,
          decades,
          // A mix of just two or three artists can't keep the per-artist limit.
          perArtist: only ? 0 : perArtist,
          artists: only ? picked.map((a) => a.id) : [],
          described
        },
        playCounts,
        topIds
      )
      if (result.length === 0) {
        setShowFailed(true)
        toast('No songs match those filters. Try fewer filters.', 'error')
      }
      else if (result.length < count) toast(`Only ${result.length} songs fit. Add sources or raise “Same artist” for a longer mix.`)
      setMix(result)
      // bring the new mix into view
      if (result.length) window.setTimeout(() => document.querySelector('.mix__result')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120)
      const vibeLabel = custom ? feelText.trim().replace(/^./, (c) => c.toUpperCase()) : (VIBES.find((v) => v.id === vibe)?.label ?? 'Balanced')
      const date = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
      const mixName = only
        ? `${picked
            .slice(0, 3)
            .map((a) => a.name)
            .join(', ')}${picked.length > 3 ? ' and more' : ''} mix`
        : `${vibeLabel} mix, ${date}`
      setName(mixName)
      if (result.length)
        setShown({
          name: mixName,
          covers: result.map((t) => sp.pickImage(t.album?.images, 300)).filter((x): x is string => !!x),
          songs: result.length,
          length: formatDuration(result.reduce((n, t) => n + t.duration_ms, 0)),
          tracks: result.map((t) => ({
            uri: t.uri,
            name: t.name,
            artist: t.artists.map((a) => a.name).join(', '),
            image: sp.pickImage(t.album?.images, 64),
            durationMs: t.duration_ms
          }))
        })
    } catch (e) {
      setShowFailed(true)
      toast(errorText(e), 'error')
    } finally {
      setLoading(false)
    }
  }

  // Quick picks: your top artists, then artists from the songs read last time.
  const suggestions = useMemo<PickedArtist[]>(() => {
    const out = new Map<string, PickedArtist>()
    for (const a of topArtists.data?.items ?? []) out.set(a.id, { id: a.id, name: a.name, image: sp.pickImage(a.images, 64) })
    for (const c of pool ?? []) {
      const a = c.track.artists[0]
      if (a && !out.has(a.id)) out.set(a.id, { id: a.id, name: a.name, image: sp.pickImage(c.track.album?.images, 64) })
      if (out.size > 30) break
    }
    return [...out.values()]
  }, [topArtists.data, pool])

  const save = async (): Promise<void> => {
    if (!mix?.length) return
    setSaving(true)
    setShowOpen(false)
    try {
      const p = await sp.createPlaylist(name || 'Pulse mix', 'Made with the Pulse Music mix generator')
      await sp.addManyToPlaylist(
        p.id,
        mix.map((t) => t.uri)
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

  const closeShow = useCallback(() => setShowOpen(false), [])

  const sourceOptions: { id: string; label: string; image?: string | null; icon?: React.ReactNode }[] = [
    { id: 'liked', label: 'Liked Songs', icon: <HeartIcon size={16} filled /> },
    { id: 'top:short_term', label: 'Top songs, 4 weeks' },
    { id: 'top:medium_term', label: 'Top songs, 6 months' },
    { id: 'top:long_term', label: 'Top songs, all time' },
    ...playlists.map((p) => ({ id: p.id, label: p.name, image: sp.pickImage(p.images, 64) }))
  ]

  const total = mix?.reduce((n, t) => n + t.duration_ms, 0) ?? 0

  // Songs for the show to look through: a shuffled handful of everything read.
  const showItems = useMemo<MixSong[]>(() => {
    if (!pool?.length) return []
    const out: MixSong[] = []
    const seen = new Set<string>()
    for (let i = 0; i < 600 && out.length < 120; i++) {
      const c = pool[Math.floor(Math.random() * pool.length)]
      const img = c && sp.pickImage(c.track.album?.images, 300)
      if (!c || !img || seen.has(c.track.id)) continue
      seen.add(c.track.id)
      out.push({ image: img, name: c.track.name, artist: c.track.artists.map((a) => a.name).join(', ') })
    }
    return out
  }, [pool])

  // Ctrl+Enter makes the mix from anywhere on the page
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !loading) {
        e.preventDefault()
        void run()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // What the mix will be made of, in words and covers, for the preview next to the controls.
  const chosen = sourceOptions.filter((o) => sources.includes(o.id))
  const previewArt = [
    ...(mix ?? []).slice(0, 7).map((t) => sp.pickImage(t.album?.images, 300)),
    ...picked.map((a) => a.image),
    ...chosen.map((c) => c.image ?? null).filter(Boolean),
    ...(topArtists.data?.items ?? []).slice(0, 6).map((a) => sp.pickImage(a.images, 300))
  ].slice(0, 7)
  const summary = [
    picked.length && onlyPicked ? `Only ${picked.map((a) => a.name).slice(0, 3).join(', ')}${picked.length > 3 ? ' and more' : ''}` : chosen.map((c) => c.label).slice(0, 2).join(' and ') + (chosen.length > 2 ? ` and ${chosen.length - 2} more` : ''),
    vibe === 'custom' ? feelText.trim().toLowerCase() : (VIBES.find((v) => v.id === vibe)?.label ?? '').toLowerCase(),
    decades.length ? [...decades].sort((x, y) => x - y).map((d) => `${String(d).slice(2)}s`).join(', ') : '',
    plural(count, 'song')
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <div className="mix">
      <MixMaker
        open={showOpen}
        items={showItems}
        result={shown}
        failed={showFailed}
        saving={saving}
        onClose={closeShow}
        onPlay={() => mix && void playUris(mix.map((t) => t.uri))}
        onPlayAt={(i) => mix?.[i] && void playUris(mix.map((t) => t.uri), mix[i].uri)}
        onSave={() => void save()}
      />
      <header className="mix__top">
        <h1 className="page-title">Mix</h1>
        <p className="muted">A new mix from music you love, made your way.</p>
      </header>

      <div className="mix__layout">
        <div className="mix__controls">
          <section className="mix__group">
            <h3>Take songs from</h3>
            <div className="pills">
              {sourceOptions.map((s) => (
                <button key={s.id} className={`pill pill--src ${sources.includes(s.id) ? 'is-on' : ''}`} onClick={() => setSources((l) => toggle(l, s.id))}>
                  {s.image !== undefined ? <Cover src={s.image} size={22} radius={5} /> : s.icon}
                  {s.label}
                </button>
              ))}
            </div>
          </section>

          <section className="mix__group">
            <h3>
              Artists
              {picked.length > 0 && (
                <button className="link mix__clear" onClick={() => setPicked([])}>
                  Clear
                </button>
              )}
            </h3>
            {picked.length > 0 && (
              <div className="pills mix__picked">
                {picked.map((a) => (
                  <span key={a.id} className="pill pill--src is-on">
                    <Cover src={a.image} size={22} round />
                    {a.name}
                    <button className="mix__x" aria-label={`Remove ${a.name}`} onClick={() => setPicked((l) => l.filter((x) => x.id !== a.id))}>
                      <CloseIcon size={13} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <ArtistPicker picked={picked} suggestions={suggestions} onAdd={(a) => setPicked((l) => (l.some((x) => x.id === a.id) ? l : [...l, a]))} />
            {picked.length > 0 && (
              <div className="pills mix__mode">
                <button className={`pill ${onlyPicked ? 'is-on' : ''}`} onClick={() => setOnlyPicked(true)}>
                  Only these artists
                </button>
                <button className={`pill ${!onlyPicked ? 'is-on' : ''}`} onClick={() => setOnlyPicked(false)}>
                  Mix them into my library
                </button>
              </div>
            )}
          </section>

          <section className="mix__group">
            <h3>Feel</h3>
            <div className="mix__vibes">
              {VIBES.map((v) => (
                <button
                  key={v.id}
                  className={`mix__vibe ${vibe === v.id ? 'is-on' : ''}`}
                  onClick={() => {
                    setVibe(v.id)
                    setFeelText('')
                  }}
                >
                  <b>{v.label}</b>
                  <small>{v.text}</small>
                </button>
              ))}
            </div>
            <label className={`mix__feel ${vibe === 'custom' ? 'is-on' : ''}`}>
              <SparkleIcon size={18} />
              <input
                value={feelText}
                maxLength={80}
                placeholder="Or type your own feel"
                spellCheck={false}
                onChange={(e) => {
                  setFeelText(e.target.value)
                  setVibe(e.target.value.trim() ? 'custom' : 'balanced')
                }}
                onKeyDown={(e) => e.key === 'Enter' && !loading && void run()}
              />
              {feelText && (
                <button
                  className="mix__x"
                  aria-label="Clear"
                  onClick={(e) => {
                    e.preventDefault()
                    setFeelText('')
                    setVibe('balanced')
                  }}
                >
                  <CloseIcon size={13} />
                </button>
              )}
            </label>
          </section>

          <section className="mix__group">
            <h3>Era</h3>
            <div className="pills">
              <button className={`pill ${decades.length === 0 ? 'is-on' : ''}`} onClick={() => setDecades([])}>
                Any
              </button>
              {DECADES.map((d) => (
                <button key={d} className={`pill ${decades.includes(d) ? 'is-on' : ''}`} onClick={() => setDecades((l) => toggle(l, d))}>
                  {String(d).slice(2)}s
                </button>
              ))}
            </div>
          </section>

          <div className="mix__row">
            <section className="mix__group">
              <h3>
                Length <span className="mix__val">{plural(count, 'song')}</span>
              </h3>
              <Slider className="mix__slider" value={countToPos(count)} max={100} label="Number of songs" onCommit={(v) => setCount(posToCount(v))} onPreview={(v) => v !== null && setCount(posToCount(v))} />
            </section>
            <section className="mix__group">
              <h3>Same artist</h3>
              <div className="pills">
                {[1, 2, 3, 5, 0].map((n) => (
                  <button key={n} className={`pill ${perArtist === n ? 'is-on' : ''}`} onClick={() => setPerArtist(n)}>
                    {n === 0 ? 'No limit' : `Up to ${n}`}
                  </button>
                ))}
              </div>
            </section>
          </div>
        </div>

        <aside className="mix__preview">
          <CoverStack images={previewArt} className="mix__stack" />
          <p className="mix__summary">{summary}</p>
          <button className={`mixgo ${loading ? 'is-busy' : ''}`} disabled={loading} onClick={() => void run()}>
            <span className="mixgo__sheen" aria-hidden="true" />
            <span className="mixgo__icon" aria-hidden="true">
              {loading ? <span className="cmd__spin" /> : <ShuffleIcon size={20} />}
            </span>
            <span className="mixgo__text">
              <b>{loading ? 'Reading your library…' : mix ? 'Make another' : 'Make my mix'}</b>
              <small>
                {plural(count, 'song')} · {vibe === 'custom' && feelText.trim() ? feelText.trim() : (VIBES.find((v) => v.id === vibe)?.label ?? 'Balanced')}
              </small>
            </span>
            <span className="mixgo__arrow" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </span>
          </button>
          <small className="mixgo__hint">or press Ctrl + Enter</small>
          {pool && <small className="muted">{plural(pool.length, 'song')} to choose from</small>}
        </aside>
      </div>

      <AnimatePresence mode="wait">
        {mix && mix.length > 0 && (
          <motion.section
            key={mix.map((t) => t.id).join().slice(0, 80)}
            className="mix__result"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ type: 'spring', stiffness: 200, damping: 26 }}
          >
            <div className="mix__result-head">
              <div className="mix__mosaic" aria-hidden="true">
                {mix.slice(0, 4).map((t, i) => (
                  <Cover key={`${t.id}-${i}`} src={sp.pickImage(t.album?.images, 300)} radius={0} />
                ))}
              </div>
              <div className="mix__result-text">
                <input className="mix__name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} aria-label="Mix name" />
                <span className="muted">
                  {plural(mix.length, 'song')}, {formatDuration(total)}
                </span>
                <div className="phead__actions">
                  <button className="play-fab" aria-label="Play mix" onClick={() => void playUris(mix.map((t) => t.uri))}>
                    <PlayIcon size={24} />
                  </button>
                  <button className="btn" disabled={saving} onClick={() => void save()}>
                    <PlusIcon size={17} /> {saving ? 'Saving…' : 'Save as playlist'}
                  </button>
                </div>
              </div>
            </div>
            <TrackList tracks={mix} onPlay={(i) => void playUris(mix.map((t) => t.uri), mix[i].uri)} onReorder={(a, b) => setMix((m) => {
              if (!m) return m
              const next = m.slice()
              const [x] = next.splice(a, 1)
              next.splice(b, 0, x)
              return next
            })} />
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  )
}
