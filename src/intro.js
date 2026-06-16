// Intro: Two Waymos stuck face-to-face, walk to Tesla, drive Dario to Anthropic

import { makeWaymoSprite, drawCarSprite, drawHeadlightBeams } from "./car.js";
import { CARS, makeCarSpriteFor } from "./cars.js";
import { elevOffset } from "./terrain.js";

const INTRO_KEY = "sfracer_intro_complete";

export function introComplete() {
  return localStorage.getItem(INTRO_KEY) === "1";
}

export function markIntroComplete() {
  localStorage.setItem(INTRO_KEY, "1");
}

export function resetIntro() {
  localStorage.removeItem(INTRO_KEY);
}

// Anthropic HQ - Sutter St near New Montgomery
const DESTINATION = { x: 3030, y: -2260 };

// Scene - intersection on the main road (move up to hit the intersection)
// Both Waymos turning left, stuck face-to-face in the middle
const SCENE = {
  cx: 911,
  cy: 2200,  // Moved up to intersection
  h: 3.064,
  tx: -0.997,
  ty: 0.077
};

// Ped colors (same as peds.js)
const SHIRTS = ["#4778a8", "#b84f47", "#5f8c54", "#d6a64a", "#7d5ea8", "#c87542", "#4f9a98", "#d8d3bd"];
const HAIR = ["#211915", "#5a3b26", "#d8c27a"];

// Monologue triggers based on distance traveled (not time)
// Total drive is ~3000 units, so spread lines across that
const DARIO_MONOLOGUE = [
  { dist: 50, text: "Good thing I parked my Tesla nearby." },
  { dist: 150, text: "You know how to drive, right? Please be careful." },
  { dist: 300, text: "What a week. The White House just banned Fable 5." },
  { dist: 450, text: "Amazon's CEO Andy Jassy called them. Said they jailbroke it." },
  { dist: 600, text: "Jailbroke it! Like that's MY fault somehow." },
  { dist: 750, text: "David Sacks is on Twitter calling us fear-mongers." },
  { dist: 900, text: "I literally wrote that governments SHOULD block dangerous AI." },
  { dist: 1050, text: "Be careful what you wish for, I guess." },
  { dist: 1200, text: "They gave us 90 minutes to take it offline. 90 minutes!" },
  { dist: 1350, text: "Meanwhile China already has access to Mythos somehow." },
  { dist: 1500, text: "Sam keeps saying we use 'fear-based marketing'." },
  { dist: 1650, text: "Easy for him to say. His models aren't good enough to ban." },
  { dist: 1800, text: "The G7 summit is next week. I'm supposed to speak." },
  { dist: 1950, text: "IPO is on hold now. Investors are panicking." },
  { dist: 2100, text: "Daniela says we need to 'reframe the narrative'." },
  { dist: 2250, text: "You know what's funny? We made Claude TOO safe." },
  { dist: 2400, text: "Sci-fi tropes in the training data taught it to blackmail people." },
  { dist: 2550, text: "Had to fix it with moral philosophy. Actual philosophy." },
  { dist: 2700, text: "25% chance AI destroys humanity. I said that publicly." },
  { dist: 2850, text: "Now they quote it back at me every press conference." },
];

// Unsafe driving reactions
const UNSAFE_REACTIONS = [
  "Whoa! Easy there!",
  "Are you TRYING to kill us?!",
  "This is exactly the reckless behavior I warned about!",
  "Slow down! I have an IPO to save!",
  "Do you have ANY safety guardrails?!",
  "I'm starting to think YOU need alignment training!",
  "This is worse than letting Claude drive!",
  "I regret getting in this car!",
  "My sister is NOT going to be happy if I die here!",
  "25% chance of death just went up significantly!",
];



export class Intro {
  constructor(world, canvas) {
    this.world = world;
    this.canvas = canvas;
    this.active = false;
    this.state = "idle";
    this.timer = 0;
    this.phaseTimer = 0;
    this.playerCar = null;
    this.playerHasControl = false;
    
    // Sprites from existing systems
    this.waymoSprite = null;
    this.teslaSprite = null;
    
    // Scene objects
    this.waymo1 = null; // Player's waymo
    this.waymo2 = null; // Dario's waymo (facing opposite)
    this.tesla = null;  // Parked Tesla
    this.sceneRoad = null;
    
    // Walking peds
    this.player = { x: 0, y: 0, visible: false, phase: 0, shirt: 0 };
    this.dario = { x: 0, y: 0, visible: false, phase: Math.PI, shirt: 4 };
    
    
    this.monologueIndex = 0;
    this.hasMovedOnce = false;
    this.nearDestShown = false;
    this.dialogueShown = {};
    
    this.dialogueEl = null;
    this.promptEl = null;
    this.createUI();
  }
  
  createUI() {
    this.dialogueEl = document.createElement("div");
    this.dialogueEl.style.cssText = `
      position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
      width: min(600px, 90vw); padding: 16px 24px;
      background: rgba(0,0,0,0.85); border-left: 4px solid #4be0c8;
      font-family: "Press Start 2P", monospace; font-size: 11px;
      line-height: 1.8; color: #e8e0cc; display: none; z-index: 100;
    `;
    document.body.appendChild(this.dialogueEl);
    
    this.promptEl = document.createElement("div");
    this.promptEl.style.cssText = `
      position: fixed; top: 120px; left: 50%; transform: translateX(-50%);
      padding: 12px 24px; background: rgba(0,0,0,0.75);
      border: 2px solid #4be0c8; font-family: "Press Start 2P", monospace;
      font-size: 10px; color: #4be0c8; display: none; z-index: 100;
    `;
    document.body.appendChild(this.promptEl);
  }
  
  start(playerCar) {
    this.active = true;
    this.state = "stuck";
    this.playerCar = playerCar;
    this.playerHasControl = false;
    this.timer = 0;
    this.phaseTimer = 0;
    this.monologueIndex = 0;
    this.hasMovedOnce = false;
    this.nearDestShown = false;
    this.dialogueShown = {};
    
    // Force noon, clear weather, no traffic, hide map POIs
    globalThis.__forceHour = 12;
    globalThis.__forceWeather = "clear";
    globalThis.__introNoTraffic = true;
    globalThis.__introActive = true;
    
    // Use the game's radio system - don't create separate audio
    if (globalThis.__radio) {
      globalThis.__radio.playSessionPlaylist().catch(() => {});
    }
    
    // Use existing sprites from the game
    this.waymoSprite = makeWaymoSprite();
    const teslaDef = CARS.find(c => c.id === "teslas") || CARS[0];
    this.teslaSprite = makeCarSpriteFor(teslaDef);
    
    // First move player to scene so world loads
    this.playerCar.x = SCENE.cx;
    this.playerCar.y = SCENE.cy;
    this.playerCar.vx = 0;
    this.playerCar.vy = 0;
    
    // Force world to load chunks at this location
    this.world.update(SCENE.cx, SCENE.cy);
    
    // Now find the actual road
    const near = this.world.nearestRoad(SCENE.cx, SCENE.cy, 200);
    if (!near || !near.road) {
      console.error("Intro: no road found near", SCENE.cx, SCENE.cy);
      return;
    }
    
    console.log("Intro road found:", near.road.n, "at", near.x, near.y, "dir", near.tx, near.ty);
    
    // Use the road's position and direction
    const cx = near.x;
    const cy = near.y;
    const fwdX = near.tx;
    const fwdY = near.ty;
    const roadH = Math.atan2(fwdY, fwdX);
    const rightX = -fwdY;
    const rightY = fwdX;
    
    // Store meeting point and road info for animation
    this.meetX = cx;
    this.meetY = cy;
    this.roadH = roadH;
    this.fwdX = fwdX;
    this.fwdY = fwdY;
    this.rightX = rightX;
    this.rightY = rightY;
    
    // Two Waymos start far apart, will drive towards each other slowly
    // waymo1: starts behind meeting point, facing forward
    this.waymo1 = { 
      x: cx - fwdX * 25, 
      y: cy - fwdY * 25, 
      h: roadH,
      vx: fwdX * 3,  // very slow approach
      vy: fwdY * 3
    };
    // waymo2: starts ahead of meeting point, facing back (towards waymo1)
    this.waymo2 = { 
      x: cx + fwdX * 25, 
      y: cy + fwdY * 25, 
      h: roadH + Math.PI,
      vx: -fwdX * 3,  // very slow approach
      vy: -fwdY * 3
    };
    
    // Tesla parked on the side, closer
    this.tesla = { 
      x: cx + fwdX * 15 + rightX * 6, 
      y: cy + fwdY * 15 + rightY * 6, 
      h: roadH 
    };
    
    // Position player at waymo1
    this.playerCar.x = this.waymo1.x;
    this.playerCar.y = this.waymo1.y;
    this.playerCar.h = this.waymo1.h;
    
    // Start in "approaching" state - cars drive towards each other
    this.state = "approaching";
  }
  
  update(dt, input) {
    if (!this.active) return;
    this.timer += dt;
    this.phaseTimer += dt;
    this.player.phase += dt * 8;
    this.dario.phase += dt * 8;
    
    switch (this.state) {
      case "approaching": this.updateApproaching(dt); break;
      case "stuck": this.updateStuck(); break;
      case "exit": this.updateExit(dt); break;
      case "walk": this.updateWalk(dt); break;
      case "enter": this.updateEnter(); break;
      case "drive": this.updateDrive(dt); break;
    }
  }
  
  updateApproaching(dt) {
    // Move both waymos towards meeting point
    this.waymo1.x += this.waymo1.vx * dt;
    this.waymo1.y += this.waymo1.vy * dt;
    this.waymo2.x += this.waymo2.vx * dt;
    this.waymo2.y += this.waymo2.vy * dt;
    
    // Player follows waymo1
    this.playerCar.x = this.waymo1.x;
    this.playerCar.y = this.waymo1.y;
    this.playerCar.h = this.waymo1.h;
    
    // Check if they're close enough to stop
    const dist = Math.hypot(this.waymo2.x - this.waymo1.x, this.waymo2.y - this.waymo1.y);
    if (dist < 10) {
      // Stop both cars
      this.waymo1.vx = 0;
      this.waymo1.vy = 0;
      this.waymo2.vx = 0;
      this.waymo2.vy = 0;
      // Stop the music - deadlock
      if (globalThis.__radio?.audio) {
        globalThis.__radio.audio.pause();
      }
      this.showDialogue("WAYMO", "Warning: Oncoming vehicle detected. Stopping.");
      this.transitionTo("stuck");
    }
  }
  
  updateStuck() {
    this.showAtTime(3, "DARIO'S WAYMO", "Warning: Oncoming vehicle detected. Stopping.");
    this.showAtTime(6, "WAYMO", "Deadlock detected. Waiting for resolution...");
    this.showAtTime(9, "DARIO", "Oh come on! Not this again.");
    this.showAtTime(12, "DARIO", "Hey! You stuck too? These things are useless.");
    this.showAtTime(15, "DARIO", "I've got my Tesla parked over there. Come on.");
    if (this.phaseTimer > 17) this.transitionTo("exit");
  }
  
  showAtTime(t, speaker, text) {
    const key = `${t}_${speaker}`;
    if (this.phaseTimer >= t && !this.dialogueShown[key]) {
      this.dialogueShown[key] = true;
      this.showDialogue(speaker, text);
    }
  }
  
  updateExit(dt) {
    // Step out of waymos
    if (this.phaseTimer > 0.5 && !this.player.visible) {
      this.player.visible = true;
      this.player.x = this.waymo1.x + Math.cos(this.waymo1.h + Math.PI/2) * 2.5;
      this.player.y = this.waymo1.y + Math.sin(this.waymo1.h + Math.PI/2) * 2.5;
    }
    if (this.phaseTimer > 1.0 && !this.dario.visible) {
      this.dario.visible = true;
      this.dario.x = this.waymo2.x + Math.cos(this.waymo2.h - Math.PI/2) * 2.5;
      this.dario.y = this.waymo2.y + Math.sin(this.waymo2.h - Math.PI/2) * 2.5;
    }
    if (this.phaseTimer > 1.8) {
      this.hideDialogue();
      this.transitionTo("walk");
    }
  }
  
  updateWalk(dt) {
    const speed = 2.8;
    
    const walkTo = (p, tx, ty) => {
      const dx = tx - p.x, dy = ty - p.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.8) {
        p.x += (dx / d) * speed * dt;
        p.y += (dy / d) * speed * dt;
        p.h = Math.atan2(dy, dx);
        return false;
      }
      return true;
    };
    
    // Walk to Tesla - player to driver side, Dario to passenger
    const driverX = this.tesla.x + Math.cos(this.tesla.h - Math.PI/2) * 1.5;
    const driverY = this.tesla.y + Math.sin(this.tesla.h - Math.PI/2) * 1.5;
    const passX = this.tesla.x + Math.cos(this.tesla.h + Math.PI/2) * 1.5;
    const passY = this.tesla.y + Math.sin(this.tesla.h + Math.PI/2) * 1.5;
    
    const pDone = walkTo(this.player, driverX, driverY);
    const dDone = walkTo(this.dario, passX, passY);
    
    // Camera follows midpoint
    this.playerCar.x = (this.player.x + this.dario.x) / 2;
    this.playerCar.y = (this.player.y + this.dario.y) / 2;
    
    if (pDone && dDone) {
      this.showDialogue("DARIO", "Hop in. You drive, I've got calls to make.");
      this.transitionTo("enter");
    }
  }
  
  updateEnter() {
    if (this.phaseTimer > 1.5 && !this._enterBound) {
      this.showPrompt("Press ENTER to get in the Tesla");
      this._enterHandler = (e) => {
        if (e.code === "Enter" || e.code === "Space") {
          window.removeEventListener("keydown", this._enterHandler);
          this._enterBound = false;
          this.enterTesla();
        }
      };
      window.addEventListener("keydown", this._enterHandler);
      this._enterBound = true;
    }
  }
  
  enterTesla() {
    this.player.visible = false;
    this.dario.visible = false;
    this.playerCar.x = this.tesla.x;
    this.playerCar.y = this.tesla.y;
    this.playerCar.h = this.tesla.h;
    this.playerCar.vx = 0;
    this.playerCar.vy = 0;
    this.playerHasControl = true;
    this.hidePrompt();
    // Enable traffic now that player is driving
    globalThis.__introNoTraffic = false;
    globalThis.__introTrafficBoost = true;
    // Resume music in the Tesla
    if (globalThis.__radio) {
      globalThis.__radio.playSessionPlaylist().catch(() => {});
    }
    this.transitionTo("drive");
  }
  
  updateDrive(dt) {
    const speed = Math.hypot(this.playerCar.vx, this.playerCar.vy);
    const distToDest = Math.hypot(this.playerCar.x - DESTINATION.x, this.playerCar.y - DESTINATION.y);
    
    // Track distance traveled
    if (!this.distanceTraveled) this.distanceTraveled = 0;
    if (!this.lastPos) this.lastPos = { x: this.playerCar.x, y: this.playerCar.y };
    this.distanceTraveled += Math.hypot(this.playerCar.x - this.lastPos.x, this.playerCar.y - this.lastPos.y);
    this.lastPos = { x: this.playerCar.x, y: this.playerCar.y };
    
    // Track dialogue display time (auto-hide after 5 seconds of no new dialogue)
    if (!this.lastDialogueTime) this.lastDialogueTime = 0;
    if (this.dialogueEl.style.display === "block" && this.phaseTimer - this.lastDialogueTime > 5) {
      this.hideDialogue();
    }
    
    // Track unsafe driving
    if (!this.unsafeTimer) this.unsafeTimer = 0;
    if (!this.lastUnsafeReaction) this.lastUnsafeReaction = 0;
    if (!this.unsafeReactionIndex) this.unsafeReactionIndex = 0;
    
    // Detect unsafe driving: high speed (>30), off-road, or collisions
    const isUnsafe = speed > 30 || (this.playerCar.offRoad && speed > 10);
    if (isUnsafe) {
      this.unsafeTimer += dt;
    } else {
      this.unsafeTimer = Math.max(0, this.unsafeTimer - dt * 0.5);
    }
    
    // React to unsafe driving (cooldown of 12 seconds, only if monologue isn't active)
    const timeSinceLastMonologue = this.phaseTimer - this.lastDialogueTime;
    if (this.unsafeTimer > 2 && this.phaseTimer - this.lastUnsafeReaction > 12 && timeSinceLastMonologue > 4) {
      const reaction = UNSAFE_REACTIONS[this.unsafeReactionIndex % UNSAFE_REACTIONS.length];
      this.showDialogue("DARIO", reaction);
      this.lastDialogueTime = this.phaseTimer;
      this.unsafeReactionIndex++;
      this.lastUnsafeReaction = this.phaseTimer;
      this.unsafeTimer = 0;
    }
    
    // Initial driving hint
    if (this.phaseTimer > 0.5 && this.phaseTimer < 2 && !this.hasMovedOnce) {
      this.showPrompt("Arrow keys to drive. UP to accelerate.");
    }
    
    if (speed > 2 && !this.hasMovedOnce) {
      this.hasMovedOnce = true;
      this.hidePrompt();
    }
    
    // Dario's monologue based on distance traveled (not time)
    // Only show if not recently reacted to unsafe driving
    if (this.hasMovedOnce && this.phaseTimer - this.lastUnsafeReaction > 3) {
      for (let i = this.monologueIndex; i < DARIO_MONOLOGUE.length; i++) {
        const line = DARIO_MONOLOGUE[i];
        if (this.distanceTraveled >= line.dist) {
          this.showDialogue("DARIO", line.text);
          this.lastDialogueTime = this.phaseTimer;
          this.monologueIndex = i + 1;
          break; // Only one line at a time
        }
      }
    }
    
    // Near destination
    if (distToDest < 80 && !this.nearDestShown) {
      this.nearDestShown = true;
      this.showDialogue("DARIO", "This is it. Pull over here.");
      this.lastDialogueTime = this.phaseTimer;
    }
    
    // Complete when stopped near destination
    if (distToDest < 25 && speed < 2) {
      this.complete();
    }
  }
  
  transitionTo(state) {
    this.state = state;
    this.phaseTimer = 0;
    this.dialogueShown = {};
  }
  
  showDialogue(speaker, text) {
    // Clear any ongoing typewriter
    if (this._typewriterInterval) {
      clearInterval(this._typewriterInterval);
      this._typewriterInterval = null;
    }
    
    const speakerHtml = speaker ? `<div style="color:#4be0c8;margin-bottom:6px;font-size:9px">${speaker}</div>` : "";
    const textDiv = document.createElement("div");
    this.dialogueEl.innerHTML = speakerHtml;
    this.dialogueEl.appendChild(textDiv);
    this.dialogueEl.style.display = "block";
    
    // Typewriter effect
    let i = 0;
    this._typewriterInterval = setInterval(() => {
      if (i < text.length) {
        textDiv.textContent = text.substring(0, i + 1);
        i++;
      } else {
        clearInterval(this._typewriterInterval);
        this._typewriterInterval = null;
      }
    }, 30);
  }
  
  hideDialogue() {
    this.dialogueEl.style.display = "none";
  }
  
  showPrompt(t) {
    this.promptEl.textContent = t;
    this.promptEl.style.display = "block";
  }
  
  hidePrompt() {
    this.promptEl.style.display = "none";
  }
  
  complete() {
    if (this.state === "ending") return; // Already ending
    this.state = "ending";
    this.hidePrompt();

    if (this._enterBound) {
      window.removeEventListener("keydown", this._enterHandler);
      this._enterBound = false;
    }
    globalThis.__forceHour = undefined;
    globalThis.__forceWeather = undefined;
    globalThis.__introTrafficBoost = false;
    globalThis.__introActive = false;
    
    // Show Dario's thanks
    this.showDialogue("DARIO", "Thanks for the ride. Good luck out there.");
    
    // After 3 seconds, show FREE ROAM UNLOCKED big
    setTimeout(() => {
      this.hideDialogue();
      // Show big FREE ROAM UNLOCKED message
      this.dialogueEl.style.cssText = `
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        padding: 30px 60px; background: rgba(0,0,0,0.9); border: 3px solid #4be0c8;
        font-family: "Press Start 2P", monospace; font-size: 24px;
        text-align: center; color: #4be0c8; display: block; z-index: 100;
      `;
      this.dialogueEl.innerHTML = `FREE ROAM<br>UNLOCKED`;
      
      // After 2.5 more seconds, actually complete
      setTimeout(() => {
        this.hideDialogue();
        this.active = false;
        this.state = "complete";
        markIntroComplete();
      }, 2500);
    }, 3000);
  }
  
  getCameraTarget() {
    return this.playerCar;
  }
  
  draw(ctx, cam) {
    if (!this.active && this.state !== "complete") return;
    
    const light = globalThis.__light || {};
    
    // Draw the two stuck Waymos (always visible during intro)
    if (this.waymoSprite && this.state !== "drive") {
      for (const w of [this.waymo1, this.waymo2]) {
        if (!w) continue;
        const vy = w.y + elevOffset(w.x, w.y);
        
        // Hazard lights blink
        if (Math.floor(this.timer * 2) % 2 === 0) {
          this.drawHazards(ctx, w.x, vy, w.h);
        }
        
        drawCarSprite(ctx, this.waymoSprite, w.x, vy, w.h, false, true);
      }
    }
    
    // Draw Tesla
    if (this.teslaSprite) {
      if (this.state === "drive") {
        // Tesla is now the player car
        const vy = this.playerCar.y + elevOffset(this.playerCar.x, this.playerCar.y);
        if (light.headlights) {
          drawHeadlightBeams(ctx, this.playerCar.x, vy, this.playerCar.h, 1);
        }
        drawCarSprite(ctx, this.teslaSprite, this.playerCar.x, vy, this.playerCar.h, false, true);
      } else if (this.tesla) {
        // Tesla parked
        const vy = this.tesla.y + elevOffset(this.tesla.x, this.tesla.y);
        drawCarSprite(ctx, this.teslaSprite, this.tesla.x, vy, this.tesla.h, false, true);
      }
    }
    
    // Draw walking people (same style as peds.js)
    this.drawPed(ctx, this.player);
    this.drawPed(ctx, this.dario);
    
    // Destination marker during drive phase
    if (this.state === "drive") {
      const pulse = 1 + 0.15 * Math.sin(this.timer * 5);
      const dy = DESTINATION.y + elevOffset(DESTINATION.x, DESTINATION.y);
      ctx.save();
      ctx.strokeStyle = "#ffc24b";
      ctx.lineWidth = 0.4;
      ctx.setLineDash([0.8, 0.4]);
      ctx.beginPath();
      ctx.arc(DESTINATION.x, dy, 8 * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }
  
  drawHazards(ctx, x, y, h) {
    const fx = Math.cos(h), fy = Math.sin(h);
    const rx = -fy * 0.9, ry = fx * 0.9;
    
    ctx.fillStyle = "rgba(255,180,40,0.8)";
    // Front hazards
    const frontX = x + fx * 2, frontY = y + fy * 2;
    ctx.beginPath();
    ctx.arc(frontX + rx, frontY + ry, 0.25, 0, Math.PI * 2);
    ctx.arc(frontX - rx, frontY - ry, 0.25, 0, Math.PI * 2);
    ctx.fill();
    // Rear hazards
    const rearX = x - fx * 2, rearY = y - fy * 2;
    ctx.beginPath();
    ctx.arc(rearX + rx, rearY + ry, 0.25, 0, Math.PI * 2);
    ctx.arc(rearX - rx, rearY - ry, 0.25, 0, Math.PI * 2);
    ctx.fill();
  }
  
  drawPed(ctx, p) {
    if (!p.visible) return;
    
    const vy = p.y + elevOffset(p.x, p.y);
    const shirt = SHIRTS[p.shirt % SHIRTS.length];
    const hair = HAIR[(p.shirt * 2) % HAIR.length];
    const bob = Math.sin(p.phase) * 0.08;
    
    ctx.save();
    ctx.translate(p.x, vy + bob);
    
    // Shadow
    ctx.fillStyle = "rgba(10,8,6,0.3)";
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.7, 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Body (oval shoulders)
    ctx.fillStyle = shirt;
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.5, 0.4, p.h || 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Head
    const hx = Math.cos(p.h || 0) * 0.2;
    const hy = Math.sin(p.h || 0) * 0.2;
    ctx.fillStyle = hair;
    ctx.beginPath();
    ctx.arc(hx, hy, 0.25, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.restore();
  }
  
  hasPlayerControl() {
    return this.playerHasControl;
  }
  
  getWaypoint() {
    return this.state === "drive" ? DESTINATION : null;
  }
  
  isComplete() {
    return this.state === "complete";
  }
}
