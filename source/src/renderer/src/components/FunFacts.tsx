// Fun facts on Your stats, as a bento of cards: each fact has its own colour, an icon and a small
// picture of the number (the last three weeks for the streak, a 24-hour clock for your hour, the
// week for your favourite day, the last two weeks for your biggest day).
import { motion } from 'motion/react'
import { Emo } from './Emoji'
import type { Fact } from '@/lib/funFacts'

/** Colour (hue) and icon per fact. */
const LOOK: Record<string, { hue: number; icon: string; wide?: boolean }> = {
  streak: {
    hue: 22,
    wide: true,
    icon: 'M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3-1-5.5 1-8.5Z'
  },
  repeat: {
    hue: 330,
    wide: true,
    icon: 'M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4'
  },
  session: {
    hue: 265,
    icon: 'M12 8v5l3 2M9 2h6M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z'
  },
  day: {
    hue: 45,
    wide: true,
    icon: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z'
  },
  hour: {
    hue: 200,
    icon: 'M12 7v5l3 3M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z'
  },
  weekday: {
    hue: 160,
    icon: 'M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z'
  },
  new: {
    hue: 290,
    icon: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3ZM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z'
  },
  skip: { hue: 0, icon: 'M5 5v14l9-7-9-7ZM18 5v14' },
  variety: {
    hue: 185,
    wide: true,
    icon: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'
  }
}

function Viz({ v }: { v: NonNullable<Fact['viz']> }): React.JSX.Element | null {
  if (v.kind === 'days')
    return (
      <div className="ff-days" aria-hidden="true">
        {v.days.map((on, i) => (
          <motion.i
            key={i}
            className={on ? 'is-on' : ''}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{
              delay: 0.15 + i * 0.02,
              type: 'spring',
              stiffness: 400,
              damping: 20
            }}
          />
        ))}
      </div>
    )
  if (v.kind === 'bars')
    return (
      <div className="ff-bars" aria-hidden="true">
        {v.values.map((x, i) => (
          <span key={i} className={i === v.peak ? 'is-peak' : ''}>
            <motion.i
              initial={{ scaleY: 0 }}
              animate={{ scaleY: Math.max(0.06, x) }}
              transition={{
                delay: 0.15 + i * 0.03,
                type: 'spring',
                stiffness: 160,
                damping: 18
              }}
            />
            <small>{v.labels[i]}</small>
          </span>
        ))}
      </div>
    )
  if (v.kind === 'clock') {
    const r0 = 26
    return (
      <svg className="ff-clock" viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r={r0 - 3} className="ff-clock__face" />
        {v.values.map((x, h) => {
          const a = (h / 24) * Math.PI * 2 - Math.PI / 2
          const r1 = r0 + 2
          const r2 = r1 + 4 + x * 18
          return (
            <line
              key={h}
              x1={50 + Math.cos(a) * r1}
              y1={50 + Math.sin(a) * r1}
              x2={50 + Math.cos(a) * r2}
              y2={50 + Math.sin(a) * r2}
              className={h === v.peak ? 'is-peak' : ''}
            />
          )
        })}
        <line
          x1="50"
          y1="50"
          x2={50 + Math.cos((v.peak / 24) * Math.PI * 2 - Math.PI / 2) * 18}
          y2={50 + Math.sin((v.peak / 24) * Math.PI * 2 - Math.PI / 2) * 18}
          className="ff-clock__hand"
        />
        <circle cx="50" cy="50" r="2.6" className="ff-clock__pin" />
      </svg>
    )
  }
  if (v.kind === 'span')
    return (
      <div className="ff-span" aria-hidden="true">
        <div className="ff-span__track">
          <motion.i
            style={{ left: `${v.from * 100}%` }}
            initial={{ width: 0 }}
            animate={{ width: `${Math.max(2, (v.to - v.from) * 100)}%` }}
            transition={{ delay: 0.2, duration: 0.9, ease: [0.2, 0.8, 0.2, 1] }}
          />
        </div>
        <div className="ff-span__axis">
          <small>0</small>
          <small>6</small>
          <small>12</small>
          <small>18</small>
          <small>24</small>
        </div>
      </div>
    )
  return (
    <div className="ff-share" aria-hidden="true">
      <motion.i
        initial={{ width: 0 }}
        animate={{ width: `${Math.round(v.value * 100)}%` }}
        transition={{ delay: 0.2, duration: 0.9, ease: [0.2, 0.8, 0.2, 1] }}
      />
    </div>
  )
}

/**
 * Lays the cards out in rows of four with no holes: a card that doesn't fit the row waits for the
 * next one while smaller cards fill in, and the last card of a row stretches over what is left.
 */
function pack(facts: Fact[], cols = 4): { f: Fact; span: number }[] {
  const left = facts.map((f) => ({ f, w: LOOK[f.id]?.wide ? 2 : 1 }))
  const out: { f: Fact; span: number }[] = []
  while (left.length) {
    let room = cols
    const row: { f: Fact; span: number }[] = []
    for (let i = 0; i < left.length && room > 0;) {
      if (left[i].w <= room) {
        row.push({ f: left[i].f, span: left[i].w })
        room -= left[i].w
        left.splice(i, 1)
      } else i++
    }
    if (room > 0 && row.length) row[row.length - 1].span += room
    out.push(...row)
  }
  return out
}

export function FunFacts({ facts }: { facts: Fact[] }): React.JSX.Element | null {
  if (!facts.length) return null
  const cards = pack(facts)
  return (
    <section className="ff">
      <header className="ff__head">
        <h2 className="stats__h">Fun facts</h2>
        <small>From the plays Pulse has counted</small>
      </header>
      <ul className="ff__grid">
        {cards.map(({ f, span }, i) => {
          const look = LOOK[f.id] ?? { hue: 220, icon: '' }
          return (
            <motion.li
              key={f.id}
              className={`ff-card ff-card--${f.id} ${span > 1 ? 'is-wide' : ''}`}
              style={{
                ['--h' as string]: look.hue,
                gridColumn: `span ${span}`
              }}
              initial={{ opacity: 0, y: 18, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{
                delay: i * 0.05,
                type: 'spring',
                stiffness: 240,
                damping: 24
              }}
            >
              {f.art && (
                <span className="ff-card__wash" aria-hidden="true">
                  <img src={f.art} alt="" />
                </span>
              )}
              <span className="ff-card__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d={look.icon} />
                </svg>
              </span>
              <small className="ff-card__label">{f.label}</small>
              <b className="ff-card__value">{f.value}</b>
              {f.art && <img className="ff-card__art" src={f.art} alt="" decoding="async" />}
              {f.viz && <Viz v={f.viz} />}
              {f.detail && (
                <span className="ff-card__detail">
                  <Emo>{f.detail}</Emo>
                </span>
              )}
            </motion.li>
          )
        })}
      </ul>
    </section>
  )
}
