import { useEffect, useRef, useState } from 'react'
import { useDrift } from '@/lib/drift'
import { Emo } from '@/components/Emoji'
import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { usePlayer } from '@/lib/player'
import { useApp } from '@/lib/store'
import { Glass } from './Glass'
import { ArtistLinks, SwapArt } from './common'
import { suspendPagePalette } from '@/lib/colors'
import { DevicePicker, Progress, RemoteBadge, Transport, Volume } from './PlayerControls'
import { Lyrics } from './Lyrics'
import { CrossfadeImage } from './CrossfadeImage'
import { QueueList } from './QueueList'
import { ChevronDown, CoverIcon, LyricsIcon, QueueIcon } from './Icons'
import { LikeButton } from './LikeButton'
import { TransitionStage } from './TransitionCard'
import { useTransition } from '@/lib/transition'
import type { NpPanel } from '@/lib/store'
import type { NpTheme } from '@shared/types'
import { CdDeck, NpEdgeMenu, Turntable } from './NpThemes'

const TABS: { id: NpPanel; label: string; Icon: typeof LyricsIcon }[] = [
  { id: 'lyrics', label: 'Lyrics', Icon: LyricsIcon },
  { id: 'queue', label: 'Queue', Icon: QueueIcon },
  { id: 'none', label: 'Cover', Icon: CoverIcon }
]

const spring = { type: 'spring' as const, stiffness: 300, damping: 34 }

export function NowPlaying(): React.JSX.Element {
  const open = useApp((s) => s.nowPlaying)
  const setOpen = useApp((s) => s.setNowPlaying)
  const panel = useApp((s) => s.npPanel)
  const setPanel = useApp((s) => s.setNpPanel)
  const navigate = useApp((s) => s.navigate)
  const track = usePlayer((s) => s.track)
  const liked = usePlayer((s) => s.liked)
  const paused = usePlayer((s) => s.paused)
  // During a song transition the lyrics/queue step aside for the two covers.
  const transitioning = useTransition((s) => s.phase.kind !== 'idle')
  const showStage = transitioning && (panel === 'lyrics' || panel === 'queue')
  const theme: NpTheme = useApp((s) => s.settings.npTheme) ?? 'classic'
  const wantFull = useApp((s) => !!s.settings.npFullscreen)
  const updateSettings = useApp((s) => s.updateSettings)
  const [isFull, setIsFull] = useState(false)

  // Full screen (over the taskbar) is remembered: Now Playing opens that way next time, and the
  // window goes back to normal when Now Playing closes.
  const shown = open && !!track
  useEffect(() => {
    if (!shown || !wantFull) return
    void window.pulse.window.setFullScreen(true).then(setIsFull)
    return () => {
      void window.pulse.window.setFullScreen(false).then(() => setIsFull(false))
    }
  }, [shown, wantFull])
  // left some other way (Windows, a shortcut): remembered as off
  useEffect(
    () =>
      window.pulse.window.onFullScreen((on) => {
        setIsFull(on)
        if (!on && useApp.getState().nowPlaying && useApp.getState().settings.npFullscreen) void updateSettings({ npFullscreen: false })
      }),
    [updateSettings]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setOpen])

  // Now Playing always shows the song's colours, even over a themed artist/album page.
  useEffect(() => {
    suspendPagePalette(open)
    return () => suspendPagePalette(false)
  }, [open])

  useEffect(() => {
    if (!track && open) setOpen(false)
  }, [track, open, setOpen])

  return (
    <AnimatePresence>
      {open && track && (
        <motion.div
          className={`np np--${theme}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.28 } }}
          transition={{ duration: 0.4 }}
        >
          <div className="np__bg" aria-hidden="true">
            <NpBackdrop art={track.artUrl} />
            <div className="np__bg-shade" />
          </div>

          <header className="np__top">
            <Glass radius={999} bezel={10} refraction={30} className="np__pill">
              <button className="icon-btn" aria-label="Close Now Playing" onClick={() => setOpen(false)}>
                <ChevronDown size={22} />
              </button>
            </Glass>
            <Glass radius={999} bezel={10} refraction={30} className="np__pill np__tabs">
              {TABS.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  className={`np__tab ${panel === id ? 'is-on' : ''}`}
                  aria-pressed={panel === id}
                  // Clicking the open tab again hides the panel and centres the cover.
                  onClick={() => setPanel(panel === id && id !== 'none' ? 'none' : id)}
                >
                  {panel === id && <motion.span layoutId="np-tab" className="np__tab-bg" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
                  <Icon size={17} />
                  <span>{label}</span>
                </button>
              ))}
            </Glass>
          </header>

          <LayoutGroup>
          <div className={`np__body ${panel === 'none' ? 'np__body--solo' : ''}`}>
            <section className="np__left">
              {theme === 'vinyl' ? (
                <motion.div layoutId="np-art" className="np__deck" transition={spring}>
                  <Turntable art={track.artUrl} paused={paused} />
                </motion.div>
              ) : theme === 'cd' ? (
                <motion.div layoutId="np-art" className="np__deck" transition={spring}>
                  <CdDeck
                    art={track.artUrl}
                    paused={paused}
                    title={track.name}
                    artist={track.artists.map((a) => a.name).join(', ')}
                    durationMs={track.durationMs}
                  />
                </motion.div>
              ) : (
                <motion.div layoutId="np-art" className={`np__art ${paused ? 'is-paused' : ''}`} transition={spring}>
                  <SwapArt id={track.id} src={track.artUrl} radius={theme === 'cover' ? 12 : 22} />
                </motion.div>
              )}

              <motion.div
                layout="position"
                className="np__info"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...spring, delay: 0.08 }}
              >
                {(theme === 'vinyl' || theme === 'cd') && <small className="np__eyebrow">Now playing</small>}
                <div className="np__titles">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={track.id}
                      initial={{ opacity: 0, x: 18 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -18 }}
                      transition={{ duration: 0.25 }}
                    >
                      <h1 className="np__title link" onClick={() => track.album.id && navigate({ name: 'album', id: track.album.id })}>
                        <Emo>{track.name}</Emo>
                      </h1>
                      <div className="np__artist">
                        <ArtistLinks artists={track.artists} onOpen={(id) => navigate({ name: 'artist', id })} />
                      </div>
                    </motion.div>
                  </AnimatePresence>
                  <LikeButton liked={liked} size={24} variant="np" />
                </div>
                <Progress className="progress--np" />
                <Transport big />
                <div className="np__extras">
                  <Volume />
                  <DevicePicker />
                </div>
                <RemoteBadge />
              </motion.div>
            </section>

            {/* popLayout takes the leaving panel out of the layout at once, so the cover
                glides to the centre while the panel fades, instead of jumping afterwards. */}
            <AnimatePresence mode="popLayout">
              {panel !== 'none' && (
                <motion.section
                  key={showStage ? 'stage' : panel}
                  className="np__right"
                  initial={{ opacity: 0, x: 40, filter: 'blur(8px)' }}
                  animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, x: 60, filter: 'blur(10px)', transition: { duration: 0.35 } }}
                  transition={spring}
                >
                  {showStage ? (
                    <TransitionStage big />
                  ) : panel === 'lyrics' ? (
                    <Lyrics track={track} />
                  ) : (
                    <Glass radius={26} tone="clear" simple className="np__queue" data-own-scroll>
                      <QueueList onClose={() => setPanel('none')} />
                    </Glass>
                  )}
                </motion.section>
              )}
            </AnimatePresence>
          </div>
          </LayoutGroup>

          <NpEdgeMenu
            theme={theme}
            full={isFull}
            onTheme={(t) => void updateSettings({ npTheme: t })}
            onFull={() => {
              const next = !isFull
              void updateSettings({ npFullscreen: next })
              void window.pulse.window.setFullScreen(next).then(setIsFull)
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** The moving backdrop behind Now Playing: the artwork turning slowly under drifting colour.
 *  Driven by lib/drift at a low frame rate, so the glass on top isn't redrawn every frame. */
function NpBackdrop({ art }: { art: string | null }): React.JSX.Element {
  const rot = useRef<HTMLDivElement>(null)
  const a = useRef<HTMLDivElement>(null)
  const b = useRef<HTMLDivElement>(null)
  const c = useRef<HTMLDivElement>(null)
  useDrift(rot, { seconds: 90, spin: true })
  useDrift(a, { to: [14, 10, 1.15], seconds: 26 })
  useDrift(b, { to: [-16, 14, 0.9], seconds: 32 })
  useDrift(c, { to: [12, -16, 1.2], seconds: 40 })
  return (
    <>
      <div ref={rot} className="np__bg-rot">
        <CrossfadeImage src={art} className="np__bg-art" duration={1.4} soft={{ blur: 90, saturate: 1.6 }} />
      </div>
      <div ref={a} className="np__bg-blob np__bg-blob--1" />
      <div ref={b} className="np__bg-blob np__bg-blob--2" />
      <div ref={c} className="np__bg-blob np__bg-blob--3" />
    </>
  )
}
