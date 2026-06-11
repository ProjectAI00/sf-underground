// Streaming world: Minecraft-style chunk loading over the whole city.
// Chunks (1km squares, see tools/process_sf.mjs) are fetched as the player
// moves; features register into global spatial grids used by every system.

const CELL = 64; // meters, spatial hash cell
const LOAD_RADIUS = 1200;
const MAX_CONCURRENT = 4;

function key(cx, cy) { return cx + "," + cy; }

export async function loadWorld() {
  const overview = await (await fetch("data/overview.json")).json();
  return new World(overview);
}

export class World {
  constructor(overview) {
    this.overview = overview;
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
    const arr = this.bldGrid.get(key(Math.floor(x / CELL), Math.floor(y / CELL)));
    if (!arr) return null;
    for (const b of arr) {
      const bb = b.bbox;
      if (x < bb[0] || x > bb[2] || y < bb[1] || y > bb[3]) continue;
      if (pointInPoly(b.p, x, y)) return b;
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
