// What someone you follow is playing right now, with Listen along (and Join party when they host one).
import { useEffect, useState } from 'react'
import { listenWith, nowPosition, stopListeningWith, useListenWith, useNowOf } from '@/lib/friends'
import { joinParty } from '@/lib/listenAlong'
import { Cover } from './common'
import { HeadphonesIcon } from './Icons'

const clock = (ms: number): string => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`

export function NowCard({ id, name, compact = false }: { id: string; name: string; compact?: boolean }): React.JSX.Element | null {
  const n = useNowOf(id)
  const listening = useListenWith((s) => s.with?.id === id)
  // tick the position once a second
  const [, tick] = useState(0)
  useEffect(() => {
    if (!n?.track || n.paused) return
    const t = window.setInterval(() => tick((x) => x + 1), 1000)
    return () => window.clearInterval(t)
  }, [n])
  if (!n?.track) return null
  const pos = nowPosition(n)
  return (
    <div className={`nowcard ${compact ? 'nowcard--compact' : ''}`}>
      <Cover src={n.track.image} size={compact ? 40 : 56} radius={compact ? 8 : 10} />
      <div className="nowcard__text">
        <span className="nowcard__label">
          {n.paused ? 'Paused' : <><i className="nowcard__live" aria-hidden="true" />Listening now</>}
          {!compact && n.track.durationMs > 0 && <span className="nowcard__time">{clock(pos)} / {clock(n.track.durationMs)}</span>}
        </span>
        <b>{n.track.name}</b>
        <small>{n.track.artists}</small>
      </div>
      <div className="nowcard__actions">
        <button className={`btn ${listening ? 'is-on' : ''}`} onClick={() => (listening ? stopListeningWith() : listenWith(id, name))} title={listening ? 'Stop listening along' : `Play what ${name} plays`}>
          <HeadphonesIcon size={17} />
          {listening ? 'Stop' : compact ? 'Listen' : 'Listen along'}
        </button>
        {n.party && !compact && (
          <button className="btn" onClick={() => joinParty(n.party!)}>
            Join party
          </button>
        )}
      </div>
    </div>
  )
}

/** The bar shown while you listen along with someone. */
export function ListenWithBar(): React.JSX.Element | null {
  const w = useListenWith((s) => s.with)
  const now = useListenWith((s) => s.now)
  if (!w) return null
  return (
    <div className="lwbar" role="status">
      <i className="nowcard__live" aria-hidden="true" />
      <span>
        Listening with <b>{w.name}</b>
        {now?.track ? ` · ${now.track.name}` : now ? ' · nothing playing right now' : ''}
      </span>
      <button className="btn" onClick={() => stopListeningWith()}>
        Stop
      </button>
    </div>
  )
}
