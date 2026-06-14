const SF_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/Los_Angeles",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const DAWN_START = 5.5;
const DAWN_END = 7.5;
const DUSK_START = 19;
const DUSK_END = 21.5;
const NIGHT_ALPHA = 0.72;

// Golden hour sub-phases for richer sunrise/sunset
const GOLDEN_DAWN_START = 6.5;
const GOLDEN_DAWN_END = 7.5;
const GOLDEN_DUSK_START = 19;
const GOLDEN_DUSK_END = 20;

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function rgba(r, g, b, a) {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a.toFixed(3)})`;
}

function blend(a, b, t) {
  return [
    lerp(a[0], b[0], t),
    lerp(a[1], b[1], t),
    lerp(a[2], b[2], t),
  ];
}

function sfClock(date) {
  const forced = globalThis.__forceHour;
  if (typeof forced === "number" && Number.isFinite(forced)) {
    const t = Math.max(0, Math.min(24, forced));
    const hour = Math.floor(t) % 24;
    const minute = Math.floor((t - Math.floor(t)) * 60 + 1e-6);
    return { t, hour, minute };
  }

  let hour = 0;
  let minute = 0;
  for (const part of SF_TIME.formatToParts(date)) {
    if (part.type === "hour") hour = Number(part.value);
    else if (part.type === "minute") minute = Number(part.value);
  }
  if (hour === 24) hour = 0;
  return { t: hour + minute / 60, hour, minute };
}

export function getLight(date = new Date()) {
  const { t, hour, minute } = sfClock(date);
  const clock = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  
  // Color palettes
  const nightBlue = [8, 12, 40];
  const deepPurple = [45, 20, 60];
  const warmOrange = [255, 140, 50];
  const goldenYellow = [255, 200, 100];
  const pinkHorizon = [255, 120, 140];

  // DAWN: dark -> purple -> orange -> golden -> day
  if (t >= DAWN_START && t < DAWN_END) {
    const p = clamp01((t - DAWN_START) / (DAWN_END - DAWN_START));
    const lampIntensity = Math.max(0, 1 - p * 1.5);
    
    // Golden hour sub-phase
    const inGolden = t >= GOLDEN_DAWN_START && t < GOLDEN_DAWN_END;
    const goldenP = inGolden ? clamp01((t - GOLDEN_DAWN_START) / (GOLDEN_DAWN_END - GOLDEN_DAWN_START)) : 0;
    
    let tintAlpha, color, ambient, ambientColor;
    
    if (p < 0.4) {
      // Early dawn: night blue -> deep purple
      const subP = p / 0.4;
      color = blend(nightBlue, deepPurple, subP);
      tintAlpha = NIGHT_ALPHA * (1 - subP * 0.3);
      ambient = subP * 0.08;
      ambientColor = pinkHorizon;
    } else if (p < 0.7) {
      // Mid dawn: purple -> warm orange
      const subP = (p - 0.4) / 0.3;
      color = blend(deepPurple, warmOrange, subP);
      tintAlpha = NIGHT_ALPHA * (0.7 - subP * 0.4);
      ambient = 0.08 + subP * 0.12;
      ambientColor = blend(pinkHorizon, warmOrange, subP);
    } else {
      // Late dawn / golden hour: orange -> clear
      const subP = (p - 0.7) / 0.3;
      color = blend(warmOrange, goldenYellow, subP);
      tintAlpha = NIGHT_ALPHA * (0.3 - subP * 0.3);
      ambient = (1 - subP) * 0.15;
      ambientColor = goldenYellow;
    }
    
    return {
      phase: inGolden ? "golden_dawn" : "dawn",
      t,
      tint: tintAlpha > 0.01 ? rgba(color[0], color[1], color[2], tintAlpha) : null,
      tintAlpha,
      lampIntensity,
      headlights: lampIntensity > 0.3,
      skyAmbient: ambient > 0.01 ? rgba(ambientColor[0], ambientColor[1], ambientColor[2], ambient) : null,
      clock,
    };
  }

  // DAY: clear, no tint
  if (t >= DAWN_END && t < DUSK_START) {
    return {
      phase: "day",
      t,
      tint: null,
      tintAlpha: 0,
      lampIntensity: 0,
      headlights: false,
      skyAmbient: null,
      clock,
    };
  }

  // DUSK: day -> golden -> orange -> purple -> night
  if (t >= DUSK_START && t < DUSK_END) {
    const p = clamp01((t - DUSK_START) / (DUSK_END - DUSK_START));
    
    // Golden hour sub-phase
    const inGolden = t >= GOLDEN_DUSK_START && t < GOLDEN_DUSK_END;
    const goldenP = inGolden ? clamp01((t - GOLDEN_DUSK_START) / (GOLDEN_DUSK_END - GOLDEN_DUSK_START)) : 0;
    
    let tintAlpha, color, ambient, ambientColor;
    
    if (p < 0.3) {
      // Early dusk: clear -> golden
      const subP = p / 0.3;
      color = goldenYellow;
      tintAlpha = subP * 0.08;
      ambient = subP * 0.18;
      ambientColor = goldenYellow;
    } else if (p < 0.5) {
      // Golden hour peak: golden -> warm orange
      const subP = (p - 0.3) / 0.2;
      color = blend(goldenYellow, warmOrange, subP);
      tintAlpha = 0.08 + subP * 0.12;
      ambient = 0.18 - subP * 0.03;
      ambientColor = blend(goldenYellow, warmOrange, subP);
    } else if (p < 0.75) {
      // Late dusk: orange -> pink/purple
      const subP = (p - 0.5) / 0.25;
      color = blend(warmOrange, deepPurple, subP);
      tintAlpha = 0.2 + subP * 0.2;
      ambient = 0.15 - subP * 0.1;
      ambientColor = blend(warmOrange, pinkHorizon, subP);
    } else {
      // Twilight: purple -> night blue
      const subP = (p - 0.75) / 0.25;
      color = blend(deepPurple, nightBlue, subP);
      tintAlpha = 0.4 + subP * 0.15;
      ambient = 0.05 * (1 - subP);
      ambientColor = pinkHorizon;
    }
    
    const lampIntensity = clamp01(p * 1.5 - 0.2);
    
    return {
      phase: inGolden ? "golden_dusk" : "dusk",
      t,
      tint: tintAlpha > 0.01 ? rgba(color[0], color[1], color[2], tintAlpha) : null,
      tintAlpha,
      lampIntensity,
      headlights: lampIntensity > 0.2,
      skyAmbient: ambient > 0.01 ? rgba(ambientColor[0], ambientColor[1], ambientColor[2], ambient) : null,
      clock,
    };
  }

  // NIGHT: deep blue tint with warm ambient from street lights
  const lateNight = t >= 23 || t < 4;
  const warmAmbient = lateNight ? 0.06 : 0.03;
  
  return {
    phase: "night",
    t,
    tint: rgba(nightBlue[0], nightBlue[1], nightBlue[2], NIGHT_ALPHA),
    tintAlpha: NIGHT_ALPHA,
    lampIntensity: 1,
    headlights: true,
    skyAmbient: warmAmbient > 0 ? rgba(255, 180, 100, warmAmbient) : null,
    clock,
  };
}

export function applyLight(ctx, canvas, light) {
  if (!light || (!light.tint && !light.skyAmbient)) return;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  if (light.tint) {
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = light.tint;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  if (light.skyAmbient) {
    ctx.globalCompositeOperation = "overlay";
    ctx.fillStyle = light.skyAmbient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  ctx.restore();
  ctx.globalCompositeOperation = "source-over";
}
