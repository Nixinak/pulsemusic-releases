export function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function formatDuration(ms: number): string {
  const min = Math.round(ms / 60000)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return `${h} hr ${min % 60} min`
}

export const year = (date?: string): string => (date ? date.slice(0, 4) : '')

export function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Up late'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** Strips HTML entities/tags Spotify puts into playlist descriptions. */
export function cleanDescription(s: string | null | undefined): string {
  if (!s) return ''
  const d = new DOMParser().parseFromString(s, 'text/html')
  return d.body.textContent?.trim() ?? ''
}
