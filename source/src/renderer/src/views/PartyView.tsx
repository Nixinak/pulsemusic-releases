// Party mode: friends open a link (anywhere, not just on this Wi-Fi) and add songs to the queue.
import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { useApp, errorText } from '@/lib/store'
import { startParty, stopParty, useParty } from '@/lib/party'
import { playFromQueue, removeFromQueue, usePlayer } from '@/lib/player'
import { useQuery } from '@/lib/useQuery'
import QRCode from 'qrcode'
import { CoverCarousel } from '@/components/CoverWalls'
import * as sp from '@/lib/spotify'
import { joinParty, leaveParty, partyControl, remoteAdd, remoteSearch, setListenDevice, setSync, useListenAlong } from '@/lib/listenAlong'
import type { PartyTrack } from '@shared/types'
import { Cover, usePagePalette } from '@/components/common'
import { Glass } from '@/components/Glass'
import { CloseIcon, ComputerIcon, CopyIcon, NextIcon, PartyIcon, PauseIcon, PhoneIcon, PlayIcon, PrevIcon, SpeakerIcon } from '@/components/Icons'

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }): React.JSX.Element {
  return (
    <button role="switch" aria-checked={on} aria-label={label} className={`toggle ${on ? 'is-on' : ''}`} onClick={() => onChange(!on)}>
      <motion.span className="toggle__knob" layout transition={{ type: 'spring', stiffness: 600, damping: 32 }} />
    </button>
  )
}

const deviceIcon = (type: string): React.JSX.Element =>
  /smartphone|tablet/i.test(type) ? <PhoneIcon size={16} /> : /computer/i.test(type) ? <ComputerIcon size={16} /> : <SpeakerIcon size={16} />

/** You joined a friend's party: what plays there, play it here too, add songs. */
function GuestParty(): React.JSX.Element {
  const st = useListenAlong((s) => s.state)
  const at = useListenAlong((s) => s.at)
  const [, setNow] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [])
  const error = useListenAlong((s) => s.error)
  const sync = useListenAlong((s) => s.sync)
  const status = useListenAlong((s) => s.status)
  const deviceId = useListenAlong((s) => s.deviceId)
  const localId = usePlayer((s) => s.localDeviceId)
  const activeId = usePlayer((s) => s.activeDevice?.id ?? null)
  const [devices, setDevices] = useState<{ id: string; name: string; type: string }[]>([])
  const [q, setQ] = useState('')
  const [results, setResults] = useState<PartyTrack[]>([])

  const loadDevices = (): void => {
    sp.getDevices()
      .then((r) => setDevices(r.devices.filter((d) => d.id).map((d) => ({ id: d.id!, name: d.name, type: d.type }))))
      .catch(() => {})
  }
  useEffect(loadDevices, [])
  useEffect(() => {
    if (q.trim().length < 2) return setResults([])
    const t = window.setTimeout(() => {
      remoteSearch(q.trim())
        .then(setResults)
        .catch(() => setResults([]))
    }, 450)
    return () => clearTimeout(t)
  }, [q])

  const list = [...(localId && !devices.some((d) => d.id === localId) ? [{ id: localId, name: 'This computer (Pulse)', type: 'Computer' }] : []), ...devices]
  const np = st?.nowPlaying
  const dur = np?.durationMs ?? 0
  const pos = np ? Math.min(dur, (np.positionMs ?? 0) + (np.paused ? 0 : Date.now() - at)) : 0
  return (
    <div className="guest">
      <Glass radius={30} tone="clear" simple className="guest__now">
        <Cover src={np?.image ?? null} size={150} radius={18} />
        <div className="guest__info">
          <b className="guest__title">{np?.name ?? (error ? 'Party not reachable' : 'Nothing playing yet')}</b>
          <span className="muted">{np?.artists ?? error ?? ' '}</span>
          {np && (
            <>
              <div
                className="guest__bar"
                role="slider"
                aria-label="Seek"
                aria-valuemin={0}
                aria-valuemax={dur}
                aria-valuenow={pos}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect()
                  void partyControl({ action: 'seek', positionMs: Math.round(((e.clientX - r.left) / r.width) * dur) })
                }}
              >
                <span style={{ width: `${dur ? (pos / dur) * 100 : 0}%` }} />
              </div>
              <div className="transport">
                <button className="icon-btn icon-btn--strong" aria-label="Previous" onClick={() => void partyControl({ action: 'previous' })}>
                  <PrevIcon size={20} />
                </button>
                <button className="transport__play" aria-label={np.paused ? 'Play' : 'Pause'} onClick={() => void partyControl({ action: 'toggle' })}>
                  {np.paused ? <PlayIcon size={20} /> : <PauseIcon size={20} />}
                </button>
                <button className="icon-btn icon-btn--strong" aria-label="Next" onClick={() => void partyControl({ action: 'next' })}>
                  <NextIcon size={20} />
                </button>
              </div>
            </>
          )}
          <span className={`party__status party__status--${sync ? (status === 'Playing along' ? 'online' : 'starting') : 'offline'}`}>{status || 'Connecting…'}</span>
        </div>
        <button className="btn guest__leave" onClick={leaveParty}>
          Leave
        </button>
      </Glass>

      <div className="guest__grid">
        <Glass radius={26} tone="clear" simple className="party__panel guest__play">
          <div className="guest__row">
            <b>Play it here too</b>
            <Switch on={sync} onChange={setSync} label="Play it here too" />
          </div>
          <div className="guest__devices">
            {list.map((d) => (
              <button key={d.id} className={`guest__device ${d.id === (deviceId ?? localId ?? activeId) ? 'is-on' : ''}`} onClick={() => setListenDevice(d.id)}>
                {deviceIcon(d.type)}
                <span>{d.name}</span>
              </button>
            ))}
            <button className="link" onClick={loadDevices}>
              Refresh
            </button>
          </div>
        </Glass>

        <section className="party__queue guest__add">
          <h2>Add a song</h2>
          <input className="field guest__search" placeholder="Search for a song" value={q} onChange={(e) => setQ(e.target.value)} />
          {results.map((t) => (
            <div key={t.uri} className="qrow">
              <Cover src={t.image} size={44} radius={8} />
              <span className="qrow__text">
                <span className="qrow__title">{t.name}</span>
                <span className="qrow__artist">{t.artists}</span>
              </span>
              <button className="btn btn--sm btn--accent" onClick={() => void remoteAdd(t)}>
                Add
              </button>
            </div>
          ))}
          <h2>Up next</h2>
          {!st?.queue.length ? (
            <p className="muted">Nothing queued yet.</p>
          ) : (
            st.queue.map((t, i) => (
              <div key={t.uri + i} className="qrow">
                <Cover src={t.image} size={44} radius={8} />
                <span className="qrow__text">
                  <span className="qrow__title">{t.name}</span>
                  <span className="qrow__artist">{t.artists}</span>
                </span>
                {t.addedBy && <span className="party__by">{t.addedBy}</span>}
                <button className="qrow__x" aria-label={`Remove ${t.name} from the queue`} onClick={() => void partyControl({ action: 'remove', uri: t.uri })}>
                  <CloseIcon size={14} />
                </button>
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  )
}

/** The party link as a QR code, so phones in the room can scan it. */
function LinkQr({ url }: { url: string }): React.JSX.Element {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    QRCode.toDataURL(url, { margin: 1, width: 360, color: { dark: '#0d0e13', light: '#ffffff' } })
      .then((d) => alive && setSrc(d))
      .catch(() => alive && setSrc(null))
    return () => {
      alive = false
    }
  }, [url])
  return <div className="pqr">{src ? <img decoding="async" src={src} alt="QR code of the party link" /> : <span className="cmd__spin" />}</div>
}

export function PartyView(): React.JSX.Element {
  const joined = useListenAlong((s) => s.url)
  const guestNow = useListenAlong((s) => s.state?.nowPlaying?.image ?? null)
  const guestQueue = useListenAlong((s) => s.state?.queue)
  const [link, setLink] = useState('')
  const url = useParty((s) => s.url)
  const info = useParty((s) => s.info)
  const added = useParty((s) => s.added)
  const upNext = usePlayer((s) => s.upNext)
  const track = usePlayer((s) => s.track)
  const hasDevice = usePlayer((s) => !!s.activeDevice || !!s.localDeviceId)
  const recent = useQuery('home:recent', sp.getRecentlyPlayed)
  const toast = useApp((s) => s.toast)
  const [busy, setBusy] = useState(false)
  usePagePalette(track?.artUrl ?? null)

  const start = async (): Promise<void> => {
    setBusy(true)
    try {
      await startParty()
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  // the corridor shows what plays at this party, else what you played lately
  const art = joined
    ? [guestNow, ...(guestQueue ?? []).map((q) => q.image)]
    : [track?.artUrl ?? null, ...upNext.map((q) => q.image), ...(recent.data?.items ?? []).map((r) => sp.pickImage(r.track.album?.images, 300))]
  const validLink = /\/p\/[0-9a-f]{8}/.test(link)
  const status = info?.status === 'online' ? 'Online' : info?.status === 'offline' ? 'Same Wi-Fi only' : info?.message || 'Putting your party online…'

  return (
    <div className="party">
      <header className={`party__hero bleed ${!joined && !url ? 'party__hero--start' : ''}`}>
        <CoverCarousel images={art} />
        <div className="party__hero-text">
          <h1>{joined ? 'You’re at a party' : url ? 'The party is on' : 'Party'}</h1>
          <p>
            {joined
              ? 'Add songs and control the music together.'
              : url
                ? 'Anyone with the link can add songs, skip and pause, from any phone.'
                : 'Friends open a link on their phone and add songs to your queue. No app, no sign-in.'}
          </p>
          {!joined && !url && (
            <div className="party__cta">
              <button className="btn btn--accent party__go" disabled={busy || !hasDevice} title={hasDevice ? undefined : 'Play any song first'} onClick={() => void start()}>
                <PartyIcon size={20} />
                {busy ? 'Starting…' : 'Start the party'}
              </button>
              <form
                className="party__joinrow"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (validLink) joinParty(link.trim().replace(/\/$/, ''))
                }}
              >
                <input className="field" placeholder="Or paste a party link" value={link} onChange={(e) => setLink(e.target.value)} spellCheck={false} />
                <button className="btn" disabled={!validLink}>
                  Join
                </button>
              </form>
            </div>
          )}
        </div>
      </header>

      {joined ? (
        <GuestParty />
      ) : !url ? null : (
        <div className="party__live">
          <Glass radius={28} tone="clear" simple className="party__invite">
            <LinkQr url={url} />
            <div className="party__invite-text">
              <span className={`party__status party__status--${info?.status ?? 'starting'}`}>{status}</span>
              <b className="party__url" title={url}>
                {url.replace(/^https?:\/\//, '')}
              </b>
              <div className="party__invite-actions">
                <button
                  className="btn btn--accent"
                  disabled={info?.status === 'starting'}
                  onClick={() => {
                    void navigator.clipboard.writeText(url)
                    toast('Link copied')
                  }}
                >
                  <CopyIcon size={16} /> Copy link
                </button>
                <button className="btn" onClick={() => void stopParty()}>
                  End the party
                </button>
              </div>
              {info?.status === 'offline' && <p className="muted">{info.message}</p>}
            </div>
          </Glass>

          <section className="party__queue">
            {track && (
              <div className="party__now">
                <Cover src={track.artUrl} size={64} radius={12} />
                <span>
                  <small>Playing</small>
                  <b>{track.name}</b>
                  <span className="muted">{track.artists.map((a) => a.name).join(', ')}</span>
                </span>
              </div>
            )}
            <h2>
              Up next <span className="shelf__count">{upNext.length || ''}</span>
            </h2>
            {upNext.length === 0 ? (
              <p className="muted">Songs your guests add show up here.</p>
            ) : (
              upNext.map((q) => (
                <div key={q.uid} className="qrow" onDoubleClick={() => void playFromQueue(q.uid)}>
                  <Cover src={q.image} size={44} radius={8} />
                  <span className="qrow__text">
                    <span className="qrow__title">{q.name}</span>
                    <span className="qrow__artist">{q.artists}</span>
                  </span>
                  {q.addedBy && <span className="party__by">{q.addedBy}</span>}
                  <button className="qrow__x" aria-label={`Remove ${q.name} from the queue`} onClick={() => removeFromQueue(q.uid)}>
                    <CloseIcon size={14} />
                  </button>
                </div>
              ))
            )}
            {added.length > 0 && (
              <>
                <h2>Added by guests</h2>
                {added.map((a) => (
                  <p key={a.at} className="party__log">
                    <b>{a.guest}</b> added {a.name} <span className="muted">· {a.artists}</span>
                  </p>
                ))}
              </>
            )}
            {upNext.length === 0 && <p className="muted party__empty">Nothing queued yet. Songs your guests add show up here.</p>}
          </section>
        </div>
      )}
    </div>
  )
}
