# Deploy Retro Racer SF (Vercel — Option A)

Static game (~40 MB deploy). No build step.

## 1. New Vercel project

1. [vercel.com/new](https://vercel.com/new) → Import `ProjectAI00/sf-underground` (or this repo)
2. **Framework preset:** Other (static)
3. **Root directory:** `.`
4. **Build command:** leave empty
5. **Output directory:** `.`
6. Deploy

Default URL: `https://retro-racer-sf.vercel.app` (rename project to `retro-racer-sf` in Settings → General).

## 2. Custom subdomain (recommended)

In the **game** Vercel project → Settings → Domains:

- Add `retro-racer.yourdomain.com` (or `play.yourdomain.com`)

In your DNS (same place as main site):

- `CNAME` `retro-racer` → `cname.vercel-dns.com`

## 3. Spotify redirect URI

In [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), add:

- `https://retro-racer.yourdomain.com/`
- (keep `http://127.0.0.1:8847/` for local dev)

## 4. Personal site link

On `aimar` portfolio, set env var (optional):

```bash
NEXT_PUBLIC_RETRO_RACER_URL=https://retro-racer.yourdomain.com
```

Or edit the projects entry URL directly.

## What gets deployed

- `index.html`, `src/`
- `data/chunks/`, `data/overview.json`, `data/map_land.json`

Excluded via `.vercelignore`: raw OSM, tools, dev junk (~200 MB saved).

## Multiplayer server (AWS — ~$4/mo)

Multiplayer **does** need a tiny always-on process (WebSocket). Vercel static hosting can't hold open connections. Cheapest AWS setup:

| Piece | Service | ~Cost |
|---|---|---|
| Relay | **EC2 t4g.nano** (512 MB ARM) | ~$3/mo |
| Disk | 8 GB gp3 | ~$0.80/mo |
| TLS for browser | **CloudFront** (free tier) | ~$0 at game traffic |
| **Total** | | **~$4/mo** |

No ALB ($16+/mo), no Fargate cluster, no database — just one Node process relaying positions.

### Deploy

```bash
./deploy/aws/deploy.sh          # EC2 + Elastic IP + bootstraps server
./deploy/aws/cloudfront.sh        # wss:// for Vercel (needs CloudFront IAM)
```

State saved in `deploy/aws/.state/`. Teardown: `./deploy/aws/teardown.sh`

**Current relay:** see `data/mp-endpoint.json` or `deploy/aws/.state/mp-url`

Local dev still uses `ws://localhost:8787` when the game is served from localhost.

**Protocol:** clients join a room code, send `{ type: 'state', x, y, h, v }` at ~15 Hz; server broadcasts `{ type: 'snapshot', players, roomCount }` with only drivers within 1200 m (max 100 per room).
