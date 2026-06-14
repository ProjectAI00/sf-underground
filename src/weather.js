// Weather system for SF Street Racer
// Handles sunny, cloudy, rainy, foggy conditions

const WEATHER_TYPES = ["clear", "sunny", "cloudy", "overcast", "foggy", "rainy", "storm"];
const WEATHER_INTENSITY = { clear: 0, sunny: 0.15, cloudy: 0.3, overcast: 0.5, foggy: 0.6, rainy: 0.7, storm: 0.9 };

// Weather transition weights (what weather can follow what)
const WEATHER_TRANSITIONS = {
  clear: ["clear", "clear", "sunny", "cloudy"],
  sunny: ["sunny", "sunny", "clear", "cloudy"],
  cloudy: ["cloudy", "cloudy", "overcast", "sunny", "clear", "foggy"],
  overcast: ["overcast", "cloudy", "rainy", "foggy"],
  foggy: ["foggy", "cloudy", "overcast", "clear"],
  rainy: ["rainy", "rainy", "overcast", "storm", "cloudy"],
  storm: ["storm", "rainy", "rainy", "overcast"],
};

let currentWeather = "clear";
let weatherIntensity = 0;
let autoWeatherEnabled = true;
let weatherTimer = 0;
let nextWeatherChange = 120 + Math.random() * 180; // 2-5 minutes

// Rain particles
const rainDrops = [];
const MAX_RAIN = 180;
const MAX_STORM_RAIN = 350;
let rainSpeedMult = 1;

// Lightning state
let lightningFlash = 0;        // Current flash intensity (0-1)
let lightningTimer = 0;        // Time until next lightning
let nextLightning = 3 + Math.random() * 8; // 3-11 seconds between strikes

export function setWeather(type) {
  if (!WEATHER_TYPES.includes(type)) return;
  currentWeather = type;
  weatherIntensity = WEATHER_INTENSITY[type] || 0;
}

export function getWeather() {
  return { type: currentWeather, intensity: weatherIntensity, auto: autoWeatherEnabled };
}

export function cycleWeather() {
  const idx = WEATHER_TYPES.indexOf(currentWeather);
  const next = WEATHER_TYPES[(idx + 1) % WEATHER_TYPES.length];
  currentWeather = next;
  weatherIntensity = WEATHER_INTENSITY[next] || 0;
  autoWeatherEnabled = false; // Manual override disables auto
  return next;
}

export function setAutoWeather(enabled) {
  autoWeatherEnabled = enabled;
  if (enabled) {
    weatherTimer = 0;
    nextWeatherChange = 60 + Math.random() * 120;
  }
}

export function toggleAutoWeather() {
  autoWeatherEnabled = !autoWeatherEnabled;
  if (autoWeatherEnabled) {
    weatherTimer = 0;
    nextWeatherChange = 60 + Math.random() * 120;
  }
  return autoWeatherEnabled;
}

function pickNextWeather() {
  const options = WEATHER_TRANSITIONS[currentWeather] || WEATHER_TYPES;
  return options[Math.floor(Math.random() * options.length)];
}

export function updateWeather(dt, playerSpeed = 0) {
  // Rain speed scales with player speed
  rainSpeedMult = 0.5 + Math.min(2, playerSpeed / 30);
  
  // Auto weather changes
  if (autoWeatherEnabled) {
    weatherTimer += dt;
    if (weatherTimer >= nextWeatherChange) {
      const next = pickNextWeather();
      currentWeather = next;
      weatherIntensity = WEATHER_INTENSITY[next] || 0;
      weatherTimer = 0;
      // Vary change interval: 2-6 minutes, storms/rain change faster
      const baseInterval = (next === "storm" || next === "rainy") ? 60 : 120;
      nextWeatherChange = baseInterval + Math.random() * 180;
    }
  }
  
  // Update rain particles when rainy or storm
  if (currentWeather === "rainy" || currentWeather === "storm") {
    updateRain(dt);
  }
  
  // Update lightning during storms
  if (currentWeather === "storm") {
    updateLightning(dt);
  } else {
    lightningFlash = 0;
  }
}

function updateLightning(dt) {
  // Fade out current flash
  if (lightningFlash > 0) {
    lightningFlash = Math.max(0, lightningFlash - dt * 4); // Fast fade
  }
  
  // Check for new lightning strike
  lightningTimer += dt;
  if (lightningTimer >= nextLightning) {
    // Lightning strike!
    lightningFlash = 0.8 + Math.random() * 0.2; // Strong initial flash
    lightningTimer = 0;
    // Random interval for next strike (more frequent in heavy storm)
    nextLightning = 2 + Math.random() * 10;
    
    // Sometimes do a double flash
    if (Math.random() < 0.3) {
      setTimeout(() => { lightningFlash = 0.6 + Math.random() * 0.3; }, 120);
    }
  }
}

export function getLightningFlash() {
  return lightningFlash;
}

function updateRain(dt) {
  const targetCount = currentWeather === "storm" ? MAX_STORM_RAIN : 
                      currentWeather === "rainy" ? MAX_RAIN : 0;

  // Add new drops
  while (rainDrops.length < targetCount) {
    rainDrops.push({
      x: Math.random(),
      y: Math.random(),
      speed: 0.8 + Math.random() * 0.4,
      length: 8 + Math.random() * 12,
    });
  }

  // Remove excess drops
  while (rainDrops.length > targetCount) {
    rainDrops.pop();
  }

  // Update positions - speed scales with player movement
  for (const drop of rainDrops) {
    drop.y += drop.speed * dt * rainSpeedMult * 1.5;
    if (drop.y > 1) {
      drop.y = -0.05;
      drop.x = Math.random();
    }
  }
}

export function applyWeather(ctx, canvas, light) {
  const w = canvas.width;
  const h = canvas.height;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // Sunny: warm bright overlay
  if (currentWeather === "sunny") {
    ctx.globalCompositeOperation = "overlay";
    ctx.fillStyle = "rgba(255, 248, 220, 0.15)";
    ctx.fillRect(0, 0, w, h);
  }

  // Cloudy: slight gray
  if (currentWeather === "cloudy") {
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = "rgba(200, 200, 210, 0.15)";
    ctx.fillRect(0, 0, w, h);
  }

  // Overcast: darker gray
  if (currentWeather === "overcast") {
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = "rgba(160, 165, 175, 0.25)";
    ctx.fillRect(0, 0, w, h);
  }

  // Foggy: white fog overlay
  if (currentWeather === "foggy") {
    const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.6);
    grad.addColorStop(0, "rgba(220, 225, 230, 0)");
    grad.addColorStop(0.5, "rgba(200, 205, 210, 0.25)");
    grad.addColorStop(1, "rgba(180, 185, 195, 0.45)");
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  // Rainy: subtle darkening + light rain streaks
  if (currentWeather === "rainy") {
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = "rgba(140, 145, 155, 0.2)";
    ctx.fillRect(0, 0, w, h);

    // Subtle rain streaks
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = "rgba(180, 190, 210, 0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const drop of rainDrops) {
      const dx = drop.x * w;
      const dy = drop.y * h;
      ctx.moveTo(dx, dy);
      ctx.lineTo(dx - 2, dy + drop.length * 0.7);
    }
    ctx.stroke();
  }

  // Storm: dark gray sky + fog + heavy rain + lightning
  if (currentWeather === "storm") {
    // Dark gray overlay (reduced during lightning)
    const darkMult = 1 - lightningFlash * 0.7;
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = `rgba(70, 75, 85, ${0.4 * darkMult})`;
    ctx.fillRect(0, 0, w, h);
    
    // Fog effect (reduced during lightning)
    const fogGrad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
    fogGrad.addColorStop(0, "rgba(80, 85, 95, 0)");
    fogGrad.addColorStop(0.6, `rgba(60, 65, 75, ${0.15 * darkMult})`);
    fogGrad.addColorStop(1, `rgba(40, 45, 55, ${0.3 * darkMult})`);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = fogGrad;
    ctx.fillRect(0, 0, w, h);

    // Lightning flash - softer purple/blue tint instead of harsh white
    if (lightningFlash > 0.05) {
      ctx.globalCompositeOperation = "screen";
      // Softer blue/purple flash instead of white
      const flashIntensity = lightningFlash * 0.45;
      ctx.fillStyle = `rgba(160, 170, 210, ${flashIntensity})`;
      ctx.fillRect(0, 0, w, h);
      
      // Purple tint for atmosphere
      ctx.fillStyle = `rgba(140, 130, 180, ${flashIntensity * 0.4})`;
      ctx.fillRect(0, 0, w, h);
    }

    // Heavy rain streaks (brighter during lightning)
    ctx.globalCompositeOperation = "source-over";
    const rainBright = lightningFlash > 0.1 ? 0.6 : 0.35;
    ctx.strokeStyle = `rgba(160, 170, 190, ${rainBright})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const drop of rainDrops) {
      const dx = drop.x * w;
      const dy = drop.y * h;
      ctx.moveTo(dx, dy);
      ctx.lineTo(dx - 3, dy + drop.length);
    }
    ctx.stroke();
  }

  ctx.restore();
  ctx.globalCompositeOperation = "source-over";
}

// Expose for debugging/control
globalThis.__weather = {
  set: setWeather,
  get: getWeather,
  cycle: cycleWeather,
  types: WEATHER_TYPES,
};
