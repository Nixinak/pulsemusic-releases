// What someone you follow is playing right now, with Listen along (and Join party when they host one).
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { dismissArrived, listenWith, nowPosition, stopListeningWith, useFriends, useListeners, useListenWith, useNowOf } from '@/lib/friends'
import { joinParty, leaveParty, useListenAlong } from '@/lib/listenAlong'
import { stopParty, useParty } from '@/lib/party'
import { useApp } from '@/lib/store'
import { Cover } from './common'
import { CloseIcon, HeadphonesIcon, PartyIcon } from './Icons'

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
          {n.paused ? (
            'Paused'
          ) : (
            <>
              <i className="nowcard__live" aria-hidden="true" />
              Listening now
            </>
          )}
          {!compact && n.track.durationMs > 0 && (
            <span className="nowcard__time">
              {clock(pos)} / {clock(n.track.durationMs)}
            </span>
          )}
        </span>
        <b>{n.track.name}</b>
        <small>{n.track.artists}</small>
      </div>
      <div className="nowcard__actions">
        <button
          className={`btn ${listening ? 'is-on' : ''}`}
          onClick={() => (listening ? stopListeningWith() : listenWith(id, name))}
          title={listening ? 'Stop listening along' : `Play what ${name} plays`}
        >
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

/** Top right, next to the window buttons: who you listen with, and who listens with you. A
 *  small pill that stays out of the way; click it for the song, their profiles and Stop. Both
 *  sides see it: you see "Listening with Ondra", Ondra sees "Nix is listening with you". */
export function TogetherCorner(): React.JSX.Element | null {
  const w = useListenWith((s) => s.with)
  const now = useListenWith((s) => s.now)
  const list = useListeners((s) => s.list)
  // their picture, from the people you follow or who follow you (one value, so no new list each time)
  const withThumb = useFriends((s) => (w ? ([...s.friends, ...s.outgoing, ...s.incoming].find((p) => p.id === w.id)?.thumb ?? null) : null))
  const navigate = useApp((s) => s.navigate)
  // a party you host, or one you joined
  const hosting = useParty((s) => s.url)
  const joined = useListenAlong((s) => s.url)
  const joinedNow = useListenAlong((s) => s.state?.nowPlaying ?? null)
  const joinedStatus = useListenAlong((s) => s.status)
  const party = hosting || joined
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: PointerEvent): void => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', off)
    return () => window.removeEventListener('pointerdown', off)
  }, [open])
  useEffect(() => {
    if (!w && !list.length && !party) setOpen(false)
  }, [w, list.length, party])
  const names = list.map((l) => l.displayName)
  const listenersText =
    names.length === 1
      ? `${names[0]} is listening with you`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are listening with you`
        : `${names[0]} and ${names.length - 1} others are listening with you`
  const label = w ? `Listening with ${w.name}` : list.length ? listenersText : hosting ? 'Your party is on' : 'At a party'
  return (
    <AnimatePresence>
      {(w || list.length > 0 || party) && (
        <motion.div
          ref={box}
          className="together"
          initial={{ opacity: 0, y: -8, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.94 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        >
          <button
            className="together__pill"
            aria-expanded={open}
            aria-label={w && list.length ? `${label}. ${listenersText}` : label}
            onClick={() => setOpen((o) => !o)}
          >
            {party && (
              <span className="together__party" aria-hidden="true">
                <PartyIcon size={15} />
              </span>
            )}
            <span className="together__faces">
              {w && <Cover src={withThumb} round size={26} />}
              {list.slice(0, w ? 2 : 3).map((l) => (
                <Cover key={l.id} src={l.thumb} round size={26} />
              ))}
            </span>
            <span className="together__text">
              {w ? (
                <>
                  With <b>{w.name}</b>
                </>
              ) : names.length === 1 ? (
                <>
                  <b>{names[0]}</b> is listening
                </>
              ) : names.length > 1 ? (
                <>
                  <b>{names.length}</b> listening with you
                </>
              ) : hosting ? (
                <>
                  <b>Party</b> on
                </>
              ) : (
                <>
                  At a <b>party</b>
                </>
              )}
            </span>
            {w && list.length > 0 && <span className="together__more">+{list.length}</span>}
            <span className="together__eq" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </button>
          <AnimatePresence>
            {open && (
              <motion.div
                className="together__pop"
                role="dialog"
                aria-label="Listening together"
                initial={{ opacity: 0, y: -6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.97 }}
                transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              >
                {w && (
                  <section>
                    <h3>You’re listening with</h3>
                    <p className="together__note">What either of you plays, skips or pauses changes for both of you.</p>
                    <div className="together__row">
                      <button className="together__who" onClick={() => navigate({ name: 'user', id: w.id })}>
                        <Cover src={withThumb} round size={40} />
                        <span>
                          <b>{w.name}</b>
                          <small>{now?.track ? `${now.track.name}, ${now.track.artists}` : now ? 'Nothing playing right now' : 'Connecting…'}</small>
                        </span>
                      </button>
                      <button className="btn" onClick={() => stopListeningWith()}>
                        Stop
                      </button>
                    </div>
                  </section>
                )}
                {party && (
                  <section>
                    <h3>{hosting ? 'Your party' : 'A party you joined'}</h3>
                    <div className="together__row">
                      <button className="together__who" onClick={() => navigate({ name: 'party' })}>
                        <span className="together__party together__party--big">
                          <PartyIcon size={20} />
                        </span>
                        <span>
                          <b>{hosting ? 'Your party is on' : (joinedNow?.name ?? 'Party')}</b>
                          <small>{hosting ? 'Guests add songs from their phones' : joinedNow ? joinedNow.artists : joinedStatus || 'Connecting…'}</small>
                        </span>
                      </button>
                      <button className="btn" onClick={() => (hosting ? void stopParty() : leaveParty())}>
                        {hosting ? 'End' : 'Leave'}
                      </button>
                    </div>
                  </section>
                )}
                {list.length > 0 && (
                  <section>
                    <h3>{list.length === 1 ? 'Listening with you' : `${list.length} listening with you`}</h3>
                    {list.map((l) => (
                      <button key={l.id} className="together__who" onClick={() => navigate({ name: 'user', id: l.id })}>
                        <Cover src={l.thumb} round size={40} />
                        <span>
                          <b>{l.displayName}</b>
                          <small>{l.track ?? 'Hearing what you play'}</small>
                        </span>
                      </button>
                    ))}
                  </section>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
