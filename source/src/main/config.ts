// Public app identifiers. These are not secrets (PKCE auth needs no client secret).
export const SPOTIFY_CLIENT_ID = '1ed0cb94089f4869bbbf863d0964fa83'
export const DISCORD_CLIENT_ID = '1563981153290166332'

export const REDIRECT_PORT = 43821
export const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`

/** Genius token baked in from .env.local at build time; overridable in Settings. */
export const DEFAULT_GENIUS_TOKEN: string = import.meta.env.MAIN_VITE_GENIUS_TOKEN ?? ''

export const USER_AGENT = 'PulseMusic/1.0 (personal desktop client)'

export const SPOTIFY_SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-read-recently-played',
  'user-top-read',
  'user-library-read',
  'user-library-modify',
  'user-follow-read',
  'user-follow-modify',
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-private',
  'playlist-modify-public',
  // Custom playlist covers.
  'ugc-image-upload'
]
