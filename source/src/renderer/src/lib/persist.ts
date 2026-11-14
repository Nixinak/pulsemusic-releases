// A small on-disk cache (IndexedDB) for page data, so pages open instantly from the last visit
// and the app asks Spotify far less often. Values are plain JSON from the Web API.
const DB = 'pulse-cache'
const STORE = 'queries'
let dbp: Promise<IDBDatabase | null> | null = null

function db(): Promise<IDBDatabase | null> {
  dbp ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbp
}

export interface Saved<T> {
  t: number
  d: T
}

export async function readSaved<T>(key: string): Promise<Saved<T> | null> {
  const d = await db()
  if (!d) return null
  return new Promise((resolve) => {
    try {
      const r = d.transaction(STORE, 'readonly').objectStore(STORE).get(key)
      r.onsuccess = () => resolve((r.result as Saved<T>) ?? null)
      r.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

export async function writeSaved(key: string, value: unknown): Promise<void> {
  const d = await db()
  if (!d) return
  try {
    d.transaction(STORE, 'readwrite').objectStore(STORE).put({ t: Date.now(), d: value }, key)
  } catch {
    /* quota or a value that can't be stored: skip */
  }
}

export async function dropSaved(prefix: string): Promise<void> {
  const d = await db()
  if (!d) return
  try {
    const store = d.transaction(STORE, 'readwrite').objectStore(STORE)
    const r = store.openCursor()
    r.onsuccess = () => {
      const c = r.result
      if (!c) return
      if (String(c.key).startsWith(prefix)) c.delete()
      c.continue()
    }
  } catch {
    /* ignore */
  }
}

/** Removes entries older than two weeks (run once at start). */
export async function pruneSaved(): Promise<void> {
  const d = await db()
  if (!d) return
  try {
    const cutoff = Date.now() - 14 * 86400_000
    const store = d.transaction(STORE, 'readwrite').objectStore(STORE)
    const r = store.openCursor()
    r.onsuccess = () => {
      const c = r.result
      if (!c) return
      if (((c.value as Saved<unknown>)?.t ?? 0) < cutoff) c.delete()
      c.continue()
    }
  } catch {
    /* ignore */
  }
}

const MIN = 60_000
/** How long saved data counts as fresh (no request at all), by key prefix. */
const RULES: [string, number][] = [
  ['album:', 7 * 24 * 60 * MIN],
  ['artist-page:', 24 * 60 * MIN],
  ['artist-info:', 24 * 60 * MIN],
  ['artist-top:', 12 * 60 * MIN],
  ['artist-popular:', 12 * 60 * MIN],
  ['artist-albums:', 12 * 60 * MIN],
  ['artist-appears:', 24 * 60 * MIN],
  ['artist:', 12 * 60 * MIN],
  ['stats:', 30 * MIN],
  ['home:', 10 * MIN],
  ['lib:', 10 * MIN],
  ['spotify-user:', 30 * MIN],
  ['spotify-user-quick:', 24 * 60 * MIN],
  ['pulse-user:', 5 * MIN]
]

/** Freshness in ms for a key, or null when the key isn't kept on disk. */
export function freshFor(key: string): number | null {
  for (const [prefix, ms] of RULES) if (key.startsWith(prefix)) return ms
  return null
}
