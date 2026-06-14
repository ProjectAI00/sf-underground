import { drawCarSprite } from "./car.js";
import { carById, makeCarSpriteFor } from "./cars.js";
import { elevOffset } from "./terrain.js";

export class RemotePlayers {
  constructor() {
    this.players = new Map();
    this.selfId = null;
  }

  setSelfId(id) {
    this.selfId = id;
  }

  applySnapshot(list) {
    const now = performance.now();
    const seen = new Set();

    for (const p of list) {
      if (p.id === this.selfId) continue;
      seen.add(p.id);

      let r = this.players.get(p.id);
      if (!r) {
        const def = carById(p.carId);
        r = {
          id: p.id,
          tag: p.tag,
          carId: p.carId,
          sprite: makeCarSpriteFor(def),
          x: p.x,
          y: p.y,
          h: p.h,
          px: p.x,
          py: p.y,
          ph: p.h,
          lastSeen: now,
        };
        this.players.set(p.id, r);
      } else {
        r.px = r.x;
        r.py = r.y;
        r.ph = r.h;
        r.x = p.x;
        r.y = p.y;
        r.h = p.h;
        r.tag = p.tag;
        if (p.carId && p.carId !== r.carId) {
          r.carId = p.carId;
          r.sprite = makeCarSpriteFor(carById(p.carId));
        }
        r.lastSeen = now;
      }
    }

    for (const [id, r] of this.players) {
      if (!seen.has(id) && now - r.lastSeen > 3500) this.players.delete(id);
    }
  }

  clear() {
    this.players.clear();
  }

  update(dt) {
    const t = Math.min(1, dt * 12);
    for (const r of this.players.values()) {
      r.px += (r.x - r.px) * t;
      r.py += (r.y - r.py) * t;
      let dh = r.h - r.ph;
      while (dh > Math.PI) dh -= 2 * Math.PI;
      while (dh < -Math.PI) dh += 2 * Math.PI;
      r.ph += dh * t;
    }
  }

  nearbyCount() {
    return this.players.size;
  }

  draw(ctx, camX, camY, viewR) {
    const r2 = (viewR + 50) ** 2;
    for (const r of this.players.values()) {
      const dx = r.px - camX;
      const dy = r.py - camY;
      if (dx * dx + dy * dy > r2) continue;

      const vy = r.py + elevOffset(r.px, r.py);
      drawCarSprite(ctx, r.sprite, r.px, vy, r.ph);

      const tag = String(r.tag || "DRIVER").slice(0, 12);
      ctx.font = '1.1px "Press Start 2P", monospace';
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(10,10,14,0.65)";
      const wTag = tag.length * 1.15 + 1;
      ctx.fillRect(r.px - wTag / 2, vy - 5.6, wTag, 1.9);
      ctx.fillStyle = "#4be0c8";
      ctx.fillText(tag, r.px, vy - 4.2);
    }
  }
}
