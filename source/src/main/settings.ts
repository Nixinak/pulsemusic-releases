import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'
import { DEFAULT_GENIUS_TOKEN } from './config'

const file = (): string => join(app.getPath('userData'), 'settings.json')

let current: Settings = { ...DEFAULT_SETTINGS, geniusToken: DEFAULT_GENIUS_TOKEN }

export function loadSettings(): Settings {
  try {
    if (existsSync(file())) {
      const saved = JSON.parse(readFileSync(file(), 'utf8')) as Partial<Settings>
      current = { ...current, ...saved }
      if (!current.geniusToken) current.geniusToken = DEFAULT_GENIUS_TOKEN
      // Older versions had other voice engines; they all became the natural voice.
      if ((current.djVoice as string) !== 'off') current.djVoice = 'natural'
      const voices = ['af_heart', 'af_bella', 'bf_emma', 'am_michael', 'am_fenrir', 'bm_george']
      if (!voices.includes(current.djSpeaker)) current.djSpeaker = 'af_heart'
      // v2: song transitions moved into Settings and became opt-in, so they start off once.
      if ((saved.settingsVersion ?? 1) < 2) {
        current.crossfade = false
        current.settingsVersion = 2
      }
      // v3: the DJ's Ollama setup became the built-in engine.
      if ((saved.settingsVersion ?? 1) < 3) {
        if ((current.djProvider as string) === 'ollama') current.djProvider = 'local'
        delete (current as Partial<Settings> & { djOllamaModel?: string }).djOllamaModel
        current.settingsVersion = 3
        writeFileSync(file(), JSON.stringify(current, null, 2))
      }
    }
  } catch (e) {
    console.error('[settings] could not read settings, using defaults', e)
  }
  return current
}

export const getSettings = (): Settings => current

export function updateSettings(patch: Partial<Settings>): Settings {
  current = { ...current, ...patch }
  try {
    writeFileSync(file(), JSON.stringify(current, null, 2))
  } catch (e) {
    console.error('[settings] could not save settings', e)
  }
  return current
}
