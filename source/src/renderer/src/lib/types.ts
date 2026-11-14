// Subset of Spotify Web API objects used by the app.

export interface SImage {
  url: string
  width: number | null
  height: number | null
}

export interface SArtistRef {
  id: string
  name: string
  uri: string
}

export interface SArtist extends SArtistRef {
  images?: SImage[]
  genres?: string[]
  type: 'artist'
}

export interface SAlbumRef {
  id: string
  name: string
  uri: string
  images: SImage[]
  artists: SArtistRef[]
  release_date?: string
  album_type?: string
  /** How it relates to the artist when listed from an artist page. */
  album_group?: string
  total_tracks?: number
  type: 'album'
}

export interface SAlbum extends SAlbumRef {
  tracks: Paging<STrack>
  copyrights?: { text: string }[]
}

export interface STrack {
  id: string
  name: string
  uri: string
  duration_ms: number
  explicit: boolean
  artists: SArtistRef[]
  album?: SAlbumRef
  track_number?: number
  disc_number?: number
  is_local?: boolean
  is_playable?: boolean
  type: 'track' | 'episode'
}

export interface SPlaylist {
  id: string
  name: string
  uri: string
  description: string | null
  images: SImage[] | null
  owner: { id: string; display_name?: string }
  collaborative: boolean
  public: boolean | null
  /** Renamed from `tracks` in February 2026. */
  items?: { total: number; href?: string }
  tracks?: { total: number; href?: string }
  type: 'playlist'
}

export interface SPlaylistItem {
  added_at: string
  /** Renamed from `track` in February 2026. */
  item?: STrack | null
  track?: STrack | null
}

export interface SUser {
  id: string
  display_name: string | null
  images?: SImage[]
  uri: string
}

export interface Paging<T> {
  items: T[]
  total: number
  limit: number
  offset: number
  next: string | null
}

export interface CursorPaging<T> {
  items: T[]
  next: string | null
  cursors?: { after?: string }
  total?: number
}

export interface SDevice {
  id: string | null
  is_active: boolean
  name: string
  type: string
  volume_percent: number | null
  supports_volume: boolean
}

export interface SPlaybackState {
  device: SDevice
  shuffle_state: boolean
  repeat_state: 'off' | 'track' | 'context'
  progress_ms: number | null
  is_playing: boolean
  item: STrack | null
  context: { uri: string; type: string } | null
}

export interface SearchResults {
  tracks?: Paging<STrack>
  artists?: Paging<SArtist>
  albums?: Paging<SAlbumRef>
  playlists?: Paging<SPlaylist | null>
}
