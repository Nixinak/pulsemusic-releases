// Replay by month (like Apple Music Replay): a sideways row with a card for every month of this
// year, January to now, with minutes, your top artist and song; each opens that month's Recap.
// A new month joins on the 1st. Like Spotify Wrapped, the year gets its own card only at the
// end of the year: it appears on 1 December at the end of the row (where the row opens) and stays through
// January (then as last year's card).
import { useMemo } from 'react'
import { motion } from 'motion/react'
import { useApp } from '@/lib/store'
import { computeStats, isRealId, useHistory, type Stats } from '@/lib/history'
import { formatMinutes, monthPeriod, yearPeriod } from '@/lib/recap'
import { useArtistImage } from '@/lib/artistImage'
import { playUris } from '@/lib/player'
import { Cover, ShelfRow } from '@/components/common'
import { PlayIcon, SparkleIcon } from '@/components/Icons'

interface Month {
  start: Date
  stats: Stats
}

const HUES = [12, 330, 280, 220, 190, 150, 95, 45, 25, 350, 260, 200]
/** The year card comes out on 1 December, like Spotify Wrapped. */
const YEAR_OPENS = 11
/** This year's card is out (December). */
export const yearIsOut = (d = new Date()): boolean => d.getMonth() >= YEAR_OPENS
/** The year being celebrated right now: this year in December, last year in January. */
export const replayYear = (d = new Date()): number | null => (d.getMonth() >= YEAR_OPENS ? d.getFullYear() : d.getMonth() === 0 ? d.getFullYear() - 1 : null)

const topUris = (stats: Stats, n = 25): string[] =>
  stats.songs
    .filter((s) => isRealId(s.item.id))
    .slice(0, n)
    .map((s) => `spotify:track:${s.item.id}`)

function MonthTile({ m, max, now }: { m: Month; max: number; now: boolean }): React.JSX.Element {
  const setRecapOpen = useApp((s) => s.setRecapOpen)
  const lead = m.stats.artists[0]?.item
  const image = useArtistImage(isRealId(lead?.id) ? lead?.id : undefined, null)
  const song = m.stats.songs[0]?.item
  const minutes = Math.round(m.stats.ms / 60_000)
  const hue = HUES[m.start.getMonth()]
  const songs = topUris(m.stats)
  const empty = m.stats.plays === 0
  const open = (): void => {
    if (!empty) setRecapOpen(true, monthPeriod(m.start))
  }
  return (
    <motion.article
      className={`rmonth ${empty ? 'is-empty' : ''}`}
      style={{ ['--h' as string]: hue }}
      whileHover={empty ? undefined : { y: -4 }}
      transition={{ type: 'spring', stiffness: 300, damping: 24 }}
      role={empty ? undefined : 'button'}
      tabIndex={empty ? -1 : 0}
      onClick={open}
      onKeyDown={(e) => e.key === 'Enter' && open()}
    >
      {image && <img decoding="async" className="rmonth__bg" src={image} alt="" draggable={false} />}
      <span className="rmonth__shade" />
      <header className="rmonth__head">
        <small>Replay{now ? ' · so far' : ''}</small>
        <b>{m.start.toLocaleDateString('en-GB', { month: 'short' })}</b>
        <span>{m.start.getFullYear()}</span>
      </header>
      <div className="rmonth__body">
        <div className="rmonth__minutes">
          <b>{empty ? 'No plays' : formatMinutes(minutes)}</b>
          <i style={{ width: `${empty ? 0 : Math.max(6, (m.stats.ms / max) * 100)}%` }} />
        </div>
        {empty && <p className="rmonth__hint">Import your Spotify data to fill it in</p>}
        {lead && (
          <p>
            <small>Top artist</small>
            {lead.name}
          </p>
        )}
        {song && (
          <p className="rmonth__song">
            <Cover src={song.art} size={34} radius={6} />
            <span>
              <small>Top song</small>
              {song.name}
            </span>
          </p>
        )}
      </div>
      {songs.length > 0 && (
        <button
          className="rmonth__play"
          aria-label={`Play your top songs of ${m.start.toLocaleDateString('en-GB', { month: 'long' })}`}
          onClick={(e) => {
            e.stopPropagation()
            void playUris(songs)
          }}
        >
          <PlayIcon size={18} />
        </button>
      )}
    </motion.article>
  )
}

/** The whole year: a teaser until December, then your year with its own Recap. */
function YearCard({ year, stats, open }: { year: number; stats: Stats; open: boolean }): React.JSX.Element {
  const setRecapOpen = useApp((s) => s.setRecapOpen)
  const lead = stats.artists[0]?.item
  const image = useArtistImage(isRealId(lead?.id) ? lead?.id : undefined, null)
  const covers = stats.albums
    .map((a) => a.item.art)
    .filter(Boolean)
    .slice(0, 5) as string[]
  const minutes = Math.round(stats.ms / 60_000)
  const songs = topUris(stats, 50)
  const now = new Date()
  const opens = new Date(year, YEAR_OPENS, 1)
  const days = Math.max(1, Math.ceil((opens.getTime() - now.getTime()) / 86_400_000))
  const go = (): void => {
    if (open) setRecapOpen(true, yearPeriod(year))
  }
  return (
    <motion.article
      className={`ryear ${open ? 'is-open' : 'is-locked'}`}
      whileHover={open ? { y: -4 } : undefined}
      transition={{ type: 'spring', stiffness: 300, damping: 24 }}
      role={open ? 'button' : undefined}
      tabIndex={open ? 0 : -1}
      onClick={go}
      onKeyDown={(e) => e.key === 'Enter' && go()}
    >
      <span className="ryear__glow" aria-hidden="true" />
      {image && <img decoding="async" className="ryear__bg" src={image} alt="" draggable={false} />}
      <span className="ryear__shade" />
      {open && <span className="ryear__ribbon">New</span>}
      <header className="ryear__head">
        <small>{open ? 'Your year in music' : 'Your year · coming soon'}</small>
        <b>{year}</b>
      </header>
      {open ? (
        <div className="ryear__body">
          <div className="ryear__minutes">
            <b>{formatMinutes(minutes)}</b>
            <span>
              {minutes.toLocaleString()} minutes · {stats.days} days with music
            </span>
          </div>
          <dl className="ryear__facts">
            {lead && (
              <div>
                <dt>Top artist</dt>
                <dd>{lead.name}</dd>
              </div>
            )}
            {stats.songs[0] && (
              <div>
                <dt>Top song</dt>
                <dd>{stats.songs[0].item.name}</dd>
              </div>
            )}
            <div>
              <dt>Artists</dt>
              <dd>{stats.artists.length.toLocaleString()}</dd>
            </div>
          </dl>
          {covers.length > 0 && (
            <div className="ryear__covers" aria-hidden="true">
              {covers.map((c, i) => (
                <span key={i} style={{ ['--i' as string]: i }}>
                  <Cover src={c} size={52} radius={10} />
                </span>
              ))}
            </div>
          )}
          <div className="ryear__actions">
            <span className="ryear__cta">
              <SparkleIcon size={18} /> Play your {year} Recap
            </span>
            {songs.length > 0 && (
              <button
                className="rmonth__play ryear__play"
                aria-label={`Play your top songs of ${year}`}
                onClick={(e) => {
                  e.stopPropagation()
                  void playUris(songs)
                }}
              >
                <PlayIcon size={20} />
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="ryear__body">
          <span className="ryear__lock" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="11" width="14" height="10" rx="2.5" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
          </span>
          <div className="ryear__minutes">
            <b>{formatMinutes(minutes)}</b>
            <span>so far this year</span>
          </div>
          <p className="ryear__soon">
            Opens on 1 December · {days === 1 ? 'tomorrow' : `in ${days} days`}
          </p>
        </div>
      )}
    </motion.article>
  )
}

export function ReplayMonths(): React.JSX.Element | null {
  const plays = useHistory((s) => s.plays)
  const loaded = useHistory((s) => s.loaded)
  const now = new Date()
  const year = now.getFullYear()
  const data = useMemo(() => {
    const months: Month[] = []
    for (let m = 0; m <= now.getMonth(); m++) {
      const start = new Date(year, m, 1)
      months.push({ start, stats: computeStats(plays, start.getTime(), new Date(year, m + 1, 1).getTime()) })
    }
    const thisYear = computeStats(plays, new Date(year, 0, 1).getTime(), new Date(year + 1, 0, 1).getTime())
    // In January last year's card is still worth a look.
    const lastYear = now.getMonth() === 0 ? computeStats(plays, new Date(year - 1, 0, 1).getTime(), new Date(year, 0, 1).getTime()) : null
    return { months, thisYear, lastYear }
    // `now` changes every render; the month only matters when the history does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plays, year, now.getMonth()])
  if (!loaded) return null
  const max = Math.max(...data.months.map((m) => m.stats.ms), 1)
  return (
    <section className="rmonths">
      <header className="stats__colhead">
        <h2 className="stats__h">Replay by month</h2>
        <span className="muted">
          {formatMinutes(Math.round(data.thisYear.ms / 60_000))} in {year}
        </span>
      </header>
      {/* oldest to newest, opened at this month; drag or scroll sideways for the rest */}
      <ShelfRow className="rmonths__row" loop={false} startAtEnd>
        {data.lastYear && data.lastYear.plays > 0 && <YearCard year={year - 1} stats={data.lastYear} open />}
        {data.months.map((m) => (
          <MonthTile key={m.start.getTime()} m={m} max={max} now={m.start.getMonth() === now.getMonth()} />
        ))}
        {yearIsOut() && <YearCard year={year} stats={data.thisYear} open />}
      </ShelfRow>
    </section>
  )
}
