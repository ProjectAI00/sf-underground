// Streamed street furniture: real poles from map chunks, synthetic fill where
// OSM is sparse, and cheap spatial grids for draw/collision hot loops.

import { drawCarSprite, makeCarSprite } from "./car.js";

const CELL = 64;
const CHUNK = 1000;
const LAMP_LEAN = 0.030;
const SIGN_LEAN = 0.026;
const LIGHT_LEAN = 0.026;
const KNOCK_R2 = 1.6 * 1.6;
const SIGNAL_R = 1.2;
const PARKED_R = 1.55;
const PARKED_COLORS = ["#9b958a", "#6b7c88", "#7d6a58", "#4e5a62", "#8e4f49", "#5d6e54", "#3d3f46"];

function cellKey(gx, gy) { return gx + "," + gy; }
function propKey(x, y) { return Math.round(x * 10) + "," + Math.round(y * 10); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function hashInt(h) {
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

function hash01(h) { return hashInt(h) / 4294967296; }

function hashString(v) {
  const s = String(v);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function hashPos(x, y, salt = 0) {
  const xi = Math.round(x * 8);
  const yi = Math.round(y * 8);
  return hashInt(Math.imul(xi, 374761393) ^ Math.imul(yi, 668265263) ^ Math.imul(salt, 1442695041));
}

export class Props {
  constructor(world) {
    this.world = world;
    this.loadedChunks = new Set();

    this.lamps = [];       // {x,y, alive, fallA, fallT}
    this.signals = [];     // {x,y, phase}
    this.stops = [];       // {x,y, alive, fallA, fallT}
    this.parked = [];      // {x,y,h,sprite, ox,oy,oh}

    this.lampGrid = new Map();
    this.signalGrid = new Map();
    this.stopGrid = new Map();
    this.parkedGrid = new Map();

    this.lampKeys = new Set();
    this.signalKeys = new Set();
    this.stopKeys = new Set();
    this.parkedKeys = new Set();

    this.falling = [];
    this.carSprites = null;
  }

  addChunk(cx, cy, chunk) {
    const ck = cx + "," + cy;
    if (this.loadedChunks.has(ck)) return;
    this.loadedChunks.add(ck);

    const bounds = {
      minX: cx * CHUNK,
      minY: cy * CHUNK,
      maxX: (cx + 1) * CHUNK,
      maxY: (cy + 1) * CHUNK,
    };

    const lamps = chunk?.lamps || [];
    const real = [];
    for (let i = 0; i < lamps.length; i++) {
      const p = lamps[i];
      if (!p || p.length < 2) continue;
      const fixed = this.#offRoad(p[0], p[1]);
      this.#addLamp(fixed[0], fixed[1]);
      real.push(fixed);
    }
    // synthetic fill wherever real OSM lamps are absent (within 30m)
    this.#addSyntheticLamps(chunk?.roads || [], bounds, ck, real);

    const signals = chunk?.signals || [];
    for (let i = 0; i < signals.length; i++) {
      const p = signals[i];
      if (!p || p.length < 2) continue;
      const fixed = this.#offRoad(p[0], p[1]);
      this.#addSignal(fixed[0], fixed[1]);
    }

    const stops = chunk?.stops || [];
    for (let i = 0; i < stops.length; i++) {
      const p = stops[i];
      if (!p || p.length < 2) continue;
      const fixed = this.#offRoad(p[0], p[1]);
      this.#addStop(fixed[0], fixed[1]);
    }

    this.#addParkedCars(chunk?.roads || [], bounds, ck);
  }

  /** knock over light props and resolve solid street furniture; returns true on hit */
  knockCheck(car, dt) {
    this.#updateFalling(dt);

    const cx = Math.floor(car.x / CELL), cy = Math.floor(car.y / CELL);
    let hit = false;
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        const key = cellKey(gx, gy);
        let arr = this.lampGrid.get(key);
        if (arr) {
          for (let i = 0; i < arr.length; i++) if (this.#knockProp(this.lamps[arr[i]], car)) hit = true;
        }

        arr = this.stopGrid.get(key);
        if (arr) {
          for (let i = 0; i < arr.length; i++) if (this.#knockProp(this.stops[arr[i]], car)) hit = true;
        }

        arr = this.signalGrid.get(key);
        if (arr) {
          for (let i = 0; i < arr.length; i++) if (this.#hitSignal(this.signals[arr[i]], car)) hit = true;
        }

        arr = this.parkedGrid.get(key);
        if (arr) {
          for (let i = 0; i < arr.length; i++) if (this.#hitParked(this.parked[arr[i]], car)) hit = true;
        }
      }
    }
    return hit;
  }

  draw(ctx, cam, viewR, time, light) {
    const r2 = viewR * viewR;
    const cx1 = Math.floor((cam.x - viewR) / CELL), cx2 = Math.floor((cam.x + viewR) / CELL);
    const cy1 = Math.floor((cam.y - viewR) / CELL), cy2 = Math.floor((cam.y + viewR) / CELL);
    const lampIntensity = clamp(light?.lampIntensity || 0, 0, 1);

    this.#drawParkedGrid(ctx, cam, r2, cx1, cx2, cy1, cy2);

    ctx.lineCap = "round";
    this.#drawStopsGrid(ctx, cam, r2, cx1, cx2, cy1, cy2);
    this.#drawLampsGrid(ctx, cam, r2, cx1, cx2, cy1, cy2, lampIntensity);
    this.#drawSignalsGrid(ctx, cam, r2, cx1, cx2, cy1, cy2, time || 0, lampIntensity);
  }

  #addSyntheticLamps(roads, bounds, chunkKey, real = []) {
    const seenRoads = new Set();
    for (let ri = 0; ri < roads.length; ri++) {
      const r = roads[ri];
      if (!r || r.r < 1 || !r.p || r.p.length < 4) continue;
      const rid = r.id ?? chunkKey + ":road:" + ri;
      if (seenRoads.has(rid)) continue;
      seenRoads.add(rid);

      const spacing = r.r >= 3 ? 34 : 48;
      const off = (r.w || 7) / 2 + 1.6;
      const roadHash = hashString(rid);
      const p = r.p;
      let acc = 0;
      let next = spacing * (0.3 + hash01(roadHash ^ 0x51ed) * 0.5);
      let slot = 0;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const dx = p[i + 2] - p[i], dy = p[i + 3] - p[i + 1];
        const seg = Math.hypot(dx, dy);
        if (seg < 0.01) continue;
        while (acc + seg >= next) {
          const t = (next - acc) / seg;
          const x = p[i] + dx * t;
          const y = p[i + 1] + dy * t;
          if (this.#inBounds(x, y, bounds)) {
            let nearReal = false;
            for (let q = 0; q < real.length; q++) {
              const rdx = real[q][0] - x, rdy = real[q][1] - y;
              if (rdx * rdx + rdy * rdy < 900) { nearReal = true; break; }
            }
            if (!nearReal) {
              const side = (slot + (roadHash & 1)) % 2 ? 1 : -1;
              const fixed = this.#offRoad(x + (-dy / seg) * off * side, y + (dx / seg) * off * side);
              this.#addLamp(fixed[0], fixed[1]);
            }
          }
          slot++;
          next += spacing;
        }
        acc += seg;
      }
    }
  }

  #addParkedCars(roads, bounds, chunkKey) {
    const seenRoads = new Set();
    for (let ri = 0; ri < roads.length; ri++) {
      const r = roads[ri];
      if (!r || r.r > 1 || !r.p || r.p.length < 4) continue;
      const rid = r.id ?? chunkKey + ":road:" + ri;
      if (seenRoads.has(rid)) continue;
      seenRoads.add(rid);

      const spacing = 13;
      const off = Math.max(1.2, (r.w || 6) / 2 - 1.1);
      const roadHash = hashString(rid);
      const p = r.p;
      let acc = 0;
      let next = spacing * (0.45 + hash01(roadHash ^ 0xa7c3) * 0.35);
      let slot = 0;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const dx = p[i + 2] - p[i], dy = p[i + 3] - p[i + 1];
        const seg = Math.hypot(dx, dy);
        if (seg < 0.01) continue;
        while (acc + seg >= next) {
          const t = (next - acc) / seg;
          const x = p[i] + dx * t;
          const y = p[i + 1] + dy * t;
          const h = hashInt(roadHash ^ Math.imul(slot + 1, 0x9e3779b1));
          if (this.#inBounds(x, y, bounds) && hash01(h) < 0.22) {
            const side = (slot + (h & 1)) % 2 ? 1 : -1;
            const px = x + (-dy / seg) * off * side;
            const py = y + (dx / seg) * off * side;
            const a = Math.atan2(dy, dx) + (side < 0 ? Math.PI : 0);
            this.#addParked(px, py, a, h % PARKED_COLORS.length);
          }
          slot++;
          next += spacing;
        }
        acc += seg;
      }
    }
  }

  #addLamp(x, y) {
    const k = propKey(x, y);
    if (this.lampKeys.has(k)) return;
    this.lampKeys.add(k);
    const i = this.lamps.length;
    this.lamps.push({ x, y, alive: true, fallA: 0, fallT: 0 });
    this.#addToGrid(this.lampGrid, x, y, i);
  }

  #addSignal(x, y) {
    const k = propKey(x, y);
    if (this.signalKeys.has(k)) return;
    this.signalKeys.add(k);
    const i = this.signals.length;
    this.signals.push({ x, y, alive: true, fallA: 0, fallT: 0, phase: hashPos(x, y, 23) / 2147483648 });
    this.#addToGrid(this.signalGrid, x, y, i);
  }

  #addStop(x, y) {
    const k = propKey(x, y);
    if (this.stopKeys.has(k)) return;
    this.stopKeys.add(k);
    const i = this.stops.length;
    this.stops.push({ x, y, alive: true, fallA: 0, fallT: 0 });
    this.#addToGrid(this.stopGrid, x, y, i);
  }

  #addParked(x, y, h, sprite) {
    const k = propKey(x, y);
    if (this.parkedKeys.has(k)) return;
    this.parkedKeys.add(k);
    const i = this.parked.length;
    this.parked.push({ x, y, h, sprite, ox: 0, oy: 0, oh: 0 });
    this.#addToGrid(this.parkedGrid, x, y, i);
  }

  #addToGrid(grid, x, y, i) {
    const k = cellKey(Math.floor(x / CELL), Math.floor(y / CELL));
    let arr = grid.get(k);
    if (!arr) grid.set(k, (arr = []));
    arr.push(i);
  }

  #inBounds(x, y, b) {
    return x >= b.minX && x < b.maxX && y >= b.minY && y < b.maxY;
  }

  /** poles never stand on asphalt: relocate to the nearest curb if needed */
  #offRoad(x, y) {
    const nr = this.world.nearestRoad(x, y, 40);
    if (!nr || nr.d > nr.road.w / 2 + 0.4) return [x, y];
    // push out perpendicular to the road, on the side the pole leans toward
    let sx = x - nr.x, sy = y - nr.y;
    const d = Math.hypot(sx, sy);
    if (d < 0.3) { sx = -nr.ty; sy = nr.tx; }
    else { sx /= d; sy /= d; }
    const off = nr.road.w / 2 + 1.6;
    return [
      Math.round((nr.x + sx * off) * 10) / 10,
      Math.round((nr.y + sy * off) * 10) / 10,
    ];
  }

  #updateFalling(dt) {
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const p = this.falling[i];
      p.fallT = Math.max(0, p.fallT - dt * 0.4);
      if (p.fallT <= 0) {
        const last = this.falling.pop();
        if (i < this.falling.length) this.falling[i] = last;
      }
    }
  }

  #knockProp(p, car) {
    if (!p || !p.alive) return false;
    const dx = p.x - car.x, dy = p.y - car.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > KNOCK_R2) return false;

    const spd = this.#carSpeed(car);
    if (spd > 5) {
      p.alive = false;
      p.fallA = Math.atan2(car.vy, car.vx) + (hashPos(p.x, p.y, 41) / 4294967296 - 0.5) * 0.8;
      p.fallT = 1;
      this.falling.push(p);
      car.vx *= 0.86; car.vy *= 0.86;
      car.crashT = 0.18;
      return true;
    }

    const d = Math.sqrt(d2) || 0.1;
    car.vx -= (dx / d) * 2;
    car.vy -= (dy / d) * 2;
    return true;
  }

  #hitSignal(s, car) {
    if (!s || s.alive === false) return false;
    let dx = car.x - s.x, dy = car.y - s.y;
    let d2 = dx * dx + dy * dy;
    if (d2 > SIGNAL_R * SIGNAL_R) return false;

    // a fast enough hit snaps even a signal pole (and never soft-locks a race line)
    if (this.#carSpeed(car) > 12) {
      s.alive = false;
      s.fallA = Math.atan2(car.vy, car.vx);
      s.fallT = 1;
      this.falling.push(s);
      car.vx *= 0.78; car.vy *= 0.78;
      car.crashT = 0.22;
      return true;
    }

    let d = Math.sqrt(d2);
    if (d < 0.001) {
      const spd = this.#carSpeed(car);
      dx = spd > 0.001 ? car.vx / spd : 1;
      dy = spd > 0.001 ? car.vy / spd : 0;
      d = 1;
      d2 = 0;
    }
    const nx = dx / d, ny = dy / d;
    car.x += nx * (SIGNAL_R - Math.sqrt(d2) + 0.02);
    car.y += ny * (SIGNAL_R - Math.sqrt(d2) + 0.02);

    const vn = car.vx * nx + car.vy * ny;
    if (vn < 0) {
      car.vx -= (1.4 * vn) * nx;
      car.vy -= (1.4 * vn) * ny;
    } else {
      car.vx *= 0.94; car.vy *= 0.94;
    }
    if (this.#carSpeed(car) > 5) car.crashT = 0.15;
    return true;
  }

  #hitParked(p, car) {
    if (!p) return false;
    const px = p.x + p.ox, py = p.y + p.oy;
    let dx = car.x - px, dy = car.y - py;
    let d2 = dx * dx + dy * dy;
    if (d2 > PARKED_R * PARKED_R) return false;

    let d = Math.sqrt(d2);
    const spd = this.#carSpeed(car);
    if (d < 0.001) {
      dx = spd > 0.001 ? car.vx / spd : 1;
      dy = spd > 0.001 ? car.vy / spd : 0;
      d = 1;
      d2 = 0;
    }
    const nx = dx / d, ny = dy / d;
    car.x += nx * (PARKED_R - Math.sqrt(d2) + 0.03);
    car.y += ny * (PARKED_R - Math.sqrt(d2) + 0.03);
    car.vx *= 0.78; car.vy *= 0.78;
    car.crashT = 0.2;
    this.#joltParked(p, car, nx, ny, spd);
    return true;
  }

  #joltParked(p, car, nx, ny, spd) {
    const inv = spd > 0.001 ? 1 / spd : 0;
    const vx = inv ? car.vx * inv : -nx;
    const vy = inv ? car.vy * inv : -ny;
    const amt = clamp(spd * 0.025 + 0.04, 0.06, 0.32);
    p.ox += vx * amt;
    p.oy += vy * amt;
    const drift = Math.hypot(p.ox, p.oy);
    if (drift > 1.2) {
      p.ox *= 1.2 / drift;
      p.oy *= 1.2 / drift;
    }
    const turn = nx * vy - ny * vx || (hashPos(p.x, p.y, 71) & 1 ? 1 : -1);
    p.oh = clamp(p.oh + turn * amt * 0.18, -0.35, 0.35);
  }

  #carSpeed(car) {
    return typeof car.speed === "function" ? car.speed() : Math.hypot(car.vx, car.vy);
  }

  #ensureCarSprites() {
    if (this.carSprites) return;
    this.carSprites = [];
    for (let i = 0; i < PARKED_COLORS.length; i++) {
      this.carSprites.push(makeCarSprite(PARKED_COLORS[i], "#1d1d22"));
    }
  }

  #drawParkedGrid(ctx, cam, r2, cx1, cx2, cy1, cy2) {
    for (let gx = cx1; gx <= cx2; gx++) {
      for (let gy = cy1; gy <= cy2; gy++) {
        const arr = this.parkedGrid.get(cellKey(gx, gy));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const p = this.parked[arr[i]];
          const x = p.x + p.ox, y = p.y + p.oy;
          const dx = x - cam.x, dy = y - cam.y;
          if (dx * dx + dy * dy > r2) continue;
          this.#ensureCarSprites();
          drawCarSprite(ctx, this.carSprites[p.sprite], x, y, p.h + p.oh);
        }
      }
    }
  }

  #drawStopsGrid(ctx, cam, r2, cx1, cx2, cy1, cy2) {
    for (let gx = cx1; gx <= cx2; gx++) {
      for (let gy = cy1; gy <= cy2; gy++) {
        const arr = this.stopGrid.get(cellKey(gx, gy));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const s = this.stops[arr[i]];
          const dx = s.x - cam.x, dy = s.y - cam.y;
          if (dx * dx + dy * dy > r2) continue;
          this.#drawStop(ctx, s, cam);
        }
      }
    }
  }

  #drawLampsGrid(ctx, cam, r2, cx1, cx2, cy1, cy2, lampIntensity) {
    for (let gx = cx1; gx <= cx2; gx++) {
      for (let gy = cy1; gy <= cy2; gy++) {
        const arr = this.lampGrid.get(cellKey(gx, gy));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const l = this.lamps[arr[i]];
          const dx = l.x - cam.x, dy = l.y - cam.y;
          if (dx * dx + dy * dy > r2) continue;
          this.#drawLamp(ctx, l, cam, lampIntensity);
        }
      }
    }
  }

  #drawSignalsGrid(ctx, cam, r2, cx1, cx2, cy1, cy2, time, lampIntensity) {
    for (let gx = cx1; gx <= cx2; gx++) {
      for (let gy = cy1; gy <= cy2; gy++) {
        const arr = this.signalGrid.get(cellKey(gx, gy));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const s = this.signals[arr[i]];
          const dx = s.x - cam.x, dy = s.y - cam.y;
          if (dx * dx + dy * dy > r2) continue;
          this.#drawTrafficLight(ctx, s, cam, time, lampIntensity);
        }
      }
    }
  }

  #drawFallen(ctx, p, len) {
    if (p.fallT <= 0) return;
    ctx.globalAlpha = Math.min(1, p.fallT * 2);
    ctx.strokeStyle = "#3d3a36";
    ctx.lineWidth = 0.35;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + Math.cos(p.fallA) * len, p.y + Math.sin(p.fallA) * len);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  #drawLamp(ctx, l, cam, lampIntensity) {
    if (!l.alive) {
      this.#drawFallen(ctx, l, 5.5);
      return;
    }
    const tx = l.x + (l.x - cam.x) * LAMP_LEAN;
    const ty = l.y + (l.y - cam.y) * LAMP_LEAN;

    if (lampIntensity > 0) {
      // pre-rendered glow sprite: one drawImage instead of a gradient per lamp
      if (!this.glowSprite) {
        const gc = document.createElement("canvas");
        gc.width = gc.height = 64;
        const gg = gc.getContext("2d");
        const grad = gg.createRadialGradient(32, 32, 0, 32, 32, 32);
        grad.addColorStop(0, "rgba(255,205,95,0.38)");
        grad.addColorStop(1, "rgba(255,205,95,0)");
        gg.fillStyle = grad;
        gg.fillRect(0, 0, 64, 64);
        this.glowSprite = gc;
      }
      ctx.globalAlpha = lampIntensity;
      ctx.drawImage(this.glowSprite, l.x - 9, l.y - 9, 18, 18);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = "rgba(25,20,15,0.3)";
    ctx.fillRect(l.x - 0.4, l.y - 0.4, 0.8, 0.8);
    ctx.strokeStyle = "#46423c";
    ctx.lineWidth = 0.32;
    ctx.beginPath();
    ctx.moveTo(l.x, l.y);
    ctx.lineTo(tx, ty);
    ctx.stroke();

    ctx.fillStyle = `rgba(255,214,120,${0.18 + lampIntensity * 0.34})`;
    ctx.beginPath();
    ctx.arc(tx, ty, 1.6 + lampIntensity * 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffd678";
    ctx.fillRect(tx - 0.42, ty - 0.42, 0.84, 0.84);
  }

  #drawStop(ctx, s, cam) {
    if (!s.alive) {
      this.#drawFallen(ctx, s, 3.0);
      return;
    }
    const tx = s.x + (s.x - cam.x) * SIGN_LEAN;
    const ty = s.y + (s.y - cam.y) * SIGN_LEAN;
    ctx.fillStyle = "rgba(25,20,15,0.28)";
    ctx.fillRect(s.x - 0.32, s.y - 0.32, 0.64, 0.64);
    ctx.strokeStyle = "#3a3833";
    ctx.lineWidth = 0.24;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(tx, ty);
    ctx.stroke();

    ctx.fillStyle = "#b92d29";
    this.#octagon(ctx, tx, ty, 0.56);
    ctx.fill();
    ctx.strokeStyle = "#f6eee1";
    ctx.lineWidth = 0.08;
    ctx.stroke();
  }

  #drawTrafficLight(ctx, l, cam, time, lampIntensity) {
    if (!l.alive) {
      this.#drawFallen(ctx, l, 4.5);
      return;
    }
    const tx = l.x + (l.x - cam.x) * LIGHT_LEAN;
    const ty = l.y + (l.y - cam.y) * LIGHT_LEAN;
    ctx.fillStyle = "rgba(25,20,15,0.3)";
    ctx.fillRect(l.x - 0.4, l.y - 0.4, 0.8, 0.8);
    ctx.strokeStyle = "#3a3833";
    ctx.lineWidth = 0.36;
    ctx.beginPath();
    ctx.moveTo(l.x, l.y);
    ctx.lineTo(tx, ty);
    ctx.stroke();

    ctx.fillStyle = "#2d2b28";
    ctx.fillRect(tx - 0.55, ty - 1.05, 1.1, 2.1);

    const green = ((time / 3.5 + l.phase) % 2) < 1;
    const lx = tx;
    const ly = green ? ty + 0.5 : ty - 0.5;
    if (lampIntensity > 0) {
      ctx.fillStyle = green ? `rgba(95,224,122,${lampIntensity * 0.22})` : `rgba(255,90,82,${lampIntensity * 0.22})`;
      ctx.beginPath();
      ctx.arc(lx, ly, 1.05, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = green ? "#5fe07a" : "#ff5a52";
    ctx.fillRect(tx - 0.32, green ? ty + 0.18 : ty - 0.82, 0.64, 0.64);
  }

  #octagon(ctx, x, y, r) {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + i * Math.PI / 4;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }
}
