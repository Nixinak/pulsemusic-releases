## Pulse Music 1.7.6

- **Fewer requests to Spotify**, so its daily limit isn't reached:
  - When Pulse can't use your Spotify account, it asks what's playing far less often: every minute instead of every 20 seconds when nothing plays, every 12 seconds instead of 5 when another device plays.
  - Party searches go through your Spotify account first and have their own hourly and daily ceiling. A party full of guests searching used to use up most of the limit.
  - The DJ doesn't make a set in advance unless it can do so for free.
  - Genre lookups wait their turn with the other background work.
  - Background work stops sooner over an hour and a day.
- **Restarts and updates**: the request count of the last seconds is saved before the app closes, and starts close together (several updates in a row) wait 10 minutes before any background work.
- **Settings → Performance → Spotify requests** shows what Pulse asked Spotify today, with Pulse's own key (counts toward the limit) and through your Spotify account (free), per kind of request. **Copy details** puts the list on the clipboard.
