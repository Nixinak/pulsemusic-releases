import { ImageCropLayer } from '@/components/ImageCropper'
import { useLayoutEffect, useEffect, useRef, useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { useApp, currentRoute, errorText, type Route } from '@/lib/store'
import { ApiError, clearRateLimit } from '@/lib/spotify'
import { pruneSaved } from '@/lib/persist'
import { disposePlayer, initPlayer, nextTrack, previousTrack, startPublishing, togglePlay, usePlayer } from '@/lib/player'
import { Ambient } from '@/components/Ambient'
import { WindowControls } from '@/components/WindowControls'
import { PRESETS, paletteFromColors, setChosenPalette } from '@/lib/colors'
import { TrackChangeFX } from '@/components/TrackChangeFX'
import { TransitionCard } from '@/components/TransitionCard'
import { useTransitionDriver } from '@/lib/transition'
import { Sidebar } from '@/components/Sidebar'
import { TopBar } from '@/components/TopBar'
import { PlayerBar } from '@/components/PlayerBar'
import { ListenerNotice, ListenWithBar } from '@/components/NowCard'
import { NowPlaying } from '@/components/NowPlaying'
import { ContextMenu, LyricsDrawer, Modals, QueueDrawer, RateLimitNotice, Toasts, UpdateNotice } from '@/components/Overlays'
import { Glass } from '@/components/Glass'
import { PageErrorBoundary, PageTransition, ScrollContext } from '@/components/common'
import { Home } from '@/views/Home'
import { Search } from '@/views/Search'
import { Library } from '@/views/Library'
import { AlbumView, LikedView, PlaylistView } from '@/views/Collections'
import { ArtistView } from '@/views/ArtistView'
import { SettingsView } from '@/views/SettingsView'
import { ProfileView } from '@/views/ProfileView'
import { FollowsView } from '@/views/FollowsView'
import { UserView } from '@/views/UserView'
import { FriendsView } from '@/views/FriendsView'
import { startProfileSync } from '@/lib/people'
import { startFriendsSync } from '@/lib/friends'
import { useProfile } from '@/lib/profile'
import { MiniPlayer } from '@/views/MiniPlayer'
import { StatsView } from '@/views/StatsView'
import { MixView } from '@/views/MixView'
import { PartyView } from '@/views/PartyView'
import { listenForJoins } from '@/lib/listenAlong'
import { resumeParty } from '@/lib/party'
import { DjView } from '@/views/DjView'
import { CommandPalette } from '@/components/CommandPalette'
import { RecapStories } from '@/components/Recap'
import { DjVoiceOverlay } from '@/components/DjVoice'
import { startHistory } from '@/lib/history'
import { startMadeForYou } from '@/lib/madeForYou'
import { MadeView } from '@/views/MadeView'
import { DiscoverView } from '@/views/DiscoverView'
import { restoreStartPage, startAppExtras } from '@/lib/appExtras'

function useTheme(): void {
  const settings = useApp((s) => s.settings)
  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('reduce-motion', settings.reduceMotion)
    root.dataset.glass = settings.glassQuality
    root.dataset.font = settings.font
    root.dataset.density = settings.density
    root.dataset.render = settings.renderMode ?? 'performance'
    const colors = settings.bgPalette === 'custom' ? settings.customColors : PRESETS.find((p) => p.id === settings.bgPalette)?.colors
    setChosenPalette(settings.bgPalette !== 'artwork' && colors ? paletteFromColors(colors) : null, settings.bgScope)
  }, [settings])
}

function routeKey(r: Route): string {
  return 'id' in r ? `${r.name}:${r.id}` : 'tab' in r ? `${r.name}:${r.tab ?? ''}` : r.name
}

function Page({ route, onSignOut }: { route: Route; onSignOut: () => void }): React.JSX.Element {
  switch (route.name) {
    case 'home':
      return <Home />
    case 'search':
      return <Search />
    case 'library':
      return <Library tab={route.tab} />
    case 'liked':
      return <LikedView />
    case 'album':
      return <AlbumView id={route.id} />
    case 'artist':
      return <ArtistView id={route.id} />
    case 'playlist':
      return <PlaylistView id={route.id} />
    case 'settings':
      return <SettingsView onSignOut={onSignOut} />
    case 'profile':
      return <ProfileView />
    case 'stats':
      return <StatsView />
    case 'mix':
      return <MixView />
    case 'discover':
      return <DiscoverView />
    case 'party':
      return <PartyView />
    case 'dj':
      return <DjView />
    case 'user':
      return <UserView id={route.id} />
    case 'friends':
      return <FriendsView />
    case 'follows':
      return <FollowsView id={route.id} kind={route.kind} />
    case 'made':
      return <MadeView id={route.id} />
  }
}

function Shell({ onSignOut }: { onSignOut: () => void }): React.JSX.Element {
  const route = useApp(currentRoute)
  const back = useApp((s) => s.back)
  const forward = useApp((s) => s.forward)
  const loadMe = useApp((s) => s.loadMe)
  const settings = useApp((s) => s.settings)
  const queueOpen = useApp((s) => s.queueOpen)
  const lyricsOpen = useApp((s) => s.lyricsOpen)
  const scroller = useRef<HTMLDivElement>(null)
  const started = useRef(false)
  useTransitionDriver()
  useEffect(() => startAppExtras(), [])

  useEffect(() => {
    if (started.current) return
    started.current = true
    // Spotify sometimes fails or limits requests right after start: keep trying, waiting longer each time.
    const tryLoad = (attempt: number): void => {
      loadMe().catch((e) => {
        // Spotify let them sign in but refuses this account: the app isn't open to it.
        // Back to the sign-in screen, which explains how to use their own Spotify app.
        if (e instanceof ApiError && e.status === 403) {
          try {
            sessionStorage.setItem('pulse-login-notice', 'not-allowed')
          } catch {
            /* the notice is skipped */
          }
          void window.pulse.auth.logout().then(() => window.location.reload())
          return
        }
        if (attempt >= 7) return useApp.getState().toast(errorText(e), 'error')
        window.setTimeout(() => tryLoad(attempt + 1), Math.min(30_000, 2500 * 2 ** attempt))
      })
    }
    tryLoad(0)
    void initPlayer(settings.volume)
    // Get the AI DJ's first set ready while the listener looks around.
    // the DJ gets its first set ready only when its page is opened (warming it up at every start,
    // right when an update restarts the app, sent a burst of searches)
    // First start on a new computer: fetch the DJ's voice (about 330 MB) in the background,
    // so nobody has to find the download button in Settings.
    window.setTimeout(() => {
      if (useApp.getState().settings.djVoice !== 'natural') return
      void window.pulse.dj.voiceStatus().then(async (v) => {
        if (v.installed) return
        useApp.getState().toast('Downloading the AI DJ’s voice in the background…')
        const ok = await window.pulse.dj.installVoice()
        useApp.getState().toast(ok ? 'The AI DJ’s voice is ready.' : 'The DJ voice didn’t download. You can retry in Settings → AI DJ.', ok ? 'info' : 'error')
      })
    }, 3000)
    // The DJ's brain too (about 2 GB; the installer normally brings it), when it's missing
    // after an update or an interrupted install.
    window.setTimeout(() => {
      if (useApp.getState().settings.djProvider !== 'local') return
      void window.pulse.dj.localReady().then(async (ready) => {
        if (ready) return
        useApp.getState().toast('Downloading the AI DJ in the background…')
        const ok = await window.pulse.dj.setupAi().catch(() => false)
        useApp.getState().toast(ok ? 'The AI DJ is ready.' : 'The AI DJ didn’t download. You can retry in Settings → AI DJ.', ok ? 'info' : 'error')
      })
    }, 15_000)
    void useProfile.getState().load()
    const stop = startPublishing()
    const stopProfileSync = startProfileSync()
    const stopFriendsSync = startFriendsSync()
    const stopHistory = startHistory()
    // Daily Mixes, Discover Weekly…: made quietly in the background, shown on Home when ready
    const stopMadeForYou = startMadeForYou()
    void pruneSaved()
    void resumeParty()
    // party links opened from a browser ("Open in Pulse Music")
    const stopJoins = listenForJoins()
    return () => {
      stopJoins()
      stop()
      stopProfileSync()
      stopFriendsSync()
      stopHistory()
      stopMadeForYou()
      disposePlayer()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Every page opens at the top. Repeated for a moment because the old page is still
  // animating out and the new one grows as its data and images arrive.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    let userScrolled = false
    const mark = (): void => {
      userScrolled = true
    }
    const top = (): void => {
      if (userScrolled) return
      el.dispatchEvent(new Event('pulse:scroll-reset'))
      el.scrollTop = 0
    }
    top()
    el.addEventListener('wheel', mark, { passive: true })
    el.addEventListener('keydown', mark)
    el.addEventListener('pointerdown', mark)
    const raf = requestAnimationFrame(top)
    const timers = [120, 300, 600].map((ms) => window.setTimeout(top, ms))
    return () => {
      cancelAnimationFrame(raf)
      timers.forEach(clearTimeout)
      el.removeEventListener('wheel', mark)
      el.removeEventListener('keydown', mark)
      el.removeEventListener('pointerdown', mark)
    }
  }, [route])

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'
      if (e.code === 'Space' && !typing) {
        e.preventDefault()
        void togglePlay()
      } else if (e.ctrlKey && e.key === 'ArrowRight' && !typing) void nextTrack()
      else if (e.ctrlKey && e.key === 'ArrowLeft' && !typing) void previousTrack()
      else if (e.altKey && e.key === 'ArrowLeft') back()
      else if (e.altKey && e.key === 'ArrowRight') forward()
    }
    const onMouse = (e: MouseEvent): void => {
      if (e.button === 3) back()
      if (e.button === 4) forward()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mouseup', onMouse)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mouseup', onMouse)
    }
  }, [back, forward])

  return (
    <div className={`shell ${queueOpen || lyricsOpen ? 'has-drawer' : ''}`}>
      <Ambient />
      <TrackChangeFX />
      <div className="titlebar-drag" />
      <Sidebar />
      <main className="main">
        <TopBar />
        <div className="main__scroll" ref={scroller}>
          <ScrollContext.Provider value={scroller}>
            <AnimatePresence mode="popLayout" initial={false}>
              <PageTransition key={routeKey(route)} id={routeKey(route)}>
                <PageErrorBoundary onBack={back}>
                  <Page route={route} onSignOut={onSignOut} />
                </PageErrorBoundary>
              </PageTransition>
            </AnimatePresence>
          </ScrollContext.Provider>
        </div>
        <ListenWithBar />
        <PlayerBar />
      </main>
      <QueueDrawer />
      <LyricsDrawer />
      <NowPlaying />
      <TransitionCard />
      <ContextMenu />
      <Modals />
      <CommandPalette />
      <RecapStories />
      <DjVoiceOverlay />
      <RateLimitNotice />
      <UpdateNotice />
      <ImageCropLayer />
      <ListenerNotice />
      <Toasts />
    </div>
  )
}

function Login({ onDone }: { onDone: () => void }): React.JSX.Element {
  const [waiting, setWaiting] = useState(false)
  const notAllowed = (() => {
    try {
      const n = sessionStorage.getItem('pulse-login-notice')
      sessionStorage.removeItem('pulse-login-notice')
      return n === 'not-allowed' ? 'not-allowed' : n === 'blocked' ? 'blocked' : null
    } catch {
      return false
    }
  })()
  const [error, setError] = useState<string | null>(
    notAllowed === 'not-allowed'
      ? 'Spotify didn’t let this account in: Pulse Music’s Spotify app only works for people its owner added. Use your own Spotify app below (free, about 2 minutes).'
      : notAllowed === 'blocked'
        ? 'Spotify is pausing the Spotify app Pulse Music signs in with. Your own Spotify app has its own allowance, so with it everything works again right away (free, about 2 minutes).'
        : null
  )
  const [ownOpen, setOwnOpen] = useState(!!notAllowed)
  const [ownId, setOwnId] = useState('')
  const [savedId, setSavedId] = useState<string | null>(null)
  useEffect(() => {
    void window.pulse.auth.clientId?.().then((id) => {
      setSavedId(id)
      if (id) setOwnId(id)
    })
  }, [])
  const signIn = async (): Promise<void> => {
    setWaiting(true)
    setError(null)
    try {
      const s = await window.pulse.auth.login()
      if (s.loggedIn) onDone()
    } catch (e) {
      setError(errorText(e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setWaiting(false)
    }
  }
  const redirect = 'http://127.0.0.1:43821/callback'
  return (
    <div className="login">
      <Ambient />
      <div className="titlebar-drag" />
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 24 }}
      >
        <Glass className="login__card" radius={36} bezel={30} refraction={90} blur={16}>
          <span className="login__logo" aria-hidden="true" />
          <h1>Pulse Music</h1>
          <p className="muted">Sign in with your Spotify account to play your music, playlists and lyrics.</p>
          <button className="btn btn--accent login__btn" disabled={waiting} onClick={() => void signIn()}>
            {waiting ? 'Finish signing in in your browser…' : 'Sign in with Spotify'}
          </button>
          {error && <p className="login__error">{error}</p>}
          <p className="login__fine">
            Playback needs Spotify Premium.
            {savedId ? ' Using your own Spotify app.' : ''}
          </p>
          <button className="link login__own-toggle" onClick={() => setOwnOpen(!ownOpen)}>
            {ownOpen ? 'Hide' : 'Can’t sign in? Use your own Spotify app'}
          </button>
          {ownOpen && (
            <div className="login__own">
              <ol>
                <li>
                  Open{' '}
                  <span className="link" onClick={() => window.pulse.openExternal('https://developer.spotify.com/dashboard')}>
                    developer.spotify.com/dashboard
                  </span>{' '}
                  and sign in with the same Spotify account.
                </li>
                <li>
                  <b>Create app</b>: any name, and as Redirect URI add{' '}
                  <code className="login__copy" title="Copy" onClick={() => void navigator.clipboard.writeText(redirect).then(() => setError(null))}>
                    {redirect}
                  </code>
                  . Tick <b>Web API</b> and <b>Web Playback SDK</b>, then save.
                </li>
                <li>
                  Copy the app’s <b>Client ID</b> here:
                </li>
              </ol>
              <input
                className="field login__own-input"
                placeholder="Client ID (32 letters and numbers)"
                value={ownId}
                spellCheck={false}
                onChange={(e) => setOwnId(e.target.value.trim())}
              />
              <div className="login__own-actions">
                {savedId && (
                  <button
                    className="btn"
                    onClick={async () => {
                      await window.pulse.auth.setClientId(null)
                      setSavedId(null)
                      setOwnId('')
                    }}
                  >
                    Use Pulse Music’s
                  </button>
                )}
                <button
                  className="btn btn--accent"
                  disabled={!/^[0-9a-f]{32}$/i.test(ownId) || waiting}
                  onClick={async () => {
                    try {
                      await window.pulse.auth.setClientId(ownId)
                      // a different app key: a pause on the old one doesn't apply to it
                      if (ownId !== savedId) clearRateLimit()
                      setSavedId(ownId)
                      await signIn()
                    } catch (e) {
                      setError(errorText(e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
                    }
                  }}
                >
                  Save and sign in
                </button>
              </div>
            </div>
          )}
        </Glass>
      </motion.div>
    </div>
  )
}

export default function App(): React.JSX.Element | null {
  const [auth, setAuth] = useState<boolean | null>(null)
  const setSettingsLocal = useApp((s) => s.setSettingsLocal)
  const reduceMotion = useApp((s) => s.settings.reduceMotion)
  const isMini = window.location.hash.startsWith('#/mini')
  useTheme()

  useEffect(() => {
    void window.pulse.settings.get().then((st) => {
      setSettingsLocal(st)
      if (!isMini) restoreStartPage(st)
    })
    const off = window.pulse.settings.onChange(setSettingsLocal)
    if (!isMini) void window.pulse.auth.status().then((s) => setAuth(s.loggedIn))
    return off
  }, [isMini, setSettingsLocal])

  if (isMini) return <MiniPlayer />
  if (auth === null) return <Ambient />

  return (
    <MotionConfig reducedMotion={reduceMotion ? 'always' : 'user'}>
      {auth ? (
        <Shell
          onSignOut={async () => {
            try {
              localStorage.removeItem('pulse-playlists')
            } catch {
              /* storage unavailable */
            }
            await window.pulse.auth.logout()
            disposePlayer()
            usePlayer.setState({
              track: null,
              activeDevice: null,
              sdkReady: false
            })
            window.location.reload()
          }}
        />
      ) : (
        <Login onDone={() => setAuth(true)} />
      )}
      {/* Last in the DOM: Electron decides drag vs click in document order, so the
          window buttons must come after every draggable title-bar area. */}
      <WindowControls />
    </MotionConfig>
  )
}
