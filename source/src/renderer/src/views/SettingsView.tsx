import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AiSetup } from '@/components/AiSetup'
import { previewVoice, testDj } from '@/lib/dj'
import { connectSpotifyFriends, disconnectSpotifyFriends, refreshSpotifyFriends, useSpotifyFriends } from '@/lib/spotifyFriends'
import { motion } from 'motion/react'
import { importSpotifyExport, useHistory } from '@/lib/history'
import { Toggle } from '@/components/common'
import { useApp } from '@/lib/store'
import { usePlayer } from '@/lib/player'
import { pickImage, requestsToday, webRouteOpen } from '@/lib/spotify'
import {
  GLOBAL_KEYS,
  type FontChoice,
  type GlassQuality,
  type GlobalAction,
  type LastfmStatus,
  type ThemeMode,
  type UpdateStatus,
  type VoiceStatus
} from '@shared/types'
import { FONTS } from '@/components/CommandPalette'
import { Glass } from '@/components/Glass'
import { Cover } from '@/components/common'
import { PalettePicker } from '@/components/PalettePicker'
import { useProfile } from '@/lib/profile'
import { NP_THEMES } from '@/components/NpThemes'

function Segmented<T extends string>({
  id,
  value,
  options,
  onChange
}: {
  id: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}): React.JSX.Element {
  return (
    <Glass radius={999} bezel={10} refraction={28} className="segmented">
      {options.map((o) => (
        <button key={o.value} className={`segmented__btn ${value === o.value ? 'is-on' : ''}`} onClick={() => onChange(o.value)}>
          {value === o.value && (
            <motion.span layoutId={`seg-${id}`} className="segmented__thumb" transition={{ type: 'spring', stiffness: 500, damping: 36 }} />
          )}
          <span>{o.label}</span>
        </button>
      ))}
    </Glass>
  )
}

/** What Pulse asked Spotify today, so a block can be traced to its cause. */
function RequestsRow(): React.JSX.Element {
  const toast = useApp((s) => s.toast)
  const [t, setT] = useState(() => requestsToday())
  useEffect(() => {
    const id = window.setInterval(() => setT(requestsToday()), 5000)
    return () => window.clearInterval(id)
  }, [])
  const sum = (r: Record<string, number>): number => Object.values(r).reduce((a, b) => a + b, 0)
  const own = sum(t.key)
  const web = sum(t.web)
  const top = Object.entries(t.key)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
  const copy = (): void => {
    const lines = [
      `Pulse Music ${t.day}`,
      `Pulse's own key: ${own}`,
      ...Object.entries(t.key)
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `  ${n} ${k}`),
      `Your Spotify account: ${web}`,
      ...Object.entries(t.web)
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `  ${n} ${k}`)
    ]
    void navigator.clipboard.writeText(lines.join('\n')).then(() => toast('Copied'))
  }
  return (
    <>
      <Row
        title="Today"
        hint={
          <>
            {own.toLocaleString()} with Pulse’s own key (these count toward Spotify’s daily limit), {web.toLocaleString()} through your Spotify account (free).
            {webRouteOpen() ? '' : ' Your Spotify account isn’t being used right now, so everything counts. Connect it on the Friends page.'}
          </>
        }
      >
        <button className="btn" onClick={copy}>
          Copy details
        </button>
      </Row>
      {top.length > 0 && (
        <ol className="sreq">
          {top.map(([k, n]) => (
            <li key={k}>
              <span>{k}</span>
              <b>{n.toLocaleString()}</b>
            </li>
          ))}
        </ol>
      )}
    </>
  )
}

function Row({ title, hint, children }: { title: string; hint?: React.ReactNode; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="srow">
      <div className="srow__text">
        <span className="srow__title">{title}</span>
        {hint && <span className="srow__hint">{hint}</span>}
      </div>
      <div className="srow__control">{children}</div>
    </div>
  )
}

/** Your Spotify web account inside Pulse: Friend Activity and Spotify's own lyrics. */
function SpotifyAccountRow(): React.JSX.Element {
  const { connected, connecting } = useSpotifyFriends()
  useEffect(() => void refreshSpotifyFriends(false), [])
  return (
    <Row
      title="Spotify account"
      hint={
        connected
          ? 'Connected: the Friends page shows what your Spotify friends play, and lyrics come from Spotify too when LRCLIB has no timings.'
          : 'Sign in to Spotify once inside Pulse to see your Spotify friends’ activity and get Spotify’s synced lyrics. The sign-in stays on this computer.'
      }
    >
      {connected ? (
        <button className="btn" onClick={() => void disconnectSpotifyFriends()}>
          Disconnect
        </button>
      ) : (
        <button className="btn btn--accent" disabled={connecting || connected === null} onClick={() => void connectSpotifyFriends()}>
          {connecting ? 'Waiting…' : 'Connect'}
        </button>
      )}
    </Row>
  )
}

/** Version, "Check for updates", download progress and "Restart and update". */
/** Your Spotify data download, for stats from before Pulse (the same import as on Stats). */
function HistoryImportRow(): React.JSX.Element {
  const imported = useHistory((s) => s.imported)
  const count = useHistory((s) => s.plays.length)
  const toast = useApp((s) => s.toast)
  const [busy, setBusy] = useState(false)
  const day = (t: number): string =>
    new Date(t).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    })
  const pick = (): void => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = '.zip,.json'
    input.onchange = async () => {
      const files = [...(input.files ?? [])]
      if (!files.length) return
      setBusy(true)
      try {
        const r = await importSpotifyExport(files)
        if (!r.found) toast('No listening history in those files. Pick the zip Spotify sent, or its StreamingHistory files.', 'error')
        else toast(`Added ${r.added.toLocaleString()} plays from ${day(r.from!)} to ${day(r.to!)}.`)
      } catch (e) {
        toast(`Could not read that file: ${e instanceof Error ? e.message : String(e)}`, 'error')
      } finally {
        setBusy(false)
      }
    }
    input.click()
  }
  return (
    <>
      <Row
        title="Import your Spotify data"
        hint={
          imported
            ? `Imported: ${day(imported.from)} – ${day(imported.to)}. ${count.toLocaleString()} plays counted in all.`
            : 'Spotify only tells apps your last 50 plays. Its data download has every play: request it on Spotify (Account → Privacy), then pick the zip here.'
        }
      >
        <button className="btn" onClick={() => window.pulse.openExternal('https://www.spotify.com/account/privacy/')}>
          Request
        </button>
        <button className="btn btn--accent" disabled={busy} onClick={pick}>
          {busy ? 'Importing…' : imported ? 'Import again' : 'Import'}
        </button>
      </Row>
    </>
  )
}

function UpdatesRow(): React.JSX.Element {
  const auto = useApp((s) => s.settings.autoUpdate !== false)
  const [version, setVersion] = useState('')
  const [st, setSt] = useState<UpdateStatus>({ state: 'idle' })
  useEffect(() => {
    void window.pulse.updates.version().then(setVersion)
    void window.pulse.updates.status().then((v) => v && setSt(v))
    return window.pulse.updates.onStatus((v) => v && setSt(v))
  }, [])
  const busy = st.state === 'checking' || st.state === 'downloading'
  const hint =
    st.state === 'dev'
      ? 'Updates work in the installed app.'
      : st.state === 'checking'
        ? 'Looking for a new version…'
        : st.state === 'downloading'
          ? `Downloading ${st.version ?? 'the new version'}… ${st.percent}%`
          : st.state === 'ready'
            ? `Version ${st.version} is ready.`
            : st.state === 'latest'
              ? 'You have the newest version.'
              : st.state === 'error'
                ? `Couldn’t update: ${st.message}`
                : auto
                  ? 'Pulse looks for new versions on its own.'
                  : 'Press Check for updates to look for a new version.'
  return (
    <Row title={`Pulse Music ${version}`} hint={hint}>
      {st.state === 'ready' ? (
        <button className="btn btn--accent" onClick={() => window.pulse.updates.install()}>
          Restart and update
        </button>
      ) : (
        <button className="btn" disabled={busy || st.state === 'dev'} onClick={() => void window.pulse.updates.check().then(setSt)}>
          {st.state === 'checking' ? 'Checking…' : st.state === 'downloading' ? `${st.percent}%` : 'Check for updates'}
        </button>
      )}
      {st.state === 'downloading' && (
        <span className="supdate__bar" aria-hidden="true">
          <i style={{ width: `${st.percent}%` }} />
        </span>
      )}
    </Row>
  )
}

type Cat = 'general' | 'appearance' | 'playback' | 'nowplaying' | 'lyrics' | 'dj' | 'integrations' | 'performance' | 'history' | 'account'

/** Small line icons for the categories (24×24, stroked). */
const CAT_ICONS: Record<Cat, string> = {
  general:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.5h-4L10.7 6a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1c.5.4 1.1.8 1.7 1l.3 2.5h4l.3-2.5c.6-.2 1.2-.6 1.7-1l2.4 1 2-3.4Z',
  appearance: 'M12 3a9 9 0 1 0 0 18c1.2 0 1.6-1 1.2-1.9-.5-1 .2-2.1 1.3-2.1H17a4 4 0 0 0 4-4c0-5-4-10-9-10ZM7.5 12.5h.01M9.5 8h.01M14.5 8h.01',
  playback: 'M8 5.5v13l10.5-6.5L8 5.5Z',
  nowplaying: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  lyrics: 'M5 6h14M5 10h10M5 14h14M5 18h8',
  dj: 'M4 14v-2a8 8 0 0 1 16 0v2M4 14a2 2 0 0 1 2-2h1v7H6a2 2 0 0 1-2-2v-3ZM20 14a2 2 0 0 0-2-2h-1v7h1a2 2 0 0 0 2-2v-3Z',
  integrations: 'M9 7V4M15 7V4M7 7h10v4a5 5 0 0 1-10 0V7ZM12 16v4',
  performance: 'M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z',
  history: 'M3.5 12a8.5 8.5 0 1 0 2.5-6M3.5 4v4h4M12 8v4.5l3 2',
  account: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20.5a7.5 7.5 0 0 1 15 0'
}

const CATS: { id: Cat; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'playback', label: 'Playback' },
  { id: 'nowplaying', label: 'Now Playing' },
  { id: 'lyrics', label: 'Lyrics' },
  { id: 'dj', label: 'AI DJ' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'performance', label: 'Performance' },
  { id: 'history', label: 'Listening history' },
  { id: 'account', label: 'Account & updates' }
]

const SHORTCUTS: [string, string][] = [
  ['Space', 'Play or pause'],
  ['Ctrl + →', 'Next song'],
  ['Ctrl + ←', 'Previous song'],
  ['Alt + ← / →', 'Back and forward between pages'],
  ['Ctrl + K', 'Search everything and run commands'],
  ['Esc', 'Close Now Playing, Recap and menus'],
  ['Media keys', 'Play, pause, next and previous, also from other apps']
]

const SIZES = [
  { value: '0.9', label: '90 %' },
  { value: '1', label: '100 %' },
  { value: '1.1', label: '110 %' },
  { value: '1.25', label: '125 %' }
]

const GLOBAL_LABELS: Record<GlobalAction, string> = {
  toggle: 'Play or pause',
  next: 'Next song',
  previous: 'Previous song',
  volumeUp: 'Volume up',
  volumeDown: 'Volume down',
  like: 'Like the song',
  show: 'Show Pulse'
}

/** Turns a key press into an Electron shortcut ("Ctrl+Alt+Space"), or null while only modifiers are held. */
function accelOf(e: React.KeyboardEvent): string | null {
  const k = e.key
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(k)) return null
  const named: Record<string, string> = {
    ' ': 'Space',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Escape: 'Esc',
    '+': 'Plus'
  }
  const key = named[k] ?? (k.length === 1 ? k.toUpperCase() : k)
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean)
  // a shortcut that works everywhere needs at least one modifier (or a media/F key)
  if (!mods.length && !/^(F\d{1,2}|Media\w+)$/.test(key)) return null
  return [...mods, key].join('+')
}

/** One global shortcut: click, then press the keys. */
function KeyRecorder({ action }: { action: GlobalAction }): React.JSX.Element {
  const saved = useApp((s) => s.settings.globalKeys)
  const keys = { ...GLOBAL_KEYS, ...(saved ?? {}) }
  const update = useApp((s) => s.updateSettings)
  const [rec, setRec] = useState(false)
  const value = keys[action]
  const save = (accel: string): void => void update({ globalKeys: { ...keys, [action]: accel } })
  return (
    <div className="keyrec">
      <span className="keyrec__label">{GLOBAL_LABELS[action]}</span>
      <button
        className={`keyrec__keys ${rec ? 'is-rec' : ''}`}
        onClick={() => setRec(true)}
        onBlur={() => setRec(false)}
        onKeyDown={(e) => {
          if (!rec) return
          e.preventDefault()
          if (e.key === 'Escape') return setRec(false)
          if (e.key === 'Backspace' || e.key === 'Delete') {
            save('')
            return setRec(false)
          }
          const a = accelOf(e)
          if (!a) return
          save(a)
          setRec(false)
        }}
      >
        {rec ? (
          <span className="muted">Press the keys…</span>
        ) : value ? (
          value.split('+').map((p, i) => (
            <span key={i}>
              {i > 0 && <small>+</small>}
              <kbd>{p}</kbd>
            </span>
          ))
        ) : (
          <span className="muted">Not set</span>
        )}
      </button>
      {value !== GLOBAL_KEYS[action] && (
        <button className="keyrec__reset" title="Back to the default" onClick={() => save(GLOBAL_KEYS[action])}>
          Reset
        </button>
      )}
    </div>
  )
}

/** Hardware acceleration: the switch, and a restart when it differs from how Pulse runs now. */
function GpuRow(): React.JSX.Element {
  const settings = useApp((s) => s.settings)
  const update = useApp((s) => s.updateSettings)
  const [gpu, setGpu] = useState<{ on: boolean; wanted: boolean } | null>(null)
  useEffect(
    () =>
      void window.pulse.app
        .gpu()
        .then(setGpu)
        .catch(() => setGpu(null)),
    []
  )
  const wanted = settings.hardwareAcceleration !== false
  const differs = gpu !== null && gpu.on !== wanted
  return (
    <Row
      title="Hardware acceleration"
      hint={
        differs
          ? 'Changes after a restart.'
          : 'The graphics card draws the glass, blur and animations, which keeps them smooth and the processor free. Turn it off only if windows go black, flicker or stutter on your graphics driver.'
      }
    >
      {differs && (
        <button className="btn btn--accent" onClick={() => void window.pulse.app.relaunch()}>
          Restart now
        </button>
      )}
      <Toggle label="Hardware acceleration" on={wanted} onChange={(hardwareAcceleration) => void update({ hardwareAcceleration })} />
    </Row>
  )
}

/** Storage: empties the downloaded pictures and pages (your history and settings stay). */
function CacheRow(): React.JSX.Element {
  const toast = useApp((s) => s.toast)
  const [busy, setBusy] = useState(false)
  return (
    <Row
      title="Clear cache"
      hint="Empties the covers, artist pictures and pages Pulse has downloaded. They load again when needed. Your settings, history and stats stay."
    >
      <button
        className="btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try {
            const bytes = await window.pulse.app.clearCache()
            // the picture lookups Pulse keeps itself
            for (const k of ['pulse-img-fill1', 'pulse-face1']) localStorage.removeItem(k)
            toast(bytes > 0 ? `Cleared ${(bytes / 1048576).toFixed(bytes > 104857600 ? 0 : 1)} MB.` : 'The cache is empty now.')
          } catch {
            toast('Could not clear the cache.', 'error')
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? 'Clearing…' : 'Clear'}
      </button>
    </Row>
  )
}

export function SettingsView({ onSignOut }: { onSignOut: () => void }): React.JSX.Element {
  const settings = useApp((s) => s.settings)
  const update = useApp((s) => s.updateSettings)
  const me = useApp((s) => s.me)
  const profile = useProfile((s) => s.profile)
  const sdkError = usePlayer((s) => s.sdkError)
  const sdkReady = usePlayer((s) => s.sdkReady)
  const [version, setVersion] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  useEffect(() => {
    void window.pulse.updates?.version().then(setVersion)
  }, [])
  const [token, setToken] = useState(settings.geniusToken)
  const [showToken, setShowToken] = useState(false)
  const [cat, setCatState] = useState<Cat>(() => {
    const saved = sessionStorage.getItem('pulse-settings-cat') as Cat | null
    return saved && CATS.some((c) => c.id === saved) ? saved : 'general'
  })
  const setCat = (c: Cat): void => {
    setCatState(c)
    setQuery('')
    try {
      sessionStorage.setItem('pulse-settings-cat', c)
    } catch {
      /* storage unavailable */
    }
    const sc = document.querySelector('.main__scroll')
    if (sc && sc.scrollTop > 0) sc.scrollTo({ top: 0 })
  }
  const [query, setQuery] = useState('')
  const body = useRef<HTMLDivElement>(null)
  const q = query.trim().toLowerCase()

  // Searching shows every category and hides the settings that don't match.
  useLayoutEffect(() => {
    const root = body.current
    if (!root) return
    const rows = root.querySelectorAll<HTMLElement>('.srow, .account, .shortcuts')
    rows.forEach((r) => (r.hidden = !!q && !(r.textContent ?? '').toLowerCase().includes(q)))
    root.querySelectorAll<HTMLElement>('.sgroup').forEach((g) => {
      const any =
        !q ||
        [...g.querySelectorAll<HTMLElement>('.srow, .account, .shortcuts')].some((r) => !r.hidden) ||
        (g.querySelector('h2')?.textContent ?? '').toLowerCase().includes(q)
      g.hidden = !any
      if (q && any && (g.querySelector('h2')?.textContent ?? '').toLowerCase().includes(q))
        g.querySelectorAll<HTMLElement>('.srow, .account, .shortcuts').forEach((r) => (r.hidden = false))
    })
    const cats = [...root.querySelectorAll<HTMLElement>('.scat')]
    cats.forEach((c) => (c.hidden = !!q && ![...c.querySelectorAll<HTMLElement>('.sgroup')].some((g) => !g.hidden)))
    const none = root.querySelector<HTMLElement>('.settings__none')
    if (none) none.hidden = cats.some((c) => !c.hidden)
  })

  const sections: Record<Cat, React.JSX.Element> = {
    general: (
      <>
        <section className="sgroup">
          <h2>Startup</h2>
          <Row
            title="Open at startup"
            hint="Starts quietly in the tray when you sign in to Windows, so your plays are counted from the start. Works in the installed app."
          >
            <Toggle label="Open at startup" on={settings.launchAtStartup} onChange={(launchAtStartup) => void update({ launchAtStartup })} />
          </Row>
          <Row
            title="Keep running in the tray"
            hint="Closing the window leaves Pulse in the tray, still counting what you play on your phone and other devices. Quit from the tray icon."
          >
            <Toggle label="Keep running in the tray" on={settings.closeToTray !== false} onChange={(closeToTray) => void update({ closeToTray })} />
          </Row>
          <Row title="Start page" hint="The page Pulse opens on.">
            <Segmented<'home' | 'last'>
              id="start"
              value={settings.startPage ?? 'home'}
              onChange={(startPage) => void update({ startPage })}
              options={[
                { value: 'home', label: 'Home' },
                { value: 'last', label: 'Where I left off' }
              ]}
            />
          </Row>
        </section>
        <section className="sgroup">
          <h2>Window</h2>
          <Row title="Size" hint="Makes everything in Pulse bigger or smaller. Ctrl + scroll works in most apps; this one remembers it.">
            <Segmented<string>
              id="zoom"
              value={SIZES.some((z) => Number(z.value) === settings.zoom) ? String(settings.zoom) : '1'}
              onChange={(v) => void update({ zoom: Number(v) })}
              options={SIZES}
            />
          </Row>
          <Row
            title="Song notifications"
            hint="Shows the cover, the song and the artist in a Windows notification when the song changes while Pulse isn’t the window in front."
          >
            <Toggle label="Song notifications" on={!!settings.songNotifications} onChange={(songNotifications) => void update({ songNotifications })} />
          </Row>
        </section>
        <section className="sgroup">
          <h2>Shortcuts from any app</h2>
          <Row
            title="Work while Pulse is in the background"
            hint="Control the music from games, the browser or anything else. Click a shortcut and press new keys to change it; Backspace clears it. Keys another app already uses don’t work here."
          >
            <Toggle label="Shortcuts from any app" on={settings.globalShortcuts !== false} onChange={(globalShortcuts) => void update({ globalShortcuts })} />
          </Row>
          {settings.globalShortcuts !== false && (
            <div className="keyrecs">
              {(Object.keys(GLOBAL_KEYS) as GlobalAction[]).map((a) => (
                <KeyRecorder key={a} action={a} />
              ))}
            </div>
          )}
        </section>
        <section className="sgroup">
          <h2>Keyboard shortcuts</h2>
          <dl className="shortcuts">
            {SHORTCUTS.map(([k, what]) => (
              <div key={k}>
                <dt>
                  {k.split(' + ').map((part, i) => (
                    <span key={i}>
                      {i > 0 && ' + '}
                      <kbd>{part}</kbd>
                    </span>
                  ))}
                </dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </section>
      </>
    ),
    appearance: (
      <>
        <section className="sgroup">
          <h2>Look</h2>
          <Row title="Theme" hint="System follows your Windows setting.">
            <Segmented<ThemeMode>
              id="theme"
              value={settings.theme}
              onChange={(theme) => void update({ theme })}
              options={[
                { value: 'system', label: 'System' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' }
              ]}
            />
          </Row>
          <div className="srow srow--stack">
            <div className="srow__text">
              <span className="srow__title">Font</span>
              <span className="srow__hint">Used for the whole app. Titles keep a display face so pages still feel distinct.</span>
            </div>
            <div className="fontpick">
              {FONTS.map((f) => (
                <button
                  key={f.id}
                  className={`fontpick__opt ${settings.font === f.id ? 'is-on' : ''}`}
                  data-font-sample={f.id}
                  onClick={() => void update({ font: f.id as FontChoice })}
                >
                  <span className="fontpick__aa">Aa</span>
                  <span>{f.label}</span>
                </button>
              ))}
            </div>
          </div>
          <Row title="Compact mode" hint="Smaller rows, covers and spacing so more fits on screen.">
            <Toggle label="Compact mode" on={settings.density === 'compact'} onChange={(on) => void update({ density: on ? 'compact' : 'comfortable' })} />
          </Row>
          <Row title="Reduce motion" hint="Turns off the drifting background and softens transitions.">
            <Toggle label="Reduce motion" on={settings.reduceMotion} onChange={(reduceMotion) => void update({ reduceMotion })} />
          </Row>
        </section>
        <section className="sgroup">
          <h2>Background</h2>
          <div className="srow srow--stack">
            <div className="srow__text">
              <span className="srow__title">Colour palette</span>
              <span className="srow__hint">Artwork follows the song or page you are on. Pick a palette to keep the same colours.</span>
            </div>
            <PalettePicker
              value={settings.bgPalette}
              autoId="artwork"
              autoLabel="Artwork"
              customColors={settings.customColors}
              onChange={(bgPalette) => void update({ bgPalette })}
              onCustomColors={(customColors) => void update({ customColors })}
            />
          </div>
          <Row title="Use the palette" hint="Everywhere keeps your colours on every page. Home only lets albums, artists and songs colour the rest.">
            <Segmented<'everywhere' | 'home'>
              id="scope"
              value={settings.bgScope}
              onChange={(bgScope) => void update({ bgScope })}
              options={[
                { value: 'everywhere', label: 'Everywhere' },
                { value: 'home', label: 'Home only' }
              ]}
            />
          </Row>
        </section>
      </>
    ),
    playback: (
      <section className="sgroup">
        <h2>Playback</h2>
        <Row title="Autoplay" hint="When a song, album or playlist ends with nothing after it, keep playing similar songs.">
          <Toggle label="Autoplay" on={settings.autoplay !== false} onChange={(autoplay) => void update({ autoplay })} />
        </Row>
        <Row title="Song transitions" hint="Fades one song into the next and shows both covers while it happens. Off by default.">
          <Toggle label="Song transitions" on={settings.crossfade} onChange={(crossfade) => void update({ crossfade })} />
        </Row>
        <Row
          title="Transition length"
          hint="Spotify plays one song at a time, so the end of a song fades out as the next fades in. The sound fades only when Pulse Music itself is playing."
        >
          <Segmented<string>
            id="fade"
            value={[0, 3, 6, 9, 12].includes(settings.fadeSeconds) ? String(settings.fadeSeconds) : '0'}
            onChange={(v) => void update({ fadeSeconds: Number(v) })}
            options={[
              { value: '0', label: 'Auto' },
              { value: '3', label: '3 s' },
              { value: '6', label: '6 s' },
              { value: '9', label: '9 s' },
              { value: '12', label: '12 s' }
            ]}
          />
        </Row>
        <Row title="Player" hint={sdkError ?? (sdkReady ? 'Ready. Pulse Music shows up as a device in Spotify Connect.' : 'Starting…')}>
          <span className={`status-dot ${sdkError ? 'is-bad' : sdkReady ? 'is-ok' : ''}`} />
        </Row>
      </section>
    ),
    nowplaying: (
      <section className="sgroup">
        <h2>Now Playing</h2>
        <div className="srow srow--stack">
          <div className="srow__text">
            <span className="srow__title">Look</span>
            <span className="srow__hint">Also in the menu at the right edge of Now Playing.</span>
          </div>
          <div className="fontpick">
            {NP_THEMES.map((t) => (
              <button
                key={t.id}
                className={`fontpick__opt ${(settings.npTheme === 'classic' ? 'cover' : settings.npTheme) === t.id ? 'is-on' : ''}`}
                title={t.hint}
                onClick={() => void update({ npTheme: t.id })}
              >
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </div>
        <Row title="Open in full screen" hint="Now Playing covers the whole screen, taskbar included. Esc goes back.">
          <Toggle label="Open in full screen" on={!!settings.npFullscreen} onChange={(npFullscreen) => void update({ npFullscreen })} />
        </Row>
        <Row
          title="Cover when there are no lyrics"
          hint="A song without lyrics shows the big cover instead, and the next song with lyrics switches back on its own."
        >
          <Toggle label="Cover when there are no lyrics" on={settings.npAutoCover !== false} onChange={(npAutoCover) => void update({ npAutoCover })} />
        </Row>
        <Row title="Scratch the record" hint="On the turntable: grab the record to stop the music and scratch the song like a DJ.">
          <Toggle label="Scratch the record" on={settings.npScratch !== false} onChange={(npScratch) => void update({ npScratch })} />
        </Row>
      </section>
    ),
    lyrics: (
      <section className="sgroup">
        <h2>Lyrics</h2>
        <SpotifyAccountRow />
        <Row title="Word by word" hint="Lights up each word as it is sung. Uses exact word timings when LRCLIB has them, otherwise follows the line.">
          <Toggle label="Word by word lyrics" on={settings.wordLyrics} onChange={(wordLyrics) => void update({ wordLyrics })} />
        </Row>
        <Row
          title="Genius token (optional)"
          hint="Genius lyrics and artist info work without it. Only add your own token if Genius starts refusing Pulse. Stored only on this computer."
        >
          <div className="token">
            <input
              className="field"
              type={showToken ? 'text' : 'password'}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onBlur={() => token !== settings.geniusToken && void update({ geniusToken: token.trim() })}
              placeholder="Not needed"
              spellCheck={false}
            />
            <button className="btn" onClick={() => setShowToken((s) => !s)}>
              {showToken ? 'Hide' : 'Show'}
            </button>
          </div>
        </Row>
      </section>
    ),
    dj: <DjSettings />,
    integrations: (
      <>
        <section className="sgroup">
          <h2>Discord</h2>
          <Row title="Discord status" hint={<DiscordHint on={settings.discordRpc} />}>
            <Toggle label="Discord status" on={settings.discordRpc} onChange={(discordRpc) => void update({ discordRpc })} />
          </Row>
          {settings.discordRpc && (
            <Row
              title="Get Pulse Music button"
              hint="Adds a button to your Discord status that opens the Pulse Music download page. Friends see it on your profile; Discord hides your own buttons from you."
            >
              <Toggle
                label="Get Pulse Music button"
                on={settings.discordGetButton ?? true}
                onChange={(discordGetButton) => void update({ discordGetButton })}
              />
            </Row>
          )}
        </section>
        <LastfmSettings />
      </>
    ),
    performance: (
      <>
        <section className="sgroup">
          <h2>Performance</h2>
          <Row
            title="Animations"
            hint={
              settings.renderMode === 'quality'
                ? 'Quality: backgrounds move every frame (even while you scroll), pages glide in softer and lyrics scroll more smoothly. Uses more of the graphics card.'
                : 'Performance: light background motion that leaves the graphics card and battery alone. Everything still animates.'
            }
          >
            <Segmented<'performance' | 'quality'>
              id="render"
              value={settings.renderMode ?? 'performance'}
              onChange={(renderMode) => void update({ renderMode })}
              options={[
                { value: 'performance', label: 'Performance' },
                { value: 'quality', label: 'Quality' }
              ]}
            />
          </Row>
          <Row title="Glass quality" hint="Full bends light at the edges. Lite is a plain blur that is easier on older GPUs and laptops on battery.">
            <Segmented<GlassQuality>
              id="glass"
              value={settings.glassQuality}
              onChange={(glassQuality) => void update({ glassQuality })}
              options={[
                { value: 'full', label: 'Full' },
                { value: 'lite', label: 'Lite' }
              ]}
            />
          </Row>
          <GpuRow />
        </section>
        <section className="sgroup">
          <h2>Spotify requests</h2>
          <RequestsRow />
        </section>
        <section className="sgroup">
          <h2>Storage</h2>
          <CacheRow />
        </section>
      </>
    ),
    history: (
      <section className="sgroup">
        <h2>Listening history</h2>
        <HistoryImportRow />
      </section>
    ),
    account: (
      <>
        <section className="sgroup">
          <h2>Account</h2>
          <div className="account">
            <Cover src={profile.avatar ?? pickImage(me?.images, 128)} size={52} round />
            <div className="account__text">
              <span className="srow__title">{profile.displayName || me?.display_name || 'Spotify user'}</span>
              <span className="srow__hint">Signed in with Spotify</span>
            </div>
            <button className="btn" onClick={onSignOut}>
              Sign out
            </button>
          </div>
          <Row
            title="Start over"
            hint="Signs out and erases everything Pulse keeps on this computer: settings, listening history and stats, your profile, caches and the Last.fm link. Pulse then starts like a fresh install, and you can sign in with any Spotify account. Your Spotify account itself is not touched."
          >
            <button
              className={`btn ${confirmReset ? 'btn--danger' : ''}`}
              onClick={() => {
                if (!confirmReset) {
                  setConfirmReset(true)
                  window.setTimeout(() => setConfirmReset(false), 5000)
                  return
                }
                void window.pulse.app.reset()
              }}
            >
              {confirmReset ? 'Click again to erase everything' : 'Start over…'}
            </button>
          </Row>
        </section>
        <section className="sgroup">
          <h2>Updates</h2>
          <Row
            title="Automatic updates"
            hint={
              settings.autoUpdate !== false
                ? 'Looks for a new version every hour and downloads it in the background. It installs when you restart Pulse.'
                : 'Off: Pulse only updates when you press Check for updates.'
            }
          >
            <Toggle label="Automatic updates" on={settings.autoUpdate !== false} onChange={(autoUpdate) => void update({ autoUpdate })} />
          </Row>
          <UpdatesRow />
        </section>
        <p className="fineprint">Pulse Music {version}. Music and metadata provided by Spotify. Lyrics from LRCLIB, Spotify and Genius.</p>
      </>
    )
  }

  return (
    <div className="settings settings--split">
      <h1 className="page-title">Settings</h1>
      <div className="settings__layout">
        <nav className="settings__rail" aria-label="Settings categories">
          <input
            className="field settings__search"
            type="search"
            placeholder="Search settings"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
          />
          {CATS.map((c) => (
            <button
              key={c.id}
              className={`settings__cat ${!q && cat === c.id ? 'is-on' : ''}`}
              aria-current={!q && cat === c.id ? 'page' : undefined}
              onClick={() => setCat(c.id)}
            >
              {!q && cat === c.id && (
                <motion.span layoutId="settings-cat" className="settings__cat-bg" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />
              )}
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d={CAT_ICONS[c.id]} />
              </svg>
              <span>{c.label}</span>
            </button>
          ))}
        </nav>
        <div className="settings__body" ref={body}>
          {q ? (
            CATS.map((c) => (
              <div key={c.id} className="scat">
                <p className="scat__label">{c.label}</p>
                {sections[c.id]}
              </div>
            ))
          ) : (
            // only a fade: anything that moves or resizes here made the page twitch
            <motion.div key={cat} className="scat" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.22, ease: 'easeOut' }}>
              {sections[cat]}
            </motion.div>
          )}
          {q && (
            <p className="muted settings__none" hidden>
              No settings match “{query.trim()}”.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function LastfmSettings(): React.JSX.Element | null {
  const [st, setSt] = useState<LastfmStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    void window.pulse.lastfm.status().then(setSt)
  }, [])
  if (!st) return null
  const connect = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      setSt(await window.pulse.lastfm.connect())
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="sgroup">
      <h2>Last.fm</h2>
      {!st.available ? (
        <Row title="Scrobbling" hint="This build of Pulse Music has no Last.fm API key, so scrobbling is off.">
          <span className="muted">Not available</span>
        </Row>
      ) : !st.connected ? (
        <Row
          title="Connect Last.fm"
          hint="Sends the songs you listen to (after half of a song or 4 minutes) to your Last.fm profile. A browser opens to allow it."
        >
          <div className="token">
            <button className="btn btn--accent" disabled={busy} onClick={() => void connect()}>
              {busy ? 'Waiting for Last.fm…' : 'Connect'}
            </button>
            {error && <span className="aisetup__err">{error}</span>}
          </div>
        </Row>
      ) : (
        <>
          <Row
            title={`Connected as ${st.user}`}
            hint={st.pending ? `${st.pending} scrobbles waiting to be sent.` : 'Your listening goes to your Last.fm profile.'}
          >
            <div className="token">
              <button className="btn" onClick={() => void window.pulse.openExternal(`https://www.last.fm/user/${encodeURIComponent(st.user ?? '')}`)}>
                Open profile
              </button>
              <button className="btn" onClick={() => void window.pulse.lastfm.disconnect().then(setSt)}>
                Disconnect
              </button>
            </div>
          </Row>
          <Row title="Scrobble" hint="Pause scrobbling without disconnecting.">
            <Toggle label="Scrobble" on={st.enabled} onChange={(v) => void window.pulse.lastfm.setEnabled(v).then(setSt)} />
          </Row>
        </>
      )}
    </section>
  )
}

function DjSettings(): React.JSX.Element {
  const settings = useApp((s) => s.settings)
  const update = useApp((s) => s.updateSettings)
  const [ready, setReady] = useState<boolean | null>(null)
  const [key, setKey] = useState(settings.djClaudeKey)
  const [claudeModel, setClaudeModel] = useState(settings.djClaudeModel)
  const [showKey, setShowKey] = useState(false)
  const [voice, setVoice] = useState<VoiceStatus | null>(null)
  const [progress, setProgress] = useState<{
    stage: string
    done: number
    total: number
  } | null>(null)
  const [previewing, setPreviewing] = useState<string | null>(null)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [test, setTest] = useState<{
    busy: boolean
    text: string | null
    error: boolean
  }>({ busy: false, text: null, error: false })

  useEffect(() => {
    if (settings.djProvider === 'local') void window.pulse.dj.localReady().then(setReady)
  }, [settings.djProvider])
  useEffect(() => {
    void window.pulse.dj.voiceStatus().then(setVoice)
  }, [])
  useEffect(() => window.pulse.dj.onInstallProgress(setProgress), [])
  const installingNow = !!progress && progress.stage !== 'Ready' && !progress.stage.startsWith('Failed')
  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : null

  return (
    <section className="sgroup">
      <h2>AI DJ</h2>
      <Row title="Brain" hint="Built in runs on this computer for free. Claude needs an API key and is billed per use, but understands requests better.">
        <Segmented<'local' | 'claude'>
          id="djp"
          value={settings.djProvider}
          onChange={(djProvider) => void update({ djProvider })}
          options={[
            { value: 'local', label: 'Built in' },
            { value: 'claude', label: 'Claude API' }
          ]}
        />
      </Row>
      {settings.djProvider === 'local' && ready === false && (
        <Row title="Set up the AI DJ" hint="Downloads the DJ’s brain once, about 2 GB.">
          <AiSetup compact onReady={() => setReady(true)} />
        </Row>
      )}
      {settings.djProvider === 'local' ? null : (
        <>
          <Row title="Claude API key" hint="From console.anthropic.com. Stored only on this computer.">
            <div className="token">
              <input
                className="field"
                id="dj-key"
                type={showKey ? 'text' : 'password'}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                onBlur={() => key !== settings.djClaudeKey && void update({ djClaudeKey: key.trim() })}
                placeholder="sk-ant-…"
                spellCheck={false}
              />
              <button className="btn" onClick={() => setShowKey((v) => !v)}>
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
          </Row>
          <Row title="Claude model" hint="A small, fast model is plenty for a DJ.">
            <input
              className="field"
              id="dj-claude-model"
              value={claudeModel}
              onChange={(e) => setClaudeModel(e.target.value)}
              onBlur={() => claudeModel !== settings.djClaudeModel && void update({ djClaudeModel: claudeModel.trim() })}
              spellCheck={false}
            />
          </Row>
        </>
      )}
      <Row title="Test the DJ" hint={test.text ?? 'Asks the model for a one-line hello.'}>
        <button
          className="btn"
          disabled={test.busy}
          onClick={async () => {
            setTest({ busy: true, text: null, error: false })
            try {
              setTest({
                busy: false,
                text: `“${await testDj()}”`,
                error: false
              })
            } catch (e) {
              setTest({
                busy: false,
                text: e instanceof Error ? e.message : String(e),
                error: true
              })
            }
          }}
        >
          {test.busy ? 'Asking…' : 'Say hello'}
        </button>
      </Row>
      <Row title="DJ speaks out loud" hint="A natural neural voice (Kokoro) that runs on this computer. Off shows subtitles only.">
        <Toggle label="DJ speaks out loud" on={settings.djVoice === 'natural'} onChange={(on) => void update({ djVoice: on ? 'natural' : 'off' })} />
      </Row>
      {settings.djVoice === 'natural' && !voice?.installed && (
        <Row
          title="Voice model"
          hint={
            progress
              ? `${progress.stage}${pct !== null && installingNow ? ` ${pct} %` : ''}`
              : 'Downloads once, about 330 MB. Runs on the processor, no extra software needed.'
          }
        >
          <button
            className="btn btn--accent"
            disabled={installingNow}
            onClick={async () => {
              const ok = await window.pulse.dj.installVoice()
              setVoice(await window.pulse.dj.voiceStatus())
              if (ok) setProgress(null)
            }}
          >
            {installingNow ? 'Downloading…' : 'Download voice'}
          </button>
        </Row>
      )}
      {settings.djVoice === 'natural' && voice?.installed && (
        <div className="srow srow--stack">
          <div className="srow__text">
            <span className="srow__title">Voice</span>
            <span className="srow__hint">{voiceError ?? 'Play a sample, then pick the one you like. The first sample takes a few seconds.'}</span>
          </div>
          {(['female', 'male'] as const).map((g) => (
            <div key={g} className="voices">
              {voice.voices
                .filter((v) => v.gender === g)
                .map((v) => (
                  <div
                    key={v.id}
                    role="radio"
                    aria-checked={settings.djSpeaker === v.id}
                    tabIndex={0}
                    className={`voice ${settings.djSpeaker === v.id ? 'is-on' : ''}`}
                    onClick={() => void update({ djSpeaker: v.id })}
                    onKeyDown={(e) => e.key === 'Enter' && void update({ djSpeaker: v.id })}
                  >
                    <span className={`voice__face voice__face--${v.gender}`} aria-hidden="true">
                      {v.name[0]}
                    </span>
                    <span className="voice__text">
                      <b>{v.name}</b>
                      <small>
                        {v.gender === 'female' ? 'Female' : 'Male'}, {v.accent}
                      </small>
                    </span>
                    <button
                      className={`voice__play ${previewing === v.id ? 'is-busy' : ''}`}
                      aria-label={`Play a sample of ${v.name}`}
                      onClick={async (e) => {
                        e.stopPropagation()
                        setPreviewing(v.id)
                        setVoiceError(null)
                        const err = await previewVoice(v.id)
                        setPreviewing(null)
                        if (err) setVoiceError(`Couldn’t play the sample: ${err}`)
                      }}
                    >
                      {previewing === v.id ? '…' : '▶'}
                    </button>
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}
      <Row title="How much the DJ talks" hint="Often talks before every song, Sometimes every third song, Rarely only when a new set starts.">
        <Segmented<'often' | 'sometimes' | 'rarely'>
          id="djc"
          value={settings.djChattiness}
          onChange={(djChattiness) => void update({ djChattiness })}
          options={[
            { value: 'often', label: 'Often' },
            { value: 'sometimes', label: 'Sometimes' },
            { value: 'rarely', label: 'Rarely' }
          ]}
        />
      </Row>
    </section>
  )
}

/** Says whether Pulse reached Discord, and what to do when Discord shows Spotify instead. */
function DiscordHint({ on }: { on: boolean }): React.JSX.Element {
  const [st, setSt] = useState<Awaited<ReturnType<typeof window.pulse.discord.status>> | null>(null)
  useEffect(() => {
    if (!on) return setSt(null)
    let alive = true
    const read = (): void => void window.pulse.discord?.status().then((s) => alive && setSt(s))
    read()
    const t = window.setInterval(read, 3000)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [on])
  if (!on || !st) return <>Shows the song, its cover and links to it on your Discord profile.</>
  if (st.state === 'not-running' || st.state === 'connecting') return <>Waiting for the Discord app… (it has to run on this computer)</>
  if (st.error) return <>Discord refused the status: {st.error}</>
  return (
    <>
      {st.shown ? 'On your profile now.' : 'Connected to Discord.'} Seeing “Spotify” instead? In Discord: Settings → Connections → Spotify → turn off “Display
      Spotify as your status”.
    </>
  )
}
