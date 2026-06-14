// Intro: Waymo breaks down, you steal a Tesla

import { drawCarSprite, SPRITE_PPM } from "./car.js";
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

// Destination
const DESTINATION = { x: 3100, y: -2165 };

export class Intro {
  constructor(world, canvas) {
    this.world = world;
    this.canvas = canvas;
    this.active = false;
    this.state = "idle";
    this.playerCar = null;
    this.playerHasControl = false;
    this.timer = 0;
  }
  
  start(playerCar) {
    console.log("INTRO START");
    this.active = true;
    this.state = "tutorial";
    this.playerCar = playerCar;
    this.playerHasControl = true;
    this.timer = 0;
    
    // Noon, sunny
    globalThis.__forceHour = 12;
    globalThis.__forceWeather = "clear";
  }
  
  update(dt, input) {
    if (!this.active) return;
    this.timer += dt;
    
    // After 3 seconds, complete
    if (this.timer > 60) {
      this.complete();
    }
  }
  
  complete() {
    this.active = false;
    this.state = "complete";
    markIntroComplete();
    globalThis.__forceHour = undefined;
    globalThis.__forceWeather = undefined;
  }
  
  getCameraTarget() {
    return this.playerCar;
  }
  
  draw(ctx, cam) {
    // Draw destination marker
    if (this.active && this.state === "tutorial") {
      const pulse = 1 + 0.15 * Math.sin(performance.now() * 0.005);
      const destY = DESTINATION.y + elevOffset(DESTINATION.x, DESTINATION.y);
      
      ctx.save();
      ctx.strokeStyle = "#ffc24b";
      ctx.lineWidth = 0.4;
      ctx.beginPath();
      ctx.arc(DESTINATION.x, destY, 8 * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
  
  hasPlayerControl() {
    return this.playerHasControl;
  }
  
  getWaypoint() {
    if (this.state === "tutorial") return DESTINATION;
    return null;
  }
  
  isComplete() {
    return this.state === "complete";
  }
}
