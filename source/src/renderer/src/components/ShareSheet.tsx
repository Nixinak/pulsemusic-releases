// Preview and export a share card (lyrics, profile, Recap) as a PNG.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { copyCard, saveCard, type CardFormat, type CardStyle } from '@/lib/cards'
import { useApp } from '@/lib/store'
import { Glass } from './Glass'
import { CloseIcon, CopyIcon, DownloadIcon } from './Icons'

interface Props {
  open: boolean
  title: string
  fileName: string
  /** Formats offered; the first is the default. */
  formats?: CardFormat[]
  render: (format: CardFormat, style: CardStyle) => Promise<string>
  onClose: () => void
}

const STYLES: { id: CardStyle; label: string }[] = [
  { id: 'artwork', label: 'Artwork' },
  { id: 'color', label: 'Colour' },
  { id: 'light', label: 'Light' }
]

const pop = { type: 'spring' as const, stiffness: 480, damping: 34 }

export function ShareSheet({ open, title, fileName, formats = ['square', 'story'], render, onClose }: Props): React.JSX.Element {
  const [format, setFormat] = useState<CardFormat>(formats[0])
  const [style, setStyle] = useState<CardStyle>('artwork')
  const [image, setImage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const toast = useApp((s) => s.toast)

  useEffect(() => {
    if (!open) return
    let alive = true
    setBusy(true)
    render(format, style)
      .then((d) => alive && setImage(d))
      .catch((e) => {
        console.error('[share] render failed', e)
        if (alive) toast('Could not draw the image.', 'error')
      })
      .finally(() => alive && setBusy(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, format, style])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-layer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div initial={{ scale: 0.92, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }} transition={pop}>
            <Glass radius={30} tone="thick" bezel={22} refraction={56} className="modal share">
              <button className="icon-btn modal__close" aria-label="Close" onClick={onClose}>
                <CloseIcon size={18} />
              </button>
              <div className={`share__preview share__preview--${format}`}>
                <AnimatePresence mode="popLayout">
                  {image && (
                    <motion.img
                      key={image.length + format + style}
                      src={image}
                      alt="Share card preview"
                      initial={{ opacity: 0, scale: 0.96, filter: 'blur(10px)' }}
                      animate={{ opacity: busy ? 0.6 : 1, scale: 1, filter: 'blur(0px)' }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.35 }}
                    />
                  )}
                </AnimatePresence>
                {!image && <div className="share__loading" />}
              </div>
              <div className="share__side">
                <h2 className="tools__title">{title}</h2>
                <div className="share__group">
                  <span className="share__label">Style</span>
                  <div className="pills">
                    {STYLES.map((s) => (
                      <button key={s.id} className={`pill ${style === s.id ? 'is-on' : ''}`} onClick={() => setStyle(s.id)}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
                {formats.length > 1 && (
                  <div className="share__group">
                    <span className="share__label">Size</span>
                    <div className="pills">
                      {formats.map((f) => (
                        <button key={f} className={`pill ${format === f ? 'is-on' : ''}`} onClick={() => setFormat(f)}>
                          {f === 'square' ? 'Post (4:5)' : 'Story (9:16)'}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="share__actions">
                  <button
                    className="btn"
                    disabled={!image || busy}
                    onClick={async () => {
                      if (image && (await copyCard(image))) toast('Image copied')
                    }}
                  >
                    <CopyIcon size={16} /> Copy
                  </button>
                  <button
                    className="btn btn--accent"
                    disabled={!image || busy}
                    onClick={async () => {
                      if (image && (await saveCard(image, fileName))) toast('Image saved')
                    }}
                  >
                    <DownloadIcon size={16} /> Save PNG
                  </button>
                </div>
              </div>
            </Glass>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}
