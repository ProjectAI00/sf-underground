// Tree canopy sprites: a handful of cel-shaded variants baked once, stamped everywhere.

import { INK, SUN, rng } from "./style.js";

const PX_PER_M = 6;
const PALETTES = [
  { dark: "#3f7f3e", base: "#5fa34b", light: "#8fcb6a" },
  { dark: "#467a34", base: "#6aa83f", light: "#a2d36a" },
  { dark: "#2f6b44", base: "#4c9459", light: "#7cc07e" },
  { dark: "#5e7c2f", base: "#86a83e", light: "#bcd66a" },
  { dark: "#a0612f", base: "#d98c3e", light: "#f2bb6a" },
];

function blobCluster(r, radius) {
  const blobs = [{ x: 0, y: 0, r: radius * 0.72 }];
  const n = 4 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.6;
    const d = radius * (0.35 + r() * 0.2);
    blobs.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: radius * (0.42 + r() * 0.16) });
  }
  return blobs;
}

function fillBlobs(g, blobs, grow, dx, dy, color) {
  g.fillStyle = color;
  g.beginPath();
  for (const b of blobs) {
    g.moveTo(b.x + dx + b.r + grow, b.y + dy);
    g.arc(b.x + dx, b.y + dy, b.r + grow, 0, Math.PI * 2);
  }
  g.fill();
}

function bakeTree(seed, radius, pal) {
  const r = rng(seed);
  const size = Math.ceil((radius * 2 + 3) * PX_PER_M);
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d");
  g.setTransform(PX_PER_M, 0, 0, PX_PER_M, size / 2, size / 2);
  const blobs = blobCluster(r, radius);
  const px = 1 / PX_PER_M;
  fillBlobs(g, blobs, 0, SUN.x * 1.1, SUN.y * 1.1, "rgba(34,28,58,0.28)");
  fillBlobs(g, blobs, px * 1.2, 0, 0, INK);
  fillBlobs(g, blobs, 0, 0, 0, pal.dark);
  const lit = blobs.map((b) => ({ x: b.x - b.r * 0.18, y: b.y - b.r * 0.22, r: b.r * 0.82 }));
  fillBlobs(g, lit, 0, 0, 0, pal.base);
  const hi = blobs.filter(() => r() < 0.7).map((b) => ({ x: b.x - b.r * 0.35, y: b.y - b.r * 0.4, r: b.r * 0.32 }));
  fillBlobs(g, hi, 0, 0, 0, pal.light);
  return { canvas: c, m: size / PX_PER_M };
}

let SPRITES = null;

function sprites() {
  if (SPRITES) return SPRITES;
  SPRITES = [];
  let seed = 1;
  for (const radius of [1.8, 2.4, 3.1, 3.8]) {
    for (let v = 0; v < 6; v++) {
      const pal = v === 5 ? PALETTES[4] : PALETTES[v % 4];
      SPRITES.push(bakeTree(seed++, radius, pal));
    }
  }
  return SPRITES;
}

/** Stamp a tree at (x, y) metres. size: 0 small .. 3 large. */
export function drawTree(g, x, y, size, variant) {
  const all = sprites();
  const s = all[Math.min(3, Math.max(0, size)) * 6 + (variant % 6)];
  g.drawImage(s.canvas, x - s.m / 2, y - s.m / 2, s.m, s.m);
}
