// Converts raw Overpass JSON into a compact game map (local meter coordinates).
import { readFileSync, writeFileSync } from "node:fs";

const raw = JSON.parse(readFileSync(new URL("../data/sf_raw.json", import.meta.url), "utf8"));

// Bbox center used as projection origin (matches overpass_query.txt bbox)
const LAT0 = (37.7845 + 37.8085) / 2;
const LON0 = (-122.4235 + -122.3895) / 2;
const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180);

const px = (lon) => Math.round((lon - LON0) * M_PER_DEG_LON * 10) / 10;
const py = (lat) => Math.round((LAT0 - lat) * M_PER_DEG_LAT * 10) / 10; // y grows southward (screen down)

// Full road widths in meters by highway class
const ROAD_W = {
  motorway: 22, trunk: 20, primary: 17, secondary: 14, tertiary: 12,
  residential: 9.5, unclassified: 9, living_street: 7.5,
  motorway_link: 10, trunk_link: 10, primary_link: 9, secondary_link: 9, tertiary_link: 9,
};
// Class rank for draw order / minimap importance (higher = bigger road)
const ROAD_RANK = {
  motorway: 5, trunk: 5, motorway_link: 4, trunk_link: 4,
  primary: 4, primary_link: 3, secondary: 3, secondary_link: 2,
  tertiary: 2, tertiary_link: 1, residential: 1, unclassified: 1, living_street: 0,
};

const roads = [];
const buildings = [];
const parks = [];
const water = [];

for (const el of raw.elements) {
  if (el.type !== "way" || !el.geometry) continue;
  const pts = [];
  for (const g of el.geometry) pts.push(px(g.lon), py(g.lat));
  if (pts.length < 4) continue;
  const t = el.tags || {};

  if (t.highway && ROAD_W[t.highway]) {
    roads.push({
      w: ROAD_W[t.highway],
      r: ROAD_RANK[t.highway],
      n: t.name || "",
      p: pts,
    });
  } else if (t.building) {
    const h = parseFloat(t["building:levels"]) || 2;
    buildings.push({ l: Math.min(h, 30), p: pts });
  } else if (t.leisure || t.landuse) {
    parks.push(pts);
  } else if (t.natural === "water" || t.waterway) {
    water.push(pts);
  }
}

let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (const r of roads) {
  for (let i = 0; i < r.p.length; i += 2) {
    if (r.p[i] < minX) minX = r.p[i];
    if (r.p[i] > maxX) maxX = r.p[i];
    if (r.p[i + 1] < minY) minY = r.p[i + 1];
    if (r.p[i + 1] > maxY) maxY = r.p[i + 1];
  }
}

const out = {
  origin: { lat: LAT0, lon: LON0 },
  bounds: { minX, minY, maxX, maxY },
  roads, buildings, parks, water,
};
writeFileSync(new URL("../data/sf_map.json", import.meta.url), JSON.stringify(out));
console.log(`roads=${roads.length} buildings=${buildings.length} parks=${parks.length} water=${water.length}`);
console.log(`bounds x:[${minX},${maxX}] y:[${minY},${maxY}]`);
