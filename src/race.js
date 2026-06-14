// Race: checkpoint circuits precomputed by tools/process_sf.mjs from real
// street names, shipped in overview.json. Timer + per-circuit best times.

const CP_RADIUS = 26; // meters

export class Race {
  constructor(world) {
    this.world = world;
    this.circuit = null;     // {id, label, cps:[{x,y,tx,ty,name}]}
    this.checkpoints = [];
    this.state = "idle";     // idle | countdown | running | finished
    this.cpIndex = 0;
    this.time = 0;
    this.countdown = 0;
    this.flashT = 0;
    this.catchUpBoost = 1;   // Speed multiplier for player catch-up
  }

  static bestKey(circuitId) { return "sfracer_best_" + circuitId; }
  static getBest(circuitId) {
    const v = parseFloat(localStorage.getItem(Race.bestKey(circuitId)) || "0");
    return v > 0 ? v : null;
  }

  get best() { return this.circuit ? Race.getBest(this.circuit.id) : null; }

  start(circuit, car) {
    this.circuit = circuit;
    this.checkpoints = circuit.cps;
    const s = this.checkpoints[0];
    car.x = s.x; car.y = s.y;
    car.h = Math.atan2(s.ty, s.tx);
    car.vx = 0; car.vy = 0;
    this.cpIndex = 1;
    this.time = 0;
    this.countdown = 3.2;
    this.state = "countdown";
  }

  stop() {
    this.state = "idle";
    this.circuit = null;
  }

  target() {
    if (this.state !== "running" && this.state !== "countdown") return null;
    return this.cpIndex < this.checkpoints.length
      ? this.checkpoints[this.cpIndex]
      : this.checkpoints[0];
  }

  /** Calculate player catch-up boost based on rival position */
  updateCatchUp(rival) {
    if (this.state !== "running" || !rival) {
      this.catchUpBoost = 1;
      return;
    }
    const playerProgress = this.cpIndex * 600;
    const rivalProgress = rival.cpIndex * 600;
    const lead = playerProgress - rivalProgress;
    
    if (lead < -600) {
      // Player way behind - give speed boost
      this.catchUpBoost = 1.08;
    } else if (lead < -300) {
      // Player behind - slight boost
      this.catchUpBoost = 1.04;
    } else if (lead > 600) {
      // Player way ahead - slight slowdown
      this.catchUpBoost = 0.96;
    } else if (lead > 300) {
      // Player ahead - tiny slowdown
      this.catchUpBoost = 0.98;
    } else {
      this.catchUpBoost = 1;
    }
  }

  update(dt, car) {
    this.flashT = Math.max(0, this.flashT - dt);
    if (this.state === "countdown") {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.state = "running";
        return { type: "go" };
      }
      return null;
    }
    if (this.state !== "running") return null;
    this.time += dt;
    const t = this.target();
    if (!t) return null;
    const dx = car.x - t.x, dy = car.y - t.y;
    if (dx * dx + dy * dy < CP_RADIUS * CP_RADIUS) {
      this.flashT = 0.6;
      if (this.cpIndex >= this.checkpoints.length) {
        this.state = "finished";
        const prev = this.best;
        const isBest = !prev || this.time < prev;
        if (isBest) localStorage.setItem(Race.bestKey(this.circuit.id), String(this.time));
        return { type: "finish", isBest };
      }
      this.cpIndex++;
      return { type: "checkpoint" };
    }
    return null;
  }

  drawWorld(ctx, frame) {
    const t = this.target();
    if (!t) return;
    const pulse = 1 + 0.12 * Math.sin(frame * 0.12);
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.strokeStyle = "rgba(75,224,200,0.85)";
    ctx.lineWidth = 2.2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.arc(0, 0, CP_RADIUS * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(75,224,200,0.14)";
    ctx.beginPath();
    ctx.arc(0, 0, CP_RADIUS * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawArrow(ctx, canvas, car, camRot) {
    const t = this.target();
    if (!t) return;
    const ang = Math.atan2(t.y - car.y, t.x - car.x) - camRot - Math.PI / 2;
    const cx = canvas.width / 2, cy = 86;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang + Math.PI / 2);
    ctx.fillStyle = "#4be0c8";
    ctx.strokeStyle = "#0b2b26";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -22);
    ctx.lineTo(15, 12);
    ctx.lineTo(0, 4);
    ctx.lineTo(-15, 12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    const d = Math.hypot(t.x - car.x, t.y - car.y);
    ctx.font = '10px "Press Start 2P", monospace';
    ctx.textAlign = "center";
    ctx.fillStyle = "#4be0c8";
    ctx.fillText(`${Math.round(d)}m`, cx, cy + 36);
  }
}
