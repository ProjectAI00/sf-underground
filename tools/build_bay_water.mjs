// Build SF Bay water polygon from coastline data
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const LAT0 = 37.7695, LON0 = -122.4375;
const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180);

const px = (lon) => Math.round((lon - LON0) * M_PER_DEG_LON);
const py = (lat) => Math.round((LAT0 - lat) * M_PER_DEG_LAT);

// Load coastline data
const water = JSON.parse(readFileSync(join(ROOT, "data/raw/water_full.json"), "utf8"));
const coastWays = water.elements.filter(e => e.tags?.natural === "coastline");

console.log(`Processing ${coastWays.length} coastline segments...`);

// Convert to game coordinates and collect all points
const segments = [];
for (const way of coastWays) {
  const pts = [];
  for (const g of way.geometry || []) {
    pts.push([px(g.lon), py(g.lat)]);
  }
  if (pts.length >= 2) segments.push(pts);
}

// Build connected coastline by joining segments at endpoints
function joinSegments(segs) {
  const chains = [];
  const used = new Set();
  
  for (let i = 0; i < segs.length; i++) {
    if (used.has(i)) continue;
    
    let chain = [...segs[i]];
    used.add(i);
    
    let changed = true;
    while (changed) {
      changed = false;
      for (let j = 0; j < segs.length; j++) {
        if (used.has(j)) continue;
        const seg = segs[j];
        const chainStart = chain[0];
        const chainEnd = chain[chain.length - 1];
        const segStart = seg[0];
        const segEnd = seg[seg.length - 1];
        const thresh = 50; // meters tolerance
        
        // Check if segment connects to chain end
        if (Math.hypot(chainEnd[0] - segStart[0], chainEnd[1] - segStart[1]) < thresh) {
          chain.push(...seg.slice(1));
          used.add(j);
          changed = true;
        } else if (Math.hypot(chainEnd[0] - segEnd[0], chainEnd[1] - segEnd[1]) < thresh) {
          chain.push(...seg.slice(0, -1).reverse());
          used.add(j);
          changed = true;
        } else if (Math.hypot(chainStart[0] - segEnd[0], chainStart[1] - segEnd[1]) < thresh) {
          chain.unshift(...seg.slice(0, -1));
          used.add(j);
          changed = true;
        } else if (Math.hypot(chainStart[0] - segStart[0], chainStart[1] - segStart[1]) < thresh) {
          chain.unshift(...seg.slice(1).reverse());
          used.add(j);
          changed = true;
        }
      }
    }
    chains.push(chain);
  }
  return chains;
}

const chains = joinSegments(segments);
console.log(`Joined into ${chains.length} coastline chains`);

// Find the main SF coastline (longest chain in our area)
const mainChain = chains.reduce((a, b) => a.length > b.length ? a : b);
console.log(`Main coastline has ${mainChain.length} points`);

// Create water polygon: coastline + far ocean boundary
// The coastline runs roughly SW to NE, water is to the north/east
const bayPoly = [];

// Add coastline points (only those in our game area)
const filtered = mainChain.filter(([x, y]) => 
  x > -5000 && x < 5000 && y > -6000 && y < 3000
);
console.log(`Filtered to ${filtered.length} points in game area`);

// Sort by Y then X to get proper order
// For SF, the coastline goes from south (Candlestick) north to Marina, then west to GG
for (const pt of filtered) {
  bayPoly.push(pt);
}

// Close the polygon with ocean boundary (far north and east)
if (bayPoly.length > 0) {
  const first = bayPoly[0];
  const last = bayPoly[bayPoly.length - 1];
  
  // Add corners to close via ocean
  bayPoly.push([last[0], -6000]);  // go north
  bayPoly.push([5000, -6000]);     // NE corner
  bayPoly.push([5000, first[1]]);  // go south
  // connects back to first point
}

// Flatten to [x1,y1,x2,y2,...] format
const flat = [];
for (const [x, y] of bayPoly) {
  flat.push(x, y);
}

// Simplify by removing collinear points
function simplifyPoly(pts, eps = 5) {
  if (pts.length <= 6) return pts;
  const out = [pts[0], pts[1]];
  for (let i = 2; i < pts.length - 2; i += 2) {
    const x0 = out[out.length - 2], y0 = out[out.length - 1];
    const x1 = pts[i], y1 = pts[i + 1];
    const x2 = pts[i + 2], y2 = pts[i + 3];
    // Check if middle point is on line
    const dx = x2 - x0, dy = y2 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const dist = Math.abs((x1 - x0) * dy - (y1 - y0) * dx) / len;
    if (dist > eps) {
      out.push(x1, y1);
    }
  }
  out.push(pts[pts.length - 2], pts[pts.length - 1]);
  return out;
}

const simplified = simplifyPoly(flat, 10);
console.log(`Simplified from ${flat.length / 2} to ${simplified.length / 2} points`);

// Write output
const output = { bayWater: [simplified] };
writeFileSync(join(ROOT, "data/bay_water.json"), JSON.stringify(output));
console.log("Wrote data/bay_water.json");
