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
