// Whole-SF processor: raw Overpass dumps -> 1km chunk files + overview.json.
// Run: node --max-old-space-size=8192 tools/process_sf.mjs
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW = join(ROOT, "data", "raw");
const OUT = join(ROOT, "data", "chunks");

const LAT0 = 37.7695, LON0 = -122.4375;
const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const CHUNK = 1000; // meters
const MAX_WAY_LEN = 600; // chop long roads to limit chunk duplication

const px = (lon) => Math.round((lon - LON0) * M_PER_DEG_LON * 10) / 10;
const py = (lat) => Math.round((LAT0 - lat) * M_PER_DEG_LAT * 10) / 10;

const ROAD_W = {
  motorway: 22, trunk: 20, primary: 17, secondary: 14, tertiary: 12,
  residential: 9.5, unclassified: 9, living_street: 7.5,
  motorway_link: 10, trunk_link: 10, primary_link: 9, secondary_link: 9, tertiary_link: 9,
};
const ROAD_RANK = {
  motorway: 5, trunk: 5, motorway_link: 4, trunk_link: 4,
  primary: 4, primary_link: 3, secondary: 3, secondary_link: 2,
  tertiary: 2, tertiary_link: 1, residential: 1, unclassified: 1, living_street: 0,
};

function loadRaw(name) {
  return JSON.parse(readFileSync(join(RAW, name + ".json"), "utf8")).elements;
}
function projectWay(el) {
  const p = [];
  for (const g of el.geometry) p.push(px(g.lon), py(g.lat));
  return p;
}
function polyLen(p) {
  let L = 0;
  for (let i = 0; i + 3 < p.length; i += 2) L += Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
  return L;
}

// ---------- roads ----------
console.log("roads...");
const fullRoads = []; // un-chopped, for circuit resolution
const roads = [];     // chopped, chunked
let rid = 0;
for (const el of loadRaw("roads")) {
  if (el.type !== "way" || !el.geometry) continue;
  const hw = el.tags?.highway;
  if (!ROAD_W[hw]) continue;
  const p = projectWay(el);
  if (p.length < 4) continue;
  const base = {
    w: ROAD_W[hw], r: ROAD_RANK[hw], n: el.tags.name || "",
    ow: el.tags.oneway === "yes" ? 1 : 0,
  };
  fullRoads.push({ ...base, p });
  // chop
  let cur = [p[0], p[1]], acc = 0;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const seg = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
    cur.push(p[i + 2], p[i + 3]);
    acc += seg;
    if (acc >= MAX_WAY_LEN) {
      roads.push({ id: rid++, ...base, p: cur });
      cur = [p[i + 2], p[i + 3]];
      acc = 0;
    }
  }
  if (cur.length >= 4) roads.push({ id: rid++, ...base, p: cur });
}
console.log(`  ${roads.length} road pieces (${fullRoads.length} ways)`);

// segment grid for nearest-road lookups (signals/crossings placement)
const segGrid = new Map();
const SEG_CELL = 50;
roads.forEach((r, idx) => {
  const p = r.p;
  for (let s = 0; s + 3 < p.length; s += 2) {
    const cx1 = Math.floor(Math.min(p[s], p[s + 2]) / SEG_CELL), cx2 = Math.floor(Math.max(p[s], p[s + 2]) / SEG_CELL);
    const cy1 = Math.floor(Math.min(p[s + 1], p[s + 3]) / SEG_CELL), cy2 = Math.floor(Math.max(p[s + 1], p[s + 3]) / SEG_CELL);
    for (let cx = cx1; cx <= cx2; cx++) for (let cy = cy1; cy <= cy2; cy++) {
      const k = cx + "," + cy;
      let a = segGrid.get(k);
      if (!a) segGrid.set(k, (a = []));
      a.push([idx, s]);
    }
  }
});
function nearestRoad(x, y, maxD = 25) {
  let best = null;
  const c0x = Math.floor(x / SEG_CELL), c0y = Math.floor(y / SEG_CELL);
  for (let cx = c0x - 1; cx <= c0x + 1; cx++) for (let cy = c0y - 1; cy <= c0y + 1; cy++) {
    const a = segGrid.get(cx + "," + cy);
    if (!a) continue;
    for (const [idx, s] of a) {
      const p = roads[idx].p;
      const x1 = p[s], y1 = p[s + 1], x2 = p[s + 2], y2 = p[s + 3];
      const dx = x2 - x1, dy = y2 - y1;
      const len2 = dx * dx + dy * dy;
      let t = len2 ? ((x - x1) * dx + (y - y1) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const cxp = x1 + t * dx, cyp = y1 + t * dy;
      const d = Math.hypot(x - cxp, y - cyp);
      if (d <= maxD && (!best || d < best.d)) {
        const L = Math.sqrt(len2) || 1;
        best = { d, cx: cxp, cy: cyp, road: roads[idx], tx: dx / L, ty: dy / L };
      }
    }
  }
  return best;
}

// ---------- land ----------
console.log("land...");
const parks = [], water = [], sand = [];
for (const el of loadRaw("land")) {
  if (el.type !== "way" || !el.geometry) continue;
  const t = el.tags || {};
  const p = projectWay(el);
  if (p.length < 6) continue;
  if (t.natural === "water") water.push(p);
  else if (t.natural === "sand" || t.natural === "beach") sand.push(p);
  else parks.push(p);
}
console.log(`  parks=${parks.length} water=${water.length} sand=${sand.length}`);

// ---------- buildings ----------
console.log("buildings...");

function pointInPoly(p, x, y) {
  let inside = false;
  const n = p.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// true when the footprint covers drivable road centerline (stations, bridge
// structures, parking decks, mis-mapped blocks) — those break rendering AND
// would wall off the street, so we drop them
function coversRoad(p) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    if (p[i] < x1) x1 = p[i];
    if (p[i] > x2) x2 = p[i];
    if (p[i + 1] < y1) y1 = p[i + 1];
    if (p[i + 1] > y2) y2 = p[i + 1];
  }
  const seen = new Set();
  let hits = 0;
  const cx1 = Math.floor(x1 / SEG_CELL), cx2 = Math.floor(x2 / SEG_CELL);
  const cy1 = Math.floor(y1 / SEG_CELL), cy2 = Math.floor(y2 / SEG_CELL);
  for (let cx = cx1; cx <= cx2; cx++) {
    for (let cy = cy1; cy <= cy2; cy++) {
      const arr = segGrid.get(cx + "," + cy);
      if (!arr) continue;
      for (const [idx, s] of arr) {
        const key = idx * 10000 + s;
        if (seen.has(key)) continue;
        seen.add(key);
        const road = roads[idx];
        if (road.r < 1) continue;
        const q = road.p;
        const sx = q[s], sy = q[s + 1], ex = q[s + 2], ey = q[s + 3];
        const segLen = Math.hypot(ex - sx, ey - sy);
        const steps = Math.max(1, Math.ceil(segLen / 6));
        for (let k = 0; k <= steps; k++) {
          const px2 = sx + ((ex - sx) * k) / steps;
          const py2 = sy + ((ey - sy) * k) / steps;
          if (px2 < x1 || px2 > x2 || py2 < y1 || py2 > y2) continue;
          if (pointInPoly(p, px2, py2) && ++hits >= 3) return true;
        }
      }
    }
  }
  return false;
}

const buildings = [];
const seenB = new Set();
let bid = 0;
let droppedOverRoad = 0;
for (const name of ["buildings_w", "buildings_e"]) {
  for (const el of loadRaw(name)) {
    if (el.type !== "way" || !el.geometry || seenB.has(el.id)) continue;
    seenB.add(el.id);
    const p = projectWay(el);
    if (p.length < 6) continue;
    const t = el.tags || {};
    if (coversRoad(p)) { droppedOverRoad++; continue; }
    const lv = parseFloat(t["building:levels"]) || (t.building === "house" ? 2 : 2);
    const kind = /^(industrial|warehouse|hangar|retail|commercial)$/.test(t.building || "") ? 1 : 0;
    buildings.push({ id: bid++, l: Math.min(lv, 40), k: kind, p });
  }
}
console.log(`  ${buildings.length} buildings (dropped ${droppedOverRoad} spanning roads)`);

// ---------- nodes ----------
console.log("nodes...");
const signals = [], lamps = [], stops = [], crossings = [], trees = [];
for (const el of loadRaw("nodes")) {
  if (el.type !== "node") continue;
  const x = px(el.lon), y = py(el.lat);
  const t = el.tags || {};
  if (t.natural === "tree") { trees.push([x, y]); continue; }
  if (t.highway === "street_lamp") { lamps.push([x, y]); continue; }
  const near = nearestRoad(x, y, 20);
  if (t.highway === "traffic_signals" || t.highway === "stop") {
    if (!near) continue;
    // signal nodes sit on the centerline at intersections: move the pole
    // diagonally to a sidewalk corner (sideways off this road AND backwards
    // along it, clear of the cross street too)
    const w2 = near.road.w / 2;
    const sideH = ((Math.round(x * 10) + Math.round(y * 10)) & 1) * 2 - 1;
    const backH = ((Math.round(x * 10) ^ Math.round(y * 10)) & 2) - 1;
    const pole = [
      Math.round((near.cx - near.ty * (w2 + 1.6) * sideH + near.tx * (w2 + 2.2) * backH) * 10) / 10,
      Math.round((near.cy + near.tx * (w2 + 1.6) * sideH + near.ty * (w2 + 2.2) * backH) * 10) / 10,
    ];
    (t.highway === "traffic_signals" ? signals : stops).push(pole);
  } else if (t.highway === "crossing" && t.crossing !== "unmarked") {
    if (!near || near.road.r < 1) continue;
    crossings.push([x, y, Math.round(Math.atan2(near.ty, near.tx) * 100) / 100, near.road.w]);
  }
}
console.log(`  signals=${signals.length} lamps=${lamps.length} stops=${stops.length} crossings=${crossings.length} trees=${trees.length}`);

// ---------- chunking ----------
console.log("chunking...");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const chunks = new Map();
function chunkAt(cx, cy) {
  const k = cx + "_" + cy;
  let c = chunks.get(k);
  if (!c) chunks.set(k, (c = { roads: [], buildings: [], parks: [], water: [], sand: [], signals: [], lamps: [], stops: [], crossings: [], trees: [] }));
  return c;
}
function bboxOf(p) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    if (p[i] < x1) x1 = p[i];
    if (p[i] > x2) x2 = p[i];
    if (p[i + 1] < y1) y1 = p[i + 1];
    if (p[i + 1] > y2) y2 = p[i + 1];
  }
  return [x1, y1, x2, y2];
}
function addToChunks(p, pad, fn) {
  const [x1, y1, x2, y2] = bboxOf(p);
  const cx1 = Math.floor((x1 - pad) / CHUNK), cx2 = Math.floor((x2 + pad) / CHUNK);
  const cy1 = Math.floor((y1 - pad) / CHUNK), cy2 = Math.floor((y2 + pad) / CHUNK);
  for (let cx = cx1; cx <= cx2; cx++) for (let cy = cy1; cy <= cy2; cy++) fn(chunkAt(cx, cy));
}
for (const r of roads) addToChunks(r.p, r.w, (c) => c.roads.push(r));
for (const b of buildings) addToChunks(b.p, 2, (c) => c.buildings.push(b));
for (const p of parks) addToChunks(p, 2, (c) => c.parks.push(p));
for (const p of water) addToChunks(p, 2, (c) => c.water.push(p));
for (const p of sand) addToChunks(p, 2, (c) => c.sand.push(p));
const pt = (arr, key) => { for (const n of arr) { const c = chunkAt(Math.floor(n[0] / CHUNK), Math.floor(n[1] / CHUNK)); c[key].push(n); } };
pt(signals, "signals"); pt(lamps, "lamps"); pt(stops, "stops"); pt(crossings, "crossings"); pt(trees, "trees");

let totalBytes = 0;
for (const [k, c] of chunks) {
  const s = JSON.stringify(c);
  totalBytes += s.length;
  writeFileSync(join(OUT, k + ".json"), s);
}
console.log(`  ${chunks.size} chunks, ${(totalBytes / 1e6).toFixed(1)} MB total`);

// ---------- overview + circuits ----------
console.log("overview...");
function simplify(p, eps) { // Douglas-Peucker
  if (p.length <= 4) return p;
  const keep = new Uint8Array(p.length / 2);
  keep[0] = keep[p.length / 2 - 1] = 1;
  const stack = [[0, p.length / 2 - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0, maxI = -1;
    const ax = p[a * 2], ay = p[a * 2 + 1], bx = p[b * 2], by = p[b * 2 + 1];
    const dx = bx - ax, dy = by - ay;
    const L = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((p[i * 2] - ax) * dy - (p[i * 2 + 1] - ay) * dx) / L;
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxD > eps) { keep[maxI] = 1; stack.push([a, maxI], [maxI, b]); }
  }
  const out = [];
  for (let i = 0; i < p.length / 2; i++) if (keep[i]) out.push(p[i * 2], p[i * 2 + 1]);
  return out;
}

function pointAtFrac(p, frac) {
  const total = polyLen(p);
  let s = total * frac, acc = 0;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const dx = p[i + 2] - p[i], dy = p[i + 3] - p[i + 1];
    const seg = Math.hypot(dx, dy);
    if (acc + seg >= s) {
      const t = seg ? (s - acc) / seg : 0;
      const L = seg || 1;
      return { x: p[i] + dx * t, y: p[i + 1] + dy * t, tx: dx / L, ty: dy / L };
    }
    acc += seg;
  }
  return { x: p[0], y: p[1], tx: 1, ty: 0 };
}
function resolve(name, frac) {
  const matches = fullRoads.filter((r) => r.n === name);
  if (!matches.length) { console.log(`  !! street not found: ${name}`); return null; }
  let best = matches[0], bestLen = 0;
  for (const m of matches) { const L = polyLen(m.p); if (L > bestLen) { bestLen = L; best = m; } }
  const pt2 = pointAtFrac(best.p, frac);
  return { name, x: Math.round(pt2.x * 10) / 10, y: Math.round(pt2.y * 10) / 10, tx: Math.round(pt2.tx * 100) / 100, ty: Math.round(pt2.ty * 100) / 100 };
}

const CIRCUITS = [
  {
    id: "chinatown", label: "CHINATOWN SPRINT",
    cps: [["Grant Avenue", 0.5], ["Columbus Avenue", 0.5], ["Lombard Street", 0.5], ["Bay Street", 0.5], ["The Embarcadero", 0.45], ["Washington Street", 0.6], ["California Street", 0.5]],
  },
  {
    id: "grandtour", label: "GRAND TOUR",
    cps: [["Grant Avenue", 0.5], ["Lombard Street", 0.4], ["Van Ness Avenue", 0.5], ["Fell Street", 0.5], ["Haight Street", 0.5], ["Market Street", 0.45], ["The Embarcadero", 0.5]],
  },
  {
    id: "sunset", label: "SUNSET RUN",
    cps: [["Haight Street", 0.5], ["Stanyan Street", 0.5], ["Fulton Street", 0.5], ["Great Highway", 0.5], ["Sloat Boulevard", 0.5], ["Portola Drive", 0.5], ["Market Street", 0.7]],
  },
];
const circuits = CIRCUITS.map((c) => ({
  id: c.id, label: c.label,
  cps: c.cps.map(([n, f]) => resolve(n, f)).filter(Boolean),
}));

const ovRoads = [];
for (const r of fullRoads) {
  if (r.r < 1) continue;
  // simplify minor roads harder; they're only context lines on the city map
  ovRoads.push({ r: r.r, p: simplify(r.p, r.r >= 2 ? 6 : 10).map((v) => Math.round(v)) });
}
let bx1 = Infinity, by1 = Infinity, bx2 = -Infinity, by2 = -Infinity;
for (const r of ovRoads) for (let i = 0; i < r.p.length; i += 2) {
  if (r.p[i] < bx1) bx1 = r.p[i];
  if (r.p[i] > bx2) bx2 = r.p[i];
  if (r.p[i + 1] < by1) by1 = r.p[i + 1];
  if (r.p[i + 1] > by2) by2 = r.p[i + 1];
}
writeFileSync(join(ROOT, "data", "overview.json"), JSON.stringify({
  origin: { lat: LAT0, lon: LON0 },
  chunk: CHUNK,
  bounds: { minX: bx1, minY: by1, maxX: bx2, maxY: by2 },
  roads: ovRoads,
  circuits,
}));
console.log(`  overview roads=${ovRoads.length}`);
for (const c of circuits) console.log(`  circuit ${c.id}: ${c.cps.length} checkpoints`);
console.log("DONE");
