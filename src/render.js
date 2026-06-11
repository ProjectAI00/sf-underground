// Tile-cached renderer + per-frame 2.5D building pass, chunk-streaming aware.
//
// Ground, parks, water, roads, crosswalks and trees are rasterized into cached
// 256px tiles (multi-pass roads so intersections merge like Google Maps).
// When a map chunk streams in, overlapping cached tiles are invalidated and
// re-render with the new data. Buildings are drawn every frame as extruded
// prisms whose tops lean away from the camera center (GTA1/2 parallax).

const TILE_PX = 256;
const TILE_SCALE = 3;             // px per meter inside a tile
const TILE_M = TILE_PX / TILE_SCALE;
const MAX_TILES = 300;
const CELL = 64;                  // must match world.js grid cell

const PAL = {
  block: "#aaa28b",
  blockDot: "#9e9680",
  sidewalk: "#c3baa2",
  park: "#83ab63",
  parkDark: "#739a54",
  water: "#5e9dc4",
  waterDark: "#5390b5",
  sand: "#d9c391",
  casing: "#323130",
  asphalt: "#525156",
  asphaltSmall: "#5e5d61",
  laneYellow: "#eccb55",
  laneWhite: "#cdc8b9",
  zebra: "rgba(222,216,200,0.85)",
};

const ROOFS = [
  "#cfa86b", "#c08a5c", "#b7b3a4", "#a4756a", "#9aa48e", "#8e9aa8",
  "#d3b98a", "#a88e76", "#bb7f72", "#8f8470", "#c9b8a0", "#7e8a96",
  "#caa1a8", "#9c8aa0",
];
const ROOFS_INDUSTRIAL = ["#9a948a", "#8b857c", "#a39c90", "#7f7a72"];

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

    world.onChunk((cx, cy, chunk, newRoads, newBuildings) => {
      this.#addChunk(cx, cy, chunk, newRoads, newBuildings);
    });
  }

  #addChunk(cx, cy, chunk, newRoads, newBuildings) {
    for (const r of newRoads) this.#bucketLine(r);
    for (const b of newBuildings) {
      const palette = b.k === 1 ? ROOFS_INDUSTRIAL : ROOFS;
      const roof = palette[(b.id * 13 + ((b.id * 31) >> 3)) % palette.length];
      this.bldStyle.set(b.id, {
        roof,
        roofLit: shade(roof, 1.12),
        walls: [shade(roof, 0.52), shade(roof, 0.63), shade(roof, 0.74), shade(roof, 0.86)],
      });
    }
    for (const p of chunk.parks || []) this.#bucketPoly({ t: "p", p });
    for (const p of chunk.water || []) this.#bucketPoly({ t: "w", p });
    for (const p of chunk.sand || []) this.#bucketPoly({ t: "s", p });
    for (const tr of chunk.trees || []) this.#bucketDot("t", tr, 4);
    for (const cr of chunk.crossings || []) this.#bucketDot("c", cr, cr[3]);

    // invalidate cached tiles overlapping this chunk
    const cs = this.world.chunkSize;
    const tx1 = Math.floor((cx * cs - 8) / TILE_M), tx2 = Math.floor(((cx + 1) * cs + 8) / TILE_M);
    const ty1 = Math.floor((cy * cs - 8) / TILE_M), ty2 = Math.floor(((cy + 1) * cs + 8) / TILE_M);
    for (let tx = tx1; tx <= tx2; tx++) {
      for (let ty = ty1; ty <= ty2; ty++) this.tiles.delete(tx + "," + ty);
    }
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
    const c = document.createElement("canvas");
    c.width = TILE_PX; c.height = TILE_PX;
    const g = c.getContext("2d");
    const ox = tx * TILE_M, oy = ty * TILE_M;
    g.scale(TILE_SCALE, TILE_SCALE);
    g.translate(-ox, -oy);

    g.fillStyle = PAL.block;
    g.fillRect(ox, oy, TILE_M, TILE_M);
    g.fillStyle = PAL.blockDot;
    const step = 11;
    for (let x = Math.floor(ox / step) * step; x < ox + TILE_M; x += step) {
      for (let y = Math.floor(oy / step) * step; y < oy + TILE_M; y += step) {
        if (((x / step) + (y / step)) % 2 === 0) g.fillRect(x, y, 1.1, 1.1);
      }
    }

    const k = tx + "," + ty;
    const polys = this.polyBuckets.get(k);
    const roadSet = this.roadBuckets.get(k);
    const dots = this.dotBuckets.get(k);

    if (polys) {
      for (const v of polys) {
        if (v.t === "p") this.#fillPoly(g, v.p, PAL.park, PAL.parkDark);
        else if (v.t === "s") this.#fillPoly(g, v.p, PAL.sand, null);
      }
      for (const v of polys) {
        if (v.t === "w") this.#fillPoly(g, v.p, PAL.water, PAL.waterDark);
      }
    }

    if (roadSet) {
      const roads = [...roadSet].sort((a, b) => a.r - b.r);
      g.lineCap = "round"; g.lineJoin = "round";
      for (const r of roads) this.#strokeRoad(g, r.p, r.w + 5.4, PAL.sidewalk);
      for (const r of roads) this.#strokeRoad(g, r.p, r.w + 1.6, PAL.casing);
      for (const r of roads) this.#strokeRoad(g, r.p, r.w, r.r >= 2 ? PAL.asphalt : PAL.asphaltSmall);
      for (const r of roads) {
        if (r.r < 2) continue;
        g.setLineDash(r.r >= 3 ? [5, 3] : [3, 3]);
        g.lineWidth = r.r >= 3 ? 0.7 : 0.5;
        g.strokeStyle = PAL.laneYellow;
        g.beginPath();
        this.#path(g, r.p);
        g.stroke();
        g.setLineDash([]);
      }
      for (const r of roads) {
        if (r.r < 4) continue;
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
      // street trees
      for (const [x, y] of dots.t) {
        const h = ((x * 13 + y * 7) & 1023) / 1023;
        const r = 1.9 + h * 1.3;
        g.fillStyle = "rgba(28,22,16,0.22)";
        g.beginPath(); g.arc(x + 0.7, y + 0.9, r * 0.95, 0, Math.PI * 2); g.fill();
        g.fillStyle = h > 0.5 ? "#4e7a3d" : "#578443";
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
        g.fillStyle = h > 0.5 ? "#639153" : "#6c9b58";
        g.beginPath(); g.arc(x - r * 0.25, y - r * 0.25, r * 0.55, 0, Math.PI * 2); g.fill();
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

  #fillPoly(g, p, fill, stroke) {
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
      t = { canvas: this.#renderTile(tx, ty), age: 0 };
      this.tiles.set(k, t);
      if (this.tiles.size > MAX_TILES) this.#evict();
    }
    t.age = this.frame;
    return t.canvas;
  }

  #evict() {
    let oldestK = null, oldest = Infinity;
    for (const [k, t] of this.tiles) {
      if (t.age < oldest) { oldest = t.age; oldestK = k; }
    }
    if (oldestK) this.tiles.delete(oldestK);
  }

  /** cam: {x, y, zoom (px/m), rot (radians)} */
  drawWorld(cam) {
    this.frame++;
    const { ctx, canvas } = this;
    const w = canvas.width, h = canvas.height;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#20222a";
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(w / 2, h / 2 + h * 0.12);
    ctx.rotate(-cam.rot);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);

    const rad = Math.hypot(w, h) / 2 / cam.zoom + TILE_M;
    const tx1 = Math.floor((cam.x - rad) / TILE_M), tx2 = Math.floor((cam.x + rad) / TILE_M);
    const ty1 = Math.floor((cam.y - rad) / TILE_M), ty2 = Math.floor((cam.y + rad) / TILE_M);
    for (let tx = tx1; tx <= tx2; tx++) {
      for (let ty = ty1; ty <= ty2; ty++) {
        const img = this.#tile(tx, ty);
        ctx.drawImage(img, tx * TILE_M, ty * TILE_M, TILE_M + 0.35, TILE_M + 0.35);
      }
    }
  }

  /** 2.5D building pass. Draw AFTER cars so walls occlude the street. */
  drawBuildings(cam, viewR) {
    const ctx = this.ctx;
    const W = this.world;

    // visible set changes slowly: rebuild only when the camera strays
    const cache = this.bldCache;
    let list;
    if (cache && Math.abs(cam.x - cache.x) < 14 && Math.abs(cam.y - cache.y) < 14 &&
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

      const shiftPx = Math.sqrt(d2) * lean * cam.zoom;
      if (shiftPx < 1.6) {
        ctx.beginPath();
        ctx.moveTo(p[0], p[1]);
        for (let i = 2; i < n; i += 2) ctx.lineTo(p[i], p[i + 1]);
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
      ctx.moveTo(p[0] + sh * 0.8, p[1] + sh);
      for (let i = 2; i < n; i += 2) ctx.lineTo(p[i] + sh * 0.8, p[i + 1] + sh);
      ctx.closePath();
      ctx.fillStyle = "rgba(28,22,16,0.25)";
      ctx.fill();

      const top = new Float64Array(n);
      for (let i = 0; i < n; i += 2) {
        top[i] = p[i] + (p[i] - cam.x) * lean;
        top[i + 1] = p[i + 1] + (p[i + 1] - cam.y) * lean;
      }

      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      for (let i = 2; i < n; i += 2) ctx.lineTo(p[i], p[i + 1]);
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
        ctx.moveTo(p[i], p[i + 1]);
        ctx.lineTo(p[j], p[j + 1]);
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
  }

  end() {
    this.ctx.restore();
  }
}
