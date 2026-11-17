// Achievements on Your stats: a badge per goal (bronze, silver, gold), with how close you are to
// the next one. Worked out from the listening history (lib/achievements).
import { useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { achievements } from '@/lib/achievements'
import { useHistory } from '@/lib/history'

export function Achievements(): React.JSX.Element | null {
  const plays = useHistory((s) => s.plays)
  const loaded = useHistory((s) => s.loaded)
  const list = useMemo(() => (loaded ? achievements(plays) : []), [plays, loaded])
  const [all, setAll] = useState(false)
  if (!list.length) return null
  const earned = list.filter((a) => a.done).length
  // earned ones first (gold before bronze), then the closest to earning
  const order = { gold: 3, silver: 2, bronze: 1 } as const
  const sorted = [...list].sort((a, b) => Number(b.done) - Number(a.done) || (b.done ? order[b.tier] - order[a.tier] : b.progress - a.progress))
  const shown = all ? sorted : sorted.slice(0, 8)
  return (
    <section className="ach">
      <header className="ach__head">
        <h2 className="stats__h">Achievements</h2>
        <span className="ach__count">
          {earned} of {list.length} earned
        </span>
        {list.length > 8 && (
          <button className="shelf__more" onClick={() => setAll((v) => !v)}>
            {all ? 'Show less' : 'Show all'}
          </button>
        )}
      </header>
      <ul className="ach__grid">
        {shown.map((a, i) => (
          <motion.li
            key={a.id}
            className={`ach-card ${a.done ? `is-done is-${a.tier}` : 'is-locked'}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              delay: i * 0.03,
              type: 'spring',
              stiffness: 280,
              damping: 26
            }}
            title={a.text}
          >
            <span className="ach-card__badge" aria-hidden="true">
              <span>{a.icon}</span>
            </span>
            <span className="ach-card__text">
              <b>{a.title}</b>
              <small>{a.done && a.progress >= 1 ? `${a.text}. Done!` : a.text}</small>
              <span className="ach-card__bar">
                <i style={{ width: `${Math.round(a.progress * 100)}%` }} />
              </span>
              <small className="ach-card__count">{a.count}</small>
            </span>
            {a.done && <span className="ach-card__tier">{a.tier}</span>}
          </motion.li>
        ))}
      </ul>
    </section>
  )
}
