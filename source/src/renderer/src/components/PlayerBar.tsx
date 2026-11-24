import { motion } from 'motion/react'
import { Emo } from '@/components/Emoji'
import { usePlayer } from '@/lib/player'
import { useApp } from '@/lib/store'
import { Glass } from './Glass'
import { ArtistLinks, SwapArt, SwapText } from './common'
import { useDj } from '@/lib/dj'
import { DevicePicker, Progress, RemoteBadge, SleepTimer, Transport, Volume } from './PlayerControls'
import { LyricsIcon, MiniIcon, QueueIcon } from './Icons'
import { LikeButton } from './LikeButton'

export function PlayerBar(): React.JSX.Element {
  const track = usePlayer((s) => s.track)
  const lyricsOpen = useApp((s) => s.lyricsOpen)
  const setLyricsOpen = useApp((s) => s.setLyricsOpen)
  const liked = usePlayer((s) => s.liked)
  const sdkError = usePlayer((s) => s.sdkError)
  const nowPlaying = useApp((s) => s.nowPlaying)
  const setNowPlaying = useApp((s) => s.setNowPlaying)
  const queueOpen = useApp((s) => s.queueOpen)
  const setQueueOpen = useApp((s) => s.setQueueOpen)
  const navigate = useApp((s) => s.navigate)

  return (
    <div className="playerbar-wrap">
      <Glass className="playerbar" radius={26} bezel={22} refraction={64} blur={12} tone="regular">
        <div className="playerbar__now">
          {track ? (
            <>
              <button className="playerbar__art" onClick={() => setNowPlaying(true)} aria-label="Open Now Playing">
                {!nowPlaying && (
                  <motion.div layoutId="np-art" className="playerbar__art-inner" transition={{ type: 'spring', stiffness: 300, damping: 34 }}>
                    <SwapArt id={track.id} src={track.artUrl} radius={10} />
                  </motion.div>
                )}
              </button>
              <SwapText id={track.id} className="playerbar__meta">
                <span className="playerbar__title link" onClick={() => track.album.id && navigate({ name: 'album', id: track.album.id })}>
                  <Emo>{track.name}</Emo>
                </span>
                <span className="playerbar__artists">
                  <ArtistLinks artists={track.artists} onOpen={(id) => navigate({ name: 'artist', id })} />
                </span>
                <RemoteBadge />
                <DjBadge />
              </SwapText>
              <LikeButton liked={liked} size={20} />
            </>
          ) : (
            <div className="playerbar__idle">{sdkError ?? 'Pick something to play.'}</div>
          )}
        </div>

        <div className="playerbar__center">
          <Transport />
          <Progress />
        </div>

        <div className="playerbar__side">
          <button className="icon-btn" aria-label="Lyrics" aria-pressed={lyricsOpen} disabled={!track} onClick={() => setLyricsOpen(!lyricsOpen)}>
            <LyricsIcon size={19} />
          </button>
          <button className="icon-btn" aria-label="Queue" aria-pressed={queueOpen} onClick={() => setQueueOpen(!queueOpen)}>
            <QueueIcon size={19} />
          </button>
          <SleepTimer />
          <DevicePicker />
          <Volume />
          <button className="icon-btn" aria-label="Mini player" onClick={() => window.pulse.window.toggleMini()}>
            <MiniIcon size={19} />
          </button>
        </div>
      </Glass>
    </div>
  )
}

/** Shows that the AI DJ is running; opens the DJ page. */
function DjBadge(): React.JSX.Element | null {
  const active = useDj((s) => s.active)
  const status = useDj((s) => s.status)
  const navigate = useApp((s) => s.navigate)
  if (!active) return null
  return (
    <button className={`dj-badge dj-badge--${status}`} onClick={() => navigate({ name: 'dj' })}>
      <i />
      {status === 'speaking' ? 'DJ on air' : status === 'thinking' ? 'DJ is picking' : 'DJ mode'}
    </button>
  )
}
