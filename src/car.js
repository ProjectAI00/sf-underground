// Arcade car, GTA-CW flavored: forward/lateral velocity split, speed-sensitive
// steering, handbrake drift with smoke + skids, burnouts, brake lights, crash
// sparks. Sprites are chunky pixel-art canvases (8 px/m) with visible tires,
// outline and specular shading, blitted rotated.

import { gradeAt, elevOffset } from "./terrain.js";
import { isWater } from "./water.js";

export const SPRITE_PPM = 8; // sprite pixels per meter

/** 0=asphalt, 1=sidewalk, 2=grass/park near a street, 3=water */
function driveSurface(near, x, y, shore, bridgeZones) {
  if (near) {
    const edge = near.road.w / 2;
    if (near.d < edge + 1.5) return { onRoad: true, tier: 0, topMul: 1, drag: 0.26, rumble: 0 };
    if (near.d < edge + 6) {
      return { onRoad: false, tier: 1, topMul: 0.94, drag: 0.30, rumble: 0.15 };
    }
  }
  if (isWater(x, y, shore, bridgeZones)) {
    return { onRoad: false, tier: 3, topMul: 0.72, drag: 0.55, rumble: 0.2 };
  }
  if (!near) return { onRoad: false, tier: 2, topMul: 0.82, drag: 0.42, rumble: 0.45 };
  return { onRoad: false, tier: 2, topMul: 0.88, drag: 0.36, rumble: 0.35 };
}

/**
 * Waymo robotaxi sprite - white with sensor dome on roof
 */
export function makeWaymoSprite() {
  const Lm = 4.4, Wm = 2.1;
  const c = document.createElement("canvas");
  c.width = Math.round(Wm * SPRITE_PPM);
  c.height = Math.round(Lm * SPRITE_PPM);
  const g = c.getContext("2d");
  const w = c.width, h = c.height;
  
  // Tires
  g.fillStyle = "#101014";
  for (const ty of [Math.round(h * 0.16), Math.round(h * 0.68)]) {
    g.fillRect(0, ty, 2, 5);
    g.fillRect(w - 2, ty, 2, 5);
  }
  
  // Outline
  g.fillStyle = "#16161b";
  g.fillRect(2, 1, w - 4, h - 2);
  g.fillRect(1, 3, w - 2, h - 6);
  
  // White body
  g.fillStyle = "#f5f5f5";
  g.fillRect(3, 2, w - 6, h - 4);
  g.fillRect(2, 4, w - 4, h - 8);
  
  // Subtle side shading
  g.fillStyle = "rgba(0,0,0,0.12)";
  g.fillRect(2, 4, 1, h - 8);
  g.fillRect(w - 3, 4, 1, h - 8);
  
  // WAYMO branding stripe (orange/teal accent)
  g.fillStyle = "#00b8a9";
  g.fillRect(3, Math.round(h * 0.45), w - 6, 2);
  
  // Glass
  drawGlass(g, 3, Math.round(h * 0.30), w - 6, 5);
  drawGlass(g, 3, Math.round(h * 0.62), w - 6, 4);
  
  // LIDAR sensor dome on roof (the iconic spinning thing)
  const cx = Math.floor(w / 2);
  const cy = Math.round(h * 0.36);
  g.fillStyle = "#2a2a2a";
  g.beginPath();
  g.arc(cx, cy, 3, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#444";
  g.beginPath();
  g.arc(cx, cy, 2, 0, Math.PI * 2);
  g.fill();
  // Blinking sensor light
  g.fillStyle = "#00ff88";
  g.fillRect(cx - 1, cy - 1, 2, 2);
  
  // Lights
  drawLights(g, w, h);
  
  return c;
}

/**
 * Base pixel car used by traffic/parked cars (player cars come from cars.js,
 * which builds on the same proportions).
 */
export function makeCarSprite(bodyColor, accent = "#16161b") {
  const Lm = 4.4, Wm = 2.1;
  const c = document.createElement("canvas");
  c.width = Math.round(Wm * SPRITE_PPM);   // 17
  c.height = Math.round(Lm * SPRITE_PPM);  // 35
  const g = c.getContext("2d");
  drawCarBase(g, c.width, c.height, bodyColor, accent);
  drawGlass(g, 3, Math.round(c.height * 0.30), c.width - 6, 5);
  drawGlass(g, 3, Math.round(c.height * 0.62), c.width - 6, 4);
  drawLights(g, c.width, c.height);
  return c;
}

/** shared chassis painter: tires, outlined body, shading, glass, lights */
export function drawCarBase(g, w, h, body, accent = "#16161b") {
  // tires poke out 1px past the body sides
  g.fillStyle = "#101014";
  for (const ty of [Math.round(h * 0.16), Math.round(h * 0.68)]) {
    g.fillRect(0, ty, 2, 5);
    g.fillRect(w - 2, ty, 2, 5);
  }
  // outline silhouette (cut corners for a rounded retro shape)
  g.fillStyle = accent;
  g.fillRect(2, 1, w - 4, h - 2);
  g.fillRect(1, 3, w - 2, h - 6);
  // body
  g.fillStyle = body;
  g.fillRect(3, 2, w - 6, h - 4);
  g.fillRect(2, 4, w - 4, h - 8);
  // side shading
  g.fillStyle = "rgba(0,0,0,0.22)";
  g.fillRect(2, 4, 1, h - 8);
  g.fillRect(w - 3, 4, 1, h - 8);
  // specular stripe down the middle
  g.fillStyle = "rgba(255,255,255,0.16)";
  g.fillRect(Math.floor(w / 2) - 1, 3, 2, h - 6);
  // bumpers
  g.fillStyle = "rgba(0,0,0,0.3)";
  g.fillRect(3, 1, w - 6, 1);
  g.fillRect(3, h - 2, w - 6, 1);
  return { w, h };
}

/** glass + lights helpers shared with cars.js */
export function drawGlass(g, x, y, w, h) {
  g.fillStyle = "#1c2127";
  g.fillRect(x, y, w, h);
  g.fillStyle = "#3d4a59";
  g.fillRect(x + 1, y + 1, w - 2, h - 2);
  g.fillStyle = "rgba(255,255,255,0.25)";
  g.fillRect(x + 1, y + 1, 2, h - 2);
}

export function drawLights(g, w, h) {
  g.fillStyle = "#ffe9a8";
  g.fillRect(3, 1, 3, 2);
  g.fillRect(w - 6, 1, 3, 2);
  g.fillStyle = "#e0392f";
  g.fillRect(3, h - 3, 3, 2);
  g.fillRect(w - 6, h - 3, 3, 2);
}

export function drawHeadlightBeams(ctx, x, y, h, bright = 1) {
  const fx = Math.cos(h), fy = Math.sin(h);
  const rx = -fy, ry = fx;
  const reach = 25 * bright;
  
  for (const s of [-1, 1]) {
    const bx = x + fx * 2.05 + rx * s * 0.72;
    const by = y + fy * 2.05 + ry * s * 0.72;
    
    // Large ground illumination pool ahead
    const gx = bx + fx * 10, gy = by + fy * 10;
    const pool = ctx.createRadialGradient(gx, gy, 0, gx, gy, 16 * bright);
    pool.addColorStop(0, `rgba(255,245,210,${0.25 * bright})`);
    pool.addColorStop(0.3, `rgba(255,230,180,${0.15 * bright})`);
    pool.addColorStop(0.6, `rgba(255,210,150,${0.06 * bright})`);
    pool.addColorStop(1, "rgba(255,190,120,0)");
    ctx.fillStyle = pool;
    ctx.beginPath();
    ctx.ellipse(gx, gy, 16 * bright, 12 * bright, h, 0, Math.PI * 2);
    ctx.fill();
    
    // Wide beam cone
    ctx.fillStyle = `rgba(255,248,220,${0.1 * bright})`;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + fx * reach + rx * s * 6, by + fy * reach + ry * s * 6);
    ctx.lineTo(bx + fx * reach - rx * s * 1, by + fy * reach - ry * s * 1);
    ctx.closePath();
    ctx.fill();
    
    // Inner bright cone
    ctx.fillStyle = `rgba(255,252,230,${0.15 * bright})`;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + fx * reach * 0.7 + rx * s * 3, by + fy * reach * 0.7 + ry * s * 3);
    ctx.lineTo(bx + fx * reach * 0.7 - rx * s * 0.5, by + fy * reach * 0.7 - ry * s * 0.5);
    ctx.closePath();
    ctx.fill();
    
    // Bright headlight point
    ctx.fillStyle = `rgba(255,252,235,${0.85 * bright})`;
    ctx.beginPath();
    ctx.arc(bx, by, 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

export class Car {
  constructor(world, x, y, heading, phys = null, sprite = null) {
    this.world = world;
    this.x = x; this.y = y;
    this.h = heading;       // radians, 0 = +x
    this.vx = 0; this.vy = 0;
    this.steer = 0;
    this.len = 4.4; this.wid = 2.1;
    this.phys = phys || { topSpeed: 44.4, engine: 28, brake: 38, grip: 10.5, steer: 2.7, aura: 5 };
    this.catchUpBoost = 1;  // Race catch-up multiplier
    this.sprite = sprite || defaultSprite();
    this.skids = [];        // [x1,y1,x2,y2,alpha]
    this.smoke = [];        // {x,y,vx,vy,r,life,max}
    this.sparks = [];       // {x,y,vx,vy,life}
    this.crashT = 0;
    this.prevCrashT = 0;
    this.bumpT = 0;
    this.stuckT = 0;
    this.wasOnRoad = true;
    this.wasSurface = 0;
    this.grade = 0;
    this.rumblePhase = 0;
    this.drifting = false;
    this.braking = false;
  }

  speed() { return Math.hypot(this.vx, this.vy); }
  kmh() { return Math.round(this.speed() * 3.6); }

  update(dt, input) {
    const fwdX = Math.cos(this.h), fwdY = Math.sin(this.h);
    const rgtX = -fwdY, rgtY = fwdX;

    let vF = this.vx * fwdX + this.vy * fwdY;
    let vL = this.vx * rgtX + this.vy * rgtY;

    const near = this.world.nearestRoad(this.x, this.y, 80);
    const surf = driveSurface(near, this.x, this.y, this.world.overview?.shore, this.world.overview?.bridgeWater);
    const onRoad = surf.onRoad;

    // curb bump — only when leaving asphalt, softer on sidewalk/grass
    const spdNow = this.speed();
    if (surf.tier !== this.wasSurface && spdNow > 4) {
      const fromAsphalt = this.wasSurface === 0;
      const toAsphalt = surf.tier === 0;
      if (fromAsphalt || toAsphalt) {
        const keep = toAsphalt ? 0.96 : fromAsphalt ? 0.95 : 0.97;
        this.vx *= keep; this.vy *= keep;
        this.bumpT = fromAsphalt ? 0.08 : 0.04;
        if (fromAsphalt) this.h += (Math.random() - 0.5) * 0.012;
      }
    }
    this.wasOnRoad = onRoad;
    this.wasSurface = surf.tier;
    this.bumpT = Math.max(0, this.bumpT - dt);

    // light rumble off asphalt
    if (!onRoad && spdNow > 3 && surf.rumble > 0) {
      this.rumblePhase += dt * (10 + spdNow) * surf.rumble;
      this.h += Math.sin(this.rumblePhase * 3.1) * 0.0005 * spdNow * surf.rumble;
    }

    // engine / brake — per-car stats (B-tier tops out ~160 km/h)
    const P = this.phys;
    const boost = this.catchUpBoost || 1;
    const topSpeed = P.topSpeed * surf.topMul * boost;
    const engineBoost = boost > 1 ? boost * 1.1 : boost; // Extra accel when catching up
    if (input.up) vF += (vF < 0 ? P.brake : P.engine * engineBoost * (1 - Math.max(0, vF) / topSpeed)) * dt;
    if (input.down) vF -= (vF > 0 ? P.brake : 13) * dt;
    this.braking = !!(input.down && vF > 1);

    // SF hills — gravity, uphill load, downhill run
    const grade = gradeAt(this.x, this.y, fwdX, fwdY);
    this.grade = grade;
    
    // Auto parking brake: if nearly stopped and no input, don't roll
    const noInput = !input.up && !input.down;
    const nearlyStoppedSpeed = 1.5;
    const parked = noInput && spdNow < nearlyStoppedSpeed;
    
    if (!parked) {
      vF += 16 * grade * dt;
      if (input.up && vF > 0 && grade > 0.025) {
        vF -= Math.min(vF * 0.25, grade * 3 * dt);
      }
      if (grade < -0.025 && vF > 2) {
        vF += Math.min(-grade * 5.5, 11) * dt;
      }
    } else {
      // Parked - quickly come to full stop
      vF *= 0.85;
      vL *= 0.85;
      if (Math.abs(vF) < 0.1) vF = 0;
      if (Math.abs(vL) < 0.1) vL = 0;
    }
    
    if (Math.abs(grade) > 0.055 && spdNow > 8) {
      this.bumpT = Math.max(this.bumpT, 0.03 + Math.min(0.04, Math.abs(grade) * 0.25));
    }

    // drag: soft surfaces barely penalize throttle now
    const underPower = input.up && vF > 0;
    const drag = onRoad
      ? (underPower ? 0 : surf.drag)
      : (underPower ? surf.drag * 0.35 : surf.drag);
    vF -= vF * drag * dt + (underPower ? 0 : Math.sign(vF) * Math.min(Math.abs(vF), 0.9 * dt));

    // steering — snappy, arcade style
    const steerTarget = (input.left ? -1 : 0) + (input.right ? 1 : 0);
    this.steer += (steerTarget - this.steer) * Math.min(1, 12 * dt);
    const spd = Math.abs(vF);
    
    // Steering - arcade style with drift boost
    const steerGain = P.steer * Math.min(1, spd / 8) * (1 - Math.min(0.5, spd / 120));
    
    // DRIFT MECHANICS: handbrake dramatically increases steering and kicks out the rear
    const isDrifting = input.brake && spd > 8;
    const driftSteerBoost = isDrifting ? 2.2 : 1;
    this.h += this.steer * steerGain * (vF < -0.5 ? -1 : 1) * dt * driftSteerBoost;

    // Grip system - handbrake breaks rear traction for drifting
    const naturalSlip = 1 - Math.min(0.4, Math.abs(this.steer) * spd / 160);
    
    if (isDrifting) {
      // HANDBRAKE DRIFT: low grip, kick out the rear
      const driftGrip = 1.2; // Very low grip during drift
      vL -= vL * Math.min(1, driftGrip * dt);
      // Add lateral kick when initiating drift
      if (Math.abs(this.steer) > 0.3) {
        vL += this.steer * spd * 0.15 * dt;
      }
      // Slow down but maintain momentum
      vF -= vF * 0.18 * dt;
    } else {
      // Normal grip
      const grip = P.grip * naturalSlip;
      vL -= vL * Math.min(1, grip * dt);
    }

    this.drifting = Math.abs(vL) > 2.5 && spd > 6;

    // skid marks + smoke at the rear wheels
    const burnout = input.up && spd < 6 && Math.abs(vF) > 0.4 && onRoad;
    if (this.drifting || burnout) {
      const bx = Math.cos(this.h), by = Math.sin(this.h);
      const r2x = -by * this.wid * 0.42, r2y = bx * this.wid * 0.42;
      const back = 1.6;
      if (this.drifting) {
        this.skids.push(
          [this.x - bx * back + r2x, this.y - by * back + r2y,
           this.x - bx * (back + 0.9) + r2x, this.y - by * (back + 0.9) + r2y, 0.6],
          [this.x - bx * back - r2x, this.y - by * back - r2y,
           this.x - bx * (back + 0.9) - r2x, this.y - by * (back + 0.9) - r2y, 0.6],
        );
        if (this.skids.length > 900) this.skids.splice(0, this.skids.length - 900);
      }
      // tire smoke
      if (this.smoke.length < 240) {
        for (const s of [1, -1]) {
          this.smoke.push({
            x: this.x - bx * back + r2x * s + (Math.random() - 0.5) * 0.4,
            y: this.y - by * back + r2y * s + (Math.random() - 0.5) * 0.4,
            vx: -bx * 1.5 + (Math.random() - 0.5) * 2 - this.vx * 0.04,
            vy: -by * 1.5 + (Math.random() - 0.5) * 2 - this.vy * 0.04,
            r: 0.4 + Math.random() * 0.3,
            life: 0.55 + Math.random() * 0.3,
            max: 0.85,
          });
        }
      }
    }

    // recompose
    const nFwdX = Math.cos(this.h), nFwdY = Math.sin(this.h);
    const nRgtX = -nFwdY, nRgtY = nFwdX;
    this.vx = nFwdX * vF + nRgtX * vL;
    this.vy = nFwdY * vF + nRgtY * vL;

    // integrate with building collision
    const nx = this.x + this.vx * dt;
    const ny = this.y + this.vy * dt;
    if (this.#hitsBuilding(nx, ny)) {
      if (!this.#hitsBuilding(nx, this.y)) {
        this.x = nx; this.vy *= -0.25;
        this.stuckT = 0;
      } else if (!this.#hitsBuilding(this.x, ny)) {
        this.y = ny; this.vx *= -0.25;
        this.stuckT = 0;
      } else {
        this.vx *= -0.3; this.vy *= -0.3;
        if (input.up || input.down) this.stuckT += dt;
        if (this.stuckT > 0.8) {
          this.resetToRoad();
          this.stuckT = 0;
        }
      }
      if (this.speed() > 8) this.crashT = 0.25;
    } else {
      this.x = nx; this.y = ny;
      this.stuckT = 0;
    }

    // crash sparks on fresh impacts
    if (this.crashT > 0.2 && this.prevCrashT <= 0.01 && this.sparks.length < 60) {
      for (let i = 0; i < 7; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = 4 + Math.random() * 7;
        this.sparks.push({ x: this.x, y: this.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.25 + Math.random() * 0.2 });
      }
    }
    this.prevCrashT = this.crashT;
    this.crashT = Math.max(0, this.crashT - dt);

    // particles
    for (let i = this.smoke.length - 1; i >= 0; i--) {
      const s = this.smoke[i];
      s.life -= dt;
      if (s.life <= 0) { this.smoke.splice(i, 1); continue; }
      s.x += s.vx * dt; s.y += s.vy * dt;
      s.vx *= 1 - 2 * dt; s.vy *= 1 - 2 * dt;
      s.r += dt * 2.2;
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      if (s.life <= 0) { this.sparks.splice(i, 1); continue; }
      s.x += s.vx * dt; s.y += s.vy * dt;
    }

    // fade skids
    for (const s of this.skids) s[4] -= dt * 0.07;
    if (this.skids.length && this.skids[0][4] <= 0) {
      this.skids = this.skids.filter((s) => s[4] > 0);
    }

    return { onRoad, near };
  }

  #hitsBuilding(x, y) {
    const fx = Math.cos(this.h), fy = Math.sin(this.h);
    const rx = -fy, ry = fx;
    const hl = this.len * 0.42, hw = this.wid * 0.40;
    const pts = [
      [x + fx * hl + rx * hw, y + fy * hl + ry * hw],
      [x + fx * hl - rx * hw, y + fy * hl - ry * hw],
      [x - fx * hl + rx * hw, y - fy * hl + ry * hw],
      [x - fx * hl - rx * hw, y - fy * hl - ry * hw],
      [x + fx * hl, y + fy * hl],
      [x - fx * hl, y - fy * hl],
    ];
    for (const [px, py] of pts) if (this.world.buildingAt(px, py)) return true;
    return false;
  }

  resetToRoad() {
    const near = this.world.nearestRoad(this.x, this.y, 400);
    if (!near) return;
    this.x = near.x; this.y = near.y;
    this.h = Math.atan2(near.ty, near.tx);
    this.vx = 0; this.vy = 0;
  }

  drawSkids(ctx) {
    ctx.lineCap = "round";
    ctx.lineWidth = 0.32;
    for (const s of this.skids) {
      ctx.strokeStyle = `rgba(25,22,20,${s[4]})`;
      ctx.beginPath();
      ctx.moveTo(s[0], s[1]);
      ctx.lineTo(s[2], s[3]);
      ctx.stroke();
    }
  }

  /** Visual Y position with elevation offset */
  visualY() {
    return this.y + elevOffset(this.x, this.y);
  }

  draw(ctx) {
    const vy = this.visualY();
    if (this.phys.aura >= 7) {
      ctx.save();
      ctx.translate(this.x, vy);
      ctx.rotate(this.h + Math.PI / 2);
      ctx.fillStyle = this.phys.aura >= 9 ? "rgba(120,90,255,0.28)" : "rgba(75,224,200,0.22)";
      ctx.fillRect(-this.wid / 2 - 0.35, -this.len / 2 - 0.3, this.wid + 0.7, this.len + 0.6);
      ctx.restore();
    }
    drawCarSprite(ctx, this.sprite, this.x, vy, this.h, this.crashT > 0, true);

    // brake light glow
    if (this.braking) {
      const bx = Math.cos(this.h), by = Math.sin(this.h);
      const rx = -by * 0.62, ry = bx * 0.62;
      const tailX = this.x - bx * 2.05, tailY = vy - by * 2.05;
      ctx.fillStyle = "rgba(255,64,52,0.8)";
      ctx.fillRect(tailX + rx - 0.2, tailY + ry - 0.2, 0.4, 0.4);
      ctx.fillRect(tailX - rx - 0.2, tailY - ry - 0.2, 0.4, 0.4);
    }
  }

  /** smoke + sparks; call after draw() so puffs billow over the roof */
  drawFx(ctx) {
    for (const s of this.smoke) {
      const a = Math.max(0, s.life / s.max) * 0.34;
      ctx.fillStyle = `rgba(225,222,214,${a})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const s of this.sparks) {
      ctx.fillStyle = s.life > 0.15 ? "#ffd66e" : "#ff7a3c";
      ctx.fillRect(s.x - 0.14, s.y - 0.14, 0.28, 0.28);
    }
  }
}

let _defaultSprite = null;
function defaultSprite() {
  if (!_defaultSprite) _defaultSprite = makeCarSprite("#d8503f");
  return _defaultSprite;
}

export function drawCarSprite(ctx, sprite, x, y, h, flash = false, glow = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(h + Math.PI / 2); // sprite points up
  const w = sprite.width / SPRITE_PPM, hh = sprite.height / SPRITE_PPM;
  
  // Subtle glow underneath for visibility
  if (glow) {
    ctx.fillStyle = "rgba(255,250,240,0.12)";
    ctx.beginPath();
    ctx.ellipse(0, 0, w / 2 + 0.8, hh / 2 + 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  
  // Shadow
  ctx.fillStyle = "rgba(15,12,10,0.3)";
  ctx.fillRect(-w / 2 + 0.25, -hh / 2 + 0.35, w, hh);
  if (flash) ctx.globalAlpha = 0.6;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sprite, -w / 2, -hh / 2, w, hh);
  ctx.restore();
  if (flash) ctx.globalAlpha = 1;
}
