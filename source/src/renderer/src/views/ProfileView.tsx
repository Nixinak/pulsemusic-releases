// Local profile: picture, cover, name, bio and rearrangeable blocks.
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import type { FavoriteItem, FavoriteKind, ProfileBlock } from '@shared/types'
import { useApp, errorText } from '@/lib/store'
import { useProfile, imageFileToDataUrl, newBlockId, pickImageFile, fileToWallImage } from '@/lib/profile'
import { useQuery } from '@/lib/useQuery'
import * as sp from '@/lib/spotify'
import { playContext, playUris } from '@/lib/player'
import { prefetchArtist } from '@/lib/loaders'
import { Cover, MediaCard, Toggle, usePagePalette, ShelfRow } from '@/components/common'
import { ProfileLinks, ProfileSong, linkInfo, normaliseLink } from '@/components/ProfileExtras'
import { BrandIcon } from '@/components/BrandIcons'
import { Glass } from '@/components/Glass'
import { PalettePicker, resolveColors } from '@/components/PalettePicker'
import { paletteFromColors } from '@/lib/colors'
import { TrackList } from '@/components/TrackList'
import { ChevronDown, CloseIcon, EditIcon, MoreIcon, PlayIcon, PlusIcon, SearchIcon, ShareIcon, SparkleIcon } from '@/components/Icons'
import { ShareSheet } from '@/components/ShareSheet'
import { PulseBadge } from '@/components/PulseBadge'
import { ImageWall } from '@/components/ImageWall'
import { pulseServerOn } from '@/lib/people'
import { useFriends } from '@/lib/friends'
import { FollowCounts } from './FollowsView'
import { renderProfileCard } from '@/lib/cards'
import { useHistory } from '@/lib/history'
import { buildRecap, formatMinutes, type Recap } from '@/lib/recap'

const spring = { type: 'spring' as const, stiffness: 320, damping: 30 }

export function ProfileView(): React.JSX.Element {
  const me = useApp((s) => s.me)
  const playlists = useApp((s) => s.playlists)
  const openMenu = useApp((s) => s.openMenu)
  const toast = useApp((s) => s.toast)
  const { profile, loaded, load, update } = useProfile()
  const [editing, setEditing] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [pickingSong, setPickingSong] = useState(false)
  const [linkText, setLinkText] = useState('')
  const month = useMonthRecap()
  const [server, setServer] = useState(false)
  useEffect(() => {
    void pulseServerOn().then(setServer)
  }, [])
  const shared = server && profile.shared !== false
  // counts: your own playlists (your public page stands in when Spotify's list is empty),
  // and followers / following in Pulse and on Spotify
  const pageQ = useQuery(me ? `spotify-user:${me.id}` : null, () => window.pulse.people.spotifyUser(me!.id))
  const ownCount = Math.max(playlists.filter((p) => p.owner.id === me?.id || p.collaborative).length, pageQ.data?.playlists.length ?? 0)
  const fr = useFriends()
  const pulseFollowers = fr.friends.length + fr.incoming.length
  const pulseFollowing = fr.friends.length + fr.outgoing.length
  const followerCount = fr.loaded || pageQ.data ? Math.max(pulseFollowers, pageQ.data?.followers ?? 0) : null
  const followingCount = fr.loaded || pageQ.data ? Math.max(pulseFollowing, pageQ.data?.following ?? 0) : null

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const chosen = resolveColors(profile.palette, profile.customColors)
  usePagePalette(profile.banner ?? profile.avatar ?? sp.pickImage(me?.images, 300), chosen ? paletteFromColors(chosen) : null)

  const name = profile.displayName || me?.display_name || 'You'
  const avatar = profile.avatar ?? sp.pickImage(me?.images, 300)

  const changeImage = async (kind: 'avatar' | 'banner'): Promise<void> => {
    const file = await pickImageFile()
    if (!file) return
    try {
      const url =
        kind === 'avatar'
          ? await imageFileToDataUrl(file, 512, 1, { round: true, title: 'Crop profile photo' })
          : await imageFileToDataUrl(file, 1800, 3, { title: 'Crop banner' })
      if (url) update({ [kind]: url })
    } catch (e) {
      toast(`Could not use that image: ${errorText(e)}`, 'error')
    }
  }

  const setBlocks = (blocks: ProfileBlock[]): void => update({ blocks })
  const move = (i: number, d: -1 | 1): void => {
    const b = [...profile.blocks]
    const j = i + d
    if (j < 0 || j >= b.length) return
    ;[b[i], b[j]] = [b[j], b[i]]
    setBlocks(b)
  }
  const patchBlock = (id: string, patch: Partial<ProfileBlock>): void =>
    setBlocks(profile.blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as ProfileBlock) : b)))

  const addBlock = (e: React.MouseEvent): void => {
    const r = e.currentTarget.getBoundingClientRect()
    const add = (b: ProfileBlock): void => setBlocks([...profile.blocks, b])
    openMenu(r.left, r.bottom + 6, [
      { label: 'Text', onSelect: () => add({ id: newBlockId(), type: 'text', title: '', text: '' }) },
      {
        label: 'Image',
        onSelect: async () => {
          const file = await pickImageFile()
          if (!file) return
          const src = await imageFileToDataUrl(file, 1400, null, { title: 'Crop image', shapes: true })
          if (src) add({ id: newBlockId(), type: 'image', src, caption: '' })
        }
      },
      {
        label: 'Picture wall',
        onSelect: () => {
          // pick the pictures straight away; more can be added on the wall
          const input = document.createElement('input')
          input.type = 'file'
          input.multiple = true
          input.accept = 'image/png,image/jpeg,image/webp,image/gif'
          input.onchange = async () => {
            const files = [...(input.files ?? [])].slice(0, 16)
            if (!files.length) return
            const made = (await Promise.all(files.map(fileToWallImage))).filter((x): x is NonNullable<typeof x> => !!x)
            if (made.length) add({ id: newBlockId(), type: 'wall', title: '', images: made.map((m) => ({ ...m, size: 'auto' as const })) })
          }
          input.click()
        }
      },
      { label: 'Your month in numbers', onSelect: () => add({ id: newBlockId(), type: 'stats' }) },
      {
        label: 'Favourites',
        submenu: [
          { label: 'Artists', onSelect: () => add({ id: newBlockId(), type: 'favorites', kind: 'artist', title: 'Favourite artists', items: [] }) },
          { label: 'Albums', onSelect: () => add({ id: newBlockId(), type: 'favorites', kind: 'album', title: 'Favourite albums', items: [] }) },
          { label: 'Songs', onSelect: () => add({ id: newBlockId(), type: 'favorites', kind: 'track', title: 'Favourite songs', items: [] }) }
        ]
      },
      { label: 'Top artists', onSelect: () => add({ id: newBlockId(), type: 'top-artists' }) },
      { label: 'Top songs', onSelect: () => add({ id: newBlockId(), type: 'top-tracks' }) },
      {
        label: 'Playlist',
        submenu: playlists.map((p) => ({
          label: p.name,
          onSelect: () => add({ id: newBlockId(), type: 'playlist', playlistId: p.id })
        }))
      }
    ])
  }

  return (
    <div className={`profile ${editing ? 'is-editing' : ''}`}>
      <header className="profile__hero">
        <div className="profile__banner bleed">
          {profile.banner ? (
            <motion.img key={profile.banner.slice(-40)} src={profile.banner} alt="" initial={{ opacity: 0 }} animate={{ opacity: 1 }} />
          ) : (
            <div className="profile__banner-fallback" />
          )}
          {editing && (
            <button className="btn profile__banner-btn" onClick={() => void changeImage('banner')}>
              <EditIcon size={16} />
              {profile.banner ? 'Change cover' : 'Add cover'}
            </button>
          )}
          {editing && profile.banner && (
            <button className="icon-btn profile__banner-clear" aria-label="Remove cover" onClick={() => update({ banner: null })}>
              <CloseIcon size={16} />
            </button>
          )}
        </div>

        <div className="profile__id">
          <motion.button
            className="profile__avatar"
            whileHover={editing ? { scale: 1.04 } : undefined}
            onClick={() => editing && void changeImage('avatar')}
            aria-label={editing ? 'Change profile picture' : 'Profile picture'}
            disabled={!editing}
          >
            <Cover src={avatar} round />
            {editing && <span className="profile__avatar-edit">Change</span>}
          </motion.button>
          <div className="profile__names">
            {editing ? (
              <input
                className="profile__name-input"
                value={profile.displayName}
                placeholder={me?.display_name ?? 'Your name'}
                maxLength={40}
                onChange={(e) => update({ displayName: e.target.value })}
              />
            ) : (
              <h1 className="profile__name">{name}</h1>
            )}
            {editing ? (
              <input
                className="profile__tagline-input"
                value={profile.tagline ?? ''}
                placeholder="A line about you right now"
                maxLength={80}
                onChange={(e) => update({ tagline: e.target.value })}
              />
            ) : (
              profile.tagline && <p className="profile__tagline">{profile.tagline}</p>
            )}
            {shared && (
              <span className="profile__handle">
                <PulseBadge />
              </span>
            )}
            <span className="profile__meta">
              <span className="pstat">
                <b>{ownCount}</b> {ownCount === 1 ? 'playlist' : 'playlists'}
              </span>
              {me && <FollowCounts id={me.id} followers={followerCount} following={followingCount} />}
            </span>
          </div>
          <div className="profile__share">
            {!editing && (
              <button className="btn" onClick={() => setSharing(true)}>
                <ShareIcon size={16} /> Share card
              </button>
            )}
            <button className={`btn ${editing ? 'btn--accent' : 'profile__edit'}`} onClick={() => setEditing((e) => !e)}>
              {editing ? 'Done' : 'Edit profile'}
            </button>
            {me && !editing && (
              <button
                className="icon-btn profile__more"
                aria-label="More"
                title="More"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect()
                  openMenu(r.left, r.bottom + 6, [
                    {
                      label: 'Copy username',
                      onSelect: () =>
                        void navigator.clipboard.writeText(me.id).then(
                          () => toast('Username copied'),
                          () => toast('Couldn’t copy the username', 'error')
                        )
                    },
                    {
                      label: 'Copy profile link',
                      onSelect: () => void navigator.clipboard.writeText(`https://open.spotify.com/user/${me.id}`).then(() => toast('Link copied'))
                    },
                    { label: 'Open in Spotify', onSelect: () => window.pulse.openExternal(`https://open.spotify.com/user/${me.id}`) }
                  ])
                }}
              >
                <MoreIcon size={20} />
              </button>
            )}
          </div>
        </div>

        {!editing && (profile.anthem || profile.links?.length) ? (
          <div className="profile__extras">
            <ProfileSong song={profile.anthem} />
            <ProfileLinks links={profile.links} />
          </div>
        ) : null}

        {editing && (
          <Glass radius={24} tone="clear" simple className="profile__editor">
            <div className="peditor__row">
              <span className="peditor__label">Profile song</span>
              {profile.anthem ? (
                <ProfileSong song={profile.anthem} onRemove={() => update({ anthem: null })} />
              ) : (
                <button className="btn" onClick={() => setPickingSong(true)}>
                  <PlusIcon size={16} /> Choose a song
                </button>
              )}
              {profile.anthem && (
                <button className="link" onClick={() => setPickingSong(true)}>
                  Change
                </button>
              )}
            </div>
            <div className="peditor__row peditor__row--top">
              <span className="peditor__label">Links</span>
              <div className="peditor__links">
                {(profile.links ?? []).map((l) => (
                  <span key={l.url} className="plink is-edit">
                    <BrandIcon kind={linkInfo(l.url).kind} size={16} />
                    {linkInfo(l.url).label}
                    <button aria-label={`Remove ${l.url}`} onClick={() => update({ links: (profile.links ?? []).filter((x) => x.url !== l.url) })}>
                      <CloseIcon size={13} />
                    </button>
                  </span>
                ))}
                {(profile.links?.length ?? 0) < 5 && (
                  <form
                    className="peditor__addlink"
                    onSubmit={(e) => {
                      e.preventDefault()
                      const url = normaliseLink(linkText)
                      if (!url) return toast('That doesn’t look like a link.', 'error')
                      if (!(profile.links ?? []).some((x) => x.url === url)) update({ links: [...(profile.links ?? []), { url }] })
                      setLinkText('')
                    }}
                  >
                    <input
                      className="field"
                      value={linkText}
                      onChange={(e) => setLinkText(e.target.value)}
                      placeholder="instagram.com/you"
                      spellCheck={false}
                    />
                    <button className="btn" disabled={!linkText.trim()}>
                      Add
                    </button>
                  </form>
                )}
              </div>
            </div>
            {server && (
              <div className="peditor__row">
                <span className="peditor__label">Visible</span>
                <label className="profile__share-toggle">
                  <span>
                    <b>{profile.shared !== false ? 'Anyone on Pulse can find you' : 'Only you can see this profile'}</b>
                    <small>Other Pulse users can find your profile, see what you play and follow you.</small>
                  </span>
                  <Toggle on={profile.shared !== false} onChange={(v) => update({ shared: v })} label="Visible to other Pulse users" />
                </label>
              </div>
            )}
            <div className="peditor__row peditor__row--top">
              <span className="peditor__label">Colours</span>
              <div className="peditor__palette">
                <PalettePicker
                  value={profile.palette}
                  autoId="auto"
                  autoLabel="From pictures"
                  customColors={profile.customColors}
                  onChange={(palette) => update({ palette })}
                  onCustomColors={(customColors) => update({ customColors })}
                />
              </div>
            </div>
          </Glass>
        )}
        {pickingSong && (
          <FavoritePicker
            kind="track"
            onClose={() => setPickingSong(false)}
            onPick={(it) => {
              update({ anthem: it })
              setPickingSong(false)
            }}
          />
        )}

        {editing ? (
          <textarea
            className="field profile__bio-input"
            value={profile.bio}
            maxLength={500}
            placeholder="Write something about yourself"
            onChange={(e) => update({ bio: e.target.value })}
          />
        ) : (
          profile.bio && <p className="profile__bio">{profile.bio}</p>
        )}
      </header>

      <div className="profile__blocks">
        <AnimatePresence initial={false}>
          {profile.blocks.map((b, i) => (
            <motion.section
              key={b.id}
              layout
              className={`pblock pblock--${b.type}`}
              initial={{ opacity: 0, y: 20, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={spring}
            >
              {editing && (
                <div className="pblock__tools">
                  <button className="icon-btn icon-btn--sm" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                    <ChevronDown size={16} style={{ transform: 'rotate(180deg)' }} />
                  </button>
                  <button className="icon-btn icon-btn--sm" aria-label="Move down" disabled={i === profile.blocks.length - 1} onClick={() => move(i, 1)}>
                    <ChevronDown size={16} />
                  </button>
                  <button className="icon-btn icon-btn--sm" aria-label="Remove block" onClick={() => setBlocks(profile.blocks.filter((x) => x.id !== b.id))}>
                    <CloseIcon size={16} />
                  </button>
                </div>
              )}
              <Block block={b} editing={editing} onPatch={(p) => patchBlock(b.id, p)} />
            </motion.section>
          ))}
        </AnimatePresence>
        {editing && (
          <button className="pblock pblock--add" onClick={addBlock}>
            <PlusIcon size={22} />
            Add a block
          </button>
        )}
        {!editing && profile.blocks.length === 0 && (
          <button className="pblock pblock--add" onClick={() => setEditing(true)}>
            <PlusIcon size={22} />
            Add text, pictures, playlists and favourites
          </button>
        )}
      </div>
      <ShareSheet
        open={sharing}
        title="Share your profile"
        fileName={`${name} on Pulse Music`}
        formats={['story']}
        onClose={() => setSharing(false)}
        render={async (_f, style) => {
          const [artists, tracks] = await Promise.all([sp.getTopArtists('short_term', 5).catch(() => null), sp.getTopTracks('short_term', 5).catch(() => null)])
          const favs = profile.blocks.filter((b): b is Extract<ProfileBlock, { type: 'favorites' }> => b.type === 'favorites')
          return renderProfileCard({
            name,
            avatar,
            banner: profile.banner,
            bio: profile.bio,
            style,
            stats: month
              ? [
                  { label: 'listened this month', value: formatMinutes(month.minutes) },
                  { label: 'songs played', value: month.plays.toLocaleString() },
                  { label: 'artists', value: month.artistCount.toLocaleString() }
                ]
              : [],
            topArtists: (month?.source === 'history'
              ? month.topArtists
              : (artists?.items ?? []).map((a) => ({ name: a.name, image: sp.pickImage(a.images, 300) }))
            ).map((a) => ({ name: a.name, image: a.image })),
            topTracks: (tracks?.items ?? []).map((t) => ({
              name: t.name,
              artist: t.artists.map((a) => a.name).join(', '),
              image: sp.pickImage(t.album?.images, 300)
            })),
            favourites: favs.map((f) => ({ title: f.title, items: f.items.map((i) => ({ name: i.name, image: i.image })) }))
          })
        }}
      />
    </div>
  )
}

/** This month's numbers (shared by the stats block and the share card). */
function useMonthRecap(): Recap | null {
  const loaded = useHistory((s) => s.loaded)
  const count = useHistory((s) => s.plays.length)
  const [r, setR] = useState<Recap | null>(null)
  useEffect(() => {
    if (!loaded) return
    let alive = true
    void buildRecap('month').then((x) => alive && setR(x))
    return () => {
      alive = false
    }
  }, [loaded, count])
  return r
}

function Block({ block, editing, onPatch }: { block: ProfileBlock; editing: boolean; onPatch: (p: Partial<ProfileBlock>) => void }): React.JSX.Element | null {
  switch (block.type) {
    case 'text':
      return editing ? (
        <Glass radius={22} tone="clear" bezel={14} refraction={30} className="pblock__card">
          <input className="pblock__title-input" value={block.title} placeholder="Title (optional)" onChange={(e) => onPatch({ title: e.target.value })} />
          <textarea className="field" value={block.text} placeholder="Write anything" maxLength={2000} onChange={(e) => onPatch({ text: e.target.value })} />
        </Glass>
      ) : (
        <Glass radius={22} tone="clear" bezel={14} refraction={30} className="pblock__card">
          {block.title && <h2 className="pblock__title">{block.title}</h2>}
          <p className="pblock__text">{block.text || ' '}</p>
        </Glass>
      )
    case 'image':
      return (
        <figure className="pblock__figure">
          <img decoding="async" src={block.src} alt={block.caption} />
          {editing && (
            <button
              className="btn btn--sm pblock__recrop"
              onClick={async () => {
                // crop the picture again (from the one saved in the block)
                const blob = await fetch(block.src).then((r) => r.blob())
                const src = await imageFileToDataUrl(new File([blob], 'image', { type: blob.type || 'image/jpeg' }), 1400, null, {
                  title: 'Crop image',
                  shapes: true
                })
                if (src) onPatch({ src })
              }}
            >
              Crop
            </button>
          )}
          {editing ? (
            <input
              className="pblock__caption-input"
              value={block.caption}
              placeholder="Caption (optional)"
              onChange={(e) => onPatch({ caption: e.target.value })}
            />
          ) : (
            block.caption && <figcaption>{block.caption}</figcaption>
          )}
        </figure>
      )
    case 'wall':
      return (
        <section className="pblock__wall">
          {editing ? (
            <input className="pblock__title-input" value={block.title} placeholder="Title (optional)" onChange={(e) => onPatch({ title: e.target.value })} />
          ) : (
            block.title && <h2 className="pblock__heading">{block.title}</h2>
          )}
          <ImageWall images={block.images} editing={editing} onChange={(images) => onPatch({ images })} />
        </section>
      )
    case 'top-artists':
      return <TopArtistsBlock />
    case 'top-tracks':
      return <TopTracksBlock />
    case 'playlist':
      return <PlaylistBlock id={block.playlistId} />
    case 'stats':
      return <StatsBlock />
    case 'favorites':
      return <FavoritesBlock block={block} editing={editing} onPatch={onPatch} />
  }
}

function StatsBlock(): React.JSX.Element {
  const r = useMonthRecap()
  const navigate = useApp((s) => s.navigate)
  const setRecapOpen = useApp((s) => s.setRecapOpen)
  if (!r) return <p className="muted">Counting your listening…</p>
  const top = r.topArtists[0]
  const song = r.topTracks[0]
  return (
    <>
      <div className="fav__head">
        <h2 className="pblock__heading" style={{ margin: 0, flex: 1 }}>
          {r.label}
        </h2>
        <button className="btn" onClick={() => setRecapOpen(true)}>
          <SparkleIcon size={16} /> Recap
        </button>
      </div>
      <div className="pstats">
        {top ? (
          <div className="pstats__hero" onClick={() => navigate({ name: 'artist', id: top.id })}>
            {top.image && <img decoding="async" src={top.image} alt="" />}
            <div>
              <small>Top artist this month</small>
              <b>{top.name}</b>
            </div>
          </div>
        ) : (
          <div className="pstats__tile">
            <span>Play some music to find your top artist.</span>
          </div>
        )}
        <div className="pstats__tile">
          <strong>{formatMinutes(r.minutes)}</strong>
          <span>listened this month</span>
        </div>
        <div className="pstats__tile">
          <strong>{r.plays.toLocaleString()}</strong>
          <span>songs played</span>
        </div>
        <div className="pstats__tile">
          <strong>{r.artistCount.toLocaleString()}</strong>
          <span>different artists</span>
        </div>
        <div className="pstats__tile">
          <strong>{song?.name ?? 'None yet'}</strong>
          <span>{song ? `top song, ${song.artist}` : 'top song'}</span>
        </div>
      </div>
    </>
  )
}

const KIND_LABEL: Record<FavoriteKind, string> = { artist: 'artist', album: 'album', track: 'song' }

function FavoritesBlock({
  block,
  editing,
  onPatch
}: {
  block: Extract<ProfileBlock, { type: 'favorites' }>
  editing: boolean
  onPatch: (p: Partial<ProfileBlock>) => void
}): React.JSX.Element {
  const navigate = useApp((s) => s.navigate)
  const [picking, setPicking] = useState(false)
  const open = (it: FavoriteItem): void => {
    if (block.kind === 'artist') navigate({ name: 'artist', id: it.id })
    else if (block.kind === 'album') navigate({ name: 'album', id: it.id })
    else void playUris([it.uri])
  }
  return (
    <>
      <div className="fav__head">
        {editing ? (
          <input
            className="fav__title-input"
            value={block.title}
            maxLength={60}
            placeholder="For example: Favourite rapper"
            onChange={(e) => onPatch({ title: e.target.value } as Partial<ProfileBlock>)}
          />
        ) : (
          <h2 className="pblock__heading" style={{ margin: 0 }}>
            {block.title}
          </h2>
        )}
      </div>
      <div className="fav__grid">
        {block.items.map((it) => (
          <motion.div key={it.id} layout className="fav">
            <button className="fav" onClick={() => !editing && open(it)} title={it.name}>
              <Cover src={it.image} round={block.kind === 'artist'} radius={14} />
              <span className="fav__name">{it.name}</span>
              {it.subtitle && <span className="fav__sub">{it.subtitle}</span>}
            </button>
            {editing && (
              <button
                className="icon-btn icon-btn--sm fav__remove"
                aria-label={`Remove ${it.name}`}
                onClick={() => onPatch({ items: block.items.filter((x) => x.id !== it.id) } as Partial<ProfileBlock>)}
              >
                <CloseIcon size={14} />
              </button>
            )}
          </motion.div>
        ))}
        {editing && block.items.length < 8 && (
          <button className="fav__add" onClick={() => setPicking(true)}>
            <PlusIcon size={22} />
            Add {KIND_LABEL[block.kind]}
          </button>
        )}
        {!editing && block.items.length === 0 && <p className="muted">Nothing picked yet.</p>}
      </div>
      {picking && (
        <FavoritePicker
          kind={block.kind}
          onClose={() => setPicking(false)}
          onPick={(it) => {
            if (!block.items.some((x) => x.id === it.id)) onPatch({ items: [...block.items, it] } as Partial<ProfileBlock>)
            setPicking(false)
          }}
        />
      )}
    </>
  )
}

function FavoritePicker({ kind, onPick, onClose }: { kind: FavoriteKind; onPick: (it: FavoriteItem) => void; onClose: () => void }): React.JSX.Element {
  const [q, setQ] = useState('')
  const [items, setItems] = useState<FavoriteItem[]>([])
  const top = useQuery<{ items: unknown[] }>(
    kind === 'artist' ? 'home:artists' : 'home:top',
    kind === 'artist' ? () => sp.getTopArtists() : () => sp.getTopTracks()
  )
  const suggestions = useMemo<FavoriteItem[]>(() => {
    const d = top.data?.items ?? []
    if (kind === 'artist')
      return (d as { id: string; uri: string; name: string; images?: { url: string; width: number | null }[] }[]).map((a) => ({
        id: a.id,
        uri: a.uri,
        name: a.name,
        subtitle: 'From your top artists',
        image: sp.pickImage(a.images, 300)
      }))
    const tracks = d as unknown as import('@/lib/types').STrack[]
    if (kind === 'album') {
      const seen = new Set<string>()
      return tracks
        .filter((t) => t.album && !seen.has(t.album.id) && seen.add(t.album.id))
        .map((t) => ({
          id: t.album!.id,
          uri: t.album!.uri,
          name: t.album!.name,
          subtitle: t.artists[0]?.name ?? '',
          image: sp.pickImage(t.album!.images, 300)
        }))
    }
    return tracks.map((t) => ({
      id: t.id,
      uri: t.uri,
      name: t.name,
      subtitle: t.artists.map((a) => a.name).join(', '),
      image: sp.pickImage(t.album?.images, 300)
    }))
  }, [top.data, kind])

  useEffect(() => {
    const query = q.trim()
    if (query.length < 2) return setItems([])
    let alive = true
    const t = window.setTimeout(() => {
      sp.search(query)
        .then((r) => {
          if (!alive) return
          if (kind === 'artist')
            setItems((r.artists?.items ?? []).map((a) => ({ id: a.id, uri: a.uri, name: a.name, subtitle: 'Artist', image: sp.pickImage(a.images, 300) })))
          else if (kind === 'album')
            setItems(
              (r.albums?.items ?? []).map((a) => ({
                id: a.id,
                uri: a.uri,
                name: a.name,
                subtitle: `${a.album_type === 'single' ? 'Single' : 'Album'}, ${a.artists.map((x) => x.name).join(', ')}`,
                image: sp.pickImage(a.images, 300)
              }))
            )
          else
            setItems(
              (r.tracks?.items ?? []).map((t) => ({
                id: t.id,
                uri: t.uri,
                name: t.name,
                subtitle: t.artists.map((a) => a.name).join(', '),
                image: sp.pickImage(t.album?.images, 300)
              }))
            )
        })
        .catch(() => alive && setItems([]))
    }, 250)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [q, kind])

  const list = q.trim().length >= 2 ? items : suggestions
  return createPortal(
    <div className="modal-layer" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <Glass radius={28} tone="thick" bezel={22} refraction={56} className="modal tools">
        <button className="icon-btn modal__close" aria-label="Close" onClick={onClose}>
          <CloseIcon size={18} />
        </button>
        <div className="fav-search">
          <h2 className="tools__title">Add a favourite {KIND_LABEL[kind]}</h2>
          <label className="search-pill fav-search__input">
            <SearchIcon size={18} />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search for an ${kind === 'track' ? 'song' : kind}`.replace('an song', 'a song')}
            />
          </label>
          <div className="fav-search__list">
            {list.map((it) => (
              <button key={it.id} className="fav-search__item" onClick={() => onPick(it)}>
                <Cover src={it.image} size={46} round={kind === 'artist'} radius={8} />
                <span className="tools__li-text">
                  <b>{it.name}</b>
                  <small>{it.subtitle}</small>
                </span>
              </button>
            ))}
          </div>
        </div>
      </Glass>
    </div>,
    document.body
  )
}

function TopArtistsBlock(): React.JSX.Element {
  const navigate = useApp((s) => s.navigate)
  const q = useQuery('home:artists', sp.getTopArtists)
  return (
    <>
      <h2 className="pblock__heading">Top artists</h2>
      <ShelfRow>
        {(q.data?.items ?? []).slice(0, 10).map((a) => (
          <MediaCard
            key={a.id}
            round
            artistId={a.id}
            image={sp.pickImage(a.images, 300)}
            title={a.name}
            onOpen={() => navigate({ name: 'artist', id: a.id })}
            onPrefetch={() => prefetchArtist(a.id, a.name)}
            onPlay={() => void playContext(a.uri)}
          />
        ))}
      </ShelfRow>
    </>
  )
}

function TopTracksBlock(): React.JSX.Element {
  const q = useQuery('home:top', sp.getTopTracks)
  const tracks = (q.data?.items ?? []).slice(0, 5)
  return (
    <>
      <h2 className="pblock__heading">Top songs this month</h2>
      <TrackList
        tracks={tracks}
        onPlay={(i) =>
          void playUris(
            tracks.map((t) => t.uri),
            tracks[i].uri
          )
        }
      />
    </>
  )
}

function PlaylistBlock({ id }: { id: string }): React.JSX.Element {
  const navigate = useApp((s) => s.navigate)
  const p = useApp((s) => s.playlists.find((x) => x.id === id))
  if (!p) return <p className="muted">This playlist is no longer in your library.</p>
  return (
    <Glass radius={22} tone="clear" bezel={14} refraction={30} className="pblock__card pblock__playlist" onClick={() => navigate({ name: 'playlist', id })}>
      <Cover src={sp.pickImage(p.images, 300)} size={120} radius={14} />
      <div className="pblock__pl-text">
        <span className="phead__kind">Playlist</span>
        <span className="pblock__pl-name">{p.name}</span>
        <span className="muted">{sp.playlistSongs(p)}</span>
      </div>
      <button
        className="play-fab"
        aria-label={`Play ${p.name}`}
        onClick={(e) => {
          e.stopPropagation()
          void playContext(p.uri)
        }}
      >
        <PlayIcon size={22} />
      </button>
    </Glass>
  )
}
