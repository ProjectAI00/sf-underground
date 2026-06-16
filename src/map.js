// City Map with Circuit Editor
// M to open, E to toggle edit mode, click to place checkpoints

const AMBER = "#ffc24b";
const CYAN = "#4be0c8";
const RED = "#ff4f5e";
const MAGENTA = "#ff2975";
const DIM = "#5a5548";

// Locations on the map
// Coordinates use game system: x = (lon - (-122.4375)) * 88200, y = (37.7695 - lat) * 110574
const LOCATIONS = [
  // Landmarks (amber)
  { name: "GOLDEN GATE BRIDGE", type: "landmark", x: -3600, y: -5570 },
  { name: "COIT TOWER", type: "landmark", x: 2795, y: -3640 },
  { name: "PIER 39", type: "landmark", x: 2440, y: -4335 },
  { name: "FERRY BUILDING", type: "landmark", x: 3880, y: -2885 },
  { name: "UNION SQUARE", type: "landmark", x: 2645, y: -2035 },
  { name: "ALAMO SQUARE", type: "landmark", x: 255, y: -765 },
  { name: "TWIN PEAKS", type: "landmark", x: -900, y: 1670 },
  { name: "PALACE OF FINE ARTS", type: "landmark", x: -970, y: -3695 },
  { name: "ORACLE PARK", type: "landmark", x: 4250, y: -1005 },
  { name: "LOMBARD STREET", type: "landmark", x: 1660, y: -3605 },
  { name: "FISHERMANS WHARF", type: "landmark", x: 1745, y: -4260 },
  { name: "PRESIDIO", type: "landmark", x: -2530, y: -3250 },
  { name: "ALCATRAZ VIEW", type: "landmark", x: 2200, y: -4800 },
  { name: "TRANSAMERICA", type: "landmark", x: 2960, y: -3180 },
  
  // Safehouses / Garages (magenta)
  { name: "MISSION GARAGE", type: "safehouse", x: 1350, y: 830 },
  { name: "SOMA HIDEOUT", type: "safehouse", x: 2800, y: -680 },
  { name: "CHINATOWN SAFE", type: "safehouse", x: 2500, y: -2850 },
  { name: "NORTH BEACH PAD", type: "safehouse", x: 2100, y: -3450 },
  { name: "MARINA STASH", type: "safehouse", x: -350, y: -3950 },
  { name: "SUNSET GARAGE", type: "safehouse", x: -4200, y: 350 },
  { name: "CASTRO HIDEOUT", type: "safehouse", x: 50, y: 280 },
  
  // Race start points (cyan) - from actual circuit data
  { name: "CHINATOWN START", type: "race", x: 2647, y: -3340 },
  { name: "HAIGHT START", type: "race", x: -400, y: -126 },
  { name: "EMBARCADERO START", type: "race", x: 4350, y: -1493 },
  { name: "SUNSET START", type: "race", x: -6200, y: 2254 },
];

const STYLE_ID = "sf-city-map-style";
const STYLE = `
.city-map {
  position: fixed; inset: 0; z-index: 35;
  font-family: "Press Start 2P", monospace;
  background: rgba(6,6,10,0.97);
  opacity: 1; transition: opacity 0.15s;
}
.city-map--hidden { opacity: 0; pointer-events: none; }
.city-map__wrap {
  position: relative; width: 100%; height: 100%;
}
.city-map__canvas {
  width: 100%; height: 100%;
  background: #08080c; cursor: crosshair;
}
.city-map--dragging .city-map__canvas { cursor: grabbing; }

/* Top bar */
.city-map__topbar {
  position: absolute; top: 16px; left: 16px;
  display: flex; align-items: center; gap: 3px;
  background: rgba(12,12,16,0.9); border: 1px solid #2a2822;
  border-radius: 3px; padding: 3px;
}
.city-map__title { display: none; }
.city-map__tab {
  padding: 10px 16px; font-size: 8px; cursor: pointer;
  color: ${DIM}; background: transparent; 
  border: none; border-radius: 2px;
  font-family: inherit; transition: all 0.12s;
  white-space: nowrap;
}
.city-map__tab:hover { color: #ccc; background: rgba(255,255,255,0.05); }
.city-map__tab--active { 
  color: #fff; background: ${CYAN}20;
}
.city-map__sep { width: 1px; height: 20px; background: #2a2822; }
.city-map__close {
  padding: 10px 14px; font-size: 8px; cursor: pointer;
  color: ${DIM}; background: transparent;
  border: none; border-radius: 2px;
  font-family: inherit; transition: all 0.12s;
}
.city-map__close:hover { color: ${RED}; background: rgba(255,79,94,0.1); }

/* Race info popup */
.city-map__popup {
  position: absolute; bottom: 50px; left: 50%; transform: translateX(-50%);
  background: rgba(12,12,16,0.95); border: 1px solid #2a2822;
  border-radius: 3px; padding: 12px 16px;
  display: none; text-align: center; min-width: 200px;
}
.city-map__popup--visible { display: block; }
.city-map__popup-title { font-size: 9px; color: ${CYAN}; margin-bottom: 6px; }
.city-map__popup-info { font-size: 7px; color: ${DIM}; margin-bottom: 10px; }
.city-map__popup-btn {
  padding: 8px 20px; font-size: 7px; cursor: pointer;
  color: #fff; background: ${CYAN}30; border: 1px solid ${CYAN}50;
  font-family: inherit; border-radius: 2px; margin: 0 4px;
}
.city-map__popup-btn:hover { background: ${CYAN}50; }
.city-map__popup-btn--secondary {
  color: ${DIM}; background: transparent; border-color: #2a2822;
}
.city-map__popup-btn--secondary:hover { color: #fff; border-color: #4a4842; }

/* Bottom status */
.city-map__status {
  position: absolute; bottom: 16px; left: 20px;
  font-size: 7px; color: ${DIM};
  text-shadow: 0 1px 4px rgba(0,0,0,0.8);
}
.city-map__status b { color: ${CYAN}; font-weight: normal; }
`;

export class CityMap {
  constructor(world, api = {}) {
    this.world = world || {};
    this.api = {
      getPlayer: api.getPlayer || (() => null),
      getWaypoint: api.getWaypoint || (() => null),
      setWaypoint: api.setWaypoint || (() => {}),
      teleport: api.teleport || (() => {}),
      getRival: api.getRival || (() => null),
    };
    
    this.isVisible = false;
    this.centerX = 0;
    this.centerY = 0;
    this.zoom = 0.12;
    this.drag = null;
    this.animFrame = null;
    this.bounds = null;
    
    // State
    this.mode = "navigate"; // "navigate" or "races"
    this.circuits = this.#loadCircuits();
    this.selectedCircuit = null;
    this.onStartRace = null; // Callback when race is started

    this.#injectStyles();
    this.#buildDom();
  }

  get visible() { return this.isVisible; }

  open() {
    if (this.isVisible) return;
    this.isVisible = true;
    this.el.classList.remove("city-map--hidden");
    this.#resize();
    
    if (this.world.loadAllChunks) {
      this.world.loadAllChunks().then(() => {
        this.#calcBounds();
        this.#fitMap();
      });
    } else {
      this.#calcBounds();
      this.#fitMap();
    }
    
    this.#loop();
  }

  close() {
    if (!this.isVisible) return;
    this.isVisible = false;
    this.el.classList.add("city-map--hidden");
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
  }

  toggle() { this.isVisible ? this.close() : this.open(); }

  handleKey(e) {
    if (!this.isVisible) return false;
    
    if (e.key === "Escape" || e.code === "KeyM") {
      this.close();
      return true;
    }
    
    // Zoom with +/-
    if (e.key === "=" || e.key === "+") { this.zoom = Math.min(2, this.zoom * 1.15); return true; }
    if (e.key === "-") { this.zoom = Math.max(0.02, this.zoom * 0.85); return true; }
    
    return false;
  }

  getCircuits() {
    return this.circuits;
  }
  
  setOnStartRace(callback) {
    this.onStartRace = callback;
  }

  #injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  #buildDom() {
    this.el = document.createElement("div");
    this.el.className = "city-map city-map--hidden";
    this.el.innerHTML = `
      <div class="city-map__wrap">
        <canvas class="city-map__canvas"></canvas>
        
        <div class="city-map__topbar">
          <button class="city-map__tab city-map__tab--active" data-mode="navigate">NAVIGATE</button>
          <button class="city-map__tab" data-mode="races">RACES</button>
          <div class="city-map__sep"></div>
          <button class="city-map__close">CLOSE</button>
        </div>
        
        <div class="city-map__popup">
          <div class="city-map__popup-title"></div>
          <div class="city-map__popup-info"></div>
          <button class="city-map__popup-btn" data-action="start">START RACE</button>
          <button class="city-map__popup-btn city-map__popup-btn--secondary" data-action="cancel">CANCEL</button>
        </div>
        
        <div class="city-map__status"></div>
      </div>
    `;
    document.body.appendChild(this.el);
    
    this.canvas = this.el.querySelector("canvas");
    this.popup = this.el.querySelector(".city-map__popup");
    this.popupTitle = this.el.querySelector(".city-map__popup-title");
    this.popupInfo = this.el.querySelector(".city-map__popup-info");
    this.statusEl = this.el.querySelector(".city-map__status");
    
    // Tab clicks
    this.el.querySelectorAll(".city-map__tab").forEach(tab => {
      tab.onclick = () => this.#setMode(tab.dataset.mode);
    });
    
    // Popup button clicks
    this.el.querySelectorAll(".city-map__popup-btn").forEach(btn => {
      btn.onclick = () => this.#handlePopupAction(btn.dataset.action);
    });
    
    // Close button
    this.el.querySelector(".city-map__close").onclick = () => this.close();
    
    this.canvas.addEventListener("pointerdown", e => this.#onDown(e));
    this.canvas.addEventListener("pointermove", e => this.#onMove(e));
    this.canvas.addEventListener("pointerup", e => this.#onUp(e));
    this.canvas.addEventListener("wheel", e => this.#onWheel(e), { passive: false });
    this.canvas.addEventListener("contextmenu", e => e.preventDefault());
    window.addEventListener("resize", () => this.isVisible && this.#resize());
    
    this.#updateUI();
  }
  
  #setMode(mode) {
    this.mode = mode; // "navigate" or "races"
    this.selectedCircuit = null;
    this.#hidePopup();
    this.el.querySelectorAll(".city-map__tab").forEach(tab => {
      tab.classList.toggle("city-map__tab--active", tab.dataset.mode === mode);
    });
    this.#updateUI();
  }
  
  #handlePopupAction(action) {
    if (action === "start" && this.selectedCircuit !== null) {
      // Start the race - this will be handled by main.js
      const circuit = this.circuits[this.selectedCircuit];
      if (this.onStartRace) {
        this.onStartRace(circuit);
      }
      this.close();
    } else if (action === "cancel") {
      this.#hidePopup();
      this.selectedCircuit = null;
    }
  }
  
  #showPopup(title, info) {
    this.popupTitle.textContent = title;
    this.popupInfo.textContent = info;
    this.popup.classList.add("city-map__popup--visible");
  }
  
  #hidePopup() {
    this.popup.classList.remove("city-map__popup--visible");
  }

  #updateUI() {
    // Status bar
    if (this.mode === "races") {
      this.statusEl.innerHTML = "Click a race to select it";
    } else {
      this.statusEl.innerHTML = "Click a location to zoom · Double-click to teleport";
    }
  }

  #resize() {
    const r = this.canvas.getBoundingClientRect();
    this.w = r.width;
    this.h = r.height;
    this.dpr = Math.min(2, devicePixelRatio || 1);
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
  }

  #calcBounds() {
    // Try overview bounds first
    if (this.world.overview && this.world.overview.bounds) {
      const b = this.world.overview.bounds;
      this.bounds = { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY };
      return;
    }
    
    // Fallback to calculating from roads
    let roadsList = [];
    if (this.world.roadsById && this.world.roadsById.size > 0) {
      roadsList = Array.from(this.world.roadsById.values());
    } else if (this.world.overview && this.world.overview.roads) {
      roadsList = this.world.overview.roads;
    }
    
    if (roadsList.length === 0) {
      this.bounds = { minX: -7000, minY: -8000, maxX: 10000, maxY: 9000 };
      return;
    }
    
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const road of roadsList) {
      const p = road.p;
      for (let i = 0; i < p.length; i += 2) {
        minX = Math.min(minX, p[i]); maxX = Math.max(maxX, p[i]);
        minY = Math.min(minY, p[i + 1]); maxY = Math.max(maxY, p[i + 1]);
      }
    }
    this.bounds = { minX, minY, maxX, maxY };
  }

  #fitMap() {
    if (!this.bounds) return;
    this.centerX = (this.bounds.minX + this.bounds.maxX) / 2;
    this.centerY = (this.bounds.minY + this.bounds.maxY) / 2;
    const zx = (this.w * 0.9) / (this.bounds.maxX - this.bounds.minX);
    const zy = (this.h * 0.9) / (this.bounds.maxY - this.bounds.minY);
    this.zoom = Math.min(zx, zy);
  }

  #loop() {
    if (!this.isVisible) return;
    this.#draw();
    this.animFrame = requestAnimationFrame(() => this.#loop());
  }

  #draw() {
    const g = this.canvas.getContext("2d");
    const w = this.w, h = this.h, z = this.zoom;
    
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = "#08080c";
    g.fillRect(0, 0, w, h);
    
    // Roads
    this.#drawRoads(g, w, h, z);
    
    if (this.mode === "races") {
      // Draw all circuits on map
      this.#drawAllCircuits(g, w, h, z);
    } else {
      // Navigate mode - show locations
      this.#drawLocations(g, w, h, z);
    }
    
    // Waypoint
    this.#drawWaypoint(g, w, h, z);
    
    // Player
    this.#drawPlayer(g, w, h, z);
    
    // Rival
    this.#drawRival(g, w, h, z);
  }
  
  #drawAllCircuits(g, w, h, z) {
    const toScreen = (x, y) => ({
      x: w / 2 + (x - this.centerX) * z,
      y: h / 2 + (y - this.centerY) * z
    });
    
    // If a circuit is selected, draw its route
    if (this.selectedCircuit !== null) {
      const circuit = this.circuits[this.selectedCircuit];
      const cps = circuit?.cps;
      if (cps && cps.length >= 2) {
        // Draw route lines
        g.strokeStyle = CYAN + "aa";
        g.lineWidth = 3;
        g.setLineDash([]);
        g.beginPath();
        const first = toScreen(cps[0].x, cps[0].y);
        g.moveTo(first.x, first.y);
        for (let i = 1; i < cps.length; i++) {
          const s = toScreen(cps[i].x, cps[i].y);
          g.lineTo(s.x, s.y);
        }
        g.lineTo(first.x, first.y);
        g.stroke();
        
        // Draw checkpoint markers
        cps.forEach((cp, i) => {
          const s = toScreen(cp.x, cp.y);
          const isStart = i === 0;
          const size = isStart ? 10 : 6;
          
          g.fillStyle = isStart ? CYAN : CYAN + "80";
          g.beginPath();
          g.arc(s.x, s.y, size, 0, Math.PI * 2);
          g.fill();
          
          if (!isStart) {
            g.fillStyle = "#000";
            g.font = '6px "Press Start 2P", monospace';
            g.textAlign = "center";
            g.textBaseline = "middle";
            g.fillText(String(i + 1), s.x, s.y + 1);
          }
        });
      }
    }
    
    // Draw start markers for all circuits
    this.circuits.forEach((circuit, idx) => {
      const cps = circuit.cps;
      if (!cps || cps.length === 0) return;
      
      const isSelected = idx === this.selectedCircuit;
      const start = toScreen(cps[0].x, cps[0].y);
      const size = isSelected ? 14 : 10;
      const color = isSelected ? CYAN : AMBER;
      
      // Glow
      g.fillStyle = color + "30";
      g.beginPath();
      g.arc(start.x, start.y, size + 6, 0, Math.PI * 2);
      g.fill();
      
      // Circle
      g.fillStyle = color;
      g.beginPath();
      g.arc(start.x, start.y, size, 0, Math.PI * 2);
      g.fill();
      
      // Flag icon
      g.fillStyle = "#000";
      g.fillRect(start.x - 2, start.y - 4, 2, 8);
      g.fillRect(start.x, start.y - 4, 4, 3);
      
      // Label
      g.font = `${isSelected ? 8 : 7}px "Press Start 2P", monospace`;
      g.textAlign = "left";
      g.fillStyle = "#000";
      g.fillText(circuit.label, start.x + size + 6, start.y + 3);
      g.fillStyle = color;
      g.fillText(circuit.label, start.x + size + 5, start.y + 2);
    });
  }

  #drawRoads(g, w, h, z) {
    // Use roadsById if available, otherwise fall back to overview roads
    let roadsList = [];
    if (this.world.roadsById && this.world.roadsById.size > 0) {
      roadsList = Array.from(this.world.roadsById.values());
    } else if (this.world.overview && this.world.overview.roads) {
      roadsList = this.world.overview.roads;
    }
    
    if (roadsList.length === 0) return;
    
    g.save();
    g.translate(w / 2, h / 2);
    g.scale(z, z);
    g.translate(-this.centerX, -this.centerY);
    g.lineCap = "round";
    
    const r1 = [], r2 = [], r3 = [];
    for (const road of roadsList) {
      const p = road.p;
      if (!p || p.length < 4) continue;
      const rank = road.r || 1;
      if (rank >= 3) r3.push(p);
      else if (rank === 2) r2.push(p);
      else r1.push(p);
    }
    
    // Small streets
    g.strokeStyle = "#1c1b18";
    g.lineWidth = Math.max(0.5, 1 / z);
    g.beginPath();
    for (const p of r1) {
      g.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
    }
    g.stroke();
    
    // Medium roads
    g.strokeStyle = "#2a2820";
    g.lineWidth = Math.max(1, 1.8 / z);
    g.beginPath();
    for (const p of r2) {
      g.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
    }
    g.stroke();
    
    // Main roads
    g.strokeStyle = "#3e3a30";
    g.lineWidth = Math.max(1.5, 3 / z);
    g.beginPath();
    for (const p of r3) {
      g.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
    }
    g.stroke();
    
    g.restore();
  }
  
  #drawSpeedZones(g, w, h, z) {
    // Import speed zone data
    const ZONES = [
      { x: 1600, y: -2400, radius: 50, name: "FINANCIAL" },
      { x: 1800, y: -2800, radius: 50, name: "DOWNTOWN" },
      { x: 1200, y: -2600, radius: 50, name: "CHINATOWN" },
      { x: 1500, y: -3200, radius: 50, name: "NORTH BEACH" },
      { x: 200, y: -3600, radius: 50, name: "MARINA" },
      { x: 1000, y: 200, radius: 50, name: "MISSION" },
      { x: 0, y: 400, radius: 50, name: "CASTRO" },
      { x: -800, y: 200, radius: 50, name: "HAIGHT" },
      { x: -3000, y: -500, radius: 50, name: "SUNSET" },
    ];
    
    g.save();
    g.translate(w / 2, h / 2);
    g.scale(z, z);
    g.translate(-this.centerX, -this.centerY);
    
    for (const zone of ZONES) {
      g.fillStyle = "rgba(255,200,75,0.08)";
      g.beginPath();
      g.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2);
      g.fill();
    }
    
    g.restore();
  }
  
  #drawLocations(g, w, h, z) {
    // Hide all locations during intro mission
    if (globalThis.__introActive) return;
    
    const toScreen = (x, y) => ({
      x: w / 2 + (x - this.centerX) * z,
      y: h / 2 + (y - this.centerY) * z
    });
    
    for (const loc of LOCATIONS) {
      const s = toScreen(loc.x, loc.y);
      
      // Skip if off screen
      if (s.x < -50 || s.x > w + 50 || s.y < -50 || s.y > h + 50) continue;
      
      if (loc.type === "race") {
        // Race starts - cyan diamond
        g.fillStyle = CYAN + "25";
        g.beginPath();
        g.moveTo(s.x, s.y - 10);
        g.lineTo(s.x + 8, s.y);
        g.lineTo(s.x, s.y + 10);
        g.lineTo(s.x - 8, s.y);
        g.closePath();
        g.fill();
        
        g.fillStyle = CYAN;
        g.beginPath();
        g.moveTo(s.x, s.y - 6);
        g.lineTo(s.x + 5, s.y);
        g.lineTo(s.x, s.y + 6);
        g.lineTo(s.x - 5, s.y);
        g.closePath();
        g.fill();
        
      } else if (loc.type === "safehouse") {
        // Safehouses - magenta square
        g.fillStyle = MAGENTA + "25";
        g.fillRect(s.x - 8, s.y - 8, 16, 16);
        
        g.fillStyle = MAGENTA;
        g.fillRect(s.x - 5, s.y - 5, 10, 10);
        
        g.fillStyle = "#000";
        g.fillRect(s.x - 2, s.y - 2, 4, 4);
        
      } else {
        // Landmarks - amber circle
        g.fillStyle = AMBER + "20";
        g.beginPath();
        g.arc(s.x, s.y, 8, 0, Math.PI * 2);
        g.fill();
        
        g.fillStyle = AMBER;
        g.beginPath();
        g.arc(s.x, s.y, 4, 0, Math.PI * 2);
        g.fill();
      }
      
      // Label (only when zoomed in enough)
      if (z > 0.06) {
        g.font = `5px "Press Start 2P", monospace`;
        g.textAlign = "left";
        const color = loc.type === "race" ? CYAN : loc.type === "safehouse" ? MAGENTA : AMBER;
        g.fillStyle = "#000";
        g.fillText(loc.name, s.x + 11, s.y + 2);
        g.fillStyle = color;
        g.fillText(loc.name, s.x + 10, s.y + 1);
      }
    }
  }

  #drawWaypoint(g, w, h, z) {
    const wp = this.api.getWaypoint();
    if (!wp) return;
    
    const sx = w / 2 + (wp.x - this.centerX) * z;
    const sy = h / 2 + (wp.y - this.centerY) * z;
    const pulse = 1 + 0.15 * Math.sin(performance.now() * 0.006);
    
    g.fillStyle = AMBER + "60";
    g.beginPath();
    g.arc(sx, sy, 12 * pulse, 0, Math.PI * 2);
    g.fill();
    
    g.fillStyle = AMBER;
    g.beginPath();
    g.arc(sx, sy, 6 * pulse, 0, Math.PI * 2);
    g.fill();
  }

  #drawPlayer(g, w, h, z) {
    const p = this.api.getPlayer();
    if (!p) return;
    
    const sx = w / 2 + (p.x - this.centerX) * z;
    const sy = h / 2 + (p.y - this.centerY) * z;
    
    g.save();
    g.translate(sx, sy);
    g.rotate(p.h || 0);
    
    g.fillStyle = RED;
    g.beginPath();
    g.moveTo(0, -10);
    g.lineTo(6, 8);
    g.lineTo(-6, 8);
    g.closePath();
    g.fill();
    
    g.strokeStyle = "#000";
    g.lineWidth = 1.5;
    g.stroke();
    g.restore();
  }

  #drawRival(g, w, h, z) {
    const r = this.api.getRival();
    if (!r) return;
    
    const sx = w / 2 + (r.x - this.centerX) * z;
    const sy = h / 2 + (r.y - this.centerY) * z;
    
    g.save();
    g.translate(sx, sy);
    g.rotate(r.h || 0);
    
    g.fillStyle = MAGENTA;
    g.beginPath();
    g.moveTo(0, -8);
    g.lineTo(5, 6);
    g.lineTo(-5, 6);
    g.closePath();
    g.fill();
    
    g.strokeStyle = "#000";
    g.lineWidth = 1;
    g.stroke();
    g.restore();
  }

  #screenToWorld(mx, my) {
    return {
      x: this.centerX + (mx - this.w / 2) / this.zoom,
      y: this.centerY + (my - this.h / 2) / this.zoom
    };
  }

  #onDown(e) {
    const r = this.canvas.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    
    this.drag = { 
      x: e.clientX, y: e.clientY, 
      startCX: this.centerX, startCY: this.centerY,
      moved: false
    };
    this.el.classList.add("city-map--dragging");
    this.canvas.setPointerCapture(e.pointerId);
  }

  #onMove(e) {
    if (!this.drag) return;
    
    const dx = e.clientX - this.drag.x;
    const dy = e.clientY - this.drag.y;
    
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      this.drag.moved = true;
    }
    
    this.centerX = this.drag.startCX - dx / this.zoom;
    this.centerY = this.drag.startCY - dy / this.zoom;
  }

  #onUp(e) {
    this.el.classList.remove("city-map--dragging");
    
    const r = this.canvas.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const world = this.#screenToWorld(mx, my);
    
    const wasDrag = this.drag?.moved;
    
    if (!wasDrag) {
      const now = performance.now();
      const isDoubleClick = this.lastClickTime && now - this.lastClickTime < 350;
      
      if (this.mode === "races") {
        // Races mode - click on circuits
        const circuitIdx = this.#findCircuitAt(mx, my);
        if (circuitIdx >= 0) {
          this.selectedCircuit = circuitIdx;
          const circuit = this.circuits[circuitIdx];
          this.#showPopup(circuit.label, `${circuit.cps.length} checkpoints`);
          // Zoom to circuit
          this.#zoomToCircuit(circuit);
        } else {
          this.#hidePopup();
          this.selectedCircuit = null;
        }
      } else {
        // Navigate mode
        const loc = this.#findLocationAt(mx, my);
        if (loc) {
          if (isDoubleClick) {
            // Double click - teleport
            this.api.teleport(loc.x, loc.y);
            this.close();
          } else {
            // Single click - zoom to location
            this.#zoomToPoint(loc.x, loc.y, 0.25);
          }
        } else {
          if (isDoubleClick) {
            // Double click on empty - teleport
            this.api.teleport(world.x, world.y);
            this.close();
          } else {
            // Single click on empty - set waypoint
            this.api.setWaypoint({ x: world.x, y: world.y });
          }
        }
      }
      this.lastClickTime = now;
    }
    
    this.drag = null;
  }
  
  #findLocationAt(mx, my) {
    for (const loc of LOCATIONS) {
      const sx = this.w / 2 + (loc.x - this.centerX) * this.zoom;
      const sy = this.h / 2 + (loc.y - this.centerY) * this.zoom;
      if (Math.hypot(mx - sx, my - sy) < 20) return loc;
    }
    return null;
  }
  
  #findCircuitAt(mx, my) {
    for (let i = 0; i < this.circuits.length; i++) {
      const cps = this.circuits[i].cps;
      if (!cps || cps.length === 0) continue;
      // Check start point
      const start = cps[0];
      const sx = this.w / 2 + (start.x - this.centerX) * this.zoom;
      const sy = this.h / 2 + (start.y - this.centerY) * this.zoom;
      if (Math.hypot(mx - sx, my - sy) < 25) return i;
    }
    return -1;
  }
  
  #zoomToPoint(x, y, targetZoom = 0.2) {
    this.centerX = x;
    this.centerY = y;
    this.zoom = Math.max(this.zoom, targetZoom);
  }
  
  #zoomToCircuit(circuit) {
    const cps = circuit.cps;
    if (!cps || cps.length === 0) return;
    // Center on first checkpoint
    let cx = 0, cy = 0;
    for (const cp of cps) { cx += cp.x; cy += cp.y; }
    this.centerX = cx / cps.length;
    this.centerY = cy / cps.length;
    // Zoom to fit circuit
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const cp of cps) {
      minX = Math.min(minX, cp.x); maxX = Math.max(maxX, cp.x);
      minY = Math.min(minY, cp.y); maxY = Math.max(maxY, cp.y);
    }
    const zx = (this.w * 0.6) / (maxX - minX || 1);
    const zy = (this.h * 0.6) / (maxY - minY || 1);
    this.zoom = Math.min(zx, zy, 0.3);
  }

  #onWheel(e) {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    this.zoom = Math.max(0.02, Math.min(2, this.zoom * factor));
  }

  #loadCircuits() {
    // Load built-in circuits from world data
    return (this.world.circuits || []).map(c => ({ ...c }));
  }
}
