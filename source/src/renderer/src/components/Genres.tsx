// Your genres on Your stats: the biggest one large on the left, the next nine as a ranked bar
// list on the right, each with the artists who bring it.
import { useMemo } from 'react'
import { GENRE_ARTISTS, useGenres, type GenreArtist } from '@/lib/genres'

const pct = (x: number): string => `${Math.max(1, Math.round(x * 100))}%`

export function Genres({ artists }: { artists: GenreArtist[] }): React.JSX.Element | null {
  const { rows, pending } = useGenres(artists)
  const looked = Math.min(artists.length, GENRE_ARTISTS) - pending
  const rest = useMemo(() => rows.slice(1, 10), [rows])
  if (!artists.length) return null
  if (!rows.length && !pending) return null
  const top = rows[0]
  const max = rest[0]?.share ?? 1
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
            <span className="genres__share">{pct(top.share)}</span>
            <b className="genres__name">{top.genre}</b>
            <span className="genres__who">{top.artists.slice(0, 3).join(', ')}</span>
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
