// SF-inspired terrain height field (meters). Not survey-accurate — gives
// Nob Hill / Twin Peaks / Russian Hill feel for grade + shading.

const PEAKS = [
  { x: -280, y: -750, h: 290, sx: 1700, sy: 1300 },   // Twin Peaks / Mt Sutro
  { x: 220, y: -2520, h: 135, sx: 850, sy: 750 },      // Nob / Russian Hill
  { x: 520, y: -3180, h: 75, sx: 1100, sy: 950 },      // Pacific Heights
  { x: -1750, y: -580, h: 95, sx: 1500, sy: 1150 },   // Sunset ridge
  { x: 380, y: 650, h: 60, sx: 1300, sy: 1050 },      // Bernal / southern hills
  { x: -350, y: -4100, h: 45, sx: 1800, sy: 1400 },    // Marina / Presidio slope
];

export function elevationAt(x, y) {
  let e = 6;
  for (const p of PEAKS) {
    const dx = x - p.x, dy = y - p.y;
    e += p.h * Math.exp(-(dx * dx) / (p.sx * p.sx) - (dy * dy) / (p.sy * p.sy));
  }
  e += 7 * Math.sin(x / 780) * Math.cos(y / 610);
  e += 5 * Math.sin(x / 410 + 1.1) * Math.sin(y / 490 + 0.35);
  return Math.max(3, e);
}

/** Road grade along heading (rise/run). Positive = uphill. */
export function gradeAt(x, y, dirX, dirY) {
  const step = 8;
  const e0 = elevationAt(x, y);
  const e1 = elevationAt(x + dirX * step, y + dirY * step);
  return (e1 - e0) / step;
}

/** Grade as a rough percent for HUD (rise/run × 100). */
export function gradePercent(x, y, dirX, dirY) {
  return gradeAt(x, y, dirX, dirY) * 100;
}

/** 0..1 for tinting */
export function elevationNorm(x, y) {
  return Math.min(1, elevationAt(x, y) / 260);
}

/**
 * Smooth hill shading — radial washes on a coarse grid (no blocky squares).
 * style: "game" | "map"
 */
export function drawHillWash(g, minX, minY, maxX, maxY, step, style = "game") {
  const map = style === "map";
  for (let x = minX; x < maxX; x += step) {
    for (let y = minY; y < maxY; y += step) {
      const en = elevationNorm(x + step * 0.5, y + step * 0.5);
      if (en < 0.07) continue;
      const cx = x + step * 0.5, cy = y + step * 0.5;
      const r = step * 0.9;
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      const a0 = map ? 0.035 + en * 0.065 : 0.045 + en * 0.1;
      const tint = map ? "255,255,255" : "255,246,228";
      grad.addColorStop(0, `rgba(${tint},${a0})`);
      grad.addColorStop(1, `rgba(${tint},0)`);
      g.fillStyle = grad;
      g.fillRect(x, y, step, step);
    }
  }
}

/** Slightly adjust a hex/grey color for road elevation on the map. */
export function streetGreyForElevation(hex, x, y) {
  const en = elevationNorm(x, y);
  if (en < 0.1) return hex;
  const f = 1 + en * (hex === "#6a6a70" ? 0.22 : 0.14);
  const r = Math.min(255, (parseInt(hex.slice(1, 3), 16) * f) | 0);
  const g = Math.min(255, (parseInt(hex.slice(3, 5), 16) * f) | 0);
  const b = Math.min(255, (parseInt(hex.slice(5, 7), 16) * f) | 0);
  return `rgb(${r},${g},${b})`;
}

/** Visual elevation offset - disabled for now, returns 0 */
export function elevOffset(x, y) {
  return 0;
}
