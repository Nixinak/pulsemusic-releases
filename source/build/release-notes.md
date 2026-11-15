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
