// The garage: car definitions (stats 0-10) and procedural pixel-art sprites.
// Stats map to physics in Car (speed -> top speed, accel -> engine, brakes,
// cornering -> grip/steering). Aura is... aura. It glows.

export const CARS = [
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
    name: "TESLA MODEL S TECHBRO ED.",
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
];

export function carById(id) {
  return CARS.find((c) => c.id === id) || CARS[0];
}

/** stats (0-10) -> physics params; tuned so the fastest B-tier hits ~160 km/h */
export function physFor(def) {
  const s = def.stats;
  return {
    topSpeed: 26 + s.speed * 2.3,          // m/s: 8 -> 44.4 (160 km/h)
    engine: 9 + s.accel * 1.8,             // forward accel m/s^2
    brake: 24 + s.brakes * 2.6,
    grip: 8.2 + s.cornering * 0.5,         // lateral grip
    steer: 2.25 + s.cornering * 0.09,      // steering gain
    aura: s.aura,
  };
}

import { SPRITE_PPM, drawCarBase, drawGlass, drawLights } from "./car.js";

/** distinct pixel cars per shape on the shared chassis; front = top */
export function makeCarSpriteFor(def, scale = 1) {
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
