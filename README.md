# Retro Racer SF

Top-down retro street racer on the **real map of San Francisco** — the whole city, streamed in 1km chunks as you drive. Free roam solo or cruise with up to 100 drivers in a room.

**Live:** deploy to Vercel — see [DEPLOY.md](DEPLOY.md). Multiplayer needs the separate WebSocket server in `server/`.

## Run

```bash
cd sf-street-racer
python3 -m http.server 8847
# open http://localhost:8847
```

### Multiplayer (local)

In a second terminal:

```bash
cd server && npm install && npm start
# WebSocket on ws://localhost:8787
```

Two browser tabs → **MULTIPLAYER** → **CREATE ROOM** in one, **JOIN ROOM** with the same code in the other. Each client only renders drivers within ~1.2 km (traffic/peds stay local).

No build step for the game client.

## Play

1. **Driver registration**: pick a gamer tag and one of the B-tier rides —
   Porsche 944, BMW M3 '08, Tesla Model S Techbro Edition, Nissan GT-R R34.
   Five stats: SPEED / ACCEL / BRAKES / CORNER / **AURA**.
2. **Main menu**: **FREE ROAM** (solo) or **MULTIPLAYER** (create/join room code).

| Key | Action |
|---|---|
| Arrows / WASD | drive |
| Space | handbrake — drift |
| Esc | pause menu |
| C | camera rotation toggle |
| R | reset to nearest road |
| N | cycle time of day (debug) |
| F | FPS meter |

## Features

- **2.5D city**: GTA2-style parallax building extrusion, sun-shaded walls,
  real building heights. 120fps (vsync) with chunk streaming.
- **Day/night synced to real SF time** (Pacific): dusk tints, lamp glow pools,
  headlights on every car.
- **Living streets**: wandering traffic that navigates the actual road graph
  across the whole city, pedestrians who flee, parked cars you can shove,
  street lamps and stop signs you can flatten, traffic signals on real
  OSM-mapped corners.
- **Drift physics**: handbrake kicks the rear out, tire smoke, skid marks,
  crash sparks, burnouts, brake lights.
- **3 circuits** (time trial data still in `src/race.js`; menu focuses on roam/multiplayer for now).
- **Multiplayer**: room codes, up to 100 drivers, nearby-only sync (~1.2 km), nametags, interpolated ghosts.
- **Full city map** (click the radar or press **M**): pan, zoom, and click to
  set a Google-Maps-style waypoint — amber guidance arrow + radar blip in-game.
- **RADIO** (top bar — **Q** next station, **Shift+Q** prev, swipe on mobile, **-/=** volume):
  - **SomaFM** streams — no login, scales to any player count.
  - **Spotify stations** — your playlist + podcast channels in `data/radio-stations.json`.
    Each player connects their own Premium account (PKCE, no shared server).
    ~3 API calls only when you change station; audio streams from Spotify CDN.

## Rebuilding the map

```bash
bash tools/fetch_sf.sh                         # ~200MB raw OSM via Overpass
node --max-old-space-size=8192 tools/process_sf.mjs   # -> data/chunks/*.json + overview.json
```

Change the bbox in `tools/fetch_sf.sh` + origin in `tools/process_sf.mjs` to
port the game to any city.

## Architecture

- `src/world.js` — chunk streaming + spatial hash grids (roads, buildings).
- `src/render.js` — tile-cached ground/roads renderer + per-frame 2.5D buildings.
- `src/car.js`, `src/cars.js` — arcade physics, stats, pixel-art car sprites.
- `src/traffic.js`, `src/peds.js`, `src/props.js` — city life.
- `src/multiplayer.js`, `src/remote-players.js`, `server/` — WebSocket rooms + nearby player sync.
- `src/race.js`, `src/radar.js`, `src/menu.js`, `src/lobby.js`, `src/daynight.js` — game flow.

Map data © OpenStreetMap contributors, ODbL.
