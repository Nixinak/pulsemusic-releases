// Taste match on someone's profile: how close your music is to theirs (a percentage), the artists
// you share, and a blend to play: their favourite songs and yours, taken in turns.
// Their side is the snapshot their Pulse profile publishes (top artists and songs); yours comes
// from your listening history (the last six months), or Spotify's list while it's still short.
import { useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import type { PulseProfile } from '@shared/types'
import { artistKey, computeStats, useHistory } from '@/lib/history'
import * as sp from '@/lib/spotify'
import { playUris } from '@/lib/player'
import { useApp } from '@/lib/store'
import { Cover } from './common'
import { PlayIcon } from './Icons'

interface Mine {
  artists: { key: string; name: string; id: string }[]
  tracks: string[]
}

/** Your top artists and songs. */
function useMine(): Mine | null {
  const plays = useHistory((s) => s.plays)
  const loaded = useHistory((s) => s.loaded)
  const [spotify, setSpotify] = useState<Mine | null>(null)
  const fromHistory = useMemo(() => {
    if (!loaded) return null
    const st = computeStats(plays, Date.now() - 182 * 86_400_000)
    if (st.artists.length < 15) return null
    return {
      artists: st.artists.slice(0, 60).map((a) => ({
        key: artistKey(a.item),
        name: a.item.name,
        id: a.item.id
      })),
      tracks: st.songs
        .slice(0, 40)
        .map((x) => (x.item.id && !x.item.id.startsWith('x:') ? `spotify:track:${x.item.id}` : ''))
        .filter(Boolean)
    }
  }, [plays, loaded])
  useEffect(() => {
    if (!loaded || fromHistory) return
    let alive = true
    void Promise.all([sp.getTopArtists('medium_term', 50).catch(() => null), sp.getTopTracks('medium_term', 40).catch(() => null)]).then(([a, t]) => {
      if (!alive || !a) return
      setSpotify({
        artists: (a.items ?? []).filter(Boolean).map((x) => ({ key: artistKey(x), name: x.name, id: x.id })),
        tracks: (t?.items ?? []).filter(Boolean).map((x) => x.uri)
      })
    })
    return () => {
      alive = false
    }
  }, [loaded, fromHistory])
  return fromHistory ?? spotify
}

/** 0–100: how much of their favourites are among yours, the top ones counting most. */
function score(mine: Mine, theirs: PulseProfile['snapshot']['topArtists']): { pct: number; shared: typeof theirs } {
  const myRank = new Map(mine.artists.map((a, i) => [a.key, i]))
  let got = 0
  let max = 0
  const shared: typeof theirs = []
  theirs.forEach((a, i) => {
    const w = 1 / Math.sqrt(i + 1)
    max += w
    const r = myRank.get(artistKey(a))
    if (r === undefined) return
    shared.push(a)
    got += w * (1 - (r / mine.artists.length) * 0.6)
  })
  if (!max) return { pct: 0, shared }
  // a gentle curve: two people sharing a third of their favourites already feel close
  const raw = got / max
  return { pct: Math.round(Math.min(1, Math.pow(raw, 0.7)) * 100), shared }
}

const verdict = (p: number): string =>
  p >= 80
    ? 'Basically the same playlist'
    : p >= 60
      ? 'Very close'
      : p >= 40
        ? 'Lots in common'
        : p >= 20
          ? 'Some overlap'
          : 'Different worlds (good for discovering)'

export function TasteMatch({ profile, name }: { profile: PulseProfile; name: string }): React.JSX.Element | null {
  const mine = useMine()
  const navigate = useApp((s) => s.navigate)
  const theirs = profile.snapshot?.topArtists ?? []
  const result = useMemo(() => (mine && theirs.length ? score(mine, theirs) : null), [mine, theirs])
  if (!result || !mine) return null
  const blend = (): void => {
    const a = (profile.snapshot.topTracks ?? []).map((t) => t.uri).filter(Boolean)
    const b = mine.tracks
    const out: string[] = []
    for (let i = 0; i < Math.max(a.length, b.length) && out.length < 60; i++) {
      if (a[i] && !out.includes(a[i])) out.push(a[i])
      if (b[i] && !out.includes(b[i])) out.push(b[i])
    }
    if (out.length) void playUris(out)
  }
  const first = name.split(' ')[0]
  const R = 44
  const C = 2 * Math.PI * R
  return (
    <section className="taste">
      <div className="taste__ring" aria-label={`${result.pct}% taste match`}>
        <svg viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={R} className="taste__track" />
          <motion.circle
            cx="50"
            cy="50"
            r={R}
            className="taste__fill"
            strokeDasharray={C}
            initial={{ strokeDashoffset: C }}
            animate={{ strokeDashoffset: C * (1 - result.pct / 100) }}
            transition={{ duration: 1.2, ease: [0.2, 0.8, 0.2, 1] }}
          />
        </svg>
        <b>{result.pct}%</b>
      </div>
      <div className="taste__text">
        <small>Taste match with {first}</small>
        <h3>{verdict(result.pct)}</h3>
        {result.shared.length > 0 ? (
          <div className="taste__shared">
            <span className="taste__faces">
              {result.shared.slice(0, 6).map((a) => (
                <button key={a.id || a.name} title={a.name} onClick={() => a.id && navigate({ name: 'artist', id: a.id })}>
                  <Cover src={a.image} round size={34} />
                </button>
              ))}
            </span>
            <span className="muted">
              You both love{' '}
              {result.shared
                .slice(0, 2)
                .map((a) => a.name)
                .join(' and ')}
              {result.shared.length > 2 ? ` and ${result.shared.length - 2} more` : ''}
            </span>
          </div>
        ) : (
          <span className="muted">No favourite artists in common yet. Their list is a good place to start.</span>
        )}
      </div>
      <button className="btn btn--accent taste__blend" onClick={blend}>
        <PlayIcon size={16} />
        Play a blend
      </button>
    </section>
  )
}
