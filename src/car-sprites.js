/**
 * Optional PNG car sprites. Procedural art from cars.js is the default;
 * drop files in assets/cars/<id>.png (top-down, transparent) to override.
 *
 * Expected: front of car = top of image (matches drawCarSprite rotation).
 * Rough size: ~17×35 px at 8 px/m, or any multiple — nearest-neighbor scale.
 */

const cache = new Map();
const pending = new Map();

export function spriteUrlFor(carId) {
  return `assets/cars/${carId}.png`;
}

export function hasCachedSprite(carId) {
  const img = cache.get(carId);
  return Boolean(img?.complete && img.naturalWidth > 0);
}

/** Returns loaded Image or null (still loading / missing). */
export function getCachedSprite(carId) {
  if (hasCachedSprite(carId)) return cache.get(carId);
  return null;
}

/** Start loading PNG if present; calls onReady when image loads or fails. */
export function preloadCarSprite(carId, onReady = () => {}) {
  if (hasCachedSprite(carId)) {
    onReady(cache.get(carId));
    return;
  }
  if (pending.has(carId)) {
    pending.get(carId).push(onReady);
    return;
  }
  pending.set(carId, [onReady]);

  const img = new Image();
  img.onload = () => {
    cache.set(carId, img);
    const cbs = pending.get(carId) || [];
    pending.delete(carId);
    for (const cb of cbs) cb(img);
  };
  img.onerror = () => {
    const cbs = pending.get(carId) || [];
    pending.delete(carId);
    for (const cb of cbs) cb(null);
  };
  img.src = spriteUrlFor(carId);
}

export function imageToCanvas(img) {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext("2d");
  g.imageSmoothingEnabled = false;
  g.drawImage(img, 0, 0);
  return c;
}

/** Preload all garage cars; safe to call at boot. */
export function preloadAllCarSprites(carIds) {
  for (const id of carIds) preloadCarSprite(id);
}
