// Tile-cached ground + per-frame 2.5D buildings, chunk-streaming aware.
//
// Ground (lots, yards, parks, water, roads, markings, crosswalks, trees) is rasterized
// into cached 256px tiles. Buildings are drawn every frame as extruded prisms whose tops
// lean away from the camera (GTA1/2 / Chinatown Wars parallax); each roof is a baked
// sprite from the roof kit (src/art). Only tiles and buildings that intersect the
// rotated view rectangle are drawn, and new tiles/roofs are baked on a per-frame budget.

import { elevationNorm, drawHillWash, elevOffset } from "./terrain.js";
import { GROUND, FACADES, INK, SHADOW, SUN, hash32, neighborhood, isLeafy, shade } from "./art/style.js";
import { RoofBaker } from "./art/roofs.js";
import { drawTree } from "./art/trees.js";

const TILE_PX = 256;
const TILE_SCALE = 4;
const TILE_M = TILE_PX / TILE_SCALE;
const TILE_BLEED_M = 1.5;
const MAX_TILES = 800;
const CELL = 64;                  // must match world.js grid cell
const TILE_BUDGET = 6;            // new ground tiles rendered per frame
const ROOF_BUDGET = 10;           // new roof sprites baked per frame
const STREET_TREE_SPACING = 11;

const PAL = { water: GROUND.water, asphalt: GROUND.asphaltMajor, park: GROUND.park };

const LEAN_PER_LEVEL = 0.017;
const MAX_LEAN = 0.11;

function polySign(p) {
  let a = 0;
  for (let i = 0, n = p.length; i < n; i += 2) {
    const j = (i + 2) % n;
    a += p[i] * p[j + 1] - p[j] * p[i + 1];
  }
  return a >= 0 ? 1 : -1;
}

function pointInPoly(p, x, y) {
  let c = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    if ((p[i + 1] > y) !== (p[j + 1] > y) &&
        x < ((p[j] - p[i]) * (y - p[i + 1])) / (p[j + 1] - p[i + 1]) + p[i]) c = !c;
  }
  return c;
}

/** Separating-axis test: axis-aligned rect vs the (convex) view quad. */
function rectInView(v, x1, y1, x2, y2) {
  if (x2 < v.x1 || x1 > v.x2 || y2 < v.y1 || y1 > v.y2) return false;
  for (const [ax, ay] of v.axes) {
    let rmin = Infinity, rmax = -Infinity;
    for (const [cx, cy] of [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]) {
      const d = cx * ax + cy * ay;
      if (d < rmin) rmin = d;
      if (d > rmax) rmax = d;
    }
    let qmin = Infinity, qmax = -Infinity;
    for (const [qx, qy] of v.quad) {
      const d = qx * ax + qy * ay;
      if (d < qmin) qmin = d;
      if (d > qmax) qmax = d;
    }
    if (rmax < qmin || rmin > qmax) return false;
  }
  return true;
}

let GRAIN = null;
function grainCanvas() {
  if (GRAIN) return GRAIN;
  GRAIN = document.createElement("canvas");
  GRAIN.width = GRAIN.height = 128;
  const g = GRAIN.getContext("2d");
  const img = g.createImageData(128, 128);
  let s = 12345;
  for (let i = 0; i < img.data.length; i += 4) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const v = s % 100;
    const dark = v < 7, light = v > 94;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = light ? 255 : 20;
    img.data[i + 3] = dark || light ? 26 : 0;
  }
  g.putImageData(img, 0, 0);
  return GRAIN;
}

export class Renderer {
  constructor(world, canvas) {
    this.world = world;
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.tiles = new Map();
    this.frame = 0;
    this.roadBuckets = new Map();  // tile key -> Set<road>
    this.polyBuckets = new Map();  // tile key -> Set<{t, p}>
    this.dotBuckets = new Map();   // tile key -> { t: trees, c: crossings }
    this.bldStyle = new Map();     // building id -> colours
    this.roofs = new RoofBaker(6);
    this.bayWater = [];
    fetch("data/bay_water.json").then(r => r.json()).then(d => {
      this.bayWater = d.bayWater || [];
      this.tiles.clear();
    }).catch(() => {});

    world.onChunk((cx, cy, chunk, newRoads, newBuildings) => {
      this.#addChunk(cx, cy, chunk, newRoads, newBuildings);
    });
  }

  #addChunk(cx, cy, chunk, newRoads, newBuildings) {
    for (const r of newRoads) this.#bucketLine(r);
    for (const b of newBuildings) {
      const bb = b.bbox;
      const bcx = (bb[0] + bb[2]) / 2;
      const bcy = (bb[1] + bb[3]) / 2;
      // Golden Gate Bridge approach has stray footprints on the deck
      if (bcx > -4000 && bcx < 500 && bcy < -3800 && bcy > -7000) continue;
      const nearRoad = this.world.nearestRoad(bcx, bcy, 20);
      if (nearRoad && nearRoad.d < nearRoad.road.w / 2 + 2 && nearRoad.road.r >= 2) continue;

      const pal = FACADES[neighborhood(bcx, bcy)];
      const facade = pal[(hash32(b.id) >>> 3) % pal.length];
      this.bldStyle.set(b.id, {
        roof: shade(facade, 0.9),
        walls: [shade(facade, 0.6), shade(facade, 0.72), shade(facade, 0.86), shade(facade, 0.98)],
        sign: polySign(b.p),
      });
    }
    for (const b of newBuildings) this.#bucketPoly({ t: "d", p: b.p });
    for (const p of chunk.parks || []) this.#bucketPoly({ t: "p", p });
    for (const p of chunk.water || []) this.#bucketPoly({ t: "w", p });
    for (const p of chunk.sand || []) this.#bucketPoly({ t: "s", p });
    for (const p of chunk.parking || []) this.#bucketPoly({ t: "parking", p });
    for (const p of chunk.piers || []) this.#bucketPoly({ t: "pier", p });
    for (const p of chunk.plazas || []) this.#bucketPoly({ t: "plaza", p });
    for (const r of chunk.railways || []) this.#bucketLine({ ...r, isRail: true, w: 3, r: 0 });
    for (const tr of chunk.trees || []) this.#bucketDot("t", tr, 5);

    const processed = [];
    for (const cr of chunk.crossings || []) {
      const fixed = this.#snapCrossing(cr);
      if (!fixed) continue;
      if (processed.some((e) => (fixed[0] - e[0]) ** 2 + (fixed[1] - e[1]) ** 2 < 100)) continue;
      processed.push(fixed);
      this.#bucketDot("c", fixed, fixed[3]);
    }

    const cs = this.world.chunkSize;
    const tx1 = Math.floor((cx * cs - 8) / TILE_M), tx2 = Math.floor(((cx + 1) * cs + 8) / TILE_M);
    const ty1 = Math.floor((cy * cs - 8) / TILE_M), ty2 = Math.floor(((cy + 1) * cs + 8) / TILE_M);
    for (let tx = tx1; tx <= tx2; tx++) {
      for (let ty = ty1; ty <= ty2; ty++) this.tiles.delete(tx + "," + ty);
    }
  }

  #snapCrossing(cr) {
    const near = this.world.nearestRoad(cr[0], cr[1], 28);
    if (!near || near.road.r < 1) return null;
    if (near.d > near.road.w / 2 + 0.35) return null;
    return [near.x, near.y, Math.atan2(near.ty, near.tx), near.road.w];
  }

  #bucketLine(r) {
    const pad = r.w / 2 + 8;
    const p = r.p;
    for (let s = 0; s + 3 < p.length; s += 2) {
      const x1 = Math.min(p[s], p[s + 2]) - pad, x2 = Math.max(p[s], p[s + 2]) + pad;
      const y1 = Math.min(p[s + 1], p[s + 3]) - pad, y2 = Math.max(p[s + 1], p[s + 3]) + pad;
      this.#addRange(this.roadBuckets, x1, y1, x2, y2, r);
    }
  }

  #bucketPoly(val) {
    const p = val.p;
    if (!p || p.length < 6) return;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (let i = 0; i < p.length; i += 2) {
      x1 = Math.min(x1, p[i]); x2 = Math.max(x2, p[i]);
      y1 = Math.min(y1, p[i + 1]); y2 = Math.max(y2, p[i + 1]);
    }
    this.#addRange(this.polyBuckets, x1 - 6, y1 - 6, x2 + 6, y2 + 6, val);
  }

  #bucketDot(t, d, pad) {
    const tx1 = Math.floor((d[0] - pad) / TILE_M), tx2 = Math.floor((d[0] + pad) / TILE_M);
    const ty1 = Math.floor((d[1] - pad) / TILE_M), ty2 = Math.floor((d[1] + pad) / TILE_M);
    for (let tx = tx1; tx <= tx2; tx++) {
      for (let ty = ty1; ty <= ty2; ty++) {
        const k = tx + "," + ty;
        let e = this.dotBuckets.get(k);
        if (!e) this.dotBuckets.set(k, (e = { t: [], c: [] }));
        e[t].push(d);
      }
    }
  }

  #addRange(buckets, x1, y1, x2, y2, val) {
    const tx1 = Math.floor(x1 / TILE_M), tx2 = Math.floor(x2 / TILE_M);
    const ty1 = Math.floor(y1 / TILE_M), ty2 = Math.floor(y2 / TILE_M);
    for (let tx = tx1; tx <= tx2; tx++) {
      for (let ty = ty1; ty <= ty2; ty++) {
        const k = tx + "," + ty;
        let set = buckets.get(k);
        if (!set) buckets.set(k, (set = new Set()));
        set.add(val);
      }
    }
  }

  // ------------------------------------------------------------------ ground tiles

  #renderTile(tx, ty) {
    const bleed = TILE_BLEED_M;
    const span = TILE_M + bleed * 2;
    const c = document.createElement("canvas");
    c.width = Math.round(span * TILE_SCALE);
    c.height = Math.round(span * TILE_SCALE);
    const g = c.getContext("2d");
    const ox = tx * TILE_M - bleed, oy = ty * TILE_M - bleed;
    g.scale(TILE_SCALE, TILE_SCALE);
    g.translate(-ox, -oy);

    const k = tx + "," + ty;
    const polys = this.polyBuckets.get(k);
    const roadSet = this.roadBuckets.get(k);
    const dots = this.dotBuckets.get(k);
    const leafy = isLeafy(neighborhood(ox + span / 2, oy + span / 2));
    const bounds = [ox - 5, oy - 5, ox + span + 5, oy + span + 5];
    const buildings = polys ? [...polys].filter((v) => v.t === "d") : [];

    g.fillStyle = leafy ? GROUND.yard : GROUND.concrete;
    g.fillRect(ox, oy, span, span);
    drawHillWash(g, ox, oy, ox + span, oy + span, 96, "game");

    if (this.bayWater?.length) {
      for (const poly of this.bayWater) this.#fillPoly(g, poly, GROUND.water, null);
    }

    if (polys) {
      for (const v of buildings) this.#fillPoly(g, v.p, GROUND.concreteDark, null);
      for (const v of polys) if (v.t === "plaza") this.#fillPoly(g, v.p, GROUND.plaza, null);
      for (const v of polys) if (v.t === "p") this.#fillPoly(g, v.p, GROUND.park, GROUND.parkDark);
      for (const v of polys) if (v.t === "s") this.#fillPoly(g, v.p, GROUND.sand, null);
      for (const v of polys) if (v.t === "parking") this.#parkingLot(g, v.p);
      for (const v of polys) if (v.t === "pier") this.#fillPoly(g, v.p, GROUND.pier, GROUND.pierEdge);
      for (const v of polys) if (v.t === "w") this.#fillPoly(g, v.p, GROUND.water, GROUND.waterDeep);
    }

    const roads = roadSet ? [...roadSet].filter((r) => !r.isRail).sort((a, b) => a.r - b.r) : [];
    const rails = roadSet ? [...roadSet].filter((r) => r.isRail) : [];
    g.lineCap = "round";
    g.lineJoin = "round";
    for (const r of rails) {
      this.#strokeRoad(g, r.p, 3.2, GROUND.railTie);
      g.setLineDash([0.35, 0.55]);
      this.#strokeRoad(g, r.p, 2.6, GROUND.rail);
      g.setLineDash([]);
    }
    for (const r of roads) {
      const gg = r.n && /golden gate bridge/i.test(r.n);
      this.#strokeRoad(g, r.p, r.w + 5.4, gg ? "#d0503f" : GROUND.sidewalk);
    }
    for (const r of roads) this.#strokeRoad(g, r.p, r.w + 1.0, GROUND.curb);
    for (const r of roads) this.#strokeRoad(g, r.p, r.w + 0.35, GROUND.gutter);
    for (const r of roads) {
      const base = r.tu ? GROUND.asphaltTunnel : r.r >= 2 ? GROUND.asphaltMajor : GROUND.asphalt;
      this.#strokeRoad(g, r.p, r.w, r.tu ? base : this.#asphaltColor(r.p, base));
    }
    this.#markings(g, roads);

    if (dots) {
      g.fillStyle = GROUND.zebra;
      for (const [x, y, a, w] of dots.c) {
        g.save();
        g.translate(x, y);
        g.rotate(a);
        const half = w / 2 - 0.5;
        for (let off = -half; off <= half; off += 1.2) g.fillRect(-1.6, off - 0.35, 3.2, 0.7);
        g.restore();
      }
    }

    this.#trees(g, roads, polys, buildings, dots, bounds);

    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = g.createPattern(grainCanvas(), "repeat");
    g.fillRect(0, 0, c.width, c.height);
    g.restore();
    return c;
  }

  /** Parking lot with stall rows aligned to the lot's longest edge. */
  #parkingLot(g, p) {
    if (!p || p.length < 6) return;
    this.#fillPoly(g, p, GROUND.parking, GROUND.curb);
    let best = 0, ang = 0, x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (let i = 0, n = p.length; i < n; i += 2) {
      const j = (i + 2) % n;
      const dx = p[j] - p[i], dy = p[j + 1] - p[i + 1];
      if (dx * dx + dy * dy > best) { best = dx * dx + dy * dy; ang = Math.atan2(dy, dx); }
      x1 = Math.min(x1, p[i]); x2 = Math.max(x2, p[i]);
      y1 = Math.min(y1, p[i + 1]); y2 = Math.max(y2, p[i + 1]);
    }
    const ext = Math.hypot(x2 - x1, y2 - y1) / 2;
    g.save();
    g.beginPath();
    this.#path(g, p);
    g.closePath();
    g.clip();
    g.translate((x1 + x2) / 2, (y1 + y2) / 2);
    g.rotate(ang);
    g.strokeStyle = GROUND.parkingLine;
    g.lineWidth = 0.15;
    g.beginPath();
    // rows: 5m stalls either side of a 6m aisle, 2.6m wide
    for (let v = -ext; v < ext; v += 16) {
      for (let u = -ext; u < ext; u += 2.6) {
        g.moveTo(u, v); g.lineTo(u, v + 5);
        g.moveTo(u, v + 11); g.lineTo(u, v + 16);
      }
    }
    g.stroke();
    g.restore();
  }

  #markings(g, roads) {
    g.lineCap = "butt";
    for (const r of roads) {
      if (r.tu || r.r < 2) continue;
      g.strokeStyle = GROUND.laneYellow;
      if (r.r >= 3) {
        g.lineWidth = 0.16;
        for (const off of [-0.22, 0.22]) {
          g.beginPath();
          this.#offsetPath(g, r.p, off);
          g.stroke();
        }
      } else {
        g.lineWidth = 0.18;
        g.setLineDash([3, 3]);
        g.beginPath();
        this.#path(g, r.p);
        g.stroke();
        g.setLineDash([]);
      }
      if (r.r >= 4 || r.w >= 14) {
        g.strokeStyle = GROUND.laneWhite;
        g.lineWidth = 0.15;
        g.setLineDash([3, 6]);
        for (const off of [-r.w * 0.25, r.w * 0.25]) {
          g.beginPath();
          this.#offsetPath(g, r.p, off);
          g.stroke();
        }
        g.setLineDash([]);
      }
    }
    g.lineCap = "round";
  }

  #trees(g, roads, polys, buildings, dots, [bx1, by1, bx2, by2]) {
    const inBounds = (x, y) => x > bx1 && x < bx2 && y > by1 && y < by2;
    const onBuilding = (x, y) => buildings.some((v) => pointInPoly(v.p, x, y));
    const stamp = (x, y, h, big) => {
      const variant = h % 23 === 0 ? 5 : h % 5;
      drawTree(g, x, y, big ? 2 + ((h >>> 5) & 1) : 1 + ((h >>> 5) & 1), variant);
    };

    if (dots) {
      for (const [x, y] of dots.t) stamp(x, y, hash32((x * 131) ^ (y * 71)), false);
    }

    for (const r of roads) {
      if (r.tu || r.br || !(r.r === 1 || r.r === 2 || r.r === 3 || r.r === 5)) continue;
      const p = r.p;
      let carry = STREET_TREE_SPACING * 0.5;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const dx = p[i + 2] - p[i], dy = p[i + 3] - p[i + 1];
        const L = Math.hypot(dx, dy);
        if (L < 0.01) continue;
        const ux = dx / L, uy = dy / L;
        for (let s = carry; s < L; s += STREET_TREE_SPACING) {
          for (const side of [-1, 1]) {
            const off = side * (r.w / 2 + 2.1);
            const x = p[i] + ux * s - uy * off, y = p[i + 1] + uy * s + ux * off;
            if (!inBounds(x, y)) continue;
            const h = hash32((Math.round(x * 4) * 73856093) ^ (Math.round(y * 4) * 19349663));
            if (h % 100 < 35) continue;
            const near = this.world.nearestRoad(x, y, 16);
            if (near && near.road !== r && near.d < near.road.w / 2 + 3) continue;
            if (onBuilding(x, y)) continue;
            stamp(x, y, h, false);
          }
        }
        carry = STREET_TREE_SPACING - ((L - carry) % STREET_TREE_SPACING);
      }
    }

    if (polys) {
      const step = 6.5;
      for (const v of polys) {
        if (v.t !== "p") continue;
        const xs = Math.floor(bx1 / step) * step, ys = Math.floor(by1 / step) * step;
        for (let gx = xs; gx < bx2; gx += step) {
          for (let gy = ys; gy < by2; gy += step) {
            const h = hash32((Math.round(gx) * 92837111) ^ (Math.round(gy) * 689287499));
            if (h % 100 < 28) continue;
            const x = gx + ((h >>> 8) % 100) / 100 * step * 0.8;
            const y = gy + ((h >>> 16) % 100) / 100 * step * 0.8;
            if (!inBounds(x, y) || !pointInPoly(v.p, x, y)) continue;
            const near = this.world.nearestRoad(x, y, 10);
            if (near && near.d < near.road.w / 2 + 2) continue;
            stamp(x, y, h, true);
          }
        }
      }
    }
  }

  #path(g, p) {
    g.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
  }

  #offsetPath(g, p, off) {
    for (let i = 0; i + 3 < p.length; i += 2) {
      const dx = p[i + 2] - p[i], dy = p[i + 3] - p[i + 1];
      const L = Math.hypot(dx, dy) || 1;
      const nx = (-dy / L) * off, ny = (dx / L) * off;
      g.moveTo(p[i] + nx, p[i + 1] + ny);
      g.lineTo(p[i + 2] + nx, p[i + 3] + ny);
    }
  }

  #strokeRoad(g, p, w, color) {
    g.lineWidth = w;
    g.strokeStyle = color;
    g.beginPath();
    this.#path(g, p);
    g.stroke();
  }

  /** Asphalt colour with subtle per-road variation, lighter on hills. */
  #asphaltColor(p, base) {
    let mx = 0, my = 0, n = 0;
    for (let i = 0; i < p.length; i += 2) { mx += p[i]; my += p[i + 1]; n++; }
    mx /= n; my /= n;
    const h = ((Math.floor(mx * 0.1) * 7) + (Math.floor(my * 0.1) * 13)) & 255;
    const en = elevationNorm(mx, my);
    return shade(base, 1 + (h / 255) * 0.08 - 0.04 + (en > 0.08 ? en * 0.12 : 0));
  }

  #fillPoly(g, p, fill, stroke) {
    if (!p || p.length < 6) return;
    g.beginPath();
    this.#path(g, p);
    g.closePath();
    g.fillStyle = fill;
    g.fill();
    if (stroke) { g.lineWidth = 0.6; g.strokeStyle = stroke; g.stroke(); }
  }

  #tile(tx, ty) {
    const k = tx + "," + ty;
    let t = this.tiles.get(k);
    if (!t) {
      if (this.tileBudget <= 0) return null;
      this.tileBudget--;
      t = { canvas: this.#renderTile(tx, ty), age: this.frame };
      this.tiles.set(k, t);
      if (this.tiles.size > MAX_TILES) this.#evict();
    }
    t.age = this.frame;
    return t.canvas;
  }

  #evict() {
    const sorted = [...this.tiles.entries()].sort((a, b) => a[1].age - b[1].age);
    const n = Math.max(1, Math.floor(sorted.length * 0.1));
    for (let i = 0; i < n; i++) this.tiles.delete(sorted[i][0]);
  }

  /** World-space quad covered by the screen, for culling. */
  #viewQuad(cam, w, h) {
    const ox = w / 2, oy = h / 2 + h * 0.12;
    const c = Math.cos(cam.rot), s = Math.sin(cam.rot);
    const quad = [[0, 0], [w, 0], [w, h], [0, h]].map(([sx, sy]) => {
      const dx = (sx - ox) / cam.zoom, dy = (sy - oy) / cam.zoom;
      return [cam.x + dx * c - dy * s, cam.y + dx * s + dy * c];
    });
    const xs = quad.map((q) => q[0]), ys = quad.map((q) => q[1]);
    return {
      quad,
      axes: [[c, s], [-s, c]],
      x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys),
    };
  }

  /** cam: {x, y, zoom (px/m), rot (radians)} */
  drawWorld(cam) {
    this.frame++;
    this.tileBudget = TILE_BUDGET;
    this.roofBudget = ROOF_BUDGET;
    const ctx = this.ctx;
    const w = ctx.canvas.width, h = ctx.canvas.height;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#1c1e26";
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(w / 2, h / 2 + h * 0.12);
    ctx.rotate(-cam.rot);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);

    this.view = this.#viewQuad(cam, w, h);
    if (cam.zoom < 1.5) {
      const rad = Math.hypot(w, h) / 2 / cam.zoom + TILE_M;
      this.#drawSimplified(ctx, cam, rad);
      return;
    }

    const v = this.view;
    const bleed = TILE_BLEED_M;
    const span = TILE_M + bleed * 2;
    const tx1 = Math.floor(v.x1 / TILE_M), tx2 = Math.floor(v.x2 / TILE_M);
    const ty1 = Math.floor(v.y1 / TILE_M), ty2 = Math.floor(v.y2 / TILE_M);
    // nearest tiles first so the per-frame budget fills the centre of the screen
    const todo = [];
    for (let tx = tx1; tx <= tx2; tx++) {
      for (let ty = ty1; ty <= ty2; ty++) {
        const x = tx * TILE_M, y = ty * TILE_M;
        if (!rectInView(v, x - bleed, y - bleed, x + TILE_M + bleed, y + TILE_M + bleed)) continue;
        todo.push([tx, ty, (x + TILE_M / 2 - cam.x) ** 2 + (y + TILE_M / 2 - cam.y) ** 2]);
      }
    }
    todo.sort((a, b) => a[2] - b[2]);
    for (const [tx, ty] of todo) {
      const img = this.#tile(tx, ty);
      if (img) {
        ctx.drawImage(img, tx * TILE_M - bleed, ty * TILE_M - bleed, span, span);
      } else {
        ctx.fillStyle = GROUND.concrete;
        ctx.fillRect(tx * TILE_M, ty * TILE_M, TILE_M, TILE_M);
      }
    }
  }

  #drawSimplified(ctx) {
    if (this.bayWater?.length) {
      ctx.fillStyle = PAL.water;
      for (const poly of this.bayWater) {
        if (!poly || poly.length < 6) continue;
        ctx.beginPath();
        this.#path(ctx, poly);
        ctx.closePath();
        ctx.fill();
      }
    }
    const overview = this.world.overview;
    if (overview?.roads) {
      ctx.strokeStyle = PAL.asphalt;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const r of overview.roads) {
        if (r.r < 3) continue;
        ctx.lineWidth = r.w * 0.8;
        ctx.beginPath();
        this.#path(ctx, r.p);
        ctx.stroke();
      }
    }
    ctx.fillStyle = PAL.park;
    for (const p of overview?.parks || []) {
      if (p.length < 6) continue;
      ctx.beginPath();
      this.#path(ctx, p);
      ctx.closePath();
      ctx.fill();
    }
  }

  // ------------------------------------------------------------------ buildings

  #visibleBuildings(cam) {
    const W = this.world, v = this.view;
    const seen = new Set();
    const list = [];
    const pad = 6;
    const cx1 = Math.floor((v.x1 - pad) / CELL), cx2 = Math.floor((v.x2 + pad) / CELL);
    const cy1 = Math.floor((v.y1 - pad) / CELL), cy2 = Math.floor((v.y2 + pad) / CELL);
    for (let cx = cx1; cx <= cx2; cx++) {
      for (let cy = cy1; cy <= cy2; cy++) {
        const arr = W.bldGrid.get(cx + "," + cy);
        if (!arr) continue;
        for (const b of arr) {
          if (seen.has(b.id)) continue;
          seen.add(b.id);
          const bb = b.bbox;
          if (!rectInView(v, bb[0] - pad, bb[1] - pad, bb[2] + pad, bb[3] + pad)) continue;
          const mx = (bb[0] + bb[2]) / 2, my = (bb[1] + bb[3]) / 2;
          list.push({ b, mx, my, d2: (mx - cam.x) ** 2 + (my - cam.y) ** 2 });
        }
      }
    }
    list.sort((a, b) => a.d2 - b.d2);
    return list;
  }

  #roof(b) {
    const cached = this.roofs.get(b.id);
    if (cached || this.roofBudget <= 0) return cached;
    this.roofBudget--;
    return this.roofs.bake(b);
  }

  /** 2.5D building pass. Draw AFTER cars so walls occlude the street. */
  drawBuildings(cam) {
    if (cam.zoom < 1.5 || !this.view) return;
    const ctx = this.ctx;
    ctx.lineJoin = "round";

    for (const e of this.#visibleBuildings(cam)) {
      const b = e.b;
      const st = this.bldStyle.get(b.id);
      if (!st) continue;
      const p = b.p;
      const n = p.length;
      const lean = Math.min(MAX_LEAN, (b.l || 2) * LEAN_PER_LEVEL);
      const eOff = elevOffset(e.mx, e.my);
      const dist = Math.sqrt(e.d2);
      const shiftPx = dist * lean * cam.zoom;
      const roof = this.#roof(b);

      if (shiftPx < 1.6) {
        this.#drawRoof(ctx, roof, p, st, 0, cam, eOff);
        continue;
      }

      const sh = 0.9 + Math.min(b.l || 2, 10) * 0.28;
      ctx.beginPath();
      ctx.moveTo(p[0] + sh * SUN.x, p[1] + sh * SUN.y + eOff);
      for (let i = 2; i < n; i += 2) ctx.lineTo(p[i] + sh * SUN.x, p[i + 1] + sh * SUN.y + eOff);
      ctx.closePath();
      ctx.fillStyle = SHADOW;
      ctx.fill();

      const top = new Float64Array(n);
      for (let i = 0; i < n; i += 2) {
        top[i] = p[i] + (p[i] - cam.x) * lean;
        top[i + 1] = p[i + 1] + eOff + (p[i + 1] + eOff - cam.y) * lean;
      }

      ctx.beginPath();
      ctx.moveTo(p[0], p[1] + eOff);
      for (let i = 2; i < n; i += 2) ctx.lineTo(p[i], p[i + 1] + eOff);
      ctx.closePath();
      ctx.fillStyle = st.walls[0];
      ctx.fill();

      const floors = Math.min(b.l || 2, 16);
      const windows = floors >= 2 && shiftPx / floors >= 3;
      const winPath = windows ? new Path2D() : null;
      for (let i = 0; i < n; i += 2) {
        const j = (i + 2) % n;
        const ex = p[j] - p[i], ey = p[j + 1] - p[i + 1];
        const L = Math.hypot(ex, ey);
        if (L < 0.4) continue;
        const nx = (ey / L) * st.sign, ny = (-ex / L) * st.sign;
        const lit = -(nx * SUN.x + ny * SUN.y);
        const bucket = lit > 0.45 ? 3 : lit > 0 ? 2 : lit > -0.5 ? 1 : 0;
        ctx.beginPath();
        ctx.moveTo(p[i], p[i + 1] + eOff);
        ctx.lineTo(p[j], p[j + 1] + eOff);
        ctx.lineTo(top[j], top[j + 1]);
        ctx.lineTo(top[i], top[i + 1]);
        ctx.closePath();
        ctx.fillStyle = st.walls[bucket];
        ctx.fill();
        const facing = nx * ((p[i] + p[j]) / 2 - cam.x) + ny * ((p[i + 1] + p[j + 1]) / 2 - cam.y) < 0;
        if (windows && facing && L > 2.5) {
          for (let f = 0; f < floors; f++) {
            const t = (f + 0.55) / floors;
            winPath.moveTo(p[i] + (top[i] - p[i]) * t, p[i + 1] + eOff + (top[i + 1] - p[i + 1] - eOff) * t);
            winPath.lineTo(p[j] + (top[j] - p[j]) * t, p[j + 1] + eOff + (top[j + 1] - p[j + 1] - eOff) * t);
          }
        }
      }
      if (windows) {
        ctx.lineWidth = (dist * lean) / floors * 0.4;
        ctx.setLineDash([1.4, 1.3]);
        ctx.strokeStyle = "rgba(70,96,140,0.42)";
        ctx.stroke(winPath);
        ctx.setLineDash([]);
      }

      this.#drawRoof(ctx, roof, top, st, lean, cam, eOff);
    }

    this.#drawGoldenGateTowers(ctx, cam);
  }

  #drawRoof(ctx, roof, poly, st, lean, cam, eOff) {
    if (roof) {
      const k = 1 + lean;
      ctx.save();
      ctx.translate(-cam.x * lean, -cam.y * lean + eOff * k);
      ctx.scale(k, k);
      ctx.drawImage(roof.canvas, roof.x, roof.y, roof.w, roof.h);
      ctx.restore();
      return;
    }
    const off = lean ? 0 : eOff;
    ctx.beginPath();
    ctx.moveTo(poly[0], poly[1] + off);
    for (let i = 2; i < poly.length; i += 2) ctx.lineTo(poly[i], poly[i + 1] + off);
    ctx.closePath();
    ctx.fillStyle = st.roof;
    ctx.fill();
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = INK;
    ctx.stroke();
  }

  #drawGoldenGateTowers(ctx, cam) {
    const towers = [{ x: -2150, y: -4650 }, { x: -2450, y: -5450 }];
    const v = this.view;
    if (!towers.some((t) => rectInView(v, t.x - 60, t.y - 60, t.x + 60, t.y + 60))) return;
    const towerColor = "#C84536", towerDark = "#8B2500";
    const tw = 18, th = 35;
    for (const t of towers) {
      const lean = 0.06;
      const topX = t.x + (t.x - cam.x) * lean;
      const topY = t.y + (t.y - cam.y) * lean;
      ctx.fillStyle = SHADOW;
      ctx.fillRect(t.x - tw / 2 + 2, t.y - th / 2 + 2, tw, th);
      ctx.fillStyle = towerDark;
      ctx.fillRect(t.x - tw / 2, t.y - th / 2, tw, th);
      ctx.fillStyle = towerColor;
      ctx.beginPath();
      ctx.moveTo(t.x - tw / 2, t.y - th / 2);
      ctx.lineTo(t.x + tw / 2, t.y - th / 2);
      ctx.lineTo(topX + tw / 2 * 0.8, topY - th / 2);
      ctx.lineTo(topX - tw / 2 * 0.8, topY - th / 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(topX - tw / 2 * 0.8, topY - th / 2 - 3, tw * 0.8, 6);
      ctx.strokeStyle = towerColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(t.x - tw * 1.5, t.y - th * 0.3);
      ctx.lineTo(t.x + tw * 1.5, t.y - th * 0.3);
      ctx.moveTo(t.x - tw * 1.5, t.y + th * 0.1);
      ctx.lineTo(t.x + tw * 1.5, t.y + th * 0.1);
      ctx.stroke();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 0.8;
      ctx.strokeRect(t.x - tw / 2, t.y - th / 2, tw, th);
    }
    ctx.strokeStyle = towerColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const dx of [-20, 20]) {
      ctx.moveTo(towers[0].x + dx, towers[0].y - 15);
      ctx.quadraticCurveTo((towers[0].x + towers[1].x) / 2, (towers[0].y + towers[1].y) / 2 + 40,
        towers[1].x + dx, towers[1].y - 15);
    }
    ctx.stroke();
  }

  end() {
    this.ctx.restore();
  }
}
