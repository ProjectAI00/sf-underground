// Police system: patrol like traffic, switch to pursuit when triggered
// Cops drive with realistic physics (like player), try to box in, no slowdown on hit

import { makeCarSprite, drawCarSprite, drawHeadlightBeams, SPRITE_PPM } from "./car.js";
import { computeDriveInput, applyToCop, pickUnstuckSteer, streetRelation, streetEndAhead, pathBlockedByBuildings } from "./local-driver.js";
import { elevOffset } from "./terrain.js";

const POLICE_BODY = "#1a1a24";
const SIREN_RED = "#ff3030";
const SIREN_BLUE = "#3060ff";

const MAX_WANTED = 5;
const ESCAPE_DISTANCE = 280;
const COOLDOWN_BASE = 8;
const COOLDOWN_PER_STAR = 4;

// Cops per wanted level
const COP_COUNT = [0, 1, 2, 3, 4, 5];
const PATROL_COUNT = 2;
const MAX_COPS = 8;

// Despawn distance
const DESPAWN_DISTANCE = 400;
const DESPAWN_DISTANCE_PURSUIT = 550;

// Cop top speed as fraction of player top speed: 1★=40%, 2★=50%, … 5★=80%
function copSpeedRatio(wantedLevel) {
  return 0.30 + wantedLevel * 0.10;
}

// Tier difficulty — patrol baseline, grip/steer caps; pursuit speed scales with wanted level
const TIER_DIFFICULTY = {
  C: { maxSpeed: 38, accel: 18, grip: 8, steer: 2.4, escapeDistance: 1.1, maxStars: 3 },
  B: { maxSpeed: 48, accel: 24, grip: 10, steer: 2.6, escapeDistance: 1.0, maxStars: 4 },
  A: { maxSpeed: 58, accel: 30, grip: 12, steer: 2.8, escapeDistance: 0.9, maxStars: 5 },
  S: { maxSpeed: 68, accel: 36, grip: 14, steer: 3.0, escapeDistance: 0.8, maxStars: 5 },
};

function makePoliceSprite() {
  const Lm = 4.5, Wm = 2.15;
  const c = document.createElement("canvas");
  c.width = Math.round(Wm * SPRITE_PPM);
  c.height = Math.round(Lm * SPRITE_PPM);
  const g = c.getContext("2d");
  const w = c.width, h = c.height;

  g.fillStyle = "#101014";
  for (const ty of [Math.round(h * 0.16), Math.round(h * 0.68)]) {
    g.fillRect(0, ty, 2, 5);
    g.fillRect(w - 2, ty, 2, 5);
  }

  g.fillStyle = "#0a0a10";
  g.fillRect(2, 1, w - 4, h - 2);
  g.fillRect(1, 3, w - 2, h - 6);

  g.fillStyle = POLICE_BODY;
  g.fillRect(3, 2, w - 6, h - 4);
  g.fillRect(2, 4, w - 4, h - 8);

  g.fillStyle = "#d8d8d8";
  g.fillRect(2, Math.round(h * 0.38), 1, Math.round(h * 0.24));
  g.fillRect(w - 3, Math.round(h * 0.38), 1, Math.round(h * 0.24));

  const lbY = Math.round(h * 0.44);
  g.fillStyle = "#222230";
  g.fillRect(4, lbY, w - 8, 4);
  g.fillStyle = SIREN_RED;
  g.fillRect(5, lbY + 1, 3, 2);
  g.fillStyle = SIREN_BLUE;
  g.fillRect(w - 8, lbY + 1, 3, 2);

  g.fillStyle = "#1c2127";
  g.fillRect(4, Math.round(h * 0.28), w - 8, 4);
  g.fillRect(4, Math.round(h * 0.60), w - 8, 3);
  g.fillStyle = "#3d4a59";
  g.fillRect(5, Math.round(h * 0.29), w - 10, 2);

  g.fillStyle = "#fffae0";
  g.fillRect(3, 1, 3, 2);
  g.fillRect(w - 6, 1, 3, 2);

  g.fillStyle = "#e0392f";
  g.fillRect(3, h - 3, 3, 2);
  g.fillRect(w - 6, h - 3, 3, 2);

  g.fillStyle = "rgba(255,255,255,0.1)";
  g.fillRect(Math.floor(w / 2) - 1, 3, 2, h - 6);

  return c;
}

function makeHeliSprite() {
  const Lm = 10, Wm = 3;
  const c = document.createElement("canvas");
  c.width = Math.round(Wm * SPRITE_PPM);
  c.height = Math.round(Lm * SPRITE_PPM);
  const g = c.getContext("2d");
  const w = c.width, h = c.height;
  
  g.fillStyle = "#1a1a24";
  g.fillRect(Math.floor(w/2) - 2, 0, 4, Math.round(h * 0.4));
  
  g.fillStyle = "#101418";
  g.fillRect(Math.floor(w/2) - 3, 2, 6, 4);
  
  g.fillStyle = "#0a0a10";
  g.beginPath();
  g.ellipse(w/2, h * 0.65, w/2 - 1, h * 0.28, 0, 0, Math.PI * 2);
  g.fill();
  
  g.fillStyle = POLICE_BODY;
  g.beginPath();
  g.ellipse(w/2, h * 0.65, w/2 - 2, h * 0.26, 0, 0, Math.PI * 2);
  g.fill();
  
  g.fillStyle = "#1c2830";
  g.beginPath();
  g.ellipse(w/2, h * 0.78, w/2 - 4, h * 0.12, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#3a4a5a";
  g.beginPath();
  g.ellipse(w/2, h * 0.78, w/2 - 5, h * 0.08, 0, 0, Math.PI * 2);
  g.fill();
  
  g.fillStyle = "#d8d8d8";
  g.fillRect(2, Math.round(h * 0.55), w - 4, 2);
  
  g.fillStyle = "#101014";
  g.fillRect(1, Math.round(h * 0.58), 2, Math.round(h * 0.22));
  g.fillRect(w - 3, Math.round(h * 0.58), 2, Math.round(h * 0.22));
  
  g.fillStyle = "#fffae0";
  g.beginPath();
  g.arc(w/2, h * 0.88, 2, 0, Math.PI * 2);
  g.fill();
  
  g.fillStyle = "#ff3030";
  g.beginPath();
  g.arc(w/2, h * 0.58, 1.5, 0, Math.PI * 2);
  g.fill();
  
  return c;
}

export class Police {
  constructor(world) {
    this.world = world;
    this.cops = [];
    this.sprite = null;
    this.wantedLevel = 0;
    this.cooldownTimer = 0;
    this.evading = false;
    this.patrolSpawnTimer = 0;
    this.collisionCooldown = 0;
    this.playerTier = "B";
    this.boxedTimer = 0;
    
    this.heli = {
      active: false,
      x: 0, y: 0,
      vx: 0, vy: 0,
      h: 0,
      speed: 0,
      rotorPhase: 0,
      tailRotorPhase: 0,
      altitude: 50,
      searchAngle: 0,
      searchSpeed: 1.5,
      lostTimer: 0,
    };
    this.heliSprite = null;
  }
  
  setPlayerTier(tier) {
    this.playerTier = tier || "B";
  }
  
  #getDifficulty() {
    return TIER_DIFFICULTY[this.playerTier] || TIER_DIFFICULTY.B;
  }

  /** Max pursuit speed — shared by ground cops and helicopter. */
  #pursuitTopSpeed(player) {
    const diff = this.#getDifficulty();
    const playerTop = player.phys?.topSpeed ?? diff.maxSpeed;
    if (this.wantedLevel <= 0) return Math.min(diff.maxSpeed, playerTop * 0.55);
    return playerTop * copSpeedRatio(this.wantedLevel);
  }

  /** Scale cop performance to player car and current wanted level. */
  #applyCopPerformance(c, player) {
    const diff = this.#getDifficulty();
    const playerAccel = player.phys?.engine ?? diff.accel;

    if (this.wantedLevel <= 0 || !c.pursuing) {
      c.maxSpeed = this.#pursuitTopSpeed(player);
      c.accel = diff.accel * 0.85;
    } else {
      c.maxSpeed = this.#pursuitTopSpeed(player);
      c.accel = playerAccel * (0.50 + this.wantedLevel * 0.09);
    }

    c.grip = diff.grip;
    c.steerRate = diff.steer;
  }

  #getSprite() {
    if (!this.sprite) this.sprite = makePoliceSprite();
    return this.sprite;
  }
  
  #getHeliSprite() {
    if (!this.heliSprite) this.heliSprite = makeHeliSprite();
    return this.heliSprite;
  }

  get wanted() { return this.wantedLevel; }

  setWanted(level) {
    const prev = this.wantedLevel;
    const diff = this.#getDifficulty();
    const maxStars = diff.maxStars || MAX_WANTED;
    this.wantedLevel = clamp(level, 0, Math.min(MAX_WANTED, maxStars));
    if (this.wantedLevel > prev) {
      this.evading = false;
      this.cooldownTimer = 0;
    }
    if (this.wantedLevel === 0) {
      this.evading = false;
      this.cooldownTimer = 0;
      for (const c of this.cops) c.pursuing = false;
    }
  }

  addWanted(n = 1) {
    this.setWanted(this.wantedLevel + n);
  }

  update(dt, player, traffic, speedzone) {
    this.#spawnCops(player);
    this.#checkSpeedingNearCop(player, speedzone);
    this.#updateCops(dt, player, traffic);
    this.#updateHelicopter(dt, player);
    this.#checkEscape(dt, player);
    this.#despawnFarCops(player);
  }
  
  #checkSpeedingNearCop(player, speedzone) {
    if (this.wantedLevel > 0) return;
    
    const playerSpeed = Math.hypot(player.vx || 0, player.vy || 0);
    const playerKmh = playerSpeed * 3.6;
    const limit = speedzone?.currentLimit || 50;
    const speeding = playerKmh > limit + 20;
    
    if (!speeding) return;
    
    for (const c of this.cops) {
      if (c.pursuing || c.disabled) continue;
      
      const dist = Math.hypot(player.x - c.x, player.y - c.y);
      if (dist > 60) continue;
      
      const toPlayerX = player.x - c.x;
      const toPlayerY = player.y - c.y;
      const toPlayerAngle = Math.atan2(toPlayerY, toPlayerX);
      const angleDiff = Math.abs(angDiff(toPlayerAngle, c.h));
      
      if (angleDiff < Math.PI * 0.5) {
        this.setWanted(1);
        c.pursuing = true;
        break;
      }
    }
  }
  
  #updateHelicopter(dt, player) {
    const heli = this.heli;
    const highTier = this.playerTier === "A" || this.playerTier === "S";
    const shouldSpawn = this.wantedLevel >= 4 && highTier;
    
    if (shouldSpawn && !heli.active) {
      heli.active = true;
      heli.lostTimer = 0;
      heli.positionPhase = Math.random() * Math.PI * 2;
      // Spawn closer - ahead or to the side
      const spawnAngle = player.h + (Math.random() - 0.5) * Math.PI;
      heli.x = player.x + Math.cos(spawnAngle) * 80;
      heli.y = player.y + Math.sin(spawnAngle) * 80;
      heli.h = Math.atan2(player.y - heli.y, player.x - heli.x);
      heli.vx = 0;
      heli.vy = 0;
      heli.driftX = 0;
      heli.driftY = 0;
      heli.driftPhase = Math.random() * Math.PI * 2;
      heli.searchAngle = Math.random() * Math.PI * 2;
    } else if ((this.wantedLevel < 4 || !highTier) && heli.active) {
      heli.active = false;
    }
    
    if (!heli.active) return;
    
    const distToPlayer = Math.hypot(player.x - heli.x, player.y - heli.y);
    // Very hard to lose - must be far away for a long time
    if (distToPlayer > 350) {
      heli.lostTimer += dt;
      if (heli.lostTimer > 20) {
        heli.active = false;
        return;
      }
    } else {
      heli.lostTimer = Math.max(0, heli.lostTimer - dt * 0.5); // Slowly resets
    }
    
    const playerSpeed = Math.hypot(player.vx || 0, player.vy || 0);
    const heliTop = this.#pursuitTopSpeed(player);
    const catchRatio = copSpeedRatio(this.wantedLevel);
    
    // Dynamic positioning - favor front and sides, rarely behind
    heli.positionPhase = (heli.positionPhase || 0) + dt * 0.25;
    const posPhase = heli.positionPhase;
    
    // Orbit mostly to the sides and front (bias toward +/- 90 degrees)
    const sideSwing = Math.sin(posPhase) * 0.9; // -0.9 to 0.9
    const frontBias = 0.3; // push toward front
    const orbitAngle = player.h + (sideSwing + frontBias) * Math.PI * 0.6; // mostly side/front
    const orbitDist = 18 + Math.sin(posPhase * 2.1) * 10; // 8-28m - closer to player
    
    // Lead the player more aggressively
    const leadTime = Math.min(1.5, playerSpeed * 0.04);
    const baseTargetX = player.x + (player.vx || 0) * leadTime;
    const baseTargetY = player.y + (player.vy || 0) * leadTime;
    
    // Add orbit offset to get in front/side
    const targetX = baseTargetX + Math.cos(orbitAngle) * orbitDist;
    const targetY = baseTargetY + Math.sin(orbitAngle) * orbitDist;
    
    const dx = targetX - heli.x;
    const dy = targetY - heli.y;
    const distToTarget = Math.hypot(dx, dy);
    
    // Smaller drift for tighter tracking
    heli.driftPhase += dt * 1.2;
    const driftAmount = 6;
    heli.driftX += (Math.sin(heli.driftPhase) * driftAmount - heli.driftX) * dt * 0.8;
    heli.driftY += (Math.cos(heli.driftPhase * 0.7) * driftAmount - heli.driftY) * dt * 0.8;
    
    const offsetX = targetX + heli.driftX;
    const offsetY = targetY + heli.driftY;
    const toDriftX = offsetX - heli.x;
    const toDriftY = offsetY - heli.y;
    const driftDist = Math.hypot(toDriftX, toDriftY);
    
    // Same top-speed cap as ground cops (80% of player at 5★, 70% at 4★, etc.)
    let desiredSpeed;
    if (distToTarget < 15) {
      desiredSpeed = Math.min(18, driftDist * 0.9);
    } else if (distToPlayer > 100) {
      desiredSpeed = heliTop;
    } else {
      desiredSpeed = Math.min(heliTop, playerSpeed * catchRatio);
    }
    
    const accelRate = distToTarget > 60 ? 12 : 8;
    const targetVx = driftDist > 1 ? (toDriftX / driftDist) * desiredSpeed : 0;
    const targetVy = driftDist > 1 ? (toDriftY / driftDist) * desiredSpeed : 0;
    
    heli.vx += (targetVx - heli.vx) * Math.min(1, accelRate * dt * 0.15);
    heli.vy += (targetVy - heli.vy) * Math.min(1, accelRate * dt * 0.15);

    const heliSpd = Math.hypot(heli.vx, heli.vy);
    if (heliSpd > heliTop) {
      heli.vx *= heliTop / heliSpd;
      heli.vy *= heliTop / heliSpd;
    }
    
    heli.x += heli.vx * dt;
    heli.y += heli.vy * dt;
    
    // Faster heading changes
    const speed = Math.hypot(heli.vx, heli.vy);
    if (speed > 5) {
      const velH = Math.atan2(heli.vy, heli.vx);
      let dh = angDiff(velH, heli.h);
      heli.h += dh * Math.min(1, 3 * dt);
    } else {
      const toPlayerH = Math.atan2(player.y - heli.y, player.x - heli.x);
      let dh = angDiff(toPlayerH, heli.h);
      heli.h += dh * Math.min(1, 2 * dt);
    }
    
    heli.rotorPhase += dt * 30;
    heli.tailRotorPhase += dt * 45;
    heli.searchAngle += dt * heli.searchSpeed;
    if (Math.random() < dt * 0.3) {
      heli.searchSpeed = 1.2 + Math.random() * 2;
    }
  }

  #spawnCops(player) {
    this.patrolSpawnTimer += 0.016;
    if (this.patrolSpawnTimer < 3) return;
    this.patrolSpawnTimer = 0;

    const diff = this.#getDifficulty();
    const targetCount = Math.min(MAX_COPS, PATROL_COUNT + COP_COUNT[this.wantedLevel]);
    if (this.cops.length >= targetCount) return;

    const playerSpeed = Math.hypot(player.vx || 0, player.vy || 0);
    const playerDir = playerSpeed > 3 ? Math.atan2(player.vy, player.vx) : player.h;
    
    let spawnAngle, spawnDist, role;
    
    if (this.wantedLevel > 0) {
      // During pursuit: spawn strategically for boxing
      const rand = Math.random();
      const existingRoles = this.cops.filter(c => c.pursuing).map(c => c.role);
      const needsBlocker = !existingRoles.includes("block_front");
      const needsFlanker = existingRoles.filter(r => r === "flank").length < 2;
      
      if (needsBlocker && rand < 0.35) {
        // Spawn ahead to block
        spawnAngle = playerDir + (Math.random() - 0.5) * 0.6;
        spawnDist = 180 + Math.random() * 150;
        role = "block_front";
      } else if (needsFlanker && rand < 0.7) {
        // Spawn to sides for flanking
        spawnAngle = playerDir + (Math.random() < 0.5 ? 1 : -1) * (1.0 + Math.random() * 0.6);
        spawnDist = 120 + Math.random() * 120;
        role = "flank";
      } else {
        // Chase from behind
        spawnAngle = playerDir + Math.PI + (Math.random() - 0.5) * 1.2;
        spawnDist = 180 + Math.random() * 200;
        role = "chase";
      }
    } else {
      // Patrol: spawn naturally around
      spawnAngle = Math.random() * Math.PI * 2;
      spawnDist = 250 + Math.random() * 200;
      role = "patrol";
    }
    
    const tx = player.x + Math.cos(spawnAngle) * spawnDist;
    const ty = player.y + Math.sin(spawnAngle) * spawnDist;

    const near = this.world.nearestRoad(tx, ty, 80);
    if (!near || near.d > 20) return;

    // Face toward player when pursuing, otherwise follow road
    let h;
    if (this.wantedLevel > 0) {
      h = Math.atan2(player.y - near.y, player.x - near.x);
    } else {
      const dir = Math.random() < 0.5 ? 1 : -1;
      h = Math.atan2(near.ty * dir, near.tx * dir);
    }

    this.cops.push({
      x: near.x,
      y: near.y,
      h,
      vx: Math.cos(h) * 12,
      vy: Math.sin(h) * 12,
      // Physics params (same style as player car)
      maxSpeed: diff.maxSpeed,
      accel: diff.accel,
      brake: 35,
      grip: diff.grip,
      steerRate: diff.steer,
      // State
      pursuing: this.wantedLevel > 0,
      role,
      sirenPhase: Math.random() * Math.PI * 2,
      steer: 0,
      throttle: 0,
      handbrake: false,
      stuckT: 0,
      unstuckT: 0,
      unstuckSteer: 1,
      route: null,
      routeT: 0,
      routeGx: 0,
      routeGy: 0,
      routeMode: null,
      lastX: near.x,
      lastY: near.y,
      crashT: 0,
      disabled: false,
      disabledTimer: 0,
    });
  }

  #snapToRoad(c) {
    const inBuilding = this.world.buildingAt(c.x, c.y);
    const near = this.world.nearestRoad(c.x, c.y, 120);
    if (!inBuilding && (!near || near.d < 18)) return false;

    if (near) {
      c.x = near.x;
      c.y = near.y;
      if (inBuilding || near.d > 25) {
        c.h = Math.atan2(near.ty, near.tx);
        c.vx *= 0.2;
        c.vy *= 0.2;
      }
    }
    return true;
  }

  #updateCops(dt, player, traffic) {
    for (const c of this.cops) {
      if (c.disabled) {
        c.disabledTimer -= dt;
        if (c.disabledTimer <= 0) {
          c.disabled = false;
          const near = this.world.nearestRoad(c.x, c.y, 100);
          if (near) {
            c.x = near.x;
            c.y = near.y;
          }
        }
        // Still apply some physics while disabled (slide to stop)
        c.vx *= 0.96;
        c.vy *= 0.96;
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        continue;
      }

      this.#snapToRoad(c);
      this.#applyCopPerformance(c, player);
      this.#updateStuck(c, dt);

      if (c.unstuckT > 0) {
        this.#applyUnstuck(c, dt);
        this.#applyCarPhysics(c, dt);
        c.sirenPhase += dt * 8;
        c.crashT = Math.max(0, c.crashT - dt);
        continue;
      }

      // Activate pursuit if wanted and nearby
      if (this.wantedLevel > 0 && !c.pursuing) {
        const dist = Math.hypot(player.x - c.x, player.y - c.y);
        if (dist < 150) c.pursuing = true;
      }

      if (c.pursuing) {
        this.#updatePursuit(c, dt, player);
      } else {
        this.#updatePatrol(c, dt);
      }

      c.sirenPhase += dt * 8;
      c.crashT = Math.max(0, c.crashT - dt);
    }
  }

  #updatePatrol(c, dt) {
    const near = this.world.nearestRoad(c.x, c.y, 50);
    let goal = { x: c.x + Math.cos(c.h) * 40, y: c.y + Math.sin(c.h) * 40 };
    if (near) {
      const dot = Math.cos(c.h) * near.tx + Math.sin(c.h) * near.ty;
      const dir = dot >= 0 ? 1 : -1;
      goal = { x: c.x + near.tx * dir * 50, y: c.y + near.ty * dir * 50 };
    }
    const input = computeDriveInput(this.world, {
      x: c.x, y: c.y, h: c.h, vx: c.vx, vy: c.vy, skill: 0.7, cornering: 6,
    }, goal, { forPolice: true, roadBias: 0.7, probeDist: 28 });
    applyToCop(c, input, dt);
    this.#applyCarPhysics(c, dt);
  }

  #applyUnstuck(c, dt) {
    c.unstuckT -= dt;
    const input = computeDriveInput(this.world, {
      x: c.x, y: c.y, h: c.h, vx: c.vx, vy: c.vy,
    }, { x: c.x, y: c.y }, { unstuck: true, unstuckSteer: c.unstuckSteer });
    applyToCop(c, input, dt);
    if (c.unstuckT <= 0) {
      const near = this.world.nearestRoad(c.x, c.y, 80);
      if (near) c.h = Math.atan2(near.ty, near.tx);
    }
  }

  #updateStuck(c, dt) {
    if (c.unstuckT > 0) return;

    const speed = Math.hypot(c.vx, c.vy);
    const moved = Math.hypot(c.x - c.lastX, c.y - c.lastY);
    const near = this.world.nearestRoad(c.x, c.y, 80);
    const onRoad = near && near.d < 12;
    const inBuilding = this.world.buildingAt(c.x, c.y);
    const fx = Math.cos(c.h), fy = Math.sin(c.h);
    const noseIn = this.world.buildingAt(c.x + fx * 3, c.y + fy * 3)
      || this.world.buildingAt(c.x + fx * 6, c.y + fy * 6);
    const touching = inBuilding || noseIn
      || this.world.buildingAt(c.x + fx * 2.5, c.y + fy * 2.5)
      || this.world.buildingAt(c.x + fx * 4, c.y + fy * 4);
    const trying = c.throttle > 0.2 || Math.abs(c.throttle) > 0.2;

    if (inBuilding || (noseIn && trying)) {
      c.stuckT = 1;
    } else if (trying && (touching || !onRoad) && (speed < 8 || moved < 0.8 * dt)) {
      c.stuckT += dt * (touching ? 2.5 : 1);
    } else {
      c.stuckT = Math.max(0, c.stuckT - dt * 2);
    }

    if (c.stuckT > 0.08) {
      c.unstuckT = noseIn ? 1.0 : 0.85;
      c.unstuckSteer = pickUnstuckSteer(this.world, c.x, c.y, c.h);
      c.stuckT = 0;
      c.handbrake = false;
      c.throttle = -0.7;
      if (near && (inBuilding || near.d > 14)) {
        c.x = near.x;
        c.y = near.y;
        c.vx *= 0.15;
        c.vy *= 0.15;
      }
    }

    c.lastX = c.x;
    c.lastY = c.y;
  }

  #updatePursuit(c, dt, player) {
    const dx = player.x - c.x;
    const dy = player.y - c.y;
    const dist = Math.hypot(dx, dy);
    const copSpeed = Math.hypot(c.vx, c.vy);
    const relation = streetRelation(this.world, c.x, c.y, player.x, player.y);
    const onParallel = relation === "parallel" && dist > 40;

    let targetX, targetY;
    let routeAhead = 85;
    const playerBlocked = pathBlockedByBuildings(this.world, c.x, c.y, player.x, player.y);
    const mustCommitStreet = onParallel || (relation !== "same" && playerBlocked && dist > 35);

    if (mustCommitStreet) {
      const ahead = streetEndAhead(this.world, c.x, c.y, c.h, 90);
      targetX = ahead.x;
      targetY = ahead.y;
    } else if (relation === "same" || dist < 50) {
      switch (c.role) {
        case "block_front": {
          const predictTime = Math.min(2, dist / Math.max(copSpeed, 25));
          targetX = player.x + (player.vx || 0) * predictTime;
          targetY = player.y + (player.vy || 0) * predictTime;
          break;
        }
        case "flank": {
          const predictTime = Math.min(1.2, dist / Math.max(copSpeed, 25));
          const baseX = player.x + (player.vx || 0) * predictTime;
          const baseY = player.y + (player.vy || 0) * predictTime;
          const side = (c.x - player.x) * (player.vy || 0) - (c.y - player.y) * (player.vx || 0);
          const perpX = -(player.vy || 0);
          const perpY = (player.vx || 0);
          const perpLen = Math.hypot(perpX, perpY) || 1;
          const sideSign = side > 0 ? 1 : -1;
          targetX = baseX + (perpX / perpLen) * sideSign * (dist > 30 ? 12 : 4);
          targetY = baseY + (perpY / perpLen) * sideSign * (dist > 30 ? 12 : 4);
          break;
        }
        case "chase":
        default: {
          const predictTime = Math.min(0.8, dist / Math.max(copSpeed, 20));
          targetX = player.x + (player.vx || 0) * predictTime;
          targetY = player.y + (player.vy || 0) * predictTime;
          break;
        }
      }
      routeAhead = 75;
    } else {
      targetX = player.x;
      targetY = player.y;
      routeAhead = 80;
    }

    const modeChanged = c.routeMode !== (mustCommitStreet ? "commit" : relation);
    const reachedJunction = mustCommitStreet && Math.hypot(c.x - c.routeGx, c.y - c.routeGy) < 28;
    const goalMoved = !mustCommitStreet && Math.hypot(targetX - (c.routeGx ?? 0), targetY - (c.routeGy ?? 0)) > 40;

    if (!c.route || c.routeT <= 0 || modeChanged || reachedJunction || goalMoved) {
      c.route = this.world.roadGraph?.findRoute(c.x, c.y, targetX, targetY) || null;
      c.routeT = mustCommitStreet ? 1.6 : 0.55;
      c.routeGx = targetX;
      c.routeGy = targetY;
      c.routeMode = mustCommitStreet ? "commit" : relation;
    } else {
      c.routeT -= dt;
    }

    const input = computeDriveInput(this.world, {
      x: c.x, y: c.y, h: c.h, vx: c.vx, vy: c.vy,
      skill: c.role === "chase" ? 0.85 : 0.75,
      cornering: 7,
    }, { x: targetX, y: targetY }, {
      forPolice: true,
      roadBias: mustCommitStreet ? 0.92 : 0.78,
      probeDist: 28 + copSpeed * 0.1,
      route: c.route,
      routeAhead,
    });
    applyToCop(c, input, dt);
    this.#applyCarPhysics(c, dt);
  }

  #applyCarPhysics(c, dt) {
    const fx = Math.cos(c.h);
    const fy = Math.sin(c.h);
    const rx = -fy;
    const ry = fx;

    let vF = c.vx * fx + c.vy * fy;
    let vL = c.vx * rx + c.vy * ry;
    const speed = Math.abs(vF);

    if (c.throttle > 0) {
      const accelForce = c.accel * c.throttle * (1 - Math.max(0, vF) / c.maxSpeed);
      vF += accelForce * dt;
    } else if (c.throttle < 0) {
      if (speed < 3) {
        vF -= c.accel * 0.55 * (-c.throttle) * dt;
      } else {
        vF -= c.brake * (-c.throttle) * dt;
      }
    }

    vF -= vF * 0.15 * dt;

    const steerGain = c.steerRate * Math.min(1, speed / 10) * (1 - Math.min(0.4, speed / 100));
    c.h += c.steer * steerGain * (vF < -0.5 ? -1 : 1) * dt;

    const naturalSlip = 1 - Math.min(0.35, Math.abs(c.steer) * speed / 180);
    vL -= vL * Math.min(1, c.grip * naturalSlip * dt);

    const newFx = Math.cos(c.h);
    const newFy = Math.sin(c.h);
    const newRx = -newFy;
    const newRy = newFx;
    c.vx = newFx * vF + newRx * vL;
    c.vy = newFy * vF + newRy * vL;

    const newX = c.x + c.vx * dt;
    const newY = c.y + c.vy * dt;

    if (this.world.buildingAt(newX, newY)) {
      if (!this.world.buildingAt(newX, c.y)) {
        c.x = newX;
        c.vy *= 0.2;
      } else if (!this.world.buildingAt(c.x, newY)) {
        c.y = newY;
        c.vx *= 0.2;
      } else {
        c.vx *= 0.45;
        c.vy *= 0.45;
        c.stuckT = Math.min(1, (c.stuckT || 0) + dt * 0.8);
      }
      if (speed > 6) c.crashT = 0.15;
    } else {
      c.x = newX;
      c.y = newY;
    }
  }

  #checkEscape(dt, player) {
    if (this.wantedLevel === 0) return;

    const diff = this.#getDifficulty();
    const escapeD = ESCAPE_DISTANCE * diff.escapeDistance;
    let seen = false;
    
    for (const c of this.cops) {
      if (!c.pursuing || c.disabled) continue;
      const dist = Math.hypot(player.x - c.x, player.y - c.y);
      if (dist < escapeD) {
        seen = true;
        break;
      }
    }
    
    // Helicopter also sees player
    if (this.heli.active) {
      const heliDist = Math.hypot(player.x - this.heli.x, player.y - this.heli.y);
      if (heliDist < 200) seen = true;
    }

    if (seen) {
      this.evading = false;
      this.cooldownTimer = 0;
    } else {
      this.evading = true;
      this.cooldownTimer += dt;
      const needed = COOLDOWN_BASE + this.wantedLevel * COOLDOWN_PER_STAR;
      if (this.cooldownTimer >= needed) {
        this.setWanted(this.wantedLevel - 1);
        this.cooldownTimer = 0;
      }
    }
  }

  #despawnFarCops(player) {
    for (let i = this.cops.length - 1; i >= 0; i--) {
      const c = this.cops[i];
      const dist = Math.hypot(c.x - player.x, c.y - player.y);
      const maxDist = c.pursuing ? DESPAWN_DISTANCE_PURSUIT : DESPAWN_DISTANCE;
      if (dist > maxDist) {
        this.cops.splice(i, 1);
      }
    }
  }

  checkCollisions(player, traffic, dt) {
    this.collisionCooldown = Math.max(0, this.collisionCooldown - dt);
    
    let hitCop = false;
    for (const c of this.cops) {
      if (c.disabled) continue;
      
      const dx = player.x - c.x;
      const dy = player.y - c.y;
      const dist = Math.hypot(dx, dy);
      const minDist = 3.5;
      
      if (dist < minDist && dist > 0) {
        const nx = dx / dist;
        const ny = dy / dist;
        
        // Separate both cars (prevent overlap)
        const overlap = minDist - dist;
        player.x += nx * overlap * 0.5;
        player.y += ny * overlap * 0.5;
        c.x -= nx * overlap * 0.5;
        c.y -= ny * overlap * 0.5;
        
        // Minimal velocity adjustment - just stop penetrating, no big bounce
        const dvx = (player.vx || 0) - c.vx;
        const dvy = (player.vy || 0) - c.vy;
        const dvn = dvx * nx + dvy * ny;
        
        if (dvn < 0) {
          // Soft push apart, no bounce
          player.vx -= dvn * nx * 0.15;
          player.vy -= dvn * ny * 0.15;
          c.vx += dvn * nx * 0.1;
          c.vy += dvn * ny * 0.1;
        }
        
        player.crashT = 0.1;
        c.crashT = 0.1;
        hitCop = true;
      }
    }
    
    // Hitting cop adds wanted level
    if (hitCop && this.collisionCooldown <= 0) {
      if (this.wantedLevel === 0) {
        this.setWanted(1);
      } else if (this.wantedLevel < MAX_WANTED) {
        this.setWanted(this.wantedLevel + 1);
      }
      this.collisionCooldown = 4;
      
      // Activate all nearby cops
      for (const c of this.cops) {
        const dist = Math.hypot(player.x - c.x, player.y - c.y);
        if (dist < 100) c.pursuing = true;
      }
    }
    
    // Cop vs Traffic - cops push through traffic
    if (traffic && traffic.cars) {
      for (const c of this.cops) {
        if (c.disabled) continue;
        
        for (const npc of traffic.cars) {
          const dx = c.x - npc.x;
          const dy = c.y - npc.y;
          const dist = Math.hypot(dx, dy);
          const minDist = 3.2;
          
          if (dist < minDist && dist > 0) {
            const nx = dx / dist;
            const ny = dy / dist;
            const overlap = minDist - dist;
            
            // Cop pushes through, traffic yields
            c.x += nx * overlap * 0.2;
            c.y += ny * overlap * 0.2;
            npc.x -= nx * overlap * 0.8;
            npc.y -= ny * overlap * 0.8;
            
            // Slow both a bit
            const copSpeed = Math.hypot(c.vx, c.vy);
            c.vx *= 0.95;
            c.vy *= 0.95;
            npc.v = Math.max(0, (npc.v || 0) * 0.7);
            npc.stopT = 1.5; // Traffic stops briefly
          }
        }
      }
    }
    
    // Cop vs Cop - prevent pileups
    for (let i = 0; i < this.cops.length; i++) {
      const a = this.cops[i];
      if (a.disabled) continue;
      
      for (let j = i + 1; j < this.cops.length; j++) {
        const b = this.cops[j];
        if (b.disabled) continue;
        
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.hypot(dx, dy);
        const minDist = 4.0;
        
        if (dist < minDist && dist > 0) {
          const nx = dx / dist;
          const ny = dy / dist;
          const overlap = minDist - dist;
          
          a.x += nx * overlap * 0.5;
          a.y += ny * overlap * 0.5;
          b.x -= nx * overlap * 0.5;
          b.y -= ny * overlap * 0.5;
        }
      }
    }
    
    return false;
  }
  
  updateBoxedStatus(dt, player) {
    const playerSpeed = Math.hypot(player.vx || 0, player.vy || 0);
    
    let copsVeryClose = 0;
    for (const c of this.cops) {
      if (c.disabled) continue;
      const dist = Math.hypot(player.x - c.x, player.y - c.y);
      if (dist < 8) copsVeryClose++;
    }
    
    const isBoxed = playerSpeed < 3 && copsVeryClose >= 2;
    
    if (isBoxed) {
      this.boxedTimer += dt;
    } else {
      this.boxedTimer = Math.max(0, this.boxedTimer - dt * 3);
    }
    
    if (this.boxedTimer >= 12 && this.wantedLevel > 0) {
      return "busted";
    }
    
    return this.boxedTimer > 0 ? "boxing" : null;
  }
  
  get boxedProgress() {
    return Math.min(1, this.boxedTimer / 12);
  }
  
  resetBoxed() {
    this.boxedTimer = 0;
  }

  draw(ctx, camX, camY, viewR, light) {
    const sprite = this.#getSprite();
    const r2 = viewR * viewR;

    for (const c of this.cops) {
      const dx = c.x - camX, dy = c.y - camY;
      if (dx * dx + dy * dy > r2) continue;

      const vy = c.y + elevOffset(c.x, c.y);

      if (light?.headlights && !c.disabled) {
        drawHeadlightBeams(ctx, c.x, vy, c.h, 0.7);
      }

      drawCarSprite(ctx, sprite, c.x, vy, c.h, c.crashT > 0 || c.disabled, true);

      if (c.pursuing && !c.disabled) {
        const fx = Math.cos(c.h), fy = Math.sin(c.h);
        const rx = -fy, ry = fx;
        const lx = c.x - fx * 0.3, ly = vy - fy * 0.3;
        const flash = Math.sin(c.sirenPhase) > 0;

        if (flash) {
          ctx.fillStyle = "rgba(255,48,48,0.5)";
          ctx.beginPath();
          ctx.arc(lx + rx * 0.5, ly + ry * 0.5, 2.2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = "rgba(48,96,255,0.5)";
          ctx.beginPath();
          ctx.arc(lx - rx * 0.5, ly - ry * 0.5, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
  
  drawSpotlight(ctx, player) {
    const heli = this.heli;
    if (!heli.active) return;
    
    const distToPlayer = Math.hypot(player.x - heli.x, player.y - heli.y);
    
    let spotX, spotY;
    
    // Spotlight locks on player much earlier (120m instead of 80m)
    if (distToPlayer < 120) {
      // Track player with slight wobble
      const wobble = Math.sin(heli.searchAngle * 2) * 3;
      spotX = player.x + wobble;
      spotY = player.y + elevOffset(player.x, player.y) + wobble * 0.5;
    } else {
      const searchRadius = 50 + Math.sin(heli.searchAngle * 0.7) * 25;
      const searchX = heli.x + Math.cos(heli.searchAngle) * searchRadius;
      const searchY = heli.y + Math.sin(heli.searchAngle * 1.3) * searchRadius * 0.7;
      spotX = searchX;
      spotY = searchY + elevOffset(searchX, searchY);
    }
    
    // Bigger, brighter spotlight
    const outerGrad = ctx.createRadialGradient(spotX, spotY, 0, spotX, spotY, 70);
    outerGrad.addColorStop(0, "rgba(255,250,230,0.6)");
    outerGrad.addColorStop(0.2, "rgba(255,248,220,0.45)");
    outerGrad.addColorStop(0.5, "rgba(255,245,200,0.2)");
    outerGrad.addColorStop(1, "rgba(255,240,180,0)");
    ctx.fillStyle = outerGrad;
    ctx.beginPath();
    ctx.ellipse(spotX, spotY, 70, 55, 0, 0, Math.PI * 2);
    ctx.fill();
    
    const innerGrad = ctx.createRadialGradient(spotX, spotY, 0, spotX, spotY, 32);
    innerGrad.addColorStop(0, "rgba(255,255,245,0.85)");
    innerGrad.addColorStop(0.4, "rgba(255,252,235,0.5)");
    innerGrad.addColorStop(1, "rgba(255,248,220,0)");
    ctx.fillStyle = innerGrad;
    ctx.beginPath();
    ctx.ellipse(spotX, spotY, 25, 20, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  
  drawHelicopter(ctx, camX, camY) {
    const heli = this.heli;
    if (!heli.active) return;
    
    const sprite = this.#getHeliSprite();
    const hx = heli.x;
    const hy = heli.y + elevOffset(heli.x, heli.y);
    
    const shadowOffset = heli.altitude * 0.15;
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(hx + shadowOffset, hy + shadowOffset, 6, 4, heli.h, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(heli.h - Math.PI / 2);
    
    const w = sprite.width / SPRITE_PPM;
    const hh = sprite.height / SPRITE_PPM;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sprite, -w / 2, -hh / 2, w, hh);
    
    ctx.fillStyle = "rgba(180,180,200,0.12)";
    ctx.beginPath();
    ctx.arc(0, hh * 0.15, 9, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.strokeStyle = "rgba(60,60,70,0.5)";
    ctx.lineWidth = 0.6;
    for (let i = 0; i < 4; i++) {
      const angle = heli.rotorPhase + i * Math.PI / 2;
      const rx = Math.cos(angle) * 9;
      const ry = Math.sin(angle) * 9;
      ctx.beginPath();
      ctx.moveTo(-rx, hh * 0.15 - ry);
      ctx.lineTo(rx, hh * 0.15 + ry);
      ctx.stroke();
    }
    
    ctx.fillStyle = "rgba(180,180,200,0.15)";
    ctx.beginPath();
    ctx.arc(0, -hh * 0.42, 2.5, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.strokeStyle = "rgba(60,60,70,0.4)";
    ctx.lineWidth = 0.4;
    for (let i = 0; i < 2; i++) {
      const angle = heli.tailRotorPhase + i * Math.PI;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * -2.5, -hh * 0.42 + Math.sin(angle) * -2.5);
      ctx.lineTo(Math.cos(angle) * 2.5, -hh * 0.42 + Math.sin(angle) * 2.5);
      ctx.stroke();
    }
    
    if (Math.sin(heli.rotorPhase * 0.4) > 0.3) {
      ctx.fillStyle = "rgba(255,50,50,0.9)";
      ctx.beginPath();
      ctx.arc(0, hh * 0.08, 1.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,50,50,0.2)";
      ctx.beginPath();
      ctx.arc(0, hh * 0.08, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    
    ctx.restore();
  }

  drawRadarBlips(ctx, car, camRot, cx, cy, radius, scale) {
    const RADAR_M = 320;
    const cos = Math.cos(camRot);
    const sin = Math.sin(camRot);

    for (const c of this.cops) {
      const dx = c.x - car.x, dy = c.y - car.y;
      const rx = dx * cos + dy * sin;
      const ry = -dx * sin + dy * cos;
      const dist = Math.hypot(dx, dy);

      const pulse = c.pursuing ? 1 + 0.25 * Math.sin(performance.now() * 0.012) : 1;
      const color = c.pursuing ? SIREN_BLUE : "#4a6080";

      if (dist > RADAR_M) {
        const len = Math.hypot(rx, ry) || 1;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(cx + (rx / len) * (radius - 10), cy + (ry / len) * (radius - 10), 2.8 * pulse, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(cx + rx * scale, cy + ry * scale, 3 * pulse, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    
    if (this.heli.active) {
      const dx = this.heli.x - car.x;
      const dy = this.heli.y - car.y;
      const rx = dx * cos + dy * sin;
      const ry = -dx * sin + dy * cos;
      const dist = Math.hypot(dx, dy);
      
      const pulse = 1 + 0.3 * Math.sin(performance.now() * 0.015);
      
      const hx = dist > RADAR_M ? cx + (rx / dist) * (radius - 12) : cx + rx * scale;
      const hy = dist > RADAR_M ? cy + (ry / dist) * (radius - 12) : cy + ry * scale;
      
      ctx.fillStyle = "rgba(255,250,200,0.3)";
      ctx.beginPath();
      ctx.arc(hx, hy, 6 * pulse, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.fillStyle = "#ffc24b";
      ctx.beginPath();
      ctx.arc(hx, hy, 3.5, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.strokeStyle = "#ffc24b";
      ctx.lineWidth = 1;
      const rotorAngle = performance.now() * 0.02;
      ctx.beginPath();
      ctx.moveTo(hx + Math.cos(rotorAngle) * 5, hy + Math.sin(rotorAngle) * 5);
      ctx.lineTo(hx - Math.cos(rotorAngle) * 5, hy - Math.sin(rotorAngle) * 5);
      ctx.stroke();
    }
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

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
