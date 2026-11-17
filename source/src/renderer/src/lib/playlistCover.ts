// Covers for the playlists Pulse makes (mixes, Made for you, merged playlists): four of the
// playlist's album covers in a square, with its name on a dark fade at the bottom, uploaded as the
// playlist's cover on Spotify. Without it a new playlist has no picture until Spotify makes one,
// and then it looks the same as every other.
import * as sp from './spotify'

const SIZE = 640

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

/** Breaks the name into at most three lines that fit `max` pixels. */
function lines(g: CanvasRenderingContext2D, text: string, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const out: string[] = []
  let cur = ''
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w
    if (g.measureText(next).width <= max || !cur) cur = next
    else {
      out.push(cur)
      cur = w
    }
  }
  if (cur) out.push(cur)
  if (out.length > 3) {
    out.length = 3
    out[2] = `${out[2].replace(/\s+\S*$/, '')}…`
  }
  return out
}

/** Draws the cover: four covers (or one, when there are fewer) and the name. Base64 JPEG. */
export async function makePlaylistCover(images: string[], title: string): Promise<string | null> {
  const unique = [...new Set(images.filter(Boolean))]
  if (!unique.length) return null
  const picked = (await Promise.all(unique.slice(0, 8).map(loadImage))).filter((i): i is HTMLImageElement => !!i)
  if (!picked.length) return null
  const c = document.createElement('canvas')
  c.width = SIZE
  c.height = SIZE
  const g = c.getContext('2d')
  if (!g) return null
  g.fillStyle = '#111'
  g.fillRect(0, 0, SIZE, SIZE)
  if (picked.length >= 4) {
    const h = SIZE / 2
    picked.slice(0, 4).forEach((img, i) => g.drawImage(img, (i % 2) * h, Math.floor(i / 2) * h, h, h))
  } else g.drawImage(picked[0], 0, 0, SIZE, SIZE)

  // a dark fade at the bottom for the name
  const fade = g.createLinearGradient(0, SIZE * 0.42, 0, SIZE)
  fade.addColorStop(0, 'rgba(0,0,0,0)')
  fade.addColorStop(0.55, 'rgba(0,0,0,0.55)')
  fade.addColorStop(1, 'rgba(0,0,0,0.85)')
  g.fillStyle = fade
  g.fillRect(0, 0, SIZE, SIZE)

  const display = getComputedStyle(document.documentElement).getPropertyValue('--font-display').trim() || 'system-ui, sans-serif'
  try {
    await document.fonts.load(`800 60px ${display}`)
  } catch {
    /* the system font will do */
  }
  const pad = 44
  let size = 66
  g.font = `800 ${size}px ${display}`
  let ls = lines(g, title, SIZE - pad * 2)
  while (ls.length > 2 && size > 44) {
    size -= 6
    g.font = `800 ${size}px ${display}`
    ls = lines(g, title, SIZE - pad * 2)
  }
  g.fillStyle = '#fff'
  g.textBaseline = 'alphabetic'
  g.shadowColor = 'rgba(0,0,0,0.35)'
  g.shadowBlur = 18
  const lh = size * 1.02
  ls.forEach((l, i) => g.fillText(l, pad, SIZE - pad - (ls.length - 1 - i) * lh))
  g.shadowBlur = 0

  // the Pulse mark in the corner
  g.font = `800 20px ${display}`
  const mark = 'PULSE'
  const mw = g.measureText(mark).width + 28
  g.fillStyle = 'rgba(0,0,0,0.45)'
  g.beginPath()
  g.roundRect(pad - 4, pad - 6, mw, 36, 18)
  g.fill()
  g.fillStyle = '#fff'
  g.fillText(mark, pad + 10, pad + 19)

  // Spotify takes at most 256 KB of base64
  for (let q = 0.9; q >= 0.45; q -= 0.1) {
    const data = c.toDataURL('image/jpeg', q).split(',')[1] ?? ''
    if (data.length < 250_000) return data
  }
  return null
}

/** Makes and uploads the cover of a new playlist; never fails the save if it doesn't work. */
export async function coverNewPlaylist(id: string, images: (string | null | undefined)[], title: string): Promise<void> {
  try {
    const jpeg = await makePlaylistCover(images.filter((x): x is string => !!x), title)
    if (jpeg) await sp.uploadPlaylistCover(id, jpeg)
  } catch (e) {
    console.warn('[playlist cover]', e)
  }
}
