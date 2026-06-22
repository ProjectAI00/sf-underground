// Streaming world: Minecraft-style chunk loading over the whole city.
// Chunks (1km squares, see tools/process_sf.mjs) are fetched as the player
// moves; features register into global spatial grids used by every system.

import { loadRoadGraph } from "./road-graph.js";

const CELL = 64; // meters, spatial hash cell
const LOAD_RADIUS = 1600;
const MAX_CONCURRENT = 4;

function key(cx, cy) { return cx + "," + cy; }

export async function loadWorld() {
  const [overview, roadGraph] = await Promise.all([
    (await fetch("data/overview.json")).json(),
    loadRoadGraph(),
  ]);
  try {
    const land = await (await fetch("data/map_land.json")).json();
    overview.parks = land.parks || overview.parks || [];
    overview.water = land.water || overview.water || [];
    overview.sand = land.sand || overview.sand || [];
    overview.shore = land.shore || [];
    overview.bridgeWater = land.bridgeWater || [];
  } catch {
    overview.parks = overview.parks || [];
    overview.water = overview.water || [];
    overview.sand = overview.sand || [];
    overview.shore = overview.shore || [];
    overview.bridgeWater = overview.bridgeWater || [];
  }
  return new World(overview, roadGraph);
}

export class World {
  constructor(overview, roadGraph = null) {
    this.overview = overview;
    this.roadGraph = roadGraph;
    this.chunkSize = overview.chunk || 1000;
    this.circuits = overview.circuits || [];
    this.segGrid = new Map();   // cell -> [{road, si}]
    this.bldGrid = new Map();   // cell -> [building]
    this.roadsById = new Map();
    this.bldSeen = new Set();
    this.chunkState = new Map(); // "cx_cy" -> "pending" | "loaded" | "missing"
    this.pending = 0;
    this.listeners = [];
  }

  /** fn(cx, cy, chunk, newRoads, newBuildings) — fired once per loaded chunk */
  onChunk(fn) { this.listeners.push(fn); }

  /** Call every frame with the player position; streams chunks in. */
  update(x, y, radius = LOAD_RADIUS) {
    const cs = this.chunkSize;
    const cx1 = Math.floor((x - radius) / cs), cx2 = Math.floor((x + radius) / cs);
    const cy1 = Math.floor((y - radius) / cs), cy2 = Math.floor((y + radius) / cs);
    const wanted = [];
    for (let cx = cx1; cx <= cx2; cx++) {
      for (let cy = cy1; cy <= cy2; cy++) {
        const k = cx + "_" + cy;
        if (this.chunkState.has(k)) continue;
        const mx = (cx + 0.5) * cs - x, my = (cy + 0.5) * cs - y;
        wanted.push({ cx, cy, k, d2: mx * mx + my * my });
      }
    }
    if (!wanted.length) return;
    wanted.sort((a, b) => a.d2 - b.d2);
    for (const w of wanted) {
      if (this.pending >= MAX_CONCURRENT) break;
      this.#fetchChunk(w.cx, w.cy, w.k);
    }
  }

  /** True once every chunk within r of (x,y) is settled (loaded or missing). */
  ready(x, y, r = 300) {
    const cs = this.chunkSize;
    for (let cx = Math.floor((x - r) / cs); cx <= Math.floor((x + r) / cs); cx++) {
      for (let cy = Math.floor((y - r) / cs); cy <= Math.floor((y + r) / cs); cy++) {
        const s = this.chunkState.get(cx + "_" + cy);
        if (s !== "loaded" && s !== "missing") return false;
      }
    }
    return true;
  }

  /** Load ALL chunks for the full map view */
  async loadAllChunks() {
    if (this.allChunksLoaded) return;
    // All existing chunk coordinates
    const chunks = [
      [-9,-7],[-8,-8],[-8,-7],[-8,-6],[-7,-8],[-7,-7],[-7,-6],[-7,-3],[-7,-2],[-7,-1],[-7,0],[-7,1],[-7,2],[-7,3],[-7,4],[-7,5],[-7,6],
      [-6,-8],[-6,-7],[-6,-6],[-6,-3],[-6,-2],[-6,-1],[-6,0],[-6,1],[-6,2],[-6,3],[-6,4],[-6,5],[-6,6],[-6,7],
      [-5,-9],[-5,-8],[-5,-7],[-5,-3],[-5,-2],[-5,-1],[-5,0],[-5,1],[-5,2],[-5,3],[-5,4],[-5,5],[-5,6],[-5,7],
      [-4,-8],[-4,-7],[-4,-6],[-4,-5],[-4,-4],[-4,-3],[-4,-2],[-4,-1],[-4,0],[-4,1],[-4,2],[-4,3],[-4,4],[-4,5],[-4,6],[-4,7],
      [-3,-5],[-3,-4],[-3,-3],[-3,-2],[-3,-1],[-3,0],[-3,1],[-3,2],[-3,3],[-3,4],[-3,5],[-3,6],[-3,7],
      [-2,-5],[-2,-4],[-2,-3],[-2,-2],[-2,-1],[-2,0],[-2,1],[-2,2],[-2,3],[-2,4],[-2,5],[-2,6],[-2,7],
      [-1,-5],[-1,-4],[-1,-3],[-1,-2],[-1,-1],[-1,0],[-1,1],[-1,2],[-1,3],[-1,4],[-1,5],[-1,6],[-1,7],
      [0,-5],[0,-4],[0,-3],[0,-2],[0,-1],[0,0],[0,1],[0,2],[0,3],[0,4],[0,5],[0,6],[0,7],
      [1,-7],[1,-5],[1,-4],[1,-3],[1,-2],[1,-1],[1,0],[1,1],[1,2],[1,3],[1,4],[1,5],[1,6],[1,7],
      [2,-5],[2,-4],[2,-3],[2,-2],[2,-1],[2,0],[2,1],[2,2],[2,3],[2,4],[2,5],[2,6],[2,7],[2,8],
      [3,-5],[3,-4],[3,-3],[3,-2],[3,-1],[3,0],[3,1],[3,2],[3,3],[3,4],[3,5],[3,6],[3,7],[3,8],[3,9],
      [4,-5],[4,-4],[4,-3],[4,-2],[4,-1],[4,0],[4,1],[4,2],[4,3],[4,4],[4,5],[4,6],[4,7],[4,8],
      [5,-8],[5,-7],[5,-6],[5,-5],[5,-4],[5,-3],[5,-2],[5,0],[5,1],[5,2],[5,3],[5,4],[5,5],[5,6],
      [6,-7],[6,-6],[6,-5],[6,-4],[6,-3],[6,-2],[6,2],[6,3],[6,4],[6,5],[6,6],
      [7,-6],[7,-5],[7,-4],[7,-3],[7,4],[7,5],
      [8,-6],[8,-5],[8,-4],[8,-3],
      [9,-6],[9,-5],[9,-4],[9,-3],
      [10,-5],[10,-4],[10,-3]
    ];
    const promises = [];
    for (const [cx, cy] of chunks) {
      const k = cx + "_" + cy;
      if (this.chunkState.has(k)) continue;
      this.chunkState.set(k, "pending");
      promises.push(
        fetch(`data/chunks/${k}.json`)
          .then(res => res.ok ? res.json() : null)
          .then(chunk => {
            if (!chunk) { this.chunkState.set(k, "missing"); return; }
            this.chunkState.set(k, "loaded");
            this.#integrate(cx, cy, chunk);
          })
          .catch(() => this.chunkState.set(k, "missing"))
      );
    }
    await Promise.all(promises);
    this.allChunksLoaded = true;
  }

  #fetchChunk(cx, cy, k) {
    this.chunkState.set(k, "pending");
    this.pending++;
    fetch(`data/chunks/${k}.json`)
      .then((res) => (res.ok ? res.json() : null))
      .then((chunk) => {
        this.pending--;
        if (!chunk) { this.chunkState.set(k, "missing"); return; }
        this.chunkState.set(k, "loaded");
        this.#integrate(cx, cy, chunk);
      })
      .catch(() => {
        this.pending--;
        this.chunkState.delete(k); // transient error: allow retry
      });
  }

  #integrate(cx, cy, chunk) {
    const newRoads = [];
    for (const r of chunk.roads || []) {
      if (this.roadsById.has(r.id)) continue;
      this.roadsById.set(r.id, r);
      newRoads.push(r);
      const p = r.p;
      for (let si = 0; si + 3 < p.length; si += 2) {
        const gx1 = Math.floor(Math.min(p[si], p[si + 2]) / CELL), gx2 = Math.floor(Math.max(p[si], p[si + 2]) / CELL);
        const gy1 = Math.floor(Math.min(p[si + 1], p[si + 3]) / CELL), gy2 = Math.floor(Math.max(p[si + 1], p[si + 3]) / CELL);
        for (let gx = gx1; gx <= gx2; gx++) {
          for (let gy = gy1; gy <= gy2; gy++) {
            const k = key(gx, gy);
            let arr = this.segGrid.get(k);
            if (!arr) this.segGrid.set(k, (arr = []));
            arr.push({ road: r, si });
          }
        }
      }
    }

    const newBuildings = [];
    for (const b of chunk.buildings || []) {
      if (this.bldSeen.has(b.id)) continue;
      this.bldSeen.add(b.id);
      const p = b.p;
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (let i = 0; i < p.length; i += 2) {
        if (p[i] < x1) x1 = p[i];
        if (p[i] > x2) x2 = p[i];
        if (p[i + 1] < y1) y1 = p[i + 1];
        if (p[i + 1] > y2) y2 = p[i + 1];
      }
      b.bbox = [x1, y1, x2, y2];
      newBuildings.push(b);
      const gx1 = Math.floor(x1 / CELL), gx2 = Math.floor(x2 / CELL);
      const gy1 = Math.floor(y1 / CELL), gy2 = Math.floor(y2 / CELL);
      for (let gx = gx1; gx <= gx2; gx++) {
        for (let gy = gy1; gy <= gy2; gy++) {
          const k = key(gx, gy);
          let arr = this.bldGrid.get(k);
          if (!arr) this.bldGrid.set(k, (arr = []));
          arr.push(b);
        }
      }
    }

    for (const fn of this.listeners) fn(cx, cy, chunk, newRoads, newBuildings);
  }

  nearestRoad(x, y, maxR = 220) {
    const c0x = Math.floor(x / CELL), c0y = Math.floor(y / CELL);
    let best = null;
    const maxRing = Math.ceil(maxR / CELL);
    for (let ring = 0; ring <= maxRing; ring++) {
      if (best && best.d < (ring - 1) * CELL) break;
      for (let cx = c0x - ring; cx <= c0x + ring; cx++) {
        for (let cy = c0y - ring; cy <= c0y + ring; cy++) {
          if (Math.max(Math.abs(cx - c0x), Math.abs(cy - c0y)) !== ring) continue;
          const arr = this.segGrid.get(key(cx, cy));
          if (!arr) continue;
          for (const { road, si } of arr) {
            const p = road.p;
            const x1 = p[si], y1 = p[si + 1], x2 = p[si + 2], y2 = p[si + 3];
            const dx = x2 - x1, dy = y2 - y1;
            const len2 = dx * dx + dy * dy;
            let t = len2 ? ((x - x1) * dx + (y - y1) * dy) / len2 : 0;
            t = Math.max(0, Math.min(1, t));
            const px = x1 + t * dx, py = y1 + t * dy;
            const d = Math.hypot(x - px, y - py);
            if (!best || d < best.d) {
              const L = Math.sqrt(len2) || 1;
              best = { d, x: px, y: py, tx: dx / L, ty: dy / L, road };
            }
          }
        }
      }
    }
    return best;
  }

  roadsNear(x, y, r) {
    const out = [];
    const seen = new Set();
    const cx1 = Math.floor((x - r) / CELL), cx2 = Math.floor((x + r) / CELL);
    const cy1 = Math.floor((y - r) / CELL), cy2 = Math.floor((y + r) / CELL);
    for (let cx = cx1; cx <= cx2; cx++) {
      for (let cy = cy1; cy <= cy2; cy++) {
        const arr = this.segGrid.get(key(cx, cy));
        if (!arr) continue;
        for (const { road } of arr) {
          if (seen.has(road.id)) continue;
          seen.add(road.id);
          out.push(road);
        }
      }
    }
    return out;
  }

  buildingAt(x, y) {
    // Check if point is inside any building
    const arr = this.bldGrid.get(key(Math.floor(x / CELL), Math.floor(y / CELL)));
    if (!arr) return null;
    
    for (const b of arr) {
      const bb = b.bbox;
      if (x < bb[0] || x > bb[2] || y < bb[1] || y > bb[3]) continue;
      if (pointInPoly(b.p, x, y)) {
        // Point is in building - but check if we're on a road
        // Only ignore collision if actually on the road surface
        const nearRoad = this.nearestRoad(x, y, 20);
        if (nearRoad && nearRoad.d < nearRoad.road.w / 2) {
          continue; // On road surface, skip this building
        }
        return b; // Not on road, building blocks
      }
    }
    return null;
  }
}

function pointInPoly(p, x, y) {
  let inside = false;
  const n = p.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
