// Local Pulse profile (picture, cover, bio, blocks), stored next to the settings.
import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EMPTY_PROFILE, type Profile } from '@shared/types'

const file = (): string => join(app.getPath('userData'), 'profile.json')

export function loadProfile(): Profile {
  try {
    if (existsSync(file())) return { ...EMPTY_PROFILE, ...(JSON.parse(readFileSync(file(), 'utf8')) as Partial<Profile>) }
  } catch (e) {
    console.error('[profile] could not read profile', e)
  }
  return EMPTY_PROFILE
}

export function saveProfile(p: Profile): Profile {
  writeFileSync(file(), JSON.stringify(p))
  return p
}
