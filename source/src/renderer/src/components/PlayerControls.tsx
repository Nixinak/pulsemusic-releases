// Transport, progress, volume and device controls shared by the player bar and Now Playing.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import {
  cycleRepeat,
  nextTrack,
  previousTrack,
  seekTo,
  setSleepTimer,
  setVolume,
  sleepRemaining,
  togglePlay,
  toggleShuffle,
  transferTo,
  usePlayer
} from '@/lib/player'
import { getDevices } from '@/lib/spotify'
import type { SDevice } from '@/lib/types'
import { formatTime } from '@/lib/format'
import { Slider, useLivePosition } from './common'
import { Glass } from './Glass'
import {
  CheckIcon,
  ComputerIcon,
  MoonIcon,
  DevicesIcon,
  NextIcon,
  PauseIcon,
  PhoneIcon,
  PlayIcon,
  PrevIcon,
  RepeatIcon,
  ShuffleIcon,
  SpeakerIcon,
  VolumeIcon
} from './Icons'

export function Transport({ big = false }: { big?: boolean }): React.JSX.Element {
  const paused = usePlayer((s) => s.paused)
  const shuffle = usePlayer((s) => s.shuffle)
  const repeat = usePlayer((s) => s.repeat)
  const hasTrack = usePlayer((s) => !!s.track)
  const s = big ? 26 : 20

  return (
    <div className={`transport ${big ? 'transport--big' : ''}`}>
      <button className="icon-btn" aria-label="Shuffle" aria-pressed={shuffle} onClick={() => void toggleShuffle()} disabled={!hasTrack}>
        <ShuffleIcon size={big ? 22 : 18} />
      </button>
      <button className="icon-btn icon-btn--strong" aria-label="Previous" onClick={() => void previousTrack()} disabled={!hasTrack}>
        <PrevIcon size={s} />
      </button>
      <button className="transport__play" aria-label={paused ? 'Play' : 'Pause'} onClick={() => void togglePlay()} disabled={!hasTrack}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={paused ? 'play' : 'pause'}
            initial={{ scale: 0.4, opacity: 0, rotate: -30 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            exit={{ scale: 0.4, opacity: 0, rotate: 30 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            style={{ display: 'grid' }}
          >
            {paused ? <PlayIcon size={big ? 30 : 22} /> : <PauseIcon size={big ? 30 : 22} />}
          </motion.span>
        </AnimatePresence>
      </button>
      <button className="icon-btn icon-btn--strong" aria-label="Next" onClick={() => void nextTrack()} disabled={!hasTrack}>
        <NextIcon size={s} />
      </button>
      <button
        className="icon-btn"
        aria-label={`Repeat: ${repeat}`}
        aria-pressed={repeat !== 'off'}
        onClick={() => void cycleRepeat()}
        disabled={!hasTrack}
      >
        <RepeatIcon size={big ? 22 : 18} one={repeat === 'track'} />
      </button>
    </div>
  )
}

export function Progress({ className = '' }: { className?: string }): React.JSX.Element {
  const duration = usePlayer((s) => s.track?.durationMs ?? 0)
  const position = useLivePosition()
  const [preview, setPreview] = useState<number | null>(null)
  return (
    <div className={`progress ${className}`}>
      <span className="progress__time">{formatTime(preview ?? position)}</span>
      <Slider value={position} max={duration} onCommit={(v) => void seekTo(v)} onPreview={setPreview} label="Seek" />
      <span className="progress__time progress__time--end">-{formatTime(duration - (preview ?? position))}</span>
    </div>
  )
}

export function Volume(): React.JSX.Element {
  const volume = usePlayer((s) => s.volume)
  const before = useRef(0.7)
  const level = volume === 0 ? 0 : volume < 0.5 ? 0.5 : 1
  return (
    <div className="volume">
      <button
        className="icon-btn"
        aria-label={volume === 0 ? 'Unmute' : 'Mute'}
        onClick={() => {
          if (volume > 0) {
            before.current = volume
            setVolume(0)
          } else setVolume(before.current || 0.6)
        }}
      >
        <VolumeIcon size={19} level={level} />
      </button>
      <Slider value={volume} max={1} onCommit={setVolume} onPreview={(v) => v !== null && setVolume(v)} label="Volume" className="slider--volume" />
    </div>
  )
}

const deviceIcon = (type: string): React.JSX.Element => {
  const t = type.toLowerCase()
  if (t === 'smartphone' || t === 'tablet') return <PhoneIcon size={20} />
  if (t === 'speaker' || t === 'avr' || t === 'tv' || t === 'stb' || t === 'castaudio') return <SpeakerIcon size={20} />
  return <ComputerIcon size={20} />
}

export function DevicePicker(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [devices, setDevices] = useState<SDevice[] | null>(null)
  const [pos, setPos] = useState<{ right: number; bottom: number } | null>(null)
  const localId = usePlayer((s) => s.localDeviceId)
  const active = usePlayer((s) => s.activeDevice)
  const isLocal = usePlayer((s) => s.isLocal)
  const btn = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setDevices(null)
    getDevices()
      .then((r) => setDevices(r.devices))
      .catch(() => setDevices([]))
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (!panel.current?.contains(t) && !btn.current?.contains(t)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = (): void => {
    const r = btn.current?.getBoundingClientRect()
    if (r) {
      setPos({
        right: Math.max(12, window.innerWidth - r.right - 40),
        bottom: window.innerHeight - r.top + 14
      })
    }
    setOpen((o) => !o)
  }

  const list = devices ?? []
  const hasLocal = list.some((d) => d.id === localId)
  const shown: SDevice[] =
    localId && !hasLocal
      ? [{ id: localId, name: 'Pulse Music', type: 'Computer', is_active: isLocal, volume_percent: null, supports_volume: true }, ...list]
      : list

  return (
    <>
      <button ref={btn} className="icon-btn" aria-label="Connect to a device" aria-pressed={!!active && !isLocal} onClick={toggle}>
        <DevicesIcon size={19} />
      </button>
      {createPortal(
        <AnimatePresence>
          {open && pos && (
            <motion.div
              ref={panel}
              className="popover"
              style={{ right: pos.right, bottom: pos.bottom }}
              initial={{ opacity: 0, y: 10, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            >
              <Glass radius={20} tone="thick" bezel={16} refraction={40} className="devices__panel">
                <div className="devices__title">Play on</div>
                {devices === null && <div className="devices__empty">Looking for devices…</div>}
                {devices !== null && shown.length === 0 && (
                  <div className="devices__empty">Open Spotify on your phone or another computer to see it here.</div>
                )}
                {shown.map((d) => {
                  const current = d.is_active || (d.id === localId && isLocal)
                  return (
                    <button
                      key={d.id ?? d.name}
                      className={`device ${current ? 'is-active' : ''}`}
                      disabled={!d.id || current}
                      onClick={() => {
                        if (d.id) void transferTo(d.id)
                        setOpen(false)
                      }}
                    >
                      {deviceIcon(d.type)}
                      <span className="device__text">
                        <span>{d.id === localId ? 'This computer' : d.name}</span>
                        <span className="device__sub">{d.id === localId ? 'Pulse Music' : d.type}</span>
                      </span>
                      {current && <CheckIcon size={18} />}
                    </button>
                  )
                })}
              </Glass>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  )
}

export function RemoteBadge(): React.JSX.Element | null {
  const active = usePlayer((s) => s.activeDevice)
  const isLocal = usePlayer((s) => s.isLocal)
  if (!active || isLocal) return null
  return (
    <span className="remote-badge">
      <SpeakerIcon size={13} />
      Playing on {active.name}
    </span>
  )
}

/** Sleep timer: a moon button with the time left, and a small menu of durations. */
export function SleepTimer(): React.JSX.Element {
  const sleep = usePlayer((s) => s.sleep)
  const hasTrack = usePlayer((s) => !!s.track)
  const [open, setOpen] = useState(false)
  const [left, setLeft] = useState<number | null>(null)
  const [pos, setPos] = useState<{ right: number; bottom: number } | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!sleep) return setLeft(null)
    const t = window.setInterval(() => setLeft(sleepRemaining()), 500)
    setLeft(sleepRemaining())
    return () => clearInterval(t)
  }, [sleep])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (!panel.current?.contains(t) && !btn.current?.contains(t)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = (): void => {
    const r = btn.current?.getBoundingClientRect()
    if (r) setPos({ right: Math.max(12, window.innerWidth - r.right - 60), bottom: window.innerHeight - r.top + 14 })
    setOpen((o) => !o)
  }
  const pick = (v: number | 'track' | null): void => {
    setSleepTimer(v)
    setOpen(false)
  }
  const label = left === null ? null : sleep?.mode === 'track' ? 'End' : formatTime(left)

  return (
    <>
      <button
        ref={btn}
        className={`icon-btn sleep-btn ${sleep ? 'is-set' : ''}`}
        aria-label="Sleep timer"
        title={sleep ? 'Sleep timer is on' : 'Sleep timer'}
        aria-pressed={!!sleep}
        onClick={toggle}
      >
        <MoonIcon size={18} />
        {label && <span className="sleep-btn__left">{label}</span>}
      </button>
      {createPortal(
        <AnimatePresence>
          {open && pos && (
            <motion.div
              ref={panel}
              className="popover"
              style={{ right: pos.right, bottom: pos.bottom }}
              initial={{ opacity: 0, y: 10, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            >
              <Glass radius={20} tone="thick" bezel={16} refraction={40} className="devices__panel sleep__panel">
                <div className="devices__title">Stop the music</div>
                {sleep && left !== null && (
                  <div className="sleep__now">
                    <strong>{sleep.mode === 'track' ? 'At the end of this song' : `In ${formatTime(left)}`}</strong>
                    <span>The music fades out, then pauses.</span>
                  </div>
                )}
                <div className="sleep__grid">
                  {[15, 30, 45, 60, 90].map((m) => (
                    <button key={m} className="sleep__opt" onClick={() => pick(m)}>
                      <b>{m}</b>
                      <small>min</small>
                    </button>
                  ))}
                  <button className="sleep__opt sleep__opt--wide" disabled={!hasTrack} onClick={() => pick('track')}>
                    End of song
                  </button>
                </div>
                {sleep && (
                  <button className="device sleep__off" onClick={() => pick(null)}>
                    Turn off
                  </button>
                )}
              </Glass>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  )
}
