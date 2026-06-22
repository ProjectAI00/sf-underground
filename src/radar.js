const CELL = 64;
const RADAR_M = 320;

export class Radar {
  constructor(world, canvas) {
    this.world = world;
    this.canvas = canvas;
    this.cachedRoute = null;
    this.cachedWaypoint = null;
    this.cachedCarPos = null;
    this.routeRecalcTimer = 0;
  }

  draw(car, race, camRot, waypoint = null, rival = null, police = null, speedZones = null) {
    const canvas = this.canvas;
    const g = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.max(0, Math.min(w, h) / 2 - 3);
    const scale = radius / RADAR_M;

    g.clearRect(0, 0, w, h);
    if (radius <= 0 || !car) return;

    g.save();
    g.beginPath();
    g.arc(cx, cy, radius, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = "rgba(17,19,26,0.92)";
    g.fillRect(0, 0, w, h);

    this.#drawRoads(g, car, camRot, cx, cy, radius, scale);
    if (waypoint) this.#drawRoute(g, car, waypoint, camRot, cx, cy, radius, scale);
    if (speedZones) speedZones.drawRadarZones(g, car, camRot, cx, cy, radius, scale);
    this.#drawRace(g, car, race, camRot, cx, cy, radius, scale);
    if (rival) this.#drawBlip(g, car, rival, camRot, cx, cy, radius, scale, "#ff8c3c", 3.4, false);
    if (waypoint) this.#drawBlip(g, car, waypoint, camRot, cx, cy, radius, scale, "#ffc24b", 4, true);
    if (police) police.drawRadarBlips(g, car, camRot, cx, cy, radius, scale);
    g.restore();

    this.#drawPlayer(g, cx, cy);
    this.#drawRim(g, cx, cy, radius, camRot);
  }

  #drawRoads(g, car, camRot, cx, cy, radius, scale) {
    const W = this.world;
    const roads = W.roads || [];
    const grid = W.segGrid;
    if (!grid) return;

    g.save();
    g.translate(cx, cy);
    g.rotate(-camRot);
    g.scale(scale, scale);
    g.translate(-car.x, -car.y);
    g.lineCap = "round";
    g.lineJoin = "round";

    const cx1 = Math.floor((car.x - RADAR_M) / CELL);
    const cx2 = Math.floor((car.x + RADAR_M) / CELL);
    const cy1 = Math.floor((car.y - RADAR_M) / CELL);
    const cy2 = Math.floor((car.y + RADAR_M) / CELL);
    const rr = RADAR_M + 8;
    const rr2 = rr * rr;

    for (let gx = cx1; gx <= cx2; gx++) {
      for (let gy = cy1; gy <= cy2; gy++) {
        const arr = grid.get(gx + "," + gy);
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const item = arr[i];
          const road = item.road || roads[item.ri];
          if (!road) continue;
          const p = road.p;
          const si = item.si;
          const x1 = p[si];
          const y1 = p[si + 1];
          const x2 = p[si + 2];
          const y2 = p[si + 3];
          const sx = x2 - x1;
          const sy = y2 - y1;
          const sl2 = sx * sx + sy * sy;
          let t = sl2 ? ((car.x - x1) * sx + (car.y - y1) * sy) / sl2 : 0;
          t = Math.max(0, Math.min(1, t));
          const qx = x1 + sx * t - car.x;
          const qy = y1 + sy * t - car.y;
          if (qx * qx + qy * qy > rr2) continue;

          if (road.r >= 3) {
            g.strokeStyle = "#8d8474";
            g.lineWidth = 3.5 / scale;
          } else if (road.r === 2) {
            g.strokeStyle = "#5d5a52";
            g.lineWidth = 2 / scale;
          } else {
            g.strokeStyle = "#45423c";
            g.lineWidth = 1.2 / scale;
          }
          g.beginPath();
          g.moveTo(x1, y1);
          g.lineTo(x2, y2);
          g.stroke();
        }
      }
    }
    g.restore();
  }

  #drawRace(g, car, race, camRot, cx, cy, radius, scale) {
    if (!race || (race.state !== "running" && race.state !== "countdown")) return;
    const checkpoints = race.checkpoints;
    const target = race.target && race.target();
    if (!checkpoints || !target) return;

    const cos = Math.cos(camRot);
    const sin = Math.sin(camRot);
    const pulse = 1 + 0.18 * Math.sin(performance.now() * 0.008);

    for (let i = 0; i < checkpoints.length; i++) {
      const cp = checkpoints[i];
      if (cp === target) continue;
      const dx = cp.x - car.x;
      const dy = cp.y - car.y;
      if (dx * dx + dy * dy > RADAR_M * RADAR_M) continue;
      const rx = dx * cos + dy * sin;
      const ry = -dx * sin + dy * cos;
      this.#dot(g, cx + rx * scale, cy + ry * scale, 2.3, "#33564f");
    }

    const dx = target.x - car.x;
    const dy = target.y - car.y;
    const dist = Math.hypot(dx, dy);
    const rx = dx * cos + dy * sin;
    const ry = -dx * sin + dy * cos;
    if (dist > RADAR_M) {
      this.#arrow(g, cx, cy, rx, ry, radius);
    } else {
      this.#dot(g, cx + rx * scale, cy + ry * scale, 4.2 * pulse, "#4be0c8");
    }
  }

  #drawBlip(g, car, pt, camRot, cx, cy, radius, scale, color, size, rimArrow) {
    const dx = pt.x - car.x;
    const dy = pt.y - car.y;
    const cos = Math.cos(camRot);
    const sin = Math.sin(camRot);
    const rx = dx * cos + dy * sin;
    const ry = -dx * sin + dy * cos;
    if (Math.hypot(dx, dy) > RADAR_M) {
      if (!rimArrow) return;
      const len = Math.hypot(rx, ry) || 1;
      const ux = rx / len, uy = ry / len;
      this.#dot(g, cx + ux * (radius - 10), cy + uy * (radius - 10), size, color);
      return;
    }
    this.#dot(g, cx + rx * scale, cy + ry * scale, size, color);
    if (rimArrow) {
      g.strokeStyle = "#3a3020";
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(cx + rx * scale, cy + ry * scale, size + 1.5, 0, Math.PI * 2);
      g.stroke();
    }
  }

  #dot(g, x, y, r, color) {
    g.fillStyle = color;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }

  #arrow(g, cx, cy, x, y, radius) {
    const len = Math.hypot(x, y) || 1;
    const ux = x / len;
    const uy = y / len;
    const px = -uy;
    const py = ux;
    const tipX = cx + ux * (radius - 8);
    const tipY = cy + uy * (radius - 8);
    const baseX = cx + ux * (radius - 22);
    const baseY = cy + uy * (radius - 22);

    g.fillStyle = "#4be0c8";
    g.strokeStyle = "#0b2b26";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(tipX, tipY);
    g.lineTo(baseX + px * 6, baseY + py * 6);
    g.lineTo(baseX - px * 6, baseY - py * 6);
    g.closePath();
    g.fill();
    g.stroke();
  }

  #drawPlayer(g, cx, cy) {
    g.save();
    g.translate(cx, cy);
    g.fillStyle = "#ff4f5e";
    g.strokeStyle = "#210b0f";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -8);
    g.lineTo(6, 7);
    g.lineTo(-6, 7);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }

  #drawRim(g, cx, cy, radius, camRot) {
    g.strokeStyle = "#5b5345";
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cy, radius, 0, Math.PI * 2);
    g.stroke();

    const nx = -Math.sin(camRot);
    const ny = -Math.cos(camRot);
    g.fillStyle = "#b9ad91";
    g.font = '9px "Press Start 2P", monospace';
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("N", cx + nx * (radius - 12), cy + ny * (radius - 12));
  }

  #drawRoute(g, car, waypoint, camRot, cx, cy, radius, scale) {
    const route = this.#getRoute(car, waypoint);
    if (!route || route.length < 2) {
      this.#drawDirectLine(g, car, waypoint, camRot, cx, cy, radius, scale);
      return;
    }
    
    const cos = Math.cos(camRot);
    const sin = Math.sin(camRot);
    const rr = RADAR_M * RADAR_M;
    
    g.save();
    g.strokeStyle = "#ffc24b";
    g.lineWidth = 2.5;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.globalAlpha = 0.85;
    
    g.beginPath();
    let started = false;
    
    for (let i = 0; i < route.length; i++) {
      const pt = route[i];
      const dx = pt.x - car.x;
      const dy = pt.y - car.y;
      
      if (dx * dx + dy * dy > rr * 1.5) continue;
      
      const rx = dx * cos + dy * sin;
      const ry = -dx * sin + dy * cos;
      const sx = cx + rx * scale;
      const sy = cy + ry * scale;
      
      if (!started) {
        g.moveTo(sx, sy);
        started = true;
      } else {
        g.lineTo(sx, sy);
      }
    }
    
    if (started) g.stroke();
    g.restore();
  }
  
  #drawDirectLine(g, car, waypoint, camRot, cx, cy, radius, scale) {
    const dx = waypoint.x - car.x;
    const dy = waypoint.y - car.y;
    const cos = Math.cos(camRot);
    const sin = Math.sin(camRot);
    const rx = dx * cos + dy * sin;
    const ry = -dx * sin + dy * cos;
    
    g.save();
    g.strokeStyle = "#ffc24b";
    g.lineWidth = 2.5;
    g.lineCap = "round";
    g.globalAlpha = 0.8;
    g.setLineDash([6, 4]);
    
    const dist = Math.hypot(rx, ry);
    let endX = rx * scale;
    let endY = ry * scale;
    
    if (dist * scale > radius - 10) {
      const clamp = (radius - 10) / (dist * scale);
      endX *= clamp;
      endY *= clamp;
    }
    
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + endX, cy + endY);
    g.stroke();
    g.setLineDash([]);
    g.restore();
  }
  
  #getRoute(car, waypoint) {
    const wpKey = `${waypoint.x},${waypoint.y}`;
    const carDist = this.cachedCarPos ? Math.hypot(car.x - this.cachedCarPos.x, car.y - this.cachedCarPos.y) : Infinity;
    
    if (this.cachedRoute && this.cachedWaypoint === wpKey && carDist < 50) {
      this.#trimRouteToPlayer(car);
      return this.cachedRoute;
    }
    
    this.cachedRoute = this.world.roadGraph
      ? this.world.roadGraph.findRoute(car.x, car.y, waypoint.x, waypoint.y)
      : this.#findRouteLegacy(car.x, car.y, waypoint.x, waypoint.y);
    this.cachedWaypoint = wpKey;
    this.cachedCarPos = { x: car.x, y: car.y };
    return this.cachedRoute;
  }
  
  #trimRouteToPlayer(car) {
    if (!this.cachedRoute || this.cachedRoute.length < 2) return;
    
    let closest = 0;
    let closestDist = Infinity;
    for (let i = 0; i < Math.min(10, this.cachedRoute.length); i++) {
      const pt = this.cachedRoute[i];
      const d = Math.hypot(pt.x - car.x, pt.y - car.y);
      if (d < closestDist) {
        closestDist = d;
        closest = i;
      }
    }
    
    if (closest > 0) {
      this.cachedRoute = this.cachedRoute.slice(closest);
    }
  }
  
  #findRouteLegacy(startX, startY, endX, endY) {
    const W = this.world;
    const startRoad = W.nearestRoad(startX, startY, 100);
    const endRoad = W.nearestRoad(endX, endY, 100);
    
    if (!startRoad || !endRoad) return null;
    
    const STEP = 25;
    const MAX_ITER = 800;
    const visited = new Set();
    
    const heuristic = (x, y) => Math.hypot(x - endX, y - endY);
    
    const pq = [{
      x: startRoad.x,
      y: startRoad.y,
      g: 0,
      f: heuristic(startRoad.x, startRoad.y),
      path: [{ x: startRoad.x, y: startRoad.y }]
    }];
    
    const cellKey = (x, y) => `${Math.floor(x / STEP)},${Math.floor(y / STEP)}`;
    
    for (let iter = 0; iter < MAX_ITER && pq.length > 0; iter++) {
      pq.sort((a, b) => a.f - b.f);
      const cur = pq.shift();
      
      const key = cellKey(cur.x, cur.y);
      if (visited.has(key)) continue;
      visited.add(key);
      
      if (Math.hypot(cur.x - endX, cur.y - endY) < STEP * 2) {
        cur.path.push({ x: endX, y: endY });
        return cur.path;
      }
      
      const roads = W.roadsNear(cur.x, cur.y, STEP * 2);
      for (const road of roads) {
        const pts = road.p;
        for (let i = 0; i + 3 < pts.length; i += 2) {
          const x1 = pts[i], y1 = pts[i + 1];
          const x2 = pts[i + 2], y2 = pts[i + 3];
          
          for (const t of [0.5, 1]) {
            const nx = x1 + (x2 - x1) * t;
            const ny = y1 + (y2 - y1) * t;
            const nkey = cellKey(nx, ny);
            
            if (visited.has(nkey)) continue;
            
            const dist = Math.hypot(nx - cur.x, ny - cur.y);
            if (dist > STEP * 3 || dist < 5) continue;
            
            const ng = cur.g + dist;
            const nf = ng + heuristic(nx, ny) * 1.1;
            
            pq.push({
              x: nx,
              y: ny,
              g: ng,
              f: nf,
              path: [...cur.path, { x: nx, y: ny }]
            });
          }
        }
      }
    }
    
    return [{ x: startX, y: startY }, { x: endX, y: endY }];
  }
}
