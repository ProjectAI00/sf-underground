// The garage: car definitions (stats 0-10) and procedural pixel-art sprites.
// Stats map to physics in Car (speed -> top speed, accel -> engine, brakes,
// cornering -> grip/steering). Aura is... aura. It glows.

import { SPRITE_PPM, drawCarBase, drawGlass, drawLights } from "./car.js";
import { getCachedSprite, imageToCanvas } from "./car-sprites.js";

export const CARS = [
  // C-tier: Entry level, max ~140 km/h
  {
    id: "civic",
    name: "HONDA CIVIC EG",
    tier: "C",
    color: "#e8e4d8",
    accent: "#1a1a1e",
    stats: { speed: 4, accel: 5, brakes: 5, cornering: 7, aura: 6 },
    blurb: "VTEC KICKED IN YO. RICE LEGEND.",
    shape: "coupe",
  },
  {
    id: "miata",
    name: "MAZDA MX-5 NA",
    tier: "C",
    color: "#c41e24",
    accent: "#1a1a1e",
    stats: { speed: 3, accel: 4, brakes: 6, cornering: 9, aura: 8 },
    blurb: "MIATA IS ALWAYS THE ANSWER.",
    shape: "wedge",
  },
  // B-tier: Street cars, max ~180 km/h
  {
    id: "944",
    name: "PORSCHE 944",
    tier: "B",
    color: "#cdd0d4",
    accent: "#9a3324",
    stats: { speed: 6, accel: 5, brakes: 6, cornering: 8, aura: 7 },
    blurb: "TRANSAXLE BALANCE. POP-UPS.",
    shape: "wedge",
  },
  {
    id: "m3e92",
    name: "BMW M3 '08",
    tier: "B",
    color: "#3c5fa8",
    accent: "#e8e6e1",
    stats: { speed: 7, accel: 7, brakes: 7, cornering: 6, aura: 5 },
    blurb: "V8 SCREAMER. CRAIGSLIST SPECIAL.",
    shape: "sedan",
  },
  {
    id: "teslas",
    name: "TESLA MODEL S",
    edition: "TECH BRO EDITION",
    tier: "B",
    color: "#e8e6e1",
    accent: "#2a2a30",
    stats: { speed: 6, accel: 9, brakes: 5, cornering: 4, aura: 3 },
    blurb: "LUDICROUS OFF THE LINE. ZERO SOUL.",
    shape: "liftback",
  },
  {
    id: "r34",
    name: "NISSAN GT-R R34",
    tier: "B",
    color: "#4a72c8",
    accent: "#c9ccd2",
    stats: { speed: 8, accel: 6, brakes: 6, cornering: 7, aura: 10 },
    blurb: "GODZILLA. MIDNIGHT LEGEND.",
    shape: "coupe",
  },
  // A-tier: Sports/tuned cars, max ~240 km/h
  {
    id: "911gt3",
    name: "PORSCHE 911 GT3",
    tier: "A",
    color: "#f5f5f0",
    accent: "#e85d04",
    stats: { speed: 8, accel: 7, brakes: 9, cornering: 9, aura: 8 },
    blurb: "REAR ENGINE PERFECTION. TRACK WEAPON.",
    shape: "coupe",
  },
  {
    id: "amggt",
    name: "MERCEDES AMG GT",
    tier: "A",
    color: "#2d2d2d",
    accent: "#c4a035",
    stats: { speed: 9, accel: 8, brakes: 8, cornering: 7, aura: 7 },
    blurb: "TWIN TURBO V8. GERMAN MUSCLE.",
    shape: "coupe",
  },
  {
    id: "nsx",
    name: "HONDA NSX '91",
    tier: "A",
    color: "#c41e24",
    accent: "#1a1a1e",
    stats: { speed: 7, accel: 7, brakes: 8, cornering: 10, aura: 9 },
    blurb: "SENNA'S DAILY. MID-ENGINE PURITY.",
    shape: "wedge",
  },
  // S-tier: Supercars, max ~300 km/h
  {
    id: "f1lm",
    name: "MCLAREN F1 LM",
    tier: "S",
    color: "#f28c00",
    accent: "#1a1a1e",
    stats: { speed: 10, accel: 8, brakes: 8, cornering: 8, aura: 10 },
    blurb: "GOLD-LINED V12. THE GOAT.",
    shape: "f1",
  },
  {
    id: "laferrari",
    name: "FERRARI LAFERRARI",
    tier: "S",
    color: "#cc0000",
    accent: "#1a1a1e",
    stats: { speed: 10, accel: 10, brakes: 9, cornering: 9, aura: 10 },
    blurb: "HYBRID HYPERCAR. MARANELLO'S FINEST.",
    shape: "wedge",
  },
  {
    id: "p1",
    name: "MCLAREN P1",
    tier: "S",
    color: "#3d3d3d",
    accent: "#7fff00",
    stats: { speed: 10, accel: 10, brakes: 10, cornering: 9, aura: 9 },
    blurb: "ACTIVE AERO. HYBRID BEAST.",
    shape: "wedge",
  },
];

export function carById(id) {
  return CARS.find((c) => c.id === id) || CARS[0];
}

/** 
 * stats (0-10) -> physics params
 * Balanced tiers - each tier is fun but higher is clearly better:
 * C: top ~140 km/h, corner ~90 km/h
 * B: top ~180 km/h, corner ~120 km/h
 * A: top ~240 km/h, corner ~170 km/h
 * S: top ~300 km/h, corner ~220 km/h
 */
export function physFor(def) {
  const s = def.stats;
  const tier = def.tier || "B";
  
  // Top speed (m/s) - clear progression
  const tierTopSpeed = { C: 39, B: 50, A: 67, S: 83 };
  const baseTop = tierTopSpeed[tier] || 50;
  const topSpeed = baseTop * (0.9 + s.speed * 0.012);
  
  // Acceleration - C feels slow, S feels fast, all are playable
  const tierAccel = { C: 7, B: 10, A: 14, S: 20 };
  const engine = (tierAccel[tier] || 10) * (0.85 + s.accel * 0.018);
  
  // Braking - scales with tier, all adequate
  const tierBrake = { C: 30, B: 35, A: 42, S: 50 };
  const brake = (tierBrake[tier] || 35) * (0.88 + s.brakes * 0.014);
  
  // Grip - more downforce = more grip. S tier sticks hard
  const tierGrip = { C: 7, B: 9, A: 12, S: 16 };
  const grip = (tierGrip[tier] || 9) * (0.9 + s.cornering * 0.012);
  
  // Steering - S tier is razor sharp
  const tierSteer = { C: 2.0, B: 2.4, A: 2.9, S: 3.6 };
  const steer = (tierSteer[tier] || 2.4) * (0.9 + s.cornering * 0.012);
  
  // Max safe cornering speed (km/h) - balanced per tier
  const tierCornerSpeed = { C: 90, B: 120, A: 170, S: 220 };
  const maxCornerSpeed = (tierCornerSpeed[tier] || 120) * (0.92 + s.cornering * 0.01);
  
  return {
    topSpeed,
    engine,
    brake,
    grip,
    steer,
    maxCornerSpeed,
    aura: s.aura,
    tier,
  };
}

/** distinct pixel cars per shape on the shared chassis; front = top */
export function makeCarSpriteFor(def, scale = 1) {
  const png = getCachedSprite(def.id);
  if (png) {
    const base = imageToCanvas(png);
    if (scale === 1) return base;
    const c = document.createElement("canvas");
    c.width = Math.round(base.width * scale);
    c.height = Math.round(base.height * scale);
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.drawImage(base, 0, 0, c.width, c.height);
    return c;
  }

  const Lm = 4.5, Wm = 2.1;
  const c = document.createElement("canvas");
  c.width = Math.round(Wm * SPRITE_PPM * scale);
  c.height = Math.round(Lm * SPRITE_PPM * scale);
  const g = c.getContext("2d");
  g.imageSmoothingEnabled = false;
  g.scale(scale, scale);
  const w = Math.round(Wm * SPRITE_PPM), h = Math.round(Lm * SPRITE_PPM);
  drawCarBase(g, w, h, def.color, "#16161b");
  const accent = def.accent;

  switch (def.shape) {
    case "wedge": // 944: long flat nose, pop-ups, big hatch glass
      g.fillStyle = "rgba(0,0,0,0.14)";
      g.fillRect(3, 2, w - 6, Math.round(h * 0.3));      // long hood
      drawGlass(g, 3, Math.round(h * 0.40), w - 6, 5);   // windshield set back
      drawGlass(g, 3, Math.round(h * 0.64), w - 6, 6);   // hatch bubble
      g.fillStyle = accent;                               // side script stripe
      g.fillRect(2, Math.round(h * 0.5), 1, 6);
      g.fillRect(w - 3, Math.round(h * 0.5), 1, 6);
      g.fillStyle = "#d9d4c8";                            // sleeping pop-ups
      g.fillRect(3, 2, 3, 1);
      g.fillRect(w - 6, 2, 3, 1);
      break;
    case "sedan": // M3: 4-door glass, kidneys, quad pipes
      drawGlass(g, 3, Math.round(h * 0.28), w - 6, 5);
      drawGlass(g, 3, Math.round(h * 0.50), w - 6, 4);
      drawGlass(g, 3, Math.round(h * 0.66), w - 6, 3);
      g.fillStyle = accent;
      g.fillRect(Math.floor(w / 2) - 2, 1, 2, 2);        // kidneys
      g.fillRect(Math.floor(w / 2) + 1, 1, 2, 2);
      g.fillStyle = "#2c2c30";
      g.fillRect(3, h - 2, 3, 1);                         // quad exhaust
      g.fillRect(w - 6, h - 2, 3, 1);
      break;
    case "liftback": // Tesla: one huge glass canopy, flush light bar
      drawGlass(g, 3, Math.round(h * 0.24), w - 6, Math.round(h * 0.5));
      g.fillStyle = accent;
      g.fillRect(3, 1, w - 6, 1);                         // front light bar
      g.fillStyle = "rgba(255,255,255,0.2)";
      g.fillRect(4, Math.round(h * 0.78), w - 8, 2);      // smooth trunk
      break;
    case "f1": { // McLaren F1: center seat, gold engine bay, long tail
      g.fillStyle = "rgba(0,0,0,0.18)";
      g.fillRect(3, 2, w - 6, 5);                         // low nose
      const cw = Math.max(5, Math.round(w * 0.42));
      drawGlass(g, Math.floor((w - cw) / 2), Math.round(h * 0.26), cw, Math.round(h * 0.24)); // center canopy
      g.fillStyle = accent;                               // gold engine bay
      g.fillRect(4, Math.round(h * 0.54), w - 8, 5);
      g.fillStyle = "rgba(0,0,0,0.25)";                   // engine vents
      g.fillRect(5, Math.round(h * 0.56), 2, 3);
      g.fillRect(w - 7, Math.round(h * 0.56), 2, 3);
      g.fillStyle = "#2c2c30";                            // center-exit exhaust
      g.fillRect(Math.floor(w / 2) - 1, h - 2, 3, 1);
      break;
    }
    case "coupe": // R34: hood vents, big GT wing
    default:
      g.fillStyle = "rgba(0,0,0,0.16)";
      g.fillRect(3, 2, w - 6, 4);
      g.fillStyle = "#2c3340";                            // hood vents
      g.fillRect(Math.floor(w / 2) - 3, 4, 2, 3);
      g.fillRect(Math.floor(w / 2) + 1, 4, 2, 3);
      drawGlass(g, 3, Math.round(h * 0.30), w - 6, 5);
      drawGlass(g, 3, Math.round(h * 0.56), w - 6, 4);
      g.fillStyle = "#16161b";                            // wing posts
      g.fillRect(3, h - 6, 2, 2);
      g.fillRect(w - 5, h - 6, 2, 2);
      g.fillStyle = accent;                               // GT wing
      g.fillRect(1, h - 5, w - 2, 2);
      break;
  }

  drawLights(g, w, h);
  return c;
}
