// Lightweight civilian driving helpers for ambient traffic.
// Spline-based — no full Car physics. Corner ease + one-way + junction yield.

export function curvatureAhead(p, s, dir, dist = 20) {
  const h0 = headingAt(p, s, dir);
  const len = polyLen(p);
  const s2 = Math.max(0, Math.min(len, s + dir * dist));
  const h1 = headingAt(p, s2, dir);
  return Math.abs(angDiff(h1, h0));
}

export function headingAt(p, s, dir) {
  let acc = 0;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const dx = p[i + 2] - p[i], dy = p[i + 3] - p[i + 1];
    const seg = Math.hypot(dx, dy);
    if (acc + seg >= s) {
      return Math.atan2(dy * dir, dx * dir);
    }
    acc += seg;
  }
  const n = p.length;
  const dx = p[n - 2] - p[n - 4], dy = p[n - 1] - p[n - 3];
  return Math.atan2(dy * dir, dx * dir);
}

/** Target speed multiplier from upcoming bend (0.38 – 1). */
export function cornerSpeedMul(p, s, dir, speed) {
  const near = curvatureAhead(p, s, dir, 10 + speed * 0.25);
  const far = curvatureAhead(p, s, dir, 28 + speed * 0.45);
  const bend = Math.max(near, far * 0.85);
  if (bend < 0.06) return 1;
  if (bend < 0.2) return Math.max(0.72, 1 - bend * 1.2);
  if (bend < 0.45) return Math.max(0.5, 0.85 - bend);
  return Math.max(0.38, 0.65 - bend * 0.5);
}

/** Distance to end of current road segment (m). */
export function distToEnd(len, s, dir) {
  return dir > 0 ? len - s : s;
}

function polyLen(p) {
  if (p._len !== undefined) return p._len;
  let L = 0;
  for (let i = 0; i + 3 < p.length; i += 2) L += Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
  p._len = L;
  return L;
}

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
