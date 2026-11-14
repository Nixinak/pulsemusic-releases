/// <reference types="electron-vite/node" />

interface ImportMetaEnv {
  readonly MAIN_VITE_GENIUS_TOKEN?: string
  readonly MAIN_VITE_LASTFM_KEY?: string
  readonly MAIN_VITE_LASTFM_SECRET?: string
  /** The Pulse server (server/ folder), e.g. https://1-2-3-4.sslip.io */
  readonly MAIN_VITE_PULSE_SERVER?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
