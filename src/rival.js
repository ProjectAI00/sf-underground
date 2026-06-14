// AI rival racer. Near the player it drives "properly": seeks its next
// checkpoint while snapping to the road network, slowing for corners and
// dodging buildings. Far from the player (chunks may not even be loaded) it
// simulates coarsely along the direct bearing. Light rubber-banding keeps
// races dramatic without being unfair.

import { drawCarSprite } from "./car.js";
import { makeCarSpriteFor, physFor } from "./cars.js";
import { elevOffset } from "./terrain.js";

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

    // Catch-up mechanics - keeps races competitive
    let band = 1;
    if (playerProgress) {
      const lead = (this.cpIndex - playerProgress.cp) * 600 + (playerProgress.dist - this.progress().dist);
      // More aggressive catch-up to keep races close
      if (lead > 800) band = 0.88;       // rival way ahead: ease off significantly
      else if (lead > 400) band = 0.94;  // rival ahead: ease off
      else if (lead < -800) band = 1.12; // rival way behind: push hard
      else if (lead < -400) band = 1.06; // rival behind: push
      // Also factor in direct distance - if rival is very far, more catch-up
      if (dToPlayer > 300 && lead < -200) band = Math.min(band * 1.1, 1.15);
    }

    const dToPlayer = Math.hypot(player.x - this.x, player.y - this.y);
    const directH = Math.atan2(dyT, dxT);

    if (dToPlayer > 700) {
      // coarse off-screen simulation: fast cruise toward checkpoint
      const cruise = this.phys.topSpeed * this.skill * 0.85 * band;
      this.v += (cruise - this.v) * Math.min(1, 3 * dt);
      this.h += angDiff(directH, this.h) * Math.min(1, 4 * dt);
      this.x += Math.cos(this.h) * this.v * dt;
      this.y += Math.sin(this.h) * this.v * dt;
      return;
    }

    // on-screen: drive like an aggressive street racer
    let desiredH = directH;
    const near = this.world.nearestRoad(this.x, this.y, 80);
    if (near && near.d < 30) {
      // follow the road in whichever direction makes progress toward the target
      const sign = near.tx * dxT + near.ty * dyT >= 0 ? 1 : -1;
      const roadH = Math.atan2(near.ty * sign, near.tx * sign);
      // More aggressive: blend heavily toward target when close, follow road when far
      const targetDist = Math.hypot(dxT, dyT);
      const blendFactor = targetDist < 100 ? 0.6 : 0.35; // More direct when close to checkpoint
      desiredH = blendAngles(roadH, directH, blendFactor);
      // Less strict centerline following - can use full road width
      const pullX = near.x - this.x, pullY = near.y - this.y;
      if (near.d > near.road.w * 0.4) {
        desiredH = blendAngles(desiredH, Math.atan2(pullY, pullX), 0.2);
      }
    } else {
      // Off-road or far from road - head directly toward checkpoint
      desiredH = directH;
    }

    // building avoidance probe - check further ahead at high speed
    const probeLen = 5 + this.v * 0.15;
    const probeX = this.x + Math.cos(this.h) * probeLen;
    const probeY = this.y + Math.sin(this.h) * probeLen;
    let blocked = false;
    if (this.world.buildingAt(probeX, probeY)) {
      blocked = true;
      // Check both sides to find clear path
      const leftClear = !this.world.buildingAt(
        this.x + Math.cos(this.h + 0.8) * probeLen, this.y + Math.sin(this.h + 0.8) * probeLen);
      const rightClear = !this.world.buildingAt(
        this.x + Math.cos(this.h - 0.8) * probeLen, this.y + Math.sin(this.h - 0.8) * probeLen);
      const side = leftClear && !rightClear ? 1 : rightClear && !leftClear ? -1 : (Math.random() < 0.5 ? 1 : -1);
      desiredH = this.h + side * 1.3;
    }

    const turn = angDiff(desiredH, this.h);
    // Faster, more aggressive steering
    const turnRate = 3.5 * Math.min(1.2, this.v / 8 + 0.4);
    this.h += clamp(turn, -turnRate * dt, turnRate * dt);

    // speed: corner-aware but more aggressive
    const top = this.phys.topSpeed * this.skill * band;
    // Less slowdown for corners - rival takes more risks
    const cornerSlow = Math.max(0.45, 1 - Math.abs(turn) * 0.85);
    const targetV = blocked ? 10 : top * cornerSlow;
    // Faster acceleration and braking
    const rate = targetV > this.v ? this.phys.engine * 0.85 : this.phys.brake * 1.1;
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
    const vy = this.y + elevOffset(this.x, this.y);
    // aura boss glow
    if (this.def.stats.aura >= 9) {
      ctx.save();
      ctx.translate(this.x, vy);
      ctx.rotate(this.h + Math.PI / 2);
      ctx.fillStyle = "rgba(255,90,60,0.25)";
      ctx.fillRect(-1.4, -2.6, 2.8, 5.2);
      ctx.restore();
    }
    drawCarSprite(ctx, this.sprite, this.x, vy, this.h);
    // name tag
    ctx.font = '1.1px "Press Start 2P", monospace';
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(10,10,14,0.65)";
    const wTag = this.mission.name.length * 1.15 + 1;
    ctx.fillRect(this.x - wTag / 2, vy - 5.6, wTag, 1.9);
    ctx.fillStyle = "#ffc24b";
    ctx.fillText(this.mission.name, this.x, vy - 4.2);
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
