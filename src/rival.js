// AI rival — uses real Car physics + LocalDriver (drift through corners).

import { Car, drawCarSprite } from "./car.js";
import { makeCarSpriteFor, physFor } from "./cars.js";
import { elevOffset } from "./terrain.js";
import { computeDriveInput } from "./local-driver.js";

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
    this.stuckT = 0;
    this.car = new Car(world, 0, 0, 0, this.phys, this.sprite);
    this._route = null;
    this._routeGoal = null;
  }

  get x() { return this.car.x; }
  get y() { return this.car.y; }
  get h() { return this.car.h; }

  start() {
    const s = this.cps[0];
    this.car.x = s.x - s.tx * 6 - s.ty * 2.6;
    this.car.y = s.y - s.ty * 6 + s.tx * 2.6;
    this.car.h = Math.atan2(s.ty, s.tx);
    this.car.vx = 0;
    this.car.vy = 0;
    this.cpIndex = 1;
    this.finished = false;
    this._route = null;
  }

  target() {
    return this.cpIndex < this.cps.length ? this.cps[this.cpIndex] : this.cps[0];
  }

  progress() {
    const t = this.target();
    return { cp: this.cpIndex, dist: Math.hypot(t.x - this.x, t.y - this.y) };
  }

  update(dt, player, playerProgress) {
    if (this.finished) return;
    const t = this.target();
    const distT = Math.hypot(t.x - this.x, t.y - this.y);

    if (distT < CP_RADIUS) {
      if (this.cpIndex >= this.cps.length) { this.finished = true; return; }
      this.cpIndex++;
      this._route = null;
    }

    let band = 1;
    const dToPlayer = Math.hypot(player.x - this.x, player.y - this.y);
    if (playerProgress) {
      const lead = (this.cpIndex - playerProgress.cp) * 600 + (playerProgress.dist - this.progress().dist);
      if (lead > 800) band = 0.88;
      else if (lead > 400) band = 0.94;
      else if (lead < -800) band = 1.12;
      else if (lead < -400) band = 1.06;
      if (dToPlayer > 300 && lead < -200) band = Math.min(band * 1.1, 1.15);
    }

    const goal = this.target();
    if (dToPlayer > 700) {
      const cruise = this.phys.topSpeed * this.skill * 0.9 * band;
      this.car.h += angDiff(Math.atan2(goal.y - this.y, goal.x - this.x), this.car.h) * Math.min(1, 3 * dt);
      const sp = Math.hypot(this.car.vx, this.car.vy);
      const nv = sp + (cruise - sp) * Math.min(1, 2 * dt);
      this.car.vx = Math.cos(this.car.h) * nv;
      this.car.vy = Math.sin(this.car.h) * nv;
      this.car.x += this.car.vx * dt;
      this.car.y += this.car.vy * dt;
      return;
    }

    const goalKey = `${goal.x},${goal.y}`;
    if (!this._route || this._routeGoal !== goalKey) {
      this._route = this.world.roadGraph?.findRoute(this.x, this.y, goal.x, goal.y);
      this._routeGoal = goalKey;
    }

    const input = computeDriveInput(this.world, {
      x: this.x, y: this.y, h: this.h,
      vx: this.car.vx, vy: this.car.vy,
      skill: this.skill,
      cornering: this.def.stats?.cornering ?? 7,
    }, goal, { route: this._route });

    this.car.catchUpBoost = band;
    this.car.update(dt, input);
  }

  draw(ctx, camX, camY, viewR) {
    const dx = this.x - camX, dy = this.y - camY;
    if (dx * dx + dy * dy > viewR * viewR) return;
    if (this.def.stats?.aura >= 9) {
      ctx.save();
      ctx.translate(this.x, this.y + elevOffset(this.x, this.y));
      ctx.rotate(this.h + Math.PI / 2);
      ctx.fillStyle = "rgba(255,90,60,0.25)";
      ctx.fillRect(-1.4, -2.6, 2.8, 5.2);
      ctx.restore();
    }
    this.car.draw(ctx);
    const vy = this.y + elevOffset(this.x, this.y);
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
