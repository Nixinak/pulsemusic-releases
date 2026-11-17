// Types shared between the main process, preload and renderer.

export type ThemeMode = 'system' | 'light' | 'dark'
export type GlassQuality = 'full' | 'lite'

export interface Settings {
  theme: ThemeMode
  glassQuality: GlassQuality
  discordRpc: boolean
  /** Adds a "Get Pulse Music" button (GitHub) to the Discord status. */
  discordGetButton: boolean
  launchAtStartup: boolean
  /** Look for new versions on its own (at start, every hour, when you come back) and download them. */
  autoUpdate: boolean
  /** Closing the window keeps Pulse running in the tray (so plays keep being counted). */
  closeToTray: boolean
  /** The "still running in the tray" notice was shown once. */
  trayHintShown?: boolean
  geniusToken: string
  volume: number
  reduceMotion: boolean
  /** Song transitions on/off (in Settings → Playback, off by default). */
  crossfade: boolean
  /** Version of saved settings, for one-time migrations. */
  settingsVersion?: number
  /** When the music would stop, keep playing songs like the last one. */
  autoplay?: boolean
  /** Length of a song transition in seconds; 0 = automatic. */
  fadeSeconds: number
  /** Background palette: 'artwork' follows the music, otherwise a preset id or 'custom'. */
  bgPalette: string
  customColors: [string, string, string, string]
  /** Where a chosen palette applies. */
  bgScope: 'everywhere' | 'home'
  /** Light up synced lyrics word by word, like Apple Music. */
  wordLyrics: boolean
  /** Interface font. */
  font: FontChoice
  /** Compact shrinks rows, covers and spacing. */
  density: 'comfortable' | 'compact'
  /** AI DJ: which model answers, how it speaks and in which language. */
  /** 'local' is the built-in engine on this computer. */
  djProvider: 'local' | 'claude'
  djClaudeKey: string
  djClaudeModel: string
  /** 'natural' speaks with the offline neural voice; 'off' shows subtitles only. */
  djVoice: 'natural' | 'off'
  /** Which of the six voices the DJ speaks with. */
  djSpeaker: DjVoiceId
  /** Talk between songs: after every song, every few songs, or only when a set starts. */
  djChattiness: 'often' | 'sometimes' | 'rarely'
  /** How Now Playing looks: the usual one, a big cover, a turntable, a CD deck or a lock screen. */
  npTheme: NpTheme
  /** Now Playing covers the whole screen (taskbar hidden); remembered for next time. */
  npFullscreen: boolean
  /** Old: the device sounds are always on now. */
  npSounds: boolean
  /** The turntable's record can be grabbed and scratched. */
  npScratch: boolean
  /** A song without lyrics shows the cover; the next song with lyrics brings them back. */
  npAutoCover: boolean
  /** Performance keeps background motion light; Quality runs every animation at full rate. */
  renderMode: 'performance' | 'quality'
  /** The GPU draws the app (glass, blur, animations). Off needs a restart; for driver trouble. */
  hardwareAcceleration: boolean
  /** How big the whole app is drawn (1 = 100 %). */
  zoom: number
  /** A Windows notification with the cover when the song changes and Pulse isn't in front. */
  songNotifications: boolean
  /** Which page Pulse opens on: Home, or the page you were on last time. */
  startPage: 'home' | 'last'
  /** Keyboard shortcuts that work while Pulse is in the background. */
  globalShortcuts: boolean
  /** The keys for each of them (Electron accelerators, e.g. "Ctrl+Alt+Space"). */
  globalKeys: Record<GlobalAction, string>
}

export type GlobalAction = 'toggle' | 'next' | 'previous' | 'volumeUp' | 'volumeDown' | 'like' | 'show'

export const GLOBAL_KEYS: Record<GlobalAction, string> = {
  toggle: 'Ctrl+Alt+Space',
  next: 'Ctrl+Alt+Right',
  previous: 'Ctrl+Alt+Left',
  volumeUp: 'Ctrl+Alt+Up',
  volumeDown: 'Ctrl+Alt+Down',
  like: 'Ctrl+Alt+L',
  show: 'Ctrl+Alt+P'
}

/** 'classic' is old: it shows as 'cover' now. */
export type NpTheme = 'classic' | 'cover' | 'vinyl' | 'cd' | 'cassette' | 'poster' | 'pulse' | 'lock'

export type DjVoiceId = 'af_heart' | 'af_bella' | 'bf_emma' | 'am_michael' | 'am_fenrir' | 'bm_george'

export interface DjVoice {
  id: DjVoiceId
  name: string
  gender: 'female' | 'male'
  accent: string
}

export interface VoiceStatus {
  /** The voice model is downloaded. */
  installed: boolean
  voices: DjVoice[]
}

export interface DjChatRequest {
  provider: 'local' | 'claude'
  model: string
  apiKey?: string
  system: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  /** Ask for a JSON answer. */
  json?: boolean
}

export type DjChatResult = { ok: true; text: string } | { ok: false; error: string }

export type FontChoice = 'figtree' | 'bricolage' | 'inter' | 'manrope' | 'outfit' | 'system'

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  glassQuality: 'full',
  discordRpc: true,
  discordGetButton: true,
  launchAtStartup: false,
  autoUpdate: true,
  closeToTray: true,
  geniusToken: '',
  volume: 0.7,
  reduceMotion: false,
  crossfade: false,
  settingsVersion: 4,
  fadeSeconds: 0,
  bgPalette: 'artwork',
  customColors: ['#ff4f8b', '#b03cff', '#4a5cff', '#2ad1c9'],
  bgScope: 'everywhere',
  wordLyrics: true,
  font: 'figtree',
  density: 'comfortable',
  djProvider: 'local',
  djClaudeKey: '',
  djClaudeModel: 'claude-haiku-5-5',
  djVoice: 'natural',
  djSpeaker: 'af_heart',
  djChattiness: 'sometimes',
  npTheme: 'cover',
  npFullscreen: false,
  npSounds: true,
  npScratch: true,
  npAutoCover: true,
  renderMode: 'performance',
  hardwareAcceleration: true,
  zoom: 1,
  songNotifications: false,
  startPage: 'home',
  globalShortcuts: true,
  globalKeys: { ...GLOBAL_KEYS }
}

export type ProfileBlock =
  | { id: string; type: 'text'; title: string; text: string }
  | { id: string; type: 'image'; src: string; caption: string }
  /** A wall of pictures, laid out like a mosaic. */
  | { id: string; type: 'wall'; title: string; images: WallImage[] }
  | { id: string; type: 'top-artists' }
  | { id: string; type: 'top-tracks' }
  | { id: string; type: 'playlist'; playlistId: string }
  | { id: string; type: 'stats' }
  | {
      id: string
      type: 'favorites'
      title: string
      kind: FavoriteKind
      items: FavoriteItem[]
    }

export type FavoriteKind = 'artist' | 'album' | 'track'

/** One picture on a wall: its own size (so it can be shown whole) and how big it is on the
 *  wall ('auto' picks from its shape). */
export interface WallImage {
  src: string
  w: number
  h: number
  size: 'auto' | 'big' | 'wide' | 'tall' | 'small'
}

/** A pinned favourite, stored with enough data to render without asking Spotify. */
export interface FavoriteItem {
  id: string
  uri: string
  name: string
  subtitle: string
  image: string | null
}

export interface Profile {
  /** Empty means "use the Spotify display name". */
  displayName: string
  /** Images are stored as JPEG data URLs. */
  avatar: string | null
  banner: string | null
  bio: string
  blocks: ProfileBlock[]
  /** Profile page colours: 'auto' takes them from the cover and picture. */
  palette: string
  customColors: [string, string, string, string]
  /** Show this profile to other Pulse users (and get the Pulse badge). */
  shared?: boolean
  /** A short line under the name ("on a phonk run lately"). */
  tagline?: string
  /** Links to other places (Instagram, SoundCloud, a website…). */
  links?: { url: string }[]
  /** The profile song, with a play button at the top of the profile. */
  anthem?: FavoriteItem | null
  /** Which part of the cover picture shows (0 = top, 100 = bottom). */
  bannerY?: number
}

export const EMPTY_PROFILE: Profile = {
  displayName: '',
  avatar: null,
  banner: null,
  bio: '',
  palette: 'auto',
  customColors: ['#ff4f8b', '#b03cff', '#4a5cff', '#2ad1c9'],
  blocks: [
    { id: 'b-artists', type: 'top-artists' },
    { id: 'b-tracks', type: 'top-tracks' }
  ]
}

export interface AuthStatus {
  loggedIn: boolean
}

/** Minimal playback snapshot broadcast to the mini player, tray and Discord. */
export interface PlaybackSnapshot {
  hasTrack: boolean
  trackId: string | null
  uri: string | null
  title: string
  artists: string
  album: string
  artUrl: string | null
  durationMs: number
  positionMs: number
  /** Epoch ms when positionMs was sampled. */
  sampledAt: number
  paused: boolean
  liked: boolean
  accent: string | null
  /** First artist's Spotify id (for links in the Discord status). */
  artistId?: string | null
  /** Set while the AI DJ is running the show. */
  mode?: 'dj' | null
  /** Your Spotify id and name (for the Listen along button on your Discord status). */
  userId?: string | null
  userName?: string | null
}

export const EMPTY_SNAPSHOT: PlaybackSnapshot = {
  hasTrack: false,
  trackId: null,
  uri: null,
  title: '',
  artists: '',
  album: '',
  artUrl: null,
  durationMs: 0,
  positionMs: 0,
  sampledAt: 0,
  paused: true,
  liked: false,
  accent: null
}

export type PlayerCommand =
  { type: 'toggle' } | { type: 'next' } | { type: 'previous' } | { type: 'seek'; positionMs: number } | { type: 'like' } | { type: 'volume'; delta: number }

/** Someone you follow on Spotify and the last song they played (Spotify's Friend Activity). */
export interface SpotifyFriend {
  id: string
  name: string
  image: string | null
  /** When they played it (epoch ms); within a few minutes means they're listening now. */
  at: number
  /** Spotify says they're playing right now. */
  playing?: boolean
  track: {
    id: string
    uri: string
    name: string
    image: string | null
    artist: { id: string; name: string }
    album: { id: string; name: string }
    context: { uri: string; name: string } | null
  }
}

export interface SongAnalysis {
  beats: number[]
  bars: number[]
  segments: number[][]
}

/** Lyrics from Spotify itself. */
export interface SpotifyLyrics {
  synced: boolean
  lines: { timeMs: number; text: string }[]
  provider: string
}

export interface LrclibQuery {
  trackName: string
  artistName: string
  albumName: string
  durationSec: number
}

export interface LrclibResult {
  syncedLyrics: string | null
  plainLyrics: string | null
  instrumental: boolean
}

export type GeniusResponse =
  /** `html` is the song page; the renderer extracts the lyric containers. */
  { ok: true; url: string; title: string; artist: string; html: string } | { ok: false; reason: string; url?: string }

export type ArtistLinkKind =
  'instagram' | 'tiktok' | 'x' | 'youtube' | 'facebook' | 'soundcloud' | 'bandcamp' | 'twitch' | 'apple' | 'deezer' | 'genius' | 'wikipedia' | 'website'

export interface ArtistLink {
  kind: ArtistLinkKind
  label: string
  url: string
}

export interface ArtistImage {
  url: string
  width: number
  height: number
  source: 'spotify' | 'deezer' | 'genius'
}

export interface PageTrack {
  id: string
  uri: string
  name: string
  /** Spotify's all-time play count. */
  playcount: number
  durationMs: number
  explicit: boolean
  artists: { id: string; name: string }[]
  album: {
    id: string
    uri: string
    image: string | null
    name?: string
  } | null
}

export interface PageAlbum {
  id: string
  uri: string
  name: string
  /** "album", "single", "ep" or "compilation". */
  type: string
  date: string
  image: string | null
  tracks: number
}

/** What the artist's public Spotify page shows. */
export interface PageArtist {
  header: { url: string; width: number; height: number } | null
  avatar: string | null
  gallery: string[]
  monthlyListeners: number | null
  followers: number | null
  worldRank: number | null
  topCities: { city: string; country: string; listeners: number }[]
  bio: string | null
  links: { name: string; url: string }[]
  topTracks: PageTrack[]
  /** The newest release, as the page shows it. */
  latest?: PageAlbum | null
  /** How the data was read (for the DevTools log). */
  source?: string
  albums: PageAlbum[]
  singles: PageAlbum[]
  compilations: PageAlbum[]
}

export interface ArtistInfoQuery {
  id: string
  name: string
  /** Song titles Spotify knows, to confirm name-based matches on other sites. */
  titles: string[]
  spotifyImage: { url: string; width: number; height: number } | null
}

export interface ArtistInfo {
  links: ArtistLink[]
  images: ArtistImage[]
  /** The sharpest image for the page banner. */
  banner: ArtistImage | null
  bio: { text: string; source: string } | null
  /** Where they're from (city or country). */
  from: string | null
  area: string | null
  /** Year they started. */
  since: string | null
  /** "Person" or "Group". */
  kind: string | null
  fans: number | null
  followers: number | null
  aka: string[]
}

export interface LastfmStatus {
  /** False when the build has no Last.fm API key. */
  available: boolean
  connected: boolean
  user: string | null
  enabled: boolean
  /** Scrobbles waiting to be sent. */
  pending: number
}

export interface ScrobbleInput {
  artist: string
  track: string
  album?: string
  /** Epoch ms when the song started. */
  startedAt: number
  durationMs: number
  listenedMs: number
}

/** A running party: the link to share and whether it works outside this Wi-Fi yet. */
export interface PartyInfo {
  /** The link to share: the internet one once it's ready, the Wi-Fi one until then. */
  url: string
  lanUrl: string
  publicUrl: string | null
  code: string
  status: 'starting' | 'online' | 'offline'
  message: string
}

/** A song a party guest can add (from a search on their phone). */
export interface PartyTrack {
  id: string
  uri: string
  name: string
  artists: string
  image: string | null
  durationMs: number
  explicit: boolean
}

export interface PartyQueueItem {
  uri: string
  name: string
  artists: string
  image: string | null
  addedBy?: string
  /** Party votes: thumbs up minus thumbs down. */
  score?: number
}

/* ---------- People ---------- */

/** A Spotify user found by search (from Spotify's public search page). */
export interface SpotifyUserHit {
  id: string
  name: string
  image: string | null
}

/** Someone's public Spotify profile page. */
export interface SpotifyUserPage {
  id: string
  name: string
  image: string | null
  followers: number | null
  /** How many people they follow (when their page shows it). */
  following?: number | null
  playlists: {
    id: string
    name: string
    image: string | null
    followers: number | null
  }[]
  /** Only the name and picture could be read (the playlists didn't load). */
  partial?: boolean
  /** Profiles shown on their page (their followers and who they follow). */
  people?: { id: string; name: string; image: string | null }[]
}

/** Another person's playlist read from the public embed page. */
export interface EmbedPlaylist {
  name: string
  owner: string
  image: string | null
  tracks: {
    id: string
    uri: string
    name: string
    artists: string[]
    durationMs: number
    explicit: boolean
  }[]
}

/** A Pulse user, short (for badges and search). */
export interface PulseSummary {
  id: string
  displayName: string
  thumb: string | null
  updatedAt: number
  /** In follow lists: false for people who don't use Pulse (yet). */
  pulse?: boolean
}

/** What someone is playing (shared by their Pulse app). */
export interface NowPlaying {
  track: {
    uri: string
    name: string
    artists: string
    image: string | null
    durationMs: number
  } | null
  positionMs: number
  paused: boolean
  /** Their party link, when one is on. */
  party: string | null
  /** Who they're listening along with (a Spotify id), if anyone. */
  with?: string | null
  /** When this was sent (epoch ms, server clock). */
  at: number
}

/** Someone listening along with you right now. */
export interface Listener {
  id: string
  displayName: string
  thumb: string | null
  /** The song they're on (yours). */
  track: string | null
}

/** Who you follow and who follows you. People who follow each other are friends. */
export interface FriendsState {
  friends: PulseSummary[]
  /** People who follow you (you don't follow them back). */
  incoming: PulseSummary[]
  /** People you follow (they don't follow you back). */
  outgoing: PulseSummary[]
  /** What the people you follow are playing now, by id. */
  now: Record<string, NowPlaying>
}
export type FriendAction = 'follow' | 'unfollow' | 'dismiss'

/** Someone's follow lists on the Pulse server. */
export interface FollowLists {
  followers: PulseSummary[]
  following: PulseSummary[]
}

export interface PulseItem {
  id: string
  uri: string
  name: string
  subtitle: string
  image: string | null
}

/** A published Pulse profile, as the Pulse server keeps it. */
export interface PulseProfile extends Omit<Profile, 'customColors'> {
  id: string
  thumb: string | null
  customColors: [string, string, string, string] | null
  /** What the live blocks showed for the owner when they published. */
  snapshot: {
    topArtists: PulseItem[]
    topTracks: PulseItem[]
    minutes: number | null
  }
  updatedAt: number
}

/** Everyone at a party can steer the music, not only the host. */
export type PartyControl =
  | { action: 'toggle' }
  | { action: 'next' }
  | { action: 'previous' }
  | { action: 'seek'; positionMs: number }
  | { action: 'remove'; uri: string }
  /** From the party server only: the queue's vote scores changed (uri → thumbs up minus down). */
  | { action: 'votes'; scores: Record<string, number> }

export interface PartyState {
  nowPlaying: {
    name: string
    artists: string
    image: string | null
    paused: boolean
    /** For listening along: what plays and where it is (position when the answer was sent). */
    uri?: string | null
    positionMs?: number
    durationMs?: number
  } | null
  queue: PartyQueueItem[]
}

export interface AiSetupProgress {
  step?: string
  line?: string
  percent?: number
  done?: boolean
  error?: string
}

export interface PulseApi {
  platform: string
  app: {
    /** Signs out, erases all local data and restarts like a fresh install. */
    reset(): Promise<void>
    /** Whether the GPU draws the app now, and whether the setting wants it. */
    gpu(): Promise<{ on: boolean; wanted: boolean }>
    /** Restarts Pulse (for settings that apply at start). */
    relaunch(): Promise<void>
    /** Empties Chromium's download cache; answers how many bytes it held. */
    clearCache(): Promise<number>
  }
  discord: {
    status(): Promise<{
      state: 'off' | 'connecting' | 'connected' | 'not-running'
      shown: boolean
      error: string | null
    }>
  }
  auth: {
    status(): Promise<AuthStatus>
    login(): Promise<AuthStatus>
    logout(): Promise<void>
    token(): Promise<string | null>
    /** Scopes granted to this sign-in; empty when unknown. */
    scopes(): Promise<string[]>
    /** The listener's own Spotify app (Client ID), null when Pulse Music's is used. */
    clientId(): Promise<string | null>
    /** Switches the Spotify app (signs out). null goes back to Pulse Music's. */
    setClientId(id: string | null): Promise<void>
    /** Seconds Spotify still blocks this app for (its Retry-After), 0 when it answers normally,
     *  null when unknown. Read in the main process because the browser can't see the header. */
    retryAfter(): Promise<number | null>
  }
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
    onChange(cb: (s: Settings) => void): () => void
  }
  artistInfo(q: ArtistInfoQuery): Promise<ArtistInfo>
  artistPage(id: string): Promise<PageArtist | null>
  /** Popular songs from the small embed page, fast (no covers, no play counts). */
  artistQuick(id: string): Promise<{ tracks: PageTrack[]; avatar: string | null } | null>
  lastfm: {
    status(): Promise<LastfmStatus>
    /** Opens Last.fm in the browser and waits until the listener allows Pulse Music. */
    connect(): Promise<LastfmStatus>
    disconnect(): Promise<LastfmStatus>
    setEnabled(on: boolean): Promise<LastfmStatus>
    nowPlaying(t: { artist: string; track: string; album?: string; durationMs?: number }): void
    scrobble(s: ScrobbleInput): void
  }
  updates: {
    /** A new version was downloaded and is ready to install. */
    onReady(cb: (version: string) => void): () => void
    install(): void
    version(): Promise<string>
    /** Looks for a new version now; it downloads by itself when there is one. */
    check(): Promise<UpdateStatus>
    status(): Promise<UpdateStatus>
    onStatus(cb: (s: UpdateStatus) => void): () => void
  }
  /** Spotify users, their public playlists and Pulse profiles. */
  people: {
    searchSpotify(q: string): Promise<SpotifyUserHit[]>
    spotifyUser(id: string): Promise<SpotifyUserPage | null>
    /** Name and picture in well under a second (the page's link preview), while the full page loads. */
    spotifyUserQuick(id: string): Promise<SpotifyUserPage | null>
    embedPlaylist(id: string): Promise<EmbedPlaylist | null>
    /** False when the app was built without a Pulse server. */
    serverOn(): Promise<boolean>
    pulseProfile(id: string): Promise<PulseProfile | null>
    pulseLookup(ids: string[]): Promise<PulseSummary[]>
    pulseSearch(q: string): Promise<PulseSummary[]>
    /** Publishes your profile (null removes it). */
    publish(
      body: {
        profile: Profile
        snapshot: PulseProfile['snapshot']
        thumb: string | null
      } | null
    ): Promise<void>
    friends(): Promise<FriendsState>
    /** Ask, accept, or remove (also cancels or declines a request). Returns your lists afterwards. */
    friendAction(action: FriendAction, id: string, who?: { name: string; image: string | null }): Promise<FriendsState>
    /** Shares what you play with the people who follow you (null: stop sharing). */
    /** Sends what you play; answers with who listens along with you. */
    shareNow(now: Omit<NowPlaying, 'at'> | null): Promise<Listener[]>
    /** Who listens along with you right now. */
    listeners(): Promise<Listener[]>
    /** What someone you follow is playing. */
    nowOf(id: string): Promise<NowPlaying | null>
    /** Who follows someone in Pulse and who they follow (null: the server can't tell). */
    followsOf(id: string): Promise<FollowLists | null>
    /** Their followers or who they follow, from their public Spotify page. */
    spotifyFollows(id: string, kind: 'followers' | 'following'): Promise<{ id: string; name: string; image: string | null }[]>
  }
  /** Party mode: friends add songs from their phones. */
  party: {
    start(): Promise<PartyInfo>
    stop(): Promise<void>
    info(): Promise<PartyInfo | null>
    /** The internet link came online (or could not). */
    onLink(cb: (info: PartyInfo) => void): () => void
    /** A party link opened from the browser ("Open in Pulse Music"). */
    onJoin(cb: (url: string) => void): () => void
    pendingJoin(): Promise<string | null>
    remoteState(url: string): Promise<PartyState>
    remoteSearch(url: string, q: string): Promise<{ tracks: PartyTrack[] }>
    remoteAdd(url: string, uri: string, guest: string): Promise<{ ok: boolean }>
    remoteControl(url: string, control: PartyControl, guest: string): Promise<{ ok: boolean }>
    /** The app's queue, shown on the guests' page. */
    setQueue(q: PartyQueueItem[]): void
    /** The host's own thumbs up (1), down (-1) or neither (0) for a queued song. */
    vote(uri: string, v: number): Promise<void>
    onAdd(cb: (a: { track: PartyTrack; guest: string }) => void): () => void
    /** A guest pressed play/pause, skip, seek or removed a song. */
    onControl(cb: (a: { control: PartyControl; guest: string }) => void): () => void
  }
  /** Help for playlist recommendations (Deezer). */
  recs: {
    /** Names of similar artists. */
    related(name: string): Promise<string[]>
    /** A song's 30 s preview as base64 MP3, for tempo and key analysis. */
    preview(title: string, artist: string): Promise<string | null>
    /** Windows only: a screen to name in a loopback capture, so the page can hear what the
     *  computer plays (the DJ orb moves with the music). Null elsewhere. */
    loopbackSource(): Promise<string | null>
  }
  /** Your Spotify web account, signed in inside Pulse: Friend Activity and Spotify's lyrics. */
  spotifyAccount: {
    status(): Promise<{ connected: boolean }>
    connect(): Promise<boolean>
    disconnect(): Promise<void>
    friends(): Promise<SpotifyFriend[] | null>
    lyrics(trackId: string): Promise<SpotifyLyrics | null>
    /** Spotify's analysis of a song: beat times and per-slice [start, loudness max, loudness start, time of max, 12 pitches, 12 timbre]. */
    analysis(trackId: string): Promise<SongAnalysis | null>
    /** The short looping video (Canvas) the artist put on a song, if any (an mp4 address). */
    canvas(trackId: string): Promise<string | null>
  }
  lyrics: {
    lrclib(q: LrclibQuery): Promise<LrclibResult | null>
    genius(q: { title: string; artist: string }): Promise<GeniusResponse>
    ovh(q: { title: string; artist: string }): Promise<string | null>
  }
  playback: {
    /** Main window publishes its state. */
    publish(s: PlaybackSnapshot): void
    /** Mini player listens to state. */
    onSnapshot(cb: (s: PlaybackSnapshot) => void): () => void
    /** Mini player / tray send commands. */
    command(c: PlayerCommand): void
    /** Main window receives commands. */
    onCommand(cb: (c: PlayerCommand) => void): () => void
  }
  window: {
    toggleMini(): void
    showMain(): void
    minimize(): void
    toggleMaximize(): void
    close(): void
    onMaximized(cb: (maximized: boolean) => void): () => void
    onMiniChanged(cb: (open: boolean) => void): () => void
    /** Swap the taskbar icon for a recoloured one (PNG data URL). */
    setIcon(dataUrl: string): void
    /** Real full screen (over the taskbar), for Now Playing. Resolves to the new state. */
    setFullScreen(on: boolean): Promise<boolean>
    /** Full screen ended some other way (F11, Windows). */
    onFullScreen(cb: (on: boolean) => void): () => void
  }
  openExternal(url: string): void
  profile: {
    get(): Promise<Profile>
    set(p: Profile): Promise<Profile>
  }
  /** Fetches a Spotify image as a data URL (for hosts without CORS headers). */
  imageData(url: string): Promise<string | null>
  /** Saves a PNG data URL through a save dialog; false when cancelled. */
  saveImage(dataUrl: string, name: string): Promise<boolean>
  /** Puts a PNG data URL on the clipboard. */
  copyImage(dataUrl: string): Promise<boolean>
  dj: {
    chat(req: DjChatRequest): Promise<DjChatResult>
    voiceStatus(): Promise<VoiceStatus>
    /** Downloads the voice model once (progress through onInstallProgress). */
    installVoice(): Promise<boolean>
    onInstallProgress(cb: (p: { stage: string; done: number; total: number }) => void): () => void
    /** Speaks with the given voice (or the chosen one): WAV as base64, or the reason it failed. */
    speak(text: string, voice?: DjVoiceId): Promise<{ ok: true; wav: string } | { ok: false; error: string }>
    /** The built-in DJ brain is downloaded. */
    localReady(): Promise<boolean>
    /** Downloads the built-in DJ brain (progress through onAiProgress). */
    setupAi(): Promise<boolean>
    /** Starts the built-in engine ahead of time, so the first answer is quick. */
    preload(): Promise<void>
    onAiProgress(cb: (p: AiSetupProgress) => void): () => void
  }
  /** Small JSON documents kept in the user data folder. */
  store: {
    get<T>(name: 'history' | 'mixes'): Promise<T | null>
    set(name: 'history' | 'mixes', data: unknown): Promise<void>
  }
}

/** Where the app's own update is. */
export type UpdateStatus =
  | {
      state: 'idle' | 'checking' | 'dev'
      version?: string
      percent?: number
      message?: string
    }
  | { state: 'latest'; version: string; percent?: number; message?: string }
  | {
      state: 'downloading'
      version?: string
      percent: number
      message?: string
      notes?: string[]
    }
  | {
      state: 'ready'
      version: string
      percent?: number
      message?: string
      notes?: string[]
    }
  | { state: 'error'; message: string; version?: string; percent?: number }
