import { contextBridge, ipcRenderer } from 'electron'
import type { PlaybackSnapshot, PlayerCommand, PulseApi, Settings, UpdateStatus } from '@shared/types'

function listen<T>(channel: string, cb: (v: T) => void): () => void {
  const handler = (_e: unknown, v: T): void => cb(v)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: PulseApi = {
  platform: process.platform,
  app: {
    reset: () => ipcRenderer.invoke('app:reset'),
    gpu: () => ipcRenderer.invoke('app:gpu'),
    relaunch: () => ipcRenderer.invoke('app:relaunch'),
    clearCache: () => ipcRenderer.invoke('app:clear-cache')
  },
  discord: {
    status: () => ipcRenderer.invoke('discord:status')
  },
  auth: {
    status: () => ipcRenderer.invoke('auth:status'),
    login: () => ipcRenderer.invoke('auth:login'),
    logout: () => ipcRenderer.invoke('auth:logout'),
    token: () => ipcRenderer.invoke('auth:token'),
    scopes: () => ipcRenderer.invoke('auth:scopes'),
    retryAfter: () => ipcRenderer.invoke('auth:retry-after'),
    clientId: () => ipcRenderer.invoke('auth:client-id'),
    setClientId: (id: string | null) => ipcRenderer.invoke('auth:set-client-id', id)
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
    onChange: (cb) => listen<Settings>('settings:changed', cb)
  },
  artistInfo: (q) => ipcRenderer.invoke('artist:info', q),
  artistPage: (id) => ipcRenderer.invoke('artist:page', id),
  artistQuick: (id) => ipcRenderer.invoke('artist:quick', id),
  lastfm: {
    status: () => ipcRenderer.invoke('lastfm:status'),
    connect: () => ipcRenderer.invoke('lastfm:connect'),
    disconnect: () => ipcRenderer.invoke('lastfm:disconnect'),
    setEnabled: (on) => ipcRenderer.invoke('lastfm:enable', on),
    nowPlaying: (t) => ipcRenderer.send('lastfm:now', t),
    scrobble: (s) => ipcRenderer.send('lastfm:scrobble', s)
  },
  updates: {
    onReady: (cb) => listen('update:ready', cb),
    install: () => ipcRenderer.send('update:install'),
    version: () => ipcRenderer.invoke('app:version'),
    check: () => ipcRenderer.invoke('update:check'),
    status: () => ipcRenderer.invoke('update:status'),
    onStatus: (cb) => listen<UpdateStatus>('update:status', cb)
  },
  people: {
    searchSpotify: (q) => ipcRenderer.invoke('people:search-spotify', q),
    spotifyUser: (id) => ipcRenderer.invoke('people:spotify-user', id),
    spotifyUserQuick: (id) => ipcRenderer.invoke('people:spotify-user-quick', id),
    embedPlaylist: (id) => ipcRenderer.invoke('people:embed-playlist', id),
    serverOn: () => ipcRenderer.invoke('people:server-on'),
    pulseProfile: (id) => ipcRenderer.invoke('people:pulse-profile', id),
    pulseLookup: (ids) => ipcRenderer.invoke('people:pulse-lookup', ids),
    pulseSearch: (q) => ipcRenderer.invoke('people:pulse-search', q),
    publish: (body) => ipcRenderer.invoke('people:publish', body),
    friends: () => ipcRenderer.invoke('people:friends'),
    friendAction: (action, id, who) => ipcRenderer.invoke('people:friend-action', action, id, who),
    shareNow: (now) => ipcRenderer.invoke('people:share-now', now),
    nowOf: (id) => ipcRenderer.invoke('people:now-of', id),
    listeners: () => ipcRenderer.invoke('people:listeners'),
    followsOf: (id) => ipcRenderer.invoke('people:follows-of', id),
    spotifyFollows: (id, kind) => ipcRenderer.invoke('people:spotify-follows', id, kind)
  },
  party: {
    start: () => ipcRenderer.invoke('party:start'),
    stop: () => ipcRenderer.invoke('party:stop'),
    info: () => ipcRenderer.invoke('party:info'),
    setQueue: (q) => ipcRenderer.send('party:queue', q),
    vote: (uri, v) => ipcRenderer.invoke('party:vote', uri, v),
    onAdd: (cb) => listen('party:add', cb),
    onLink: (cb) => listen('party:link', cb),
    onJoin: (cb) => listen('party:join', cb),
    pendingJoin: () => ipcRenderer.invoke('party:pending-join'),
    remoteState: (url) => ipcRenderer.invoke('party:remote-state', url),
    remoteSearch: (url, q) => ipcRenderer.invoke('party:remote-search', url, q),
    remoteAdd: (url, uri, guest) => ipcRenderer.invoke('party:remote-add', url, uri, guest),
    remoteControl: (url, control, guest) => ipcRenderer.invoke('party:remote-control', url, control, guest),
    onControl: (cb) => listen('party:control', cb)
  },
  recs: {
    related: (name) => ipcRenderer.invoke('recs:related', name),
    preview: (title, artist) => ipcRenderer.invoke('recs:preview', title, artist),
    loopbackSource: () => ipcRenderer.invoke('recs:loopback-source')
  },
  spotifyAccount: {
    status: () => ipcRenderer.invoke('spotify-account:status'),
    connect: () => ipcRenderer.invoke('spotify-account:connect'),
    disconnect: () => ipcRenderer.invoke('spotify-account:disconnect'),
    friends: () => ipcRenderer.invoke('spotify-account:friends'),
    lyrics: (id) => ipcRenderer.invoke('spotify-account:lyrics', id),
    analysis: (id) => ipcRenderer.invoke('spotify-account:analysis', id),
    canvas: (id) => ipcRenderer.invoke('spotify-account:canvas', id),
    api: (method, url, body) => ipcRenderer.invoke('spotify-account:api', method, url, body)
  },
  lyrics: {
    lrclib: (q) => ipcRenderer.invoke('lyrics:lrclib', q),
    genius: (q) => ipcRenderer.invoke('lyrics:genius', q),
    ovh: (q) => ipcRenderer.invoke('lyrics:ovh', q)
  },
  playback: {
    publish: (s) => ipcRenderer.send('playback:publish', s),
    onSnapshot: (cb) => listen<PlaybackSnapshot>('playback:snapshot', cb),
    command: (c) => ipcRenderer.send('playback:command', c),
    onCommand: (cb) => listen<PlayerCommand>('playback:command', cb)
  },
  window: {
    toggleMini: () => ipcRenderer.send('window:toggle-mini'),
    showMain: () => ipcRenderer.send('window:show-main'),
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    onMaximized: (cb) => listen<boolean>('window:maximized', cb),
    onMiniChanged: (cb) => listen<boolean>('window:mini-changed', cb),
    setIcon: (dataUrl) => ipcRenderer.send('window:set-icon', dataUrl),
    setFullScreen: (on) => ipcRenderer.invoke('window:fullscreen', on),
    onFullScreen: (cb) => listen<boolean>('window:fullscreen-changed', cb)
  },
  openExternal: (url) => ipcRenderer.send('open-external', url),
  imageData: (url) => ipcRenderer.invoke('image:data', url),
  saveImage: (dataUrl, name) => ipcRenderer.invoke('image:save', dataUrl, name),
  copyImage: (dataUrl) => ipcRenderer.invoke('image:copy', dataUrl),
  dj: {
    chat: (req) => ipcRenderer.invoke('dj:chat', req),
    voiceStatus: () => ipcRenderer.invoke('dj:voice-status'),
    installVoice: () => ipcRenderer.invoke('dj:install-voice'),
    onInstallProgress: (cb) => listen('dj:install-progress', cb),
    speak: (text, voice) => ipcRenderer.invoke('dj:speak', text, voice),
    localReady: () => ipcRenderer.invoke('dj:local-ready'),
    setupAi: () => ipcRenderer.invoke('dj:setup-ai'),
    preload: () => ipcRenderer.invoke('dj:preload'),
    onAiProgress: (cb) => listen('dj:ai-progress', cb)
  },
  store: {
    get: (name) => ipcRenderer.invoke('store:get', name),
    set: (name, data) => ipcRenderer.invoke('store:set', name, data)
  },
  profile: {
    get: () => ipcRenderer.invoke('profile:get'),
    set: (p) => ipcRenderer.invoke('profile:set', p)
  }
}

contextBridge.exposeInMainWorld('pulse', api)
