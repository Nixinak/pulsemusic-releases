import type { ReactNode } from 'react'
import { Emo } from '@/components/Emoji'
import { motion, useTransform } from 'motion/react'
import { Cover, usePageScroll } from '@/components/common'
import { ImageIcon } from '@/components/Icons'

export function PageHeader({
  image,
  kind,
  title,
  meta,
  description,
  actions,
  round = false,
  artNode,
  onArtClick
}: {
  image: string | null
  kind: string
  title: string
  meta?: ReactNode
  description?: string
  actions?: ReactNode
  round?: boolean
  artNode?: ReactNode
  /** Makes the cover clickable (e.g. to change a playlist cover). */
  onArtClick?: () => void
}): React.JSX.Element {
  const scrollY = usePageScroll()
  // The cover drifts and shrinks slightly as the list scrolls over it.
  const artY = useTransform(scrollY, [0, 400], [0, 60])
  const artScale = useTransform(scrollY, [0, 400], [1, 0.9])
  const len = title.length
  const size = len > 40 ? 'is-long' : len > 18 ? 'is-mid' : 'is-short'
  return (
    <header className="phead">
      <motion.div className="phead__art-wrap" style={{ y: artY, scale: artScale }}>
        <motion.div
          className={`phead__art ${onArtClick ? 'phead__art--edit' : ''}`}
          onClick={onArtClick}
          title={onArtClick ? 'Change cover' : undefined}
          initial={{ opacity: 0, scale: 0.9, y: 16, rotateX: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0, rotateX: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 24 }}
        >
          {artNode ?? <Cover src={image} round={round} radius={20} />}
          {onArtClick && (
            <span className="phead__art-edit" aria-hidden="true">
              <ImageIcon size={26} />
              Change cover
            </span>
          )}
        </motion.div>
      </motion.div>
      <div className="phead__text">
        <span className="phead__kind">{kind}</span>
        <h1 className={`phead__title ${size}`}>{typeof title === 'string' ? <Emo>{title}</Emo> : title}</h1>
        {description && <p className="phead__desc">{description}</p>}
        {meta && <div className="phead__meta">{meta}</div>}
        {actions && <div className="phead__actions">{actions}</div>}
      </div>
    </header>
  )
}
