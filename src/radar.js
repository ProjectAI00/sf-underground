const CELL = 64;
const RADAR_M = 320;

export class Radar {
  constructor(world, canvas) {
    this.world = world;
    this.canvas = canvas;
  }

  draw(car, race, camRot, waypoint = null, rival = null) {
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
    this.#drawRace(g, car, race, camRot, cx, cy, radius, scale);
    if (rival) this.#drawBlip(g, car, rival, camRot, cx, cy, radius, scale, "#ff8c3c", 3.4, false);
    if (waypoint) this.#drawBlip(g, car, waypoint, camRot, cx, cy, radius, scale, "#ffc24b", 4, true);
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
}
