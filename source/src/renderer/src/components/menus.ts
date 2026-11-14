// Context menu builders shared by track rows, cards and headers.
import * as sp from '@/lib/spotify'
import { addToQueue, playContext } from '@/lib/player'
import { editablePlaylists, errorText, useApp, type MenuItem } from '@/lib/store'
import { invalidate } from '@/lib/useQuery'
import type { STrack } from '@/lib/types'

export function addToPlaylistItems(uris: string[]): MenuItem[] {
  const app = useApp.getState()
  const lists = editablePlaylists(app)
  return [
    { label: 'New playlist…', onSelect: () => app.setModal({ type: 'create-playlist', addUris: uris }) },
    ...(lists.length ? [{ label: '', separator: true }] : []),
    ...lists.map((p) => ({
      label: p.name,
      onSelect: async () => {
        try {
          await sp.addToPlaylist(p.id, uris)
          invalidate(`playlist:${p.id}`)
          app.toast(`Added to ${p.name}`)
          void app.refreshPlaylists()
        } catch (e) {
          app.toast(errorText(e), 'error')
        }
      }
    }))
  ]
}

export function trackMenu(
  t: STrack,
  opts: { playlistId?: string; onRemoved?: () => void } = {}
): MenuItem[] {
  const app = useApp.getState()
  const items: MenuItem[] = [
    { label: 'Add to queue', onSelect: () => addToQueue(t) },
    { label: 'Add to playlist', submenu: addToPlaylistItems([t.uri]) },
    {
      label: 'Save to Liked Songs',
      onSelect: async () => {
        try {
          await sp.saveToLibrary([t.uri])
          app.bumpLiked()
          app.toast('Added to Liked Songs')
        } catch (e) {
          app.toast(errorText(e), 'error')
        }
      }
    },
    { label: '', separator: true }
  ]
  if (t.album?.id) items.push({ label: 'Go to album', onSelect: () => app.navigate({ name: 'album', id: t.album!.id }) })
  if (t.artists[0]?.id)
    items.push({ label: 'Go to artist', onSelect: () => app.navigate({ name: 'artist', id: t.artists[0].id }) })
  items.push({
    label: 'Copy song link',
    onSelect: () => {
      void navigator.clipboard.writeText(`https://open.spotify.com/track/${t.id}`)
      app.toast('Link copied')
    }
  })
  if (opts.playlistId) {
    const pid = opts.playlistId
    items.push(
      { label: '', separator: true },
      {
        label: 'Remove from this playlist',
        danger: true,
        onSelect: async () => {
          try {
            await sp.removeFromPlaylist(pid, [t.uri])
            invalidate(`playlist:${pid}`)
            opts.onRemoved?.()
            app.toast('Removed from playlist')
            void app.refreshPlaylists()
          } catch (e) {
            app.toast(errorText(e), 'error')
          }
        }
      }
    )
  }
  return items
}

export function contextMenuFor(kind: 'album' | 'playlist' | 'artist', uri: string, name: string): MenuItem[] {
  const app = useApp.getState()
  const id = sp.idFromUri(uri)
  return [
    { label: 'Play', onSelect: () => void playContext(uri) },
    { label: 'Shuffle play', onSelect: () => void playContext(uri, undefined, true) },
    { label: '', separator: true },
    { label: `Open ${kind}`, onSelect: () => app.navigate({ name: kind, id }) },
    {
      label: 'Copy link',
      onSelect: () => {
        void navigator.clipboard.writeText(`https://open.spotify.com/${kind}/${id}`)
        app.toast(`Link to ${name} copied`)
      }
    }
  ]
}
