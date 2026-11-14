// "Recommended" under your own playlists: songs that fit, with tempo and key, and an Add button.
// It only starts working when you scroll down to it, so opening a playlist stays light.
import { useEffect, useRef, useState } from 'react'
import * as sp from '@/lib/spotify'
import type { STrack } from '@/lib/types'
import { recommend, type Rec } from '@/lib/recommend'
import { useApp, errorText } from '@/lib/store'
import { playUris, usePlayer } from '@/lib/player'
import { formatTime } from '@/lib/format'
import { ArtistLinks, Cover, EqBars } from './common'
import { PlayIcon } from './Icons'

/** Results per playlist for this session (keyed by its songs, so edits give fresh picks). */
const memo = new Map<string, Rec[]>()

const keyColor = (num: number): string => `hsl(${((num - 1) * 30 + 330) % 360} 70% 62%)`

export function Recommendations({ playlistId, tracks, onAdded }: { playlistId: string; tracks: STrack[]; onAdded: (t: STrack) => void }): React.JSX.Element {
  const navigate = useApp((s) => s.navigate)
  const toast = useApp((s) => s.toast)
  const currentId = usePlayer((s) => s.track?.id)
  const paused = usePlayer((s) => s.paused)
  const box = useRef<HTMLElement>(null)
  const [visible, setVisible] = useState(false)
  const [recs, setRecs] = useState<Rec[] | null>(null)
  const [stage, setStage] = useState('')
  const [page, setPage] = useState(0)
  const [adding, setAdding] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const sig = `${playlistId}:${tracks.length}:${tracks[0]?.id ?? ''}:${tracks[tracks.length - 1]?.id ?? ''}`

  useEffect(() => {
    const el = box.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!visible || tracks.length === 0) return
    const hit = nonce === 0 ? memo.get(sig) : undefined
    if (hit) return setRecs(hit)
    let alive = true
    setRecs(null)
    setPage(0)
    recommend(tracks, (s) => alive && setStage(s))
      .then((r) => {
        memo.set(sig, r)
        if (alive) setRecs(r)
      })
      .catch((e) => {
        console.warn('[recs] failed', e)
        if (alive) setRecs([])
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, sig, nonce])

  const shown = recs?.slice(page * 10, page * 10 + 10) ?? []

  /** Plays a recommendation and carries on through the rest of the list (then autoplay takes over). */
  const playFrom = (t: STrack): void => {
    if (!recs) return void playUris([t.uri])
    const list = recs
    const i = Math.max(0, list.findIndex((x) => x.track.id === t.id))
    const ordered = [...list.slice(i), ...list.slice(0, i)].map((x) => x.track.uri)
    void playUris(ordered.length ? ordered : [t.uri])
  }

  const add = async (r: Rec): Promise<void> => {
    setAdding(r.track.id)
    try {
      await sp.addManyToPlaylist(playlistId, [r.track.uri])
      onAdded(r.track)
      setRecs((list) => list?.filter((x) => x.track.id !== r.track.id) ?? null)
      toast(`Added “${r.track.name}”`)
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setAdding(null)
    }
  }

  return (
    <section className="recs" ref={box}>
      <header className="recs__head">
        <div>
          <h2>Recommended</h2>
          <p className="muted">Based on the artists, tempo and keys in this playlist</p>
        </div>
        {recs && recs.length > 10 && (
          <button className="btn" onClick={() => setPage((p) => ((p + 1) * 10 < recs.length ? p + 1 : 0))}>
            Refresh
          </button>
        )}
        {recs && recs.length <= 10 && recs.length > 0 && (
          <button className="btn" onClick={() => setNonce((n) => n + 1)}>
            Refresh
          </button>
        )}
      </header>
      {!visible || recs === null ? (
        <div className="recs__loading">
          <span className="cmd__spin" /> {stage || 'Getting recommendations…'}
        </div>
      ) : shown.length === 0 ? (
        <p className="muted">No recommendations for this playlist yet.</p>
      ) : (
        <div className="recs__list" role="table">
          <div className="recs__row recs__row--head" role="row">
            <span>Title</span>
            <span>BPM</span>
            <span>Key</span>
            <span>Album</span>
            <span />
          </div>
          {shown.map((r) => {
            const t = r.track
            const now = t.id === currentId
            return (
              <div key={t.id} className={`recs__row ${now ? 'is-now' : ''}`} role="row" title={r.reason} onDoubleClick={() => playFrom(t)}>
                <span className="recs__main">
                  <span className="recs__art">
                    <Cover src={sp.pickImage(t.album?.images, 64)} size={42} radius={6} />
                    <button className="recs__play" aria-label={`Play ${t.name}`} onClick={() => playFrom(t)}>
                      {now ? <EqBars playing={!paused} /> : <PlayIcon size={15} />}
                    </button>
                  </span>
                  <span className="recs__text">
                    <span className="recs__title">
                      {t.name}
                      {t.explicit && <span className="badge-e">E</span>}
                    </span>
                    <span className="recs__artists">
                      <ArtistLinks artists={t.artists} onOpen={(id) => navigate({ name: 'artist', id })} />
                    </span>
                  </span>
                </span>
                <span className="recs__num">{r.features ? r.features.bpm : '–'}</span>
                <span>
                  {r.features ? (
                    <span className="recs__key" style={{ '--k': keyColor(r.features.num) } as React.CSSProperties}>
                      {r.features.camelot}
                    </span>
                  ) : (
                    <span className="muted">–</span>
                  )}
                </span>
                <span className="recs__album">
                  {t.album?.id ? (
                    <span className="link" onClick={() => navigate({ name: 'album', id: t.album!.id })}>
                      {t.album.name}
                    </span>
                  ) : null}
                  <small className="muted">{formatTime(t.duration_ms)}</small>
                </span>
                <span className="recs__act">
                  <button className="btn btn--sm" disabled={adding === t.id} onClick={() => void add(r)}>
                    {adding === t.id ? 'Adding…' : 'Add'}
                  </button>
                </span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
