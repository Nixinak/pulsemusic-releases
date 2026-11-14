// Reading what the listener asks the DJ for, before any language model is involved:
// moods and situations ("late night drive", "do posilovny"), several artists in one go
// ("riad, yzomandias a calin") and albums ("album Zkus mě chytit od Yzomandias").

/** Lower case, no accents, no brackets, only letters, digits and single spaces. */
export const norm = (x: string): string =>
  x
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s*[([].*?[)\]]/g, '')
    .replace(/[^a-z0-9&+,/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export interface Mood {
  id: string
  /** How the DJ names it out loud. */
  label: string
  /** Spotify searches that find songs for it (the year filter is added for fresh picks). */
  queries: string[]
  /** What it sounds like, for the language model. */
  sound: string
}

const year = new Date().getFullYear()
/** Spotify ranks search results by popularity, so a recent year range gives what's big right now. */
export const FRESH = `year:${year - 1}-${year}`

/* Each mood: words that call it up (English and Czech, without accents), and how to find it. */
const MOODS: (Mood & { match: RegExp })[] = [
  {
    id: 'night-drive',
    label: 'late night drive',
    match: /\b(late ?night|night|nocni|v noci|noc)\b.*\b(drive|driving|ride|cruise|jizda|jizdu|jizdy|cesta|auto|autem)\b|\b(drive|jizda|cruise)\b.*\b(night|noc|nocni)\b|\bnight ?drive\b|\bmidnight\b|\bpulnoc/,
    queries: ['night drive', 'late night drive', 'midnight', 'phonk night'],
    sound: 'dark, atmospheric, cruising mid-tempo songs for driving at night: moody rap, dark r&b, synthy phonk, slowed bass'
  },
  {
    id: 'drive',
    label: 'a drive',
    match: /\b(road ?trip|drive|driving|cruise|cruising|jizda|do auta|v aute|za volantem|roadtrip)\b/,
    queries: ['driving', 'road trip', 'drive'],
    sound: 'upbeat songs with momentum for driving'
  },
  {
    id: 'gym',
    label: 'gym energy',
    match: /\b(gym|workout|lifting|training|posilovna|posilovny|posilovne|posilku|posilka|cviceni|trenink|running|hype|pump up)\b/,
    queries: ['gym', 'workout', 'hype', 'phonk gym'],
    sound: 'hard-hitting, high-energy songs for training: aggressive rap, phonk, drill, hard bass'
  },
  {
    id: 'chill',
    label: 'something chill',
    match: /\b(chill|chil|calm|relax|relaxing|klid|klidn\w*|pohod\w*|pohoda|laid back|lowkey)\b/,
    queries: ['chill', 'chill vibes', 'laid back'],
    sound: 'relaxed, warm, mid- to low-tempo songs'
  },
  {
    id: 'sad',
    label: 'sad songs',
    match: /\b(sad|smut\w*|heartbreak|broken heart|crying|cry|depress\w*|breakup|rozchod|zlomen\w*)\b/,
    queries: ['sad', 'heartbreak', 'sad rap'],
    sound: 'emotional, melancholic songs about heartbreak and loneliness'
  },
  {
    id: 'party',
    label: 'party mode',
    match: /\b(party|parties|party mode|pregame|afterparty|club|klub|pareni|parba|mejdan|oslava|banger\w*|tancovat)\b/,
    queries: ['party', 'club bangers', 'dance hits'],
    sound: 'loud, danceable bangers people know and sing along to'
  },
  {
    id: 'focus',
    label: 'deep focus',
    match: /\b(focus|study|studying|uceni|ucit|homework|ukoly|coding|programming|kodeni|soustredeni|do prace)\b/,
    queries: ['focus', 'lofi', 'instrumental beats'],
    sound: 'steady, unobtrusive songs that help concentration, mostly instrumental or lo-fi'
  },
  {
    id: 'sleep',
    label: 'something to fall asleep to',
    match: /\b(sleep|asleep|sleepy|spani|spat|usinani|bedtime|before bed|pred spanim)\b/,
    queries: ['sleep', 'ambient sleep', 'soft piano'],
    sound: 'very soft, slow, calm songs for falling asleep'
  },
  {
    id: 'morning',
    label: 'a good morning',
    match: /\b(morning|rano|ranni|wake up|probuzeni|breakfast|snidane)\b/,
    queries: ['morning', 'good morning', 'feel good'],
    sound: 'bright, positive, easy songs to start the day'
  },
  {
    id: 'summer',
    label: 'summer vibes',
    match: /\b(summer|leto|letni|beach|plaz|pool|bazen|sunny|slunce|sunset|zapad slunce|vacation|dovolena)\b/,
    queries: ['summer', 'summer vibes', 'sunset'],
    sound: 'sunny, carefree, warm songs'
  },
  {
    id: 'rainy',
    label: 'a rainy day',
    match: /\b(rain|rainy|dest|destiv\w*|autumn|podzim|cloudy|zatazeno|cozy|cosy)\b/,
    queries: ['rainy day', 'cozy', 'autumn'],
    sound: 'mellow, cosy, slightly melancholic songs'
  },
  {
    id: 'love',
    label: 'love songs',
    match: /\b(love|romantic|romanticke|romantika|laska|zamilovan\w*|rande|valentine)\b/,
    queries: ['love songs', 'romantic', 'r&b love'],
    sound: 'romantic, smooth love songs'
  },
  {
    id: 'throwback',
    label: 'throwbacks',
    match: /\b(throwback\w*|old ?school|classic\w*|nostalgi\w*|stare|starsi|oldies|z mladi|retro)\b/,
    queries: ['throwback', 'old school hits'],
    sound: 'well-known older hits the listener grew up with'
  },
  {
    id: 'new',
    label: 'what’s new',
    match: /\b(new|newest|novinky|nove|novy|latest|fresh|trending|trend\w*|viral|tiktok|top hits|hity|aktualni)\b/,
    queries: ['new music', 'viral', 'top hits'],
    sound: 'the newest and most talked-about songs right now'
  }
]

/** A mood or situation in the request, or null. */
export function findMood(text: string): Mood | null {
  const q = norm(text)
  for (const m of MOODS) if (m.match.test(q)) return m
  return null
}

/* ---------- Several artists ---------- */

// "a", "i" and "s" are Czech for "and"/"with"; they only split when every part is a real artist.
const JOIN = /\s*(?:,|&|\+|\/|\band\b|\bx\b|\ba\b|\bi\b|\bs\b|\bwith\b|\bvs\b|\bfeat\b|\bft\b|\ba taky\b|\bplus\b)\s*/

/** Splits "riad, yzomandias a calin" into ["riad", "yzomandias", "calin"]. */
export function splitNames(q: string): string[] {
  return q
    .split(JOIN)
    .map((x) => x.trim())
    .filter(Boolean)
}

/**
 * Splits names typed without commas ("riad yzomandias calin") into known artist names, the
 * longest names first. Returns null unless every word belongs to one of them.
 */
export function segmentKnown(q: string, known: Map<string, string>): string[] | null {
  const words = q.split(' ').filter(Boolean)
  if (words.length < 2) return null
  const names = new Set([...known.values()].map(norm).filter(Boolean))
  const out: string[] = []
  let i = 0
  while (i < words.length) {
    let hit = 0
    for (let j = Math.min(words.length, i + 5); j > i; j--) {
      if (names.has(words.slice(i, j).join(' '))) {
        hit = j
        break
      }
    }
    if (!hit) return null
    out.push(words.slice(i, hit).join(' '))
    i = hit
  }
  return out.length >= 2 ? out : null
}

/* ---------- Albums ---------- */

/** "album X", "deska X od Y", "the album X by Y": the album and maybe the artist. */
export function albumRequest(q: string): { album: string; artist?: string } | null {
  const m = /^(?:the |cele |celou |whole |full )?(?:album|albums|deska|desku|desce|ep|lp|mixtape|record)\s+(.+?)(?:\s+(?:by|od|from)\s+(.+))?$/.exec(q)
  if (!m) return null
  return { album: m[1].trim(), artist: m[2]?.trim() }
}
