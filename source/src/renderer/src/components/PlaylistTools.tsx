// Playlist tools: remove duplicates, sort, merge another playlist in, and change the cover.
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import * as sp from '@/lib/spotify'
import type { PlaylistEntry } from '@/lib/spotify'
import type { SPlaylist } from '@/lib/types'
import { useApp, errorText, editablePlaylists } from '@/lib/store'
import { pickImageFile } from '@/lib/profile'
import { cropImage } from './ImageCropper'
import { plural } from '@/lib/format'
import { Glass } from './Glass'
import { Cover } from './common'
import { CloseIcon, CopyIcon, ImageIcon, SortIcon, TrashIcon } from './Icons'

export type ToolTab = 'clean' | 'sort' | 'merge' | 'cover'

interface Props {
  open: boolean
  initialTab?: ToolTab
  playlist: SPlaylist
  entries: PlaylistEntry[]
  /** Local files and unavailable songs Spotify doesn't return; sorting would drop them. */
  hidden: number
  onClose: () => void
  /** Called after a change so the page reloads the playlist. */
  onChanged: (opts?: { cover?: string }) => void
}

const pop = { type: 'spring' as const, stiffness: 480, damping: 34 }

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/\s*[([].*?(remaster|version|edit|mix|live|mono|stereo|feat\.?|with).*?[)\]]/g, '')
    .replace(/\s+-\s+.*(remaster|version|edit|live|mono|stereo).*$/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** Index of every row that duplicates an earlier row. */
function findDuplicates(entries: PlaylistEntry[], similar: boolean): number[] {
  const seen = new Set<string>()
  const dupes: number[] = []
  entries.forEach((e, i) => {
    const keys = [e.track.id]
    if (similar) keys.push(`${norm(e.track.name)}|${norm(e.track.artists[0]?.name ?? '')}`)
    if (keys.some((k) => seen.has(k))) dupes.push(i)
    keys.forEach((k) => seen.add(k))
  })
  return dupes
}

type SortKey = 'title' | 'artist' | 'album' | 'release' | 'length' | 'added' | 'shuffle'

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'added', label: 'Date added' },
  { id: 'title', label: 'Title' },
  { id: 'artist', label: 'Artist' },
  { id: 'album', label: 'Album' },
  { id: 'release', label: 'Release date' },
  { id: 'length', label: 'Length' },
  { id: 'shuffle', label: 'Shuffle' }
]

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

function sortEntries(entries: PlaylistEntry[], key: SortKey, desc: boolean): PlaylistEntry[] {
  if (key === 'shuffle') {
    const out = entries.slice()
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[out[i], out[j]] = [out[j], out[i]]
    }
    return out
  }
  const val = (e: PlaylistEntry): string | number => {
    switch (key) {
      case 'title':
        return e.track.name
      case 'artist':
        return `${e.track.artists[0]?.name ?? ''} ${e.track.album?.release_date ?? ''} ${String(e.track.track_number ?? 0).padStart(3, '0')}`
      case 'album':
        return `${e.track.album?.name ?? ''} ${String(e.track.track_number ?? 0).padStart(3, '0')}`
      case 'release':
        return e.track.album?.release_date ?? ''
      case 'length':
        return e.track.duration_ms
      case 'added':
        return e.addedAt ? Date.parse(e.addedAt) : 0
    }
  }
  const out = entries.slice().sort((a, b) => {
    const x = val(a)
    const y = val(b)
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(String(x), String(y))
    return c || a.pos - b.pos
  })
  return desc ? out.reverse() : out
}

/** Square JPEG under Spotify's 256 KB limit, as base64 without the data: prefix. */
async function coverJpeg(file: File): Promise<{ base64: string; dataUrl: string } | null> {
  const cropped = await cropImage(file, { aspect: 1, maxWidth: 640, title: 'Crop cover' })
  if (!cropped) return null
  const bitmap = await createImageBitmap(cropped)
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  let size = Math.min(640, side)
  for (let attempt = 0; attempt < 8; attempt++) {
    canvas.width = canvas.height = size
    canvas.getContext('2d')!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size)
    for (const q of [0.9, 0.82, 0.74, 0.66, 0.58]) {
      const dataUrl = canvas.toDataURL('image/jpeg', q)
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
      if (base64.length <= 250_000) {
        bitmap.close()
        return { base64, dataUrl }
      }
    }
    size = Math.round(size * 0.82)
  }
  bitmap.close()
  throw new Error('This image is too detailed to fit Spotify’s 256 KB cover limit.')
}

export function PlaylistTools({ open, initialTab = 'clean', playlist, entries, hidden, onClose, onChanged }: Props): React.JSX.Element {
  const [tab, setTab] = useState<ToolTab>(initialTab)
  useEffect(() => {
    if (open) setTab(initialTab)
  }, [open, initialTab])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const tabs: { id: ToolTab; label: string; icon: React.ReactNode }[] = [
    { id: 'clean', label: 'Duplicates', icon: <TrashIcon size={16} /> },
    { id: 'sort', label: 'Sort', icon: <SortIcon size={16} /> },
    { id: 'merge', label: 'Merge', icon: <CopyIcon size={16} /> },
    { id: 'cover', label: 'Cover', icon: <ImageIcon size={16} /> }
  ]

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-layer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div initial={{ scale: 0.92, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }} transition={pop}>
            <Glass radius={28} tone="thick" bezel={22} refraction={56} className="modal tools">
              <button className="icon-btn modal__close" aria-label="Close" onClick={onClose}>
                <CloseIcon size={18} />
              </button>
              <h2 className="tools__title">Playlist tools</h2>
              <p className="muted tools__sub">{playlist.name}</p>
              <div className="seg tools__tabs" role="tablist">
                {tabs.map((t) => (
                  <button key={t.id} role="tab" aria-selected={tab === t.id} className={`seg__btn ${tab === t.id ? 'is-on' : ''}`} onClick={() => setTab(t.id)}>
                    {t.icon}
                    {t.label}
                    {tab === t.id && <motion.span layoutId="tools-tab" className="seg__pill" transition={pop} />}
                  </button>
                ))}
              </div>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={tab}
                  className="tools__body"
                  initial={{ opacity: 0, x: 14 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -14 }}
                  transition={{ duration: 0.18 }}
                >
                  {tab === 'clean' && <CleanTab playlist={playlist} entries={entries} onChanged={onChanged} />}
                  {tab === 'sort' && <SortTab playlist={playlist} entries={entries} hidden={hidden} onChanged={onChanged} />}
                  {tab === 'merge' && <MergeTab playlist={playlist} entries={entries} onChanged={onChanged} />}
                  {tab === 'cover' && <CoverTab playlist={playlist} onChanged={onChanged} />}
                </motion.div>
              </AnimatePresence>
            </Glass>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

type TabProps = Pick<Props, 'playlist' | 'entries' | 'onChanged'>

function useBusy(): [boolean, (label: string, fn: () => Promise<void>) => Promise<void>] {
  const [busy, setBusy] = useState(false)
  const run = async (label: string, fn: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await fn()
      useApp.getState().toast(label)
    } catch (e) {
      useApp.getState().toast(errorText(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  return [busy, run]
}

function CleanTab({ playlist, entries, onChanged }: TabProps): React.JSX.Element {
  const [similar, setSimilar] = useState(false)
  const [busy, run] = useBusy()
  const dupes = useMemo(() => findDuplicates(entries, similar), [entries, similar])

  const remove = (): Promise<void> =>
    run(`Removed ${plural(dupes.length, 'duplicate')}`, async () => {
      const drop = new Set(dupes)
      const keep = entries.filter((_, i) => !drop.has(i))
      const dropUris = new Set(dupes.map((i) => entries[i].track.uri))
      // Removing a song removes every copy, so copies we keep are added back in place.
      const readd: { uri: string; index: number }[] = []
      keep.forEach((e, index) => {
        if (dropUris.has(e.track.uri)) readd.push({ uri: e.track.uri, index })
      })
      await sp.removeManyFromPlaylist(playlist.id, [...dropUris])
      for (const r of readd) await sp.addToPlaylist(playlist.id, [r.uri], r.index)
      onChanged()
    })

  return (
    <>
      <div className="tools__stat">
        <strong>{dupes.length}</strong>
        <span>{dupes.length === 1 ? 'duplicate song' : 'duplicate songs'}</span>
      </div>
      <label className="check">
        <input type="checkbox" checked={similar} onChange={(e) => setSimilar(e.target.checked)} />
        <span>Also catch other versions of the same song (remasters, radio edits, live)</span>
      </label>
      {dupes.length > 0 && (
        <ul className="tools__list">
          {dupes.slice(0, 40).map((i) => {
            const t = entries[i].track
            return (
              <li key={i}>
                <Cover src={sp.pickImage(t.album?.images, 64)} size={34} radius={6} />
                <span className="tools__li-text">
                  <b>{t.name}</b>
                  <small>
                    {t.artists.map((a) => a.name).join(', ')} · position {i + 1}
                  </small>
                </span>
              </li>
            )
          })}
          {dupes.length > 40 && <li className="muted">and {dupes.length - 40} more</li>}
        </ul>
      )}
      <div className="modal__actions">
        <button className="btn btn--accent" disabled={busy || dupes.length === 0} onClick={() => void remove()}>
          {busy ? 'Cleaning up…' : dupes.length ? `Remove ${plural(dupes.length, 'duplicate')}` : 'No duplicates'}
        </button>
      </div>
    </>
  )
}

function SortTab({ playlist, entries, hidden, onChanged }: TabProps & { hidden: number }): React.JSX.Element {
  const [key, setKey] = useState<SortKey>('artist')
  const [desc, setDesc] = useState(false)
  const [busy, run] = useBusy()
  const preview = useMemo(() => sortEntries(entries, key, desc).slice(0, 6), [entries, key, desc])

  const apply = (): Promise<void> =>
    run('Playlist sorted', async () => {
      const sorted = sortEntries(entries, key, desc)
      await sp.replacePlaylistItems(
        playlist.id,
        sorted.map((e) => e.track.uri)
      )
      onChanged()
    })

  return (
    <>
      <div className="pills">
        {SORTS.map((s) => (
          <button key={s.id} className={`pill ${key === s.id ? 'is-on' : ''}`} onClick={() => setKey(s.id)}>
            {s.label}
          </button>
        ))}
      </div>
      {key !== 'shuffle' && (
        <div className="seg seg--small">
          <button className={`seg__btn ${!desc ? 'is-on' : ''}`} onClick={() => setDesc(false)}>
            {key === 'added' || key === 'release' ? 'Oldest first' : key === 'length' ? 'Shortest first' : 'A to Z'}
          </button>
          <button className={`seg__btn ${desc ? 'is-on' : ''}`} onClick={() => setDesc(true)}>
            {key === 'added' || key === 'release' ? 'Newest first' : key === 'length' ? 'Longest first' : 'Z to A'}
          </button>
        </div>
      )}
      <ol className="tools__list tools__list--num">
        {preview.map((e, i) => (
          <motion.li key={`${e.track.id}-${e.pos}`} layout transition={pop}>
            <Cover src={sp.pickImage(e.track.album?.images, 64)} size={34} radius={6} />
            <span className="tools__li-text">
              <b>{e.track.name}</b>
              <small>{e.track.artists.map((a) => a.name).join(', ')}</small>
            </span>
            <span className="tools__n">{i + 1}</span>
          </motion.li>
        ))}
      </ol>
      <p className="tools__note">
        {hidden > 0
          ? `This playlist has ${plural(hidden, 'local file')} Spotify can't re-add, so it can't be sorted here.`
          : 'Sorting rewrites the playlist on Spotify, so every song gets today as its “date added”.'}
      </p>
      <div className="modal__actions">
        <button className="btn btn--accent" disabled={busy || hidden > 0 || entries.length < 2} onClick={() => void apply()}>
          {busy ? 'Sorting…' : `Sort ${plural(entries.length, 'song')}`}
        </button>
      </div>
    </>
  )
}

function MergeTab({ playlist, entries, onChanged }: TabProps): React.JSX.Element {
  const all = useApp((s) => s.playlists)
  const me = useApp((s) => s.me)
  const mine = useMemo(() => editablePlaylists({ playlists: all, me } as never).filter((p) => p.id !== playlist.id), [all, me, playlist.id])
  const others = useMemo(() => all.filter((p) => p.id !== playlist.id), [all, playlist.id])
  const [pick, setPick] = useState<SPlaylist | null>(null)
  const [busy, run] = useBusy()
  const [incoming, setIncoming] = useState<PlaylistEntry[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!pick) return
    setIncoming(null)
    setLoadError(null)
    sp.getPlaylistEntries(pick.id)
      .then((r) => setIncoming(r.entries))
      .catch(() => setLoadError('Spotify only shares the songs of playlists you own or collaborate on.'))
  }, [pick])

  const have = useMemo(() => new Set(entries.map((e) => e.track.id)), [entries])
  const fresh = useMemo(() => {
    if (!incoming) return []
    const seen = new Set(have)
    const out: string[] = []
    for (const e of incoming) {
      if (seen.has(e.track.id)) continue
      seen.add(e.track.id)
      out.push(e.track.uri)
    }
    return out
  }, [incoming, have])

  const list = mine.length ? [...mine, ...others.filter((p) => !mine.includes(p))] : others

  return (
    <>
      <p className="muted">Pick a playlist to pull its songs into {playlist.name}. Songs already here are skipped.</p>
      <div className="tools__picker">
        {list.map((p) => (
          <button key={p.id} className={`tools__pl ${pick?.id === p.id ? 'is-on' : ''}`} onClick={() => setPick(p)}>
            <Cover src={sp.pickImage(p.images, 120)} size={44} radius={8} />
            <span className="tools__li-text">
              <b>{p.name}</b>
              <small>{plural(sp.playlistTotal(p), 'song')}</small>
            </span>
          </button>
        ))}
      </div>
      {loadError && <p className="tools__note">{loadError}</p>}
      <div className="modal__actions">
        <button
          className="btn"
          disabled={busy || !incoming}
          onClick={() =>
            void run('Created a merged playlist', async () => {
              const app = useApp.getState()
              const merged = await sp.createPlaylist(`${playlist.name} + ${pick!.name}`, 'Merged in Pulse Music')
              await sp.addManyToPlaylist(merged.id, [...entries.map((e) => e.track.uri), ...fresh])
              await app.refreshPlaylists()
              app.navigate({ name: 'playlist', id: merged.id })
            })
          }
        >
          Make a new playlist
        </button>
        <button
          className="btn btn--accent"
          disabled={busy || !incoming || fresh.length === 0}
          onClick={() =>
            void run(`Added ${plural(fresh.length, 'song')}`, async () => {
              await sp.addManyToPlaylist(playlist.id, fresh)
              onChanged()
            })
          }
        >
          {busy ? 'Working…' : !pick ? 'Pick a playlist' : !incoming ? 'Loading…' : fresh.length ? `Add ${plural(fresh.length, 'new song')}` : 'Nothing new to add'}
        </button>
      </div>
    </>
  )
}

function CoverTab({ playlist, onChanged }: Pick<Props, 'playlist' | 'onChanged'>): React.JSX.Element {
  const [scopes, setScopes] = useState<string[] | null>(null)
  const [preview, setPreview] = useState<{ base64: string; dataUrl: string } | null>(null)
  const [busy, run] = useBusy()
  useEffect(() => {
    void window.pulse.auth.scopes().then(setScopes)
  }, [])
  const allowed = scopes?.includes('ugc-image-upload')
  const current = preview?.dataUrl ?? sp.pickImage(playlist.images, 640)

  return (
    <div className="tools__cover">
      <div className="tools__cover-art">
        {current ? <img src={current} alt="" /> : <span className="muted">No cover yet</span>}
      </div>
      <div className="tools__cover-side">
        {scopes !== null && !allowed ? (
          <>
            <p>Changing covers needs one more permission from Spotify. Sign in again once to allow it.</p>
            <button
              className="btn btn--accent"
              onClick={async () => {
                await window.pulse.auth.logout()
                window.location.reload()
              }}
            >
              Sign in again
            </button>
          </>
        ) : (
          <>
            <p className="muted">After choosing an image you can crop it. Pulse Music shrinks it to fit Spotify’s 256 KB limit.</p>
            <button
              className="btn"
              disabled={busy}
              onClick={async () => {
                const file = await pickImageFile()
                if (!file) return
                try {
                  const cover = await coverJpeg(file)
                  if (cover) setPreview(cover)
                } catch (e) {
                  useApp.getState().toast(errorText(e), 'error')
                }
              }}
            >
              <ImageIcon size={16} /> Choose image
            </button>
            <button
              className="btn btn--accent"
              disabled={busy || !preview}
              onClick={() =>
                void run('Cover updated. Spotify may take a minute to show it everywhere.', async () => {
                  await sp.uploadPlaylistCover(playlist.id, preview!.base64)
                  onChanged({ cover: preview!.dataUrl })
                })
              }
            >
              {busy ? 'Uploading…' : 'Use this cover'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
