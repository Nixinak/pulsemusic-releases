// Context menu, modals, toasts and the queue drawer.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useApp, errorText, type MenuItem } from '@/lib/store'
import * as sp from '@/lib/spotify'
import { connectSpotifyFriends } from '@/lib/spotifyFriends'
import { invalidate } from '@/lib/useQuery'
import { cleanDescription } from '@/lib/format'
import { Glass } from './Glass'
import { ChevronRight, CloseIcon } from './Icons'
import { QueueList } from './QueueList'
import { Lyrics } from './Lyrics'
import { usePlayer } from '@/lib/player'
import type { UpdateStatus } from '@shared/types'

const pop = { type: 'spring' as const, stiffness: 520, damping: 34 }

/* ---------- Context menu ---------- */

function MenuList({ items, onDone }: { items: MenuItem[]; onDone: () => void }): React.JSX.Element {
  const [sub, setSub] = useState<number | null>(null)
  const [flip, setFlip] = useState(false)
  return (
    <div className="menu__list" role="menu">
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="menu__sep" />
        ) : (
          <div
            key={i}
            className="menu__wrap"
            onMouseEnter={(e) => {
              setSub(it.submenu ? i : null)
              setFlip(e.currentTarget.getBoundingClientRect().right + 300 > window.innerWidth)
            }}
          >
            <button
              role="menuitem"
              className={`menu__item ${it.danger ? 'is-danger' : ''}`}
              disabled={it.disabled}
              onClick={() => {
                if (it.submenu) return setSub(i)
                it.onSelect?.()
                onDone()
              }}
            >
              <span>{it.label}</span>
              {it.submenu && <ChevronRight size={15} />}
            </button>
            {it.submenu && sub === i && (
              <Glass radius={14} tone="thick" bezel={10} refraction={24} className={`menu menu--sub ${flip ? 'is-flipped' : ''}`}>
                <MenuList items={it.submenu} onDone={onDone} />
              </Glass>
            )}
          </div>
        )
      )}
    </div>
  )
}

export function ContextMenu(): React.JSX.Element {
  const menu = useApp((s) => s.menu)
  const close = useApp((s) => s.closeMenu)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  useLayoutEffect(() => {
    if (!menu || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    setPos({
      x: Math.min(menu.x, window.innerWidth - r.width - 12),
      y: Math.min(menu.y, window.innerHeight - r.height - 12)
    })
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', close)
    document.addEventListener('wheel', close, { passive: true })
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', close)
      document.removeEventListener('wheel', close)
    }
  }, [menu, close])

  return (
    <AnimatePresence>
      {menu && (
        <motion.div
          ref={ref}
          className="menu-layer"
          style={{ left: pos.x || menu.x, top: pos.y || menu.y }}
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.12 } }}
          transition={pop}
        >
          <Glass radius={16} tone="thick" bezel={12} refraction={28} className="menu">
            <MenuList items={menu.items} onDone={close} />
          </Glass>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* ---------- Modals ---------- */

function PlaylistForm({
  title,
  initialName,
  initialDesc,
  submitLabel,
  onSubmit
}: {
  title: string
  initialName: string
  initialDesc: string
  submitLabel: string
  onSubmit: (name: string, desc: string) => Promise<void>
}): React.JSX.Element {
  const [name, setName] = useState(initialName)
  const [desc, setDesc] = useState(initialDesc)
  const [busy, setBusy] = useState(false)
  const setModal = useApp((s) => s.setModal)
  return (
    <form
      className="modal__form"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!name.trim()) return
        setBusy(true)
        try {
          await onSubmit(name.trim(), desc.trim())
          setModal(null)
        } catch (err) {
          useApp.getState().toast(errorText(err), 'error')
        } finally {
          setBusy(false)
        }
      }}
    >
      <h2>{title}</h2>
      <label>
        <span>Name</span>
        <input className="field" autoFocus value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="My playlist" />
      </label>
      <label>
        <span>Description</span>
        <textarea className="field" value={desc} maxLength={300} onChange={(e) => setDesc(e.target.value)} placeholder="Optional" />
      </label>
      <div className="modal__actions">
        <button type="button" className="btn" onClick={() => setModal(null)}>
          Cancel
        </button>
        <button type="submit" className="btn btn--accent" disabled={busy || !name.trim()}>
          {busy ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  )
}

export function Modals(): React.JSX.Element {
  const modal = useApp((s) => s.modal)
  const setModal = useApp((s) => s.setModal)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setModal(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setModal])

  return (
    <AnimatePresence>
      {modal && (
        <motion.div
          className="modal-layer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && setModal(null)}
        >
          <motion.div initial={{ scale: 0.92, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }} transition={pop}>
            <Glass radius={28} tone="thick" bezel={22} refraction={56} className="modal">
              <button className="icon-btn modal__close" aria-label="Close" onClick={() => setModal(null)}>
                <CloseIcon size={18} />
              </button>
              {modal.type === 'create-playlist' && (
                <PlaylistForm
                  title="New playlist"
                  initialName=""
                  initialDesc=""
                  submitLabel="Create playlist"
                  onSubmit={async (name, desc) => {
                    const app = useApp.getState()
                    const p = await sp.createPlaylist(name, desc)
                    if (modal.addUris?.length) await sp.addToPlaylist(p.id, modal.addUris)
                    await app.refreshPlaylists()
                    app.toast(modal.addUris?.length ? `Created ${name} and added the song` : `Created ${name}`)
                    app.navigate({ name: 'playlist', id: p.id })
                  }}
                />
              )}
              {modal.type === 'edit-playlist' && (
                <PlaylistForm
                  title="Edit details"
                  initialName={modal.playlist.name}
                  initialDesc={cleanDescription(modal.playlist.description)}
                  submitLabel="Save"
                  onSubmit={async (name, description) => {
                    const app = useApp.getState()
                    await sp.updatePlaylist(modal.playlist.id, { name, description })
                    invalidate(`playlist:${modal.playlist.id}`)
                    await app.refreshPlaylists()
                    app.toast('Playlist updated')
                  }}
                />
              )}
              {modal.type === 'delete-playlist' && (
                <div className="modal__form">
                  <h2>Delete {modal.playlist.name}?</h2>
                  <p className="muted">
                    It will be removed from your library. Spotify keeps playlists you made recoverable for 90 days in your account settings.
                  </p>
                  <div className="modal__actions">
                    <button className="btn" onClick={() => setModal(null)}>
                      Cancel
                    </button>
                    <button
                      className="btn btn--danger"
                      onClick={async () => {
                        const app = useApp.getState()
                        try {
                          await sp.deletePlaylist(modal.playlist.id)
                          await app.refreshPlaylists()
                          app.toast(`Deleted ${modal.playlist.name}`)
                          setModal(null)
                          app.navigate({ name: 'library' })
                        } catch (e) {
                          app.toast(errorText(e), 'error')
                        }
                      }}
                    >
                      Delete playlist
                    </button>
                  </div>
                </div>
              )}
            </Glass>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* ---------- Toasts ---------- */

/** A new version: a card says so as soon as one is found (while it downloads in the
 *  background), then asks whether to restart into it now or later. Later hides it; the update
 *  then installs itself when Pulse is closed. */
export function UpdateNotice(): React.JSX.Element | null {
  const [st, setSt] = useState<UpdateStatus | null>(null)
  /** The version the listener put off, so the card stays away until a newer one. */
  const [dismissed, setDismissed] = useState<string | null>(null)
  useEffect(() => {
    if (!window.pulse.updates) return
    void window.pulse.updates.status().then(setSt)
    const off1 = window.pulse.updates.onStatus(setSt)
    const off2 = window.pulse.updates.onReady((v) => setSt((p) => (p?.state === 'ready' ? p : { state: 'ready', version: v })))
    return () => {
      off1()
      off2()
    }
  }, [])
  const show = (st?.state === 'downloading' || st?.state === 'ready') && st.version !== dismissed
  const ready = st?.state === 'ready'
  const notes = st && (st.state === 'downloading' || st.state === 'ready') ? (st.notes ?? []) : []
  return (
    <AnimatePresence>
      {show && st && (
        <motion.aside
          key="update"
          className={`upd ${ready ? 'is-ready' : ''}`}
          role="status"
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        >
          <span className="upd__glow" aria-hidden="true" />
          <header className="upd__head">
            <span className="upd__badge" aria-hidden="true">
              {ready ? (
                <svg
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12.5l4.2 4.2L19 7" />
                </svg>
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" />
                </svg>
              )}
            </span>
            <span className="upd__title">
              <small>{ready ? 'Update ready' : 'New update'}</small>
              <b>Pulse Music {st.version}</b>
            </span>
            <button className="upd__x icon-btn" aria-label="Hide" onClick={() => setDismissed(st.version ?? '')}>
              <CloseIcon size={16} />
            </button>
          </header>
          {notes.length > 0 && (
            <ul className="upd__notes">
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          {ready ? (
            <>
              <p className="upd__text">Restart now to switch to it, or keep listening: it installs itself when you close Pulse.</p>
              <div className="upd__btns">
                <button className="btn btn--accent" onClick={() => window.pulse.updates.install()}>
                  Restart now
                </button>
                <button className="btn" onClick={() => setDismissed(st.version)}>
                  Later
                </button>
              </div>
            </>
          ) : (
            <div className="upd__progress">
              <span className="upd__bar">
                <i style={{ transform: `scaleX(${(st.state === 'downloading' ? st.percent : 0) / 100})` }} />
              </span>
              <small>Downloading in the background… {st.state === 'downloading' ? st.percent : 0}%</small>
            </div>
          )}
        </motion.aside>
      )}
    </AnimatePresence>
  )
}

/** A notice while Spotify refuses requests from the app ("too many requests"). */
export function RateLimitNotice(): React.JSX.Element | null {
  // starts from a block saved before a restart
  const [until, setUntil] = useState(() => sp.rateLimitedUntil())
  const [, tick] = useState(0)
  useEffect(() => {
    const on = (): void => setUntil(sp.rateLimitedUntil())
    window.addEventListener('pulse:rate-limit', on)
    const t = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => {
      window.removeEventListener('pulse:rate-limit', on)
      clearInterval(t)
    }
  }, [])
  const left = Math.ceil((until - Date.now()) / 1000)
  if (left <= 3) return null
  const mins = Math.floor(left / 60)
  const time = left >= 3600 ? `${Math.floor(left / 3600)} h ${Math.floor((left % 3600) / 60)} min` : mins ? `${mins} min ${left % 60} s` : `${left} s`
  // a long pause: the way out right now is the listener's own Spotify app (its own allowance)
  const long = left > 20 * 60
  return (
    <div className="ratelimit" role="status">
      Spotify is limiting requests from Pulse Music. Things will load again in <b>{time}</b>.
      {long && (
        <button className="ratelimit__own" onClick={() => void connectSpotifyFriends().then(() => setUntil(sp.rateLimitedUntil()))}>
          Keep going with your Spotify account
        </button>
      )}
      {long && (
        <button
          className="ratelimit__own"
          onClick={() => {
            try {
              sessionStorage.setItem('pulse-login-notice', 'blocked')
            } catch {
              /* storage unavailable */
            }
            void window.pulse.auth.logout().then(() => window.location.reload())
          }}
        >
          Skip the wait with your own Spotify app
        </button>
      )}
    </div>
  )
}

export function Toasts(): React.JSX.Element {
  const toasts = useApp((s) => s.toasts)
  return (
    <div className="toasts" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 16, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={pop}
          >
            <Glass radius={999} tone="thick" bezel={10} refraction={24} className={`toast toast--${t.tone}`}>
              {t.text}
            </Glass>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

/* ---------- Queue drawer ---------- */

/** Lyrics docked at the right edge, over a blurred copy of the cover. */
export function LyricsDrawer(): React.JSX.Element {
  const open = useApp((s) => s.lyricsOpen)
  const setOpen = useApp((s) => s.setLyricsOpen)
  const track = usePlayer((s) => s.track)
  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          className="drawer drawer--lyrics"
          initial={{ x: 40, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 40, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 36 }}
        >
          <div className="drawer__panel lyrics-dock">
            {track?.artUrl && <div className="lyrics-dock__bg" style={{ backgroundImage: `url("${track.artUrl}")` }} />}
            <header className="drawer__head">
              <div className="lyrics-dock__now">
                <h2>Lyrics</h2>
                {track && (
                  <span>
                    {track.name} · {track.artists.map((a) => a.name).join(', ')}
                  </span>
                )}
              </div>
              <button className="icon-btn" aria-label="Close lyrics" onClick={() => setOpen(false)}>
                <CloseIcon size={18} />
              </button>
            </header>
            <div className="lyrics-dock__body">
              {track ? <Lyrics key={track.id} track={track} /> : <div className="lyrics__empty">Play something to see its lyrics.</div>}
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}

export function QueueDrawer(): React.JSX.Element {
  const open = useApp((s) => s.queueOpen)
  const setOpen = useApp((s) => s.setQueueOpen)
  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          className="drawer"
          initial={{ x: 40, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 40, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 36 }}
        >
          <Glass radius={26} tone="regular" simple blur={14} className="drawer__panel">
            <div className="drawer__body">
              <QueueList onClose={() => setOpen(false)} />
            </div>
          </Glass>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
