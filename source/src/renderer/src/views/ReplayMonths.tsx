// Replay by month (like Apple Music Replay): a card for every month Pulse has seen you
// listen, newest first, with minutes, your top artist and song. Opens that month's Recap.
import { useMemo } from 'react'
import { motion } from 'motion/react'
import { useApp } from '@/lib/store'
import { computeStats, useHistory, type Stats } from '@/lib/history'
import { formatMinutes, monthPeriod } from '@/lib/recap'
import { useArtistImage } from '@/lib/artistImage'
import { playUris } from '@/lib/player'
import { Cover, ShelfRow } from '@/components/common'
import { PlayIcon } from '@/components/Icons'

interface Month {
  start: Date
  stats: Stats
}

const HUES = [12, 330, 280, 220, 190, 150, 95, 45, 25, 350, 260, 200]

function MonthTile({ m, max, now }: { m: Month; max: number; now: boolean }): React.JSX.Element {
  const setRecapOpen = useApp((s) => s.setRecapOpen)
  const lead = m.stats.artists[0]?.item
  const image = useArtistImage(lead?.id, null)
  const song = m.stats.songs[0]?.item
  const minutes = Math.round(m.stats.ms / 60_000)
  const hue = HUES[m.start.getMonth()]
  const songs = m.stats.songs.slice(0, 25).map((s) => `spotify:track:${s.item.id}`)
  return (
    <motion.article
      className="rmonth"
      style={{ ['--h' as string]: hue }}
      whileHover={{ y: -4 }}
      transition={{ type: 'spring', stiffness: 300, damping: 24 }}
      role="button"
      tabIndex={0}
      onClick={() => setRecapOpen(true, monthPeriod(m.start))}
      onKeyDown={(e) => e.key === 'Enter' && setRecapOpen(true, monthPeriod(m.start))}
    >
      {image && <img className="rmonth__bg" src={image} alt="" draggable={false} />}
      <span className="rmonth__shade" />
      <header className="rmonth__head">
        <small>Replay{now ? ' · so far' : ''}</small>
        <b>{m.start.toLocaleDateString('en-GB', { month: 'short' })}</b>
        <span>{m.start.getFullYear()}</span>
      </header>
      <div className="rmonth__body">
        <div className="rmonth__minutes">
          <b>{formatMinutes(minutes)}</b>
          <i style={{ width: `${Math.max(6, (m.stats.ms / max) * 100)}%` }} />
        </div>
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

export function ReplayMonths(): React.JSX.Element | null {
  const plays = useHistory((s) => s.plays)
  const months = useMemo<Month[]>(() => {
    if (!plays.length) return []
    const first = new Date(plays[0].at)
    const out: Month[] = []
    const cur = new Date()
    let d = new Date(cur.getFullYear(), cur.getMonth(), 1)
    const stop = new Date(first.getFullYear(), first.getMonth(), 1).getTime()
    while (d.getTime() >= stop && out.length < 24) {
      const next = new Date(d.getFullYear(), d.getMonth() + 1, 1)
      const stats = computeStats(plays, d.getTime(), next.getTime())
      if (stats.plays > 0) out.push({ start: d, stats })
      d = new Date(d.getFullYear(), d.getMonth() - 1, 1)
    }
    return out
  }, [plays])
  if (!months.length) return null
  const max = Math.max(...months.map((m) => m.stats.ms), 1)
  const year = new Date().getFullYear()
  const yearMs = months.filter((m) => m.start.getFullYear() === year).reduce((n, m) => n + m.stats.ms, 0)
  const now = new Date()
  return (
    <section className="rmonths">
      <header className="stats__colhead">
        <h2 className="stats__h">Replay by month</h2>
        <span className="muted">{formatMinutes(Math.round(yearMs / 60_000))} in {year}</span>
      </header>
      <ShelfRow className="rmonths__row">
        {months.map((m) => (
          <MonthTile key={m.start.getTime()} m={m} max={max} now={m.start.getMonth() === now.getMonth() && m.start.getFullYear() === now.getFullYear()} />
        ))}
      </ShelfRow>
    </section>
  )
}
