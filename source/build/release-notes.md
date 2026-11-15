## Pulse Music 1.6.5

- **No more long Spotify pauses.** Spotify blocks an app for hours when it keeps sending a lot of requests over time, and Pulse did that in the background (filling in an imported listening history sent hundreds of requests every few minutes). Now:
  - Pulse counts its requests over 10 minutes, an hour and a day, across restarts. Background work (filling in your history, the made-for-you mixes, prefetching) has small fixed limits and simply waits when it reaches them, even less while Pulse sits in the tray.
  - Everything you do yourself goes first and isn't slowed down.
  - Your history is filled in a few songs at a time, and what was already looked up is remembered.
  - The made-for-you mixes need fewer requests and aren't started over again and again when something fails.
  - Searches, songs and artists asked again within 20 minutes come from memory.
  - Pulse in the tray asks Spotify much less often what is playing.
  - After any refusal from Spotify, background work rests for two hours.
- **Skip a long pause**: if Spotify still pauses Pulse for a long time, the notice has a button to sign in with your own Spotify app, which has its own allowance, so everything works again right away.
- **Your Spotify friends on the Friends page**: connect your Spotify account once (Friends or Settings → Lyrics) and see what the people you follow on Spotify are playing, like the Friend Activity in the Spotify app. Play their song with one click. The Friends page itself got a fresh look.
- **More synced lyrics**: with your Spotify account connected, Pulse also uses Spotify's own line-by-line lyrics, and it looks harder on LRCLIB for a synced version before settling for plain text.
- **Lyrics without timings now scroll along with the song** (scroll yourself and it waits a few seconds).
- **A real turntable and CD deck**: the turntable has a strobe-dotted platter, a record with grooves and a reflection that stays put while it spins, and an S-shaped arm that drops onto the record and creeps inwards as the song plays. The CD deck is brushed aluminium with a smoked lid, a shimmering disc, a glowing display and level meters that move with the music.
- **Device sounds**: the needle dropping, vinyl crackle while it plays and the arm lifting off; the CD spinning up and down and the laser jumping between songs. Made on the spot, quiet under the music, and can be switched off in the Now Playing menu.
- **The DJ page has no frame any more**: the song's colours glow straight on the page.
- **The mix show is back to the swirl of covers** (no more box), ending in your new playlist with its songs listed.
