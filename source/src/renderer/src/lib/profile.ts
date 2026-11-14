import { cropImage } from '@/components/ImageCropper'
import { create } from 'zustand'
import { EMPTY_PROFILE, type Profile } from '@shared/types'

interface ProfileState {
  profile: Profile
  loaded: boolean
  load: () => Promise<void>
  update: (patch: Partial<Profile>) => void
}

let saveTimer: number | null = null

export const useProfile = create<ProfileState>((set, get) => ({
  profile: EMPTY_PROFILE,
  loaded: false,
  load: async () => {
    set({ profile: await window.pulse.profile.get(), loaded: true })
  },
  update: (patch) => {
    set({ profile: { ...get().profile, ...patch } })
    // Typing in the bio shouldn't write the file on every key press.
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => void window.pulse.profile.set(get().profile), 400)
  }
}))

/** Lets the listener crop an image file to the given aspect (null: free shape) and returns a
 *  compact JPEG data URL, or null when they cancelled. */
export async function imageFileToDataUrl(file: File, maxW: number, aspect: number | null, opts: { round?: boolean; title?: string; shapes?: boolean } = {}): Promise<string | null> {
  const canvas = await cropImage(file, { aspect, maxWidth: maxW, ...opts })
  return canvas ? canvas.toDataURL('image/jpeg', 0.86) : null
}

export function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/webp,image/gif'
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.click()
  })
}

export const newBlockId = (): string => `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

/** A picture for a wall: kept in its own shape, at most 1000 px on its long side and small
 *  enough to publish (null if it can't be read). */
export async function fileToWallImage(file: File): Promise<{ src: string; w: number; h: number } | null> {
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, 1000 / Math.max(bmp.width, bmp.height))
    const w = Math.max(1, Math.round(bmp.width * scale))
    const h = Math.max(1, Math.round(bmp.height * scale))
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bmp, 0, 0, w, h)
    bmp.close()
    for (const q of [0.84, 0.74, 0.62, 0.5]) {
      const src = c.toDataURL('image/jpeg', q)
      if (src.length < 420_000) return { src, w, h }
    }
    return null
  } catch {
    return null
  }
}
