// The turntable and the CD deck for Now Playing, drawn in detail: brushed metal, a platter with
// strobe dots, a record with grooves and a light reflection that stays put while it turns, an
// S-shaped tonearm that drops onto the record and creeps inwards as the song plays; a top-loading
// CD deck with a smoked lid, a disc with a rainbow shimmer, a glowing display and level meters.
// Sounds to go with them are in lib/npSounds.
import { useEffect, useRef } from 'react'
import { useLivePosition } from './common'
import { formatTime } from '@/lib/format'
import { usePlayer } from '@/lib/player'
import { useApp } from '@/lib/store'
import { BANDS, readBeat, useBeat } from '@/lib/beat'
import { scratchMove, scratchStart, scratchStop } from '@/lib/npSounds'

/* ================= Turntable ================= */

/** Strobe dots around the platter edge (they turn with it). */
const STROBE = Array.from({ length: 120 }, (_, i) => i * 3)

/** 33⅓ turns a minute, in degrees a second. */
const SPEED = 200

/**
 * Turns the record (with weight: it speeds up and slows down instead of jumping) and, when
 * scratching is on, lets you grab it: it follows your hand, and the sound follows how fast and
 * which way you move it.
 */
function useRecord(spin: React.RefObject<HTMLDivElement | null>, paused: boolean, scratch: boolean, sounds: boolean): void {
  const live = useRef({ paused, scratch, sounds })
  live.current = { paused, scratch, sounds }
  useEffect(() => {
    const el = spin.current
    if (!el) return
    const reduce = useApp.getState().settings.reduceMotion
    let angle = 0
    let vel = 0
    let raf = 0
    let last = performance.now()
    let hold: { id: number; pointer: number; at: number; vel: number } | null = null
    const center = (): { x: number; y: number } => {
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    }
    const pointerAngle = (e: PointerEvent): number => {
      const c = center()
      return (Math.atan2(e.clientY - c.y, e.clientX - c.x) * 180) / Math.PI
    }
    const tick = (): void => {
      raf = requestAnimationFrame(tick)
      const now = performance.now()
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (hold) {
        // your hand slows down: the sound follows it towards silence
        hold.vel *= Math.pow(0.02, dt)
        if (now - hold.at > 40) scratchMove(hold.vel / SPEED)
      } else {
        const want = live.current.paused || reduce ? 0 : SPEED
        // a motor with weight: about a second to get up to speed, a bit longer to stop
        vel += (want - vel) * Math.min(1, dt * (want > vel ? 2.6 : 1.6))
        angle += vel * dt
      }
      el.style.transform = `rotate(${angle % 360}deg)`
    }
    const down = (e: PointerEvent): void => {
      if (!live.current.scratch || e.button !== 0) return
      e.preventDefault()
      el.setPointerCapture(e.pointerId)
      hold = { id: e.pointerId, pointer: pointerAngle(e), at: performance.now(), vel: 0 }
      el.classList.add('is-held')
      if (live.current.sounds) scratchStart()
    }
    const move = (e: PointerEvent): void => {
      if (!hold || e.pointerId !== hold.id) return
      const a = pointerAngle(e)
      let d = a - hold.pointer
      if (d > 180) d -= 360
      if (d < -180) d += 360
      const now = performance.now()
      const dt = Math.max(0.004, (now - hold.at) / 1000)
      angle += d
      // the hand's speed, smoothed a little
      hold.vel = hold.vel * 0.4 + (d / dt) * 0.6
      hold.pointer = a
      hold.at = now
      if (live.current.sounds) scratchMove(hold.vel / SPEED)
    }
    const up = (e: PointerEvent): void => {
      if (!hold || e.pointerId !== hold.id) return
      // let go with a push: it carries on from your hand's speed
      vel = Math.max(-SPEED * 3, Math.min(SPEED * 3, hold.vel))
      hold = null
      el.classList.remove('is-held')
      scratchStop()
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      scratchStop()
    }
  }, [spin])
}

export function Turntable({ art, paused }: { art: string | null; paused: boolean }): React.JSX.Element {
  const spin = useRef<HTMLDivElement>(null)
  const scratch = useApp((s) => s.settings.npScratch) ?? true
  const sounds = useApp((s) => s.settings.npSounds) ?? true
  useRecord(spin, paused, scratch, sounds)
  const pos = useLivePosition()
  const dur = usePlayer((s) => s.track?.durationMs ?? 0)
  // the arm rests off the record while paused; playing, it creeps inwards with the song
  const progress = dur ? Math.min(1, pos / dur) : 0
  const armAngle = paused ? -17 : progress * 7

  return (
    <div className={`tt ${paused ? 'is-paused' : ''} ${scratch ? 'can-scratch' : ''}`} aria-hidden="true">
      <svg className="tt__base" viewBox="0 0 1000 1000">
        <defs>
          <linearGradient id="ttBody" x1="0" y1="0" x2="0.35" y2="1">
            <stop offset="0" stopColor="#36373c" />
            <stop offset="0.45" stopColor="#1d1e22" />
            <stop offset="1" stopColor="#121316" />
          </linearGradient>
          <pattern id="ttBrush" width="6" height="1000" patternUnits="userSpaceOnUse">
            <rect width="6" height="1000" fill="transparent" />
            <rect x="0" width="1" height="1000" fill="rgba(255,255,255,0.025)" />
            <rect x="3" width="1" height="1000" fill="rgba(0,0,0,0.12)" />
          </pattern>
          <radialGradient id="ttRim" cx="0.35" cy="0.3" r="0.9">
            <stop offset="0" stopColor="#f1f2f5" />
            <stop offset="0.4" stopColor="#a8abb3" />
            <stop offset="0.75" stopColor="#5c5f67" />
            <stop offset="1" stopColor="#2b2d31" />
          </radialGradient>
          <linearGradient id="ttChrome" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fafbfd" />
            <stop offset="0.35" stopColor="#9da1a9" />
            <stop offset="0.6" stopColor="#e6e8ec" />
            <stop offset="1" stopColor="#5a5d64" />
          </linearGradient>
          <linearGradient id="ttButton" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#d9dbe0" />
            <stop offset="1" stopColor="#7d8088" />
          </linearGradient>
          <radialGradient id="ttKnob" cx="0.35" cy="0.3" r="0.8">
            <stop offset="0" stopColor="#6a6c72" />
            <stop offset="1" stopColor="#1a1b1e" />
          </radialGradient>
          <filter id="ttSoft" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="10" />
          </filter>
        </defs>
        {/* shadow on the "table" and the body */}
        <rect x="40" y="70" width="920" height="900" rx="40" fill="rgba(0,0,0,0.55)" filter="url(#ttSoft)" />
        <rect x="20" y="40" width="960" height="900" rx="34" fill="url(#ttBody)" />
        <rect x="20" y="40" width="960" height="900" rx="34" fill="url(#ttBrush)" />
        <rect x="21.5" y="41.5" width="957" height="897" rx="33" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="2" />
        {/* dust cover hinges */}
        <rect x="170" y="30" width="90" height="22" rx="5" fill="#0d0e10" stroke="rgba(255,255,255,0.08)" />
        <rect x="740" y="30" width="90" height="22" rx="5" fill="#0d0e10" stroke="rgba(255,255,255,0.08)" />
        {/* the platter's sunken ring and silver rim */}
        <circle cx="420" cy="470" r="388" fill="#0a0a0c" />
        <circle cx="420" cy="470" r="376" fill="url(#ttRim)" />
        <circle cx="420" cy="470" r="360" fill="#1b1c1f" />
        {/* strobe light shining on the edge */}
        <g className="tt__strobe-lamp">
          <rect x="66" y="790" width="54" height="54" rx="10" fill="url(#ttKnob)" stroke="rgba(255,255,255,0.15)" />
          <circle cx="93" cy="817" r="11" fill="#ff7a2e" className="tt__lamp" />
        </g>
        {/* start / stop and speed buttons */}
        <rect x="150" y="852" width="150" height="56" rx="7" fill="url(#ttButton)" stroke="rgba(0,0,0,0.5)" />
        <text x="225" y="886" textAnchor="middle" className="tt__label">START · STOP</text>
        <rect x="318" y="862" width="70" height="38" rx="6" fill="url(#ttButton)" stroke="rgba(0,0,0,0.5)" />
        <text x="353" y="887" textAnchor="middle" className="tt__label">33</text>
        <rect x="398" y="862" width="70" height="38" rx="6" fill="url(#ttButton)" stroke="rgba(0,0,0,0.5)" />
        <text x="433" y="887" textAnchor="middle" className="tt__label">45</text>
        <circle cx="353" cy="850" r="4" className="tt__led" />
        {/* pitch slider */}
        <rect x="910" y="560" width="26" height="300" rx="7" fill="#08090a" stroke="rgba(255,255,255,0.1)" />
        {Array.from({ length: 11 }, (_, i) => (
          <rect key={i} x={i === 5 ? 884 : 890} y={572 + i * 27.6} width={i === 5 ? 20 : 14} height="2" fill="rgba(255,255,255,0.35)" />
        ))}
        <rect x="900" y="696" width="46" height="34" rx="5" fill="url(#ttChrome)" stroke="rgba(0,0,0,0.6)" />
        <rect x="904" y="711" width="38" height="3" fill="rgba(0,0,0,0.5)" />
        <text x="923" y="890" textAnchor="middle" className="tt__label tt__label--dim">PITCH</text>
        {/* power knob and target light */}
        <circle cx="96" cy="120" r="34" fill="url(#ttKnob)" stroke="rgba(255,255,255,0.14)" />
        <rect x="93" y="92" width="6" height="22" rx="3" fill="#e9eaee" />
        <text x="96" y="182" textAnchor="middle" className="tt__label tt__label--dim">POWER</text>
        {/* arm base, anti-skate and lift lever */}
        <circle cx="850" cy="180" r="88" fill="#0e0f11" stroke="rgba(255,255,255,0.08)" strokeWidth="2" />
        <circle cx="850" cy="180" r="70" fill="url(#ttKnob)" />
        <circle cx="955" cy="300" r="24" fill="url(#ttKnob)" stroke="rgba(255,255,255,0.12)" />
        <rect x="953" y="280" width="4" height="14" rx="2" fill="#e9eaee" />
        <rect x="930" y="370" width="50" height="16" rx="8" fill="url(#ttChrome)" />
        {/* arm rest */}
        <circle cx="879" cy="492" r="17" fill="#0b0b0d" />
        <circle cx="879" cy="492" r="11" fill="url(#ttChrome)" />
        <text x="830" y="918" textAnchor="middle" className="tt__brand">PULSE · DIRECT DRIVE</text>
      </svg>

      {/* what turns: strobe dots, the record and its label */}
      <div className="tt__spin" ref={spin} title={scratch ? 'Grab the record and scratch' : undefined}>
        <svg className="tt__dots" viewBox="0 0 200 200">
          {STROBE.map((a) => (
            <circle key={a} cx="100" cy="1.7" r="0.85" transform={`rotate(${a} 100 100)`} />
          ))}
        </svg>
        <div className="tt__record">
          <span className="tt__grooves" />
          <span className="tt__label-disc">{art ? <img src={art} alt="" draggable={false} /> : null}</span>
        </div>
      </div>
      {/* light on the record stays where the lamp is */}
      <span className="tt__sheen" />
      <span className="tt__spindle" />

      <svg className="tt__arm" viewBox="0 0 1000 1000" style={{ transform: `rotate(${armAngle}deg)` }}>
        <defs>
          <linearGradient id="ttTube" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#7d8189" />
            <stop offset="0.45" stopColor="#ffffff" />
            <stop offset="1" stopColor="#6b6e75" />
          </linearGradient>
        </defs>
        {/* counterweight */}
        <rect x="818" y="40" width="64" height="70" rx="8" fill="url(#ttChrome)" stroke="rgba(0,0,0,0.5)" />
        {[52, 62, 72, 82, 92].map((y) => (
          <rect key={y} x="818" y={y} width="64" height="2" fill="rgba(0,0,0,0.35)" />
        ))}
        <rect x="842" y="105" width="16" height="40" fill="url(#ttChrome)" />
        {/* gimbal */}
        <circle cx="850" cy="180" r="40" fill="url(#ttChrome)" stroke="rgba(0,0,0,0.55)" strokeWidth="2" />
        <circle cx="850" cy="180" r="22" fill="#1a1b1e" />
        <circle cx="850" cy="180" r="9" fill="url(#ttChrome)" />
        {/* the S-shaped tube */}
        <path d="M850 205 C 858 330, 830 430, 760 520 S 700 590, 686 612" fill="none" stroke="rgba(0,0,0,0.6)" strokeWidth="17" strokeLinecap="round" />
        <path d="M850 205 C 858 330, 830 430, 760 520 S 700 590, 686 612" fill="none" stroke="url(#ttTube)" strokeWidth="12" strokeLinecap="round" />
        {/* headshell, finger lift and cartridge */}
        <g transform="translate(686 612) rotate(33)">
          <path d="M-22 -6 L22 -6 L26 62 L-26 62 Z" fill="#c9ccd2" stroke="rgba(0,0,0,0.6)" strokeWidth="2" />
          <path d="M22 4 L58 14 L56 22 L20 14 Z" fill="#d9dbe0" stroke="rgba(0,0,0,0.5)" />
          <rect x="-18" y="30" width="36" height="46" rx="4" fill="#b3122b" stroke="rgba(0,0,0,0.6)" strokeWidth="2" />
          <rect x="-18" y="30" width="36" height="10" fill="rgba(255,255,255,0.18)" />
          <rect x="-3" y="74" width="6" height="8" fill="#111" />
        </g>
      </svg>
    </div>
  )
}

/* ================= CD deck ================= */

export function CdDeck({ art, paused, title, artist, durationMs }: { art: string | null; paused: boolean; title: string; artist: string; durationMs: number }): React.JSX.Element {
  const pos = useLivePosition()
  const reduce = useApp((s) => s.settings.reduceMotion)
  useBeat(!reduce && !paused)
  const meters = useRef<HTMLDivElement>(null)
  // the level meters follow the music (left: the low end, right: the mids and highs)
  useEffect(() => {
    const el = meters.current
    if (!el || reduce) return
    const rows = Array.from(el.querySelectorAll<HTMLElement>('.cdd__meters > span'))
    const lv = [0, 0]
    let raf = 0
    const avg = (bands: Float32Array, a: number, z: number): number => {
      let s = 0
      for (let k = a; k < z; k++) s += bands[k]
      return s / (z - a)
    }
    const tick = (): void => {
      raf = requestAnimationFrame(tick)
      const b = readBeat()
      const want = paused ? [0, 0] : [Math.min(1, avg(b.bands, 0, 18) * 1.35 + b.kick * 0.15), Math.min(1, avg(b.bands, 10, Math.min(BANDS, 40)) * 1.5 + b.kick * 0.1)]
      rows.forEach((row, r) => {
        // quick up, slow down, like a real meter
        lv[r] += (want[r] - lv[r]) * (want[r] > lv[r] ? 0.6 : 0.12)
        const lit = Math.round(lv[r] * row.children.length)
        for (let j = 0; j < row.children.length; j++) row.children[j].classList.toggle('on', j < lit)
      })
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [paused, reduce])
  const text = `${title} — ${artist}`
  const long = text.length > 24
  return (
    <div className={`cdd ${paused ? 'is-paused' : ''}`} aria-hidden="true">
      <div className="cdd__body">
        <span className="cdd__brush" />
        <div className="cdd__well">
          <div className="cdd__disc">
            <span className="cdd__data" />
            <span className="cdd__print">{art && <img src={art} alt="" draggable={false} />}</span>
            <span className="cdd__hub" />
          </div>
          {/* the shimmer and the lid don't turn */}
          <span className="cdd__rainbow" />
          <span className="cdd__lid" />
          <span className="cdd__hinge" />
        </div>
        <div className="cdd__panel">
          <div className="cdd__vfd">
            <div className="cdd__row">
              <span className="cdd__tag">CD</span>
              <span className="cdd__tag">{paused ? '❚❚' : '▶'}</span>
              <span className="cdd__time">{formatTime(pos)}</span>
              <span className="cdd__total">-{formatTime(Math.max(0, durationMs - pos))}</span>
            </div>
            <div className="cdd__marquee">
              <span key={text} className={long ? 'is-long' : ''}>
                {text}
                {long && <>&nbsp;&nbsp;&nbsp;·&nbsp;&nbsp;&nbsp;{text}</>}
              </span>
            </div>
            <div className="cdd__meters" ref={meters}>
              <small>L</small>
              <span>
                {Array.from({ length: 14 }, (_, i) => (
                  <i key={i} />
                ))}
              </span>
              <small>R</small>
              <span>
                {Array.from({ length: 14 }, (_, i) => (
                  <i key={i} />
                ))}
              </span>
            </div>
          </div>
          <div className="cdd__buttons">
            {['⏮', paused ? '▶' : '❚❚', '⏭', '■', '●'].map((g, i) => (
              <span key={i} className={`cdd__btn ${i === 4 ? 'cdd__btn--rec' : ''}`}>
                {g}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
