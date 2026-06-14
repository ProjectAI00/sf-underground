// Tile-cached renderer + per-frame 2.5D building pass, chunk-streaming aware.
//
// Ground, parks, water, roads, crosswalks and trees are rasterized into cached
// 256px tiles (multi-pass roads so intersections merge like Google Maps).
// When a map chunk streams in, overlapping cached tiles are invalidated and
// re-render with the new data. Buildings are drawn every frame as extruded
// prisms whose tops lean away from the camera center (GTA1/2 parallax).

import { elevationNorm, drawHillWash, elevOffset } from "./terrain.js";
import { drawWaterLayer } from "./water.js";

const TILE_PX = 256;
const TILE_SCALE = 4;
const TILE_M = TILE_PX / TILE_SCALE;
const TILE_BLEED_M = 1.5;
const MAX_TILES = 800;
const CELL = 64;                  // must match world.js grid cell

const PAL = {
  block: "#706860",
  blockDot: "#625a52",
  sidewalk: "#908880",
  park: "#4a9a3a",
  parkDark: "#3d8530",
  water: "#3a7898",
  waterDark: "#2a5a78",
  sand: "#c8a058",
  casing: "#222018",
  asphalt: "#3c3a42",
  asphaltSmall: "#484650",
  laneYellow: "#f0c830",
  laneWhite: "#e4dcc8",
  zebra: "rgba(240,236,224,0.92)",
  // New surface types
  parking: "#505058",
  parkingLine: "#606068",
  pier: "#a09080",
  pierEdge: "#807060",
  commercial: "#8a8278",
  industrial: "#787068",
  retail: "#9a9088",
  plaza: "#b8b0a0",
  railway: "#4a4540",
  railwayTie: "#5a5550",
};

// Neighborhood-based building palettes
const PALETTES = {
  downtown: ["#686878", "#606070", "#707080", "#585868", "#787888", "#505058"],
  mission: ["#c07868", "#d89070", "#b86858", "#e8a078", "#c88060", "#d07050"],
  castro: ["#a070a0", "#80a0c0", "#c09068", "#70a080", "#b08090", "#90b0a0"],
  sunset: ["#c8b8a8", "#b8a898", "#d0c0b0", "#a89888", "#c0b0a0", "#b0a090"],
  marina: ["#d0c8c0", "#c8c0b8", "#e0d8d0", "#b8b0a8", "#d8d0c8", "#c0b8b0"],
  richmond: ["#c0b8b0", "#b8b0a8", "#c8c0b8", "#a8a098", "#d0c8c0", "#b0a8a0"],
  chinatown: ["#c85848", "#d87050", "#b84838", "#c06048", "#a84030", "#d06858"],
  northbeach: ["#c8a080", "#d8b090", "#b89070", "#e0c0a0", "#c09878", "#d0a888"],
  haight: ["#a080a0", "#80a0b0", "#c09878", "#90b090", "#b08088", "#a0b0a8"],
  default: ["#a08070", "#907868", "#b09078", "#788068", "#687888", "#807068"],
};
const ROOFS_INDUSTRIAL = ["#585048", "#484038", "#686058", "#403830"];

// Neighborhood-based sidewalk colors
const SIDEWALKS = {
  downtown: "#b0a8a0",    // gray concrete
  mission: "#c8b8a0",     // warm tan
  castro: "#c0b0a8",      // pinkish gray
  sunset: "#d0c8b8",      // light sand
  marina: "#d8d0c8",      // cream white
  richmond: "#c8c0b8",    // light gray
  chinatown: "#c0a890",   // terracotta tint
  northbeach: "#d0c0a8",  // warm beige
  haight: "#b8b0a8",      // muted gray
  default: "#c8bfb0",     // standard
};

// Get neighborhood based on world coordinates
function getNeighborhood(x, y) {
  // Downtown/Financial (east side, north of Market)
  if (x > 1500 && y < -1500 && y > -3500) return "downtown";
  // Chinatown
  if (x > 800 && x < 1800 && y < -2200 && y > -3000) return "chinatown";
  // North Beach
  if (x > 1200 && x < 2200 && y < -3000 && y > -3800) return "northbeach";
  // Marina
  if (x > -500 && x < 1200 && y < -3500) return "marina";
  // Mission
  if (x > 500 && x < 2000 && y > -500 && y < 1500) return "mission";
  // Castro
  if (x > -500 && x < 500 && y > 0 && y < 1500) return "castro";
  // Haight
  if (x > -2000 && x < -200 && y > -500 && y < 800) return "haight";
  // Sunset (west side)
  if (x < -2500) return "sunset";
  // Richmond (northwest)
  if (x < -1500 && y < -1500) return "richmond";
  return "default";
}

function getRoofColor(id, x, y, kind) {
  if (kind === 1) {
    return ROOFS_INDUSTRIAL[(id * 13) % ROOFS_INDUSTRIAL.length];
  }
  const hood = getNeighborhood(x, y);
  const pal = PALETTES[hood];
  return pal[(id * 13 + ((id * 31) >> 3)) % pal.length];
}

const LEAN_PER_LEVEL = 0.017;
const MAX_LEAN = 0.11;
const OUTLINE = "#322c25";

function shade(hex, f) {
  const r = Math.min(255, (parseInt(hex.slice(1, 3), 16) * f) | 0);
  const g = Math.min(255, (parseInt(hex.slice(3, 5), 16) * f) | 0);
  const b = Math.min(255, (parseInt(hex.slice(5, 7), 16) * f) | 0);
  return `rgb(${r},${g},${b})`;
}

export class Renderer {
  constructor(world, canvas) {
    this.world = world;
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.tiles = new Map();
    this.frame = 0;
    this.roadBuckets = new Map();  // tile key -> Set<road>
    this.polyBuckets = new Map();  // tile key -> Set<{t, p}> for parks/water/sand
    this.dotBuckets = new Map();   // tile key -> arrays of trees / crossings
    this.bldStyle = new Map();     // building id -> colors
    this.shore = world.overview?.shore || [];
    this.bridgeWater = world.overview?.bridgeWater || [];
    this.bayWater = [];
    // Load bay water polygon
    fetch("data/bay_water.json").then(r => r.json()).then(d => {
      this.bayWater = d.bayWater || [];
      // Clear everything to force full redraw with water
      this.tiles.clear();
      if (this.tileQueue) this.tileQueue.length = 0;
      if (this.queuedSet) this.queuedSet.clear();
    }).catch(() => {});

    world.onChunk((cx, cy, chunk, newRoads, newBuildings) => {
      this.#addChunk(cx, cy, chunk, newRoads, newBuildings);
    });
  }

  #addChunk(cx, cy, chunk, newRoads, newBuildings) {
    for (const r of newRoads) this.#bucketLine(r);
    for (const b of newBuildings) {
      // Get center of building for neighborhood lookup
      const bb = b.bbox;
      const bcx = (bb[0] + bb[2]) / 2;
      const bcy = (bb[1] + bb[3]) / 2;
      
      // Skip buildings on Golden Gate Bridge area (wider zone)
      if (bcx > -4000 && bcx < 500 && bcy < -3800 && bcy > -7000) continue;
      
      // Skip buildings that overlap major roads
      const nearRoad = this.world.nearestRoad(bcx, bcy, 20);
      if (nearRoad && nearRoad.d < nearRoad.road.w / 2 + 2 && nearRoad.road.r >= 2) continue;
      
      const cx = bcx;
      const cy = (bb[1] + bb[3]) / 2;
      const roof = getRoofColor(b.id, cx, cy, b.k);
      this.bldStyle.set(b.id, {
        roof,
        roofLit: shade(roof, 1.12),
        walls: [shade(roof, 0.52), shade(roof, 0.63), shade(roof, 0.74), shade(roof, 0.86)],
      });
    }
    for (const b of newBuildings) this.#bucketPoly({ t: "d", p: b.p });
    for (const p of chunk.parks || []) this.#bucketPoly({ t: "p", p });
    for (const p of chunk.water || []) this.#bucketPoly({ t: "w", p });
    for (const p of chunk.sand || []) this.#bucketPoly({ t: "s", p });
    // New surface types
    for (const p of chunk.parking || []) this.#bucketPoly({ t: "parking", p });
    for (const p of chunk.piers || []) this.#bucketPoly({ t: "pier", p });
    for (const p of chunk.commercial || []) this.#bucketPoly({ t: "commercial", p });
    for (const p of chunk.industrial || []) this.#bucketPoly({ t: "industrial", p });
    for (const p of chunk.retail || []) this.#bucketPoly({ t: "retail", p });
    for (const p of chunk.plazas || []) this.#bucketPoly({ t: "plaza", p });
    // Railways
    for (const r of chunk.railways || []) this.#bucketLine({ ...r, isRail: true, w: 3, r: 0 });
    
    for (const tr of chunk.trees || []) this.#bucketDot("t", tr, 4);
    
    // Deduplicate crossings - skip ones too close together
    const processedCrossings = [];
    for (const cr of chunk.crossings || []) {
      const fixed = this.#snapCrossing(cr);
      if (!fixed) continue;
      
      // Check if too close to an existing crossing
      let tooClose = false;
      for (const existing of processedCrossings) {
        const dx = fixed[0] - existing[0];
        const dy = fixed[1] - existing[1];
        if (dx * dx + dy * dy < 100) { // Within 10m
          tooClose = true;
          break;
        }
      }
      
      if (!tooClose) {
        processedCrossings.push(fixed);
        this.#bucketDot("c", fixed, fixed[3]);
      }
    }

    // invalidate cached tiles overlapping this chunk
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
    const pad = r.w / 2 + 5;
    const p = r.p;
    for (let s = 0; s + 3 < p.length; s += 2) {
      const x1 = Math.min(p[s], p[s + 2]) - pad, x2 = Math.max(p[s], p[s + 2]) + pad;
      const y1 = Math.min(p[s + 1], p[s + 3]) - pad, y2 = Math.max(p[s + 1], p[s + 3]) + pad;
      this.#addRange(this.roadBuckets, x1, y1, x2, y2, r);
    }
  }

  #bucketPoly(val) {
    const p = val.p;
    if (!p || p.length < 6) return; // skip degenerate OSM line strings
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

    g.fillStyle = PAL.block;
    g.fillRect(ox, oy, span, span);
    drawHillWash(g, ox, oy, ox + span, oy + span, 96, "game");
    g.fillStyle = PAL.blockDot;
    const step = 11;
    for (let x = Math.floor(ox / step) * step; x < ox + span; x += step) {
      for (let y = Math.floor(oy / step) * step; y < oy + span; y += step) {
        if (((x / step) + (y / step)) % 2 === 0) g.fillRect(x, y, 1.1, 1.1);
      }
    }

    const k = tx + "," + ty;
    const polys = this.polyBuckets.get(k);
    const roadSet = this.roadBuckets.get(k);
    const dots = this.dotBuckets.get(k);

    // Get sidewalk color for this tile's neighborhood
    const tileX = ox + span / 2, tileY = oy + span / 2;
    const hood = getNeighborhood(tileX, tileY);
    const sidewalkColor = SIDEWALKS[hood] || SIDEWALKS.default;

    // Draw bay water from coastline polygon (underneath land)
    if (this.bayWater?.length) {
      g.fillStyle = PAL.water;
      for (const poly of this.bayWater) {
        if (!poly || poly.length < 6) continue;
        g.beginPath();
        g.moveTo(poly[0], poly[1]);
        for (let i = 2; i < poly.length; i += 2) {
          g.lineTo(poly[i], poly[i + 1]);
        }
        g.closePath();
        g.fill();
      }
    }

    if (polys) {
      // 1. Sidewalks (building footprints) - covers water where there's land
      for (const v of polys) {
        if (v.t === "d") this.#fillPoly(g, v.p, sidewalkColor, null);
      }
      // 2. Parks
      for (const v of polys) {
        if (v.t === "p") this.#fillPoly(g, v.p, PAL.park, PAL.parkDark);
      }
      // 3. Sand (beaches)
      for (const v of polys) {
        if (v.t === "s") this.#fillPoly(g, v.p, PAL.sand, null);
      }
      // 4. Parking lots
      for (const v of polys) {
        if (v.t === "parking") this.#fillPoly(g, v.p, PAL.parking, null);
      }
      // 5. Piers (over water)
      for (const v of polys) {
        if (v.t === "pier") this.#fillPoly(g, v.p, PAL.pier, PAL.pierEdge);
      }
      // 6. Smaller water bodies (lakes, ponds) on top
      for (const v of polys) {
        if (v.t === "w") this.#fillPoly(g, v.p, PAL.water, null);
      }
    }

    if (roadSet) {
      const roads = [...roadSet].sort((a, b) => a.r - b.r);
      g.lineCap = "round"; g.lineJoin = "round";
      // Sidewalks - GG Bridge gets red sidewalks, others normal
      for (const r of roads) {
        const isGG = r.n && /golden gate bridge/i.test(r.n);
        this.#strokeRoad(g, r.p, r.w + 5.4, isGG ? "#C84536" : sidewalkColor);
      }
      // Road casing
      for (const r of roads) {
        this.#strokeRoad(g, r.p, r.w + 1.6, PAL.casing);
      }
      // Road surface - GG Bridge gets gray asphalt like other roads
      for (const r of roads) {
        const isTunnel = r.tu;
        let color;
        if (isTunnel) color = "#2a2830";
        else color = r.r >= 2 ? this.#asphaltColor(r.p, PAL.asphalt) : this.#asphaltColor(r.p, PAL.asphaltSmall);
        this.#strokeRoad(g, r.p, r.w, color);
      }
      for (const r of roads) {
        if (r.r < 2 || r.tu) continue; // skip tunnel roads
        g.setLineDash(r.r >= 3 ? [5, 3] : [3, 3]);
        g.lineWidth = r.r >= 3 ? 0.7 : 0.5;
        g.strokeStyle = PAL.laneYellow;
        g.beginPath();
        this.#path(g, r.p);
        g.stroke();
        g.setLineDash([]);
      }
      for (const r of roads) {
        if (r.r < 4 || r.tu) continue; // skip tunnel roads
        g.setLineDash([2.5, 4]);
        g.lineWidth = 0.35;
        g.strokeStyle = PAL.laneWhite;
        for (const off of [-r.w * 0.25, r.w * 0.25]) {
          g.beginPath();
          this.#offsetPath(g, r.p, off);
          g.stroke();
        }
        g.setLineDash([]);
      }
    }

    if (dots) {
      // crosswalks: zebra bars across the road
      g.fillStyle = PAL.zebra;
      for (const [x, y, a, w] of dots.c) {
        g.save();
        g.translate(x, y);
        g.rotate(a);
        const half = w / 2 - 0.6;
        for (let off = -half; off <= half; off += 1.1) {
          g.fillRect(-1.4, off - 0.3, 2.8, 0.62);
        }
        g.restore();
      }
      // street trees - varied sizes and shades
      for (const [x, y] of dots.t) {
        const h = ((x * 13 + y * 7) & 1023) / 1023;
        const h2 = ((x * 17 + y * 11) & 511) / 511;
        const r = 1.6 + h * 1.1 + h2 * 0.4;
        
        // Shadow
        g.fillStyle = "rgba(20,18,12,0.2)";
        g.beginPath();
        g.ellipse(x + 0.5, y + 0.6, r * 0.85, r * 0.6, 0, 0, Math.PI * 2);
        g.fill();
        
        // Main foliage - varied greens
        const baseG = h > 0.6 ? "#3a6830" : h > 0.3 ? "#406838" : "#4a7040";
        g.fillStyle = baseG;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
        
        // Highlight
        const hiG = h > 0.6 ? "#4a7838" : h > 0.3 ? "#508040" : "#5a8848";
        g.fillStyle = hiG;
        g.beginPath();
        g.arc(x - r * 0.2, y - r * 0.2, r * 0.5, 0, Math.PI * 2);
        g.fill();
      }
    }
    return c;
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

  /** Asphalt color with subtle variation per road segment */
  #asphaltColor(p, base) {
    let mx = 0, my = 0, n = 0;
    for (let i = 0; i < p.length; i += 2) { mx += p[i]; my += p[i + 1]; n++; }
    mx /= n; my /= n;
    
    // Position-based hash for consistent variation
    const hash = ((Math.floor(mx * 0.1) * 7) + (Math.floor(my * 0.1) * 13)) & 255;
    const variation = (hash / 255) * 0.12 - 0.06; // -0.06 to +0.06
    
    // Slight warm/cool shift
    const warmShift = ((hash >> 4) & 1) ? 0.02 : -0.02;
    
    const en = elevationNorm(mx, my);
    const elevBoost = en > 0.08 ? en * 0.18 : 0;
    
    // Parse base color and apply variations
    const r = parseInt(base.slice(1, 3), 16);
    const g = parseInt(base.slice(3, 5), 16);
    const b = parseInt(base.slice(5, 7), 16);
    
    const factor = 1 + variation + elevBoost;
    const nr = Math.min(255, Math.max(0, Math.round(r * factor + warmShift * 30)));
    const ng = Math.min(255, Math.max(0, Math.round(g * factor)));
    const nb = Math.min(255, Math.max(0, Math.round(b * factor - warmShift * 15)));
    
    return `rgb(${nr},${ng},${nb})`;
  }

  #fillPoly(g, p, fill, stroke) {
    if (!p || p.length < 6) return;
    g.beginPath();
    this.#path(g, p);
    g.closePath();
    g.fillStyle = fill;
    g.fill();
    if (stroke) { g.lineWidth = 0.8; g.strokeStyle = stroke; g.stroke(); }
  }

  #tile(tx, ty) {
    const k = tx + "," + ty;
    let t = this.tiles.get(k);
    if (!t) {
      t = { canvas: this.#renderTile(tx, ty), age: this.frame };
      this.tiles.set(k, t);
      if (this.tiles.size > MAX_TILES) this.#evict();
    }
    t.age = this.frame;
    return t.canvas;
  }

  #evict() {
    // Batch evict oldest tiles
    const sorted = [...this.tiles.entries()].sort((a, b) => a[1].age - b[1].age);
    const toRemove = Math.max(1, Math.floor(sorted.length * 0.1));
    for (let i = 0; i < toRemove; i++) {
      this.tiles.delete(sorted[i][0]);
    }
  }

  /** cam: {x, y, zoom (px/m), rot (radians)} */
  drawWorld(cam) {
    this.frame++;
    this.lod = cam.zoom < 2 ? 0 : cam.zoom < 4 ? 1 : 2;
    const { ctx, canvas } = this;
    const w = canvas.width, h = canvas.height;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#181a20";
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(w / 2, h / 2 + h * 0.12);
    ctx.rotate(-cam.rot);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);

    const rad = Math.hypot(w, h) / 2 / cam.zoom + TILE_M;
    
    if (cam.zoom < 1.5) {
      this.#drawSimplified(ctx, cam, rad);
      return;
    }
    
    const tx1 = Math.floor((cam.x - rad) / TILE_M), tx2 = Math.floor((cam.x + rad) / TILE_M);
    const ty1 = Math.floor((cam.y - rad) / TILE_M), ty2 = Math.floor((cam.y + rad) / TILE_M);
    const bleed = TILE_BLEED_M;
    const span = TILE_M + bleed * 2;
    for (let tx = tx1; tx <= tx2; tx++) {
      for (let ty = ty1; ty <= ty2; ty++) {
        const img = this.#tile(tx, ty);
        ctx.drawImage(img, tx * TILE_M - bleed, ty * TILE_M - bleed, span, span);
      }
    }
  }
  
  #drawSimplified(ctx, cam, rad) {
    // Draw bay water
    if (this.bayWater?.length) {
      ctx.fillStyle = PAL.water;
      for (const poly of this.bayWater) {
        if (!poly || poly.length < 6) continue;
        ctx.beginPath();
        ctx.moveTo(poly[0], poly[1]);
        for (let i = 2; i < poly.length; i += 2) ctx.lineTo(poly[i], poly[i + 1]);
        ctx.closePath();
        ctx.fill();
      }
    }
    
    // Draw only major roads from overview
    const overview = this.world.overview;
    if (overview?.roads) {
      ctx.strokeStyle = PAL.asphalt;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const r of overview.roads) {
        if (r.r < 3) continue; // Only major roads
        ctx.lineWidth = r.w * 0.8;
        ctx.beginPath();
        const p = r.p;
        ctx.moveTo(p[0], p[1]);
        for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
        ctx.stroke();
      }
    }
    
    // Draw parks from overview
    ctx.fillStyle = PAL.park;
    const parks = this.world.overview?.parks || [];
    for (const p of parks) {
      if (p.length < 6) continue;
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
      ctx.closePath();
      ctx.fill();
    }
  }

  /** 2.5D building pass. Draw AFTER cars so walls occlude the street. */
  drawBuildings(cam, viewR) {
    // Skip buildings when zoomed out far
    if (cam.zoom < 1.5) return;
    
    const ctx = this.ctx;
    const W = this.world;

    // visible set changes slowly: rebuild only when the camera strays
    const cache = this.bldCache;
    let list;
    if (cache && Math.abs(cam.x - cache.x) < 30 && Math.abs(cam.y - cache.y) < 30 &&
        cache.chunkCount === W.bldSeen.size) {
      list = cache.list;
    } else {
      const seen = new Set();
      list = [];
      const pad = viewR + 20; // margin so the cache stays valid while it ages
      const cx1 = Math.floor((cam.x - pad) / CELL), cx2 = Math.floor((cam.x + pad) / CELL);
      const cy1 = Math.floor((cam.y - pad) / CELL), cy2 = Math.floor((cam.y + pad) / CELL);
      for (let cx = cx1; cx <= cx2; cx++) {
        for (let cy = cy1; cy <= cy2; cy++) {
          const arr = W.bldGrid.get(cx + "," + cy);
          if (!arr) continue;
          for (const b of arr) {
            if (seen.has(b.id)) continue;
            seen.add(b.id);
            const bb = b.bbox;
            const mx = (bb[0] + bb[2]) / 2, my = (bb[1] + bb[3]) / 2;
            const dx = mx - cam.x, dy = my - cam.y;
            const d2 = dx * dx + dy * dy;
            if (d2 > pad * pad) continue;
            list.push({ b, d2, mx, my });
          }
        }
      }
      list.sort((a, b) => a.d2 - b.d2);
      this.bldCache = { x: cam.x, y: cam.y, list, chunkCount: W.bldSeen.size };
    }

    ctx.lineJoin = "round";
    const sunX = -0.62, sunY = -0.78;
    const r2 = viewR * viewR;

    for (const e of list) {
      const b = e.b;
      const ddx = e.mx - cam.x, ddy = e.my - cam.y;
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 > r2) continue;
      const st = this.bldStyle.get(b.id);
      if (!st) continue;
      const p = b.p;
      const n = p.length;
      const lean = Math.min(MAX_LEAN, (b.l || 2) * LEAN_PER_LEVEL);

      // elevation offset for this building (use center point)
      const eOff = elevOffset(e.mx, e.my);

      const shiftPx = Math.sqrt(d2) * lean * cam.zoom;
      if (shiftPx < 1.6) {
        ctx.beginPath();
        ctx.moveTo(p[0], p[1] + eOff);
        for (let i = 2; i < n; i += 2) ctx.lineTo(p[i], p[i + 1] + eOff);
        ctx.closePath();
        ctx.fillStyle = st.roof;
        ctx.fill();
        ctx.lineWidth = 0.6;
        ctx.strokeStyle = OUTLINE;
        ctx.stroke();
        continue;
      }

      const sh = 0.9 + Math.min(b.l || 2, 10) * 0.28;
      ctx.beginPath();
      ctx.moveTo(p[0] + sh * 0.8, p[1] + sh + eOff);
      for (let i = 2; i < n; i += 2) ctx.lineTo(p[i] + sh * 0.8, p[i + 1] + sh + eOff);
      ctx.closePath();
      ctx.fillStyle = "rgba(28,22,16,0.25)";
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

      for (let i = 0; i < n; i += 2) {
        const j = (i + 2) % n;
        const ex = p[j] - p[i], ey = p[j + 1] - p[i + 1];
        const L = Math.hypot(ex, ey);
        if (L < 0.4) continue;
        const nx = ey / L, ny = -ex / L;
        const lit = nx * sunX + ny * sunY;
        const bucket = lit > 0.45 ? 3 : lit > 0 ? 2 : lit > -0.5 ? 1 : 0;
        ctx.beginPath();
        ctx.moveTo(p[i], p[i + 1] + eOff);
        ctx.lineTo(p[j], p[j + 1] + eOff);
        ctx.lineTo(top[j], top[j + 1]);
        ctx.lineTo(top[i], top[i + 1]);
        ctx.closePath();
        ctx.fillStyle = st.walls[bucket];
        ctx.fill();
      }

      ctx.beginPath();
      ctx.moveTo(top[0], top[1]);
      for (let i = 2; i < n; i += 2) ctx.lineTo(top[i], top[i + 1]);
      ctx.closePath();
      ctx.fillStyle = b.l >= 6 ? st.roofLit : st.roof;
      ctx.fill();
      ctx.lineWidth = 0.55;
      ctx.strokeStyle = OUTLINE;
      ctx.stroke();
    }
    
    // Draw Golden Gate Bridge towers
    this.#drawGoldenGateTowers(ctx, cam, viewR);
  }
  
  #drawGoldenGateTowers(ctx, cam, viewR) {
    // Golden Gate tower positions (approximate)
    const towers = [
      { x: -2150, y: -4650 },  // South tower
      { x: -2450, y: -5450 },  // North tower
    ];
    
    const towerColor = "#C84536";
    const towerDark = "#8B2500";
    const towerWidth = 18;
    const towerHeight = 35;
    
    for (const t of towers) {
      const dx = t.x - cam.x, dy = t.y - cam.y;
      if (dx * dx + dy * dy > viewR * viewR * 1.5) continue;
      
      const lean = 0.06;
      const topX = t.x + (t.x - cam.x) * lean;
      const topY = t.y + (t.y - cam.y) * lean;
      
      // Tower shadow
      ctx.fillStyle = "rgba(20,15,10,0.3)";
      ctx.fillRect(t.x - towerWidth/2 + 2, t.y - towerHeight/2 + 2, towerWidth, towerHeight);
      
      // Tower base (darker)
      ctx.fillStyle = towerDark;
      ctx.fillRect(t.x - towerWidth/2, t.y - towerHeight/2, towerWidth, towerHeight);
      
      // Tower front face
      ctx.fillStyle = towerColor;
      ctx.beginPath();
      ctx.moveTo(t.x - towerWidth/2, t.y - towerHeight/2);
      ctx.lineTo(t.x + towerWidth/2, t.y - towerHeight/2);
      ctx.lineTo(topX + towerWidth/2 * 0.8, topY - towerHeight/2);
      ctx.lineTo(topX - towerWidth/2 * 0.8, topY - towerHeight/2);
      ctx.closePath();
      ctx.fill();
      
      // Tower top
      ctx.fillStyle = towerColor;
      ctx.fillRect(topX - towerWidth/2 * 0.8, topY - towerHeight/2 - 3, towerWidth * 0.8, 6);
      
      // Cross beams (simplified)
      ctx.strokeStyle = towerColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(t.x - towerWidth * 1.5, t.y - towerHeight * 0.3);
      ctx.lineTo(t.x + towerWidth * 1.5, t.y - towerHeight * 0.3);
      ctx.moveTo(t.x - towerWidth * 1.5, t.y + towerHeight * 0.1);
      ctx.lineTo(t.x + towerWidth * 1.5, t.y + towerHeight * 0.1);
      ctx.stroke();
      
      // Outline
      ctx.strokeStyle = "#1a1a1e";
      ctx.lineWidth = 0.8;
      ctx.strokeRect(t.x - towerWidth/2, t.y - towerHeight/2, towerWidth, towerHeight);
    }
    
    // Draw suspension cables between towers
    ctx.strokeStyle = towerColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(towers[0].x - 20, towers[0].y - 15);
    ctx.quadraticCurveTo(
      (towers[0].x + towers[1].x) / 2, 
      (towers[0].y + towers[1].y) / 2 + 40,
      towers[1].x - 20, towers[1].y - 15
    );
    ctx.moveTo(towers[0].x + 20, towers[0].y - 15);
    ctx.quadraticCurveTo(
      (towers[0].x + towers[1].x) / 2, 
      (towers[0].y + towers[1].y) / 2 + 40,
      towers[1].x + 20, towers[1].y - 15
    );
    ctx.stroke();
  }

  end() {
    this.ctx.restore();
  }

}
