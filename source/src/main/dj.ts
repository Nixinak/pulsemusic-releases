// AI DJ back end: language model calls (the built-in engine or the Claude API). Runs in the
// main process so API keys never reach the page. The voice lives in voice.ts.
import type { DjChatRequest, DjChatResult } from '@shared/types'
import { localChat } from './aiSetup'

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    return await run(ctrl.signal)
  } finally {
    clearTimeout(t)
  }
}

export async function djChat(req: DjChatRequest): Promise<DjChatResult> {
  try {
    if (req.provider === 'local') return await localChat(req)
    if (!req.apiKey) return { ok: false, error: 'Add your Claude API key in Settings → AI DJ.' }
    return await withTimeout(60_000, async (signal) => {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': req.apiKey!,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: req.model,
          max_tokens: 1500,
          system: req.system,
          messages: req.messages
        })
      })
      if (!res.ok) {
        let msg = `Claude API answered ${res.status}`
        try {
          const j = (await res.json()) as { error?: { message?: string } }
          if (j.error?.message) msg = j.error.message
        } catch {
          /* empty */
        }
        return { ok: false, error: msg }
      }
      const j = (await res.json()) as { content?: { type: string; text?: string }[] }
      return { ok: true, text: (j.content ?? []).map((c) => c.text ?? '').join('') }
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/abort/i.test(msg)) return { ok: false, error: 'The AI took too long to answer.' }
    return { ok: false, error: msg }
  }
}
