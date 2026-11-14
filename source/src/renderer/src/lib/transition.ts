// Shared state of a song transition, driven once and shown by the floating card or Now Playing.
import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { fadeMs, livePosition, usePlayer } from './player'
import { useApp } from './store'

export interface Side {
  id: string
  name: string
  artists: string
  artUrl: string | null
}

export type Phase =
  | { kind: 'idle' }
  | { kind: 'approach'; from: Side; to: Side }
  | { kind: 'land'; from: Side; to: Side }

export const useTransition = create<{ phase: Phase; progress: number }>(() => ({
  phase: { kind: 'idle' },
  progress: 0
}))

const set = useTransition.setState

/** Mount once (in the app shell). */
export function useTransitionDriver(): void {
  const enabled = useApp((s) => s.settings.crossfade)
  const track = usePlayer((s) => s.track)
  const nextUp = usePlayer((s) => s.nextUp)

  // Follow the remaining time of the current song.
  useEffect(() => {
    if (!enabled) {
      set({ phase: { kind: 'idle' }, progress: 0 })
      return
    }
    let raf = 0
    let endedAt = 0
    const tick = (): void => {
      const s = usePlayer.getState()
      const f = fadeMs()
      const cur = useTransition.getState().phase
      // paused or a seek back: the hand-over is off until the end comes near again
      if (cur.kind === 'approach' && (s.paused || !s.nextUp)) set({ phase: { kind: 'idle' } })
      else if (cur.kind !== 'land' && s.track && s.nextUp && !s.paused && s.repeat !== 'track' && f > 0) {
        const remaining = s.track.durationMs - livePosition(s)
        // at the very end it waits (up to 8 s) for Spotify to report the next song
        if (remaining > 50) endedAt = 0
        else endedAt ||= Date.now()
        if (remaining < f && (!endedAt || Date.now() - endedAt < 8000)) {
          const progress = Math.min(1, 1 - remaining / f)
          if (cur.kind !== 'approach' || cur.to.id !== s.nextUp.id) {
            set({
              progress,
              phase: {
                kind: 'approach',
                from: {
                  id: s.track.id,
                  name: s.track.name,
                  artists: s.track.artists.map((a) => a.name).join(', '),
                  artUrl: s.track.artUrl
                },
                to: s.nextUp
              }
            })
          } else {
            set({ progress })
          }
        } else if (cur.kind === 'approach') {
          set({ phase: { kind: 'idle' } })
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [enabled])

  // The song changed: play the landing, then go back to normal.
  const prev = useRef<Side | null>(null)
  useEffect(() => {
    const before = prev.current
    prev.current = track
      ? { id: track.id, name: track.name, artists: track.artists.map((a) => a.name).join(', '), artUrl: track.artUrl }
      : null
    if (!track || !before || before.id === track.id || !useApp.getState().settings.crossfade) return
    const cur = useTransition.getState().phase
    // Only a song running into the next one gets the hand-over card; skips and picking
    // another song just change (the colour bloom marks those), so clicking doesn't spam it.
    if (cur.kind !== 'approach') {
      set({ phase: { kind: 'idle' }, progress: 0 })
      return
    }
    const to: Side = { id: track.id, name: track.name, artists: prev.current!.artists, artUrl: track.artUrl }
    set({ progress: 1, phase: { kind: 'land', from: cur.from, to } })
    // Keep the animation up until the next song has finished fading in.
    const t = window.setTimeout(() => set({ phase: { kind: 'idle' } }), Math.max(1700, fadeMs() / 2 + 300))
    return () => clearTimeout(t)
  }, [track?.id])

  useEffect(() => {
    if (!nextUp && useTransition.getState().phase.kind === 'approach') set({ phase: { kind: 'idle' } })
  }, [nextUp])
}
