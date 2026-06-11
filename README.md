# SF UNDERGROUND

Top-down retro street racer (GTA Chinatown Wars vibes) on the **real map of San
Francisco** — the whole city, streamed in 1km chunks Minecraft-style as you
drive. Roads, buildings (with real floor counts), parks, trees, crosswalks,
traffic signals and lamps all come from OpenStreetMap.

## Run

```bash
cd sf-street-racer
python3 -m http.server 8847
# open http://localhost:8847
```

No build step, no dependencies.

## Play

1. **Driver registration**: pick a gamer tag and one of the B-tier rides —
   Porsche 944, BMW M3 '08, Tesla Model S Techbro Edition, Nissan GT-R R34.
   Five stats: SPEED / ACCEL / BRAKES / CORNER / **AURA**.
2. Pick a race (3 circuits over real streets) or free roam.

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
- **3 circuits**: Chinatown Sprint, Grand Tour, Sunset Run — checkpoints on
  real streets, best times saved per circuit.
- **CAMPAIGN — 10 races against tech**: climb from THE INTERN through PG,
  Jensen, Elon… to the final boss: **Sam Altman in his red McLaren F1**.
  AI rivals race the same circuits (road-following, corner braking, light
  rubber-banding). Win to unlock the next race.
- **Full city map** (click the radar or press **M**): pan, zoom, and click to
  set a Google-Maps-style waypoint — amber guidance arrow + radar blip in-game.
- **RADIO** (top of screen, **Q** to change station, **-/=** volume): five
  built-in stations (SomaFM: Underground 80s, Groove Salad, DEF CON, Secret
  Agent, Metal) plus a **Spotify** station — connect your Premium account
  (one-time Client ID setup, instructions in-game) and the game becomes a
  Spotify Connect device: cast any playlist or podcast to "SF UNDERGROUND
  RADIO" from your phone, track info shows in the HUD.

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
- `src/race.js`, `src/radar.js`, `src/menu.js`, `src/lobby.js`, `src/daynight.js` — game flow.

Map data © OpenStreetMap contributors, ODbL.
