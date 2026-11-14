# Pulse Music

A liquid-glass desktop client for Spotify on Windows. Sign in with your Spotify account, play music right inside the app or on any Spotify Connect device, manage playlists, and read synced lyrics.

## Features

- **Playback in the app.** Pulse Music shows up as a Spotify Connect device ("Pulse Music"). Hand playback to your phone or another computer from the devices menu.
- **Your library.** Home, Search, Library (playlists, albums, artists), Liked Songs, album, artist and playlist pages.
- **Playlists.** Create, rename, edit the description, add and remove songs, delete. Drag songs by the handle to reorder them; the new order is saved to Spotify.
- **Playlist tools.** Remove duplicates (optionally other versions of the same song), sort by date added, title, artist, album, release date or length, merge another playlist in, and upload your own cover.
- **Queue.** See what plays next, add, remove and clear songs. Everything coming up (your queue, the playlist or album, the AI DJ's show) can be dragged into a new order; a double-click plays a song.
- **Lyrics.** Synced lyrics from [LRCLIB](https://lrclib.net), lit up word by word like Apple Music (exact when the lyrics have word timings, estimated otherwise). Click a line to jump to it. When LRCLIB has nothing, plain lyrics come from Genius. Pick a few lines and share them as an image.
- **Your stats and Recap.** Pulse Music keeps a local listening history, like stats.fm: it starts with Windows and runs in the tray, so plays on your phone and other devices count too (both can be switched off in Settings → System). Last week, this year and all time: minutes, top songs and artists, your listening hours and days, and a card for every month. Your Spotify data download can be imported in Settings → Listening history. Recap plays it back as full-screen stories, and your year in music arrives in December, like Wrapped.
- **Made for you.** Six Daily Mixes, On Repeat and Repeat Rewind (new every day), Discover Weekly, Release Radar, Deep Cuts and Time Capsule (new every Monday), up to 40 songs each, made quietly in the background from what you play, each with its own cover.
- **Mix generator.** Builds a mix from your liked songs, playlists and top songs with a mood (favourites, deep cuts, fresh, throwback), era and artist spacing. Play it or save it as a playlist.
- **Profile.** Picture, cover, bio, your month in numbers, favourite artists, albums and songs, picture walls laid out like a mosaic, and a shareable profile card. Other people's profiles open at once when you've seen them before.
- **Pulse DJ.** An AI radio host that picks sets from your own library and listening history, talks between songs with the music ducked underneath, and takes requests ("something chill", "more Czech rap"). Runs on [Ollama](https://ollama.com) on your computer or on the Claude API, speaks English with a natural offline neural voice ([Kokoro-82M](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX), six voices to choose from, downloaded once from Settings), or shows subtitles only. Ask it for a mood, or name a song, an artist or an album and it plays exactly that (then those artists and ones like them). It understands countries, languages and eras too ("classic czech songs", "polský rap", "90s rock"). On Windows its orb moves with the beat of what's playing (it listens to the computer's sound; only levels are measured, nothing is recorded).
- **Quick search (Ctrl + K).** Songs, artists, albums, your playlists, app pages, settings and actions such as the sleep timer.
- **Sleep timer.** 15 to 90 minutes or the end of the song; the music fades out, then pauses.
- **Fonts and compact mode.** Six interface fonts and a compact layout in Settings.
- **Liquid glass UI.** Real refraction with chromatic dispersion at the glass edges (Settings → Glass quality: Full / Lite). Colours follow the album artwork. Light, dark or system theme.
- **Windows.** Media keys and the Windows media overlay, a tray icon, an always-on-top mini player, and an optional start with Windows.
- **Discord status.** "Listening to Pulse Music" with the song, artist, cover art, a progress bar and a *Listen on Spotify* button. Shows *Paused* when paused.

## Requirements

- Windows 10 or 11
- Node.js 20 or newer
- Spotify Premium (Spotify requires it for playback and for developer apps)
- Python 3 (only for the castLabs signing step, see below)

## First-time setup

1. **Install dependencies**

   ```
   npm install
   ```

   This downloads the castLabs build of Electron, which includes Widevine. Spotify needs Widevine to play protected audio. The download runs in the `postinstall` step; if `npm run dev` says *Electron uninstall*, run `npm run postinstall`.

2. **Spotify app.** The Client ID is already set in `src/main/config.ts`. In the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), the app needs:
   - Redirect URI: `http://127.0.0.1:43821/callback`
   - APIs: Web API and Web Playback SDK

3. **Genius token (optional).** Copy `.env.example` to `.env.local` and paste your token from [genius.com/api-clients](https://genius.com/api-clients). You can also paste it later in Settings → Lyrics.

4. **castLabs EVS account (free, one time).** Spotify only plays audio in apps signed by castLabs.

   ```
   npm run evs:setup
   ```

   Follow the prompts and confirm the code sent to your email. If you already have an account, run `npm run evs:login` instead.

## Run

```
npm run dev
```

Opens the app with hot reload. If the player says it *cannot play protected audio*, sign the development build once:

```
npm run evs:sign-dev
```

`npm start` runs the production build without hot reload.

## Build the installer

```
npm run dist
```

The installer is written to `dist/PulseMusic-Setup.exe`. The build signs the app with castLabs EVS automatically (run `npm run evs:setup` once on the build computer). If signing fails, the build prints a warning and playback won't work in the installed app.

## Releasing an update

Friends' copies update themselves from the public repository **Nixinak/pulsemusic-releases**: the app checks at start and every 6 hours, downloads a new version in the background and installs it when closed (or right away with *Restart now*).

1. Raise `"version"` in `package.json` (for example `1.2.0` → `1.3.0`). Updates only go to a higher version.
2. Create a GitHub token once: GitHub → Settings → Developer settings → *Fine-grained tokens*, access to `pulsemusic-releases` with *Contents: Read and write*.
3. Build and publish:
   ```
   set GH_TOKEN=github_pat_...
   npm run release
   ```
   This uploads the installer, its `.blockmap` and `latest.yml` to a new GitHub release.

`npm run dist` builds the installer without publishing.

## Party mode

**Party** in the sidebar starts a small web page on this computer and shows a QR code. Friends on the same Wi-Fi scan it, type their name, search for songs and add them to your queue (up to 3 waiting songs each). The address contains a random code, so only people who scanned it can join. The first time, Windows asks whether Pulse Music may use the network: allow it for private networks.

## Last.fm

Settings → Last.fm → *Connect* opens Last.fm in the browser to allow Pulse Music. Songs count once you've heard half of them or 4 minutes (Last.fm's rule); scrobbles made offline are sent later. The build needs an API key: create one at [last.fm/api/account/create](https://www.last.fm/api/account/create) and put `MAIN_VITE_LASTFM_KEY` and `MAIN_VITE_LASTFM_SECRET` into `.env.local`.

## Sharing the app with a friend

The installer has everything built in: the Spotify app ID, the Genius token from `.env.local` and the castLabs signature. Your friend doesn't need any API keys.

1. **Add them in the Spotify dashboard first.** The Spotify app is in development mode, so only people on its list can sign in. Open [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard), choose the app, then *User Management*, and add your friend's name and the email of their Spotify account. Development mode only allows a few users.
2. **They need Spotify Premium.** Playback inside the app requires it.
3. Send them `PulseMusic-Setup.exe`. The installer isn't code-signed, so Windows SmartScreen may show "Windows protected your PC": they click *More info* and then *Run anyway*.
4. During install they can tick **Set up the AI DJ**. The installer then installs Ollama and downloads the model (about 5 GB). If they skip it, the DJ page and Settings have a *Set up the AI DJ for me* button that does the same.
5. On first start the app downloads the DJ's voice in the background (about 330 MB). Spotify's DRM component also installs itself the first time something plays.

## Setting up the AI DJ

The installer and the *Set up the AI DJ for me* button do this automatically. By hand:

1. Install [Ollama](https://ollama.com), then in a terminal: `ollama pull qwen2.5:7b`.
2. In Settings → AI DJ pick the model and press *Say hello* to check it answers.
3. Turn on *DJ speaks out loud*. The voice downloads by itself on first start (or press *Download voice*). Play the samples and pick one of the six voices.
4. Open **DJ** in the sidebar and press *Start the DJ*.

Pulse starts Ollama by itself when it is installed but not running.

To use Claude instead, pick *Claude API* and paste an API key from console.anthropic.com.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| Space | Play or pause |
| Ctrl + → / ← | Next or previous song |
| Ctrl + K | Quick search: songs, playlists, pages, settings |
| Ctrl + F | Search |
| Alt + ← / → | Back or forward |
| Esc | Close Now Playing, menus and dialogs |

## Spotify API limits

Spotify restricted Development Mode apps in February 2026. Pulse Music works around these limits where it can:

- **Followed playlists you don't own** can be played, but Spotify doesn't share their song list.
- **Artist "Popular" songs** come from search, because Spotify removed the top-tracks endpoint.
- **Search** returns 10 results per type. Use *Show more songs* to load more.
- **Up to 5 users** can be added to the app in the developer dashboard.

## Project layout

```
src/
  main/        Electron main process: sign-in (PKCE), settings, tray, mini player, Discord, lyrics fetching
  preload/     Safe bridge exposed to the UI as window.pulse
  shared/      Types shared by all processes
  renderer/    React UI
    src/lib/         Spotify API client, player controller, lyrics, colours, state
    src/components/  Glass, player bar, Now Playing, lyrics, menus, dialogs
    src/views/       Pages
build/         App icons
scripts/       castLabs EVS signing hook
```

## Privacy

Your Spotify sign-in is stored encrypted on your computer using Windows' secure storage. Settings, including the Genius token, your profile and your listening history (`data\history.json`), stay in `%APPDATA%\Pulse Music`. Nothing is sent anywhere except Spotify, LRCLIB, Genius and your local Discord client.
