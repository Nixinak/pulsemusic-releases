// Crop dialog shown after picking an image (profile photo, banner, profile images, playlist
// cover): drag to move the picture, scroll or use the slider to zoom, then "Apply".
// Usage: `const canvas = await cropImage(file, { aspect: 1, round: true })` (null when cancelled).
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { create } from 'zustand'
import { Glass } from './Glass'
import { CloseIcon } from './Icons'

export interface CropOptions {
  /** width / height of the result; null keeps the picture's own shape */
  aspect: number | null
  /** show a round guide (profile photos) */
  round?: boolean
  /** longest side of the result in pixels */
  maxWidth?: number
  title?: string
}

interface Job {
  bitmap: ImageBitmap
  url: string
  opts: CropOptions
  done: (c: HTMLCanvasElement | null) => void
}

const useCrop = create<{ job: Job | null }>(() => ({ job: null }))

/** Opens the crop dialog for a file; resolves with the cropped picture, or null if cancelled. */
export async function cropImage(file: File, opts: CropOptions): Promise<HTMLCanvasElement | null> {
  const bitmap = await createImageBitmap(file)
  const url = URL.createObjectURL(file)
  return new Promise((resolve) => {
    useCrop.getState().job?.done(null)
    useCrop.setState({
      job: {
        bitmap,
        url,
        opts,
        done: (c) => {
          useCrop.setState({ job: null })
          URL.revokeObjectURL(url)
          bitmap.close()
          resolve(c)
        }
      }
    })
  })
}

const MAX_ZOOM = 5

function Cropper({ job }: { job: Job }): React.JSX.Element {
  const { bitmap, url, opts } = job
  const iw = bitmap.width
  const ih = bitmap.height
  const aspect = opts.aspect ?? iw / ih
  // frame size on screen
  const [box, setBox] = useState({ w: 520, h: 520 })
  useLayoutEffect(() => {
    const fit = (): void => {
      const maxW = Math.min(620, window.innerWidth - 120)
      const maxH = Math.min(440, window.innerHeight - 280)
      let w = maxW
      let h = w / aspect
      if (h > maxH) {
        h = maxH
        w = h * aspect
      }
      setBox({ w: Math.round(w), h: Math.round(h) })
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [aspect])
  const base = Math.max(box.w / iw, box.h / ih)
  const [zoom, setZoom] = useState(1)
  // position of the picture's centre relative to the frame's centre, in screen pixels
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const s = base * zoom
  const clamp = (p: { x: number; y: number }, sc = s): { x: number; y: number } => {
    const mx = Math.max(0, (iw * sc - box.w) / 2)
    const my = Math.max(0, (ih * sc - box.h) / 2)
    return { x: Math.min(mx, Math.max(-mx, p.x)), y: Math.min(my, Math.max(-my, p.y)) }
  }
  useEffect(() => setPos((p) => clamp(p)), [box.w, box.h]) // eslint-disable-line react-hooks/exhaustive-deps

  /** zoom keeping the point (fx, fy) (relative to the frame centre) in place */
  const zoomTo = (z: number, fx = 0, fy = 0): void => {
    const nz = Math.min(MAX_ZOOM, Math.max(1, z))
    const k = nz / zoom
    setZoom(nz)
    setPos((p) => clamp({ x: fx - (fx - p.x) * k, y: fy - (fy - p.y) * k }, base * nz))
  }

  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  const frame = useRef<HTMLDivElement>(null)
  // wheel needs a non-passive listener to stop the page from scrolling
  useEffect(() => {
    const el = frame.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      zoomTo(zoom * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  const apply = (): void => {
    const sw = box.w / s
    const sh = box.h / s
    const sx = iw / 2 - pos.x / s - sw / 2
    const sy = ih / 2 - pos.y / s - sh / 2
    const maxW = opts.maxWidth ?? 1600
    const outW = Math.round(Math.min(maxW, sw))
    const outH = Math.round(outW / aspect)
    const c = document.createElement('canvas')
    c.width = Math.max(1, outW)
    c.height = Math.max(1, outH)
    const g = c.getContext('2d')!
    g.imageSmoothingQuality = 'high'
    g.drawImage(bitmap, sx, sy, sw, sh, 0, 0, c.width, c.height)
    job.done(c)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') job.done(null)
      if (e.key === 'Enter') apply()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <Glass radius={28} tone="thick" bezel={22} refraction={56} className="modal cropper" style={{ width: box.w + 60 }}>
      <button className="icon-btn modal__close" aria-label="Cancel" onClick={() => job.done(null)}>
        <CloseIcon size={18} />
      </button>
      <div className="modal__form">
        <h2>{opts.title ?? 'Crop image'}</h2>
        <div
          ref={frame}
          className={`cropper__frame ${opts.round ? 'cropper__frame--round' : ''}`}
          style={{ width: box.w, height: box.h }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y }
          }}
          onPointerMove={(e) => {
            const d = drag.current
            if (d) setPos(clamp({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y }))
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          onDoubleClick={() => {
            setZoom(1)
            setPos({ x: 0, y: 0 })
          }}
        >
          <img
            src={url}
            alt=""
            draggable={false}
            style={{
              width: iw * s,
              height: ih * s,
              transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px))`
            }}
          />
          <div className="cropper__guide" />
        </div>
        <div className="cropper__zoom">
          <span className="muted">Zoom</span>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(e) => zoomTo(Number(e.target.value))}
            aria-label="Zoom"
          />
        </div>
        <p className="muted cropper__hint">Drag to move · scroll to zoom · double-click to reset</p>
        <div className="modal__actions">
          <button className="btn" onClick={() => job.done(null)}>
            Cancel
          </button>
          <button className="btn btn--accent" onClick={apply}>
            Apply
          </button>
        </div>
      </div>
    </Glass>
  )
}

/** Mounted once in App. */
export function ImageCropLayer(): React.JSX.Element {
  const job = useCrop((s) => s.job)
  return (
    <AnimatePresence>
      {job && (
        <motion.div
          key={job.url}
          className="modal-layer cropper-layer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && job.done(null)}
        >
          <motion.div initial={{ scale: 0.94, y: 16 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 8 }}>
            <Cropper job={job} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
