// Sharing a playlist you own: public or private, whether others can add songs, an invite link
// for the people you want to add songs (Spotify only lets people in through the owner's invite
// link), who has added songs so far, and copying it as a new playlist.
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import * as sp from '@/lib/spotify'
import { useApp, errorText } from '@/lib/store'
import { useQuery } from '@/lib/useQuery'
import { Cover, Toggle } from './common'
import { CloseIcon, CopyIcon, GlobeIcon, UserPlusIcon, UsersIcon } from './Icons'
import type { SPlaylist } from '@/lib/types'

/** Someone who added songs, with their picture and name from their Spotify page. */
function Person({ id, count, me }: { id: string; count: number; me: boolean }): React.JSX.Element {
  const navigate = useApp((s) => s.navigate)
  const q = useQuery(`spotify-user-quick:${id}`, () => window.pulse.people.spotifyUserQuick(id))
  return (
    <li className="psh__person" onClick={() => navigate({ name: 'user', id })}>
      <Cover src={q.data?.image ?? null} size={36} round />
      <span>
        <b>{me ? 'You' : (q.data?.name ?? id)}</b>
        <small>
          {count} {count === 1 ? 'song' : 'songs'}
        </small>
      </span>
    </li>
  )
}

export function PlaylistShare({
  open,
  playlist,
  entries,
  onClose,
  onChanged
}: {
  open: boolean
  playlist: SPlaylist
  entries: sp.PlaylistEntry[] | null
  onClose: () => void
  onChanged: () => void
}): React.JSX.Element {
  const me = useApp((s) => s.me)
  const toast = useApp((s) => s.toast)
  const navigate = useApp((s) => s.navigate)
  const [isPublic, setPublic] = useState(playlist.public !== false)
  const [collab, setCollab] = useState(!!playlist.collaborative)
  const [saving, setSaving] = useState(false)
  const [invite, setInvite] = useState<{ link: string | null; state: 'idle' | 'making' | 'done' | 'failed' }>({ link: null, state: 'idle' })
  useEffect(() => {
    if (!open) return
    setPublic(playlist.public !== false)
    setCollab(!!playlist.collaborative)
    setInvite({ link: null, state: 'idle' })
  }, [open, playlist.public, playlist.collaborative])
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [open, onClose])

  // who added how many songs, the most first
  const people = useMemo(() => {
    const n = new Map<string, number>()
    for (const e of entries ?? []) if (e.addedBy) n.set(e.addedBy, (n.get(e.addedBy) ?? 0) + 1)
    return [...n.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
  }, [entries])

  /** Spotify keeps collaborative playlists private, so turning one on turns the other off. */
  const save = async (patch: { public?: boolean; collaborative?: boolean }, done: string): Promise<void> => {
    setSaving(true)
    try {
      await sp.updatePlaylist(playlist.id, patch)
      if (patch.public !== undefined) setPublic(patch.public)
      if (patch.collaborative !== undefined) setCollab(patch.collaborative)
      toast(done)
      onChanged()
    } catch (e) {
      toast(`Couldn’t change that: ${errorText(e)}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  const makeInvite = async (): Promise<void> => {
    setInvite({ link: null, state: 'making' })
    if (!collab) await save({ collaborative: true, public: false }, 'Others can add songs now')
    const link = await window.pulse.spotifyAccount.playlistInvite(playlist.id).catch(() => null)
    setInvite({ link, state: link ? 'done' : 'failed' })
    if (link) void navigator.clipboard.writeText(link).then(() => toast('Invite link copied'))
  }

  const copyLink = (url: string, said: string): void =>
    void navigator.clipboard.writeText(url).then(
      () => toast(said),
      () => toast('Couldn’t copy the link', 'error')
    )

  const duplicate = async (): Promise<void> => {
    setSaving(true)
    try {
      const uris = (entries ?? []).map((e) => e.track.uri).filter((u) => u.startsWith('spotify:track:'))
      const copy = await sp.duplicatePlaylist(`${playlist.name} (copy)`, playlist.description ?? '', uris)
      await useApp.getState().refreshPlaylists()
      toast('Copied into a new playlist')
      onClose()
      navigate({ name: 'playlist', id: copy.id })
    } catch (e) {
      toast(`Couldn’t copy it: ${errorText(e)}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  const link = `https://open.spotify.com/playlist/${playlist.id}`

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="psh" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            className="psh__card"
            role="dialog"
            aria-label={`Share ${playlist.name}`}
            initial={{ y: 26, scale: 0.97 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 16, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="psh__head">
              <Cover src={sp.pickImage(playlist.images, 300)} size={64} radius={12} />
              <span>
                <small>Share and collaborate</small>
                <b>{playlist.name}</b>
              </span>
              <button className="icon-btn" aria-label="Close" onClick={onClose}>
                <CloseIcon size={18} />
              </button>
            </header>

            <div className={`psh__row ${collab ? 'is-locked' : ''}`}>
              <span className="psh__icon">
                <GlobeIcon size={18} />
              </span>
              <span className="psh__text">
                <b>{isPublic ? 'Public' : 'Private'}</b>
                <small>
                  {collab
                    ? 'Playlists others add songs to stay private on Spotify.'
                    : isPublic
                      ? 'It shows on your profile and anyone can find it.'
                      : 'Only you, and people you send the link to, can see it.'}
                </small>
              </span>
              <Toggle
                on={isPublic}
                label="Public"
                onChange={(v) => !saving && !collab && void save({ public: v }, v ? 'The playlist is public' : 'The playlist is private')}
              />
            </div>

            <div className="psh__row">
              <span className="psh__icon">
                <UsersIcon size={18} />
              </span>
              <span className="psh__text">
                <b>Others can add songs</b>
                <small>People you invite can add, remove and reorder songs.</small>
              </span>
              <Toggle
                on={collab}
                label="Others can add songs"
                onChange={(v) =>
                  !saving &&
                  void save(
                    v ? { collaborative: true, public: false } : { collaborative: false },
                    v ? 'Others can add songs now' : 'Only you can change it now'
                  )
                }
              />
            </div>

            <div className="psh__invite">
              <button className="btn psh__invite-btn" disabled={saving || invite.state === 'making'} onClick={() => void makeInvite()}>
                <UserPlusIcon size={18} />
                {invite.state === 'making' ? 'Making a link…' : invite.state === 'done' ? 'Make a new invite link' : 'Invite people'}
              </button>
              {invite.state === 'done' && invite.link && (
                <div className="psh__link">
                  <input readOnly value={invite.link} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" />
                  <button className="btn" onClick={() => copyLink(invite.link!, 'Invite link copied')}>
                    <CopyIcon size={16} /> Copy
                  </button>
                </div>
              )}
              {invite.state === 'done' && <small className="psh__note">Send it to the people you want. The link works for 7 days.</small>}
              {invite.state === 'failed' && (
                <small className="psh__note is-warn">
                  Spotify didn’t give Pulse an invite link. Connect your Spotify account in Settings, or open the playlist in Spotify and choose Invite
                  collaborators.{' '}
                  <button className="link" onClick={() => window.pulse.openExternal(link)}>
                    Open in Spotify
                  </button>
                </small>
              )}
            </div>

            {people.length > 0 && (
              <section className="psh__people">
                <h3>Added songs</h3>
                <ul>
                  {people.map(([id, n]) => (
                    <Person key={id} id={id} count={n} me={id === me?.id} />
                  ))}
                </ul>
              </section>
            )}

            <footer className="psh__foot">
              <button className="btn" onClick={() => copyLink(link, 'Link copied')}>
                <CopyIcon size={16} /> Copy link
              </button>
              <button className="btn" disabled={saving || !entries} onClick={() => void duplicate()}>
                Copy as a new playlist
              </button>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}
