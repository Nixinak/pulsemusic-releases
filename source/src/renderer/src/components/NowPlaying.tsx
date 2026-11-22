import { useCallback, useEffect, useRef, useState } from 'react'
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
import { NpEdgeMenu } from './NpThemes'
import { WordsLyrics } from './NpMessages'
import { Turntable } from './NpDevices'
import { useNpSounds } from '@/lib/npSounds'
import { getLyrics, prefetchLyrics } from '@/lib/lyrics'

const TABS: { id: NpPanel; label: string; Icon: typeof LyricsIcon }[] = [
  { id: 'lyrics', label: 'Lyrics', Icon: LyricsIcon },
  { id: 'queue', label: 'Queue', Icon: QueueIcon },
  { id: 'none', label: 'Cover', Icon: CoverIcon }
]

const spring = { type: 'spring' as const, stiffness: 300, damping: 34 }

/** True after the mouse and keyboard have rested for a moment (only while `active`). */
function useIdle(active: boolean, ms = 2600): boolean {
  const [idle, setIdle] = useState(false)
  useEffect(() => {
    if (!active) {
      setIdle(false)
      return
    }
    let t = window.setTimeout(() => setIdle(true), ms)
    const wake = (): void => {
      setIdle(false)
      window.clearTimeout(t)
      t = window.setTimeout(() => setIdle(true), ms)
    }
    window.addEventListener('mousemove', wake)
    window.addEventListener('keydown', wake)
    window.addEventListener('mousedown', wake)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('mousemove', wake)
      window.removeEventListener('keydown', wake)
      window.removeEventListener('mousedown', wake)
    }
  }, [active, ms])
  return idle
}

export function NowPlaying(): React.JSX.Element {
  const open = useApp((s) => s.nowPlaying)
  const setOpen = useApp((s) => s.setNowPlaying)
  const chosen = useApp((s) => s.npPanel)
  const setPanel = useApp((s) => s.setNpPanel)
  const navigate = useApp((s) => s.navigate)
  const track = usePlayer((s) => s.track)
  // A song without lyrics shows the cover instead; the next song with lyrics brings them back
  // (Lyrics stays the chosen tab, only what's shown changes). Asking for them on purpose (the
  // Lyrics tab) shows the "no lyrics" note for that song.
  // What is shown while the next song's lyrics are still being looked up stays as it was:
  // after a song without lyrics the cover stays until lyrics are really there.
  const [coverNow, setCoverNow] = useState(false)
  const [askedFor, setAskedFor] = useState<string | null>(null)
  useEffect(() => {
    if (chosen !== 'lyrics' || !track) return
    let alive = true
    void getLyrics({
      id: track.id,
      name: track.name,
      artists: track.artists.map((a) => a.name),
      album: track.album.name,
      durationMs: track.durationMs
    }).then((d) => {
      if (alive) setCoverNow(d.kind === 'none' || d.kind === 'instrumental')
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen, track?.id])
  // the next song's lyrics are fetched ahead, so they are there the moment it starts
  const upcoming = usePlayer((s) => s.upNext[0] ?? s.nextUp)
  useEffect(() => {
    if (!open || !upcoming) return
    prefetchLyrics({
      id: upcoming.id,
      name: upcoming.name,
      artists: upcoming.artists.split(', ')
    })
  }, [open, upcoming?.id])
  const autoOn = useApp((s) => s.settings.npAutoCover !== false)
  const autoCover = autoOn && chosen === 'lyrics' && !!track && coverNow && askedFor !== track.id
  const panel: NpPanel = autoCover ? 'none' : chosen
  const liked = usePlayer((s) => s.liked)
  const paused = usePlayer((s) => s.paused)
  // During a song transition the lyrics/queue step aside for the two covers.
  const transitioning = useTransition((s) => s.phase.kind !== 'idle')
  const showStage = transitioning && (panel === 'lyrics' || panel === 'queue')
  // "Album cover" is the base look ("Classic" was folded into it)
  const savedTheme = useApp((s) => s.settings.npTheme)
  // looks that were removed (or never set) show the cover
  const theme: NpTheme = savedTheme === 'vinyl' || savedTheme === 'messages' ? savedTheme : 'cover'
  // In the Messages look the chat is the lyrics, so the Lyrics tab doesn't open a second copy beside it.
  const side = theme === 'messages' && panel === 'lyrics' ? 'none' : panel
  const wantFull = useApp((s) => !!s.settings.npFullscreen)
  const updateSettings = useApp((s) => s.updateSettings)
  const scratch = useApp((s) => s.settings.npScratch) ?? true
  useNpSounds(theme, open && !!track, true)
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
  const closing = useRef(false)
  useEffect(
    () =>
      window.pulse.window.onFullScreen((on) => {
        setIsFull(on)
        if (!on && !closing.current && useApp.getState().nowPlaying && useApp.getState().settings.npFullscreen) void updateSettings({ npFullscreen: false })
      }),
    [updateSettings]
  )

  // Closing from full screen: the window first goes back to its size while Now Playing still
  // covers it, then Now Playing fades out over the app, already laid out at its normal size
  // (closing first showed the app stretched over the whole screen and then jumping).
  const isFullRef = useRef(isFull)
  isFullRef.current = isFull
  const close = useCallback((): void => {
    if (closing.current) return
    if (!isFullRef.current) return setOpen(false)
    closing.current = true
    void window.pulse.window
      .setFullScreen(false)
      .catch(() => {})
      .then(() => {
        // two frames, so the page has its new size before the fade starts
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            closing.current = false
            setOpen(false)
          })
        )
      })
  }, [setOpen])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  // Now Playing always shows the song's colours, even over a themed artist/album page.
  useEffect(() => {
    suspendPagePalette(open)
    return () => suspendPagePalette(false)
  }, [open])

  useEffect(() => {
    if (!track && open) setOpen(false)
  }, [track, open, setOpen])

  // in the Words look everything but the words fades away while the mouse rests
  const idle = useIdle(open && theme === 'messages' && !paused)

  return (
    <AnimatePresence>
      {open && track && (
        <motion.div
          className={`np np--${theme} ${side !== 'none' ? 'np--panel' : ''} ${idle ? 'np--idle' : ''}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.28 } }}
          transition={{ duration: 0.4 }}
        >
          <div className="np__bg" aria-hidden="true">
            <NpBackdrop art={track.artUrl} />
            <div className="np__bg-shade" />
          </div>
          {/* the Words look fills the whole window, under the buttons at the top too */}
          {theme === 'messages' && (
            <div className="np__words">
              <WordsLyrics track={track} />
            </div>
          )}

          <header className="np__top">
            <Glass radius={999} bezel={10} refraction={30} className="np__pill">
              <button className="icon-btn" aria-label="Close Now Playing" onClick={close}>
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
                  onClick={() => {
                    if (id === 'lyrics' && autoCover) return setAskedFor(track.id)
                    setAskedFor(null)
                    setPanel(panel === id && id !== 'none' ? 'none' : id)
                  }}
                >
                  {panel === id && (
                    <motion.span
                      layoutId="np-tab"
                      className="np__tab-bg"
                      transition={{
                        type: 'spring',
                        stiffness: 500,
                        damping: 38
                      }}
                    />
                  )}
                  <Icon size={17} />
                  <span>{label}</span>
                </button>
              ))}
            </Glass>
          </header>

          {/* another look: the old one fades out softly and the new one settles in (each look in its
              own layout group, so nothing morphs from a turntable into a poster) */}
          <AnimatePresence mode="wait" initial={false}>
            <LayoutGroup id={theme} key={theme}>
              <motion.div
                className={`np__body ${side === 'none' ? 'np__body--solo' : ''}`}
                initial={{ opacity: 0, scale: 0.965, filter: 'blur(14px)' }}
                animate={{
                  opacity: 1,
                  scale: 1,
                  filter: 'blur(0px)',
                  transition: { duration: 0.42, ease: [0.22, 1, 0.36, 1] }
                }}
                exit={{
                  opacity: 0,
                  scale: 1.02,
                  filter: 'blur(10px)',
                  transition: { duration: 0.2, ease: [0.4, 0, 1, 1] }
                }}
              >
                <section className="np__left">
                  {theme === 'vinyl' ? (
                    <motion.div layoutId="np-art" className="np__deck" transition={spring}>
                      <Turntable art={track.artUrl} paused={paused} />
                    </motion.div>
                  ) : theme === 'messages' ? null : (
                    <motion.div layoutId="np-art" className={`np__art ${paused ? 'is-paused' : ''}`} transition={spring}>
                      <SwapArt id={track.id} src={track.artUrl} radius={12} />
                    </motion.div>
                  )}

                  <motion.div
                    layout="position"
                    className="np__info"
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ ...spring, delay: 0.08 }}
                  >
                    {theme === 'vinyl' && <small className="np__eyebrow">Now playing</small>}
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
                  {side !== 'none' && (
                    <motion.section
                      key={showStage ? 'stage' : panel}
                      className="np__right"
                      initial={{ opacity: 0, x: 40, filter: 'blur(8px)' }}
                      animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                      exit={{
                        opacity: 0,
                        x: 60,
                        filter: 'blur(10px)',
                        transition: { duration: 0.35 }
                      }}
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
              </motion.div>
            </LayoutGroup>
          </AnimatePresence>

          <NpEdgeMenu
            theme={theme}
            art={track.artUrl}
            full={isFull}
            scratch={scratch}
            onScratch={(on) => void updateSettings({ npScratch: on })}
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
