// Chunk-streamed ambient traffic around the player. Cars keep only a road
// reference and arclength, so the active set scales with nearby streets.

import { makeCarSprite, drawCarSprite } from "./car.js";

const COLORS = ["#c9c3b4", "#5d7a8e", "#8a6f55", "#d9b04a", "#a8443c", "#d9b04a", "#6e7d5a", "#7a5d80"];
const TARGET_CARS = 70;
const QUERY_R = 600;
const DESPAWN_R2 = 750 * 750;
const MIN_SPAWN_R2 = 120 * 120;
const SPAWN_TRIES = 28;
const SPAWNS_PER_TICK = 4;

export class Traffic {
  constructor(world) {
    this.world = world;
    this.cars = [];
    this.sprites = null;
    this.tmp = { x: 0, y: 0, tx: 1, ty: 0 };
  }

  update(dt, player) {
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      const dx = c.x - player.x, dy = c.y - player.y;
      if (dx * dx + dy * dy > DESPAWN_R2) this.cars.splice(i, 1);
    }

    this.#spawnNear(player);
    this.#applySpacing(dt);

    for (const c of this.cars) {
      if (c.stopT > 0) c.stopT = Math.max(0, c.stopT - dt);

      c.s += c.v * c.dir * dt;
      if (c.s <= 0 || c.s >= c.len) {
        // reached the end of this road piece: hop onto a connecting road so
        // traffic roams the whole city instead of ping-ponging in place
        this.#hopJunction(c);
      }

      pointAt(c.road.p, c.s, c.pos);
      const off = c.road.w * 0.22;
      const tx = c.pos.tx * c.dir, ty = c.pos.ty * c.dir;
      c.x = c.pos.x + -ty * off;
      c.y = c.pos.y + tx * off;
      c.h += angDiff(Math.atan2(ty, tx), c.h) * Math.min(1, 8 * dt);

      const dx = player.x - c.x, dy = player.y - c.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 7.5) {
        const d = Math.sqrt(d2) || 0.1;
        const push = (2.8 - d) * 8;
        player.vx += (dx / d) * push;
        player.vy += (dy / d) * push;
        player.vx *= 0.82; player.vy *= 0.82;
        player.crashT = 0.2;
        c.v = 0;
        c.stopT = Math.max(c.stopT, 1.5);
      }
    }
  }

  draw(ctx, camX, camY, viewR, light) {
    const r2 = viewR * viewR;
    if (light && light.headlights) {
      ctx.save();
      for (const c of this.cars) {
        const dx = c.x - camX, dy = c.y - camY;
        if (dx * dx + dy * dy <= r2) this.#drawLights(ctx, c);
      }
      ctx.restore();
    }

    for (const c of this.cars) {
      const dx = c.x - camX, dy = c.y - camY;
      if (dx * dx + dy * dy > r2) continue;
      drawCarSprite(ctx, c.sprite, c.x, c.y, c.h, c.stopT > 0);
    }
  }

  #spawnNear(player) {
    const need = Math.min(TARGET_CARS - this.cars.length, SPAWNS_PER_TICK);
    if (need <= 0) return;

    const roads = this.world.roadsNear(player.x, player.y, QUERY_R);
    if (!roads || !roads.length) return;

    let spawned = 0;
    for (let tries = 0; spawned < need && tries < SPAWN_TRIES; tries++) {
      const road = roads[(Math.random() * roads.length) | 0];
      if (!road || road.r < 1 || !road.p || road.p.length < 4) continue;

      const len = polyLen(road.p);
      if (len < 35) continue;

      const s = Math.random() * len;
      const dir = Math.random() < 0.5 ? 1 : -1;
      pointAt(road.p, s, this.tmp);
      const tx = this.tmp.tx * dir, ty = this.tmp.ty * dir;
      const off = road.w * 0.22;
      const x = this.tmp.x + -ty * off;
      const y = this.tmp.y + tx * off;
      const dx = x - player.x, dy = y - player.y;
      if (dx * dx + dy * dy < MIN_SPAWN_R2 && tries + need < SPAWN_TRIES) continue;

      const rankBoost = Math.min(3, Math.max(0, road.r || 0) * 0.55);
      const baseV = Math.min(13, 7 + Math.random() * 3.4 + rankBoost);
      const spriteIndex = (Math.random() * COLORS.length) | 0;
      const car = {
        road, len, s, dir, x, y,
        h: Math.atan2(ty, tx),
        v: baseV, baseV, stopT: 0,
        sprite: this.#sprite(spriteIndex),
        pos: { x: this.tmp.x, y: this.tmp.y, tx: this.tmp.tx, ty: this.tmp.ty },
      };
      this.cars.push(car);
      spawned++;
    }
  }

  #hopJunction(c) {
    const p = c.road.p;
    const atStart = c.s <= 0;
    const ex = atStart ? p[0] : p[p.length - 2];
    const ey = atStart ? p[1] : p[p.length - 1];

    const near = this.world.roadsNear(ex, ey, 20);
    let next = null, nextAtStart = true, count = 0;
    for (const r of near) {
      if (!r || r.r < 1 || !r.p || r.p.length < 4) continue;
      const q = r.p;
      const ds = (q[0] - ex) * (q[0] - ex) + (q[1] - ey) * (q[1] - ey);
      const de = (q[q.length - 2] - ex) * (q[q.length - 2] - ex) + (q[q.length - 1] - ey) * (q[q.length - 1] - ey);
      const connectsStart = ds < 36, connectsEnd = de < 36;
      if (!connectsStart && !connectsEnd) continue;
      if (r === c.road && near.length > 1) continue; // avoid instant U-turn when possible
      count++;
      // reservoir-sample one option uniformly
      if (Math.random() < 1 / count) {
        next = r;
        nextAtStart = connectsStart || (connectsStart && connectsEnd && Math.random() < 0.5);
        if (!connectsStart) nextAtStart = false;
      }
    }

    if (!next) { // dead end: turn around
      c.dir *= -1;
      c.s = Math.max(0.1, Math.min(c.len - 0.1, c.s));
      return;
    }
    c.road = next;
    c.len = polyLen(next.p);
    if (nextAtStart) { c.s = 0.1; c.dir = 1; }
    else { c.s = c.len - 0.1; c.dir = -1; }
  }

  #applySpacing(dt) {
    for (const c of this.cars) {
      let target = c.stopT > 0 ? 0 : c.baseV;
      const fx = Math.cos(c.h), fy = Math.sin(c.h);

      for (const o of this.cars) {
        if (o === c) continue;
        const dx = o.x - c.x, dy = o.y - c.y;
        if (dx < -10 || dx > 10 || dy < -10 || dy > 10) continue;
        const ahead = dx * fx + dy * fy;
        if (ahead <= 0 || ahead > 9) continue;
        const side = Math.abs(dx * -fy + dy * fx);
        if (side > 3.2 || Math.abs(angDiff(o.h, c.h)) > 0.65) continue;
        target = Math.min(target, Math.max(0, o.v - 1.2));
      }

      const rate = target < c.v ? 8 : 1.6;
      c.v += (target - c.v) * Math.min(1, rate * dt);
    }
  }

  #drawLights(ctx, c) {
    const fx = Math.cos(c.h), fy = Math.sin(c.h);
    const rx = -fy, ry = fx;
    const frontX = c.x + fx * 2.05, frontY = c.y + fy * 2.05;

    ctx.fillStyle = "rgba(255,236,185,0.10)";
    for (let side = -1; side <= 1; side += 2) {
      const sx = frontX + rx * side * 0.62;
      const sy = frontY + ry * side * 0.62;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + fx * 7 + rx * side * 0.95, sy + fy * 7 + ry * side * 0.95);
      ctx.lineTo(sx + fx * 7 - rx * side * 0.25, sy + fy * 7 - ry * side * 0.25);
      ctx.closePath();
      ctx.fill();
    }

    const rearX = c.x - fx * 2.05, rearY = c.y - fy * 2.05;
    ctx.fillStyle = "rgba(255,60,48,0.65)";
    ctx.fillRect(rearX + rx * 0.62 - 0.08, rearY + ry * 0.62 - 0.08, 0.16, 0.16);
    ctx.fillRect(rearX - rx * 0.62 - 0.08, rearY - ry * 0.62 - 0.08, 0.16, 0.16);
  }

  #sprite(index) {
    if (!this.sprites) this.sprites = COLORS.map((color) => makeCarSprite(color));
    return this.sprites[index % this.sprites.length];
  }
}

function polyLen(p) {
  if (p._len !== undefined) return p._len;
  let L = 0;
  for (let i = 0; i + 3 < p.length; i += 2) L += Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
  p._len = L;
  return L;
}

function pointAt(p, s, out = { x: 0, y: 0, tx: 1, ty: 0 }) {
  let acc = 0;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const dx = p[i + 2] - p[i], dy = p[i + 3] - p[i + 1];
    const seg = Math.hypot(dx, dy);
    if (acc + seg >= s) {
      const t = seg ? (s - acc) / seg : 0;
      out.x = p[i] + dx * t;
      out.y = p[i + 1] + dy * t;
      out.tx = dx / (seg || 1);
      out.ty = dy / (seg || 1);
      return out;
    }
    acc += seg;
  }
  const n = p.length;
  const dx = p[n - 2] - p[n - 4], dy = p[n - 1] - p[n - 3];
  const seg = Math.hypot(dx, dy) || 1;
  out.x = p[n - 2];
  out.y = p[n - 1];
  out.tx = dx / seg;
  out.ty = dy / seg;
  return out;
}

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
