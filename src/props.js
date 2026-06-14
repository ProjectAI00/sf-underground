// Streamed street furniture: real poles from map chunks, synthetic fill where
// OSM is sparse, and cheap spatial grids for draw/collision hot loops.

import { drawCarSprite, makeCarSprite } from "./car.js";
import { elevOffset } from "./terrain.js";

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
      if (!fixed) continue; // Skip if on highway
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
      if (!fixed) continue;
      this.#addSignal(fixed[0], fixed[1]);
    }

    const stops = chunk?.stops || [];
    for (let i = 0; i < stops.length; i++) {
      const p = stops[i];
      if (!p || p.length < 2) continue;
      const fixed = this.#offRoad(p[0], p[1]);
      if (!fixed) continue;
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

  draw(ctx, cam, viewR, time, light, playerSpeed = 0) {
    const r2 = viewR * viewR;
    const cx1 = Math.floor((cam.x - viewR) / CELL), cx2 = Math.floor((cam.x + viewR) / CELL);
    const cy1 = Math.floor((cam.y - viewR) / CELL), cy2 = Math.floor((cam.y + viewR) / CELL);
    const lampIntensity = clamp(light?.lampIntensity || 0, 0, 1);
    
    // LOD: skip some details at high speed for performance
    const highSpeed = playerSpeed > 50; // ~180 km/h
    const veryHighSpeed = playerSpeed > 75; // ~270 km/h

    // Always draw parked cars
    this.#drawParkedGrid(ctx, cam, r2, cx1, cx2, cy1, cy2);

    ctx.lineCap = "round";
    
    // Stop signs - skip at very high speed
    if (!veryHighSpeed) {
      this.#drawStopsGrid(ctx, cam, r2, cx1, cx2, cy1, cy2);
    }
    
    // Lamps - always draw (important for night visibility)
    this.#drawLampsGrid(ctx, cam, r2, cx1, cx2, cy1, cy2, lampIntensity, time || 0);
    
    // Traffic lights - always draw (gameplay important)
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
      const off = (r.w || 7) / 2 + 4;
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
              if (fixed) this.#addLamp(fixed[0], fixed[1]);
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
      // Place parked cars further off road so they don't block driving
      const off = Math.max(2.5, (r.w || 6) / 2 + 0.5);
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
    if (!nr) return [x, y];
    
    // Skip if on a freeway/highway (rank 4+) - no lamps in the middle of highways
    if (nr.road.r >= 4 && nr.d < nr.road.w / 2 + 2) return null;
    
    if (nr.d > nr.road.w / 2 + 0.4) return [x, y];
    
    // push out perpendicular to the road, on the side the pole leans toward
    let sx = x - nr.x, sy = y - nr.y;
    const d = Math.hypot(sx, sy);
    if (d < 0.3) { sx = -nr.ty; sy = nr.tx; }
    else { sx /= d; sy /= d; }
    const off = nr.road.w / 2 + 2.5;
    
    const newX = Math.round((nr.x + sx * off) * 10) / 10;
    const newY = Math.round((nr.y + sy * off) * 10) / 10;
    
    // Double-check the new position isn't on another road
    const nr2 = this.world.nearestRoad(newX, newY, 20);
    if (nr2 && nr2.d < nr2.road.w / 2) {
      // Still on a road, push further
      const off2 = nr2.road.w / 2 + 2.5;
      return [
        Math.round((nr2.x + sx * off2) * 10) / 10,
        Math.round((nr2.y + sy * off2) * 10) / 10,
      ];
    }
    
    return [newX, newY];
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
          const vy = y + elevOffset(x, y);
          drawCarSprite(ctx, this.carSprites[p.sprite], x, vy, p.h + p.oh);
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

  #drawLampsGrid(ctx, cam, r2, cx1, cx2, cy1, cy2, lampIntensity, time) {
    for (let gx = cx1; gx <= cx2; gx++) {
      for (let gy = cy1; gy <= cy2; gy++) {
        const arr = this.lampGrid.get(cellKey(gx, gy));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const l = this.lamps[arr[i]];
          const dx = l.x - cam.x, dy = l.y - cam.y;
          if (dx * dx + dy * dy > r2) continue;
          this.#drawLamp(ctx, l, cam, lampIntensity, time);
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

  #drawLamp(ctx, l, cam, lampIntensity, time) {
    const eOff = elevOffset(l.x, l.y);
    const baseY = l.y + eOff;
    if (!l.alive) {
      this.#drawFallen(ctx, { ...l, y: baseY }, 5.5);
      return;
    }
    const tx = l.x + (l.x - cam.x) * LAMP_LEAN;
    const ty = baseY + (baseY - cam.y) * LAMP_LEAN;

    if (lampIntensity > 0) {
      const flick = 0.96 + 0.04 * Math.sin(time * 3 + l.x * 0.2);
      const a = lampIntensity * flick;
      
      // Large ground light pool - illuminates road
      const poolR = 22;
      const grad = ctx.createRadialGradient(l.x, baseY, 0, l.x, baseY, poolR);
      grad.addColorStop(0, `rgba(255,230,180,${a * 0.4})`);
      grad.addColorStop(0.25, `rgba(255,215,150,${a * 0.25})`);
      grad.addColorStop(0.5, `rgba(255,200,120,${a * 0.12})`);
      grad.addColorStop(0.75, `rgba(255,180,100,${a * 0.04})`);
      grad.addColorStop(1, "rgba(255,160,80,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(l.x, baseY, poolR, poolR * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      
      // Lamp glow halo
      const glowR = 4;
      const glow = ctx.createRadialGradient(tx, ty, 0, tx, ty, glowR);
      glow.addColorStop(0, `rgba(255,240,180,${a * 0.85})`);
      glow.addColorStop(0.4, `rgba(255,210,120,${a * 0.4})`);
      glow.addColorStop(1, "rgba(255,180,80,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(tx, ty, glowR, 0, Math.PI * 2);
      ctx.fill();
    }

    // Pole shadow
    ctx.fillStyle = "rgba(20,18,15,0.2)";
    ctx.fillRect(l.x + 0.15, baseY + 0.15, 0.4, 0.4);
    
    // Pole
    ctx.strokeStyle = "#3a3530";
    ctx.lineWidth = 0.28;
    ctx.beginPath();
    ctx.moveTo(l.x, baseY);
    ctx.lineTo(tx, ty);
    ctx.stroke();

    // Lamp housing
    ctx.fillStyle = "#2a2825";
    ctx.fillRect(tx - 0.35, ty - 0.2, 0.7, 0.4);
    
    // Light bulb (bright point)
    if (lampIntensity > 0) {
      ctx.fillStyle = "#fffae0";
      ctx.fillRect(tx - 0.18, ty - 0.1, 0.36, 0.2);
    }
  }

  #drawStop(ctx, s, cam) {
    const eOff = elevOffset(s.x, s.y);
    const baseY = s.y + eOff;
    if (!s.alive) {
      this.#drawFallen(ctx, { ...s, y: baseY }, 3.0);
      return;
    }
    const tx = s.x + (s.x - cam.x) * SIGN_LEAN;
    const ty = baseY + (baseY - cam.y) * SIGN_LEAN;
    ctx.fillStyle = "rgba(25,20,15,0.28)";
    ctx.fillRect(s.x - 0.32, baseY - 0.32, 0.64, 0.64);
    ctx.strokeStyle = "#3a3833";
    ctx.lineWidth = 0.24;
    ctx.beginPath();
    ctx.moveTo(s.x, baseY);
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
    const eOff = elevOffset(l.x, l.y);
    const baseY = l.y + eOff;
    if (!l.alive) {
      this.#drawFallen(ctx, { ...l, y: baseY }, 4.5);
      return;
    }
    const tx = l.x + (l.x - cam.x) * LIGHT_LEAN;
    const ty = baseY + (baseY - cam.y) * LIGHT_LEAN;
    
    // Shadow
    ctx.fillStyle = "rgba(25,20,15,0.3)";
    ctx.fillRect(l.x - 0.4, baseY - 0.4, 0.8, 0.8);
    
    // Pole
    ctx.strokeStyle = "#3a3833";
    ctx.lineWidth = 0.36;
    ctx.beginPath();
    ctx.moveTo(l.x, baseY);
    ctx.lineTo(tx, ty);
    ctx.stroke();

    // Housing (3-light vertical)
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(tx - 0.65, ty - 1.4, 1.3, 2.8);
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 0.1;
    ctx.strokeRect(tx - 0.65, ty - 1.4, 1.3, 2.8);

    // Realistic timing: 25s green, 4s yellow, 25s red (54s cycle)
    const cycle = 54;
    const phase = ((time + l.phase * cycle) % cycle);
    let color = "red";
    if (phase < 25) color = "green";
    else if (phase < 29) color = "yellow";
    // else red (29-54)

    // Draw all three lights (dim when off)
    const lights = [
      { y: ty - 0.85, color: "red", on: color === "red" },
      { y: ty, color: "yellow", on: color === "yellow" },
      { y: ty + 0.85, color: "green", on: color === "green" }
    ];
    
    const colors = {
      red: { on: "#ff3030", off: "#401010", glow: "rgba(255,60,60," },
      yellow: { on: "#ffcc00", off: "#403000", glow: "rgba(255,200,0," },
      green: { on: "#30ff50", off: "#103010", glow: "rgba(60,255,80," }
    };

    for (const light of lights) {
      const c = colors[light.color];
      
      // Glow when on
      if (light.on && lampIntensity > 0) {
        ctx.fillStyle = c.glow + (lampIntensity * 0.25) + ")";
        ctx.beginPath();
        ctx.arc(tx, light.y, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      
      // Light circle
      ctx.fillStyle = light.on ? c.on : c.off;
      ctx.beginPath();
      ctx.arc(tx, light.y, 0.35, 0, Math.PI * 2);
      ctx.fill();
      
      // Bright center when on
      if (light.on) {
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        ctx.beginPath();
        ctx.arc(tx, light.y, 0.15, 0, Math.PI * 2);
        ctx.fill();
      }
    }
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
