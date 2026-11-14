// An image that changes without flashing: the next picture is decoded first, then fades in
// on top of the old one, which stays fully visible underneath until the fade has finished.
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'

export function CrossfadeImage({
  src,
  className,
  duration = 1.2
}: {
  src: string | null
  className: string
  duration?: number
}): React.JSX.Element {
  const [shown, setShown] = useState<string | null>(src)

  useEffect(() => {
    if (!src || src === shown) {
      if (!src) setShown(null)
      return
    }
    let alive = true
    const img = new Image()
    img.src = src
    img
      .decode()
      .catch(() => {})
      .finally(() => alive && setShown(src))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src])

  return (
    <AnimatePresence initial={false}>
      {shown && (
        <motion.img
          key={shown}
          src={shown}
          alt=""
          className={className}
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
