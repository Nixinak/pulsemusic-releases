# Pulse server

A small server that keeps the Pulse profiles people publish, so other Pulse users can see them and every Pulse user gets the Pulse badge. It is one file (`index.mjs`), needs Node 20 or newer and no packages.

- You prove who you are with your Spotify sign-in. The app sends its Spotify access token; the server asks Spotify whose it is and only lets you change your own profile. Tokens are never stored.
- Profiles are kept as one JSON file each in `/var/lib/pulse/profiles`.
- Pictures can only be uploaded images or pictures from Spotify's image servers.

## Put it on an Oracle Cloud VM (free)

### 1. Create the VM

In the Oracle Cloud console: **Compute → Instances → Create instance**.

- Image: **Ubuntu 24.04** (or 22.04).
- Shape: any *Always Free* shape (for example VM.Standard.E2.1.Micro or Ampere A1). The server needs very little.
- Add your SSH public key, then create it. Note the **public IP address**.

### 2. Open ports 80 and 443

**Networking → Virtual cloud networks →** your network **→ Security Lists → Default Security List → Add Ingress Rules**:

| Source CIDR | IP protocol | Destination port |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

(Port 80 is needed once so Caddy can get the HTTPS certificate.)

### 3. Copy the server and install it

From the `pulsemusic` folder on your PC (PowerShell):

```powershell
scp -r server ubuntu@YOUR_IP:~/pulse-server
ssh ubuntu@YOUR_IP
```

On the VM:

```bash
cd ~/pulse-server
sudo bash install.sh
```

The script installs Node 22, the server as a service (`pulse-server`), opens the VM's own firewall and sets up HTTPS with Caddy under a free name like `152-67-12-34.sslip.io`. At the end it prints the line to use in the app.

### 4. Point the app at it

Add the printed line to `.env.local` in the `pulsemusic` folder:

```
MAIN_VITE_PULSE_SERVER=https://152-67-12-34.sslip.io
```

Then `npm run dev` (or build a new release). Pulse publishes your profile and shows badges once this is set.

## Everyday things

| | |
|---|---|
| Is it running? | `systemctl status pulse-server` |
| Logs | `journalctl -u pulse-server -f` |
| Update after changing `index.mjs` | copy it over again and run `sudo bash install.sh` |
| Health check | `curl https://YOUR-NAME.sslip.io/v1/health` |
| Remove someone's profile | `sudo rm /var/lib/pulse/profiles/SPOTIFY_ID.json && sudo systemctl restart pulse-server` |
| Own domain instead of sslip.io | `sudo PULSE_DOMAIN=pulse.example.com bash install.sh` (point the domain's A record at the VM first) |

## API

| Method | Path | |
|---|---|---|
| `GET` | `/v1/health` | `{ ok, profiles }` |
| `PUT` | `/v1/me` | Publish your profile. `Authorization: Bearer <Spotify token>`, body `{ profile, snapshot, thumb }`. |
| `DELETE` | `/v1/me` | Remove your profile. Same header. |
| `GET` | `/v1/users/:spotifyId` | Someone's profile, or 404 when they don't use Pulse. |
| `POST` | `/v1/lookup` | Body `{ ids: [...] }` (up to 100). Answers which of them use Pulse. |
| `GET` | `/v1/search?q=` | Pulse users by name or @username. |

Each address may make 120 requests a minute.
