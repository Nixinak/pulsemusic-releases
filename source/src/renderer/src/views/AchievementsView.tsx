// Achievements: 1,000 goals in ladders, each with how rare it is among Spotify listeners.
// The top shows your rarest one and how your earned goals spread across the six rarities;
// below, every ladder as a card you can open to see all its steps.
import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useHistory } from '@/lib/history'
import { useApp } from '@/lib/store'
import { useQuery } from '@/lib/useQuery'
import * as sp from '@/lib/spotify'
import {
  buildBoard,
  CATEGORIES,
  RARITIES,
  RARITY_NAME,
  rememberLibraryCounts,
  savedLibraryCounts,
  shareText,
  type Board,
  type Category,
  type LibraryCounts,
  type Ladder,
  type Rarity
} from '@/lib/achievements'
import { Emo } from '@/components/Emoji'

/** Your library's sizes from Spotify (liked songs, albums, followed artists, own playlists). */
export function useLibraryCounts(): LibraryCounts | null {
  const me = useApp((s) => s.me)
  const playlists = useApp((s) => s.playlists)
  const totals = useQuery('ach:library', async () => {
    const [songs, albums, follow] = await Promise.all([
      sp.api<{ total?: number }>('/me/tracks', { query: { limit: 1 } }).catch(() => null),
      sp.api<{ total?: number }>('/me/albums', { query: { limit: 1 } }).catch(() => null),
      sp.api<{ artists?: { total?: number } }>('/me/following', { query: { type: 'artist', limit: 1 } }).catch(() => null)
    ])
    return { saved: songs?.total ?? 0, albums: albums?.total ?? 0, following: follow?.artists?.total ?? 0 }
  })
  const counts = useMemo(() => {
    if (!totals.data) return savedLibraryCounts()
    const own = playlists.filter((p) => p.owner?.id && p.owner.id === me?.id)
    return {
      ...totals.data,
      playlists: own.length,
      playlistSongs: own.reduce((n, p) => n + (p.items?.total ?? p.tracks?.total ?? 0), 0)
    }
  }, [totals.data, playlists, me?.id])
  useEffect(() => {
    if (counts && totals.data) rememberLibraryCounts(counts)
  }, [counts, totals.data])
  return counts
}

export function useBoard(): Board | null {
  const plays = useHistory((s) => s.plays)
  const loaded = useHistory((s) => s.loaded)
  const imported = useHistory((s) => !!s.imported)
  const lib = useLibraryCounts()
  return useMemo(() => (loaded ? buildBoard(plays, lib, imported) : null), [plays, loaded, lib, imported])
}

const fmt = (n: number): string => Math.floor(n).toLocaleString('en-US')

/** The round badge: the icon (or an artist's picture) in a ring of its rarity. */
export function Medal({
  icon,
  art,
  rarity,
  size = 56,
  locked = false
}: {
  icon: string
  art?: string | null
  rarity: Rarity | null
  size?: number
  locked?: boolean
}): React.JSX.Element {
  return (
    <span className={`medal ${rarity ? `is-${rarity}` : 'is-none'} ${locked ? 'is-locked' : ''}`} style={{ width: size, height: size }} aria-hidden="true">
      <span className="medal__face">
        {art ? (
          <img src={art} alt="" draggable={false} />
        ) : (
          <span className="medal__emo" style={{ fontSize: Math.round(size * 0.44) }}>
            <Emo>{icon}</Emo>
          </span>
        )}
      </span>
    </span>
  )
}

/** The six rarities as one bar: how many there are of each, and how many you have. */
export function Spectrum({ board }: { board: Board }): React.JSX.Element {
  return (
    <div className="spectrum">
      <div className="spectrum__bar">
        {RARITIES.map((r) => {
          const b = board.byRarity[r]
          if (!b.total) return null
          return (
            <span key={r} className={`spectrum__seg is-${r}`} style={{ flexGrow: Math.max(4, b.total) }} title={`${RARITY_NAME[r]}: ${b.earned} of ${b.total}`}>
              <i style={{ width: `${(b.earned / b.total) * 100}%` }} />
            </span>
          )
        })}
      </div>
      <ul className="spectrum__keys">
        {RARITIES.map((r) => (
          <li key={r} className={`is-${r}`}>
            <b>{RARITY_NAME[r]}</b>
            <span>
              {fmt(board.byRarity[r].earned)} / {fmt(board.byRarity[r].total)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The top of the page (and the teaser on Your stats): your rarest goal and the spread. */
export function Showcase({ board, compact = false }: { board: Board; compact?: boolean }): React.JSX.Element {
  const navigate = useApp((s) => s.navigate)
  const r = board.rarest
  return (
    <section className={`showcase ${compact ? 'showcase--compact' : ''} ${r ? `is-${r.tier.rarity}` : ''}`}>
      <div className="showcase__glow" aria-hidden="true" />
      <div className="showcase__main">
        <Medal icon={r?.ladder.icon ?? '🏆'} art={r?.ladder.art} rarity={r?.tier.rarity ?? null} size={compact ? 76 : 112} />
        <div className="showcase__text">
          {r ? (
            <>
              <small>Your rarest</small>
              <h2>{r.ladder.title}</h2>
              <p>{r.ladder.ask(r.tier.goal)}</p>
              <span className={`rarity is-${r.tier.rarity}`}>
                {RARITY_NAME[r.tier.rarity]}, {shareText(r.tier.share).replace(/^Top/, 'top')}
              </span>
            </>
          ) : (
            <>
              <h2>Nothing yet</h2>
              <p>Play some music and the first ones come quickly.</p>
            </>
          )}
        </div>
        <div className="showcase__count">
          <b>{fmt(board.earned)}</b>
          <span>of {fmt(board.total)} earned</span>
          {compact && (
            <button className="btn" onClick={() => navigate({ name: 'achievements' })}>
              See all achievements
            </button>
          )}
        </div>
      </div>
      <Spectrum board={board} />
    </section>
  )
}

function LadderCard({ l, open, onToggle }: { l: Ladder; open: boolean; onToggle: () => void }): React.JSX.Element {
  const best = l.reached ? l.tiers[l.reached - 1] : null
  const single = l.tiers.length === 1
  const target = l.next ?? l.tiers[l.tiers.length - 1]
  return (
    <motion.li layout="position" className={`lad ${open ? 'is-open' : ''} ${best ? `is-${best.rarity}` : 'is-none'} ${single ? 'lad--moment' : ''}`}>
      <button className="lad__head" onClick={onToggle} aria-expanded={open}>
        <Medal icon={l.icon} art={l.art} rarity={best?.rarity ?? null} locked={!best} size={single ? 48 : 56} />
        <span className="lad__text">
          <span className="lad__title">
            <b>{l.title}</b>
            {!single && (
              <span className="lad__steps">
                {l.reached} of {l.tiers.length}
              </span>
            )}
          </span>
          <span className="lad__ask">{l.next ? l.ask(l.next.goal) : `${l.ask(target.goal)}. All done`}</span>
          {!single && l.next && (
            <span className="lad__bar">
              <i className={`is-${l.next.rarity}`} style={{ width: `${Math.round(l.progress * 100)}%` }} />
            </span>
          )}
          <span className="lad__meta">
            {single ? (
              <span className={`rarity is-${target.rarity}`}>
                {RARITY_NAME[target.rarity]}, {shareText(target.share).replace(/^Top/, 'top')}
              </span>
            ) : l.next ? (
              <>
                {fmt(l.value)} / {fmt(l.next.goal)}
                <span className={`rarity is-${l.next.rarity}`}>next is {RARITY_NAME[l.next.rarity].toLowerCase()}</span>
              </>
            ) : (
              <span className={`rarity is-${target.rarity}`}>Every step reached</span>
            )}
          </span>
        </span>
      </button>
      {!single && (
        <ol className="lad__pips" aria-hidden="true">
          {l.tiers.map((t) => (
            <li key={t.key} className={`is-${t.rarity} ${t.done ? 'is-done' : ''}`} />
          ))}
        </ol>
      )}
      <AnimatePresence initial={false}>
        {open && !single && (
          <motion.ol
            className="lad__tiers"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
          >
            {l.tiers.map((t, i) => (
              <li key={t.key} className={`tier is-${t.rarity} ${t.done ? 'is-done' : ''}`}>
                <span className="tier__n">{i + 1}</span>
                <span className="tier__goal">{l.ask(t.goal)}</span>
                <span className="tier__rarity">{RARITY_NAME[t.rarity]}</span>
                <span className="tier__share">{shareText(t.share).replace(' of Spotify listeners', '')}</span>
              </li>
            ))}
          </motion.ol>
        )}
      </AnimatePresence>
    </motion.li>
  )
}

type Show = 'all' | 'earned' | 'todo'
type Sort = 'closest' | 'rarest' | 'most'
const SORTS: { id: Sort; label: string }[] = [
  { id: 'closest', label: 'Closest' },
  { id: 'rarest', label: 'Rarest' },
  { id: 'most', label: 'Most steps' }
]

export function AchievementsView(): React.JSX.Element {
  const board = useBoard()
  const [cat, setCat] = useState<Category | 'all'>('all')
  const [show, setShow] = useState<Show>('all')
  const [sort, setSort] = useState<Sort>('closest')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const list = useMemo(() => {
    if (!board) return []
    const q = query.trim().toLowerCase()
    const bestShare = (l: Ladder): number => (l.reached ? l.tiers[l.reached - 1].share : 1)
    return board.ladders
      .filter((l) => cat === 'all' || l.cat === cat)
      .filter((l) => (show === 'earned' ? l.reached > 0 : show === 'todo' ? !!l.next : true))
      .filter((l) => !q || l.title.toLowerCase().includes(q) || l.tiers.some((t) => l.ask(t.goal).toLowerCase().includes(q)))
      .sort((a, b) =>
        sort === 'rarest'
          ? bestShare(a) - bestShare(b)
          : sort === 'most'
            ? b.reached / b.tiers.length - a.reached / a.tiers.length
            : (a.next ? 0 : 1) - (b.next ? 0 : 1) || b.progress - a.progress
      )
  }, [board, cat, show, sort, query])

  if (!board) return <div className="achv achv--loading" />

  return (
    <div className="achv">
      <header className="achv__top">
        <h1 className="page-title">Achievements</h1>
      </header>
      <Showcase board={board} />
      <p className="achv__note">How rare each one is comes from Spotify’s published listening figures, so the shares are estimates.</p>

      <div className="achv__tools">
        <div className="achv__cats" role="tablist">
          {[{ id: 'all' as const, label: 'All' }, ...CATEGORIES].map((c) => {
            const n = c.id === 'all' ? board.ladders : board.ladders.filter((l) => l.cat === c.id)
            const steps = n.reduce((s, l) => s + l.tiers.length, 0)
            const got = n.reduce((s, l) => s + l.reached, 0)
            return (
              <button key={c.id} role="tab" aria-selected={cat === c.id} className={`achv__cat ${cat === c.id ? 'is-on' : ''}`} onClick={() => setCat(c.id)}>
                {cat === c.id && <motion.span layoutId="achv-cat" className="achv__cat-pill" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />}
                <span>{c.label}</span>
                <small>
                  {got}/{steps}
                </small>
              </button>
            )
          })}
        </div>
        <div className="achv__filters">
          <div className="seg seg--small">
            {(['all', 'earned', 'todo'] as Show[]).map((s) => (
              <button key={s} className={`seg__btn ${show === s ? 'is-on' : ''}`} onClick={() => setShow(s)}>
                <span>{s === 'all' ? 'All' : s === 'earned' ? 'Earned' : 'To do'}</span>
                {show === s && <motion.span layoutId="achv-show" className="seg__pill" />}
              </button>
            ))}
          </div>
          <div className="seg seg--small">
            {SORTS.map((s) => (
              <button key={s.id} className={`seg__btn ${sort === s.id ? 'is-on' : ''}`} onClick={() => setSort(s.id)}>
                <span>{s.label}</span>
                {sort === s.id && <motion.span layoutId="achv-sort" className="seg__pill" />}
              </button>
            ))}
          </div>
          <input
            className="achv__search"
            type="search"
            placeholder="Find a goal"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Find a goal"
          />
        </div>
      </div>

      {list.length ? (
        <ul className="achv__grid">
          {list.map((l) => (
            <LadderCard key={l.id} l={l} open={open === l.id} onToggle={() => setOpen((o) => (o === l.id ? null : l.id))} />
          ))}
        </ul>
      ) : (
        <p className="achv__empty">No goal matches that. Try another word or show all.</p>
      )}
    </div>
  )
}
