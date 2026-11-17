// Your stats: how long you've listened this year on Spotify and Pulse together, Replay for every
// month, your top artists and songs for the last week, this year (counted from your listening
// history: Pulse plus your other Spotify apps) or all time (Spotify's own ranking), what those
// lists say about you, and fun facts from your history (streaks, repeats, sessions…).
import { Emo } from '@/components/Emoji'
import { ReplayMonths } from './ReplayMonths'
import { ListeningTime } from './ListeningTime'
import { useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { useApp } from '@/lib/store'
import { computeStats, isRealId, startOfYear, useHistory } from '@/lib/history'
import { funFacts } from '@/lib/funFacts'
import { FocusImg } from '@/components/FocusImg'
import { formatMinutes } from '@/lib/recap'
import { useQuery } from '@/lib/useQuery'
import * as sp from '@/lib/spotify'
import { playContext, playUris } from '@/lib/player'
import { Cover, Skeleton, usePagePalette } from '@/components/common'
import { useArtistPicture, useSongPicture } from '@/lib/imageFill'
import { PlayIcon, SparkleIcon } from '@/components/Icons'
import type { SArtist, STrack } from '@/lib/types'

type Range = 'week' | 'year' | 'all'

const RANGES: { id: Range; label: string; long: string }[] = [
  { id: 'week', label: 'Last week', long: 'the last 7 days' },
  { id: 'year', label: 'This year', long: `${new Date().getFullYear()}` },
  { id: 'all', label: 'All time', long: 'all time' }
]

/** The same shape for Spotify's rankings and our own. */
interface TopArtist {
  id: string
  name: string
  image: string | null
  uri: string
  minutes?: number
}
interface TopTrack {
  id: string
  uri: string
  name: string
  artists: { id: string; name: string }[]
  image: string | null
  small: string | null
  year: number | null
  minutes?: number
}

const fromSpArtist = (a: SArtist): TopArtist => ({ id: a.id, name: a.name, image: sp.pickImage(a.images, 640), uri: a.uri })
const fromSpTrack = (t: STrack): TopTrack => ({
  id: t.id,
  uri: t.uri,
  name: t.name,
  artists: t.artists.map((a) => ({ id: a.id, name: a.name })),
  image: sp.pickImage(t.album?.images, 300),
  small: sp.pickImage(t.album?.images, 64),
  year: Number((t.album?.release_date ?? '').slice(0, 4)) || null
})

/** Enough plays in the period to rank them ourselves; otherwise Spotify's nearest list fills in. */
const ENOUGH: Record<Exclude<Range, 'all'>, number> = { week: 8, year: 25 }
const FALLBACK: Record<Exclude<Range, 'all'>, sp.TimeRange> = { week: 'short_term', year: 'medium_term' }

/** A song's cover; imported plays without one get it looked up. */
function TrackArt({ t }: { t: TopTrack }): React.JSX.Element {
  const src = useSongPicture(t.name, t.artists[0]?.name, t.id, t.small)
  return <Cover src={src} size={46} radius={8} />
}

function ArtistTile({ artist, rank }: { artist: TopArtist; rank: number }): React.JSX.Element {
  const navigate = useApp((s) => s.navigate)
  const real = isRealId(artist.id)
  const image = useArtistPicture(artist.name, artist.id, artist.image)
  return (
    <li className={real ? '' : 'is-plain'} onClick={() => real && navigate({ name: 'artist', id: artist.id })}>
      <Cover src={image} round />
      <b>
        <span>{rank}</span> {artist.name}
      </b>
      {artist.minutes !== undefined && <small>{formatMinutes(artist.minutes)}</small>}
    </li>
  )
}

export function StatsView(): React.JSX.Element {
  const navigate = useApp((s) => s.navigate)
  const setRecapOpen = useApp((s) => s.setRecapOpen)
  const [range, setRange] = useState<Range>('week')
  const plays = useHistory((s) => s.plays)
  const loaded = useHistory((s) => s.loaded)
  // our own ranking for the week and the year, from the listening history
  const own = useMemo(() => {
    if (range === 'all') return null
    const from = range === 'week' ? Date.now() - 7 * 86_400_000 : startOfYear()
    const st = computeStats(plays, from)
    if (st.plays < ENOUGH[range]) return null
    const artists: TopArtist[] = st.artists.slice(0, 50).map((a) => ({
      id: a.item.id,
      name: a.item.name,
      image: null,
      uri: isRealId(a.item.id) ? `spotify:artist:${a.item.id}` : '',
      minutes: Math.round(a.ms / 60_000)
    }))
    const tracks: TopTrack[] = st.songs.slice(0, 50).map((x) => ({
      id: x.item.id,
      uri: isRealId(x.item.id) ? `spotify:track:${x.item.id}` : '',
      name: x.item.name,
      artists: x.item.artists,
      image: x.item.art,
      small: x.item.art,
      year: null,
      minutes: Math.round(x.ms / 60_000)
    }))
    return { artists, tracks, minutes: Math.round(st.ms / 60_000) }
  }, [range, plays])
  const spRange: sp.TimeRange = range === 'all' ? 'long_term' : FALLBACK[range]
  const needSpotify = range === 'all' || (loaded && !own)
  const spArtists = useQuery(needSpotify ? `stats:artists50:${spRange}` : null, () => sp.getTopArtists(spRange, 50))
  const spTracks = useQuery(needSpotify ? `stats:tracks50:${spRange}` : null, () => sp.getTopTracks(spRange, 50))
  const artistList: TopArtist[] = useMemo(
    () => own?.artists ?? (spArtists.data?.items ?? []).filter((a) => a?.id).map(fromSpArtist),
    [own, spArtists.data]
  )
  const top: TopTrack[] = useMemo(() => own?.tracks ?? (spTracks.data?.items ?? []).filter((t) => t?.id).map(fromSpTrack), [own, spTracks.data])
  const loading = !loaded || (needSpotify && spArtists.loading && !spArtists.data)
  const hero = artistList[0]
  const heroImage = useArtistPicture(hero?.name, hero?.id, hero?.image ?? null)
  usePagePalette(heroImage)
  const label = RANGES.find((r) => r.id === range)!
  /** Spotify's list stands in while the history is short. */
  const borrowed = range !== 'all' && !own && loaded
  const playable = (list: TopTrack[]): string[] => list.map((t) => t.uri).filter(Boolean)

  // What the top songs say: how many artists, who has the most songs in it, how new it is.
  const facts = useMemo(() => {
    if (!top.length) return null
    const byArtist = new Map<string, { name: string; n: number }>()
    for (const t of top) for (const a of t.artists) byArtist.set(a.name.toLowerCase(), { name: a.name, n: (byArtist.get(a.name.toLowerCase())?.n ?? 0) + 1 })
    const lead = [...byArtist.values()].sort((a, b) => b.n - a.n)[0]
    const year = new Date().getFullYear()
    const dated = top.filter((t) => t.year !== null)
    const fresh = dated.filter((t) => (t.year ?? 0) >= year - 1).length
    return { artists: byArtist.size, lead, fresh, dated: dated.length, total: top.length }
  }, [top])

  // Little discoveries in the history for the chosen time (streaks, repeats, sessions…).
  const fun = useMemo(() => funFacts(plays, range === 'week' ? Date.now() - 7 * 86_400_000 : range === 'year' ? startOfYear() : 0), [plays, range])

  return (
    <div className="stats">
      <header className="stats__top">
        <h1 className="page-title">Your stats</h1>
        <div className="seg">
          {RANGES.map((r) => (
            <button key={r.id} className={`seg__btn ${range === r.id ? 'is-on' : ''}`} onClick={() => setRange(r.id)}>
              <span>{r.label}</span>
              {range === r.id && <motion.span layoutId="stats-range" className="seg__pill" />}
            </button>
          ))}
        </div>
      </header>

      {loading ? (
        <Skeleton rows={6} />
      ) : (
        <>
          <section className="replay">
            <button className="replay__artist" disabled={!hero} onClick={() => hero && isRealId(hero.id) && navigate({ name: 'artist', id: hero.id })}>
              {heroImage ? <FocusImg src={heroImage} /> : <span className="replay__blank" />}
              <span className="replay__shade" />
              <span className="replay__who">
                <small>
                  Your top artist, {label.long}
                  {borrowed ? ' (from Spotify)' : ''}
                </small>
                <b>{hero?.name ?? 'Play some music'}</b>
              </span>
              {hero?.uri && (
                <span
                  className="replay__play"
                  role="button"
                  aria-label={`Play ${hero.name}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    void playContext(hero.uri)
                  }}
                >
                  <PlayIcon size={22} />
                </span>
              )}
            </button>
            <div className="replay__numbers">
              <dl>
                <div>
                  <dt>Your number one song</dt>
                  <dd className="replay__song">{top[0]?.name ?? '–'}</dd>
                </div>
                {facts && (
                  <>
                    <div>
                      <dt>Artists in your top {facts.total} songs</dt>
                      <dd>{facts.artists}</dd>
                    </div>
                    <div>
                      <dt>Songs by {facts.lead.name}</dt>
                      <dd>
                        {facts.lead.n} of {facts.total}
                      </dd>
                    </div>
                    {own ? (
                      <div>
                        <dt>Listened {range === 'week' ? 'this week' : `in ${new Date().getFullYear()}`}</dt>
                        <dd>{formatMinutes(own.minutes)}</dd>
                      </div>
                    ) : facts.dated > 0 ? (
                      <div>
                        <dt>Released this year or last</dt>
                        <dd>
                          {facts.fresh} of {facts.dated}
                        </dd>
                      </div>
                    ) : null}
                  </>
                )}
              </dl>
              <button className="recap-cta" onClick={() => setRecapOpen(true)}>
                <span className="recap-cta__blobs" aria-hidden="true" />
                <SparkleIcon size={22} />
                <span>
                  <b>Play your Recap</b>
                  <small>Your listening in stories</small>
                </span>
              </button>
            </div>
          </section>

          <ListeningTime />
          <ReplayMonths />

          <div className="stats__cols">
            {top.length > 0 && (
              <section>
                <header className="stats__colhead">
                  <h2 className="stats__h">Top songs</h2>
                  <button className="shelf__more" onClick={() => void playUris(playable(top))}>
                    Play all
                  </button>
                </header>
                <ol className="stats__list">
                  {top.slice(0, 20).map((t, i) => (
                    <li key={`${t.id}-${i}`} className="is-link" onDoubleClick={() => t.uri && void playUris(playable(top), t.uri)}>
                      <span className="stats__n">{i + 1}</span>
                      <span className="stats__art">
                        <TrackArt t={t} />
                        {t.uri && (
                          <button className="stats__play" aria-label={`Play ${t.name}`} onClick={() => void playUris(playable(top), t.uri)}>
                            <PlayIcon size={16} />
                          </button>
                        )}
                      </span>
                      <span className="stats__t">
                        <b>
                          <Emo>{t.name}</Emo>
                        </b>
                        <small>
                          {t.artists.map((a) => a.name).join(', ')}
                          {t.minutes !== undefined ? ` · ${formatMinutes(t.minutes)}` : ''}
                        </small>
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            )}
            {artistList.length > 1 && (
              <section>
                <header className="stats__colhead">
                  <h2 className="stats__h">Top artists</h2>
                </header>
                <ol className="stats__grid">
                  {artistList.slice(1, 13).map((a, i) => (
                    <ArtistTile key={`${a.id}-${i}`} artist={a} rank={i + 2} />
                  ))}
                </ol>
              </section>
            )}
          </div>

          {fun.length > 0 && (
            <section className="facts">
              <h2 className="stats__h">Fun facts</h2>
              <ul className="facts__grid">
                {fun.map((f, i) => (
                  <motion.li
                    key={f.id}
                    className={`facts__card facts__card--${f.id}`}
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04, type: 'spring', stiffness: 260, damping: 26 }}
                  >
                    {f.art && <img className="facts__art" src={f.art} alt="" decoding="async" />}
                    <small>{f.label}</small>
                    <b>{f.value}</b>
                    {f.detail && (
                      <span>
                        <Emo>{f.detail}</Emo>
                      </span>
                    )}
                  </motion.li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}
