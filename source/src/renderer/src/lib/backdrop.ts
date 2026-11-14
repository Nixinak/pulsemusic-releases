import { create } from 'zustand'

/** Artwork shown blurred behind the whole window while an album, artist or playlist page is open. */
export const useBackdrop = create<{ url: string | null }>(() => ({ url: null }))
