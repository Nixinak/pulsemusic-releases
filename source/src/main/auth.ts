// Spotify Authorization Code flow with PKCE, using a loopback redirect server.
import { app, safeStorage, shell } from 'electron'
import { createServer, type Server } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { REDIRECT_PORT, REDIRECT_URI, SPOTIFY_CLIENT_ID, SPOTIFY_SCOPES } from './config'

interface StoredTokens {
  accessToken: string
  refreshToken: string
  /** Epoch ms. */
  expiresAt: number
  /** Space-separated scopes Spotify granted (missing in tokens saved by older versions). */
  scope?: string
  /** The Spotify app (Client ID) that issued them; refreshing must use the same one. */
  clientId?: string
}

/* Which Spotify app signs in. Spotify only lets an app in "development mode" sign in people
 * its owner added, so anyone else can use their own (free) app: its Client ID is kept here. */
const appFile = (): string => join(app.getPath('userData'), 'spotify-app.json')
let customId: string | null | undefined
export function customClientId(): string | null {
  if (customId === undefined) {
    try {
      const j = JSON.parse(readFileSync(appFile(), 'utf8')) as { clientId?: string }
      customId = j.clientId && /^[0-9a-f]{32}$/i.test(j.clientId) ? j.clientId : null
    } catch {
      customId = null
    }
  }
  return customId
}
export function setCustomClientId(id: string | null): void {
  const clean = id?.trim() || null
  if (clean && !/^[0-9a-f]{32}$/i.test(clean)) throw new Error('That is not a Client ID (it has 32 letters and numbers).')
  customId = clean
  if (clean) writeFileSync(appFile(), JSON.stringify({ clientId: clean }))
  else if (existsSync(appFile())) rmSync(appFile())
  save(null)
}
const clientId = (): string => customClientId() ?? SPOTIFY_CLIENT_ID

const tokenFile = (): string => join(app.getPath('userData'), 'auth.bin')

let tokens: StoredTokens | null = null
let refreshing: Promise<StoredTokens | null> | null = null
let pendingServer: Server | null = null

function save(t: StoredTokens | null): void {
  tokens = t
  if (!t) {
    if (existsSync(tokenFile())) rmSync(tokenFile())
    return
  }
  const json = JSON.stringify(t)
  const data = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(json)
    : Buffer.from(json, 'utf8')
  writeFileSync(tokenFile(), data)
}

export function loadTokens(): void {
  try {
    if (!existsSync(tokenFile())) return
    const raw = readFileSync(tokenFile())
    const json = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(raw)
      : raw.toString('utf8')
    tokens = JSON.parse(json) as StoredTokens
  } catch {
    tokens = null
  }
}

export const isLoggedIn = (): boolean => tokens !== null

/** Scopes granted to the current sign-in; empty when unknown (older saved tokens). */
export const grantedScopes = (): string[] => (tokens?.scope ? tokens.scope.split(' ') : [])

const base64url = (buf: Buffer): string =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function tokenRequest(body: Record<string, string>, forClient = clientId()): Promise<StoredTokens> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: forClient, ...body })
  })
  if (!res.ok) throw new Error(`Spotify token request failed (${res.status}): ${await res.text()}`)
  const j = (await res.json()) as {
    access_token: string
    refresh_token?: string
    expires_in: number
    scope?: string
  }
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? tokens?.refreshToken ?? '',
    expiresAt: Date.now() + j.expires_in * 1000,
    scope: j.scope ?? tokens?.scope,
    clientId: forClient
  }
}

const callbackPage = (title: string, text: string): string => `<!doctype html>
<html><head><meta charset="utf-8"><title>Pulse Music</title>
<style>
  body{margin:0;height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;
  background:radial-gradient(circle at 30% 20%,#f23b7a55,transparent 50%),radial-gradient(circle at 70% 80%,#5b6cff55,transparent 50%),#0e0f14;color:#f5f5f7}
  .card{padding:40px 48px;border-radius:28px;background:rgba(255,255,255,.08);backdrop-filter:blur(30px);
  border:1px solid rgba(255,255,255,.14);text-align:center}
  h1{margin:0 0 8px;font-size:26px} p{margin:0;opacity:.7}
</style></head><body><div class="card"><h1>${title}</h1><p>${text}</p></div></body></html>`

/** Opens the Spotify consent page in the default browser and waits for the redirect. */
export function login(): Promise<void> {
  pendingServer?.close()
  const verifier = base64url(randomBytes(64))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  const state = base64url(randomBytes(16))

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close()
      reject(new Error('Sign-in timed out. Try again.'))
    }, 5 * 60_000)

    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${REDIRECT_PORT}`)
      if (url.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }
      const finish = (ok: boolean, title: string, text: string): void => {
        res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(callbackPage(title, text))
        clearTimeout(timeout)
        server.close()
        pendingServer = null
      }
      const error = url.searchParams.get('error')
      const code = url.searchParams.get('code')
      if (error || !code || url.searchParams.get('state') !== state) {
        finish(false, 'Sign-in cancelled', 'Go back to Pulse Music and try again.')
        reject(new Error(error ?? 'Sign-in was cancelled.'))
        return
      }
      try {
        const t = await tokenRequest({
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT_URI,
          code_verifier: verifier
        })
        save(t)
        finish(true, 'You are signed in', 'You can close this tab and return to Pulse Music.')
        resolve()
      } catch (e) {
        finish(false, 'Sign-in failed', 'Go back to Pulse Music and try again.')
        reject(e)
      }
    })

    server.on('error', (e) => {
      clearTimeout(timeout)
      reject(new Error(`Could not open the sign-in port ${REDIRECT_PORT}: ${e.message}`))
    })

    server.listen(REDIRECT_PORT, '127.0.0.1', () => {
      pendingServer = server
      const params = new URLSearchParams({
        client_id: clientId(),
        response_type: 'code',
        redirect_uri: REDIRECT_URI,
        code_challenge_method: 'S256',
        code_challenge: challenge,
        state,
        scope: SPOTIFY_SCOPES.join(' '),
        // always show which Spotify account this is, with Spotify's "Not you?" to switch
        show_dialog: 'true'
      })
      void shell.openExternal(`https://accounts.spotify.com/authorize?${params}`)
    })
  })
}

export function logout(): void {
  save(null)
}

/** Returns a valid access token, refreshing it when it is about to expire. */
export async function getAccessToken(): Promise<string | null> {
  if (!tokens) return null
  if (tokens.expiresAt - Date.now() > 60_000) return tokens.accessToken
  if (!refreshing) {
    refreshing = tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken }, tokens.clientId ?? SPOTIFY_CLIENT_ID)
      .then((t) => {
        save(t)
        return t
      })
      .catch((e) => {
        console.error('[auth] refresh failed', e)
        // A 400 means the refresh token was revoked; sign out.
        if (String(e).includes('(400)')) save(null)
        return null
      })
      .finally(() => {
        refreshing = null
      })
  }
  const t = await refreshing
  return t?.accessToken ?? null
}
