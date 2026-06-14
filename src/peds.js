import { elevOffset } from "./terrain.js";

const SHIRTS = ["#4778a8", "#b84f47", "#5f8c54", "#d6a64a", "#7d5ea8", "#c87542", "#4f9a98", "#d8d3bd"];
const SKIN = ["#c98f65", "#8e5c43", "#dfb38a"];
const HAIR = ["#211915", "#5a3b26", "#d8c27a"];
const BASE_TARGET_PEDS = 35;  // reduced from 60 for performance

function getPedTarget() {
  const forced = globalThis.__forceHour;
  const hour = typeof forced === "number" ? forced : new Date().getHours();
  
  // Daytime busy, night quiet
  if (hour >= 11 && hour < 14) return Math.floor(BASE_TARGET_PEDS * 1.4);  // lunch crowds
  if (hour >= 17 && hour < 20) return Math.floor(BASE_TARGET_PEDS * 1.3);  // evening activity
  if (hour >= 23 || hour < 6) return Math.floor(BASE_TARGET_PEDS * 0.15);  // late night
  if (hour >= 6 && hour < 8) return Math.floor(BASE_TARGET_PEDS * 0.5);    // early morning
  if (hour >= 8 && hour < 11) return Math.floor(BASE_TARGET_PEDS * 1.1);   // morning commute
  return BASE_TARGET_PEDS;
}
const QUERY_R = 220;
const DESPAWN_R2 = 280 * 280;
const MIN_SPAWN_R2 = 40 * 40;
const SPAWN_TRIES = 26;
const SPAWNS_PER_TICK = 3;

export class Peds {
  constructor(world) {
    this.world = world;
    this.peds = [];
    this.sprites = null;
    this.tmp = { x: 0, y: 0, tx: 1, ty: 0 };
    this.hitCount = 0;
  }

  update(dt, car) {
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const p = this.peds[i];
      const dx = p.x - car.x, dy = p.y - car.y;
      if ((p.state !== "down" && dx * dx + dy * dy > DESPAWN_R2) || p.remove) {
        this.peds.splice(i, 1);
      }
    }

    this.#spawnNear(car);

    const carSpeed = speedOf(car);
    for (const p of this.peds) {
      p.phase += dt * (p.state === "flee" ? 13 : 5);

      if (p.state === "down") {
        this.#updateDown(p, dt);
        continue;
      }

      const dx = p.x - car.x, dy = p.y - car.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 1) {
        this.#hit(p, car, carSpeed);
        continue;
      }

      if (this.#threatens(car, carSpeed, p, d2)) {
        this.#startFlee(p, car, carSpeed);
      } else if (p.state === "flee") {
        p.safeT += dt;
        if (p.safeT > 2) this.#resumeWalk(p);
      }

      if (p.state === "flee") this.#updateFlee(p, dt);
      else this.#updateWalk(p, dt);

      const hx = p.x - car.x, hy = p.y - car.y;
      if (p.state !== "down" && hx * hx + hy * hy < 1) this.#hit(p, car, carSpeed);
    }
  }

  draw(ctx, camX, camY, viewR) {
    const r2 = viewR * viewR;
    for (const p of this.peds) {
      const dx = p.x - camX, dy = p.y - camY;
      if (dx * dx + dy * dy > r2) continue;

      if (p.state === "down") {
        this.#drawDown(ctx, p);
      } else {
        this.#drawStanding(ctx, p);
      }
    }
  }

  #spawnNear(car) {
    const target = getPedTarget();
    const need = Math.min(target - this.peds.length, SPAWNS_PER_TICK);
    if (need <= 0) return;

    const roads = this.world.roadsNear(car.x, car.y, QUERY_R);
    if (!roads || !roads.length) return;

    let spawned = 0;
    for (let tries = 0; spawned < need && tries < SPAWN_TRIES; tries++) {
      const road = roads[(Math.random() * roads.length) | 0];
      if (!road || !road.p || road.p.length < 4) continue;
      
      // Only spawn on actual streets with sidewalks (skip paths, beaches, parks)
      const isSidewalkRoad = road.w >= 6 && road.w <= 25;
      if (!isSidewalkRoad) continue;

      const len = polyLen(road.p);
      if (len < 12) continue;

      const s = Math.random() * len;
      const side = Math.random() < 0.5 ? -1 : 1;
      // Sidewalk offset: just outside road edge
      const sidewalkOff = side * (road.w / 2 + 2.0 + Math.random() * 1.0);
      pointAt(road.p, s, this.tmp);
      const x = this.tmp.x + -this.tmp.ty * sidewalkOff;
      const y = this.tmp.y + this.tmp.tx * sidewalkOff;
      const dx = x - car.x, dy = y - car.y;
      if (dx * dx + dy * dy < MIN_SPAWN_R2) continue;
      if (this.world.buildingAt(x, y)) continue;

      const dir = Math.random() < 0.5 ? -1 : 1;
      this.peds.push({
        road, len, s, side, off: sidewalkOff, dir, x, y,
        h: Math.atan2(this.tmp.ty * dir, this.tmp.tx * dir),
        speed: 0.8 + Math.random() * 0.8,
        state: "walk",
        idleT: 0,
        safeT: 0,
        phase: Math.random() * Math.PI * 2,
        wander: Math.random() * Math.PI * 2,
        decisionT: 1.5 + Math.random() * 4,
        spriteIndex: (Math.random() * SHIRTS.length) | 0,
      });
      spawned++;
    }
  }

  #updateWalk(p, dt) {
    p.decisionT -= dt;
    if (p.decisionT <= 0) {
      const r = Math.random();
      if (r < 0.18) p.idleT = 0.5 + Math.random() * 1.4;
      else if (r < 0.42) p.dir *= -1;
      p.decisionT = 2 + Math.random() * 4.5;
    }

    if (p.idleT > 0) {
      p.idleT = Math.max(0, p.idleT - dt);
      return;
    }

    const oldS = p.s;
    p.s += p.speed * p.dir * dt;
    if (p.s <= 0 || p.s >= p.len) {
      p.dir *= -1;
      p.s = Math.max(0.1, Math.min(p.len - 0.1, p.s));
    }

    pointAt(p.road.p, p.s, this.tmp);
    const tx = this.tmp.tx * p.dir, ty = this.tmp.ty * p.dir;
    const wander = Math.sin(p.phase * 0.42 + p.wander) * 0.35;
    const off = p.off + wander * p.side;
    const nx = this.tmp.x + -this.tmp.ty * off;
    const ny = this.tmp.y + this.tmp.tx * off;

    if (this.world.buildingAt(nx, ny)) {
      p.s = oldS;
      p.dir *= -1;
      p.idleT = 0.25;
      return;
    }

    p.x = nx; p.y = ny;
    p.h = Math.atan2(ty, tx);
  }

  #updateFlee(p, dt) {
    const nx = p.x + p.fleeX * 4.5 * dt;
    const ny = p.y + p.fleeY * 4.5 * dt;
    if (this.world.buildingAt(nx, ny)) {
      p.fleeX *= -1; p.fleeY *= -1;
      p.safeT = 0.8;
      return;
    }
    p.x = nx; p.y = ny;
    p.h = Math.atan2(p.fleeY, p.fleeX);
  }

  #updateDown(p, dt) {
    p.downT += dt;
    if (p.downT < 0.4) {
      const t = p.downT / 0.4;
      p.x = p.hitX + p.flingX * p.flingDist * t;
      p.y = p.hitY + p.flingY * p.flingDist * t;
      p.h += dt * 15;
    } else if (p.downT > 4.4) {
      p.remove = true;
    }
  }

  #threatens(car, carSpeed, p, d2) {
    if (carSpeed <= 8 || d2 >= 81) return false;
    const d = Math.sqrt(d2) || 1;
    const toward = (car.vx * (p.x - car.x) + car.vy * (p.y - car.y)) / (carSpeed * d);
    return toward > 0.35;
  }

  #startFlee(p, car, carSpeed) {
    const inv = 1 / (carSpeed || 1);
    const rx = -car.vy * inv, ry = car.vx * inv;
    let side = (p.x - car.x) * rx + (p.y - car.y) * ry;
    if (side === 0) side = Math.random() < 0.5 ? -1 : 1;
    const sign = side < 0 ? -1 : 1;
    p.fleeX = rx * sign;
    p.fleeY = ry * sign;
    p.state = "flee";
    p.safeT = 0;
    p.idleT = 0;
  }

  #resumeWalk(p) {
    const near = this.world.nearestRoad(p.x, p.y, 45);
    if (near && near.road && near.road.p && near.road.p.length >= 4) {
      p.road = near.road;
      p.len = polyLen(near.road.p);
      p.s = nearestS(near.road.p, p.x, p.y);
      const sideDot = (p.x - near.x) * -near.ty + (p.y - near.y) * near.tx;
      p.side = sideDot < 0 ? -1 : 1;
      p.off = p.side * (near.road.w / 2 + 2.5 + Math.random() * 1.5);
    }
    p.state = "walk";
    p.safeT = 0;
    p.decisionT = 1 + Math.random() * 3;
  }

  #hit(p, car, carSpeed) {
    this.hitCount++;
    let fx = car.vx, fy = car.vy;
    const spd = carSpeed || Math.hypot(fx, fy);
    if (spd > 0.1) {
      fx /= spd; fy /= spd;
    } else {
      const dx = p.x - car.x, dy = p.y - car.y;
      const d = Math.hypot(dx, dy) || 1;
      fx = dx / d; fy = dy / d;
    }

    p.state = "down";
    p.downT = 0;
    p.hitX = p.x; p.hitY = p.y;
    p.flingX = fx; p.flingY = fy;
    p.flingDist = 2 + Math.random();
    p.h = Math.atan2(fy, fx) + (Math.random() - 0.5) * 0.7;
    car.vx *= 0.96; car.vy *= 0.96;
    car.crashT = Math.max(car.crashT || 0, 0.1);
  }

  #drawStanding(ctx, p) {
    const vy = p.y + elevOffset(p.x, p.y);
    const shirt = SHIRTS[p.spriteIndex % SHIRTS.length];
    const hair = HAIR[(p.spriteIndex * 2) % HAIR.length];

    ctx.save();
    ctx.translate(p.x, vy);

    // Simple shadow
    ctx.fillStyle = "rgba(10,8,6,0.3)";
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.7, 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Simple top-down person: head + shoulders as oval
    ctx.fillStyle = shirt;
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.5, 0.4, p.h, 0, Math.PI * 2);
    ctx.fill();

    // Head (smaller circle at front based on heading)
    const hx = Math.cos(p.h) * 0.2;
    const hy = Math.sin(p.h) * 0.2;
    ctx.fillStyle = hair;
    ctx.beginPath();
    ctx.arc(hx, hy, 0.25, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  #drawDown(ctx, p) {
    const alpha = Math.max(0, 1 - Math.max(0, p.downT - 0.4) / 4);
    const vy = p.y + elevOffset(p.x, p.y);
    const shirt = SHIRTS[p.spriteIndex % SHIRTS.length];

    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.translate(p.x, vy);

    // Shadow
    ctx.fillStyle = "rgba(10,8,6,0.25)";
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.8, 0.5, p.h, 0, Math.PI * 2);
    ctx.fill();

    // Fallen person - elongated shape
    ctx.fillStyle = shirt;
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.7, 0.35, p.h, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  #sprite(index) {
    if (!this.sprites) this.sprites = [];
    const i = index % SHIRTS.length;
    if (this.sprites[i]) return this.sprites[i];

    const c = document.createElement("canvas");
    c.width = 5; c.height = 5;
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, 5, 5);
    g.fillStyle = HAIR[(i * 2) % HAIR.length];
    g.fillRect(2, 0, 1, 1);
    g.fillStyle = SKIN[i % SKIN.length];
    g.fillRect(2, 1, 1, 1);
    g.fillStyle = SHIRTS[i];
    g.fillRect(1, 2, 3, 2);
    g.fillRect(2, 4, 1, 1);
    this.sprites[i] = c;
    return c;
  }
}

function speedOf(car) {
  return typeof car.speed === "function" ? car.speed() : Math.hypot(car.vx, car.vy);
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

function nearestS(p, x, y) {
  let bestS = 0, bestD2 = Infinity, acc = 0;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i], ay = p[i + 1];
    const dx = p[i + 2] - ax, dy = p[i + 3] - ay;
    const seg2 = dx * dx + dy * dy;
    const t = seg2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / seg2)) : 0;
    const px = ax + dx * t, py = ay + dy * t;
    const qx = x - px, qy = y - py;
    const d2 = qx * qx + qy * qy;
    if (d2 < bestD2) {
      bestD2 = d2;
      bestS = acc + Math.sqrt(seg2) * t;
    }
    acc += Math.sqrt(seg2);
  }
  return bestS;
}
