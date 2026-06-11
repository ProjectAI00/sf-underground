import { loadWorld } from "./world.js";
import { Renderer } from "./render.js";
import { Car } from "./car.js";
import { Traffic } from "./traffic.js";
import { Race } from "./race.js";
import { Props } from "./props.js";
import { Peds } from "./peds.js";
import { Menu } from "./menu.js";
import { Radar } from "./radar.js";
import { getLight, applyLight } from "./daynight.js";
import { CARS, carById, physFor, makeCarSpriteFor } from "./cars.js";
import { Lobby } from "./lobby.js";
import { CityMap } from "./map.js";
import { MISSIONS, campaignProgress, markBeaten } from "./campaign.js";
import { Rival } from "./rival.js";
import { Radio } from "./radio.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const ui = {
  speedo: document.querySelector("#speedo .kmh"),
  street: document.getElementById("street"),
  racehud: document.getElementById("racehud"),
  msg: document.getElementById("msg"),
  clock: document.getElementById("clock"),
  fps: document.getElementById("fps"),
};

function resize() {
  const scale = Math.min(1, 1600 / window.innerWidth);
  canvas.width = Math.round(window.innerWidth * scale);
  canvas.height = Math.round(window.innerHeight * scale);
}
window.addEventListener("resize", resize);
resize();

const input = { up: false, down: false, left: false, right: false, brake: false };
const KEYS = {
  ArrowUp: "up", KeyW: "up",
  ArrowDown: "down", KeyS: "down",
  ArrowLeft: "left", KeyA: "left",
  ArrowRight: "right", KeyD: "right",
  Space: "brake",
};

let state = "boot"; // boot | lobby | menu | roam | race | paused
let camRotate = true;
let world, renderer, car, traffic, race, radar, props, peds, menu, lobby, cityMap;
const radio = new Radio();
let waypoint = null;
let rival = null, mission = null;
let camRot = 0, camZoom = 7.0;
let shakeT = 0;
let frame = 0;
let profile = null;
try { profile = JSON.parse(localStorage.getItem("sfracer_profile") || "null"); } catch { /* fresh start */ }
let fpsVisible = false, fpsFrames = 0, fpsLast = performance.now();
let timeOverrideIdx = 0; // 0=real, then forced hours for N key
const TIME_OVERRIDES = [null, 22.5, 20.2, 6.8];

window.__game = () => ({ world, car, props, traffic, peds, race, rival, cityMap, waypoint });
window.__go = {
  race: (id) => startRace(id || world.circuits[0].id),
  roam: () => { lobby.hide(); freeRoam(); },
  campaign: (i) => { lobby.hide(); menu.hide(); startCampaign(i ?? 0); },
  wp: (x, y) => { waypoint = x == null ? null : { x, y }; },
};
window.__dbg = () => ({
  state,
  input: { ...input },
  car: car && { x: car.x, y: car.y, vx: car.vx, vy: car.vy, h: car.h },
  race: race && { state: race.state, cp: race.cpIndex, n: race.checkpoints.length, time: race.time },
  chunks: world && [...world.chunkState.values()].filter((s) => s === "loaded").length,
});

window.addEventListener("keydown", (e) => {
  if (lobby && lobby.visible && lobby.handleKey(e)) return;
  if (cityMap && cityMap.visible && cityMap.handleKey(e)) { e.preventDefault(); return; }
  if (menu && menu.handleKey(e)) { e.preventDefault(); return; }
  if (e.code === "KeyM" && cityMap && (state === "roam" || state === "race" || state === "paused")) {
    cityMap.toggle();
    e.preventDefault();
    return;
  }
  if (state !== "lobby" && radio.handleKey(e)) { e.preventDefault(); return; }
  if (e.code === "KeyF") {
    fpsVisible = !fpsVisible;
    ui.fps.style.display = fpsVisible ? "block" : "none";
  }
  if (KEYS[e.code] !== undefined) {
    input[KEYS[e.code]] = true;
    e.preventDefault();
  }
  if (!world || state === "boot" || state === "lobby" || state === "menu") return;

  if (e.code === "Escape") {
    state = "paused";
    menu.showPause({ inRace: race.state === "running" || race.state === "countdown" });
    return;
  }
  if (e.code === "KeyC") camRotate = !camRotate;
  if (e.code === "KeyR") car.resetToRoad();
  if (e.code === "KeyN") {
    timeOverrideIdx = (timeOverrideIdx + 1) % TIME_OVERRIDES.length;
    globalThis.__forceHour = TIME_OVERRIDES[timeOverrideIdx] ?? undefined;
    const labels = ["REAL SF TIME", "NIGHT", "DUSK", "DAWN"];
    showMsg(labels[timeOverrideIdx], 900, "#4be0c8");
  }
});
window.addEventListener("keyup", (e) => {
  if (KEYS[e.code] !== undefined) input[KEYS[e.code]] = false;
});

let msgTimer = null;
function showMsg(text, ms = 1500, color = "#ffc24b") {
  ui.msg.textContent = text;
  ui.msg.style.color = color;
  ui.msg.style.display = "block";
  clearTimeout(msgTimer);
  if (ms > 0) msgTimer = setTimeout(() => (ui.msg.style.display = "none"), ms);
}

function fmtTime(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t * 100) % 100);
  return `${m}:${String(s).padStart(2, "0")}.${String(ms).padStart(2, "0")}`;
}

function startRace(circuitId) {
  const circuit = world.circuits.find((c) => c.id === circuitId);
  if (!circuit || !circuit.cps.length) return;
  rival = null; mission = null;
  race.start(circuit, car);
  state = "race";
  menu.hide();
  showMsg("GET READY", 1000);
}

function startCampaign(idx) {
  mission = MISSIONS[idx];
  const circuit = world.circuits.find((c) => c.id === mission.circuit) || world.circuits[0];
  if (!circuit || !circuit.cps.length) return;
  race.start(circuit, car);
  rival = new Rival(world, mission, circuit);
  rival.start();
  state = "race";
  menu.hide();
  showMsg(`${mission.name}: "${mission.taunt}"`, 2600, "#ff8c3c");
}

function freeRoam() {
  race.stop();
  state = "roam";
  menu.hide();
}

function applyProfile() {
  if (!profile || !car) return;
  const def = carById(profile.carId);
  car.phys = physFor(def);
  car.sprite = makeCarSpriteFor(def);
}

async function init() {
  world = await loadWorld();
  renderer = new Renderer(world, canvas);
  race = new Race(world);
  props = new Props(world);
  world.onChunk((cx, cy, chunk) => props.addChunk(cx, cy, chunk));
  traffic = new Traffic(world);
  peds = new Peds(world);
  radar = new Radar(world, document.getElementById("minimap"));

  menu = new Menu({
    circuits: world.circuits.map((c) => ({ id: c.id, label: c.label })),
    getBest: (id) => Race.getBest(id),
    campaign: { missions: MISSIONS, getProgress: campaignProgress },
    onStartRace: (id) => startRace(id),
    onStartCampaign: (idx) => startCampaign(idx),
    onFreeRoam: () => freeRoam(),
    onResume: () => { state = race.circuit ? "race" : "roam"; menu.hide(); },
    onRestartRace: () => {
      if (mission) startCampaign(mission.id);
      else if (race.circuit) startRace(race.circuit.id);
    },
    onQuitToMenu: () => { race.stop(); rival = null; mission = null; state = "menu"; menu.showMain({ loading: false }); },
  });

  cityMap = new CityMap(world, {
    getPlayer: () => ({ x: car.x, y: car.y, h: car.h }),
    getWaypoint: () => waypoint,
    setWaypoint: (wp) => { waypoint = wp; },
    getRival: () => (rival ? { x: rival.x, y: rival.y, name: rival.mission.name } : null),
  });
  document.getElementById("minimap").style.cursor = "pointer";
  document.getElementById("minimap").addEventListener("click", () => {
    if (state === "roam" || state === "race" || state === "paused") cityMap.toggle();
  });

  lobby = new Lobby({
    cars: CARS,
    drawPreview: (canvas, carId) => {
      const g = canvas.getContext("2d");
      g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, canvas.width, canvas.height);
      const spr = makeCarSpriteFor(carById(carId), 4);
      const s = Math.min(canvas.width / spr.width, canvas.height / spr.height) * 0.8;
      g.drawImage(spr, (canvas.width - spr.width * s) / 2, (canvas.height - spr.height * s) / 2,
        spr.width * s, spr.height * s);
    },
    profile,
    onComplete: (p) => {
      profile = p;
      localStorage.setItem("sfracer_profile", JSON.stringify(p));
      applyProfile();
      lobby.hide();
      state = "menu";
      menu.showMain({ loading: false });
    },
  });
  menu.showMain({ loading: true });

  // spawn at the first circuit's start (Grant Avenue, Chinatown)
  const s = world.circuits[0]?.cps[0] || { x: 0, y: 0, tx: 1, ty: 0 };
  car = new Car(world, s.x, s.y, Math.atan2(s.ty, s.tx));
  applyProfile();
  world.update(car.x, car.y);

  state = "boot";
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    tick(dt, now);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

function drawHeadlights(c) {
  const fx = Math.cos(c.h), fy = Math.sin(c.h);
  const rx = -fy * 0.8, ry = fx * 0.8;
  ctx.fillStyle = "rgba(255,240,190,0.22)";
  for (const s of [-1, 1]) {
    const bx = c.x + fx * 2 + rx * s, by = c.y + fy * 2 + ry * s;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + fx * 13 + rx * s * 3.4, by + fy * 13 + ry * s * 3.4);
    ctx.lineTo(bx + fx * 13 - rx * s * 1.2, by + fy * 13 - ry * s * 1.2);
    ctx.closePath();
    ctx.fill();
  }
}

function tick(dt, now) {
  frame++;
  world.update(car.x, car.y);

  if (state === "boot") {
    if (world.ready(car.x, car.y, 350)) {
      menu.hide();
      state = "lobby";
      lobby.show();
    }
  }

  const light = getLight();
  const paused = state === "paused" || state === "menu" || state === "boot" || state === "lobby";
  const racing = state === "race";
  const frozen = racing && race.state === "countdown";

  if (!paused) {
    const liveInput = frozen ? { up: false, down: false, left: false, right: false, brake: false } : input;
    car.update(dt, liveInput);
    traffic.update(dt, car);
    peds.update(dt, car);
    props.knockCheck(car, dt);

    if (racing) {
      const ev = race.update(dt, car);
      if (ev?.type === "checkpoint") showMsg("CHECKPOINT", 700, "#4be0c8");
      if (ev?.type === "go") showMsg("GO!", 800, "#4be0c8");
      if (ev?.type === "finish") {
        if (rival && mission) {
          if (rival.finished) {
            showMsg(`${mission.name} ALREADY FINISHED — REMATCH?`, 4000, "#ff4f5e");
          } else {
            markBeaten(mission.id);
            const done = campaignProgress() >= MISSIONS.length;
            showMsg(done ? "CAMPAIGN COMPLETE. TECH HAS FALLEN." : `YOU BEAT ${mission.name}!  ${fmtTime(race.time)}`, 5000, "#4be0c8");
          }
          rival = null; mission = null;
        } else {
          showMsg(ev.isBest ? `NEW RECORD  ${fmtTime(race.time)}` : `FINISH  ${fmtTime(race.time)}`, 4000);
        }
        state = "roam";
      }
      if (race.state === "countdown") {
        const n = Math.ceil(race.countdown);
        showMsg(race.countdown > 3 ? "GET READY" : String(Math.max(1, n)), 0, "#ffc24b");
      }

      if (rival && race.state === "running") {
        const t = race.target();
        const playerProg = t ? { cp: race.cpIndex, dist: Math.hypot(t.x - car.x, t.y - car.y) } : null;
        rival.update(dt, car, playerProg);
        if (rival.finished && mission) {
          showMsg(`${mission.name} WINS. "${mission.taunt}"`, 5000, "#ff4f5e");
          race.stop();
          rival = null; mission = null;
          state = "roam";
        }
      }
    }
  }

  // camera
  const targetRot = camRotate ? car.h + Math.PI / 2 : 0;
  let dr = targetRot - camRot;
  while (dr > Math.PI) dr -= 2 * Math.PI;
  while (dr < -Math.PI) dr += 2 * Math.PI;
  camRot += dr * Math.min(1, 3.2 * dt);
  const targetZoom = 7.2 - Math.min(3.0, car.speed() / 21);
  camZoom += (targetZoom - camZoom) * Math.min(1, 1.8 * dt);
  if (car.crashT > 0.2) shakeT = 0.25;
  if (car.bumpT > 0.08) shakeT = Math.max(shakeT, 0.08);
  shakeT = Math.max(0, shakeT - dt);

  const lookAhead = Math.min(26, car.speed() * 0.5);
  const lookX = Math.cos(car.h) * lookAhead;
  const lookY = Math.sin(car.h) * lookAhead;
  const shake = shakeT > 0 ? shakeT * 4 : 0;
  const cam = {
    x: car.x + lookX + (Math.random() - 0.5) * shake,
    y: car.y + lookY + (Math.random() - 0.5) * shake,
    zoom: camZoom * (canvas.width / 1600),
    rot: camRot,
  };

  // --- draw ---
  renderer.drawWorld(cam);
  car.drawSkids(ctx);
  if (racing) race.drawWorld(ctx, frame);
  const viewR = Math.hypot(canvas.width, canvas.height) / 2 / cam.zoom;
  if (light.headlights) drawHeadlights(car);
  traffic.draw(ctx, cam.x, cam.y, viewR, light);
  peds.draw(ctx, cam.x, cam.y, viewR);
  if (rival) rival.draw(ctx, cam.x, cam.y, viewR);
  car.draw(ctx);
  car.drawFx(ctx);
  renderer.drawBuildings(cam, viewR + 30);
  props.draw(ctx, cam, viewR + 10, now / 1000, light);
  renderer.end();

  applyLight(ctx, canvas, light);

  if (racing && race.state === "running") race.drawArrow(ctx, canvas, car, camRot);

  // waypoint guidance (amber, below the race arrow)
  if (waypoint && !paused) {
    const wd = Math.hypot(waypoint.x - car.x, waypoint.y - car.y);
    if (wd < 30) {
      showMsg("YOU HAVE ARRIVED", 1200, "#ffc24b");
      waypoint = null;
    } else {
      const ang = Math.atan2(waypoint.y - car.y, waypoint.x - car.x) - camRot;
      const wx = canvas.width / 2, wy = racing ? 150 : 86;
      ctx.save();
      ctx.translate(wx, wy);
      ctx.rotate(ang + Math.PI / 2);
      ctx.fillStyle = "#ffc24b";
      ctx.strokeStyle = "#3a3020";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(0, -15);
      ctx.lineTo(10, 9);
      ctx.lineTo(0, 3);
      ctx.lineTo(-10, 9);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      ctx.font = '9px "Press Start 2P", monospace';
      ctx.textAlign = "center";
      ctx.fillStyle = "#ffc24b";
      ctx.fillText(wd >= 1000 ? (wd / 1000).toFixed(1) + "km" : Math.round(wd) + "m", wx, wy + 26);
    }
  }

  // --- HUD ---
  ui.speedo.textContent = car.kmh();
  const near = world.nearestRoad(car.x, car.y, 60);
  ui.street.textContent = near && near.road.n ? near.road.n.toUpperCase() : "";
  ui.clock.textContent = profile ? `${profile.tag} · SF ${light.clock}` : `SF ${light.clock}`;

  fpsFrames++;
  const fnow = performance.now();
  if (fnow - fpsLast >= 500) {
    if (fpsVisible) ui.fps.textContent = Math.round(fpsFrames / ((fnow - fpsLast) / 1000)) + " FPS";
    fpsFrames = 0;
    fpsLast = fnow;
  }
  if (racing) {
    const total = race.checkpoints.length;
    const cp = Math.min(race.cpIndex, total);
    let posLine = `<span class="dim">BEST ${race.best ? fmtTime(race.best) : "--:--"}</span>`;
    if (rival) {
      const rp = rival.progress();
      const t = race.target();
      const myDist = t ? Math.hypot(t.x - car.x, t.y - car.y) : 0;
      const ahead = race.cpIndex > rp.cp || (race.cpIndex === rp.cp && myDist < rp.dist);
      posLine = `<span style="color:${ahead ? "#4be0c8" : "#ff4f5e"}">POS ${ahead ? 1 : 2}/2</span> ` +
        `<span class="dim">VS ${rival.mission.name}</span>`;
    }
    ui.racehud.innerHTML =
      `<span class="big">${fmtTime(race.time)}</span><br>` +
      `<span>CP ${cp}/${total}</span><br>` + posLine;
  } else if (state === "roam") {
    ui.racehud.innerHTML = `<span class="dim">FREE ROAM &mdash; ESC FOR MENU</span>`;
  } else {
    ui.racehud.innerHTML = "";
  }

  radar.draw(car, race, camRot, waypoint, rival);
}

init();
