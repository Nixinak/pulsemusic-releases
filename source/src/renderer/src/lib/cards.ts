// Share cards drawn on a canvas: lyrics, profile and Recap summaries as PNG images.

export type CardFormat = 'square' | 'story'
export type CardStyle = 'artwork' | 'color' | 'light'

export const CARD_SIZES: Record<CardFormat, [number, number]> = {
  square: [1080, 1350],
  story: [1080, 1920]
}

const DISPLAY = '"Bricolage Grotesque Variable", "Figtree Variable", system-ui, sans-serif'
const UI = '"Figtree Variable", system-ui, sans-serif'

async function fontsReady(): Promise<void> {
  try {
    await Promise.all([
      document.fonts.load(`800 64px ${DISPLAY}`),
      document.fonts.load(`700 32px ${UI}`),
      document.fonts.load(`500 32px ${UI}`)
    ])
  } catch {
    /* fall back to system fonts */
  }
}

const imageCache = new Map<string, Promise<HTMLImageElement | null>>()

/** Loads an image for canvas use (through the main process when the host lacks CORS). */
export function loadImage(url: string | null | undefined): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null)
  let p = imageCache.get(url)
  if (!p) {
    p = (async () => {
      const src = url.startsWith('data:') ? url : await window.pulse.imageData(url).catch(() => null)
      if (!src) return null
      const img = new Image()
      img.src = src
      try {
        await img.decode()
        return img
      } catch {
        return null
      }
    })()
    imageCache.set(url, p)
  }
  return p
}

/** The current background palette from the CSS variables. */
export function currentPalette(): string[] {
  const cs = getComputedStyle(document.documentElement)
  return ['--amb-1', '--amb-2', '--amb-3', '--amb-4'].map((v) => cs.getPropertyValue(v).trim() || '#7a5cff')
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number): void {
  const s = Math.max(w / img.width, h / img.height)
  const iw = img.width * s
  const ih = img.height * s
  ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih)
}

/** Background shared by all cards. Returns the text colour to use on it. */
function drawBackground(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  style: CardStyle,
  palette: string[],
  art: HTMLImageElement | null
): { text: string; soft: string } {
  if (style === 'light') {
    ctx.fillStyle = '#f6f5f2'
    ctx.fillRect(0, 0, W, H)
    const g = ctx.createRadialGradient(W * 0.1, H * 0.05, 0, W * 0.1, H * 0.05, W * 1.1)
    g.addColorStop(0, `${palette[0]}55`)
    g.addColorStop(1, 'transparent')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
    return { text: '#111217', soft: 'rgba(17,18,23,0.55)' }
  }
  ctx.fillStyle = '#0b0b10'
  ctx.fillRect(0, 0, W, H)
  if (style === 'artwork' && art) {
    ctx.save()
    ctx.filter = 'blur(80px) saturate(1.6) brightness(0.75)'
    drawCover(ctx, art, -200, -200, W + 400, H + 400)
    ctx.restore()
  } else {
    const blobs: [number, number, number, string][] = [
      [0.15, 0.12, 0.9, palette[0]],
      [0.95, 0.3, 0.8, palette[1]],
      [0.2, 0.85, 0.9, palette[2]],
      [0.9, 0.95, 0.7, palette[3]]
    ]
    for (const [x, y, r, c] of blobs) {
      const g = ctx.createRadialGradient(W * x, H * y, 0, W * x, H * y, W * r)
      g.addColorStop(0, c)
      g.addColorStop(1, 'transparent')
      ctx.globalAlpha = 0.85
      ctx.fillStyle = g
      ctx.fillRect(0, 0, W, H)
    }
    ctx.globalAlpha = 1
  }
  // Soft vignette for legibility.
  const v = ctx.createLinearGradient(0, 0, 0, H)
  v.addColorStop(0, 'rgba(0,0,0,0.05)')
  v.addColorStop(1, 'rgba(0,0,0,0.35)')
  ctx.fillStyle = v
  ctx.fillRect(0, 0, W, H)
  return { text: '#ffffff', soft: 'rgba(255,255,255,0.7)' }
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w
    if (ctx.measureText(next).width > maxW && cur) {
      lines.push(cur)
      cur = w
    } else cur = next
  }
  if (cur) lines.push(cur)
  return lines
}

function brand(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, align: CanvasTextAlign = 'left'): void {
  ctx.font = `800 30px ${DISPLAY}`
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.fillText('Pulse Music', x, y)
  ctx.textAlign = 'left'
}

export interface LyricsCardInput {
  lines: string[]
  title: string
  artist: string
  artUrl: string | null
  format: CardFormat
  style: CardStyle
}

export async function renderLyricsCard(o: LyricsCardInput): Promise<string> {
  await fontsReady()
  const [W, H] = CARD_SIZES[o.format]
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const art = await loadImage(o.artUrl)
  const { text, soft } = drawBackground(ctx, W, H, o.style, currentPalette(), art)

  const pad = 90
  // Header: cover + title.
  const cs = 150
  if (art) {
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.35)'
    ctx.shadowBlur = 40
    ctx.shadowOffsetY = 14
    roundRect(ctx, pad, pad, cs, cs, 22)
    ctx.fillStyle = '#000'
    ctx.fill()
    ctx.restore()
    ctx.save()
    roundRect(ctx, pad, pad, cs, cs, 22)
    ctx.clip()
    drawCover(ctx, art, pad, pad, cs, cs)
    ctx.restore()
  }
  const tx = art ? pad + cs + 34 : pad
  ctx.fillStyle = text
  ctx.font = `800 46px ${DISPLAY}`
  const titleLines = wrap(ctx, o.title, W - tx - pad).slice(0, 2)
  titleLines.forEach((l, i) => ctx.fillText(l, tx, pad + 58 + i * 52))
  ctx.font = `600 32px ${UI}`
  ctx.fillStyle = soft
  ctx.fillText(o.artist, tx, pad + 58 + titleLines.length * 52 + 6)

  // Lyrics, sized to fit the space.
  const top = pad + cs + 90
  const bottom = H - pad - 80
  const maxW = W - pad * 2
  let size = o.format === 'story' ? 88 : 78
  let laid: string[] = []
  for (; size >= 40; size -= 4) {
    ctx.font = `800 ${size}px ${DISPLAY}`
    laid = o.lines.flatMap((l) => (l.trim() ? wrap(ctx, l, maxW) : ['']))
    if (laid.length * size * 1.18 <= bottom - top) break
  }
  ctx.fillStyle = text
  ctx.font = `800 ${size}px ${DISPLAY}`
  const blockH = laid.length * size * 1.18
  let y = top + Math.max(0, (bottom - top - blockH) / 2) + size
  for (const l of laid) {
    ctx.fillText(l, pad, y)
    y += size * 1.18
  }

  brand(ctx, pad, H - pad, soft)
  return canvas.toDataURL('image/png')
}

export interface ProfileCardInput {
  name: string
  avatar: string | null
  banner: string | null
  bio: string
  stats: { label: string; value: string }[]
  topArtists: { name: string; image: string | null }[]
  topTracks: { name: string; artist: string; image: string | null }[]
  favourites: { title: string; items: { name: string; image: string | null }[] }[]
  style: CardStyle
}

export async function renderProfileCard(o: ProfileCardInput): Promise<string> {
  await fontsReady()
  const W = 1080
  const H = 1920
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const [banner, avatar] = await Promise.all([loadImage(o.banner), loadImage(o.avatar)])
  const { text, soft } = drawBackground(ctx, W, H, o.style, currentPalette(), banner ?? avatar)
  const pad = 80

  // Banner strip.
  const bh = 520
  if (banner) {
    ctx.save()
    drawCover(ctx, banner, 0, 0, W, bh)
    const g = ctx.createLinearGradient(0, bh * 0.4, 0, bh)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, o.style === 'light' ? '#f6f5f2' : 'rgba(11,11,16,0.95)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, bh)
    ctx.restore()
  }
  // Avatar.
  const as = 220
  const ay = bh - as / 2 - 40
  ctx.save()
  ctx.beginPath()
  ctx.arc(pad + as / 2, ay + as / 2, as / 2 + 8, 0, Math.PI * 2)
  ctx.fillStyle = o.style === 'light' ? '#fff' : 'rgba(255,255,255,0.18)'
  ctx.fill()
  ctx.beginPath()
  ctx.arc(pad + as / 2, ay + as / 2, as / 2, 0, Math.PI * 2)
  ctx.clip()
  if (avatar) drawCover(ctx, avatar, pad, ay, as, as)
  else {
    ctx.fillStyle = currentPalette()[0]
    ctx.fillRect(pad, ay, as, as)
  }
  ctx.restore()

  let y = ay + as + 100
  ctx.fillStyle = text
  ctx.font = `800 92px ${DISPLAY}`
  for (const l of wrap(ctx, o.name, W - pad * 2).slice(0, 2)) {
    ctx.fillText(l, pad, y)
    y += 96
  }
  if (o.bio) {
    ctx.font = `500 34px ${UI}`
    ctx.fillStyle = soft
    for (const l of wrap(ctx, o.bio, W - pad * 2).slice(0, 3)) {
      ctx.fillText(l, pad, y)
      y += 46
    }
  }
  y += 30

  // Stat tiles.
  if (o.stats.length) {
    const n = Math.min(3, o.stats.length)
    const gap = 20
    const tw = (W - pad * 2 - gap * (n - 1)) / n
    o.stats.slice(0, n).forEach((s, i) => {
      const x = pad + i * (tw + gap)
      roundRect(ctx, x, y, tw, 170, 30)
      ctx.fillStyle = o.style === 'light' ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.1)'
      ctx.fill()
      ctx.fillStyle = text
      ctx.font = `800 62px ${DISPLAY}`
      ctx.fillText(s.value, x + 28, y + 88)
      ctx.font = `600 26px ${UI}`
      ctx.fillStyle = soft
      ctx.fillText(s.label, x + 28, y + 136)
    })
    y += 220
  }

  const sectionTitle = (t: string): void => {
    ctx.font = `800 40px ${DISPLAY}`
    ctx.fillStyle = text
    ctx.fillText(t, pad, y)
    y += 34
  }

  // Top artists: a row of circles.
  if (o.topArtists.length) {
    sectionTitle('Top artists')
    const imgs = await Promise.all(o.topArtists.slice(0, 5).map((a) => loadImage(a.image)))
    const s = 160
    const gap = (W - pad * 2 - s * 5) / 4
    imgs.forEach((img, i) => {
      const x = pad + i * (s + gap)
      ctx.save()
      ctx.beginPath()
      ctx.arc(x + s / 2, y + 20 + s / 2, s / 2, 0, Math.PI * 2)
      ctx.clip()
      if (img) drawCover(ctx, img, x, y + 20, s, s)
      else {
        ctx.fillStyle = 'rgba(255,255,255,0.15)'
        ctx.fillRect(x, y + 20, s, s)
      }
      ctx.restore()
      ctx.font = `700 24px ${UI}`
      ctx.fillStyle = soft
      ctx.textAlign = 'center'
      const name = o.topArtists[i].name
      ctx.fillText(name.length > 13 ? `${name.slice(0, 12)}…` : name, x + s / 2, y + s + 58)
      ctx.textAlign = 'left'
    })
    y += s + 110
  }

  // Top songs and favourites as rows.
  const rows = (items: { name: string; sub?: string; image: string | null }[], max: number): Promise<void> =>
    Promise.all(items.slice(0, max).map((it) => loadImage(it.image))).then((imgs) => {
      imgs.forEach((img, i) => {
        const it = items[i]
        const s = 92
        ctx.save()
        roundRect(ctx, pad, y, s, s, 16)
        ctx.clip()
        if (img) drawCover(ctx, img, pad, y, s, s)
        else {
          ctx.fillStyle = 'rgba(255,255,255,0.15)'
          ctx.fillRect(pad, y, s, s)
        }
        ctx.restore()
        ctx.font = `800 40px ${DISPLAY}`
        ctx.fillStyle = soft
        ctx.fillText(String(i + 1), pad + s + 28, y + 60)
        ctx.font = `700 34px ${UI}`
        ctx.fillStyle = text
        const name = wrap(ctx, it.name, W - pad * 2 - s - 110)[0] ?? ''
        ctx.fillText(name, pad + s + 82, y + (it.sub ? 42 : 58))
        if (it.sub) {
          ctx.font = `500 26px ${UI}`
          ctx.fillStyle = soft
          ctx.fillText(it.sub, pad + s + 82, y + 78)
        }
        y += s + 20
      })
    })

  const favs = o.favourites.filter((f) => f.items.length > 0)
  if (o.topTracks.length) {
    sectionTitle('On repeat')
    y += 16
    await rows(
      o.topTracks.map((t) => ({ name: t.name, sub: t.artist, image: t.image })),
      favs.length ? 2 : 4
    )
    y += 30
  }
  // Favourites: one row of covers per block, as many blocks as fit.
  for (const f of favs) {
    const s = 150
    if (y + 34 + 16 + s + 50 > H - 120) break
    sectionTitle(f.title)
    y += 16
    const items = f.items.slice(0, 5)
    const imgs = await Promise.all(items.map((it) => loadImage(it.image)))
    const gap = (W - pad * 2 - s * 5) / 4
    imgs.forEach((img, i) => {
      const x = pad + i * (s + gap)
      ctx.save()
      roundRect(ctx, x, y, s, s, 22)
      ctx.clip()
      if (img) drawCover(ctx, img, x, y, s, s)
      else {
        ctx.fillStyle = 'rgba(255,255,255,0.15)'
        ctx.fillRect(x, y, s, s)
      }
      ctx.restore()
      ctx.font = `700 24px ${UI}`
      ctx.fillStyle = soft
      ctx.textAlign = 'center'
      const n = items[i].name
      ctx.fillText(n.length > 13 ? `${n.slice(0, 12)}…` : n, x + s / 2, y + s + 36)
      ctx.textAlign = 'left'
    })
    y += s + 70
  }

  brand(ctx, W - pad, H - pad + 10, soft, 'right')
  return canvas.toDataURL('image/png')
}

export async function saveCard(dataUrl: string, name: string): Promise<boolean> {
  return window.pulse.saveImage(dataUrl, name)
}

export async function copyCard(dataUrl: string): Promise<boolean> {
  return window.pulse.copyImage(dataUrl)
}
