// Album, Artist, Playlist and Liked Songs pages.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApp, errorText } from '@/lib/store'
import { useQuery, invalidate } from '@/lib/useQuery'
import * as sp from '@/lib/spotify'
import { playContext, playUris, shufflePlay, togglePlay, usePlayer } from '@/lib/player'
import { moveItem } from '@/lib/dragReorder'
import { PlaylistTools, type ToolTab } from '@/components/PlaylistTools'
import { Recommendations } from '@/components/Recommendations'
import { formatDuration, plural, year, cleanDescription } from '@/lib/format'
import type { STrack } from '@/lib/types'
import { motion, useTransform } from 'motion/react'
import { ErrorState, MediaCard, Shelf, Skeleton, ArtistLinks, usePagePalette, usePageScroll } from '@/components/common'
import { keys, loadAlbum, loadArtistPopular, loadArtistReleases, prefetchAlbum } from '@/lib/loaders'
import { TrackList } from '@/components/TrackList'
import { contextMenuFor } from '@/components/menus'
import { EditIcon, HeartIcon, MoreIcon, PauseIcon, PlayIcon, ShuffleIcon, ToolsIcon, TrashIcon } from '@/components/Icons'
import { PageHeader } from './PageHeader'
import { PulseBadge } from '@/components/PulseBadge'
import { prefetchUser, usePulseUsers } from '@/lib/people'

export function PlayActions({
  contextUri,
  extra,
  disabled,
  uris,
  onShuffle
}: {
  contextUri: string
  extra?: React.ReactNode
  disabled?: boolean
  /** Songs in this collection, so Shuffle can start on a random one. */
  uris?: string[]
  /** Shuffle done by the page itself (an artist gathers songs from several releases). */
  onShuffle?: () => void
}): React.JSX.Element {
  const current = usePlayer((s) => s.contextUri)
  const paused = usePlayer((s) => s.paused)
  const isThis = current === contextUri
  return (
    <>
      <button
        className="play-fab"
        disabled={disabled}
        aria-label={isThis && !paused ? 'Pause' : 'Play'}
        onClick={() => {
          if (isThis) void togglePlay()
          else void playContext(contextUri)
        }}
      >
        {isThis && !paused ? <PauseIcon size={24} /> : <PlayIcon size={24} />}
      </button>
      <button className="btn" disabled={disabled} onClick={() => (onShuffle ? onShuffle() : void shufflePlay(contextUri, uris))}>
        <ShuffleIcon size={17} />
        Shuffle
      </button>
      {extra}
    </>
  )
}

function SaveToggle({ uri, label }: { uri: string; label: [string, string] }): React.JSX.Element {
  const [saved, setSaved] = useState<boolean | null>(null)
  const toast = useApp((s) => s.toast)
  useEffect(() => {
    sp.libraryContains([uri])
      .then(([v]) => setSaved(!!v))
      .catch(() => setSaved(false))
  }, [uri])
  return (
    <button
      className="icon-btn icon-btn--lg"
      aria-pressed={!!saved}
      aria-label={saved ? label[1] : label[0]}
      title={saved ? label[1] : label[0]}
      disabled={saved === null}
      onClick={async () => {
        const next = !saved
        setSaved(next)
        try {
          if (next) await sp.saveToLibrary([uri])
          else await sp.removeFromLibrary([uri])
          invalidate('lib:')
          toast(next ? 'Saved to your library' : 'Removed from your library')
        } catch (e) {
          setSaved(!next)
          toast(errorText(e), 'error')
        }
      }}
    >
      <HeartIcon size={24} filled={!!saved} />
    </button>
  )
}

/* ---------- Album ---------- */

export function AlbumView({ id }: { id: string }): React.JSX.Element {
  const navigate = useApp((s) => s.navigate)
  const openMenu = useApp((s) => s.openMenu)
  const q = useQuery(keys.album(id), () => loadAlbum(id))
  const image = sp.pickImage(q.data?.album.images, 640)
  usePagePalette(image)
  const mainArtist = q.data?.album.artists[0]
  const more = useQuery(mainArtist ? keys.artistAlbums(mainArtist.id) : null, () => loadArtistReleases(mainArtist!.id, mainArtist!.name))

  if (q.error) return <ErrorState text={q.error} onRetry={q.reload} />
  if (!q.data) return <HeaderSkeleton />
  const { album, tracks } = q.data
  const total = tracks.reduce((n, t) => n + t.duration_ms, 0)
  const withAlbum: STrack[] = tracks.map((t) => ({ ...t, album }))
  const others = (more.data ?? []).filter((a) => a.id !== album.id).slice(0, 12)

  return (
    <div className="collection">
      <PageHeader
        image={image}
        kind={album.album_type === 'single' ? 'Single' : album.album_type === 'compilation' ? 'Compilation' : 'Album'}
        title={album.name}
        meta={
          <>
            <strong>
              <ArtistLinks artists={album.artists} onOpen={(aid) => navigate({ name: 'artist', id: aid })} />
            </strong>
            <span>{year(album.release_date)}</span>
            <span>{plural(tracks.length, 'song')}</span>
            <span>{formatDuration(total)}</span>
          </>
        }
        actions={
          <PlayActions
            contextUri={album.uri}
            uris={tracks.map((t) => t.uri)}
            extra={<SaveToggle uri={album.uri} label={['Save album', 'Remove album']} />}
          />
        }
      />
      <TrackList tracks={withAlbum} showArt={false} showAlbum={false} numbered onPlay={(i) => void playContext(album.uri, tracks[i].uri)} />
      {album.copyrights?.[0] && <p className="fineprint">{album.copyrights[0].text}</p>}
      {mainArtist && others.length > 0 && (
        <Shelf title={`More by ${mainArtist.name}`}>
          {others.map((a) => (
            <MediaCard
              key={a.id}
              image={sp.pickImage(a.images, 300)}
              title={a.name}
              subtitle={year(a.release_date)}
              onOpen={() => navigate({ name: 'album', id: a.id })}
              onPrefetch={() => prefetchAlbum(a.id)}
              onPlay={() => void playContext(a.uri)}
              onContextMenu={(e) => {
                e.preventDefault()
                openMenu(e.clientX, e.clientY, contextMenuFor('album', a.uri, a.name))
              }}
            />
          ))}
        </Shelf>
      )}
    </div>
  )
}

export function HeaderSkeleton(): React.JSX.Element {
  return (
    <div className="collection">
      <div className="phead phead--ghost">
        <div className="phead__art-wrap">
          <div className="phead__art skeleton__block" />
        </div>
        <div className="phead__text">
          <div className="skeleton__line" style={{ width: 90 }} />
          <div className="skeleton__line skeleton__line--big" style={{ width: '60%' }} />
          <div className="skeleton__line" style={{ width: 220 }} />
        </div>
      </div>
      <Skeleton rows={8} />
    </div>
  )
}

/* ---------- Artist (the page itself lives in ArtistView.tsx) ---------- */

export function FollowButton({ uri }: { uri: string }): React.JSX.Element {
  const [following, setFollowing] = useState<boolean | null>(null)
  const toast = useApp((s) => s.toast)
  useEffect(() => {
    sp.libraryContains([uri])
      .then(([v]) => setFollowing(!!v))
      .catch(() => setFollowing(false))
  }, [uri])
  return (
    <button
      className="btn"
      disabled={following === null}
      onClick={async () => {
        const next = !following
        setFollowing(next)
        try {
          if (next) await sp.saveToLibrary([uri])
          else await sp.removeFromLibrary([uri])
          invalidate('lib:artists')
        } catch (e) {
          setFollowing(!next)
          toast(errorText(e), 'error')
        }
      }}
    >
      {following ? 'Following' : 'Follow'}
    </button>
  )
}

/* ---------- Playlist ---------- */

/** Where an item at real position `p` ends up after Spotify moves `from` to before `insertBefore`. */
function shiftPos(p: number, from: number, insertBefore: number): number {
  const target = insertBefore > from ? insertBefore - 1 : insertBefore
  if (p === from) return target
  const afterRemove = p > from ? p - 1 : p
  return afterRemove >= target ? afterRemove + 1 : afterRemove
}

export function PlaylistView({ id }: { id: string }): React.JSX.Element {
  const me = useApp((s) => s.me)
  const setModal = useApp((s) => s.setModal)
  const openMenu = useApp((s) => s.openMenu)
  const toast = useApp((s) => s.toast)
  const navigate = useApp((s) => s.navigate)
  const libPlaylists = useApp((s) => s.playlists)
  const [tools, setTools] = useState<{ open: boolean; tab: ToolTab }>({ open: false, tab: 'clean' })
  const [coverOverride, setCoverOverride] = useState<string | null>(null)
  const saving = useRef(Promise.resolve())
  const key = `playlist:${id}`
  const q = useQuery(key, async () => {
    const playlist = await sp.getPlaylist(id)
    const canSeeItems = playlist.owner.id === me?.id || playlist.collaborative || !!playlist.items
    const data = canSeeItems ? await sp.getPlaylistEntries(id).catch(() => null) : null
    return { playlist, entries: data?.entries ?? null, hidden: data?.hidden ?? 0 }
  })

  // Keep the header in sync with renames from the edit dialog.
  const live = libPlaylists.find((p) => p.id === id)
  const entries = q.data?.entries ?? null
  // Spotify hides the songs of other people's playlists from apps; the public embed page has them
  const embedQ = useQuery(q.data && entries === null ? `playlist-embed:${id}` : null, () => window.pulse.people.embedPlaylist(id))
  const tracks = useMemo<STrack[] | null>(() => {
    if (entries) return entries.map((e) => e.track)
    const list = embedQ.data?.tracks
    if (!list?.length) return null
    const cover = sp.pickImage(q.data?.playlist.images, 300)
    return list.map((t) => ({
      id: t.id,
      uri: t.uri,
      name: t.name,
      duration_ms: t.durationMs,
      explicit: t.explicit,
      artists: t.artists.map((name) => ({ id: '', name, uri: '' })),
      album: cover ? { id: '', uri: '', name: '', images: [{ url: cover, width: 300, height: 300 }], artists: [], type: 'album' as const } : undefined,
      type: 'track' as const
    }))
  }, [entries, embedQ.data, q.data])
  const image = coverOverride ?? sp.pickImage(q.data?.playlist.images, 640)
  usePagePalette(image)

  const refresh = useCallback(
    (opts?: { cover?: string }) => {
      if (opts?.cover) setCoverOverride(opts.cover)
      invalidate(key)
      q.reload()
      void useApp.getState().refreshPlaylists()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, q.reload]
  )

  /** Moves a song locally right away, then saves the move to Spotify in order. */
  const reorder = useCallback(
    (from: number, to: number) => {
      const list = q.data?.entries
      if (!list) return
      const realFrom = list[from].pos
      const insertBefore = to > from ? list[to].pos + 1 : list[to].pos
      const moved = moveItem(list, from, to).map((e) => ({ ...e, pos: shiftPos(e.pos, realFrom, insertBefore) }))
      q.setData((d) => (d ? { ...d, entries: moved } : d))
      saving.current = saving.current.then(async () => {
        try {
          await sp.movePlaylistItem(id, realFrom, insertBefore)
        } catch (e) {
          toast(`Could not save the new order: ${errorText(e)}`, 'error')
          refresh()
        }
      })
    },
    [q, id, toast, refresh]
  )

  // the Pulse badge next to the owner's name
  const ownerId = q.data?.playlist.owner.id
  const ownerPulse = usePulseUsers(ownerId && ownerId !== me?.id ? [ownerId] : []).size > 0
  if (q.error) return <ErrorState text={q.error} onRetry={q.reload} />
  if (!q.data) return <HeaderSkeleton />
  const base = q.data.playlist
  const playlist = live ? { ...base, name: live.name, description: live.description } : base
  const owned = playlist.owner.id === me?.id
  const editable = owned || playlist.collaborative
  const total = tracks?.reduce((n, t) => n + t.duration_ms, 0) ?? 0
  const openTools = (tab: ToolTab): void => setTools({ open: true, tab })

  const more = (e: React.MouseEvent): void => {
    const r = e.currentTarget.getBoundingClientRect()
    openMenu(r.left, r.bottom + 6, [
      ...(editable && entries
        ? [
            { label: 'Remove duplicates', onSelect: () => openTools('clean') },
            { label: 'Sort playlist', onSelect: () => openTools('sort') },
            { label: 'Merge another playlist in', onSelect: () => openTools('merge') },
            ...(owned ? [{ label: 'Change cover', onSelect: () => openTools('cover') }] : []),
            { label: '', separator: true }
          ]
        : []),
      ...(owned
        ? [
            { label: 'Edit details', onSelect: () => setModal({ type: 'edit-playlist', playlist }) },
            { label: 'Delete playlist', danger: true, onSelect: () => setModal({ type: 'delete-playlist', playlist }) }
          ]
        : [
            {
              label: 'Remove from library',
              danger: true,
              onSelect: async () => {
                await sp.deletePlaylist(playlist.id).catch(() => {})
                void useApp.getState().refreshPlaylists()
                useApp.getState().toast('Removed from your library')
              }
            }
          ]),
      { label: '', separator: true },
      ...contextMenuFor('playlist', playlist.uri, playlist.name).slice(3)
    ])
  }

  return (
    <div className="collection">
      <PageHeader
        image={image}
        onArtClick={owned ? () => openTools('cover') : undefined}
        kind={playlist.public === false ? 'Private playlist' : 'Playlist'}
        title={playlist.name}
        description={cleanDescription(playlist.description)}
        meta={
          <>
            {playlist.owner.id && playlist.owner.id !== 'spotify' ? (
              <strong className="link" onClick={() => navigate({ name: 'user', id: playlist.owner.id })} onMouseEnter={() => prefetchUser(playlist.owner.id)}>
                {playlist.owner.display_name ?? playlist.owner.id}
                {ownerPulse && <PulseBadge small />}
              </strong>
            ) : (
              <strong>{playlist.owner.display_name ?? 'Spotify'}</strong>
            )}
            {tracks && <span>{plural(tracks.length, 'song')}</span>}
            {tracks && total > 0 && <span>{formatDuration(total)}</span>}
          </>
        }
        actions={
          <PlayActions
            contextUri={playlist.uri}
            disabled={tracks?.length === 0}
            uris={tracks?.map((t) => t.uri)}
            extra={
              <>
                {editable && entries && (
                  <button className="icon-btn icon-btn--lg" aria-label="Playlist tools" title="Playlist tools" onClick={() => openTools('clean')}>
                    <ToolsIcon size={20} />
                  </button>
                )}
                {owned && (
                  <button className="icon-btn icon-btn--lg" aria-label="Edit details" title="Edit details" onClick={() => setModal({ type: 'edit-playlist', playlist })}>
                    <EditIcon size={20} />
                  </button>
                )}
                {owned && (
                  <button className="icon-btn icon-btn--lg" aria-label="Delete playlist" title="Delete playlist" onClick={() => setModal({ type: 'delete-playlist', playlist })}>
                    <TrashIcon size={20} />
                  </button>
                )}
                <button className="icon-btn icon-btn--lg" aria-label="More options" onClick={more}>
                  <MoreIcon size={22} />
                </button>
              </>
            }
          />
        }
      />
      {tracks === null ? (
        embedQ.data === undefined && !embedQ.error && entries === null ? (
          <Skeleton rows={8} />
        ) : (
          <div className="notice">
            <p>Spotify didn’t share this playlist’s songs. You can still play it.</p>
          </div>
        )
      ) : tracks.length === 0 ? (
        <ErrorState text={editable ? 'This playlist is empty. Right-click any song and choose Add to playlist.' : 'This playlist is empty.'} />
      ) : (
        <TrackList
          tracks={tracks}
          playlistId={editable ? playlist.id : undefined}
          onReorder={editable ? reorder : undefined}
          onRemoved={(t) => {
            q.setData((d) => (d ? { ...d, entries: d.entries?.filter((x) => x.track.uri !== t.uri) ?? null } : d))
            // Positions shift after a removal; reload them before the next reorder.
            window.setTimeout(() => refresh(), 600)
          }}
          onPlay={(i) => void playContext(playlist.uri, tracks[i].uri)}
        />
      )}
      {editable && tracks && tracks.length > 0 && (
        <Recommendations
          playlistId={playlist.id}
          tracks={tracks}
          onAdded={(t) => {
            q.setData((d) =>
              d
                ? {
                    ...d,
                    entries: [...(d.entries ?? []), { track: t, addedAt: new Date().toISOString(), pos: (d.entries?.length ?? 0) + d.hidden }]
                  }
                : d
            )
            window.setTimeout(() => refresh(), 800)
          }}
        />
      )}
      {editable && entries && (
        <PlaylistTools
          open={tools.open}
          initialTab={tools.tab}
          playlist={{ ...playlist, images: image ? [{ url: image, width: 640, height: 640 }] : playlist.images }}
          entries={entries}
          hidden={q.data.hidden}
          onClose={() => setTools((t) => ({ ...t, open: false }))}
          onChanged={refresh}
        />
      )}
    </div>
  )
}

/* ---------- Liked Songs ---------- */

export function LikedView(): React.JSX.Element {
  const me = useApp((s) => s.me)
  const version = useApp((s) => s.likedVersion)
  const [tracks, setTracks] = useState<STrack[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loading = useRef(false)
  const sentinel = useRef<HTMLDivElement>(null)

  const loadMore = useMemo(
    () =>
      async (reset = false): Promise<void> => {
        if (loading.current) return
        loading.current = true
        try {
          const offset = reset ? 0 : tracks.length
          const page = await sp.getSavedTracks(offset)
          setTotal(page.total)
          setTracks((prev) => [...(reset ? [] : prev), ...page.items.map((i) => i.track)])
          setError(null)
        } catch (e) {
          setError(errorText(e))
        } finally {
          loading.current = false
        }
      },
    [tracks.length]
  )

  useEffect(() => {
    void loadMore(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version])

  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && total !== null && tracks.length < total) void loadMore()
    })
    io.observe(el)
    return () => io.disconnect()
  }, [loadMore, total, tracks.length])

  const contextUri = me ? `spotify:user:${me.id}:collection` : ''

  return (
    <div className="collection">
      <PageHeader
        image={null}
        artNode={
          <div className="liked-art liked-art--big">
            <HeartIcon size={84} filled />
          </div>
        }
        kind="Playlist"
        title="Liked Songs"
        meta={
          <>
            <strong>{me?.display_name}</strong>
            {total !== null && <span>{plural(total, 'song')}</span>}
          </>
        }
        actions={<PlayActions contextUri={contextUri} disabled={!total} uris={tracks.map((t) => t.uri)} />}
      />
      {error && <ErrorState text={error} onRetry={() => void loadMore(true)} />}
      {total === null && !error ? (
        <Skeleton rows={12} />
      ) : total === 0 ? (
        <ErrorState text="Songs you like will show up here. Tap the heart on any song." />
      ) : (
        <TrackList tracks={tracks} onPlay={(i) => void playContext(contextUri, tracks[i].uri)} />
      )}
      <div ref={sentinel} style={{ height: 1 }} />
    </div>
  )
}
