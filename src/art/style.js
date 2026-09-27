// Shared art direction for the world: one palette, one light, one outline.
// Soft anime/city-builder look: clean flat colours, cel shadows, thin ink outlines.

export const INK = "#2d2a3a";
export const SHADOW = "rgba(34,28,58,0.30)";
// Direction shadows fall (sun from the upper-left of the screen).
export const SUN = { x: 0.6, y: 0.8 };

export const GROUND = {
  concrete: "#c8c1b3",
  concreteDark: "#b9b1a2",
  yard: "#9cc47a",
  yardDark: "#88b366",
  sidewalk: "#ddd6c8",
  curb: "#f1ece1",
  gutter: "#6f6e78",
  asphalt: "#555663",
  asphaltMajor: "#4b4c59",
  asphaltTunnel: "#34343e",
  laneWhite: "#f4f1e8",
  laneYellow: "#f5c84a",
  zebra: "rgba(246,243,234,0.95)",
  park: "#86c566",
  parkDark: "#6fb055",
  path: "#e6d9b8",
  sand: "#ecd49a",
  water: "#5cb6db",
  waterDeep: "#4aa2c9",
  parking: "#7b7c86",
  parkingLine: "#e9e6dc",
  pier: "#c2a888",
  pierEdge: "#9c8466",
  plaza: "#dcd2bd",
  rail: "#6b6258",
  railTie: "#8a7f72",
};

// Facade colours per neighbourhood (walls). Roofs use ROOF_MATERIALS instead.
export const FACADES = {
  downtown: ["#b7c3cf", "#c9ccd2", "#a9b6c4", "#d6d2c8", "#9fb0bf", "#c2b8aa"],
  chinatown: ["#e08a6c", "#e9b27a", "#d9735f", "#f0c79a", "#cf6a5a", "#e6a06f"],
  mission: ["#f2b38a", "#f7d28f", "#e9927a", "#f5c6a5", "#c9d98f", "#f0a88f"],
  castro: ["#d6a6d8", "#a9cbe8", "#f3c89a", "#a8d8b9", "#f0b3c1", "#c7d9f0"],
  haight: ["#c9a6d9", "#9fd0d8", "#f2cf9a", "#b5d9a3", "#f2b0b0", "#d8c3ef"],
  sunset: ["#f1e6d2", "#e9dcc4", "#f6ecdb", "#dccfb8", "#e8e2d4", "#f3e2c7"],
  richmond: ["#ece3d4", "#e2d6c3", "#f3ead9", "#d8ccb8", "#e6ddd0", "#f0e0c8"],
  marina: ["#f6f1e8", "#efe6d8", "#fbf6ee", "#e6ddcf", "#f3ebe0", "#ecdfcc"],
  northbeach: ["#f0c9a0", "#f5ddb2", "#e6b38a", "#f7e3c4", "#e9c29a", "#f2d0a8"],
  default: ["#e3cdb3", "#d6c2ad", "#ebd8bf", "#cdb9a4", "#e7d3c2", "#d9c7b0"],
};

export const ROOF_MATERIALS = {
  gravel: { base: "#b9b5ab", fleck: ["#a9a59b", "#cac6bd"] },
  membrane: { base: "#e7e5df", fleck: ["#d7d5ce", "#f3f2ee"] },
  tar: { base: "#76757d", fleck: ["#68676f", "#85848b"] },
  concrete: { base: "#c7c2b8", fleck: ["#b8b3a9", "#d4d0c7"] },
  terracotta: { base: "#cf8a6a", fleck: ["#c07b5c", "#dc9a7b"] },
  slate: { base: "#8d97a6", fleck: ["#7f8998", "#9ba5b3"] },
  green: { base: "#8fbf6a", fleck: ["#7cae5a", "#a3cf7e"] },
};

export function hash32(n) {
  n = (n ^ 61) ^ (n >>> 16);
  n = (n + (n << 3)) | 0;
  n ^= n >>> 4;
  n = Math.imul(n, 0x27d4eb2d);
  return (n ^ (n >>> 15)) >>> 0;
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed) {
  let a = hash32(seed | 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick(r, arr) {
  return arr[Math.floor(r() * arr.length) % arr.length];
}

export function shade(hex, f) {
  const c = (i) => Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * f)));
  return "#" + [c(1), c(3), c(5)].map((v) => v.toString(16).padStart(2, "0")).join("");
}

export function neighborhood(x, y) {
  if (x > 1500 && y < -1500 && y > -3500) return "downtown";
  if (x > 800 && x < 1800 && y < -2200 && y > -3000) return "chinatown";
  if (x > 1200 && x < 2200 && y < -3000 && y > -3800) return "northbeach";
  if (x > -500 && x < 1200 && y < -3500) return "marina";
  if (x > 500 && x < 2000 && y > -500 && y < 1500) return "mission";
  if (x > -500 && x < 500 && y > 0 && y < 1500) return "castro";
  if (x > -2000 && x < -200 && y > -500 && y < 800) return "haight";
  if (x < -2500) return "sunset";
  if (x < -1500 && y < -1500) return "richmond";
  return "default";
}

/** Residential neighbourhoods get green back yards between houses; the rest is paved. */
export function isLeafy(hood) {
  return hood !== "downtown" && hood !== "chinatown" && hood !== "default";
}
