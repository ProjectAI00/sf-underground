// AI rival racer. Near the player it drives "properly": seeks its next
// checkpoint while snapping to the road network, slowing for corners and
// dodging buildings. Far from the player (chunks may not even be loaded) it
// simulates coarsely along the direct bearing. Light rubber-banding keeps
// races dramatic without being unfair.

import { drawCarSprite } from "./car.js";
import { makeCarSpriteFor, physFor } from "./cars.js";

const CP_RADIUS = 30;

export class Rival {
  constructor(world, mission, circuit) {
    this.world = world;
    this.mission = mission;
    this.def = { ...mission.car, id: "rival", name: mission.name };
    this.phys = physFor(this.def);
    this.skill = mission.skill;
    this.sprite = makeCarSpriteFor(this.def);
    this.circuit = circuit;
    this.cps = circuit.cps;
    this.cpIndex = 1;
    this.finished = false;
    this.x = 0; this.y = 0; this.h = 0; this.v = 0;
    this.stuckT = 0;
  }

  start() {
    const s = this.cps[0];
    // grid spot beside/behind the player
    this.x = s.x - s.tx * 6 - s.ty * 2.6;
    this.y = s.y - s.ty * 6 + s.tx * 2.6;
    this.h = Math.atan2(s.ty, s.tx);
    this.v = 0;
    this.cpIndex = 1;
    this.finished = false;
  }

  target() {
    return this.cpIndex < this.cps.length ? this.cps[this.cpIndex] : this.cps[0];
  }

  /** rough progress metric for position display + rubber-banding */
  progress() {
    const t = this.target();
    const d = Math.hypot(t.x - this.x, t.y - this.y);
    return { cp: this.cpIndex, dist: d };
  }

  update(dt, player, playerProgress) {
    if (this.finished) return;
    const t = this.target();
    const dxT = t.x - this.x, dyT = t.y - this.y;
    const distT = Math.hypot(dxT, dyT);

    // checkpoint pass
    if (distT < CP_RADIUS) {
      if (this.cpIndex >= this.cps.length) { this.finished = true; return; }
      this.cpIndex++;
    }

    // rubber-band vs player progress (gentle)
    let band = 1;
    if (playerProgress) {
      const lead = (this.cpIndex - playerProgress.cp) * 600 + (playerProgress.dist - this.progress().dist);
      if (lead > 350) band = 0.9;        // rival far ahead: ease off
      else if (lead < -350) band = 1.1;  // rival far behind: push
    }

    const dToPlayer = Math.hypot(player.x - this.x, player.y - this.y);
    const directH = Math.atan2(dyT, dxT);

    if (dToPlayer > 700) {
      // coarse off-screen simulation: bee-line at cruise pace
      const cruise = 19 * this.skill * band;
      this.v += (cruise - this.v) * Math.min(1, 1.5 * dt);
      this.h += angDiff(directH, this.h) * Math.min(1, 2.5 * dt);
      this.x += Math.cos(this.h) * this.v * dt;
      this.y += Math.sin(this.h) * this.v * dt;
      return;
    }

    // on-screen: drive like a street racer
    let desiredH = directH;
    const near = this.world.nearestRoad(this.x, this.y, 60);
    if (near && near.d < 26) {
      // follow the road in whichever direction makes progress toward the target
      const sign = near.tx * dxT + near.ty * dyT >= 0 ? 1 : -1;
      const roadH = Math.atan2(near.ty * sign, near.tx * sign);
      // blend road-following with direct seeking; drift toward centerline
      const w = Math.min(0.75, 0.25 + near.d * 0.04);
      desiredH = blendAngles(roadH, directH, w * 0.45);
      // gentle pull back to the road center
      const pullX = near.x - this.x, pullY = near.y - this.y;
      if (near.d > near.road.w * 0.32) {
        desiredH = blendAngles(desiredH, Math.atan2(pullY, pullX), 0.25);
      }
    }

    // building avoidance probe
    const probeX = this.x + Math.cos(this.h) * 5, probeY = this.y + Math.sin(this.h) * 5;
    let blocked = false;
    if (this.world.buildingAt(probeX, probeY)) {
      blocked = true;
      const side = this.world.buildingAt(
        this.x + Math.cos(this.h + 0.7) * 5, this.y + Math.sin(this.h + 0.7) * 5) ? -1 : 1;
      desiredH = this.h + side * 1.1;
    }

    const turn = angDiff(desiredH, this.h);
    this.h += clamp(turn, -2.6 * dt * Math.min(1, this.v / 6 + 0.3), 2.6 * dt * Math.min(1, this.v / 6 + 0.3));

    // speed: corner-aware
    const top = this.phys.topSpeed * this.skill * band;
    const cornerSlow = Math.max(0.32, 1 - Math.abs(turn) * 1.15);
    const targetV = blocked ? 6 : top * cornerSlow;
    const rate = targetV > this.v ? this.phys.engine * 0.55 : this.phys.brake * 0.8;
    this.v += clamp(targetV - this.v, -rate * dt, rate * dt);

    const nx = this.x + Math.cos(this.h) * this.v * dt;
    const ny = this.y + Math.sin(this.h) * this.v * dt;
    if (this.world.buildingAt(nx, ny)) {
      this.v *= 0.4;
      this.stuckT += dt;
      if (this.stuckT > 1.2) {
        const r = this.world.nearestRoad(this.x, this.y, 300);
        if (r) {
          this.x = r.x; this.y = r.y;
          const sign = r.tx * dxT + r.ty * dyT >= 0 ? 1 : -1;
          this.h = Math.atan2(r.ty * sign, r.tx * sign);
        }
        this.stuckT = 0;
      }
    } else {
      this.x = nx; this.y = ny;
      this.stuckT = Math.max(0, this.stuckT - dt * 2);
    }
  }

  draw(ctx, camX, camY, viewR) {
    const dx = this.x - camX, dy = this.y - camY;
    if (dx * dx + dy * dy > viewR * viewR) return;
    // aura boss glow
    if (this.def.stats.aura >= 9) {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.h + Math.PI / 2);
      ctx.fillStyle = "rgba(255,90,60,0.25)";
      ctx.fillRect(-1.4, -2.6, 2.8, 5.2);
      ctx.restore();
    }
    drawCarSprite(ctx, this.sprite, this.x, this.y, this.h);
    // name tag
    ctx.font = '1.1px "Press Start 2P", monospace';
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(10,10,14,0.65)";
    const wTag = this.mission.name.length * 1.15 + 1;
    ctx.fillRect(this.x - wTag / 2, this.y - 5.6, wTag, 1.9);
    ctx.fillStyle = "#ffc24b";
    ctx.fillText(this.mission.name, this.x, this.y - 4.2);
  }
}

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
function blendAngles(a, b, t) {
  return a + angDiff(b, a) * t;
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
