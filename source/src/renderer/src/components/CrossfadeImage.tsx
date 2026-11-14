// An image that changes without flashing: the next picture is decoded first, then fades in
// on top of the old one, which stays fully visible underneath until the fade has finished.
// With `soft`, a big blurred backdrop is made once on a tiny canvas (blurred and saturated
// there) and simply scaled up, instead of blurring a full-window image on every redraw.
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'

const SOFT_SIZE = 96
const softCache = new Map<string, Promise<string | null>>()

/** A small, already blurred copy of `src` (null if the picture can't be read). */
function softImage(src: string, blurPx: number, saturate: number): Promise<string | null> {
  const key = `${src}|${blurPx}|${saturate}`
  let p = softCache.get(key)
  if (!p) {
    p = (async () => {
      const img = new Image()
      if (!src.startsWith('data:')) img.crossOrigin = 'anonymous'
      img.src = src
      await img.decode()
      const w = img.naturalWidth || 1
      const h = img.naturalHeight || 1
      // same shape as the picture, so object-fit crops it exactly like the original
      const cw = w >= h ? SOFT_SIZE : Math.max(8, Math.round((SOFT_SIZE * w) / h))
      const ch = w >= h ? Math.max(8, Math.round((SOFT_SIZE * h) / w)) : SOFT_SIZE
      const canvas = document.createElement('canvas')
      canvas.width = cw
      canvas.height = ch
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      // the blur is given for the full window; on the small canvas it's that much smaller
      const scale = Math.max(cw, ch) / Math.max(window.innerWidth, window.innerHeight, 1)
      const blur = Math.max(0.5, blurPx * scale)
      ctx.filter = `blur(${blur.toFixed(2)}px) saturate(${saturate})`
      // drawn a little past the edges, so the blur doesn't fade the borders to see-through
      const pad = Math.ceil(blur * 2.5)
      ctx.drawImage(img, -pad, -pad, cw + pad * 2, ch + pad * 2)
      return canvas.toDataURL('image/png')
    })().catch(() => null)
    softCache.set(key, p)
    if (softCache.size > 60) softCache.delete(softCache.keys().next().value as string)
  }
  return p
}

export function CrossfadeImage({
  src,
  className,
  duration = 1.2,
  soft
}: {
  src: string | null
  className: string
  duration?: number
  /** Make a pre-blurred backdrop: blur in px (at full window size) and saturation. */
  soft?: { blur: number; saturate: number }
}): React.JSX.Element {
  const [shown, setShown] = useState<{ key: string; url: string; soft: boolean } | null>(src ? { key: src, url: src, soft: false } : null)
  const softBlur = soft?.blur
  const softSat = soft?.saturate

  useEffect(() => {
    if (!src) {
      setShown(null)
      return
    }
    if (shown?.key === src && (shown.soft || softBlur === undefined)) return
    let alive = true
    const ready = async (): Promise<{ url: string; soft: boolean }> => {
      if (softBlur !== undefined) {
        const small = await softImage(src, softBlur, softSat ?? 1)
        if (small) return { url: small, soft: true }
      }
      const img = new Image()
      img.src = src
      await img.decode().catch(() => {})
      return { url: src, soft: false }
    }
    void ready().then((r) => alive && setShown({ key: src, ...r }))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, softBlur, softSat])

  return (
    <AnimatePresence initial={false}>
      {shown && (
        <motion.img
          key={shown.key}
          src={shown.url}
          alt=""
          className={`${className} ${shown.soft ? 'is-soft' : ''}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          // The old picture leaves only after the new one has fully covered it.
          exit={{ opacity: 0, transition: { delay: duration, duration: 0.3 } }}
          transition={{ duration, ease: 'easeInOut' }}
        />
      )}
    </AnimatePresence>
  )
}
