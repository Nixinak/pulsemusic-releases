// Recolours the app's taskbar icon to match the current colours (the song's artwork or the
// palette picked in Settings). Same drawing as build/icon.png: a rounded square with a soft
// highlight and the white pulse line, only the gradient changes.
import type { Palette } from './colors'

const SIZE = 256

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h.slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
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

/** Keeps the hue but makes sure the colour is bright enough to read as an icon. */
function vivid(hex: string, minL = 0.5, maxL = 0.66): string {
  const [h, s, l] = rgbToHsl(hexToRgb(hex))
  const sat = s < 0.12 ? s : Math.max(s, 0.62)
  return `hsl(${Math.round(h * 360)} ${Math.round(sat * 100)}% ${Math.round(Math.min(maxL, Math.max(minL, l)) * 100)}%)`
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export function drawAppIcon(p: Palette): string {
  const c = document.createElement('canvas')
  c.width = SIZE
  c.height = SIZE
  const ctx = c.getContext('2d')
  if (!ctx) return ''
  const k = SIZE / 512
  ctx.scale(k, k)

  const [c1, c2, c3] = p.colors
  roundRect(ctx, 24, 24, 464, 464, 104)
  ctx.save()
  ctx.clip()

  const bg = ctx.createLinearGradient(24, 24, 488, 488)
  bg.addColorStop(0, vivid(c1, 0.58, 0.7))
  bg.addColorStop(0.5, vivid(c2))
  bg.addColorStop(1, vivid(c3, 0.45, 0.62))
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, 512, 512)

  // Soft light in the top-left corner, like the original icon.
  const glow = ctx.createRadialGradient(130, 90, 10, 130, 90, 260)
  glow.addColorStop(0, 'rgba(255,255,255,0.55)')
  glow.addColorStop(0.45, 'rgba(255,255,255,0.12)')
  glow.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, 512, 512)

  // A little shade at the bottom so the square has some depth.
  const shade = ctx.createLinearGradient(0, 300, 0, 488)
  shade.addColorStop(0, 'rgba(0,0,0,0)')
  shade.addColorStop(1, 'rgba(0,0,0,0.16)')
  ctx.fillStyle = shade
  ctx.fillRect(0, 0, 512, 512)
  ctx.restore()

  // Thin bright rim.
  roundRect(ctx, 26, 26, 460, 460, 102)
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  ctx.lineWidth = 4
  ctx.stroke()

  // The pulse line.
  ctx.beginPath()
  ctx.moveTo(96, 267)
  ctx.lineTo(170, 267)
  ctx.lineTo(205, 178)
  ctx.lineTo(248, 350)
  ctx.lineTo(296, 140)
  ctx.lineTo(338, 267)
  ctx.lineTo(416, 267)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = 34
  ctx.shadowColor = 'rgba(0,0,0,0.22)'
  ctx.shadowBlur = 16
  ctx.shadowOffsetY = 6
  ctx.strokeStyle = '#fff'
  ctx.stroke()

  return c.toDataURL('image/png')
}

let timer: ReturnType<typeof setTimeout> | null = null
let lastKey = ''

/** Debounced: songs and pages can change colours quickly, the taskbar only needs the result. */
export function updateTaskbarIcon(p: Palette): void {
  if (window.location.hash.startsWith('#/mini')) return
  const key = p.colors.join()
  if (key === lastKey) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    lastKey = key
    const url = drawAppIcon(p)
    if (url) window.pulse.window.setIcon?.(url)
  }, 700)
}
