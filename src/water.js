// Ocean / bay / bridge-corridor water. Shore profile from tools/build_map_land.mjs.

export const SHORE_CELL = 90;

function rowIsWater(x, row) {
  if (x < row[1]) return true;
  if (row.length === 5) {
    if (x > row[2] && x < row[3]) return true;
    return x > row[4];
  }
  return x > row[2];
}

/** Small waterfront features only - don't override large areas */
export const MARINA_SLIPS = [
  // Aquatic Park cove (small inlet)
  { minX: 1150, maxX: 1280, minY: -4020, maxY: -3960 },
];

/** Water areas - SF Bay and Pacific Ocean */
export const WATER_RECTS = [
  // San Francisco Bay - massive area east/north of the city
  { minX: -6000, maxX: 8000, minY: -8000, maxY: -3800 },   // North bay including GG Bridge
  { minX: 1500, maxX: 8000, minY: -3800, maxY: 3000 },     // East bay
  // Pacific Ocean - west side  
  { minX: -8000, maxX: -2500, minY: -8000, maxY: 2000 },   // Pacific west of GG
];

function inRect(x, y, r) {
  return x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY;
}

function inSlip(x, y) {
  for (const r of MARINA_SLIPS) {
    if (inRect(x, y, r)) return true;
  }
  return false;
}

function drawSlips(g, ox, oy, x1, y1, fill) {
  g.fillStyle = fill;
  for (const r of MARINA_SLIPS) {
    const rx0 = Math.max(ox, r.minX), rx1 = Math.min(x1, r.maxX);
    const ry0 = Math.max(oy, r.minY), ry1 = Math.min(y1, r.maxY);
    if (rx1 > rx0 && ry1 > ry0) g.fillRect(rx0, ry0, rx1 - rx0, ry1 - ry0);
  }
}

function drawRects(g, ox, oy, x1, y1, rects, fill) {
  g.fillStyle = fill;
  for (const r of rects) {
    const rx0 = Math.max(ox, r.minX), rx1 = Math.min(x1, r.maxX);
    const ry0 = Math.max(oy, r.minY), ry1 = Math.min(y1, r.maxY);
    if (rx1 > rx0 && ry1 > ry0) g.fillRect(rx0, ry0, rx1 - rx0, ry1 - ry0);
  }
}

function drawBridgeZones(g, ox, oy, x1, y1, zones, fill) {
  if (!zones?.length) return;
  g.fillStyle = fill;
  for (const p of zones) {
    if (!p || p.length < 6) continue;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < p.length; i += 2) {
      minX = Math.min(minX, p[i]); maxX = Math.max(maxX, p[i]);
      minY = Math.min(minY, p[i + 1]); maxY = Math.max(maxY, p[i + 1]);
    }
    if (maxX < ox || minX > x1 || maxY < oy || minY > y1) continue;
    g.beginPath();
    g.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
    g.closePath();
    g.fill();
  }
}

export function isWater(x, y, shore, bridgeZones) {
  for (const r of WATER_RECTS) {
    if (inRect(x, y, r)) return true;
  }
  if (bridgeZones?.length) {
    for (const p of bridgeZones) {
      if (p?.length >= 6 && pointInPoly(p, x, y)) return true;
    }
  }
  if (inSlip(x, y)) return true;

  if (!shore?.length) return false;
  for (let i = 0; i < shore.length; i++) {
    const row = shore[i];
    if (Math.abs(row[0] - y) > SHORE_CELL * 0.55) continue;
    if (rowIsWater(x, row)) return true;
  }
  return false;
}

function pointInPoly(p, x, y) {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function drawWaterLayer(g, ox, oy, tileM, shore, bridgeZones) {
  const x1 = ox + tileM, y1 = oy + tileM;
  
  // Draw base water - simple but effective
  for (const r of WATER_RECTS) {
    const rx0 = Math.max(ox, r.minX), rx1 = Math.min(x1, r.maxX);
    const ry0 = Math.max(oy, r.minY), ry1 = Math.min(y1, r.maxY);
    if (rx1 <= rx0 || ry1 <= ry0) continue;
    
    // Base water color
    g.fillStyle = "#2a6080";
    g.fillRect(rx0, ry0, rx1 - rx0, ry1 - ry0);
    
    // Simple wave pattern using tile coordinates for consistency
    g.fillStyle = "rgba(50,90,120,0.3)";
    const step = 20;
    const startX = Math.floor(rx0 / step) * step;
    const startY = Math.floor(ry0 / step) * step;
    for (let wx = startX; wx < rx1; wx += step * 2) {
      for (let wy = startY; wy < ry1; wy += step * 2) {
        const x = Math.max(rx0, wx);
        const y = Math.max(ry0, wy);
        const w = Math.min(step, rx1 - x);
        const h = Math.min(step, ry1 - y);
        if (w > 0 && h > 0) g.fillRect(x, y, w, h);
      }
    }
    
    // Light wave crests
    g.fillStyle = "rgba(80,140,180,0.15)";
    for (let wx = startX + step; wx < rx1; wx += step * 2) {
      for (let wy = startY + step; wy < ry1; wy += step * 2) {
        const x = Math.max(rx0, wx);
        const y = Math.max(ry0, wy);
        const w = Math.min(step, rx1 - x);
        const h = Math.min(step, ry1 - y);
        if (w > 0 && h > 0) g.fillRect(x, y, w, h);
      }
    }
  }
  
  drawBridgeZones(g, ox, oy, x1, y1, bridgeZones, "#2a6080");
  drawSlips(g, ox, oy, x1, y1, "#3a7898");
}

export function bufferPolyline(p, halfW) {
  const out = [];
  for (let i = 0; i + 3 < p.length; i += 2) {
    const x1 = p[i], y1 = p[i + 1], x2 = p[i + 2], y2 = p[i + 3];
    const dx = x2 - x1, dy = y2 - y1;
    const L = Math.hypot(dx, dy) || 1;
    const nx = (-dy / L) * halfW, ny = (dx / L) * halfW;
    out.push([
      x1 + nx, y1 + ny,
      x2 + nx, y2 + ny,
      x2 - nx, y2 - ny,
      x1 - nx, y1 - ny,
    ]);
  }
  return out;
}

export const BRIDGE_ROAD = /^Golden Gate Bridge|Dwight D\. Eisenhower Highway|^Redwood Highway$/;
