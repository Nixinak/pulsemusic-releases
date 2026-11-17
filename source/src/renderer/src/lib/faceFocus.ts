// Artist pictures cropped around the face. A wide banner shows only a slice of a square photo,
// and a fixed "a bit above the middle" often lands on a forehead or a flag. Pulse looks for the
// face once per picture (Chromium's face detector, which uses the one built into Windows) and
// moves the crop so the face sits a little above the middle of what is shown. When no face is
// found it falls back to where the skin-coloured part of the picture is, and else to the old
// spot. The result is remembered per picture.
import { useEffect, type RefObject } from 'react'

const KEY = 'pulse-face1'
/** x and y of the face's centre, as fractions of the picture; null = nothing found. */
type Focus = [number, number] | null

let cache: Record<string, Focus> | null = null
const load = (): Record<string, Focus> => {
  if (cache) return cache
  try {
    cache = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Focus>
  } catch {
    cache = {}
  }
  return cache
}
let saveTimer = 0
const save = (): void => {
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    const c = load()
    const keys = Object.keys(c)
    // keep it small: the newest 400 pictures
    if (keys.length > 400) for (const k of keys.slice(0, keys.length - 400)) delete c[k]
    try {
      localStorage.setItem(KEY, JSON.stringify(c))
    } catch {
      /* storage full */
    }
  }, 800)
}

const pending = new Map<string, Promise<Focus>>()

interface FaceDetectorLike {
  detect(image: CanvasImageSource): Promise<{ boundingBox: DOMRectReadOnly }[]>
}
type FaceDetectorCtor = new (opts?: { fastMode?: boolean; maxDetectedFaces?: number }) => FaceDetectorLike

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image'))
    img.src = url
  })
}

/** Where skin-coloured pixels are (a rough stand-in when there is no face detector). */
function skinCentre(img: HTMLImageElement): Focus {
  const n = 64
  const c = document.createElement('canvas')
  c.width = n
  c.height = n
  const g = c.getContext('2d', { willReadFrequently: true })
  if (!g) return null
  g.drawImage(img, 0, 0, n, n)
  const d = g.getImageData(0, 0, n, n).data
  let sx = 0
  let sy = 0
  let sw = 0
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4
      const r = d[i]
      const gr = d[i + 1]
      const b = d[i + 2]
      // a common skin test (works across light and dark skin in normal light)
      const skin = r > 60 && gr > 30 && b > 15 && r > gr && r > b && r - Math.min(gr, b) > 15 && Math.abs(r - gr) > 12
      if (!skin) continue
      // faces are rarely at the very bottom of a portrait
      const w = 1 - (y / n) * 0.5
      sx += x * w
      sy += y * w
      sw += w
    }
  if (sw < n * n * 0.03) return null
  return [sx / sw / n, sy / sw / n]
}

async function detect(url: string): Promise<Focus> {
  const img = await loadImage(url)
  const Detector = (window as unknown as { FaceDetector?: FaceDetectorCtor }).FaceDetector
  if (Detector) {
    try {
      const faces = await new Detector({ fastMode: true, maxDetectedFaces: 5 }).detect(img)
      if (faces.length) {
        // the biggest face (the artist, not someone in the crowd)
        const f = faces.reduce((a, b) => (b.boundingBox.width * b.boundingBox.height > a.boundingBox.width * a.boundingBox.height ? b : a)).boundingBox
        return [(f.x + f.width / 2) / img.naturalWidth, (f.y + f.height / 2) / img.naturalHeight]
      }
    } catch {
      /* the detector isn't available on this computer */
    }
  }
  return skinCentre(img)
}

/** The face's position in a picture (cached). */
export function faceFocus(url: string): Promise<Focus> {
  const c = load()
  if (url in c) return Promise.resolve(c[url])
  let p = pending.get(url)
  if (!p) {
    p = detect(url)
      .catch(() => null)
      .then((f) => {
        load()[url] = f ? [Math.round(f[0] * 1000) / 1000, Math.round(f[1] * 1000) / 1000] : null
        save()
        pending.delete(url)
        return f
      })
    pending.set(url, p)
  }
  return p
}

/**
 * Crops an <img> with object-fit: cover around the face in it. `at` is where in the shown box the
 * face should sit (0.42 = a little above the middle).
 */
export function useFaceFocus(ref: RefObject<HTMLImageElement | null>, src: string | null | undefined, at = 0.42): void {
  useEffect(() => {
    const img = ref.current
    if (!img || !src) return
    let alive = true
    let focus: Focus = null
    const place = (): void => {
      if (!focus || !img.naturalWidth || !img.clientWidth) return
      const bw = img.clientWidth
      const bh = img.clientHeight
      const scale = Math.max(bw / img.naturalWidth, bh / img.naturalHeight)
      const dw = img.naturalWidth * scale
      const dh = img.naturalHeight * scale
      const clamp = (v: number): number => Math.max(0, Math.min(1, v))
      const px = dw - bw > 1 ? clamp((focus[0] * dw - bw / 2) / (dw - bw)) : 0.5
      const py = dh - bh > 1 ? clamp((focus[1] * dh - bh * at) / (dh - bh)) : 0.5
      img.style.objectPosition = `${(px * 100).toFixed(1)}% ${(py * 100).toFixed(1)}%`
    }
    void faceFocus(src).then((f) => {
      if (!alive) return
      focus = f
      if (img.complete) place()
      else img.addEventListener('load', place, { once: true })
    })
    const ro = new ResizeObserver(place)
    ro.observe(img)
    return () => {
      alive = false
      ro.disconnect()
      img.removeEventListener('load', place)
      img.style.objectPosition = ''
    }
  }, [ref, src, at])
}
