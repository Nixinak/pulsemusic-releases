import { memo, useMemo, useRef } from 'react'
import { Emo } from '@/components/Emoji'
import { useDragReorder } from '@/lib/dragReorder'
import { usePlayer } from '@/lib/player'
import { useApp } from '@/lib/store'
import { formatTime } from '@/lib/format'
import { pickImage } from '@/lib/spotify'
import type { STrack } from '@/lib/types'
import { ArtistLinks, Cover, EqBars } from './common'
import { ClockIcon, GripIcon, MoreIcon, PlayIcon } from './Icons'
import { trackMenu } from './menus'

interface Props {
  tracks: STrack[]
  /** Called with the track index when a row is played. */
  onPlay: (index: number) => void
  showArt?: boolean
  showAlbum?: boolean
  numbered?: boolean
  playlistId?: string
  onRemoved?: (t: STrack) => void
  /** Enables drag handles; called once per drop with the old and new index. */
  onReorder?: (from: number, to: number) => void
  /** Play counts by track id, shown in their own column. */
  plays?: Map<string, number>
}

const playsFmt = new Intl.NumberFormat('en')

/** Keys that survive reordering: the n-th copy of a song keeps its key. */
function stableKeys(tracks: STrack[]): string[] {
  const seen = new Map<string, number>()
  return tracks.map((t) => {
    const n = seen.get(t.id) ?? 0
    seen.set(t.id, n + 1)
    return `${t.id}#${n}`
  })
}

export function TrackList({
  tracks,
  onPlay,
  showArt = true,
  showAlbum = true,
  numbered = false,
  playlistId,
  onRemoved,
  onReorder,
  plays
}: Props): React.JSX.Element {
  const currentId = usePlayer((s) => s.track?.id)
  const paused = usePlayer((s) => s.paused)
  const list = useRef<HTMLDivElement>(null)
  const keys = useMemo(() => stableKeys(tracks), [tracks])
  useDragReorder({ container: list, onDrop: (a, b) => onReorder?.(a, b), enabled: !!onReorder })

  return (
    <div
      ref={list}
      className={`tracks ${showAlbum || plays ? '' : 'tracks--no-album'} ${onReorder ? 'tracks--reorder' : ''}`}
      role="table"
    >
      <div className="tracks__head" role="row">
        <span>#</span>
        <span>Title</span>
        {showAlbum && <span>Album</span>}
        {plays && !showAlbum && <span>Plays</span>}
        <span className="tracks__dur">
          <ClockIcon size={16} />
        </span>
        <span />
      </div>
      {tracks.map((t, i) => (
        <Row
          key={keys[i]}
          t={t}
          i={i}
          active={t.id === currentId}
          playing={t.id === currentId && !paused}
          showArt={showArt}
          showAlbum={showAlbum}
          number={numbered ? (t.track_number ?? i + 1) : i + 1}
          onPlay={onPlay}
          playlistId={playlistId}
          onRemoved={onRemoved}
          draggable={!!onReorder}
          plays={plays && !showAlbum ? (plays.get(t.id) ?? 0) : undefined}
        />
      ))}
    </div>
  )
}

const Row = memo(function Row({
  t,
  i,
  active,
  playing,
  showArt,
  showAlbum,
  number,
  onPlay,
  playlistId,
  onRemoved,
  draggable,
  plays
}: {
  t: STrack
  i: number
  active: boolean
  playing: boolean
  showArt: boolean
  showAlbum: boolean
  number: number
  onPlay: (i: number) => void
  playlistId?: string
  onRemoved?: (t: STrack) => void
  draggable?: boolean
  plays?: number
}) {
  const navigate = useApp((s) => s.navigate)
  const openMenu = useApp((s) => s.openMenu)
  const menu = (x: number, y: number): void =>
    openMenu(x, y, trackMenu(t, { playlistId, onRemoved: () => onRemoved?.(t) }))
  const unplayable = t.is_playable === false || t.is_local

  return (
    <div
      className={`track ${active ? 'is-active' : ''} ${unplayable ? 'is-disabled' : ''}`}
      role="row"
      data-drag-row={draggable ? '' : undefined}
      onDoubleClick={() => !unplayable && onPlay(i)}
      onContextMenu={(e) => {
        e.preventDefault()
        menu(e.clientX, e.clientY)
      }}
    >
      {draggable && (
        <span className="track__grip" data-drag-handle title="Drag to reorder" aria-hidden="true">
          <GripIcon />
        </span>
      )}
      <span className="track__num">
        {active ? <EqBars playing={playing} /> : <span className="track__n">{number}</span>}
        <button className="track__play" aria-label={`Play ${t.name}`} onClick={() => !unplayable && onPlay(i)}>
          <PlayIcon size={15} />
        </button>
      </span>
      <span className="track__main">
        {showArt && <Cover src={pickImage(t.album?.images, 64)} size={42} radius={8} />}
        <span className="track__text">
          <span className="track__title">
            <Emo>{t.name}</Emo>
            {t.explicit && <span className="badge-e" title="Explicit">E</span>}
          </span>
          <span className="track__artists">
            <ArtistLinks artists={t.artists} onOpen={(id) => navigate({ name: 'artist', id })} />
          </span>
        </span>
      </span>
      {showAlbum && (
        <span className="track__album">
          {t.album && (
            <span className="link" onClick={() => navigate({ name: 'album', id: t.album!.id })}>
              {t.album.name}
            </span>
          )}
        </span>
      )}
      {plays !== undefined && <span className="track__album track__plays">{plays ? playsFmt.format(plays) : ''}</span>}
      <span className="track__dur">{formatTime(t.duration_ms)}</span>
      <span className="track__more">
        <button
          className="icon-btn"
          aria-label="More options"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            menu(r.left, r.bottom + 4)
          }}
        >
          <MoreIcon size={18} />
        </button>
      </span>
    </div>
  )
})
