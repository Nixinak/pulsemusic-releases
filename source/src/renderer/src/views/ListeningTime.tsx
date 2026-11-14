// How long you've listened this year, everywhere: what Pulse played plus what Spotify played on
// your phone, the web player and other apps. Spotify only shares its last 50 plays, so for the
// time before Pulse you can import the data download Spotify sends (it has every play).
import { useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { useApp } from '@/lib/store'
import { computeStats, importSpotifyExport, useHistory } from '@/lib/history'
import { formatMinutes } from '@/lib/recap'

const PRIVACY_URL = 'https://www.spotify.com/account/privacy/'

const day = (t: number): string => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

export function ListeningTime(): React.JSX.Element | null {
  const plays = useHistory((s) => s.plays)
  const loaded = useHistory((s) => s.loaded)
  const imported = useHistory((s) => s.imported)
  const toast = useApp((s) => s.toast)
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const now = new Date()
  const year = now.getFullYear()
  const yearStart = new Date(year, 0, 1).getTime()

  const s = useMemo(() => {
    const y = computeStats(plays, yearStart)
    const m = computeStats(plays, new Date(year, now.getMonth(), 1).getTime())
    const elapsed = Math.max(1, Math.ceil((Date.now() - yearStart) / 86_400_000))
    const first = plays.find((p) => p.at >= yearStart)?.at ?? null
    return { y, m, elapsed, first }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plays, yearStart])

  if (!loaded) return null
  const total = s.y.ms
  const pulse = s.y.bySource.pulse
  const spotify = s.y.bySource.spotify + s.y.bySource.export
  const min = (ms: number): number => Math.round(ms / 60_000)
  const share = (ms: number): number => (total ? (ms / total) * 100 : 0)
  // Without the download, anything before Pulse's first play this year is missing.
  const covered = imported && imported.from <= yearStart + 14 * 86_400_000
  const gap = !covered && s.first !== null && s.first > yearStart + 7 * 86_400_000

  const pick = async (files: FileList | null): Promise<void> => {
    if (!files?.length) return
    setBusy(true)
    try {
      const r = await importSpotifyExport([...files])
      if (!r.found) toast('No listening history in those files. Pick the zip Spotify sent, or its StreamingHistory files.', 'error')
      else toast(`Added ${r.added.toLocaleString()} plays from ${day(r.from!)} to ${day(r.to!)}.`)
    } catch (e) {
      toast(`Could not read that file: ${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <section className="ltime">
      <div className="ltime__main">
        <small className="ltime__eyebrow">Listening time in {year}</small>
        <motion.b className="ltime__big" key={min(total)} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          {formatMinutes(min(total))}
        </motion.b>
        <span className="ltime__exact">
          {min(total).toLocaleString()} minutes on Spotify and Pulse
        </span>
        <div className="ltime__bar" role="img" aria-label={`Pulse ${formatMinutes(min(pulse))}, other Spotify apps ${formatMinutes(min(spotify))}`}>
          <motion.i className="ltime__seg is-pulse" initial={{ width: 0 }} animate={{ width: `${share(pulse)}%` }} transition={{ type: 'spring', stiffness: 90, damping: 20 }} />
          <motion.i className="ltime__seg is-spotify" initial={{ width: 0 }} animate={{ width: `${share(spotify)}%` }} transition={{ type: 'spring', stiffness: 90, damping: 20, delay: 0.1 }} />
        </div>
        <ul className="ltime__legend">
          <li>
            <i className="is-pulse" /> In Pulse <b>{formatMinutes(min(pulse))}</b>
          </li>
          <li>
            <i className="is-spotify" /> In Spotify apps <b>{formatMinutes(min(spotify))}</b>
          </li>
        </ul>
      </div>
      <dl className="ltime__facts">
        <div>
          <dt>This month</dt>
          <dd>{formatMinutes(min(s.m.ms))}</dd>
        </div>
        <div>
          <dt>A day on average</dt>
          <dd>{formatMinutes(Math.round(min(total) / s.elapsed))}</dd>
        </div>
        <div>
          <dt>Days with music</dt>
          <dd>{s.y.days}</dd>
        </div>
        <div>
          <dt>Songs played</dt>
          <dd>{s.y.plays.toLocaleString()}</dd>
        </div>
      </dl>
      <div className={`ltime__import ${gap ? 'is-gap' : ''}`}>
        <p>
          {imported ? (
            <>
              <b>Spotify history imported</b>
              <span>
                Covers {day(imported.from)} – {day(imported.to)}. Plays since then come in on their own.
              </span>
            </>
          ) : gap ? (
            <>
              <b>Missing the start of the year?</b>
              <span>
                Pulse counts from {day(s.first!)}. Import your Spotify data to add every play since 1 January.
              </span>
            </>
          ) : (
            <>
              <b>Every play counts</b>
              <span>Songs from your phone and other Spotify apps are added every few minutes while Pulse runs (it starts with Windows and waits in the tray). Import your Spotify data for anything older.</span>
            </>
          )}
        </p>
        <div className="ltime__btns">
          <button className="btn btn--accent" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? 'Importing…' : imported ? 'Import again' : 'Import Spotify data'}
          </button>
          <button className="btn" onClick={() => window.pulse.openExternal(PRIVACY_URL)} title="Spotify → Account → Privacy → Download your data">
            Request it from Spotify
          </button>
        </div>
        <input ref={input} type="file" accept=".zip,.json" multiple hidden onChange={(e) => void pick(e.target.files)} />
      </div>
    </section>
  )
}
