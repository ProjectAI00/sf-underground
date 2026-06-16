import { loadWorld } from "./world.js";
import { Renderer } from "./render.js";
import { Car, drawHeadlightBeams } from "./car.js";
import { Traffic } from "./traffic.js";
import { Race } from "./race.js";
import { Props } from "./props.js";
import { Peds } from "./peds.js";
import { Menu } from "./menu.js";
import { Radar } from "./radar.js";
import { getLight, applyLight } from "./daynight.js";
import { updateWeather, applyWeather, cycleWeather, getWeather, setAutoWeather } from "./weather.js";
import { CARS, carById, physFor, makeCarSpriteFor } from "./cars.js";
import { preloadAllCarSprites } from "./car-sprites.js";
import { Lobby } from "./lobby.js";
import { CityMap } from "./map.js";
import { Radio } from "./radio.js";
import { Multiplayer, makeRoomCode } from "./multiplayer.js";
import { RemotePlayers } from "./remote-players.js";
import { elevOffset } from "./terrain.js";
import { isDeepWater } from "./water.js";
import { Police } from "./police.js";
import { SpeedZones } from "./speedzone.js";
import { Intro, introComplete, resetIntro } from "./intro.js";

// ?tutorial forces intro replay
if (new URLSearchParams(window.location.search).has("tutorial")) {
  resetIntro();
}

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const menuBgCanvas = document.getElementById("menu-bg");
const menuBgCtx = menuBgCanvas.getContext("2d");
const ui = {
  speedo: document.querySelector("#speedo .kmh"),
  street: document.getElementById("street"),
  racehud: document.getElementById("racehud"),
  msg: document.getElementById("msg"),
  clock: document.getElementById("clock"),
  fps: document.getElementById("fps"),
  wanted: document.getElementById("wanted"),
  speedwarn: document.getElementById("speedwarn"),
  bustedBar: document.getElementById("busted-bar"),
  bustedFill: document.getElementById("busted-bar-fill"),
  bustedText: document.getElementById("busted-text"),
};

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  menuBgCanvas.width = Math.round(window.innerWidth * 0.5);
  menuBgCanvas.height = Math.round(window.innerHeight * 0.5);
}
window.addEventListener("resize", resize);
resize();

// Menu background flyover state
const menuFlyover = {
  x: -122.42 * 10000, // Start near downtown SF
  y: 37.78 * 10000,
  angle: 0,
  speed: 15, // m/s
};

const input = { up: false, down: false, left: false, right: false, brake: false };
const KEYS = {
  ArrowUp: "up", KeyW: "up",
  ArrowDown: "down", KeyS: "down",
  ArrowLeft: "left", KeyA: "left",
  ArrowRight: "right", KeyD: "right",
  Space: "brake",
};

let state = "boot"; // boot | intro | lobby | menu | roam | paused
let camRotate = true;
let world, renderer, car, traffic, race, radar, props, peds, menu, lobby, cityMap, police, speedZones, intro;
const radio = new Radio();
globalThis.__radio = radio;
let mp = null;
let remotePlayers = null;
let mpRoom = null;
let waypoint = null;
let camRot = 0, camZoom = 7.0;
let shakeT = 0;
let camLift = 0; // Camera pull-back on acceleration
let prevSpeed = 0; // For detecting acceleration
let flyMode = false, flyCam = { x: 0, y: 0, zoom: 3 };
let frame = 0;
let profile = null;
// Don't auto-fill profile - start fresh each time (but keep car selection etc)
try { 
  const saved = JSON.parse(localStorage.getItem("sfracer_profile") || "null");
  if (saved) {
    profile = { ...saved, tag: "" }; // Clear the name but keep other settings
  }
} catch { /* fresh start */ }
let fpsVisible = false, fpsFrames = 0, fpsLast = performance.now();
let timeOverrideIdx = 0; // 0=auto, 1=real, then forced hours for N key
const TIME_OVERRIDES = ["auto", null, 22.5, 20.2, 6.8, 12, 7];
const TIME_LABELS = ["AUTO TIME", "REAL SF TIME", "NIGHT", "DUSK", "DAWN", "NOON", "GOLDEN HOUR"];
globalThis.__forceHour = null; // Start with auto
let autoTimeHour = 6; // Start at dawn for auto mode
let autoTimeSpeed = 0.5; // Hours per real minute (30 min = full day cycle)

window.__game = () => ({ world, car, props, traffic, peds, race, cityMap, waypoint, mp, remotePlayers, police, speedZones, intro });
window.__go = {
  roam: () => { lobby.hide(); startFreeRoam(); },
  mp: (room) => { lobby.hide(); startMultiplayer(room || makeRoomCode()); },
  wp: (x, y) => { waypoint = x == null ? null : { x, y }; },
};
window.__resetIntro = resetIntro; // For testing: call __resetIntro() in console to replay intro
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
  if (e.code === "KeyM" && cityMap && (state === "roam" || state === "paused")) {
    cityMap.toggle();
    e.preventDefault();
    return;
  }
  if (state !== "lobby" && radio.handleKey(e)) { e.preventDefault(); return; }
  if (e.code === "KeyF") {
    fpsVisible = !fpsVisible;
    ui.fps.style.display = fpsVisible ? "block" : "none";
  }
  // Don't intercept game controls when typing in lobby input
  if (KEYS[e.code] !== undefined && !(lobby?.visible && document.activeElement?.tagName === "INPUT")) {
    input[KEYS[e.code]] = true;
    e.preventDefault();
  }
  if (!world || state === "boot" || state === "lobby" || state === "menu") return;

  if (e.code === "Escape") {
    state = "paused";
    menu.showPause({ inMultiplayer: Boolean(mp?.connected) });
    return;
  }
  if (e.code === "KeyC") camRotate = !camRotate;
  if (e.code === "KeyR") car.resetToRoad();
  if (e.code === "KeyN") {
    timeOverrideIdx = (timeOverrideIdx + 1) % TIME_OVERRIDES.length;
    const setting = TIME_OVERRIDES[timeOverrideIdx];
    if (setting === "auto") {
      globalThis.__forceHour = autoTimeHour; // Use auto cycling time
    } else if (setting === null) {
      globalThis.__forceHour = null; // Real SF time
    } else {
      globalThis.__forceHour = setting; // Fixed time
    }
    showMsg(TIME_LABELS[timeOverrideIdx], 900, "#4be0c8");
  }
  if (e.code === "KeyV") {
    flyMode = !flyMode;
    if (flyMode) {
      flyCam = { x: car.x, y: car.y, zoom: 3 };
      showMsg("FLY CAM - WASD/SCROLL", 1500, "#ff9040");
    } else {
      showMsg("NORMAL CAM", 900, "#4be0c8");
    }
  }
  if (e.code === "KeyG") {
    const weather = getWeather();
    if (weather.auto) {
      // Currently auto - switch to manual cycling
      const newWeather = cycleWeather();
      const weatherLabels = { clear: "CLEAR", sunny: "SUNNY", cloudy: "CLOUDY", overcast: "OVERCAST", foggy: "FOGGY", rainy: "RAINY", storm: "STORM" };
      showMsg(weatherLabels[newWeather] || newWeather.toUpperCase(), 900, "#7eb8da");
    } else {
      // Currently manual - cycle through, then back to auto
      const newWeather = cycleWeather();
      if (newWeather === "clear") {
        // Wrapped around - enable auto
        setAutoWeather(true);
        showMsg("AUTO WEATHER", 900, "#7eb8da");
      } else {
        const weatherLabels = { clear: "CLEAR", sunny: "SUNNY", cloudy: "CLOUDY", overcast: "OVERCAST", foggy: "FOGGY", rainy: "RAINY", storm: "STORM" };
        showMsg(weatherLabels[newWeather] || newWeather.toUpperCase(), 900, "#7eb8da");
      }
    }
  }
});
window.addEventListener("keyup", (e) => {
  if (KEYS[e.code] !== undefined) input[KEYS[e.code]] = false;
});

// Fly cam scroll zoom
window.addEventListener("wheel", (e) => {
  if (flyMode) {
    flyCam.zoom *= e.deltaY > 0 ? 0.85 : 1.18;
    flyCam.zoom = Math.max(0.3, Math.min(10, flyCam.zoom));
    e.preventDefault();
  }
}, { passive: false });

let msgTimer = null;
function showMsg(text, ms = 1500, color = "#ffc24b") {
  clearTimeout(msgTimer);
  ui.msg.style.display = "none";
  ui.msg.textContent = "";
  // Force reflow to clear any rendering artifacts
  void ui.msg.offsetWidth;
  ui.msg.textContent = text;
  ui.msg.style.color = color;
  ui.msg.style.display = "block";
  if (ms > 0) msgTimer = setTimeout(() => {
    ui.msg.style.display = "none";
    ui.msg.textContent = "";
  }, ms);
}

function leaveMultiplayer() {
  if (mp) mp.disconnect();
  mpRoom = null;
  if (remotePlayers) remotePlayers.clear();
  menu.hide();
  state = "roam";
  showMsg("LEFT ROOM", 1200, "#ffc24b");
}

function startFreeRoam() {
  if (mp) mp.disconnect();
  mpRoom = null;
  if (remotePlayers) remotePlayers.clear();
  race.stop();
  menu.hide();
  
  const forceTutorial = window.location.search.includes("tutorial");
  if (forceTutorial || !introComplete()) {
    // Need to play intro first
    state = "intro";
    intro.start(car);
  } else {
    // Intro done, go to lobby
    state = "lobby";
    lobby.show();
  }
}

function handleBusted() {
  showMsg("BUSTED", 2500, "#ff4f5e");
  
  // Stop the car
  car.vx = 0;
  car.vy = 0;
  
  // Reset wanted level and boxed timer
  police.setWanted(0);
  police.resetBoxed();
  
  if (race.state === "racing") {
    // In a race - lose the race
    race.stop();
    showMsg("BUSTED - RACE LOST", 3000, "#ff4f5e");
  } else if (mpRoom) {
    // In multiplayer - temporarily kicked, respawn after delay
    showMsg("BUSTED - RESPAWNING...", 2500, "#ff4f5e");
    setTimeout(() => {
      // Respawn at a random location away from cops
      const angle = Math.random() * Math.PI * 2;
      const dist = 300 + Math.random() * 200;
      car.x += Math.cos(angle) * dist;
      car.y += Math.sin(angle) * dist;
      car.resetToRoad();
      showMsg("BACK IN ACTION", 1500, "#4be0c8");
    }, 3000);
  } else {
    // Free roam - respawn elsewhere
    setTimeout(() => {
      const angle = Math.random() * Math.PI * 2;
      const dist = 400 + Math.random() * 300;
      car.x += Math.cos(angle) * dist;
      car.y += Math.sin(angle) * dist;
      car.resetToRoad();
      showMsg("RELEASED", 1200, "#4be0c8");
    }, 2500);
  }
}

function handleWaterDeath() {
  showMsg("YOU SANK", 2000, "#4be0c8");
  car.vx = 0;
  car.vy = 0;
  
  setTimeout(() => {
    car.resetToRoad();
  }, 1500);
}

function startMultiplayer(roomCode) {
  const room = roomCode || makeRoomCode();
  if (mp) mp.disconnect();
  if (remotePlayers) remotePlayers.clear();

  // Multiplayer always uses real SF time and weather
  timeOverrideIdx = 0;
  globalThis.__forceHour = null;
  globalThis.__weather?.set("clear");

  race.stop();
  state = "roam";
  menu.hide();
  mpRoom = room;
  radio.playSessionPlaylist().catch(() => {});

  mp.connect(room, profile, { x: car.x, y: car.y, h: car.h });
  showMsg(`JOINING ${room}...`, 0, "#4be0c8");
}

function applyProfile() {
  if (!profile || !car) return;
  const def = carById(profile.carId);
  car.phys = physFor(def);
  car.sprite = makeCarSpriteFor(def);
  if (police) police.setPlayerTier(def.tier);
}

function hasValidProfile(p) {
  const tag = String(p?.tag || "").replace(/^@+/, "");
  return Boolean(p?.carId && tag.length >= 2);
}

async function init() {
  try {

  
  world = await loadWorld();
  renderer = new Renderer(world, canvas);
  race = new Race(world);
  props = new Props(world);
  world.onChunk((cx, cy, chunk) => props.addChunk(cx, cy, chunk));
  traffic = new Traffic(world);
  peds = new Peds(world);
  police = new Police(world);
  speedZones = new SpeedZones();
  radar = new Radar(world, document.getElementById("minimap"));

  remotePlayers = new RemotePlayers();
  mp = new Multiplayer({
    onWelcome: (msg) => {
      remotePlayers.setSelfId(msg.id);
      showMsg(`ROOM ${msg.room} · ${msg.roomCount} IN LOBBY`, 2200, "#4be0c8");
    },
    onSnapshot: (players) => remotePlayers.applySnapshot(players),
    onError: (msg) => {
      showMsg(msg, 3000, "#ff4f5e");
      if (!mp.connected) {
        mpRoom = null;
        state = "menu";
        menu.showMultiplayer();
      }
    },
    onDisconnect: () => {
      if (state === "roam" && mpRoom) {
        showMsg("DISCONNECTED FROM ROOM", 2500, "#ff4f5e");
        mpRoom = null;
        remotePlayers.clear();
      }
    },
  });

  menu = new Menu({
    onFreeRoam: () => startFreeRoam(),
    onMultiplayer: (room) => startMultiplayer(room || makeRoomCode()),
    onResume: () => { state = "roam"; menu.hide(); },
    onLeaveMultiplayer: () => leaveMultiplayer(),
    onQuitToMenu: () => {
      if (mp) mp.disconnect();
      mpRoom = null;
      if (remotePlayers) remotePlayers.clear();
      race.stop();
      state = "menu";
      menu.showMain({ loading: false });
    },
  });

  cityMap = new CityMap(world, {
    getPlayer: () => ({ x: car.x, y: car.y, h: car.h }),
    getWaypoint: () => waypoint,
    setWaypoint: (wp) => { waypoint = wp; },
    teleport: (x, y) => {
      car.x = x;
      car.y = y;
      car.vx = 0;
      car.vy = 0;
      showMsg("TELEPORTED", 800, "#4be0c8");
    },
    getRival: () => null,
  });
  document.getElementById("minimap").style.cursor = "pointer";
  document.getElementById("minimap").addEventListener("click", () => {
    const introWithControl = state === "intro" && intro?.hasPlayerControl();
    if (state === "roam" || state === "paused" || introWithControl) cityMap.toggle();
  });

  lobby = new Lobby({
    cars: CARS,
    profile,
    onComplete: (p) => {
      profile = p;
      localStorage.setItem("sfracer_profile", JSON.stringify(p));
      applyProfile();
      lobby.hide();
      state = "roam";
      radio.playSessionPlaylist().catch(() => {});
    },
  });
  preloadAllCarSprites(CARS.map((c) => c.id));
  menu.showMain({ loading: true });

  // Random spawn from interesting locations around SF
  const SPAWNS = [
    { x: 2647, y: -3340, h: -1.57 },  // Chinatown
    { x: 1660, y: -3605, h: 0 },       // Lombard Street
    { x: 3880, y: -2885, h: 1.57 },    // Ferry Building
    { x: 2645, y: -2035, h: 0 },       // Union Square
    { x: -400, y: -126, h: 3.14 },     // Haight
    { x: 1350, y: 830, h: 0 },         // Mission
    { x: 2800, y: -680, h: 1.57 },     // SOMA
    { x: -350, y: -3950, h: 0 },       // Marina
  ];
  // If intro will play, spawn at intro scene location so world loads there
  const forceTutorial = window.location.search.includes("tutorial");
  const willPlayIntro = forceTutorial || !introComplete();
  const s = willPlayIntro ? { x: 911, y: 2200, h: 3.064 } : SPAWNS[Math.floor(Math.random() * SPAWNS.length)];
  car = new Car(world, s.x, s.y, s.h);
  applyProfile();
  world.update(car.x, car.y);

  // Initialize intro system
  intro = new Intro(world, canvas);

  state = "boot";
  let last = performance.now();
  let errorCount = 0;
  let frameBudget = 0;
  const TARGET_FPS = 60;
  const FRAME_TIME = 1000 / TARGET_FPS;
  
  function loop(now) {
    try {
      const elapsed = now - last;
      // Skip frame if we're way behind (> 100ms) to catch up
      if (elapsed > 100) {
        last = now - FRAME_TIME;
      }
      const dt = Math.min(0.033, elapsed / 1000); // cap at ~30fps equivalent dt
      last = now;
      tick(dt, now);
    } catch (err) {
      errorCount++;
      console.error("Game loop error:", err);
      if (errorCount > 10) {
        console.error("Too many errors, stopping game loop");
        return;
      }
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  } catch (err) {
    console.error("Retro Racer SF failed to start:", err);
    const fail = document.createElement("div");
    fail.style.cssText = "position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;padding:24px;background:#0a0a0e;color:#ff4f5e;font:12px/1.8 'Press Start 2P',monospace;text-align:center";
    fail.innerHTML = `<div><div style="color:#ffc24b;margin-bottom:12px">FAILED TO LOAD</div><div style="color:#e8e0cc;max-width:520px">${err?.message || err}</div><div style="color:#8f8a80;margin-top:16px;font-size:9px">Hard refresh (Cmd+Shift+R)</div></div>`;
    document.body.appendChild(fail);
  }
}

function drawHeadlights(c) {
  drawHeadlightBeams(ctx, c.x, c.visualY(), c.h, 1);
}

function tick(dt, now) {
  frame++;
  // Update world around player (or intro camera target)
  const worldTarget = (state === "intro" && intro?.getCameraTarget()) || car;
  world.update(worldTarget.x, worldTarget.y);
  updateWeather(dt, car?.speed() || 0);
  
  // Auto time cycling (when in auto mode) - skip during intro which forces its own time
  if (TIME_OVERRIDES[timeOverrideIdx] === "auto" && state !== "intro") {
    autoTimeHour += (dt / 60) * autoTimeSpeed; // Convert dt to minutes, then apply speed
    if (autoTimeHour >= 24) autoTimeHour -= 24;
    globalThis.__forceHour = autoTimeHour;
  }

  if (state === "boot") {
    if (world.ready(car.x, car.y, 350)) {
      // Loading done - show main menu
      state = "menu";
      menu.showMain({ loading: false });
    }
  }
  
  // Handle intro state
  if (state === "intro") {
    intro.update(dt, input);
    if (intro.isComplete()) {
      state = "lobby";
      lobby.show();
    }
  }

  const light = getLight();
  const introWithControl = state === "intro" && intro.hasPlayerControl();
  const paused = state === "paused" || state === "menu" || state === "boot" || state === "lobby" || (state === "intro" && !intro.hasPlayerControl());
  const roaming = (state === "roam" && !menu.visible) || introWithControl;

  // View radius for simulation (cam not built yet — use camZoom)
  // Generous radius so traffic/props are already spawned before you arrive
  const updateViewR = Math.hypot(canvas.width, canvas.height) / 2 / camZoom + Math.min(280, car.speed() * 3.5);

  if (!paused && roaming) {
    car.update(dt, input);
    
    // Check if car drove into deep water (bay/ocean)
    if (isDeepWater(car.x, car.y)) {
      handleWaterDeath();
    }
    
    traffic.update(dt, car, updateViewR);
    const pedHitsBefore = peds.hitCount;
    peds.update(dt, car);
    props.knockCheck(car, dt);
    
    // Disable police during intro
    if (state !== "intro") {
      speedZones.update(dt, car, police);
      police.update(dt, car, traffic, speedZones);
      police.checkCollisions(car, traffic, dt);
      
      const boxedStatus = police.updateBoxedStatus(dt, car);
      if (boxedStatus === "busted") {
        handleBusted();
      }
      
      if (peds.hitCount > pedHitsBefore) {
        police.addWanted(1);
      }
    }
    if (mp) mp.update(dt, car);
    if (remotePlayers) remotePlayers.update(dt);
  }

  // camera
  let cam;
  const camTarget = (state === "intro" && intro.getCameraTarget()) ? intro.getCameraTarget() : car;
  const spd = Math.hypot(camTarget.vx || 0, camTarget.vy || 0);
  
  if (flyMode) {
    // Fly camera mode - WASD to move, scroll to zoom
    const flySpeed = 800 / flyCam.zoom; // Faster when zoomed out
    if (input.up) flyCam.y -= flySpeed * dt;
    if (input.down) flyCam.y += flySpeed * dt;
    if (input.left) flyCam.x -= flySpeed * dt;
    if (input.right) flyCam.x += flySpeed * dt;
    world.update(flyCam.x, flyCam.y); // Load chunks around fly cam
    cam = { x: flyCam.x, y: flyCam.y, zoom: flyCam.zoom * (canvas.width / 1600), rot: 0 };
  } else {
    const targetRot = camRotate ? camTarget.h + Math.PI / 2 : 0;
    let dr = targetRot - camRot;
    while (dr > Math.PI) dr -= 2 * Math.PI;
    while (dr < -Math.PI) dr += 2 * Math.PI;
    camRot += dr * Math.min(1, 3.2 * dt);
    
    // Zoom - zoomed in when slow, pulls back more at high speed
    const spdKmh = spd * 3.6;
    // Base zoom 12 when stopped, drops to ~9.5 at high speed
    const targetZoom = spdKmh < 30 ? 12 - spdKmh / 60 : 11.5 - Math.min(2, (spdKmh - 30) / 120);
    camZoom += (targetZoom - camZoom) * Math.min(1, 2.5 * dt);
    
    // Minimal camera lift
    const accel = (spd - prevSpeed) / dt;
    prevSpeed = spd;
    const targetLift = accel > 15 ? Math.min(0.4, accel * 0.02) : 0;
    camLift += (targetLift - camLift) * Math.min(1, 3 * dt);
    
    if (car.crashT > 0.2) shakeT = 0.15;
    if (car.bumpT > 0.08) shakeT = Math.max(shakeT, 0.04);
    shakeT = Math.max(0, shakeT - dt);

    // Minimal look-ahead to reduce tile thrashing at speed
    const lookAhead = Math.min(10, spd * 0.18);
    const lookX = Math.cos(camTarget.h) * lookAhead;
    const lookY = Math.sin(camTarget.h) * lookAhead;
    const grade = car.grade || 0;
    const hillCam = grade * 1.5;
    const shake = shakeT > 0 ? shakeT * 2 : 0;
    const camTargetVisualY = camTarget.y + elevOffset(camTarget.x, camTarget.y);
    const liftBack = camLift * 0.5;
    cam = {
      x: camTarget.x + lookX - lookX * hillCam * 0.02 - Math.cos(camTarget.h) * liftBack + (Math.random() - 0.5) * shake,
      y: camTargetVisualY + lookY - lookY * hillCam * 0.02 - Math.sin(camTarget.h) * liftBack + (Math.random() - 0.5) * shake,
      zoom: (camZoom - camLift * 0.08) * (canvas.width / 1600) * (1 - grade * 0.005),
      rot: camRot,
    };
  }

  // --- draw ---
  renderer.drawWorld(cam);
  car.drawSkids(ctx);
  const baseViewR = Math.hypot(canvas.width, canvas.height) / 2 / cam.zoom;
  const viewR = baseViewR + Math.min(150, spd * 2);
  if (light.headlights) drawHeadlights(car);
  police.drawSpotlight(ctx, car);
  traffic.draw(ctx, cam.x, cam.y, viewR + 100, light, car);
  police.draw(ctx, cam.x, cam.y, viewR + 100, light);
  if (spd < 55) peds.draw(ctx, cam.x, cam.y, viewR);
  if (remotePlayers && mp?.connected) remotePlayers.draw(ctx, cam.x, cam.y, viewR);
  // During intro, the intro system draws the Tesla - don't draw player's car
  if (state === "intro") {
    intro.draw(ctx, cam);
  } else {
    car.draw(ctx);
  }
  car.drawFx(ctx);
  renderer.drawBuildings(cam, viewR + 30);
  police.drawHelicopter(ctx, cam.x, cam.y);
  props.draw(ctx, cam, viewR + 40, now / 1000, light, spd);
  renderer.end();

  applyLight(ctx, canvas, light);
  applyWeather(ctx, canvas, light);
  
  // Speed vignette - dark edges when going fast (only when driving, not in menu)
  const spdKmhVignette = spd * 3.6;
  if (!paused && !flyMode && spdKmhVignette > 100) {
    const intensity = Math.min(0.5, (spdKmhVignette - 100) / 200);
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const innerR = Math.min(cx, cy) * 0.7;
    const outerR = Math.hypot(cx, cy);
    const vignette = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(0.5, `rgba(0,0,0,${intensity * 0.3})`);
    vignette.addColorStop(1, `rgba(0,0,0,${intensity})`);
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // waypoint guidance
  if (waypoint && !paused) {
    const wd = Math.hypot(waypoint.x - car.x, waypoint.y - car.y);
    if (wd < 30) {
      showMsg("YOU HAVE ARRIVED", 1200, "#ffc24b");
      waypoint = null;
    } else {
      const ang = Math.atan2(waypoint.y - car.y, waypoint.x - car.x) - camRot;
      const wx = canvas.width / 2, wy = 86;
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
      const distText = wd >= 1000 ? (wd / 1000).toFixed(1) + "km" : Math.round(wd) + "m";
      ctx.font = '9px "Press Start 2P", monospace';
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      // Background for text
      const textWidth = ctx.measureText(distText).width;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(wx - textWidth / 2 - 4, wy + 18, textWidth + 8, 16);
      ctx.fillStyle = "#ffc24b";
      ctx.fillText(distText, wx, wy + 20);
    }
  }

  // --- MENU BACKGROUND FLYOVER ---
  const showMenuBg = state === "menu" || state === "boot" || state === "lobby" || (menu && menu.visible);
  menuBgCanvas.classList.toggle("visible", showMenuBg);
  if (showMenuBg && renderer) {
    // Update flyover position - slow circular path over the city
    menuFlyover.angle += dt * 0.08;
    const cx = -122.41 * 10000, cy = 37.78 * 10000; // Downtown SF center
    const radius = 800; // Circle radius in meters
    menuFlyover.x = cx + Math.cos(menuFlyover.angle) * radius;
    menuFlyover.y = cy + Math.sin(menuFlyover.angle) * radius;
    
    // Render city view to menu background
    const flyoverCam = {
      x: menuFlyover.x,
      y: menuFlyover.y,
      zoom: 3.5 * (menuBgCanvas.width / 1600), // Zoomed out view
      rot: menuFlyover.angle + Math.PI / 2, // Face direction of travel
    };
    
    // Draw to menu background canvas
    const oldCtx = renderer.ctx;
    renderer.ctx = menuBgCtx;
    menuBgCtx.fillStyle = "#0a0a0e";
    menuBgCtx.fillRect(0, 0, menuBgCanvas.width, menuBgCanvas.height);
    renderer.drawWorld(flyoverCam);
    const flyViewR = Math.hypot(menuBgCanvas.width, menuBgCanvas.height) / 2 / flyoverCam.zoom;
    renderer.drawBuildings(flyoverCam, flyViewR + 50);
    renderer.end();
    renderer.ctx = oldCtx;
  }

  // --- HUD ---
  const introTutorial = state === "intro" && intro.hasPlayerControl();
  const uiVisible = state === "roam" || state === "paused" || introTutorial;
  for (const el of document.querySelectorAll(".hud, #crt, #vignette, #radio")) {
    el.style.visibility = uiVisible ? "visible" : "hidden";
  }
  // During intro tutorial, show minimal HUD but skip the rest
  if (!uiVisible) return;
  if (introTutorial) {
    // Show speedo, street name, and minimap during tutorial
    ui.speedo.textContent = car.kmh();
    const nearRoad = world.nearestRoad(car.x, car.y, 60);
    ui.street.textContent = nearRoad && nearRoad.road.n ? nearRoad.road.n.toUpperCase() : "";
    ui.racehud.innerHTML = `<span class="dim">TUTORIAL</span>`;
    radar.draw(car, race, camRot, intro.getWaypoint(), null, police, speedZones);
    return;
  }

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
  if (roaming) {
    if (mp?.connected && mpRoom) {
      const near = remotePlayers?.nearbyCount() ?? 0;
      ui.racehud.innerHTML =
        `<span class="dim">MULTIPLAYER &mdash; ${mpRoom}</span><br>` +
        `<span>${near} NEARBY &middot; ${mp.roomCount} IN ROOM</span>`;
    } else {
      ui.racehud.innerHTML = `<span class="dim">FREE ROAM &mdash; ESC FOR MENU</span>`;
    }
  } else {
    ui.racehud.innerHTML = "";
  }

  radar.draw(car, race, camRot, waypoint, null, police, speedZones);

  // Wanted level stars
  const stars = ui.wanted.querySelectorAll(".star");
  for (let i = 0; i < stars.length; i++) {
    stars[i].classList.toggle("active", i < police.wanted);
  }
  ui.wanted.classList.toggle("evading", police.evading);

  // Speed zone warning
  const zone = speedZones.currentZone;
  const speedKmh = car.speed() * 3.6;
  if (zone && speedKmh > zone.limit + 5) {
    ui.speedwarn.textContent = `SPEED LIMIT ${zone.limit} · ${zone.name}`;
    ui.speedwarn.style.display = "block";
  } else {
    ui.speedwarn.style.display = "none";
  }
  
  // Busted progress bar
  const boxedProgress = police.boxedProgress;
  if (boxedProgress > 0 && police.wanted > 0) {
    ui.bustedBar.style.display = "block";
    ui.bustedText.style.display = "block";
    ui.bustedFill.style.width = `${boxedProgress * 100}%`;
  } else {
    ui.bustedBar.style.display = "none";
    ui.bustedText.style.display = "none";
  }
}

init();
