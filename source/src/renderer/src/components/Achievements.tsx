// Achievements on Your stats: a button with how many are earned, and a short showcase (your
// rarest one and the spread across rarities) that opens the Achievements page.
import { useApp } from '@/lib/store'
import { Showcase, useBoard } from '@/views/AchievementsView'
import { Emo } from './Emoji'

/** A button at the top of Your stats: how many are earned; it opens the Achievements page. */
export function AchievementsChip(): React.JSX.Element | null {
  const board = useBoard()
  const navigate = useApp((s) => s.navigate)
  if (!board) return null
  return (
    <button className="ach-chip" onClick={() => navigate({ name: 'achievements' })}>
      <span aria-hidden="true">
        <Emo>{board.rarest?.ladder.icon ?? '🏆'}</Emo>
      </span>
      <b>{board.earned.toLocaleString('en-US')}</b>
      <small>of {board.total.toLocaleString('en-US')} achievements</small>
    </button>
  )
}

export function Achievements(): React.JSX.Element | null {
  const board = useBoard()
  if (!board) return null
  return (
    <section className="ach" id="achievements">
      <h2 className="stats__h">Achievements</h2>
      <Showcase board={board} compact />
    </section>
  )
}
