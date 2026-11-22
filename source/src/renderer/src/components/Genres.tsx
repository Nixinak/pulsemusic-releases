// Your genres on Your stats: the biggest one large on the left, the next nine as a ranked bar
// list on the right, each with the artists who bring it.
import { useMemo } from 'react'
import { GENRE_ARTISTS, useGenres, type GenreArtist } from '@/lib/genres'
import { useArtistPicture } from '@/lib/imageFill'
import { FocusImg } from './FocusImg'

/** One artist's picture, looked up by name when the history has none. */
function Face({ a, big = false }: { a: GenreArtist | undefined; big?: boolean }): React.JSX.Element | null {
  const src = useArtistPicture(a?.name, a?.id, null)
  if (!a || !src) return null
  if (big) return <FocusImg src={src} />
  return <span className="genres__face" title={a.name} style={{ backgroundImage: `url("${src}")` }} />
}

const pct = (x: number): string => `${Math.max(1, Math.round(x * 100))}%`

export function Genres({ artists }: { artists: GenreArtist[] }): React.JSX.Element | null {
  const { rows, pending } = useGenres(artists)
  const looked = Math.min(artists.length, GENRE_ARTISTS) - pending
  const rest = useMemo(() => rows.slice(1, 10), [rows])
  if (!artists.length) return null
  if (!rows.length && !pending) return null
  const top = rows[0]
  const max = rest[0]?.share ?? 1
  const byName = new Map(artists.map((a) => [a.name.toLowerCase(), a]))
  const topArtists = (top?.artists ?? []).slice(0, 4).map((n) => byName.get(n.toLowerCase()) ?? { id: '', name: n, weight: 0 })
  return (
    <section className="genres" aria-busy={pending > 0}>
      <header className="stats__colhead">
        <h2 className="stats__h">Your genres</h2>
        {pending > 0 && (
          <small className="genres__status">
            Looking up {looked} of {Math.min(artists.length, GENRE_ARTISTS)} artists
          </small>
        )}
      </header>
      {/* shown once every artist is looked up (then kept), so the list never reshuffles on screen */}
      {top && pending === 0 ? (
        <div className="genres__body">
          <div className="genres__top">
            <span className="genres__photo" aria-hidden="true">
              <Face a={topArtists[0]} big />
            </span>
            <span className="genres__faces" aria-hidden="true">
              {topArtists.map((a) => (
                <Face key={a.name} a={a} />
              ))}
            </span>
            <span className="genres__label">Your top genre</span>
            <b className="genres__name">{top.genre}</b>
            <span className="genres__foot">
              <span className="genres__share">{pct(top.share)}</span>
              <span className="genres__who">of your listening, mostly {top.artists.slice(0, 3).join(', ')}</span>
            </span>
          </div>
          <ol className="genres__list">
            {rest.map((r, i) => (
              <li
                key={r.genre}
                className="genre"
                style={{ animationDelay: `${i * 35}ms` }}
                title={`${r.genre}: ${pct(r.share)}, ${r.artists.slice(0, 5).join(', ')}`}
              >
                <span className="genre__text">
                  <span className="genre__name">{r.genre}</span>
                  <small className="genre__who">{r.artists.slice(0, 3).join(', ')}</small>
                </span>
                <span className="genre__bar">
                  <i style={{ width: `${(r.share / max) * 100}%` }} />
                </span>
                <span className="genre__pct">{pct(r.share)}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <div className="genres__body genres__body--wait" aria-hidden="true">
          <div className="genres__top genres__ghost" />
          <div className="genres__list">
            {[92, 84, 76, 68, 60, 52, 46, 40, 34].map((w) => (
              <div key={w} className="genres__ghostrow" style={{ width: `${w}%` }} />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
