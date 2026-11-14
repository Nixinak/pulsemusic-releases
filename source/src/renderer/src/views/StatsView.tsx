// Your stats: how long you've listened this year on Spotify and Pulse together, Replay for every
// month, your top artists and songs for the last 4 weeks, 6 months or all time (Spotify's own
// rankings), what those lists say about you, and your last 50 plays.
import { Emo } from '@/components/Emoji'
import { ReplayMonths } from './ReplayMonths'
import { ListeningTime } from './ListeningTime'
import { useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { useApp } from '@/lib/store'
import { formatMinutes, hourLabel } from '@/lib/recap'
import { useQuery } from '@/lib/useQuery'
import * as sp from '@/lib/spotify'
import { playContext, playUris } from '@/lib/player'
import { Cover, Skeleton, usePagePalette } from '@/components/common'
import { useArtistImage } from '@/lib/artistImage'
import { PlayIcon, SparkleIcon } from '@/components/Icons'
import type { SArtist } from '@/lib/types'

const RANGES: { id: sp.TimeRange; label: string; long: string }[] = [
  { id: 'short_term', label: '4 weeks', long: 'the last 4 weeks' },
  { id: 'medium_term', label: '6 months', long: 'the last 6 months' },
  { id: 'long_term', label: 'All time', long: 'all time' }
]

function ArtistTile({ artist, rank }: { artist: SArtist; rank: number }): React.JSX.Element {
  const navigate = useApp((s) => s.navigate)
  const image = useArtistImage(artist.id, sp.pickImage(artist.images, 300))
  return (
    <li onClick={() => navigate({ name: 'artist', id: artist.id })}>
      <Cover src={image} round />
      <b>
        <span>{rank}</span> {artist.name}
      </b>
    </li>
  )
}

export function StatsView(): React.JSX.Element {
  const navigate = useApp((s) => s.navigate)
  const setRecapOpen = useApp((s) => s.setRecapOpen)
  const [range, setRange] = useState<sp.TimeRange>('short_term')
  const artists = useQuery(`stats:artists50:${range}`, () => sp.getTopArtists(range, 50))
  const tracks = useQuery(`stats:tracks50:${range}`, () => sp.getTopTracks(range, 50))
  const recent = useQuery('home:recent', sp.getRecentlyPlayed)
  const hero = artists.data?.items[0]
  const heroImage = useArtistImage(hero?.id, sp.pickImage(hero?.images, 640))
  usePagePalette(heroImage)
  const label = RANGES.find((r) => r.id === range)!

  const top = useMemo(() => (tracks.data?.items ?? []).filter((t) => t?.id), [tracks.data])

  // What the top 50 songs say: how many artists, who has the most songs in it, how new it is.
  const facts = useMemo(() => {
    if (!top.length) return null
    const byArtist = new Map<string, { name: string; n: number }>()
    for (const t of top) for (const a of t.artists) byArtist.set(a.id, { name: a.name, n: (byArtist.get(a.id)?.n ?? 0) + 1 })
    const lead = [...byArtist.values()].sort((a, b) => b.n - a.n)[0]
    const year = new Date().getFullYear()
    const fresh = top.filter((t) => Number((t.album?.release_date ?? '').slice(0, 4)) >= year - 1).length
    return { artists: byArtist.size, lead, fresh, total: top.length }
  }, [top])

  // The last 50 plays, with Spotify's exact times.
  const lately = useMemo(() => {
    const items = (recent.data?.items ?? []).filter((r) => r.track?.id)
    if (!items.length) return null
    const ms = items.reduce((n, r) => n + (r.track.duration_ms ?? 0), 0)
    const times = items.map((r) => Date.parse(r.played_at)).filter(Number.isFinite)
    const days = times.length ? Math.max(1, Math.ceil((Math.max(...times) - Math.min(...times)) / 86400_000)) : 1
    const hours = new Array(24).fill(0) as number[]
    for (const r of items) {
      const t = Date.parse(r.played_at)
      if (Number.isFinite(t)) hours[new Date(t).getHours()] += (r.track.duration_ms ?? 0) / 60_000
    }
    const peak = hours.indexOf(Math.max(...hours))
    return { plays: items.length, minutes: Math.round(ms / 60_000), days, hours, peak }
  }, [recent.data])
  const maxHour = lately ? Math.max(1, ...lately.hours) : 1

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

      {artists.loading && !artists.data ? (
        <Skeleton rows={6} />
      ) : (
        <>
          <section className="replay">
            <button className="replay__artist" disabled={!hero} onClick={() => hero && navigate({ name: 'artist', id: hero.id })}>
              {heroImage ? <img src={heroImage} alt="" /> : <span className="replay__blank" />}
              <span className="replay__shade" />
              <span className="replay__who">
                <small>Your top artist, {label.long}</small>
                <b>{hero?.name ?? 'Play some music'}</b>
              </span>
              {hero && (
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
                    <div>
                      <dt>Released this year or last</dt>
                      <dd>
                        {facts.fresh} of {facts.total}
                      </dd>
                    </div>
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
                  <button className="shelf__more" onClick={() => void playUris(top.map((t) => t.uri))}>
                    Play all
                  </button>
                </header>
                <ol className="stats__list">
                  {top.slice(0, 20).map((t, i) => (
                    <li key={t.id} className="is-link" onDoubleClick={() => void playUris(top.map((x) => x.uri), t.uri)}>
                      <span className="stats__n">{i + 1}</span>
                      <span className="stats__art">
                        <Cover src={sp.pickImage(t.album?.images, 64)} size={46} radius={8} />
                        <button className="stats__play" aria-label={`Play ${t.name}`} onClick={() => void playUris(top.map((x) => x.uri), t.uri)}>
                          <PlayIcon size={16} />
                        </button>
                      </span>
                      <span className="stats__t">
                        <b>
                          <Emo>{t.name}</Emo>
                        </b>
                        <small>{t.artists.map((a) => a.name).join(', ')}</small>
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            )}
            {(artists.data?.items.length ?? 0) > 1 && (
              <section>
                <header className="stats__colhead">
                  <h2 className="stats__h">Top artists</h2>
                </header>
                <ol className="stats__grid">
                  {artists.data!.items.slice(1, 13).map((a, i) => (
                    <ArtistTile key={a.id} artist={a} rank={i + 2} />
                  ))}
                </ol>
              </section>
            )}
          </div>

          {lately && (
            <section className="stats__lately">
              <div className="stats__lately-head">
                <h2 className="stats__h">Your last {lately.plays} plays</h2>
                <p className="muted">
                  {formatMinutes(lately.minutes)} over {lately.days === 1 ? 'one day' : `${lately.days} days`}, most of it around {hourLabel(lately.peak)}.
                </p>
              </div>
              <div className="hours" role="img" aria-label="Minutes listened by hour of day in your last plays">
                {lately.hours.map((m, h) => (
                  <span key={h} className={`hours__bar ${h === lately.peak ? 'is-peak' : ''}`} title={`${hourLabel(h)}: ${Math.round(m)} min`}>
                    <motion.i initial={{ scaleY: 0 }} animate={{ scaleY: Math.max(0.03, m / maxHour) }} transition={{ delay: h * 0.02, type: 'spring', stiffness: 120, damping: 18 }} />
                  </span>
                ))}
              </div>
              <div className="hours__axis">
                <span>{hourLabel(0)}</span>
                <span>{hourLabel(6)}</span>
                <span>{hourLabel(12)}</span>
                <span>{hourLabel(18)}</span>
                <span>{hourLabel(23)}</span>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
