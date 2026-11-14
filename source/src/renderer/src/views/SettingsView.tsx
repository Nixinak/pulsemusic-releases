import { useEffect, useState } from 'react'
import { AiSetup } from '@/components/AiSetup'
import { previewVoice, testDj } from '@/lib/dj'
import { motion } from 'motion/react'
import { useApp } from '@/lib/store'
import { usePlayer } from '@/lib/player'
import { pickImage } from '@/lib/spotify'
import type { FontChoice, GlassQuality, LastfmStatus, ThemeMode, VoiceStatus } from '@shared/types'
import { FONTS } from '@/components/CommandPalette'
import { Glass } from '@/components/Glass'
import { Cover } from '@/components/common'
import { PalettePicker } from '@/components/PalettePicker'
import { useProfile } from '@/lib/profile'

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
          {value === o.value && <motion.span layoutId={`seg-${id}`} className="segmented__thumb" transition={{ type: 'spring', stiffness: 500, damping: 36 }} />}
          <span>{o.label}</span>
        </button>
      ))}
    </Glass>
  )
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }): React.JSX.Element {
  return (
    <button role="switch" aria-checked={on} aria-label={label} className={`toggle ${on ? 'is-on' : ''}`} onClick={() => onChange(!on)}>
      <motion.span className="toggle__knob" layout transition={{ type: 'spring', stiffness: 600, damping: 32 }} />
    </button>
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

  return (
    <div className="settings">
      <h1 className="page-title">Settings</h1>

      <section className="sgroup">
        <h2>Appearance</h2>
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
          <Toggle
            label="Compact mode"
            on={settings.density === 'compact'}
            onChange={(on) => void update({ density: on ? 'compact' : 'comfortable' })}
          />
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

      <section className="sgroup">
        <h2>Playback</h2>
        <Row title="Autoplay" hint="When a song, album or playlist ends with nothing after it, keep playing similar songs.">
          <Toggle label="Autoplay" on={settings.autoplay !== false} onChange={(autoplay) => void update({ autoplay })} />
        </Row>
        <Row title="Song transitions" hint="Fades one song into the next and shows both covers while it happens. Off by default.">
          <Toggle label="Song transitions" on={settings.crossfade} onChange={(crossfade) => void update({ crossfade })} />
        </Row>
        <Row title="Transition length" hint="Spotify plays one song at a time, so the end of a song fades out as the next fades in. The sound fades only when Pulse Music itself is playing.">
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
      </section>

      <section className="sgroup">
        <h2>Lyrics</h2>
        <Row title="Word by word" hint="Lights up each word as it is sung. Uses exact word timings when LRCLIB has them, otherwise follows the line.">
          <Toggle label="Word by word lyrics" on={settings.wordLyrics} onChange={(wordLyrics) => void update({ wordLyrics })} />
        </Row>
        <Row title="Genius token (optional)" hint="Genius lyrics and artist info work without it. Only add your own token if Genius starts refusing Pulse. Stored only on this computer.">
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

      <DjSettings />

      <LastfmSettings />

      <section className="sgroup">
        <h2>Integrations</h2>
        <Row title="Discord status" hint={<DiscordHint on={settings.discordRpc} />}>
          <Toggle label="Discord status" on={settings.discordRpc} onChange={(discordRpc) => void update({ discordRpc })} />
        </Row>
        {settings.discordRpc && (
          <Row title="Get Pulse Music button" hint="Adds a button to your Discord status that opens the Pulse Music download page. Friends see it on your profile; Discord hides your own buttons from you.">
            <Toggle label="Get Pulse Music button" on={settings.discordGetButton ?? true} onChange={(discordGetButton) => void update({ discordGetButton })} />
          </Row>
        )}
      </section>

      <section className="sgroup">
        <h2>System</h2>
        <Row title="Open at startup" hint="Starts Pulse Music when you sign in to Windows. Works in the installed app.">
          <Toggle label="Open at startup" on={settings.launchAtStartup} onChange={(launchAtStartup) => void update({ launchAtStartup })} />
        </Row>
        <Row title="Player" hint={sdkError ?? (sdkReady ? 'Ready. Pulse Music shows up as a device in Spotify Connect.' : 'Starting…')}>
          <span className={`status-dot ${sdkError ? 'is-bad' : sdkReady ? 'is-ok' : ''}`} />
        </Row>
      </section>

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

      <p className="fineprint">Pulse Music {version}. Updates install themselves. Music and metadata provided by Spotify. Lyrics from LRCLIB and Genius.</p>
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
        <Row title="Connect Last.fm" hint="Sends the songs you listen to (after half of a song or 4 minutes) to your Last.fm profile. A browser opens to allow it.">
          <div className="token">
            <button className="btn btn--accent" disabled={busy} onClick={() => void connect()}>
              {busy ? 'Waiting for Last.fm…' : 'Connect'}
            </button>
            {error && <span className="aisetup__err">{error}</span>}
          </div>
        </Row>
      ) : (
        <>
          <Row title={`Connected as ${st.user}`} hint={st.pending ? `${st.pending} scrobbles waiting to be sent.` : 'Your listening goes to your Last.fm profile.'}>
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
  const [progress, setProgress] = useState<{ stage: string; done: number; total: number } | null>(null)
  const [previewing, setPreviewing] = useState<string | null>(null)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [test, setTest] = useState<{ busy: boolean; text: string | null; error: boolean }>({ busy: false, text: null, error: false })

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
              setTest({ busy: false, text: `“${await testDj()}”`, error: false })
            } catch (e) {
              setTest({ busy: false, text: e instanceof Error ? e.message : String(e), error: true })
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
      {st.shown ? 'On your profile now.' : 'Connected to Discord.'} Seeing “Spotify” instead? In Discord: Settings → Connections → Spotify → turn off “Display Spotify as your status”.
    </>
  )
}
