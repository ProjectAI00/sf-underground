// Aggregate map overlays: parks, water, sand, ocean shoreline profile.
// Run: node tools/build_map_land.mjs

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bufferPolyline, BRIDGE_ROAD } from "../src/water.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHUNKS = join(ROOT, "data", "chunks");
const OUT = join(ROOT, "data", "map_land.json");

const SHORE_CELL = 90;
const TRIM = 0.012;

function simplify(p, eps) {
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
  for (let i = 0; i < p.length / 2; i++) if (keep[i]) out.push(p[i * 2], p[i + 1]);
  return out;
}

function prepPoly(p, eps) {
  if (p.length < 6) return null; // line strings, not fillable polygons
  if (p.length <= 10) return p.map((v) => Math.round(v));
  const s = simplify(p, eps);
  return s.length >= 6 ? s.map((v) => Math.round(v)) : null;
}

function pick(sorted, q) {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * q)))];
}

function shoreRowExtents(row) {
  if (row.length < 8) return null;
  const pad = 12;
  let maxGap = 0, gapIdx = -1;
  for (let i = 0; i < row.length - 1; i++) {
    const gap = row[i + 1] - row[i];
    if (gap > maxGap) { maxGap = gap; gapIdx = i; }
  }
  if (maxGap > 600) {
    const westLand = row.slice(0, gapIdx + 1);
    const eastLand = row.slice(gapIdx + 1);
    return [
      Math.round(row[0] - pad),
      Math.round(westLand[westLand.length - 1] + pad),
      Math.round(eastLand[0] - pad),
      Math.round(row[row.length - 1] + pad),
    ];
  }
  return [Math.round(row[0] - pad), Math.round(row[row.length - 1] + pad)];
}

function buildShore(landPts) {
  const xs = landPts.map((p) => p[0]).sort((a, b) => a - b);
  const ys = landPts.map((p) => p[1]).sort((a, b) => a - b);
  const bounds = {
    minY: pick(ys, TRIM) - 220,
    maxY: pick(ys, 1 - TRIM) + 220,
  };
  const shore = [];
  const band = SHORE_CELL * 0.55;
  for (let y = bounds.minY; y < bounds.maxY; y += SHORE_CELL) {
    const row = landPts
      .filter(([x, py]) => Math.abs(py - y) < band)
      .map((p) => p[0])
      .sort((a, b) => a - b);
    const ext = shoreRowExtents(row);
    if (!ext) continue;
    shore.push([Math.round(y), ...ext]);
  }
  return shore;
}

const seen = new Set();
const parks = [], water = [], sand = [];
const landPts = [];

for (const name of readdirSync(CHUNKS)) {
  if (!name.endsWith(".json")) continue;
  const c = JSON.parse(readFileSync(join(CHUNKS, name), "utf8"));

  const addPts = (p) => { for (let i = 0; i < p.length; i += 2) landPts.push([p[i], p[i + 1]]); };
  for (const r of c.roads || []) addPts(r.p);
  for (const b of c.buildings || []) addPts(b.p);
  for (const p of c.parks || []) addPts(p);

  for (const p of c.parks || []) {
    const s = prepPoly(p, 22);
    if (!s) continue;
    const key = "p:" + s[0] + "," + s[1] + ":" + s.length;
    if (seen.has(key)) continue;
    seen.add(key);
    parks.push(s);
  }
  for (const p of c.water || []) {
    const s = prepPoly(p, 14);
    if (!s) continue;
    const key = "w:" + s[0] + "," + s[1] + ":" + s.length;
    if (seen.has(key)) continue;
    seen.add(key);
    water.push(s);
  }
  for (const p of c.sand || []) {
    const s = prepPoly(p, 16);
    if (!s) continue;
    const key = "s:" + s[0] + "," + s[1] + ":" + s.length;
    if (seen.has(key)) continue;
    seen.add(key);
    sand.push(s);
  }
}

console.log("building shoreline...");
const shore = buildShore(landPts);

console.log("buffering bridge water...");
const bridgeWater = [];
const bridgeSeen = new Set();
for (const name of readdirSync(CHUNKS)) {
  if (!name.endsWith(".json")) continue;
  const c = JSON.parse(readFileSync(join(CHUNKS, name), "utf8"));
  for (const r of c.roads || []) {
    if ((r.r || 0) < 5 || !r.n || !BRIDGE_ROAD.test(r.n)) continue;
    const key = r.n + ":" + r.p[0] + "," + r.p[1] + ":" + r.p.length;
    if (bridgeSeen.has(key)) continue;
    bridgeSeen.add(key);
    const half = /Golden Gate/.test(r.n) ? 230 : /Eisenhower/.test(r.n) ? 170 : 130;
    for (const quad of bufferPolyline(r.p, half)) {
      bridgeWater.push(quad.map((v) => Math.round(v * 10) / 10));
    }
  }
}

writeFileSync(OUT, JSON.stringify({ parks, water, sand, shore, bridgeWater }));
const bytes = readFileSync(OUT).length;
console.log(
  `map_land.json  parks=${parks.length}  water=${water.length}  sand=${sand.length}` +
  `  shoreRows=${shore.length}  bridgeQuads=${bridgeWater.length}  (${(bytes / 1e6).toFixed(2)} MB)`,
);
