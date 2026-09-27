# SF Street Racer 3D (Godot prototype)

One real San Francisco area (Rincon Hill: Salesforce Tower, the elevated I-80 Bay Bridge
approach) generated from open data and playable in Godot 4.5.

## Run

Open this folder in Godot 4.5+ and press Play, or:

```bash
godot --path godot
```

| Key | Action |
|---|---|
| WASD / arrows | drive |
| Space | handbrake |
| C | camera: top-down / chase / orbit |
| Mouse wheel | top-down zoom |
| N | day / night |
| P | retro pixel filter |
| T | autopilot along the street |
| R | reset car |

## Regenerate the world

```bash
pip install -r worldgen/requirements.txt
python worldgen/fetch.py rincon   # OSM (Overpass) + USGS 3DEP 1 m elevation -> worldgen/cache/
python worldgen/build.py rincon   # -> godot/world/rincon.{glb,json} + rincon_ground.jpg  (~7 s)
```

Add areas in `worldgen/areas.py` (any bbox in the US has 1 m elevation; elsewhere swap in
Copernicus GLO-30).

## What the compiler produces

- `ground_road` / `ground_block`: terrain-draped road surface and raised (15 cm) blocks with
  kerb walls, textured by a painted ground map (lanes, double yellows, crosswalks, stop lines,
  curbs, parks, plazas).
- `buildings` / `roofs` / `roof_props`: OSM footprints and building parts extruded to real
  heights, parapets, mechanical penthouses, AC units, water tanks, solar panels. Facades are
  procedural (`shaders/building.gdshader`) with lit windows at night.
- `bridge_deck` / `bridge_struct`: elevated roads built from OSM `bridge`/`layer` tags, with
  heights solved over the bridge graph (ramps capped at 7.5 % grade), barriers and pillars.
- Trees (MultiMesh instances), street lamps, spawn point and demo drive paths in the JSON.

All driving surfaces get trimesh collision, so ramps, overpasses and kerbs are physical.

## Validate headlessly

```bash
godot --path godot --rendering-method gl_compatibility -- --shots=/tmp/shots      # 9 PNG views
godot --path godot --write-movie /tmp/demo.avi --fixed-fps 24 -- --demo           # 45 s fly-through
```
