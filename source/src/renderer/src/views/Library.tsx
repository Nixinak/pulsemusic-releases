import { useMemo } from 'react'
import { motion } from 'motion/react'
import { isOwnPlaylist, useApp, type LibraryTab } from '@/lib/store'
import type { SPlaylist } from '@/lib/types'
import { useQuery } from '@/lib/useQuery'
import * as sp from '@/lib/spotify'
import { prefetchAlbum, prefetchArtist } from '@/lib/loaders'
import { playContext } from '@/lib/player'
import { ErrorState, MediaCard, Skeleton } from '@/components/common'
import { contextMenuFor } from '@/components/menus'
import { Glass } from '@/components/Glass'
import { HeartIcon, PlusIcon } from '@/components/Icons'

const TABS: { id: LibraryTab; label: string }[] = [
  { id: 'playlists', label: 'Playlists' },
  { id: 'albums', label: 'Albums' },
  { id: 'artists', label: 'Artists' }
]

export function Library({ tab = 'playlists' }: { tab?: LibraryTab }): React.JSX.Element {
  const navigate = useApp((s) => s.navigate)
  const playlists = useApp((s) => s.playlists)
  const me = useApp((s) => s.me)
  const setModal = useApp((s) => s.setModal)
  const openMenu = useApp((s) => s.openMenu)
  const loaded = useApp((s) => s.playlistsLoaded)
  const loadError = useApp((s) => s.playlistsError)
  const refreshPlaylists = useApp((s) => s.refreshPlaylists)
  const own = useMemo(() => playlists.filter((p) => isOwnPlaylist(p, me?.id)), [playlists, me])
  const saved = useMemo(() => playlists.filter((p) => !isOwnPlaylist(p, me?.id)), [playlists, me])
  const card = (p: SPlaylist): React.JSX.Element => (
    <MediaCard
      key={p.id}
      image={sp.pickImage(p.images, 300)}
      title={p.name}
      subtitle={isOwnPlaylist(p, me?.id) ? sp.playlistSongs(p) : `By ${p.owner.display_name ?? 'Spotify'}`}
      onOpen={() => navigate({ name: 'playlist', id: p.id })}
      onPlay={() => void playContext(p.uri)}
      onContextMenu={(e) => {
        e.preventDefault()
        openMenu(e.clientX, e.clientY, contextMenuFor('playlist', p.uri, p.name))
      }}
    />
  )
  const albums = useQuery(tab === 'albums' ? 'lib:albums' : null, sp.getSavedAlbums)
  const artists = useQuery(tab === 'artists' ? 'lib:artists' : null, sp.getFollowedArtists)

  return (
    <div className="library">
      <div className="library__head">
        <h1 className="page-title">Library</h1>
        <Glass radius={999} bezel={10} refraction={28} className="segmented">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`segmented__btn ${tab === t.id ? 'is-on' : ''}`}
              onClick={() => navigate({ name: 'library', tab: t.id })}
            >
              {tab === t.id && <motion.span layoutId="seg-lib" className="segmented__thumb" transition={{ type: 'spring', stiffness: 500, damping: 36 }} />}
              <span>{t.label}</span>
            </button>
          ))}
        </Glass>
      </div>

      {tab === 'playlists' && (
        <>
          <h2 className="library__h">Your playlists {own.length > 0 && <span className="shelf__count">{own.length}</span>}</h2>
          <div className="grid">
            <div className="card" role="button" tabIndex={0} onClick={() => navigate({ name: 'liked' })}>
              <div className="card__art">
                <div className="liked-art">
                  <HeartIcon size={42} filled />
                </div>
              </div>
              <div className="card__title">Liked Songs</div>
              <div className="card__sub">Your saved songs</div>
            </div>
            <div className="card" role="button" tabIndex={0} onClick={() => setModal({ type: 'create-playlist' })}>
              <div className="card__art">
                <div className="new-art">
                  <PlusIcon size={40} />
                </div>
              </div>
              <div className="card__title">New playlist</div>
              <div className="card__sub">Start from scratch</div>
            </div>
            {own.map(card)}
          </div>
          {!loaded && !playlists.length && (loadError ? <ErrorState text={`Couldn’t load your playlists: ${loadError}`} onRetry={() => void refreshPlaylists()} /> : <Skeleton rows={2} />)}

          {saved.length > 0 && (
            <>
              <h2 className="library__h">
                Saved playlists <span className="shelf__count">{saved.length}</span>
              </h2>
              <div className="grid">{saved.map(card)}</div>
            </>
          )}
        </>
      )}

      {tab === 'albums' &&
        (albums.error ? (
          <ErrorState text={albums.error} onRetry={albums.reload} />
        ) : !albums.data ? (
          <Skeleton />
        ) : albums.data.length === 0 ? (
          <ErrorState text="Albums you save will show up here." />
        ) : (
          <div className="grid">
            {albums.data.map(({ album: a }) => (
              <MediaCard
                key={a.id}
                image={sp.pickImage(a.images, 300)}
                title={a.name}
                subtitle={a.artists.map((x) => x.name).join(', ')}
                onOpen={() => navigate({ name: 'album', id: a.id })}
                onPrefetch={() => prefetchAlbum(a.id)}
                onPlay={() => void playContext(a.uri)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  openMenu(e.clientX, e.clientY, contextMenuFor('album', a.uri, a.name))
                }}
              />
            ))}
          </div>
        ))}

      {tab === 'artists' &&
        (artists.error ? (
          <ErrorState text={artists.error} onRetry={artists.reload} />
        ) : !artists.data ? (
          <Skeleton />
        ) : artists.data.length === 0 ? (
          <ErrorState text="Artists you follow will show up here." />
        ) : (
          <div className="grid">
            {artists.data.map((a) => (
              <MediaCard
                key={a.id}
                round
                artistId={a.id}
                image={sp.pickImage(a.images, 300)}
                title={a.name}
                onOpen={() => navigate({ name: 'artist', id: a.id })}
              onPrefetch={() => prefetchArtist(a.id, a.name)}
                onPlay={() => void playContext(a.uri)}
              />
            ))}
          </div>
        ))}
    </div>
  )
}
