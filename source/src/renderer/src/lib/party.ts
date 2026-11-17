// Party mode on the app's side: starts/stops the phone page and keeps it in step with the queue.
import { create } from 'zustand'
import { addToQueue, handleCommand, removeFromQueue, usePlayer } from './player'
import { useApp } from './store'
import type { PartyInfo } from '@shared/types'

interface PartyStore {
  url: string | null
  info: PartyInfo | null
  /** Songs guests added this party, newest first (for the Party page). */
  added: { name: string; artists: string; guest: string; at: number }[]
  /** Party votes per song (thumbs up minus down). */
  scores: Record<string, number>
  /** The host's own votes. */
  mine: Record<string, number>
}

export const useParty = create<PartyStore>(() => ({
  url: null,
  info: null,
  added: [],
  scores: {},
  mine: {}
}))

/** The host votes too: thumbs up (1), down (-1), or the same again to take it back. */
export function hostVote(uri: string, v: 1 | -1): void {
  const was = useParty.getState().mine[uri] ?? 0
  const next = was === v ? 0 : v
  useParty.setState((s) => ({ mine: { ...s.mine, [uri]: next } }))
  void window.pulse.party.vote(uri, next)
}

const setInfo = (info: PartyInfo | null): void => useParty.setState({ info, url: info?.url ?? null })
let unsubLink: (() => void) | null = null

let unsubQueue: (() => void) | null = null
let unsubAdd: (() => void) | null = null
let unsubControl: (() => void) | null = null

function pushQueue(): void {
  const q = usePlayer.getState().upNext
  window.pulse.party.setQueue(
    q.map((i) => ({
      uri: i.uri,
      name: i.name,
      artists: i.artists,
      image: i.image,
      addedBy: i.addedBy
    }))
  )
}

function listen(): void {
  unsubLink?.()
  unsubLink = window.pulse.party.onLink(setInfo)
  unsubQueue?.()
  unsubQueue = usePlayer.subscribe((s, p) => {
    if (s.upNext !== p.upNext) pushQueue()
  })
  unsubAdd?.()
  unsubAdd = window.pulse.party.onAdd(({ track, guest }) => {
    addToQueue(
      {
        id: track.id,
        uri: track.uri,
        name: track.name,
        artists: track.artists.split(', ').map((name) => ({ name })),
        album: {
          images: track.image ? [{ url: track.image, width: 300 }] : []
        }
      },
      undefined,
      { addedBy: guest, quiet: true }
    )
    useApp.getState().toast(`${guest} added “${track.name}”`)
    useParty.setState((s) => ({
      added: [{ name: track.name, artists: track.artists, guest, at: Date.now() }, ...s.added].slice(0, 30)
    }))
  })
  unsubControl?.()
  unsubControl = window.pulse.party.onControl(({ control: c, guest }) => {
    const toast = useApp.getState().toast
    if (c.action === 'votes') {
      // the best voted songs move up; a song voted down by three people more than up leaves
      useParty.setState({ scores: c.scores })
      const q = usePlayer.getState().upNext
      const score = (uri: string): number => c.scores[uri] ?? 0
      const out = q.filter((x) => score(x.uri) <= -3)
      const keep = q
        .filter((x) => score(x.uri) > -3)
        .map((x, i) => ({ x, i }))
        .sort((a, b) => score(b.x.uri) - score(a.x.uri) || a.i - b.i)
        .map((y) => y.x)
      if (keep.some((x, i) => x !== q[i]) || out.length) usePlayer.setState({ upNext: keep, nextUp: null })
      for (const x of out) toast(`“${x.name}” was voted off the queue`)
      return
    }
    if (c.action === 'remove') {
      const item = usePlayer.getState().upNext.find((q) => q.uri === c.uri)
      if (!item) return
      removeFromQueue(item.uid)
      toast(`${guest} removed “${item.name}”`)
      return
    }
    if (c.action === 'seek') return handleCommand({ type: 'seek', positionMs: c.positionMs })
    const paused = usePlayer.getState().paused
    handleCommand({ type: c.action })
    toast(c.action === 'toggle' ? `${guest} ${paused ? 'pressed play' : 'paused'}` : c.action === 'next' ? `${guest} skipped` : `${guest} went back`)
  })
  pushQueue()
}

export async function startParty(): Promise<void> {
  setInfo(await window.pulse.party.start())
  listen()
}

export async function stopParty(): Promise<void> {
  await window.pulse.party.stop()
  unsubQueue?.()
  unsubAdd?.()
  unsubLink?.()
  unsubControl?.()
  unsubQueue = unsubAdd = unsubLink = unsubControl = null
  useParty.setState({ url: null, info: null, added: [] })
}

/** After a reload the server may still be running: pick it up again. */
export async function resumeParty(): Promise<void> {
  const info = await window.pulse.party.info().catch(() => null)
  if (info) {
    setInfo(info)
    listen()
  }
}
