// Extracts an ambient palette and an accent colour from album artwork.
import { updateTaskbarIcon } from './taskbarIcon'

export interface Palette {
  /** Four colours for the ambient background, darkest-safe. */
  colors: [string, string, string, string]
  /** Most vibrant colour, tuned for readable UI on dark and light. */
  accentDark: string
  accentLight: string
}

type RGB = [number, number, number]

export const DEFAULT_PALETTE: Palette = {
  colors: ['#ff4f8b', '#b03cff', '#4a5cff', '#2ad1c9'],
  accentDark: '#ff5c93',
  accentLight: '#d81b60'
}

function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return [h / 6, s, l]
}

function hslToHex(h: number, s: number, l: number): string {
  const f = (n: number): string => {
    const k = (n + h * 12) % 12
    const a = s * Math.min(l, 1 - l)
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

const cache = new Map<string, Palette>()

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image()
  if (!src.startsWith('data:')) img.crossOrigin = 'anonymous'
  img.src = src
  await img.decode()
  return img
}

export async function extractPalette(url: string): Promise<Palette> {
  const hit = cache.get(url)
  if (hit) return hit

  const size = 40
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return DEFAULT_PALETTE
  let data: Uint8ClampedArray
  try {
    const img = await loadImage(url)
    ctx.drawImage(img, 0, 0, size, size)
    data = ctx.getImageData(0, 0, size, size).data
  } catch {
    // Host without CORS headers (some playlist covers): fetch it through the main process.
    const dataUrl = await window.pulse.imageData(url)
    if (!dataUrl) return DEFAULT_PALETTE
    const img = await loadImage(dataUrl)
    ctx.clearRect(0, 0, size, size)
    ctx.drawImage(img, 0, 0, size, size)
    data = ctx.getImageData(0, 0, size, size).data
  }

  // Bucket pixels at 4 bits per channel.
  const buckets = new Map<number, { sum: RGB; n: number }>()
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const e = buckets.get(key)
    if (e) {
      e.sum[0] += r
      e.sum[1] += g
      e.sum[2] += b
      e.n++
    } else buckets.set(key, { sum: [r, g, b], n: 1 })
  }

  const swatches = [...buckets.values()]
    .map((e) => {
      const rgb: RGB = [e.sum[0] / e.n, e.sum[1] / e.n, e.sum[2] / e.n]
      const [h, s, l] = rgbToHsl(rgb)
      return { h, s, l, n: e.n }
    })
    .sort((a, b) => b.n - a.n)

  // Pick up to four distinct hues, weighted by population and saturation.
  const picked: typeof swatches = []
  const scored = [...swatches].sort(
    (a, b) => b.n * (0.35 + b.s) * (1 - Math.abs(b.l - 0.5)) - a.n * (0.35 + a.s) * (1 - Math.abs(a.l - 0.5))
  )
  for (const sw of scored) {
    if (picked.length >= 4) break
    const distinct = picked.every((p) => {
      const dh = Math.min(Math.abs(p.h - sw.h), 1 - Math.abs(p.h - sw.h))
      return dh > 0.06 || Math.abs(p.l - sw.l) > 0.25
    })
    if (distinct) picked.push(sw)
  }
  while (picked.length < 4) picked.push(picked[picked.length - 1] ?? { h: 0.9, s: 0.7, l: 0.5, n: 1 })

  const colors = picked.map((p) => hslToHex(p.h, Math.min(1, p.s * 1.1), Math.min(0.62, Math.max(0.28, p.l)))) as Palette['colors']

  const vivid = [...picked].sort((a, b) => b.s * (1 - Math.abs(b.l - 0.5)) - a.s * (1 - Math.abs(a.l - 0.5)))[0]
  const greyish = vivid.s < 0.18
  const palette: Palette = {
    colors,
    accentDark: greyish ? '#f5f5f7' : hslToHex(vivid.h, Math.max(0.6, vivid.s), 0.66),
    accentLight: greyish ? '#1d1e24' : hslToHex(vivid.h, Math.max(0.6, vivid.s), 0.4)
  }
  cache.set(url, palette)
  return palette
}

export const PRESETS: { id: string; name: string; colors: [string, string, string, string] }[] = [
  { id: 'pulse', name: 'Pulse', colors: ['#ff4f8b', '#b03cff', '#4a5cff', '#2ad1c9'] },
  { id: 'aurora', name: 'Aurora', colors: ['#2ad1c9', '#4a5cff', '#7cf29c', '#b03cff'] },
  { id: 'sunset', name: 'Sunset', colors: ['#ff7a45', '#ff3d6e', '#ffb347', '#7b2ff7'] },
  { id: 'ocean', name: 'Ocean', colors: ['#0077b6', '#00b4d8', '#48cae4', '#023e8a'] },
  { id: 'forest', name: 'Forest', colors: ['#2d6a4f', '#52b788', '#95d5b2', '#1b4332'] },
  { id: 'ember', name: 'Ember', colors: ['#d00000', '#ff6d00', '#ffba08', '#6a040f'] },
  { id: 'candy', name: 'Candy', colors: ['#ff8fab', '#a0c4ff', '#caffbf', '#ffc6ff'] },
  { id: 'mono', name: 'Graphite', colors: ['#6b7280', '#9ca3af', '#374151', '#d1d5db'] }
]

function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Builds a full palette (with readable accents) from four chosen colours. */
export function paletteFromColors(colors: [string, string, string, string]): Palette {
  const hsl = colors.map((c) => rgbToHsl(hexToRgb(c)))
  const vivid = [...hsl].sort((a, b) => b[1] * (1 - Math.abs(b[2] - 0.5)) - a[1] * (1 - Math.abs(a[2] - 0.5)))[0]
  const grey = vivid[1] < 0.18
  return {
    colors,
    accentDark: grey ? '#f5f5f7' : hslToHex(vivid[0], Math.max(0.6, vivid[1]), 0.66),
    accentLight: grey ? '#1d1e24' : hslToHex(vivid[0], Math.max(0.6, vivid[1]), 0.4)
  }
}

let trackPalette: Palette = DEFAULT_PALETTE
let pagePalette: Palette | null = null
let pageSuspended = false
let chosen: Palette | null = null
let chosenScope: 'everywhere' | 'home' = 'everywhere'

const refresh = (): void => {
  // The taskbar icon follows the song (or the palette picked for everywhere), not page tints.
  updateTaskbarIcon(chosen && chosenScope === 'everywhere' ? chosen : trackPalette)
  if (chosen && chosenScope === 'everywhere') return applyPalette(chosen)
  applyPalette(pagePalette && !pageSuspended ? pagePalette : trackPalette)
}

/** The palette picked in Settings (null = follow the artwork). */
export function setChosenPalette(p: Palette | null, scope: 'everywhere' | 'home'): void {
  chosen = p
  chosenScope = scope
  refresh()
}

/** Home shows the chosen palette when it is limited to the home page. */
export function homePalette(): Palette | null {
  return chosen && chosenScope === 'home' ? chosen : null
}

/** The current song's colours; shown unless a page has its own. */
export function setTrackPalette(p: Palette): void {
  trackPalette = p
  refresh()
}

let pageOwner: symbol | null = null

/** Artist/album/playlist pages tint the whole app with their artwork's colours.
 *  An `owner` lets a page clear only colours it set itself: a page that is still
 *  animating out must not wipe the colours the next page already applied. */
export function setPagePalette(p: Palette | null, owner?: symbol): void {
  if (p === null && owner && pageOwner !== owner) return
  pagePalette = p
  pageOwner = p ? (owner ?? null) : null
  refresh()
}

/** Now Playing always shows the song's colours, even over a themed page. */
export function suspendPagePalette(on: boolean): void {
  pageSuspended = on
  refresh()
}

export function getTrackPalette(): Palette {
  return trackPalette
}

export function applyPalette(p: Palette): void {
  const root = document.documentElement.style
  p.colors.forEach((c, i) => root.setProperty(`--amb-${i + 1}`, c))
  root.setProperty('--accent-dark', p.accentDark)
  root.setProperty('--accent-light', p.accentLight)
}
