// Apple-style emoji everywhere text from Spotify can carry them (song, playlist and artist
// names). Windows draws its own emoji; these come from one bundled picture sheet instead, so
// they look the same as on an iPhone. The real character stays in the text for copying.
import { Fragment, memo } from 'react'
import data from '@/assets/emoji-apple.json'
import sheet from '@/assets/emoji-apple-64.webp'

const { cols, map } = data as unknown as { cols: number; map: Record<string, [number, number]> }
document.documentElement.style.setProperty('--emo-sheet', `url("${sheet}")`)

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null
const MAYBE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u

/** Sheet position of one emoji, or null when it's not an emoji we have. */
function lookup(g: string): [number, number] | null {
  const code = [...g].map((c) => c.codePointAt(0)!.toString(16).padStart(4, '0')).join('-')
  return map[code] ?? map[code.replace(/-fe0f/g, '')] ?? null
}

const step = 100 / (cols - 1)

/** Text with its emoji drawn in the Apple style. Plain text passes straight through. */
export const Emo = memo(function Emo({ children }: { children: string | null | undefined }): React.JSX.Element {
  const text = children ?? ''
  if (!segmenter || !MAYBE.test(text)) return <>{text}</>
  const out: React.ReactNode[] = []
  let plain = ''
  let i = 0
  for (const { segment } of segmenter.segment(text)) {
    const pos = MAYBE.test(segment) ? lookup(segment) : null
    if (!pos) {
      plain += segment
      continue
    }
    if (plain) out.push(<Fragment key={i++}>{plain}</Fragment>)
    plain = ''
    out.push(
      <span key={i++} className="emo" role="img" aria-label={segment} style={{ backgroundPosition: `${pos[0] * step}% ${pos[1] * step}%` }}>
        {segment}
      </span>
    )
  }
  if (plain) out.push(<Fragment key={i++}>{plain}</Fragment>)
  return <>{out}</>
})
