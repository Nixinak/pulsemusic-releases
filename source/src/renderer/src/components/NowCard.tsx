// What someone you follow is playing right now, with Listen along (and Join party when they host one).
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { dismissArrived, listenWith, nowPosition, stopListeningWith, useListeners, useListenWith, useNowOf } from '@/lib/friends'
import { joinParty } from '@/lib/listenAlong'
import { useApp } from '@/lib/store'
import { Cover } from './common'
import { CloseIcon, HeadphonesIcon } from './Icons'

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

/** The big notice when a friend starts listening along with you: their picture inside sound
 *  rings, dropping in from the top for a few seconds. */
export function ListenerNotice(): React.JSX.Element {
  const who = useListeners((s) => s.arrived)
  const navigate = useApp((s) => s.navigate)
  return (
    <AnimatePresence>
      {who && (
        <motion.div
          key={who.id}
          className="lnotice"
          role="status"
          initial={{ opacity: 0, y: -40, scale: 0.85 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -24, scale: 0.92 }}
          transition={{ type: 'spring', stiffness: 260, damping: 22 }}
        >
          <button
            className="lnotice__body"
            onClick={() => {
              dismissArrived()
              navigate({ name: 'user', id: who.id })
            }}
          >
            <span className="lnotice__face">
              <i />
              <i />
              <i />
              <Cover src={who.thumb} round size={56} />
            </span>
            <span className="lnotice__text">
              <b>{who.displayName}</b>
              <span>is listening along with you</span>
              {who.track && (
                <small>
                  <span className="lnotice__eq" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  {who.track}
                </small>
              )}
            </span>
          </button>
          <button className="lnotice__x icon-btn" aria-label="Close" onClick={dismissArrived}>
            <CloseIcon size={15} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Small faces in the player bar while people listen along with you. */
export function ListenersChip(): React.JSX.Element | null {
  const list = useListeners((s) => s.list)
  const navigate = useApp((s) => s.navigate)
  if (!list.length) return null
  const names = list.map((l) => l.displayName)
  return (
    <button
      className="lchip"
      title={`${names.join(', ')} ${list.length === 1 ? 'is' : 'are'} listening along with you`}
      onClick={() => navigate({ name: 'friends' })}
    >
      <span className="lchip__faces">
        {list.slice(0, 3).map((l) => (
          <Cover key={l.id} src={l.thumb} round size={18} />
        ))}
      </span>
      {list.length === 1 ? names[0] : `${list.length} listening`}
    </button>
  )
}
