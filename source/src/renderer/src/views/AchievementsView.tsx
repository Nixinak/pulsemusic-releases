// Achievements: 1,000 goals in ladders, each with how rare it is among Spotify listeners.
// The top shows your rarest one and how your earned goals spread across the six rarities;
// below, every ladder as a card you can open to see all its steps.
import { useEffect, useMemo, useRef, useState } from 'react'
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

export type MedalShape = 'circle' | 'hex' | 'oct' | 'square' | 'shield' | 'burst'

/** Each kind of goal has its own medal shape, the way Apple's awards do. */
export const SHAPE_OF: Record<Category, MedalShape> = {
  time: 'circle',
  variety: 'hex',
  devotion: 'oct',
  habits: 'square',
  library: 'shield',
  artists: 'circle',
  moments: 'burst'
}

/** A medal: a metal rim in its rarity's metal, a groove, then an enamel face with the icon (or the
 *  artist's picture) and a shine across it. Not earned yet: a flat grey blank. */
export function Medal({
  icon,
  art,
  rarity,
  size = 56,
  locked = false,
  shape = 'circle'
}: {
  icon: string
  art?: string | null
  rarity: Rarity | null
  size?: number
  locked?: boolean
  shape?: MedalShape
}): React.JSX.Element {
  return (
    <span
      className={`medal medal--${shape} ${rarity ? `is-${rarity}` : 'is-none'} ${locked ? 'is-locked' : ''}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <span className="medal__rim" />
      <span className="medal__groove" />
      <span className="medal__face">
        {art ? (
          <img src={art} alt="" draggable={false} />
        ) : (
          <span className="medal__emo" style={{ fontSize: Math.round(size * 0.4) }}>
            <Emo>{icon}</Emo>
          </span>
        )}
      </span>
      <span className="medal__shine" />
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
        <Medal
          icon={r?.ladder.icon ?? '🏆'}
          art={r?.ladder.art}
          rarity={r?.tier.rarity ?? null}
          size={compact ? 84 : 124}
          shape={r ? SHAPE_OF[r.ladder.cat] : 'circle'}
        />
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

/** An award in the grid: the medal (it tilts toward the pointer), its name and how far along. */
function AwardTile({ l, onOpen }: { l: Ladder; onOpen: () => void }): React.JSX.Element {
  const best = l.reached ? l.tiers[l.reached - 1] : null
  const single = l.tiers.length === 1
  const tilt = (e: React.PointerEvent<HTMLButtonElement>): void => {
    const r = e.currentTarget.getBoundingClientRect()
    e.currentTarget.style.setProperty('--rx', `${(((e.clientY - r.top) / r.height - 0.5) * -18).toFixed(1)}deg`)
    e.currentTarget.style.setProperty('--ry', `${(((e.clientX - r.left) / r.width - 0.5) * 22).toFixed(1)}deg`)
  }
  const reset = (e: React.PointerEvent<HTMLButtonElement>): void => {
    e.currentTarget.style.setProperty('--rx', '0deg')
    e.currentTarget.style.setProperty('--ry', '0deg')
  }
  return (
    <motion.li layout="position" className={`award ${best ? `is-${best.rarity}` : 'is-none'}`}>
      <button className="award__btn" onClick={onOpen} onPointerMove={tilt} onPointerLeave={reset}>
        <span className="award__medal">
          <Medal icon={l.icon} art={l.art} rarity={best?.rarity ?? null} locked={!best} size={104} shape={SHAPE_OF[l.cat]} />
        </span>
        <b className="award__title">{l.title}</b>
        <span className="award__sub">{single ? (best ? RARITY_NAME[best.rarity] : 'Not yet') : l.next ? `${l.reached} of ${l.tiers.length}` : 'All done'}</span>
        {!single && l.next && (
          <span className={`award__bar is-${l.next.rarity}`}>
            <i style={{ width: `${Math.round(l.progress * 100)}%` }} />
          </span>
        )}
      </button>
    </motion.li>
  )
}

/** One award up close: the medal large (drag it to turn it, like holding it), what it asks, and
 *  every step with how rare it is. */
function AwardSheet({ l, onClose }: { l: Ladder; onClose: () => void }): React.JSX.Element {
  const best = l.reached ? l.tiers[l.reached - 1] : null
  const single = l.tiers.length === 1
  const target = l.next ?? l.tiers[l.tiers.length - 1]
  const [turn, setTurn] = useState(0)
  const drag = useRef<{ x: number; at: number } | null>(null)
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  return (
    <motion.div className="award-sheet" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className={`award-sheet__card ${best ? `is-${best.rarity}` : 'is-none'}`}
        role="dialog"
        aria-label={l.title}
        initial={{ y: 30, scale: 0.96 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ y: 20, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="award-sheet__close icon-btn" aria-label="Close" onClick={onClose}>
          ×
        </button>
        <div
          className="award-sheet__stage"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            drag.current = { x: e.clientX, at: turn }
          }}
          onPointerMove={(e) => drag.current && setTurn(drag.current.at + (e.clientX - drag.current.x) * 0.8)}
          onPointerUp={() => {
            drag.current = null
            setTurn((t) => Math.round(t / 360) * 360)
          }}
        >
          <motion.span
            className="award-sheet__medal"
            initial={{ rotateY: -540, scale: 0.6 }}
            animate={{ rotateY: turn, scale: 1 }}
            transition={drag.current ? { duration: 0 } : { type: 'spring', stiffness: 60, damping: 14 }}
          >
            <Medal icon={l.icon} art={l.art} rarity={best?.rarity ?? null} locked={!best} size={210} shape={SHAPE_OF[l.cat]} />
          </motion.span>
        </div>
        <h2>{l.title}</h2>
        <p className="award-sheet__ask">{l.next ? l.ask(l.next.goal) : `${l.ask(target.goal)}. All done.`}</p>
        <span className={`rarity is-${target.rarity}`}>
          {l.next && !single ? `Next is ${RARITY_NAME[target.rarity].toLowerCase()}, ` : `${RARITY_NAME[target.rarity]}, `}
          {shareText(target.share).replace(/^Top/, 'top')}
        </span>
        {!single && l.next && (
          <div className="award-sheet__progress">
            <span className={`award__bar is-${l.next.rarity}`}>
              <i style={{ width: `${Math.round(l.progress * 100)}%` }} />
            </span>
            <small>
              {fmt(l.value)} / {fmt(l.next.goal)}
            </small>
          </div>
        )}
        {!single && (
          <ol className="award-sheet__tiers">
            {l.tiers.map((t, i) => (
              <li key={t.key} className={`tier is-${t.rarity} ${t.done ? 'is-done' : ''}`}>
                <span className="tier__n">{i + 1}</span>
                <span className="tier__goal">{l.ask(t.goal)}</span>
                <span className="tier__rarity">{RARITY_NAME[t.rarity]}</span>
                <span className="tier__share">{shareText(t.share).replace(' of Spotify listeners', '')}</span>
              </li>
            ))}
          </ol>
        )}
      </motion.div>
    </motion.div>
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

  const openLadder = open ? (board?.ladders.find((l) => l.id === open) ?? null) : null
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
            <AwardTile key={l.id} l={l} onOpen={() => setOpen(l.id)} />
          ))}
        </ul>
      ) : (
        <p className="achv__empty">No goal matches that. Try another word or show all.</p>
      )}
      <AnimatePresence>{openLadder && <AwardSheet key={openLadder.id} l={openLadder} onClose={() => setOpen(null)} />}</AnimatePresence>
    </div>
  )
}
