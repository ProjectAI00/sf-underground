// Police system: patrol like traffic, switch to pursuit when triggered
// Cops drive with realistic physics (like player), try to box in, no slowdown on hit

import { makeCarSprite, drawCarSprite, drawHeadlightBeams, SPRITE_PPM } from "./car.js";
import { elevOffset } from "./terrain.js";

const POLICE_BODY = "#1a1a24";
const SIREN_RED = "#ff3030";
const SIREN_BLUE = "#3060ff";

// Helicopter constants
const HELI_SPEED = 95;
const HELI_ACCEL = 40;
const HELI_TURN_RATE = 6;

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

// Tier difficulty - cops match player tier capability
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
    
    // Pursuit - slightly slower than player so escape is possible
    const speedMult = this.wantedLevel >= 5 ? 0.95 : 0.90; // 5% slower at 5 stars, 10% otherwise
    let desiredSpeed;
    if (distToTarget < 15) {
      desiredSpeed = Math.min(20, driftDist * 1.0);
    } else if (distToTarget < 50) {
      desiredSpeed = Math.max(35, playerSpeed * speedMult);
    } else {
      desiredSpeed = Math.max(HELI_SPEED, playerSpeed * speedMult);
    }
    
    // Snappier acceleration
    const accelRate = distToTarget > 60 ? 15 : 10;
    const targetVx = driftDist > 1 ? (toDriftX / driftDist) * desiredSpeed : 0;
    const targetVy = driftDist > 1 ? (toDriftY / driftDist) * desiredSpeed : 0;
    
    heli.vx += (targetVx - heli.vx) * Math.min(1, accelRate * dt * 0.15);
    heli.vy += (targetVy - heli.vy) * Math.min(1, accelRate * dt * 0.15);
    
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
      crashT: 0,
      disabled: false,
      disabledTimer: 0,
    });
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
    // Simple patrol: follow road, maintain speed
    const near = this.world.nearestRoad(c.x, c.y, 50);
    const speed = Math.hypot(c.vx, c.vy);
    
    let targetH = c.h;
    if (near) {
      // Follow road direction
      const dot = Math.cos(c.h) * near.tx + Math.sin(c.h) * near.ty;
      const dir = dot >= 0 ? 1 : -1;
      targetH = Math.atan2(near.ty * dir, near.tx * dir);
      
      // Steer toward road center if drifting off
      if (near.d > 3) {
        const toRoad = Math.atan2(near.y - c.y, near.x - c.x);
        targetH = blendAngles(targetH, toRoad, 0.3);
      }
    }
    
    // Steering
    const steerDelta = angDiff(targetH, c.h);
    c.steer = clamp(steerDelta * 2, -1, 1);
    c.h += c.steer * c.steerRate * dt;
    
    // Throttle to maintain patrol speed (~50 km/h)
    const targetSpeed = 14;
    c.throttle = speed < targetSpeed ? 0.5 : 0;
    
    // Apply physics
    this.#applyCarPhysics(c, dt);
  }

  #updatePursuit(c, dt, player) {
    const dx = player.x - c.x;
    const dy = player.y - c.y;
    const dist = Math.hypot(dx, dy);
    const playerSpeed = Math.hypot(player.vx || 0, player.vy || 0);
    const copSpeed = Math.hypot(c.vx, c.vy);
    
    // Predict player position based on role
    let targetX, targetY;
    
    switch (c.role) {
      case "block_front": {
        // Get ahead of player and block
        const predictTime = Math.min(4, dist / Math.max(copSpeed, 20));
        targetX = player.x + (player.vx || 0) * predictTime * 1.5;
        targetY = player.y + (player.vy || 0) * predictTime * 1.5;
        // If we're ahead, slow down and position
        const aheadDot = dx * (player.vx || 0.001) + dy * (player.vy || 0.001);
        if (aheadDot < 0 && dist < 50) {
          // We're ahead - try to get in front
          targetX = player.x + (player.vx || 0) * 2;
          targetY = player.y + (player.vy || 0) * 2;
        }
        break;
      }
      case "flank": {
        // Come from the side
        const predictTime = Math.min(2, dist / Math.max(copSpeed, 20));
        const baseX = player.x + (player.vx || 0) * predictTime;
        const baseY = player.y + (player.vy || 0) * predictTime;
        // Offset to side based on which side we're on
        const side = (c.x - player.x) * (player.vy || 0) - (c.y - player.y) * (player.vx || 0);
        const perpX = -(player.vy || 0);
        const perpY = (player.vx || 0);
        const perpLen = Math.hypot(perpX, perpY) || 1;
        const sideSign = side > 0 ? 1 : -1;
        // Target: player position offset to their side
        if (dist > 30) {
          targetX = baseX + (perpX / perpLen) * sideSign * 15;
          targetY = baseY + (perpY / perpLen) * sideSign * 15;
        } else {
          // Close enough - ram into side
          targetX = player.x + (perpX / perpLen) * sideSign * 3;
          targetY = player.y + (perpY / perpLen) * sideSign * 3;
        }
        break;
      }
      case "chase":
      default: {
        // Direct pursuit with slight prediction
        const predictTime = Math.min(1.5, dist / Math.max(copSpeed, 15));
        targetX = player.x + (player.vx || 0) * predictTime;
        targetY = player.y + (player.vy || 0) * predictTime;
        break;
      }
    }
    
    // Calculate desired heading
    const toTargetX = targetX - c.x;
    const toTargetY = targetY - c.y;
    let targetH = Math.atan2(toTargetY, toTargetX);
    
    // Avoid buildings - probe ahead
    const fx = Math.cos(c.h);
    const fy = Math.sin(c.h);
    const probeLen = 15 + copSpeed * 0.15;
    
    for (let d = 5; d <= probeLen; d += 5) {
      if (this.world.buildingAt(c.x + fx * d, c.y + fy * d)) {
        // Building ahead - find clear direction
        const rx = -fy, ry = fx;
        const leftClear = !this.world.buildingAt(c.x + fx * d + rx * 8, c.y + fy * d + ry * 8);
        const rightClear = !this.world.buildingAt(c.x + fx * d - rx * 8, c.y + fy * d - ry * 8);
        
        if (leftClear && !rightClear) {
          targetH = c.h + 0.8;
        } else if (rightClear && !leftClear) {
          targetH = c.h - 0.8;
        } else if (!leftClear && !rightClear) {
          targetH = c.h + Math.PI; // Dead end, reverse
        }
        break;
      }
    }
    
    // Steering toward target
    const steerDelta = angDiff(targetH, c.h);
    const steerInput = clamp(steerDelta * 3, -1, 1);
    c.steer += (steerInput - c.steer) * Math.min(1, 8 * dt);
    
    // Throttle control based on situation
    const building = this.world.buildingAt(c.x + fx * 10, c.y + fy * 10);
    const sharpTurn = Math.abs(steerDelta) > 0.8;
    
    if (building) {
      c.throttle = -0.3; // Brake hard
    } else if (sharpTurn && copSpeed > 15) {
      c.throttle = 0.2; // Ease off for turns
    } else if (dist < 15 && c.role !== "chase") {
      // Close to player - match speed for boxing
      c.throttle = playerSpeed > copSpeed ? 0.8 : 0.3;
    } else {
      c.throttle = 1; // Full pursuit
    }
    
    // Apply physics
    this.#applyCarPhysics(c, dt);
  }
  
  #applyCarPhysics(c, dt) {
    // Same physics model as player car
    const fx = Math.cos(c.h);
    const fy = Math.sin(c.h);
    const rx = -fy;
    const ry = fx;
    
    // Decompose velocity into forward/lateral
    let vF = c.vx * fx + c.vy * fy;
    let vL = c.vx * rx + c.vy * ry;
    
    // Acceleration/braking
    if (c.throttle > 0) {
      const accelForce = c.accel * c.throttle * (1 - Math.max(0, vF) / c.maxSpeed);
      vF += accelForce * dt;
    } else if (c.throttle < 0) {
      vF -= c.brake * (-c.throttle) * dt;
    }
    
    // Natural drag
    vF -= vF * 0.15 * dt;
    
    // Steering
    const speed = Math.abs(vF);
    const steerGain = c.steerRate * Math.min(1, speed / 10) * (1 - Math.min(0.4, speed / 100));
    c.h += c.steer * steerGain * (vF < -0.5 ? -1 : 1) * dt;
    
    // Grip (lateral velocity decay)
    const grip = c.grip;
    vL -= vL * Math.min(1, grip * dt);
    
    // Recompose velocity
    const newFx = Math.cos(c.h);
    const newFy = Math.sin(c.h);
    const newRx = -newFy;
    const newRy = newFx;
    c.vx = newFx * vF + newRx * vL;
    c.vy = newFy * vF + newRy * vL;
    
    // Movement with collision
    const newX = c.x + c.vx * dt;
    const newY = c.y + c.vy * dt;
    
    if (this.world.buildingAt(newX, newY)) {
      // Hit building - bounce back
      c.vx *= -0.3;
      c.vy *= -0.3;
      c.crashT = 0.2;
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
