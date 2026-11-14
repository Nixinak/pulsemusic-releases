import { CrossfadeImage } from './CrossfadeImage'
import { useBackdrop } from '@/lib/backdrop'
import { useApp } from '@/lib/store'

export function Ambient({ intense = false }: { intense?: boolean }): React.JSX.Element {
  const pageArt = useBackdrop((s) => s.url)
  // A palette chosen for everywhere replaces the artwork backdrop too.
  const fixed = useApp((s) => s.settings.bgPalette !== 'artwork' && s.settings.bgScope === 'everywhere')
  const art = fixed ? null : pageArt
  return (
    <div className={`ambient ${intense ? 'ambient--intense' : ''}`} aria-hidden="true">
      <div className="ambient__blob" />
      <div className="ambient__blob" />
      <div className="ambient__blob" />
      <div className="ambient__blob" />
      <CrossfadeImage src={art} className="ambient__art" duration={1} />
      <div className="ambient__veil" />
    </div>
  )
}
