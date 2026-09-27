// Bakes one cached sprite per building roof: material, parapet, rooftop props, outline.
// The renderer draws it at the leaned roof position, so props ride along with the parallax.

import { INK, SHADOW, SUN, ROOF_MATERIALS, rng, pick, shade } from "./style.js";
import { KIT, propMenu } from "./roofkit.js";

const PAD_PX = 2;
const MAX_PIXELS = 1.2e6;

function polyArea(p) {
  let a = 0;
  for (let i = 0, n = p.length; i < n; i += 2) {
    const j = (i + 2) % n;
    a += p[i] * p[j + 1] - p[j] * p[i + 1];
  }
  return Math.abs(a) / 2;
}

function inside(p, x, y) {
  let c = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    if ((p[i + 1] > y) !== (p[j + 1] > y) &&
        x < ((p[j] - p[i]) * (y - p[i + 1])) / (p[j + 1] - p[i + 1]) + p[i]) c = !c;
  }
  return c;
}

function edgeDist(p, x, y) {
  let best = Infinity;
  for (let i = 0, n = p.length; i < n; i += 2) {
    const j = (i + 2) % n;
    const ax = p[i], ay = p[i + 1], dx = p[j] - ax, dy = p[j + 1] - ay;
    const L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return best;
}

function dominantAngle(p) {
  let best = 0, ang = 0;
  for (let i = 0, n = p.length; i < n; i += 2) {
    const j = (i + 2) % n;
    const dx = p[j] - p[i], dy = p[j + 1] - p[i + 1];
    const L = dx * dx + dy * dy;
    if (L > best) { best = L; ang = Math.atan2(dy, dx); }
  }
  return ang;
}

function tracePoly(g, p) {
  g.beginPath();
  g.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
  g.closePath();
}

function materialFor(b, r) {
  const l = b.l || 2;
  if (b.k === 1) return pick(r, ["tar", "gravel", "concrete"]);
  if (l >= 16) return pick(r, ["gravel", "concrete", "membrane", "slate"]);
  if (l >= 6) return r() < 0.12 ? "green" : pick(r, ["gravel", "membrane", "tar", "concrete", "slate"]);
  return pick(r, ["tar", "terracotta", "gravel", "slate", "membrane", "concrete", "tar"]);
}

export class RoofBaker {
  constructor(pxPerM = 6, cap = 1400) {
    this.S = pxPerM;
    this.cap = cap;
    this.cache = new Map();
  }

  get(id) {
    const e = this.cache.get(id);
    if (e) {
      this.cache.delete(id);
      this.cache.set(id, e);
    }
    return e;
  }

  bake(b) {
    const p = b.p, bb = b.bbox;
    const wm = bb[2] - bb[0], hm = bb[3] - bb[1];
    const s = Math.min(this.S, Math.sqrt(MAX_PIXELS / Math.max(1, wm * hm)));
    const W = Math.ceil(wm * s) + PAD_PX * 2, H = Math.ceil(hm * s) + PAD_PX * 2;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d");
    g.setTransform(s, 0, 0, s, PAD_PX - bb[0] * s, PAD_PX - bb[1] * s);
    g.lineJoin = "round";

    const r = rng(b.id);
    const lw = 1.1 / s;
    const levels = b.l || 2;
    const area = polyArea(p);
    const mat = ROOF_MATERIALS[materialFor(b, r)];
    const angle = dominantAngle(p);

    tracePoly(g, p);
    g.fillStyle = mat.base;
    g.fill();
    g.save();
    tracePoly(g, p);
    g.clip();

    const flecks = Math.min(3000, area * 0.5);
    for (let i = 0; i < flecks; i++) {
      g.fillStyle = mat.fleck[i & 1];
      const sz = 0.25 + r() * 0.35;
      g.fillRect(bb[0] + r() * wm, bb[1] + r() * hm, sz, sz);
    }
    if (mat === ROOF_MATERIALS.membrane || mat === ROOF_MATERIALS.slate) {
      g.save();
      g.translate((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2);
      g.rotate(angle);
      g.strokeStyle = shade(mat.base, 0.93);
      g.lineWidth = 0.1;
      const ext = Math.hypot(wm, hm) / 2;
      for (let v = -ext; v < ext; v += 2.2) {
        g.beginPath();
        g.moveTo(-ext, v);
        g.lineTo(ext, v);
        g.stroke();
      }
      g.restore();
    }

    this.#placeProps(g, p, bb, r, levels, area, angle, lw);

    if (levels >= 3 && area > 40) {
      g.save();
      g.translate(SUN.x * 0.55, SUN.y * 0.55);
      tracePoly(g, p);
      g.lineWidth = 1.3;
      g.strokeStyle = SHADOW;
      g.stroke();
      g.restore();
      tracePoly(g, p);
      g.lineWidth = 0.9;
      g.strokeStyle = shade(mat.base, 1.14);
      g.stroke();
    }
    g.restore();

    tracePoly(g, p);
    g.lineWidth = lw * 1.2;
    g.strokeStyle = INK;
    g.stroke();

    const entry = { canvas: c, x: bb[0] - PAD_PX / s, y: bb[1] - PAD_PX / s, w: W / s, h: H / s };
    this.cache.set(b.id, entry);
    if (this.cache.size > this.cap) this.cache.delete(this.cache.keys().next().value);
    return entry;
  }

  #placeProps(g, p, bb, r, levels, area, angle, lw) {
    const menu = propMenu(levels, area);
    const placed = [];
    const nBig = levels >= 6 ? Math.min(3, 1 + Math.floor(area / 700)) : area > 120 ? 1 : 0;
    const nSmall = Math.min(18, Math.floor(area / (levels >= 6 ? 45 : 70)));
    const cu = Math.cos(angle), su = Math.sin(angle);

    const tryPlace = (key) => {
      if (key === "helipad" && (area < 600 || levels < 25 || placed.some((q) => q.key === "helipad"))) return;
      const k = KIT[key];
      const rad = Math.hypot(k.w, k.d) / 2;
      for (let attempt = 0; attempt < 24; attempt++) {
        const x = bb[0] + r() * (bb[2] - bb[0]), y = bb[1] + r() * (bb[3] - bb[1]);
        if (!inside(p, x, y) || edgeDist(p, x, y) < rad + 0.7) continue;
        if (placed.some((q) => Math.hypot(q.x - x, q.y - y) < q.rad + rad + 0.5)) continue;
        placed.push({ key, x, y, rad });
        return;
      }
    };
    for (let i = 0; i < nBig; i++) tryPlace(pick(r, menu.big));
    for (let i = 0; i < nSmall; i++) tryPlace(pick(r, menu.small));

    const orient = (q) => {
      g.translate(q.x, q.y);
      g.transform(cu, su, -su, cu, 0, 0);
    };
    for (const q of placed) {
      const k = KIT[q.key];
      g.save();
      g.translate(SUN.x * k.h * 0.55, SUN.y * k.h * 0.55);
      orient(q);
      g.fillStyle = SHADOW;
      g.beginPath();
      if (k.shape === "circle") g.arc(0, 0, k.w / 2, 0, Math.PI * 2);
      else g.rect(-k.w / 2, -k.d / 2, k.w, k.d);
      g.fill();
      g.restore();
    }
    for (const q of placed) {
      g.save();
      orient(q);
      KIT[q.key].draw(g, r, lw);
      g.restore();
    }
  }
}
