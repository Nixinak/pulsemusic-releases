# Pulse server (Cloudflare Workers)

Keeps the Pulse profiles people publish, so other Pulse users can see them and Pulse users get the Pulse badge. Runs free on Cloudflare Workers with Workers KV; nothing to maintain.

## Set up (once)

From this folder (`server-cf`) in PowerShell:

```powershell
npx wrangler login
npx wrangler kv namespace create PULSE
```

Copy the `id` it prints into `wrangler.toml` (replace `PASTE_ID_HERE`), then:

```powershell
npx wrangler deploy
```

It prints the address, like `https://pulse-server.yourname.workers.dev`. Put it into `.env.local` in the `pulsemusic` folder:

```
MAIN_VITE_PULSE_SERVER=https://pulse-server.yourname.workers.dev
```

## Later

| | |
|---|---|
| Update after changing `worker.js` | `npx wrangler deploy` |
| Live logs | `npx wrangler tail` |
| Health check | open `https://pulse-server.yourname.workers.dev/v1/health` |

The API is the same as the Oracle version in `server/README.md`. Free plan limits (100,000 requests and 1,000 profile saves a day) are far above what a group of friends uses.
