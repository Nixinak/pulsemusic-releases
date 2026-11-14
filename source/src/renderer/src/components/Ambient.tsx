import { useRef } from 'react'
import { CrossfadeImage } from './CrossfadeImage'
import { useBackdrop } from '@/lib/backdrop'
import { useDrift } from '@/lib/drift'
import { useApp } from '@/lib/store'

export function Ambient({ intense = false }: { intense?: boolean }): React.JSX.Element {
  const pageArt = useBackdrop((s) => s.url)
  // A palette chosen for everywhere replaces the artwork backdrop too.
  const fixed = useApp((s) => s.settings.bgPalette !== 'artwork' && s.settings.bgScope === 'everywhere')
  const art = fixed ? null : pageArt
  const a = useRef<HTMLDivElement>(null)
  const b = useRef<HTMLDivElement>(null)
  const c = useRef<HTMLDivElement>(null)
  const d = useRef<HTMLDivElement>(null)
  // the colour blobs drift slowly (see lib/drift: a low frame rate keeps the glass cheap)
  useDrift(a, { to: [14, 10, 1.15], seconds: 38 })
  useDrift(b, { to: [-16, 14, 0.9], seconds: 44 })
  useDrift(c, { to: [12, -16, 1.2], seconds: 50 })
  useDrift(d, { to: [14, 10, 1.15], seconds: 56, reverse: true })
  return (
    <div className={`ambient ${intense ? 'ambient--intense' : ''}`} aria-hidden="true">
      <div ref={a} className="ambient__blob" />
      <div ref={b} className="ambient__blob" />
      <div ref={c} className="ambient__blob" />
      <div ref={d} className="ambient__blob" />
      <CrossfadeImage src={art} className="ambient__art" duration={1} soft={{ blur: 90, saturate: 1.6 }} />
      <div className="ambient__veil" />
    </div>
  )
}
