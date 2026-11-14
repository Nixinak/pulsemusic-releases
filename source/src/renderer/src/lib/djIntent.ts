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
  /** false: about older music, so no "new releases" in it (default true). */
  fresh?: boolean
  /** Only songs released in these years (inclusive). */
  era?: [number, number]
  /** Only artists from this country ("Czech"). */
  country?: string
  /** A hard rule for the model ("Every song must be by a Czech artist."). */
  rule?: string
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

/* ---------- Where and when: "classic czech songs", "polský rap", "90s rock" ---------- */

type Family = 'rap' | 'rock' | 'pop' | 'folk' | 'electronic' | 'any'

const COUNTRIES: { adj: string; match: RegExp; tag: string; family: Partial<Record<Family, string[]>> & { any: string[] } }[] = [
  {
    adj: 'Czech',
    match: /\b(czech\w*|cz|cesk\w*|cestin\w*|cechy|cesky|ceske|ceskou|ceskych)\b/,
    tag: 'czech',
    family: {
      any: ['czech pop', 'czech hip hop', 'czech rock', 'czech folk', 'czech indie'],
      rap: ['czech hip hop', 'czech trap', 'czech drill'],
      rock: ['czech rock', 'czech punk', 'czech metal'],
      pop: ['czech pop', 'czech indie'],
      folk: ['czech folk', 'czech singer-songwriter']
    }
  },
  {
    adj: 'Slovak',
    match: /\b(slovak\w*|sk|slovensk\w*|slovencin\w*)\b/,
    tag: 'slovak',
    family: { any: ['slovak pop', 'slovak hip hop', 'slovak rock'], rap: ['slovak hip hop', 'slovak trap'], rock: ['slovak rock'], pop: ['slovak pop'] }
  },
  {
    adj: 'Polish',
    match: /\b(polish|polsk\w*|polstin\w*|polsku)\b/,
    tag: 'polish',
    family: { any: ['polish pop', 'polish hip hop', 'polish rock'], rap: ['polish hip hop', 'polish trap'], rock: ['polish rock'], pop: ['polish pop'] }
  },
  {
    adj: 'German',
    match: /\b(german\w*|nemeck\w*|nemcin\w*|deutsch\w*)\b/,
    tag: 'german',
    family: { any: ['german pop', 'german hip hop', 'german rock', 'schlager'], rap: ['german hip hop', 'german trap'], rock: ['german rock', 'neue deutsche harte'], pop: ['german pop', 'schlager'] }
  },
  {
    adj: 'French',
    match: /\b(french|francouz\w*|francie|francais\w*)\b/,
    tag: 'french',
    family: { any: ['french pop', 'french hip hop', 'chanson'], rap: ['french hip hop'], pop: ['french pop', 'chanson'] }
  },
  {
    adj: 'Spanish',
    match: /\b(spanish|spanel\w*|spanelsk\w*|espanol\w*)\b/,
    tag: 'spanish',
    family: { any: ['spanish pop', 'latin pop', 'spanish hip hop'], rap: ['spanish hip hop', 'trap latino'], pop: ['spanish pop', 'latin pop'] }
  },
  {
    adj: 'Italian',
    match: /\b(italian\w*|italsk\w*|italie)\b/,
    tag: 'italian',
    family: { any: ['italian pop', 'italian hip hop', 'cantautori'], rap: ['italian hip hop', 'italian trap'], pop: ['italian pop'] }
  },
  {
    adj: 'Russian',
    match: /\b(russian|rusk\w*|rustin\w*)\b/,
    tag: 'russian',
    family: { any: ['russian pop', 'russian hip hop', 'russian rock'], rap: ['russian hip hop'], rock: ['russian rock'] }
  },
  {
    adj: 'Ukrainian',
    match: /\b(ukrain\w*)\b/,
    tag: 'ukrainian',
    family: { any: ['ukrainian pop', 'ukrainian hip hop'] }
  },
  {
    adj: 'Korean',
    match: /\b(korean|korejsk\w*|k ?pop)\b/,
    tag: 'korean',
    family: { any: ['k-pop', 'k-rap', 'korean r&b'], rap: ['k-rap'], pop: ['k-pop'] }
  },
  {
    adj: 'Japanese',
    match: /\b(japanese|japonsk\w*|j ?pop|anime)\b/,
    tag: 'japanese',
    family: { any: ['j-pop', 'j-rock', 'anime'], rock: ['j-rock'], pop: ['j-pop'] }
  },
  {
    adj: 'British',
    match: /\b(british|britsk\w*|uk|english|anglick\w*)\b/,
    tag: 'uk',
    family: { any: ['uk pop', 'uk hip hop', 'britpop'], rap: ['uk hip hop', 'uk drill', 'grime'], rock: ['britpop', 'british rock'], pop: ['uk pop'] }
  },
  {
    adj: 'Brazilian',
    match: /\b(brazil\w*|brazilsk\w*)\b/,
    tag: 'brazilian',
    family: { any: ['funk carioca', 'mpb', 'brazilian funk'], rap: ['brazilian hip hop'] }
  }
]

const FAMILY: [RegExp, Family][] = [
  [/\b(rap\w*|hip ?hop|hiphop|trap|drill|grime|repy|rapu|rapy)\b/, 'rap'],
  [/\b(rock\w*|punk|metal|grunge|rocku)\b/, 'rock'],
  [/\b(pop|popik|popovk\w*)\b/, 'pop'],
  [/\b(folk|country|trampsk\w*|folkov\w*)\b/, 'folk'],
  [/\b(edm|house|techno|electronic|elektronik\w*|dance)\b/, 'electronic']
]
const FAMILY_TAGS: Record<Family, string[]> = {
  rap: ['hip hop', 'rap', 'gangster rap'],
  rock: ['rock', 'classic rock', 'alternative rock'],
  pop: ['pop', 'dance pop'],
  folk: ['folk', 'singer-songwriter'],
  electronic: ['house', 'dance', 'edm'],
  any: ['pop', 'hip hop', 'rock', 'dance pop']
}

/** The years a request is about: a decade ("90s", "devadesátky", "80. let") or "classic"/"old". */
function findEra(q: string): { from: number; to: number; label: string } | null {
  const decades: [RegExp, number][] = [
    [/\b(60s|60 s|1960s?|sixties|sedesat\w*|60 let)\b/, 1960],
    [/\b(70s|70 s|1970s?|seventies|sedmdesat\w*|70 let)\b/, 1970],
    [/\b(80s|80 s|1980s?|eighties|osmdesat\w*|80 let)\b/, 1980],
    [/\b(90s|90 s|1990s?|nineties|devadesat\w*|90 let)\b/, 1990],
    [/\b(2000s|2000 s|00s|noughties|nult\w*)\b/, 2000],
    [/\b(2010s|2010 s|10s)\b/, 2010]
  ]
  for (const [re, from] of decades) if (re.test(q)) return { from, to: from + 9, label: from >= 2000 ? `${from}s` : `${String(from).slice(2)}s` }
  if (/\b(classic\w*|klasik\w*|klasick\w*|stare|starsi|stary|starou|starych|oldies|old ?school|retro|throwback\w*|nostalgi\w*|z mladi|evergreen\w*|legendarn\w*|zlate|vykopavk\w*)\b/.test(q)) {
    const year = new Date().getFullYear()
    return { from: 1960, to: year - 8, label: 'classics' }
  }
  return null
}

/**
 * Where and when a request is about: a country or language ("czech", "polský"), maybe a genre
 * family ("rap", "rock") and maybe an era ("classic", "90s"). Becomes a mood that searches
 * Spotify by genre tag and year (genre:"czech pop" year:1960-2018), so "classic czech songs"
 * finds Czech classics instead of songs called "Classic" or "Throwback".
 */
export function findScope(text: string): Mood | null {
  const q = norm(text)
  const country = COUNTRIES.find((c) => c.match.test(q)) ?? null
  const era = findEra(q)
  if (!country && !era) return null
  const family = FAMILY.find(([re]) => re.test(q))?.[1] ?? 'any'
  const core = /\b(drill|trap|phonk|punk|metal|indie|folk|pop|rock|rap|hip hop|house|techno|r ?b|rnb)\b/.exec(q)?.[1]?.replace('rnb', 'r&b')
  let tags: string[]
  if (country) {
    const own = country.family[family] ?? country.family.any
    tags = [...new Set([...(core && core !== 'rap' ? [`${country.tag} ${core}`] : []), ...own])]
  } else tags = [...new Set([...(core ? [core] : []), ...FAMILY_TAGS[family]])]
  const years = era ? ` year:${era.from}-${era.to}` : ''
  const queries = tags.slice(0, 5).map((t) => `genre:"${t}"${years}`)
  const famWord = family === 'any' ? '' : family === 'electronic' ? 'electronic' : family
  const tail = era ? (era.label === 'classics' ? (/\bthrowback/.test(q) ? 'throwbacks' : 'classics') : `from the ${era.label}`) : famWord ? '' : 'songs'
  const label = [country?.adj, famWord && (core ?? famWord), tail]
    .filter(Boolean)
    .join(' ')
    .replace(/^(\w)/, (c) => c.toUpperCase())
  const rules = [
    country ? `Every song MUST be by a ${country.adj} artist (mostly sung in ${country.adj === 'British' ? 'English' : country.adj === 'Brazilian' ? 'Portuguese' : country.adj}); no artists from other countries.` : '',
    era ? `Every song MUST have been released between ${era.from} and ${era.to}; no new releases.` : ''
  ].filter(Boolean)
  return {
    id: `scope:${country?.tag ?? ''}:${family}:${era?.from ?? ''}-${era?.to ?? ''}`,
    label,
    queries,
    sound: [country ? `${country.adj} music` : '', famWord ? `(${core ?? famWord})` : '', era ? `released ${era.from}–${era.to}, well-known songs people sing along to` : 'popular songs'].filter(Boolean).join(' '),
    fresh: !era,
    era: era ? [era.from, era.to] : undefined,
    country: country?.adj,
    rule: rules.join(' ')
  }
}

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
