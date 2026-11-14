// The queue, laid out like Spotify's: what's playing, "Next in queue" (songs you added, which
// you can drag, remove or clear) and "Next from" the playlist, album or the AI DJ.
// Rows only re-render when their own song changes, so the list stays smooth while playing.
import { Emo } from './Emoji'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { clearQueue, moveInQueue, playContext, playFromQueue, playNextInQueue, playUris, removeFromQueue, skipUpcoming, upcomingFromContext, usePlayer, useSkipped } from '@/lib/player'
import { getQueue, pickImage } from '@/lib/spotify'
import type { STrack } from '@/lib/types'
import { useApp } from '@/lib/store'
import { removeFromDjSet, useDj } from '@/lib/dj'
import { Cover, EqBars } from './common'
import { CloseIcon, GripIcon } from './Icons'
import { motion, AnimatePresence } from 'motion/react'
import { useDragReorder } from '@/lib/dragReorder'
import { trackMenu } from './menus'

interface RowData {
  key: string
  image: string | null
  title: string
  artist: string
  /** Set for songs in "Next in queue". */
  uid?: string
  /** Set for songs from Spotify's list (for the context menu). */
  track?: STrack
  /** Party mode: who added it. */
  addedBy?: string
  /** Set for the AI DJ's songs. */
  djId?: string
}

type MenuFn = (e: React.MouseEvent, row: RowData) => void
type RowFn = (row: RowData) => void

const Row = memo(function Row({
  row,
  drag,
  editing,
  onMenu,
  onPlay,
  onRemove
}: {
  row: RowData
  drag?: boolean
  editing?: boolean
  onMenu: MenuFn
  onPlay: RowFn
  onRemove?: RowFn
}): React.JSX.Element {
  const removable = !!onRemove && (!!row.uid || !!row.djId || !!row.track)
  return (
    <div
      className={`qrow ${drag ? 'qrow--drag' : ''} ${editing ? 'is-editing' : ''}`}
      {...(drag ? { 'data-drag-row': '', 'data-drag-handle': '' } : {})}
      onContextMenu={(e) => onMenu(e, row)}
      onDoubleClick={() => !editing && onPlay(row)}
    >
      <AnimatePresence initial={false}>
        {editing && removable && (
          <motion.button
            className="qrow__minus"
            aria-label={`Remove ${row.title}`}
            initial={{ width: 0, opacity: 0, marginRight: -10 }}
            animate={{ width: 22, opacity: 1, marginRight: 0 }}
            exit={{ width: 0, opacity: 0, marginRight: -10 }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onRemove!(row)
            }}
          >
            <i />
          </motion.button>
        )}
      </AnimatePresence>
      <Cover src={row.image} size={44} radius={8} />
      <span className="qrow__text">
        <span className="qrow__title">
          <Emo>{row.title}</Emo>
        </span>
        <span className="qrow__artist">{row.addedBy ? `${row.artist} · added by ${row.addedBy}` : row.artist}</span>
      </span>
      {!editing && removable && (
        <button
          className="qrow__x"
          aria-label={`Remove ${row.title} from the queue`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onRemove!(row)
          }}
        >
          <CloseIcon size={14} />
        </button>
      )}
      {drag && (
        <span className="qrow__grip" data-drag-handle title="Drag to reorder">
          <GripIcon />
        </span>
      )}
    </div>
  )
})

/** "Playlist name", "Album name", "Liked Songs"… for the "Next from" heading. */
function useContextName(): string | null {
  const contextUri = usePlayer((s) => s.contextUri)
  const albumUri = usePlayer((s) => s.track?.album.uri)
  const albumName = usePlayer((s) => s.track?.album.name)
  const playlists = useApp((s) => s.playlists)
  if (!contextUri) return null
  const [, kind, id] = contextUri.split(':')
  if (kind === 'playlist') return playlists.find((p) => p.id === id)?.name ?? 'this playlist'
  if (kind === 'album') return albumUri === contextUri ? (albumName ?? 'this album') : 'this album'
  if (contextUri.endsWith(':collection')) return 'Liked Songs'
  if (kind === 'artist') return 'this artist'
  return null
}

/** The song that is playing, subscribed on its own so the list below doesn't re-render. */
function NowRow(): React.JSX.Element | null {
  const id = usePlayer((s) => s.track?.id)
  const name = usePlayer((s) => s.track?.name)
  const artists = usePlayer((s) => s.track?.artists.map((a) => a.name).join(', '))
  const art = usePlayer((s) => s.track?.artUrlSmall ?? s.track?.artUrl ?? null)
  const paused = usePlayer((s) => s.paused)
  if (!id) return null
  return (
    <div className="qrow is-current">
      <Cover src={art} size={44} radius={8} />
      <span className="qrow__text">
        <span className="qrow__title">
          <Emo>{name}</Emo>
        </span>
        <span className="qrow__artist">{artists}</span>
      </span>
      <EqBars playing={!paused} />
    </div>
  )
}

export function QueueList({ onClose }: { onClose?: () => void }): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const contextUri = usePlayer((s) => s.contextUri)
  const version = usePlayer((s) => s.queueVersion)
  const trackId = usePlayer((s) => s.track?.id ?? null)
  const upNext = usePlayer((s) => s.upNext)
  const openMenu = useApp((s) => s.openMenu)
  const fromName = useContextName()
  // With the AI DJ on, what comes next is the DJ's show, not Spotify's list.
  const djActive = useDj((s) => s.active)
  const djSet = useDj((s) => s.set)
  const [later, setLater] = useState<STrack[] | null>(null)
  const [error, setError] = useState(false)
  const list = useRef<HTMLDivElement>(null)

  const queued = useMemo<RowData[]>(
    () => upNext.map((q) => ({ key: q.uid, uid: q.uid, image: q.image, title: q.name, artist: q.artists, addedBy: q.addedBy })),
    [upNext]
  )
  const djRows = useMemo<RowData[] | null>(() => {
    if (!djActive || !trackId) return null
    const i = djSet.findIndex((p) => p.id === trackId)
    return djSet.slice(i + 1).map((p, n) => ({ key: `${p.id}-${n}`, image: p.image, title: p.name, artist: p.artist, djId: p.id }))
  }, [djActive, djSet, trackId])
  const skipped = useSkipped((s) => s.ids)
  const laterRows = useMemo<RowData[] | null>(
    () =>
      later?.filter((t) => !skipped.includes(t.id)).map((t, n) => ({
        key: `${t.id}-${n}`,
        image: pickImage(t.album?.images, 64),
        title: t.name,
        artist: t.artists.map((a) => a.name).join(', '),
        track: t
      })) ?? null,
    [later, skipped]
  )

  // Spotify's view of what follows. While Pulse plays your queue, it is the list read just
  // before the queue started (Spotify only knows about the queued songs then).
  const queuedIds = useMemo(() => upNext.map((q) => q.uri).join(','), [upNext])
  useEffect(() => {
    if (djActive) return
    let alive = true
    const t = window.setTimeout(() => {
      const own = upcomingFromContext()
      if (own) {
        setLater(own)
        return
      }
      getQueue()
        .then((r) => {
          if (!alive) return
          setLater(r.queue.filter((x) => x?.id).slice(0, 30))
          setError(false)
        })
        .catch(() => alive && setError(true))
    }, 600)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [version, trackId, queuedIds, djActive])

  useDragReorder({
    container: list,
    enabled: upNext.length > 1,
    onDrop: (from, to) => moveInQueue(from, to)
  })

  const onMenu = useCallback<MenuFn>(
    (e, row) => {
      e.preventDefault()
      if (row.uid)
        openMenu(e.clientX, e.clientY, [
          { label: 'Play now', onSelect: () => void playFromQueue(row.uid!, (later ?? []).map((t) => t.uri)) },
          { label: 'Play next', onSelect: () => playNextInQueue(row.uid!) },
          { label: 'Remove from queue', onSelect: () => removeFromQueue(row.uid!) }
        ])
      else if (row.djId) openMenu(e.clientX, e.clientY, [{ label: 'Remove from the show', onSelect: () => removeFromDjSet(row.djId!) }])
      else if (row.track) openMenu(e.clientX, e.clientY, trackMenu(row.track))
    },
    [openMenu, later]
  )

  /** Double-click: play that song and carry on from there. */
  const onPlay = useCallback<RowFn>(
    (row) => {
      if (row.uid) return void playFromQueue(row.uid, (later ?? []).map((t) => t.uri))
      if (row.djId) {
        const i = djSet.findIndex((p) => p.id === row.djId)
        if (i >= 0) void playUris(djSet.slice(i).map((p) => p.uri), undefined, { source: 'dj' })
        return
      }
      if (!row.track) return
      if (contextUri && /^spotify:(playlist|album):/.test(contextUri)) return void playContext(contextUri, row.track.uri)
      const list = later ?? []
      const i = list.findIndex((t) => t.id === row.track!.id)
      void playUris(list.slice(Math.max(0, i)).map((t) => t.uri))
    },
    [later, djSet, contextUri]
  )

  const onRemove = useCallback<RowFn>((row) => {
    if (row.uid) removeFromQueue(row.uid)
    else if (row.djId) removeFromDjSet(row.djId)
    else if (row.track) skipUpcoming(row.track.id)
  }, [])

  const canEdit = queued.length > 0 || (djRows?.length ?? 0) > 0 || (laterRows?.length ?? 0) > 0
  useEffect(() => {
    if (!canEdit) setEditing(false)
  }, [canEdit])

  const head = (
    <header className="queue__top">
      <h2>Queue</h2>
      {canEdit && (
        <button className={`queue__edit ${editing ? 'is-on' : ''}`} onClick={() => setEditing((v) => !v)}>
          {editing ? 'Done' : 'Edit'}
        </button>
      )}
      {onClose && (
        <button className="icon-btn" aria-label="Close queue" onClick={onClose}>
          <CloseIcon size={18} />
        </button>
      )}
    </header>
  )

  if (!trackId)
    return (
      <div className="queue">
        {head}
        <div className="queue__empty">{error ? 'Start playing to see your queue.' : 'Play something and what comes next shows up here.'}</div>
      </div>
    )

  return (
    <div className={`queue ${editing ? 'is-editing' : ''}`}>
      {head}
      <h3 className="queue__h">Now playing</h3>
      <NowRow />

      {queued.length > 0 && (
        <>
          <h3 className="queue__h">
            Next in queue
            <button className="queue__clear" onClick={() => void clearQueue()}>
              Clear queue
            </button>
          </h3>
          <div className="queue__list" ref={list}>
            {queued.map((r) => (
              <Row key={r.key} row={r} drag={queued.length > 1} editing={editing} onMenu={onMenu} onPlay={onPlay} onRemove={onRemove} />
            ))}
          </div>
        </>
      )}

      {djRows ? (
        <>
          <h3 className="queue__h">
            <span className="queue__from">Next from: Pulse DJ</span>
          </h3>
          {djRows.length === 0 ? (
            <div className="queue__empty">The DJ is picking the next songs…</div>
          ) : (
            djRows.map((r) => <Row key={r.key} row={r} editing={editing} onMenu={onMenu} onPlay={onPlay} onRemove={onRemove} />)
          )}
        </>
      ) : (
        <>
          <h3 className="queue__h">
            {fromName ? <span className="queue__from">Next from: {fromName}</span> : 'Next up'}
            {queued.length === 0 && laterRows && laterRows.length > 0 && (
              <button className="queue__clear" title="Removes songs added to Spotify's queue elsewhere" onClick={() => void clearQueue()}>
                Clear queue
              </button>
            )}
          </h3>
          {!laterRows ? (
            <div className="queue__empty">Loading…</div>
          ) : laterRows.length === 0 ? (
            <div className="queue__empty">Nothing else is coming up.</div>
          ) : (
            laterRows.map((r) => <Row key={r.key} row={r} editing={editing} onMenu={onMenu} onPlay={onPlay} onRemove={onRemove} />)
          )}
        </>
      )}
    </div>
  )
}
