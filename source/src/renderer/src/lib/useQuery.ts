import { useCallback, useEffect, useRef, useState } from 'react'
import { dropSaved, freshFor, readSaved, writeSaved } from './persist'

const cache = new Map<string, unknown>()
/** When each cached value was fetched (or saved, for values read from disk). */
const stamp = new Map<string, number>()
const inflight = new Map<string, Promise<unknown>>()

/** Shares one request per key between prefetching and the page that needs it. */
function load<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const running = inflight.get(key) as Promise<T> | undefined
  if (running) return running
  const p = fn()
    .then((d) => {
      cache.set(key, d)
      stamp.set(key, Date.now())
      if (freshFor(key) !== null && d !== undefined && d !== null) void writeSaved(key, d)
      return d
    })
    .finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

/** Starts loading data before navigation (e.g. on hover). Fresh data saved on disk is used
 *  without asking Spotify. */
export function prefetch<T>(key: string, fn: () => Promise<T>): void {
  if (cache.has(key) || inflight.has(key)) return
  const ttl = freshFor(key)
  if (ttl === null) return void load(key, fn).catch(() => {})
  void readSaved<T>(key).then((hit) => {
    if (hit && !cache.has(key)) {
      cache.set(key, hit.d)
      stamp.set(key, hit.t)
    }
    if (!hit || Date.now() - hit.t > ttl) load(key, fn).catch(() => {})
  })
}

export interface QueryResult<T> {
  data: T | undefined
  error: string | null
  loading: boolean
  reload: () => void
  setData: (updater: (prev: T | undefined) => T | undefined) => void
}

/** Small cached async loader: instant results when navigating back. */
export function useQuery<T>(key: string | null, fn: () => Promise<T>): QueryResult<T> {
  const [data, setDataState] = useState<T | undefined>(() => (key ? (cache.get(key) as T | undefined) : undefined))
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(!!key && !cache.has(key))
  const [nonce, setNonce] = useState(0)
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    if (!key) return
    let alive = true
    const inMemory = cache.has(key)
    if (inMemory) setDataState(cache.get(key) as T)
    else setDataState(undefined)
    setLoading(!inMemory)
    setError(null)
    const fetchNow = (): void => {
      load(key, () => fnRef.current())
        .then((d) => {
          if (!alive) return
          setDataState(d)
        })
        .catch((e: unknown) => {
          // With data already on screen (from disk), a failed refresh is not worth an error.
          if (alive && !cache.has(key)) setError(e instanceof Error ? e.message : String(e))
        })
        .finally(() => {
          if (alive) setLoading(false)
        })
    }
    const ttl = freshFor(key)
    if (nonce > 0 || ttl === null) fetchNow()
    else if (inMemory) {
      // Already here this session: refresh only when it has gone stale.
      if (Date.now() - (stamp.get(key) ?? 0) > ttl) fetchNow()
    }
    else {
      // Show what was saved last time right away; only ask Spotify when it is getting old.
      void readSaved<T>(key).then((hit) => {
        if (!alive) return
        if (hit && !cache.has(key)) {
          cache.set(key, hit.d)
          stamp.set(key, hit.t)
          setDataState(hit.d)
          setLoading(false)
        }
        if (!hit || Date.now() - hit.t > ttl) fetchNow()
      })
    }
    return () => {
      alive = false
    }
  }, [key, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  const setData = useCallback(
    (updater: (prev: T | undefined) => T | undefined) => {
      setDataState((prev) => {
        const next = updater(prev)
        if (key) {
          cache.set(key, next)
          stamp.set(key, Date.now())
          if (freshFor(key) !== null && next !== undefined) void writeSaved(key, next)
        }
        return next
      })
    },
    [key]
  )

  return { data, error, loading, reload, setData }
}

export function invalidate(prefix: string): void {
  for (const k of [...cache.keys()]) if (k.startsWith(prefix)) (cache.delete(k), stamp.delete(k))
  void dropSaved(prefix)
}
