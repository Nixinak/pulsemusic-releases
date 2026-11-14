// Small JSON files in the user data folder for app data the renderer wants to keep
// (listening history and the like). Writes are atomic and coalesced.
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Only these names can be read or written from the renderer. */
export const STORE_NAMES = ['history', 'mixes'] as const
export type StoreName = (typeof STORE_NAMES)[number]

const dir = (): string => join(app.getPath('userData'), 'data')
const file = (name: StoreName): string => join(dir(), `${name}.json`)

export const isStoreName = (n: unknown): n is StoreName =>
  typeof n === 'string' && (STORE_NAMES as readonly string[]).includes(n)

export function readStore(name: StoreName): unknown {
  try {
    if (!existsSync(file(name))) return null
    return JSON.parse(readFileSync(file(name), 'utf8'))
  } catch (e) {
    console.error(`[store] could not read ${name}`, e)
    return null
  }
}

export function writeStore(name: StoreName, data: unknown): void {
  mkdirSync(dir(), { recursive: true })
  const tmp = `${file(name)}.tmp`
  writeFileSync(tmp, JSON.stringify(data))
  renameSync(tmp, file(name))
}
