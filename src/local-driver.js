// Arcade driving AI: follow roads, handbrake-drift sharp corners, barely brake.
// Used by rivals and police — not turn-by-turn GPS, local road following + aim point.

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function blendAngles(a, b, t) {
  return a + angDiff(b, a) * t;
}

/** same | parallel | different — are two agents on the same road or parallel blocks? */
export function streetRelation(world, ax, ay, bx, by) {
  const ra = world.nearestRoad(ax, ay, 100);
  const rb = world.nearestRoad(bx, by, 100);
  if (!ra || !rb) return "unknown";
  if (ra.road.id === rb.road.id && ra.d < 16 && rb.d < 16) return "same";
  const align = Math.abs(ra.tx * rb.tx + ra.ty * rb.ty);
  if (align > 0.88 && Math.hypot(ax - bx, ay - by) > 30) return "parallel";
  return "different";
}

/** Point ahead along the current street polyline (finish the block before turning). */
export function streetEndAhead(world, x, y, heading, dist = 55) {
  const pt = sampleRoadAhead(world, x, y, heading, dist);
  return { x: pt.x, y: pt.y };
}

/** True if a straight path crosses building footprints (blocks mid-block cuts). */
export function pathBlockedByBuildings(world, x1, y1, x2, y2, step = 5) {
  const dx = x2 - x1, dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  if (dist < 2) return false;
  const nx = dx / dist, ny = dy / dist;
  const rx = -ny, ry = nx;
  const steps = Math.ceil(dist / step);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = x1 + dx * t;
    const py = y1 + dy * t;
    if (world.buildingAt(px, py)) return true;
    if (world.buildingAt(px + rx * 3.5, py + ry * 3.5)) return true;
    if (world.buildingAt(px - rx * 3.5, py - ry * 3.5)) return true;
  }
  return false;
}

function nextRouteCorner(route, fromI, x, y, minDist = 25) {
  for (let i = Math.max(fromI + 1, 1); i < route.length - 1; i++) {
    const dFromCop = Math.hypot(route[i].x - x, route[i].y - y);
    if (dFromCop < minDist) continue;
    const hIn = Math.atan2(route[i].y - route[i - 1].y, route[i].x - route[i - 1].x);
    const hOut = Math.atan2(route[i + 1].y - route[i].y, route[i + 1].x - route[i].x);
    if (Math.abs(angDiff(hOut, hIn)) > 0.35) {
      return { x: route[i].x, y: route[i].y, i, dist: dFromCop };
    }
  }
  return null;
}

/** Police route aim — commit to current leg unless the cut to the next road is open. */
export function policeRouteAim(world, route, x, y, heading, ahead = 80) {
  if (!route || route.length < 2) return null;
  let bestI = 0, bestD = Infinity;
  for (let i = 0; i < route.length; i++) {
    const d = Math.hypot(route[i].x - x, route[i].y - y);
    if (d < bestD) { bestD = d; bestI = i; }
  }

  const corner = nextRouteCorner(route, bestI, x, y, 22);
  if (corner) {
    if (pathBlockedByBuildings(world, x, y, corner.x, corner.y)) {
      const far = routeFollowAim(route, x, y, Math.max(ahead, corner.dist * 0.9));
      if (far) return far;
      return { x: corner.x, y: corner.y };
    }
    return { x: corner.x, y: corner.y };
  }

  return routeFollowAim(route, x, y, ahead);
}

/** Walk a cached route polyline and pick a point `ahead` meters forward. */
export function routeFollowAim(route, x, y, ahead = 50) {
  if (!route || route.length < 2) return null;
  let bestI = 0;
  let bestD = Infinity;
  for (let i = 0; i < route.length; i++) {
    const d = Math.hypot(route[i].x - x, route[i].y - y);
    if (d < bestD) { bestD = d; bestI = i; }
  }
  let acc = bestD;
  for (let i = bestI + 1; i < route.length; i++) {
    acc += Math.hypot(route[i].x - route[i - 1].x, route[i].y - route[i - 1].y);
    if (acc >= ahead) return route[i];
  }
  return route[route.length - 1];
}

/** Fan of probes — pick heading with most clearance (avoids wedging into corners). */
export function avoidBuildings(world, x, y, heading, desiredH, probeDist = 18) {
  let bestH = desiredH;
  let bestScore = -Infinity;
  const angles = [-1.4, -0.9, -0.45, 0, 0.45, 0.9, 1.4];
  for (const off of angles) {
    const h = desiredH + off;
    let score = 2.0 - Math.abs(off) * 0.4 - Math.abs(angDiff(h, desiredH)) * 0.15;
    for (let d = 3; d <= probeDist; d += 3) {
      const px = x + Math.cos(h) * d;
      const py = y + Math.sin(h) * d;
      if (world.buildingAt(px, py)) {
        score -= (probeDist - d + 10) * 3.5;
        break;
      }
      score += 0.5;
    }
    const wing = 5;
    const rx = -Math.sin(h), ry = Math.cos(h);
    if (world.buildingAt(x + Math.cos(h) * 2 + rx * wing, y + Math.sin(h) * 2 + ry * wing)) score -= 20;
    if (world.buildingAt(x + Math.cos(h) * 2 - rx * wing, y + Math.sin(h) * 2 - ry * wing)) score -= 20;
    if (world.buildingAt(x, y)) score -= 30;
    if (score > bestScore) { bestScore = score; bestH = h; }
  }
  return bestH;
}

/** Walk forward along the nearest road polyline. */
export function sampleRoadAhead(world, x, y, heading, dist = 40) {
  const near = world.nearestRoad(x, y, 100);
  if (!near) {
    return { x: x + Math.cos(heading) * dist, y: y + Math.sin(heading) * dist, h: heading, curvature: 0 };
  }

  const road = near.road;
  const p = road.p;
  const roadH = Math.atan2(near.ty, near.tx);
  const sign = Math.cos(heading - roadH) >= 0 ? 1 : -1;

  let px = near.x, py = near.y;
  let hFar = Math.atan2(near.ty * sign, near.tx * sign);
  let left = dist;
  let si = 0;
  let bestD = Infinity;

  for (let i = 0; i + 3 < p.length; i += 2) {
    const x1 = p[i], y1 = p[i + 1], x2 = p[i + 2], y2 = p[i + 3];
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((x - x1) * dx + (y - y1) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = x1 + t * dx, cy = y1 + t * dy;
    const d = (x - cx) ** 2 + (y - cy) ** 2;
    if (d < bestD) { bestD = d; si = i; px = cx; py = cy; }
  }

  let idx = si;
  let segT = 0;
  {
    const x1 = p[idx], y1 = p[idx + 1], x2 = p[idx + 2], y2 = p[idx + 3];
    const sl = Math.hypot(x2 - x1, y2 - y1) || 1;
    segT = Math.hypot(px - x1, py - y1) / sl;
  }

  while (left > 0.5 && idx + 3 < p.length) {
    const x1 = p[idx], y1 = p[idx + 1], x2 = p[idx + 2], y2 = p[idx + 3];
    const dx = (x2 - x1) * sign, dy = (y2 - y1) * sign;
    const sl = Math.hypot(dx, dy) || 1;
    const step = Math.min(left, sl * (sign > 0 ? 1 - segT : segT));
    segT += (step / sl) * sign;
    if (segT >= 1) {
      idx += 2;
      segT = sign > 0 ? 0 : 1;
      if (idx + 3 >= p.length) break;
    } else if (segT <= 0) {
      idx -= 2;
      segT = sign > 0 ? 0 : 1;
      if (idx < 0) break;
    }
    const nx1 = p[idx], ny1 = p[idx + 1], nx2 = p[idx + 2], ny2 = p[idx + 3];
    px = nx1 + (nx2 - nx1) * (sign > 0 ? segT : 1 - segT);
    py = ny1 + (ny2 - ny1) * (sign > 0 ? segT : 1 - segT);
    hFar = Math.atan2((ny2 - ny1) * sign, (nx2 - nx1) * sign);
    left -= step;
  }

  const nearPt = sampleRoadAheadAt(world, x, y, heading, 12);
  const curvature = Math.abs(angDiff(hFar, nearPt.h));

  return { x: px, y: py, h: hFar, curvature, hNear: nearPt.h };
}

function sampleRoadAheadAt(world, x, y, heading) {
  const near = world.nearestRoad(x, y, 100);
  if (!near) return { h: heading };
  const roadH = Math.atan2(near.ty, near.tx);
  const sign = Math.cos(heading - roadH) >= 0 ? 1 : -1;
  return { h: Math.atan2(near.ty * sign, near.tx * sign) };
}

/** Next point along a graph route to steer toward (not the final destination). */
export function routeAimPoint(graph, x, y, gx, gy, minDist = 25) {
  if (!graph) return { x: gx, y: gy };
  const route = graph.findRoute(x, y, gx, gy);
  if (!route || route.length < 2) return { x: gx, y: gy };
  for (let i = 1; i < route.length; i++) {
    if (Math.hypot(route[i].x - x, route[i].y - y) > minDist) return route[i];
  }
  return route[route.length - 1];
}

/**
 * Compute arcade inputs for an agent.
 * state: { x, y, h, vx, vy, skill?, cornering? }
 * goal: { x, y }
 * opts: { route, roadBias, probeDist, unstuck }
 */
export function computeDriveInput(world, state, goal, opts = {}) {
  const skill = state.skill ?? 0.85;
  const cornering = (state.cornering ?? 7) / 10;
  const speed = Math.hypot(state.vx ?? 0, state.vy ?? 0);
  const roadBias = opts.roadBias ?? (opts.forPolice ? 0.72 : 0.4);
  const probeDist = opts.probeDist ?? (opts.forPolice ? 26 + speed * 0.15 : 12 + speed * 0.18);

  if (opts.unstuck) {
    return {
      up: false,
      down: true,
      left: opts.unstuckSteer > 0,
      right: opts.unstuckSteer < 0,
      brake: false,
      steer: opts.unstuckSteer ?? 1,
      handbrake: false,
    };
  }

  let aim = routeAimPoint(world.roadGraph, state.x, state.y, goal.x, goal.y);
  const routeAhead = opts.routeAhead ?? (opts.forPolice ? 80 : 22);
  const cutBlocked = opts.forPolice && pathBlockedByBuildings(world, state.x, state.y, goal.x, goal.y);
  if (opts.route?.length >= 2) {
    const pt = opts.forPolice
      ? policeRouteAim(world, opts.route, state.x, state.y, state.h, routeAhead)
      : routeFollowAim(opts.route, state.x, state.y, routeAhead);
    if (pt) aim = pt;
  }

  if (cutBlocked) {
    aim = streetEndAhead(world, state.x, state.y, state.h, routeAhead);
  }

  // Off-road or wedged: get back to pavement first
  const near = world.nearestRoad(state.x, state.y, 100);
  const inBuilding = world.buildingAt(state.x, state.y);
  if (inBuilding || (near && near.d > 16)) {
    aim = near ? { x: near.x, y: near.y } : aim;
  }

  const look = sampleRoadAhead(world, state.x, state.y, state.h, 35 + speed * 0.2);
  let desiredH = Math.atan2(aim.y - state.y, aim.x - state.x);
  const bias = cutBlocked ? Math.max(roadBias, 0.94) : roadBias;
  if (look.curvature >= 0) desiredH = blendAngles(look.h, desiredH, bias);

  // Pull toward road center when drifting wide
  if (near && near.d > 8) {
    desiredH = blendAngles(desiredH, Math.atan2(near.y - state.y, near.x - state.x), 0.25);
  }

  desiredH = avoidBuildings(world, state.x, state.y, state.h, desiredH, probeDist);

  const steerErr = angDiff(desiredH, state.h);
  const blockedAhead = world.buildingAt(
    state.x + Math.cos(state.h) * 5, state.y + Math.sin(state.h) * 5)
    || world.buildingAt(state.x + Math.cos(state.h) * 10, state.y + Math.sin(state.h) * 10);
  const noseIn = blockedAhead && (
    world.buildingAt(state.x + Math.cos(state.h) * 3, state.y + Math.sin(state.h) * 3)
    || world.buildingAt(state.x + Math.cos(state.h) * 6, state.y + Math.sin(state.h) * 6)
  );
  const sharp = (look.curvature > 0.35 || Math.abs(steerErr) > 0.5) && !blockedAhead;
  const drift = sharp && speed > 7 && cornering * skill > 0.35 && !opts.forPolice;

  // Police nose into wall/corner — reverse out, don't gas and steer
  if (opts.forPolice && (noseIn || (blockedAhead && speed < 16))) {
    const revSteer = pickUnstuckSteer(world, state.x, state.y, state.h);
    return {
      up: false,
      down: true,
      left: revSteer > 0,
      right: revSteer < 0,
      brake: false,
      steer: revSteer,
      handbrake: false,
    };
  }

  return {
    up: !blockedAhead,
    down: blockedAhead,
    left: steerErr < -0.06,
    right: steerErr > 0.06,
    brake: drift,
    steer: Math.max(-1, Math.min(1, steerErr * 2.5)),
    handbrake: drift,
  };
}

/** Apply LocalDriver output to a police cop struct (sets steer/throttle/handbrake). */
export function applyToCop(c, input, dt) {
  c.steer += (input.steer - c.steer) * Math.min(1, 10 * dt);
  if (input.down && !input.up) {
    c.throttle = -0.7;
  } else {
    c.throttle = input.up ? 1 : 0;
  }
  c.handbrake = !!input.handbrake;
}

/** Pick reverse-and-spin direction when wedged. Returns -1 or 1. */
export function pickUnstuckSteer(world, x, y, heading) {
  const rx = -Math.sin(heading), ry = Math.cos(heading);
  let leftScore = 0, rightScore = 0;
  for (let d = 2; d <= 22; d += 2) {
    const fx = Math.cos(heading), fy = Math.sin(heading);
    for (const wing of [5, 8]) {
      if (!world.buildingAt(x - fx * d + rx * wing, y - fy * d + ry * wing)) leftScore += 1;
      if (!world.buildingAt(x - fx * d - rx * wing, y - fy * d - ry * wing)) rightScore += 1;
    }
  }
  return leftScore >= rightScore ? 1 : -1;
}
