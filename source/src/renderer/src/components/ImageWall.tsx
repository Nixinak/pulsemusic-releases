// A wall of pictures on a profile, laid out like a mosaic: square cells on a grid, each
// picture one cell, two side by side, two on top of each other or two by two. "Auto" picks from
// the picture's shape (wide pictures get a wide spot, tall ones a tall spot, and some squares
// get a big one), so most pictures show whole. While editing, each picture can be made bigger
// or smaller, moved or removed, and more can be added.
import { useMemo, useState } from 'react'
import type { WallImage } from '@shared/types'
import { fileToWallImage } from '@/lib/profile'
import { CloseIcon, PlusIcon } from './Icons'

type Size = WallImage['size']
const ORDER: Size[] = ['auto', 'big', 'wide', 'tall', 'small']
const LABEL: Record<Size, string> = { auto: 'Auto', big: 'Big', wide: 'Wide', tall: 'Tall', small: 'Small' }
const MAX = 16

type Spot = Exclude<Size, 'auto'>
const SPAN: Record<Spot, [number, number]> = { big: [2, 2], wide: [2, 1], tall: [1, 2], small: [1, 1] }

/** The spot a picture would take from its shape alone. */
function natural(img: WallImage, i: number, count: number): Spot {
  if (img.size !== 'auto') return img.size
  const a = img.w / Math.max(1, img.h)
  if (a >= 1.45) return i % 3 === 0 && count > 3 ? 'big' : 'wide'
  if (a <= 0.72) return 'tall'
  // every few squares one gets the big spot, so the wall has rhythm
  return i % 4 === 0 && count > 2 ? 'big' : 'small'
}

/** Empty cells left when the spots are packed like the grid packs them (densely, row by row). */
function holes(spots: Spot[], cols: number): number {
  const rows: boolean[][] = []
  const free = (r: number, c: number): boolean => !rows[r]?.[c]
  for (const s of spots) {
    const [w, h] = SPAN[s]
    const cw = Math.min(w, cols)
    let placed = false
    for (let r = 0; !placed; r++) {
      for (let c = 0; c + cw <= cols && !placed; c++) {
        let ok = true
        for (let y = 0; y < h && ok; y++) for (let x = 0; x < cw && ok; x++) ok = free(r + y, c + x)
        if (!ok) continue
        for (let y = 0; y < h; y++) for (let x = 0; x < cw; x++) (rows[r + y] ??= [])[c + x] = true
        placed = true
      }
    }
  }
  let empty = 0
  for (const row of rows) for (let c = 0; c < cols; c++) if (!row?.[c]) empty++
  return empty
}

/** Spots for every picture: from their shapes, then the ones on "Auto" are grown or shrunk a
 *  little until the wall has no gaps (or as few as possible). */
function layout(images: WallImage[], cols = 4): Spot[] {
  const spots = images.map((img, i) => natural(img, i, images.length))
  let best = holes(spots, cols)
  const auto = images.map((img, i) => (img.size === 'auto' ? i : -1)).filter((i) => i >= 0).reverse()
  // shapes that keep the picture whole come first (a square grows into the big square spot)
  const tries: Record<Spot, Spot[]> = { small: ['big', 'wide', 'tall'], wide: ['big', 'small'], tall: ['small', 'big'], big: ['small', 'wide'] }
  for (let round = 0; round < 3 && best > 0; round++) {
    for (const i of auto) {
      if (best === 0) break
      for (const alt of tries[spots[i]]) {
        const next = spots.slice()
        next[i] = alt
        const h = holes(next, cols)
        if (h < best) {
          best = h
          spots[i] = alt
          break
        }
      }
    }
  }
  return spots
}

export function ImageWall({
  images,
  editing = false,
  onChange
}: {
  images: WallImage[]
  editing?: boolean
  onChange?: (images: WallImage[]) => void
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const set = (next: WallImage[]): void => onChange?.(next)
  // while editing, the "Add pictures" tile takes a cell too
  const spots = useMemo(() => layout(editing ? [...images, { src: '', w: 1, h: 1, size: 'small' }] : images), [images, editing])

  const add = (): void => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = 'image/png,image/jpeg,image/webp,image/gif'
    input.onchange = async () => {
      const files = [...(input.files ?? [])].slice(0, MAX - images.length)
      if (!files.length) return
      setBusy(true)
      const made = (await Promise.all(files.map(fileToWallImage))).filter((x): x is NonNullable<typeof x> => !!x)
      setBusy(false)
      set([...images, ...made.map((m) => ({ ...m, size: 'auto' as const }))].slice(0, MAX))
    }
    input.click()
  }

  const move = (i: number, d: number): void => {
    const j = i + d
    if (j < 0 || j >= images.length) return
    const next = images.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    set(next)
  }

  return (
    <div className="iwall">
      <div className="iwall__grid">
        {images.map((img, i) => (
          <figure key={`${i}-${img.src.length}`} className={`iwall__tile is-${spots[i]}`}>
            <img src={img.src} alt="" decoding="async" loading="lazy" draggable={false} />
            {editing && (
              <span className="iwall__tools">
                <button
                  className="iwall__size"
                  title="Size on the wall"
                  onClick={() => set(images.map((x, k) => (k === i ? { ...x, size: ORDER[(ORDER.indexOf(x.size) + 1) % ORDER.length] } : x)))}
                >
                  {LABEL[img.size]}
                </button>
                <button className="iwall__btn" aria-label="Move earlier" disabled={i === 0} onClick={() => move(i, -1)}>
                  ‹
                </button>
                <button className="iwall__btn" aria-label="Move later" disabled={i === images.length - 1} onClick={() => move(i, 1)}>
                  ›
                </button>
                <button className="iwall__btn" aria-label="Remove picture" onClick={() => set(images.filter((_, k) => k !== i))}>
                  <CloseIcon size={14} />
                </button>
              </span>
            )}
          </figure>
        ))}
        {editing && images.length < MAX && (
          <button className="iwall__tile iwall__add is-small" disabled={busy} onClick={add}>
            <PlusIcon size={22} />
            <span>{busy ? 'Adding…' : 'Add pictures'}</span>
          </button>
        )}
      </div>
    </div>
  )
}
