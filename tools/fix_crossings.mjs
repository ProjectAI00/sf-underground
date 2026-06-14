// Snap stored crosswalks onto road centerlines (fixes sidewalk zebras).
// Run: node tools/fix_crossings.mjs

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHUNKS = join(ROOT, "data", "chunks");
const CELL = 50;

const roads = [];
for (const name of readdirSync(CHUNKS)) {
  if (!name.endsWith(".json")) continue;
  const c = JSON.parse(readFileSync(join(CHUNKS, name), "utf8"));
  for (const r of c.roads || []) roads.push(r);
}

const segGrid = new Map();
roads.forEach((r, idx) => {
  const p = r.p;
  for (let s = 0; s + 3 < p.length; s += 2) {
    const cx1 = Math.floor(Math.min(p[s], p[s + 2]) / CELL);
    const cx2 = Math.floor(Math.max(p[s], p[s + 2]) / CELL);
    const cy1 = Math.floor(Math.min(p[s + 1], p[s + 3]) / CELL);
    const cy2 = Math.floor(Math.max(p[s + 1], p[s + 3]) / CELL);
    for (let cx = cx1; cx <= cx2; cx++) {
      for (let cy = cy1; cy <= cy2; cy++) {
        const k = cx + "," + cy;
        let a = segGrid.get(k);
        if (!a) segGrid.set(k, (a = []));
        a.push([idx, s]);
      }
    }
  }
});

function nearestRoad(x, y, maxD = 28) {
  let best = null;
  const c0x = Math.floor(x / CELL), c0y = Math.floor(y / CELL);
  for (let cx = c0x - 1; cx <= c0x + 1; cx++) {
    for (let cy = c0y - 1; cy <= c0y + 1; cy++) {
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
  }
  return best;
}

let fixed = 0, dropped = 0;
for (const name of readdirSync(CHUNKS)) {
  if (!name.endsWith(".json")) continue;
  const path = join(CHUNKS, name);
  const c = JSON.parse(readFileSync(path, "utf8"));
  if (!c.crossings?.length) continue;
  const out = [];
  for (const cr of c.crossings) {
    const near = nearestRoad(cr[0], cr[1], 28);
    if (!near || near.road.r < 1 || near.d > near.road.w / 2 + 0.35) {
      dropped++;
      continue;
    }
    out.push([
      Math.round(near.cx * 10) / 10,
      Math.round(near.cy * 10) / 10,
      Math.round(Math.atan2(near.ty, near.tx) * 100) / 100,
      near.road.w,
    ]);
    fixed++;
  }
  c.crossings = out;
  writeFileSync(path, JSON.stringify(c));
}
console.log(`crossings kept=${fixed} dropped=${dropped}`);
