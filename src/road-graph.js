// Prebuilt road network from OSM (see tools/process_sf.mjs).
// Used for minimap routing and future nav / training paths.

const CELL = 80;

export class RoadGraph {
  constructor(data) {
    this.nodes = data.nodes; // [[x,y], ...]
    this.adj = data.nodes.map(() => []);
    for (const e of data.edges) {
      const [from, to, len, r, ow] = e;
      this.adj[from].push({ to, len, r });
      if (!ow) this.adj[to].push({ to: from, len, r });
    }
    this.grid = new Map();
    for (let i = 0; i < this.nodes.length; i++) {
      const [x, y] = this.nodes[i];
      const k = `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
      let a = this.grid.get(k);
      if (!a) this.grid.set(k, (a = []));
      a.push(i);
    }
  }

  nearestNode(x, y, maxR = 100) {
    const c0x = Math.floor(x / CELL), c0y = Math.floor(y / CELL);
    const maxRing = Math.ceil(maxR / CELL);
    let best = null;
    for (let ring = 0; ring <= maxRing; ring++) {
      if (best && best.d < Math.max(0, (ring - 1) * CELL)) break;
      for (let cx = c0x - ring; cx <= c0x + ring; cx++) {
        for (let cy = c0y - ring; cy <= c0y + ring; cy++) {
          if (Math.max(Math.abs(cx - c0x), Math.abs(cy - c0y)) !== ring) continue;
          const arr = this.grid.get(`${cx},${cy}`);
          if (!arr) continue;
          for (const i of arr) {
            const [nx, ny] = this.nodes[i];
            const d = Math.hypot(x - nx, y - ny);
            if (d <= maxR && (!best || d < best.d)) best = { i, d, x: nx, y: ny };
          }
        }
      }
    }
    return best;
  }

  /** A* route as [{x,y}, ...] from world coords to world coords. */
  /** Pick best graph neighbor toward a target (for traffic junctions). */
  bestNeighbor(nodeIdx, targetX, targetY, avoidNode = -1) {
    let best = null;
    const [nx, ny] = this.nodes[nodeIdx];
    const toTarget = Math.atan2(targetY - ny, targetX - nx);
    for (const e of this.adj[nodeIdx]) {
      if (e.to === avoidNode) continue;
      const [ex, ey] = this.nodes[e.to];
      const eh = Math.atan2(ey - ny, ex - nx);
      let score = Math.cos(eh - toTarget);
      if (e.r >= 3) score += 0.08;
      if (!best || score > best.score) best = { to: e.to, score, x: ex, y: ey };
    }
    return best;
  }

  findRoute(sx, sy, ex, ey) {
    const start = this.nearestNode(sx, sy, 120);
    const end = this.nearestNode(ex, ey, 120);
    if (!start || !end) return null;

    const goal = end.i;
    const h = (i) => {
      const [x, y] = this.nodes[i];
      return Math.hypot(x - ex, y - ey);
    };

    const open = [{ i: start.i, g: 0, f: h(start.i) }];
    const came = new Int32Array(this.nodes.length);
    came.fill(-1);
    const gScore = new Float64Array(this.nodes.length);
    gScore.fill(Infinity);
    gScore[start.i] = 0;
    const closed = new Uint8Array(this.nodes.length);

    while (open.length) {
      open.sort((a, b) => a.f - b.f);
      const cur = open.shift();
      if (closed[cur.i]) continue;
      if (cur.i === goal) {
        const path = [{ x: ex, y: ey }];
        let n = goal;
        while (n !== -1) {
          path.push({ x: this.nodes[n][0], y: this.nodes[n][1] });
          n = came[n];
        }
        path.push({ x: sx, y: sy });
        path.reverse();
        return path;
      }
      closed[cur.i] = 1;

      for (const e of this.adj[cur.i]) {
        if (closed[e.to]) continue;
        const ng = cur.g + e.len * (1.05 - e.r * 0.01); // slight preference for bigger roads
        if (ng >= gScore[e.to]) continue;
        came[e.to] = cur.i;
        gScore[e.to] = ng;
        open.push({ i: e.to, g: ng, f: ng + h(e.to) });
      }
    }

    return null;
  }
}

export async function loadRoadGraph() {
  try {
    const data = await (await fetch("data/road-graph.json")).json();
    return new RoadGraph(data);
  } catch {
    return null;
  }
}
