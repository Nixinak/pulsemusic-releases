// The parts of a profile under the name: the status line, links and the profile song.
// Shared by your own profile and other people's.
import type { FavoriteItem } from '@shared/types'
import { playUris, usePlayer } from '@/lib/player'
import { BrandIcon } from './BrandIcons'
import { Cover, EqBars } from './common'
import { PlayIcon } from './Icons'

const SITES: [RegExp, string, string][] = [
  [/instagram\.com/, 'instagram', 'Instagram'],
  [/tiktok\.com/, 'tiktok', 'TikTok'],
  [/soundcloud\.com/, 'soundcloud', 'SoundCloud'],
  [/youtube\.com|youtu\.be/, 'youtube', 'YouTube'],
  [/(^|\.)x\.com|twitter\.com/, 'x', 'X'],
  [/twitch\.tv/, 'twitch', 'Twitch'],
  [/facebook\.com/, 'facebook', 'Facebook'],
  [/bandcamp\.com/, 'bandcamp', 'Bandcamp'],
  [/music\.apple\.com/, 'apple', 'Apple Music']
]

/** Brand and a short readable name for a link ("Instagram", or the site's host). */
export function linkInfo(url: string): { kind: string; label: string } {
  let host = ''
  try {
    host = new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return { kind: 'web', label: url }
  }
  for (const [re, kind, label] of SITES) if (re.test(host)) return { kind, label }
  return { kind: 'web', label: host }
}

/** Accepts "instagram.com/me" or a full link; returns an https link or null. */
export function normaliseLink(text: string): string | null {
  const t = text.trim()
  if (!t) return null
  const withScheme = /^https?:\/\//i.test(t) ? t.replace(/^http:/i, 'https:') : `https://${t}`
  try {
    const u = new URL(withScheme)
    return u.hostname.includes('.') ? u.toString() : null
  } catch {
    return null
  }
}

export function ProfileLinks({ links }: { links?: { url: string }[] }): React.JSX.Element | null {
  if (!links?.length) return null
  return (
    <div className="plinks">
      {links.map((l) => {
        const { kind, label } = linkInfo(l.url)
        return (
          <button key={l.url} className="plink" title={l.url} onClick={() => window.pulse.openExternal(l.url)}>
            <BrandIcon kind={kind} size={16} />
            {label}
          </button>
        )
      })}
    </div>
  )
}

export function ProfileSong({ song, onRemove }: { song?: FavoriteItem | null; onRemove?: () => void }): React.JSX.Element | null {
  const playing = usePlayer((s) => s.track?.uri === song?.uri && !s.paused)
  if (!song) return null
  return (
    <div className="psong">
      <button className="psong__art" aria-label={`Play ${song.name}`} onClick={() => void playUris([song.uri])}>
        <Cover src={song.image} size={52} radius={10} />
        <span className="psong__play">{playing ? <EqBars playing /> : <PlayIcon size={18} />}</span>
      </button>
      <span className="psong__text">
        <b>{song.name}</b>
        <small>{song.subtitle}</small>
      </span>
      {onRemove && (
        <button className="link psong__remove" onClick={onRemove}>
          Remove
        </button>
      )}
    </div>
  )
}
