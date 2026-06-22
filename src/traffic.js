// Chunk-streamed ambient traffic around the player. Cars keep only a road
// reference and arclength, so the active set scales with nearby streets.
// Civilian driving: spline follow, corner slowdown, one-way, no drift/race AI.

import { makeCarSprite, makeWaymoSprite, drawCarSprite, drawHeadlightBeams } from "./car.js";
import { elevOffset } from "./terrain.js";
import { cornerSpeedMul, distToEnd, headingAt } from "./traffic-drive.js";

const COLORS = ["#c9c3b4", "#5d7a8e", "#8a6f55", "#d9b04a", "#a8443c", "#d9b04a", "#6e7d5a", "#7a5d80", "#3a3a42", "#e8e4d8", "#6b4423", "#2d4a5e"];
const BASE_TARGET_CARS = 50;  // reduced from 90 for performance
const WAYMO_CHANCE = 0.10;
let waymoSprite = null;

function getTrafficTarget() {
  // No traffic during intro cinematic
  if (globalThis.__introNoTraffic) return 0;
  // Intro boost for more cars on road during tutorial
  if (globalThis.__introTrafficBoost) return Math.floor(BASE_TARGET_CARS * 1.6);
  
  const forced = globalThis.__forceHour;
  const hour = typeof forced === "number" ? forced : new Date().getHours();
  
  // Rush hours: 7-9am, 5-7pm = heavy traffic
  // Night 11pm-5am = light traffic
  // Midday/evening = moderate
  if (hour >= 7 && hour < 9) return Math.floor(BASE_TARGET_CARS * 1.5);   // morning rush
  if (hour >= 17 && hour < 19) return Math.floor(BASE_TARGET_CARS * 1.4); // evening rush
  if (hour >= 23 || hour < 5) return Math.floor(BASE_TARGET_CARS * 0.3);  // late night
  if (hour >= 5 && hour < 7) return Math.floor(BASE_TARGET_CARS * 0.5);   // early morning
  if (hour >= 12 && hour < 14) return Math.floor(BASE_TARGET_CARS * 1.1); // lunch traffic
  return BASE_TARGET_CARS;
}
const QUERY_R = 1000;
const BASE_DESPAWN_R = 1100;
const MIN_SPAWN_R2 = 120 * 120;
const SPAWN_TRIES = 80;
const SPAWNS_PER_TICK = 20;

export class Traffic {
  constructor(world) {
    this.world = world;
    this.cars = [];
    this.sprites = null;
    this.tmp = { x: 0, y: 0, tx: 1, ty: 0 };
  }

  update(dt, player, viewR = 200) {
    // Never despawn cars visible on screen - only despawn far outside view
    // Use generous buffer: at least viewR + 300m or BASE_DESPAWN_R
    const minDespawnR = Math.max(viewR + 300, BASE_DESPAWN_R);
    const despawnR2 = minDespawnR * minDespawnR;
    
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      const dx = c.x - player.x, dy = c.y - player.y;
      const dist2 = dx * dx + dy * dy;
      // Only despawn if WELL outside view range
      if (dist2 > despawnR2) this.cars.splice(i, 1);
    }

    this.#spawnNear(player);
    this.#applyCivilDriving(dt);
    this.#applySpacing(dt);

    for (const c of this.cars) {
      if (c.stopT > 0) c.stopT = Math.max(0, c.stopT - dt);
      
      // Waymos are extra cautious - slow down when player is close behind
      if (c.isWaymo) {
        const dx = c.x - player.x, dy = c.y - player.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 25 && dist > 3) {
          // Check if player is approaching from behind
          const playerDir = Math.atan2(player.vy, player.vx);
          const toCarAngle = Math.atan2(dy, dx);
          const angleDiff = Math.abs(playerDir - toCarAngle);
          if (angleDiff < 0.8) {
            // Player approaching - Waymo slows down dramatically (confused robot)
            c.v = Math.max(2, c.v * 0.95);
          }
        } else if (dist > 40) {
          // Resume normal speed when player far
          c.v = Math.min(c.v + dt * 2, c.baseV);
        }
      }

      c.s += c.v * c.dir * dt;
      if (c.s <= 0 || c.s >= c.len) {
        // reached the end of this road piece: hop onto a connecting road so
        // traffic roams the whole city instead of ping-ponging in place
        this.#hopJunction(c);
      }

      pointAt(c.road.p, c.s, c.pos);
      const laneOff = c.road.w * 0.22 * c.dir;
      const tx = c.pos.tx * c.dir, ty = c.pos.ty * c.dir;
      c.x = c.pos.x + -c.pos.ty * laneOff;
      c.y = c.pos.y + c.pos.tx * laneOff;
      const lookS = Math.max(0, Math.min(c.len, c.s + c.dir * (6 + c.v * 0.15)));
      const targetH = headingAt(c.road.p, lookS, c.dir);
      c.h += angDiff(targetH, c.h) * Math.min(1, 4.5 * dt);

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

  draw(ctx, camX, camY, viewR, light, player = null) {
    // Use player position for culling if available (more stable than camera which has shake)
    const cullX = player?.x ?? camX;
    const cullY = player?.y ?? camY;
    // Very generous draw radius - never cull cars that might be visible
    const drawR = viewR + 100;
    const r2 = drawR * drawR;
    
    if (light && light.headlights) {
      ctx.save();
      for (const c of this.cars) {
        const dx = c.x - cullX, dy = c.y - cullY;
        if (dx * dx + dy * dy <= r2) this.#drawLights(ctx, c);
      }
      ctx.restore();
    }

    for (const c of this.cars) {
      const dx = c.x - cullX, dy = c.y - cullY;
      if (dx * dx + dy * dy > r2) continue;
      const vy = c.y + elevOffset(c.x, c.y);
      drawCarSprite(ctx, c.sprite, c.x, vy, c.h, c.stopT > 0, true);
    }
  }

  #spawnNear(player) {
    const target = getTrafficTarget();
    const need = Math.min(target - this.cars.length, SPAWNS_PER_TICK);
    if (need <= 0) return;

    // Player velocity for checking spawn path
    const pSpeed = Math.hypot(player.vx || 0, player.vy || 0);
    const speedKmh = pSpeed * 3.6;
    
    // Increase query radius at high speeds to find roads further out
    const queryR = speedKmh > 180 ? 1200 : speedKmh > 120 ? 1000 : QUERY_R;
    const roads = this.world.roadsNear(player.x, player.y, queryR);
    if (!roads || !roads.length) return;

    const pvx = pSpeed > 1 ? player.vx / pSpeed : Math.cos(player.h);
    const pvy = pSpeed > 1 ? player.vy / pSpeed : Math.sin(player.h);

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
      // Each direction stays on its side of the road (right-hand traffic)
      // dir=1 goes along road direction -> offset to the right (-ty, tx)
      // dir=-1 goes opposite -> offset to the left (ty, -tx)
      const laneOff = road.w * 0.22 * dir;
      const x = this.tmp.x + -this.tmp.ty * laneOff;
      const y = this.tmp.y + this.tmp.tx * laneOff;
      const dx = x - player.x, dy = y - player.y;
      const dist2 = dx * dx + dy * dy;
      
      // Don't spawn too close - scale with player speed
      // Spawn further out so cars are already there when you arrive
      const minSpawnDist = speedKmh > 180 ? 280 : speedKmh > 120 ? 200 : 120;
      if (dist2 < minSpawnDist * minSpawnDist) continue;
      
      // CRITICAL: Don't spawn in player's driving path
      // Check if spawn point is ahead of player and in their lane
      const dist = Math.sqrt(dist2);
      const dotAhead = (dx * pvx + dy * pvy) / dist;
      const aheadDist = dist * dotAhead;
      
      // Scale ahead-check distance with speed - at 200km/h need 500m clearance
      const aheadClearance = speedKmh > 180 ? 500 : speedKmh > 120 ? 400 : 300;
      const lateralClearance = speedKmh > 180 ? 25 : speedKmh > 120 ? 20 : 15;
      
      // If car would spawn ahead of player in their path, skip
      if (dotAhead > 0.6 && aheadDist < aheadClearance) {
        const lateralDist = Math.abs(dx * pvy - dy * pvx);
        if (lateralDist < lateralClearance) continue;
      }

      const isWaymo = Math.random() < WAYMO_CHANCE;
      const rankBoost = Math.min(3, Math.max(0, road.r || 0) * 0.55);
      // Waymos drive slower and more cautiously
      const baseV = isWaymo 
        ? Math.min(9, 5 + Math.random() * 2)  // Waymo: slow, cautious
        : Math.min(13, 7 + Math.random() * 3.4 + rankBoost);
      const spriteIndex = (Math.random() * COLORS.length) | 0;
      const car = {
        road, len, s, dir, x, y,
        h: Math.atan2(ty, tx),
        v: baseV, baseV, stopT: 0, yieldT: 0,
        sprite: isWaymo ? this.#waymoSprite() : this.#sprite(spriteIndex),
        isWaymo,
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

    // Search wider radius for connecting roads
    const near = this.world.roadsNear(ex, ey, 60);
    let next = null, nextAtStart = true, count = 0;
    let candidates = [];
    
    for (const r of near) {
      if (!r || r.r < 1 || !r.p || r.p.length < 4) continue;
      const q = r.p;
      const ds = (q[0] - ex) * (q[0] - ex) + (q[1] - ey) * (q[1] - ey);
      const de = (q[q.length - 2] - ex) * (q[q.length - 2] - ex) + (q[q.length - 1] - ey) * (q[q.length - 1] - ey);
      
      // Larger connection threshold (15m = 225 sq)
      const connectsStart = ds < 225, connectsEnd = de < 225;
      if (!connectsStart && !connectsEnd) continue;
      if (r === c.road) continue;
      // One-way: must enter from correct end
      if (r.ow) {
        if (connectsEnd && !connectsStart) continue;
      }
      
      // Collect all candidates with their distances
      const minDist = Math.min(connectsStart ? ds : Infinity, connectsEnd ? de : Infinity);
      candidates.push({ r, connectsStart, connectsEnd, ds, de, minDist });
    }
    
    if (candidates.length === 0) {
      // Dead end: turn around
      c.dir *= -1;
      c.s = Math.max(0.1, Math.min(c.len - 0.1, c.s));
      return;
    }
    
    // Prefer continuing straight-ish; slight randomness among good options
    const inH = Math.atan2(c.dir * (atStart ? p[3] - p[1] : p[p.length - 1] - p[p.length - 3]),
      c.dir * (atStart ? p[2] - p[0] : p[p.length - 2] - p[p.length - 4]));
    for (const cand of candidates) {
      const q = cand.r.p;
      const fwdH = cand.connectsStart && (!cand.connectsEnd || cand.ds <= cand.de)
        ? Math.atan2(q[3] - q[1], q[2] - q[0])
        : Math.atan2(q[q.length - 1] - q[q.length - 3], q[q.length - 2] - q[q.length - 4]);
      cand.align = Math.cos(fwdH - inH);
    }
    candidates.sort((a, b) => (b.align - a.align) || (a.minDist - b.minDist));
    const top = candidates.filter((cand) => cand.align >= candidates[0].align - 0.15).slice(0, 3);
    const pick = top[(Math.random() * top.length) | 0];
    next = pick.r;
    // Determine direction: enter from the end that's closest
    if (pick.connectsStart && pick.connectsEnd) {
      nextAtStart = pick.ds <= pick.de || Math.random() < 0.5;
    } else {
      nextAtStart = pick.connectsStart;
    }
    
    c.road = next;
    c.len = polyLen(next.p);
    if (next.ow) {
      c.s = 0.1;
      c.dir = 1;
    } else if (nextAtStart) {
      c.s = 0.1;
      c.dir = 1;
    } else {
      c.s = c.len - 0.1;
      c.dir = -1;
    }
    if (pick.align < 0.35) c.yieldT = Math.max(c.yieldT, 0.5);
  }

  /** Corner slowdown + junction yield — sets c.driveV target only. */
  #applyCivilDriving(dt) {
    for (const c of this.cars) {
      if (c.stopT > 0) { c.driveV = 0; continue; }

      let target = c.baseV;
      target *= cornerSpeedMul(c.road.p, c.s, c.dir, c.v);

      const endD = distToEnd(c.len, c.s, c.dir);
      if (endD < 14) target = Math.min(target, c.baseV * (0.45 + endD / 28));

      if (c.yieldT > 0) {
        c.yieldT -= dt;
        target = Math.min(target, 4 + c.baseV * 0.25);
      }

      if (c.isWaymo) target = Math.min(target, c.baseV * 0.92);

      c.driveV = target;
    }
  }

  #applySpacing(dt) {
    for (const c of this.cars) {
      let target = c.stopT > 0 ? 0 : (c.driveV ?? c.baseV);
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
    const vy = c.y + elevOffset(c.x, c.y);
    drawHeadlightBeams(ctx, c.x, vy, c.h, 0.72);
    const fx = Math.cos(c.h), fy = Math.sin(c.h);
    const rx = -fy, ry = fx;
    const rearX = c.x - fx * 2.05, rearY = vy - fy * 2.05;
    ctx.fillStyle = "rgba(255,60,48,0.65)";
    ctx.fillRect(rearX + rx * 0.62 - 0.08, rearY + ry * 0.62 - 0.08, 0.16, 0.16);
    ctx.fillRect(rearX - rx * 0.62 - 0.08, rearY - ry * 0.62 - 0.08, 0.16, 0.16);
  }

  #sprite(index) {
    if (!this.sprites) this.sprites = COLORS.map((color) => makeCarSprite(color));
    return this.sprites[index % this.sprites.length];
  }
  
  #waymoSprite() {
    if (!waymoSprite) waymoSprite = makeWaymoSprite();
    return waymoSprite;
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
