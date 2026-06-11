const SF_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/Los_Angeles",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const DAWN_START = 6;
const DAWN_END = 7.5;
const DUSK_START = 19.5;
const DUSK_END = 21;
const NIGHT_ALPHA = 0.58;

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
  const nightBlue = [10, 15, 45];
  const warmPurple = [96, 45, 90];

  if (t >= DAWN_START && t < DAWN_END) {
    const p = clamp01((t - DAWN_START) / (DAWN_END - DAWN_START));
    const lampIntensity = 1 - p;
    const tintAlpha = NIGHT_ALPHA * lampIntensity;
    const color = blend(nightBlue, warmPurple, p);
    const ambient = Math.sin(p * Math.PI) * 0.1;
    return {
      phase: "dawn",
      t,
      tint: tintAlpha > 0 ? rgba(color[0], color[1], color[2], tintAlpha) : null,
      tintAlpha,
      lampIntensity,
      headlights: true,
      skyAmbient: ambient > 0 ? rgba(255, 154, 86, ambient) : null,
      clock,
    };
  }

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

  if (t >= DUSK_START && t < DUSK_END) {
    const p = clamp01((t - DUSK_START) / (DUSK_END - DUSK_START));
    const tintAlpha = NIGHT_ALPHA * p;
    const color = blend(warmPurple, nightBlue, p);
    const ambient = Math.sin(p * Math.PI) * 0.11;
    return {
      phase: "dusk",
      t,
      tint: tintAlpha > 0 ? rgba(color[0], color[1], color[2], tintAlpha) : null,
      tintAlpha,
      lampIntensity: p,
      headlights: true,
      skyAmbient: ambient > 0 ? rgba(255, 126, 68, ambient) : null,
      clock,
    };
  }

  return {
    phase: "night",
    t,
    tint: rgba(nightBlue[0], nightBlue[1], nightBlue[2], NIGHT_ALPHA),
    tintAlpha: NIGHT_ALPHA,
    lampIntensity: 1,
    headlights: true,
    skyAmbient: null,
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
