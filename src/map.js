const AMBER = "#ffc24b";
const RED = "#ff4f5e";
const BONE = "#e8e0cc";
const DARK = "#0a0a0e";
const MAP_BG = "#11131a";
const ORANGE = "#ff9b42";

const INITIAL_SPAN_M = 2500;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 3;
const CLICK_PX = 5;
const WAYPOINT_HIT_PX = 14;
const ROAD_LAYER_MAX = 2600;
const ROAD_LAYER_MIN = 900;
const STYLE_ID = "sf-city-map-style";
const HINT = "CLICK SET WAYPOINT · CLICK MARKER REMOVE · DRAG PAN · SCROLL ZOOM · M/ESC CLOSE";

const STYLE = `
.sf-city-map {
  position: fixed;
  inset: 0;
  z-index: 35;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 22px;
  color: ${BONE};
  font-family: "Press Start 2P", "Courier New", monospace;
  background: rgba(12, 13, 18, 0.96);
  opacity: 1;
  visibility: visible;
  transition: opacity 110ms ease, visibility 110ms ease;
}

.sf-city-map::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    repeating-linear-gradient(
      0deg,
      rgba(255, 255, 255, 0.026) 0,
      rgba(255, 255, 255, 0.026) 1px,
      rgba(0, 0, 0, 0.12) 1px,
      rgba(0, 0, 0, 0.12) 4px
    ),
    radial-gradient(ellipse at center, transparent 48%, rgba(0, 0, 0, 0.42) 100%);
  mix-blend-mode: screen;
}

.sf-city-map--hidden {
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}

.sf-city-map__panel {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 10px;
  width: 92vw;
  height: 92vh;
  min-width: 0;
  min-height: 0;
  filter: drop-shadow(14px 14px 0 rgba(0, 0, 0, 0.52));
}

.sf-city-map__header {
  color: ${AMBER};
  font-size: clamp(11px, 1.55vw, 17px);
  line-height: 1.6;
  letter-spacing: 2px;
  text-align: center;
  text-shadow: 3px 3px 0 #000;
}

.sf-city-map__canvas {
  display: block;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  border: 3px solid #1c1a16;
  outline: 2px solid #5b5345;
  background: ${MAP_BG};
  box-shadow:
    inset 0 0 0 2px rgba(255, 194, 75, 0.05),
    inset 0 0 42px rgba(0, 0, 0, 0.32);
  cursor: grab;
  image-rendering: pixelated;
  touch-action: none;
}

.sf-city-map--dragging .sf-city-map__canvas {
  cursor: grabbing;
}

.sf-city-map__footer {
  min-height: 28px;
  padding: 9px 12px;
  color: #9f927b;
  font-size: clamp(7px, 1vw, 10px);
  line-height: 1.7;
  text-align: center;
  text-shadow: 2px 2px 0 #000;
  background: rgba(9, 9, 14, 0.84);
  border: 3px solid #1c1a16;
  outline: 1px solid #5b5345;
}

@media (max-width: 680px) {
  .sf-city-map {
    padding: 14px;
  }

  .sf-city-map__panel {
    width: 94vw;
    height: 94vh;
    gap: 8px;
  }
}
`;

export class CityMap {
  constructor(world, api = {}) {
    this.world = world || {};
    this.api = {
      getPlayer: api.getPlayer || (() => null),
      getWaypoint: api.getWaypoint || (() => null),
      setWaypoint: api.setWaypoint || (() => {}),
      getRival: api.getRival || (() => null),
    };

    this.isVisible = false;
    this.centerX = 0;
    this.centerY = 0;
    this.zoom = 1;
    this.cssWidth = 1;
    this.cssHeight = 1;
    this.dpr = 1;
    this.baseScale = 1 / INITIAL_SPAN_M;
    this.roadLayer = null;
    this.roadLayerScale = 1;
    this.drag = null;
    this.tick = 0;

    this.#injectStyles();
    this.#buildDom();
  }

  get visible() {
    return this.isVisible;
  }

  open() {
    if (this.isVisible) return;
    this.isVisible = true;
    this.overlay.classList.remove("sf-city-map--hidden");
    this.#resizeCanvas();
    this.#resetView();
    this.#draw();
    this.tick = setInterval(() => this.#draw(), 1000);
    this.overlay.focus({ preventScroll: true });
  }

  close() {
    if (!this.isVisible) return;
    this.isVisible = false;
    this.overlay.classList.add("sf-city-map--hidden");
    this.overlay.classList.remove("sf-city-map--dragging");
    this.drag = null;
    if (this.tick) {
      clearInterval(this.tick);
      this.tick = 0;
    }
  }

  toggle() {
    if (this.isVisible) this.close();
    else this.open();
  }

  handleKey(e) {
    if (!this.isVisible) return false;
    if (e.key === "Escape" || e.code === "KeyM" || e.key === "m" || e.key === "M") {
      e.preventDefault();
      this.close();
      return true;
    }
    return false;
  }

  #injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  #buildDom() {
    this.overlay = document.createElement("div");
    this.overlay.className = "sf-city-map sf-city-map--hidden";
    this.overlay.tabIndex = -1;

    const panel = document.createElement("div");
    panel.className = "sf-city-map__panel";

    const header = document.createElement("div");
    header.className = "sf-city-map__header";
    header.textContent = "SAN FRANCISCO";

    this.canvas = document.createElement("canvas");
    this.canvas.className = "sf-city-map__canvas";

    this.footer = document.createElement("div");
    this.footer.className = "sf-city-map__footer";
    this.footer.textContent = HINT;

    panel.appendChild(header);
    panel.appendChild(this.canvas);
    panel.appendChild(this.footer);
    this.overlay.appendChild(panel);
    document.body.appendChild(this.overlay);

    this.canvas.addEventListener("pointerdown", (e) => this.#onPointerDown(e));
    this.canvas.addEventListener("pointermove", (e) => this.#onPointerMove(e));
    this.canvas.addEventListener("pointerup", (e) => this.#onPointerUp(e));
    this.canvas.addEventListener("pointercancel", () => this.#endDrag());
    this.canvas.addEventListener("wheel", (e) => this.#onWheel(e), { passive: false });
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("resize", () => {
      if (!this.isVisible) return;
      this.#resizeCanvas();
      this.#clampCenter();
      this.#draw();
    });
  }

  #resetView() {
    const player = this.api.getPlayer();
    const bounds = this.#bounds();
    this.centerX = player && Number.isFinite(player.x) ? player.x : (bounds.minX + bounds.maxX) * 0.5;
    this.centerY = player && Number.isFinite(player.y) ? player.y : (bounds.minY + bounds.maxY) * 0.5;
    this.zoom = 1;
    this.#clampCenter();
  }

  #resizeCanvas() {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const pxW = Math.round(w * dpr);
    const pxH = Math.round(h * dpr);

    this.cssWidth = w;
    this.cssHeight = h;
    this.dpr = dpr;
    this.baseScale = w / INITIAL_SPAN_M;

    if (this.canvas.width !== pxW || this.canvas.height !== pxH) {
      this.canvas.width = pxW;
      this.canvas.height = pxH;
    }
  }

  #draw() {
    if (!this.isVisible) return;
    this.#resizeCanvas();
    this.#ensureRoadLayer();

    const g = this.canvas.getContext("2d");
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.cssWidth, this.cssHeight);
    g.fillStyle = MAP_BG;
    g.fillRect(0, 0, this.cssWidth, this.cssHeight);

    this.#drawRoadLayer(g);
    this.#drawRival(g);
    this.#drawWaypoint(g);
    this.#drawPlayer(g);
    this.#drawGridShade(g);
    this.#updateFooter();
  }

  #ensureRoadLayer() {
    if (this.roadLayer) return;

    const bounds = this.#bounds();
    const worldW = Math.max(1, bounds.maxX - bounds.minX);
    const worldH = Math.max(1, bounds.maxY - bounds.minY);
    const aspect = worldW / worldH;
    let layerW;
    let layerH;

    if (aspect >= 1) {
      layerW = ROAD_LAYER_MAX;
      layerH = Math.max(ROAD_LAYER_MIN, Math.round(ROAD_LAYER_MAX / aspect));
    } else {
      layerH = ROAD_LAYER_MAX;
      layerW = Math.max(ROAD_LAYER_MIN, Math.round(ROAD_LAYER_MAX * aspect));
    }

    this.roadLayer = document.createElement("canvas");
    this.roadLayer.width = layerW;
    this.roadLayer.height = layerH;
    this.roadLayerScale = Math.min(layerW / worldW, layerH / worldH);
    this.#renderRoadLayer(bounds);
  }

  #renderRoadLayer(bounds) {
    const roads = (this.world.overview && this.world.overview.roads) || [];
    const g = this.roadLayer.getContext("2d");
    const layerScale = this.roadLayerScale;
    const screenPerLayer = Math.max(0.001, this.baseScale / layerScale);

    g.clearRect(0, 0, this.roadLayer.width, this.roadLayer.height);
    g.setTransform(layerScale, 0, 0, layerScale, -bounds.minX * layerScale, -bounds.minY * layerScale);
    g.lineCap = "round";
    g.lineJoin = "round";

    this.#strokeRoadBatch(g, roads, 1, "#33312c", 0.6 / screenPerLayer / layerScale);
    this.#strokeRoadBatch(g, roads, 2, "#4a4740", 1 / screenPerLayer / layerScale);
    this.#strokeRoadBatch(g, roads, 3, "#6e695f", 1.8 / screenPerLayer / layerScale);
    this.#strokeRoadBatch(g, roads, 4, "#9a9181", 2.5 / screenPerLayer / layerScale);

    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  #strokeRoadBatch(g, roads, rank, color, lineWidth) {
    g.beginPath();
    for (let i = 0; i < roads.length; i++) {
      const road = roads[i];
      const roadRank = road.r || 0;
      if (rank === 4 ? roadRank < 4 : roadRank !== rank) continue;

      const p = road.p;
      if (!p || p.length < 4) continue;
      g.moveTo(p[0], p[1]);
      for (let j = 2; j < p.length; j += 2) {
        g.lineTo(p[j], p[j + 1]);
      }
    }
    g.strokeStyle = color;
    g.lineWidth = Math.max(0.35, lineWidth);
    g.stroke();
  }

  #drawRoadLayer(g) {
    if (!this.roadLayer) return;
    const bounds = this.#bounds();
    const scale = this.#scale();
    const layerCenterX = (this.centerX - bounds.minX) * this.roadLayerScale;
    const layerCenterY = (this.centerY - bounds.minY) * this.roadLayerScale;
    const layerToScreen = scale / this.roadLayerScale;

    g.save();
    g.imageSmoothingEnabled = false;
    g.translate(this.cssWidth * 0.5, this.cssHeight * 0.5);
    g.scale(layerToScreen, layerToScreen);
    g.translate(-layerCenterX, -layerCenterY);
    g.drawImage(this.roadLayer, 0, 0);
    g.restore();
  }

  #drawPlayer(g) {
    const player = this.api.getPlayer();
    if (!player) return;

    const p = this.#worldToScreen(player.x, player.y);
    const pulse = 1 + 0.16 * Math.sin(this.#now() * 0.006);

    g.save();
    g.translate(p.x, p.y);
    g.strokeStyle = "rgba(255, 79, 94, 0.42)";
    g.lineWidth = 2;
    g.beginPath();
    g.arc(0, 0, 16 * pulse, 0, Math.PI * 2);
    g.stroke();

    g.rotate(player.h || 0);
    g.fillStyle = RED;
    g.strokeStyle = "#210b0f";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -11);
    g.lineTo(8, 9);
    g.lineTo(0, 5);
    g.lineTo(-8, 9);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }

  #drawRival(g) {
    const rival = this.api.getRival();
    if (!rival) return;

    const p = this.#worldToScreen(rival.x, rival.y);
    if (!this.#nearScreen(p.x, p.y, 80)) return;

    g.save();
    g.fillStyle = ORANGE;
    g.strokeStyle = "#241006";
    g.lineWidth = 2;
    g.beginPath();
    g.arc(p.x, p.y, 5, 0, Math.PI * 2);
    g.fill();
    g.stroke();

    if (rival.name) {
      g.font = '8px "Press Start 2P", monospace';
      g.textAlign = "left";
      g.textBaseline = "middle";
      g.lineWidth = 3;
      g.strokeStyle = "#000";
      g.fillStyle = BONE;
      g.strokeText(rival.name, p.x + 9, p.y - 1);
      g.fillText(rival.name, p.x + 9, p.y - 1);
    }
    g.restore();
  }

  #drawWaypoint(g) {
    const wp = this.api.getWaypoint();
    if (!wp) return;

    const p = this.#worldToScreen(wp.x, wp.y);
    if (!this.#nearScreen(p.x, p.y, 90)) return;

    const pulse = 1 + 0.16 * Math.sin(this.#now() * 0.005);
    g.save();
    g.translate(p.x, p.y);

    g.fillStyle = `rgba(255, 194, 75, ${0.12 + 0.08 * pulse})`;
    g.beginPath();
    g.arc(0, 0, 19 * pulse, 0, Math.PI * 2);
    g.fill();

    g.fillStyle = AMBER;
    g.strokeStyle = "#1e1607";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, 14);
    g.bezierCurveTo(-13, 1, -9, -15, 0, -15);
    g.bezierCurveTo(9, -15, 13, 1, 0, 14);
    g.closePath();
    g.fill();
    g.stroke();

    g.fillStyle = DARK;
    g.beginPath();
    g.arc(0, -5, 4, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  #drawGridShade(g) {
    g.save();
    g.strokeStyle = "rgba(255, 194, 75, 0.025)";
    g.lineWidth = 1;
    for (let x = 0; x < this.cssWidth; x += 64) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, this.cssHeight);
      g.stroke();
    }
    for (let y = 0; y < this.cssHeight; y += 64) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(this.cssWidth, y);
      g.stroke();
    }
    g.restore();
  }

  #updateFooter() {
    const player = this.api.getPlayer();
    const wp = this.api.getWaypoint();
    let text = HINT;

    if (player && wp) {
      const dist = Math.hypot(wp.x - player.x, wp.y - player.y);
      text = "WAYPOINT " + this.#formatDistance(dist) + " · " + HINT;
    }

    if (this.footer.textContent !== text) this.footer.textContent = text;
  }

  #onPointerDown(e) {
    if (!this.isVisible || e.button !== 0) return;
    e.preventDefault();
    const p = this.#eventPoint(e);
    this.drag = {
      id: e.pointerId,
      startX: p.x,
      startY: p.y,
      lastX: p.x,
      lastY: p.y,
      dragging: false,
    };
    this.canvas.setPointerCapture(e.pointerId);
  }

  #onPointerMove(e) {
    if (!this.drag || this.drag.id !== e.pointerId) return;
    const p = this.#eventPoint(e);
    const totalDx = p.x - this.drag.startX;
    const totalDy = p.y - this.drag.startY;
    const totalMoved = Math.hypot(totalDx, totalDy);

    if (!this.drag.dragging && totalMoved < CLICK_PX) return;
    this.drag.dragging = true;
    this.overlay.classList.add("sf-city-map--dragging");

    const dx = p.x - this.drag.lastX;
    const dy = p.y - this.drag.lastY;
    this.centerX -= dx / this.#scale();
    this.centerY -= dy / this.#scale();
    this.drag.lastX = p.x;
    this.drag.lastY = p.y;
    this.#clampCenter();
    this.#draw();
  }

  #onPointerUp(e) {
    if (!this.drag || this.drag.id !== e.pointerId) return;
    e.preventDefault();
    const p = this.#eventPoint(e);
    const moved = Math.hypot(p.x - this.drag.startX, p.y - this.drag.startY);
    const wasDragging = this.drag.dragging;

    this.#endDrag();
    if (!wasDragging && moved < CLICK_PX) this.#handleClick(p.x, p.y);
  }

  #endDrag() {
    if (this.drag && this.canvas.releasePointerCapture) {
      try {
        this.canvas.releasePointerCapture(this.drag.id);
      } catch (_) {
        // Pointer capture can already be released by the browser on cancel.
      }
    }
    this.drag = null;
    this.overlay.classList.remove("sf-city-map--dragging");
  }

  #onWheel(e) {
    if (!this.isVisible) return;
    e.preventDefault();
    const p = this.#eventPoint(e);
    const before = this.#screenToWorld(p.x, p.y);
    const factor = Math.exp(-e.deltaY * 0.0014);
    this.zoom = this.#clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const scale = this.#scale();

    this.centerX = before.x - (p.x - this.cssWidth * 0.5) / scale;
    this.centerY = before.y - (p.y - this.cssHeight * 0.5) / scale;
    this.#clampCenter();
    this.#draw();
  }

  #handleClick(x, y) {
    const wp = this.api.getWaypoint();
    if (wp) {
      const p = this.#worldToScreen(wp.x, wp.y);
      if (Math.hypot(p.x - x, p.y - y) <= WAYPOINT_HIT_PX) {
        this.api.setWaypoint(null);
        this.#draw();
        return;
      }
    }

    this.api.setWaypoint(this.#screenToWorld(x, y));
    this.#draw();
  }

  #worldToScreen(x, y) {
    const scale = this.#scale();
    return {
      x: this.cssWidth * 0.5 + (x - this.centerX) * scale,
      y: this.cssHeight * 0.5 + (y - this.centerY) * scale,
    };
  }

  #screenToWorld(x, y) {
    const scale = this.#scale();
    return {
      x: this.centerX + (x - this.cssWidth * 0.5) / scale,
      y: this.centerY + (y - this.cssHeight * 0.5) / scale,
    };
  }

  #eventPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  #scale() {
    return this.baseScale * this.zoom;
  }

  #clampCenter() {
    const bounds = this.#bounds();
    this.centerX = this.#clamp(this.centerX, bounds.minX, bounds.maxX);
    this.centerY = this.#clamp(this.centerY, bounds.minY, bounds.maxY);
  }

  #bounds() {
    const overview = this.world.overview || {};
    if (overview.bounds) return overview.bounds;
    return { minX: -8000, minY: -6500, maxX: 8000, maxY: 6500 };
  }

  #nearScreen(x, y, pad) {
    return x >= -pad && y >= -pad && x <= this.cssWidth + pad && y <= this.cssHeight + pad;
  }

  #formatDistance(meters) {
    if (meters < 1000) return Math.round(meters) + "m";
    return (meters / 1000).toFixed(meters < 9500 ? 1 : 0) + "km";
  }

  #clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  #now() {
    return typeof performance === "undefined" ? Date.now() : performance.now();
  }
}
