// A playlist Pulse made for you (Daily Mix, Discover Weekly, Release Radar, On Repeat and the rest): its own
// cover, what's in it and when it's refreshed, play and shuffle, and Save as playlist to keep
// this week's (or today's) version in Spotify.
import { useState } from 'react'
import { coverNewPlaylist } from '@/lib/playlistCover'
import { useApp, errorText } from '@/lib/store'
import * as sp from '@/lib/spotify'
import { playUris } from '@/lib/player'
import { formatDuration, plural } from '@/lib/format'
import { isWeekly, useMadeForYou } from '@/lib/madeForYou'
import { ErrorState, usePagePalette } from '@/components/common'
import { TrackList } from '@/components/TrackList'
import { PageHeader } from './PageHeader'
import { PlayIcon, PlusIcon, ShuffleIcon } from '@/components/Icons'

export function MadeView({ id }: { id: string }): React.JSX.Element {
  const mix = useMadeForYou((s) => s.mixes.find((m) => m.id === id))
  const toast = useApp((s) => s.toast)
  const navigate = useApp((s) => s.navigate)
  const refreshPlaylists = useApp((s) => s.refreshPlaylists)
  const [saving, setSaving] = useState(false)
  usePagePalette(mix?.tracks[0] ? sp.pickImage(mix.tracks[0].album?.images, 300) : null)
  if (!mix) return <ErrorState text="This mix has been refreshed. Find the new one on Home." />

  const uris = mix.tracks.map((t) => t.uri)
  const total = mix.tracks.reduce((n, t) => n + t.duration_ms, 0)
  const weekly = isWeekly(mix.kind)
  const made = new Date(mix.madeAt)
  const today = new Date().toDateString() === made.toDateString()
  const when = weekly ? 'New every Monday' : today ? 'Updated today' : `Updated ${made.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const date = made.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
      const p = await sp.createPlaylist(`${mix.title}, ${date}`, mix.description)
      await sp.addManyToPlaylist(p.id, uris)
      await coverNewPlaylist(p.id, mix.tracks.map((t) => sp.pickImage(t.album?.images, 300)), mix.title)
      await refreshPlaylists()
      toast(`Saved ${mix.title}`)
      navigate({ name: 'playlist', id: p.id })
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  const shuffled = (): void => {
    const list = uris.slice()
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[list[i], list[j]] = [list[j], list[i]]
    }
    void playUris(list)
  }

  return (
    <div className="collection made">
      <PageHeader
        image={mix.cover || sp.pickImage(mix.tracks[0]?.album?.images, 300)}
        kind={mix.title === mix.label ? 'Made for you' : `${mix.label} · Made for you`}
        title={mix.title}
        description={mix.description}
        meta={
          <>
            <strong>Pulse</strong>
            <span>{plural(mix.tracks.length, 'song')}</span>
            <span>{formatDuration(total)}</span>
            <span>{when}</span>
          </>
        }
        actions={
          <>
            <button className="play-fab" aria-label="Play" onClick={() => void playUris(uris)}>
              <PlayIcon size={24} />
            </button>
            <button className="btn" onClick={shuffled}>
              <ShuffleIcon size={17} />
              Shuffle
            </button>
            <button className="btn" disabled={saving} onClick={() => void save()}>
              <PlusIcon size={17} /> {saving ? 'Saving…' : 'Save as playlist'}
            </button>
          </>
        }
      />
      <TrackList tracks={mix.tracks} onPlay={(i) => void playUris(uris, uris[i])} />
    </div>
  )
}
