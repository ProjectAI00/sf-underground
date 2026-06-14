/** Flat 2D garage preview — big crisp pixel sprite, no pseudo-3D. */

export function drawCarShowroom(canvas, sprite, car, { bob = 0, time = 0 } = {}) {
  if (!canvas || !sprite) return;
  const g = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  g.clearRect(0, 0, w, h);

  const accent = car?.accent || "#4be0c8";

  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#0c0d12");
  bg.addColorStop(0.55, "#121318");
  bg.addColorStop(1, "#181612");
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);

  g.strokeStyle = "rgba(255, 194, 75, 0.06)";
  g.lineWidth = 1;
  for (let y = h * 0.62; y < h; y += 14) {
    g.beginPath();
    g.moveTo(w * 0.06, y);
    g.lineTo(w * 0.94, y);
    g.stroke();
  }

  g.fillStyle = "rgba(255, 194, 75, 0.04)";
  g.fillRect(0, h * 0.78, w, h * 0.22);

  g.strokeStyle = "rgba(75, 224, 200, 0.22)";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(w * 0.08, h * 0.82);
  g.lineTo(w * 0.92, h * 0.82);
  g.stroke();

  const pulse = 0.5 + Math.sin(time * 2.4) * 0.5;
  g.strokeStyle = `rgba(75, 224, 200, ${0.12 + pulse * 0.1})`;
  g.lineWidth = 2;
  g.beginPath();
  g.ellipse(w * 0.5, h * 0.78, w * 0.22, h * 0.04, 0, 0, Math.PI * 2);
  g.stroke();

  const scale = Math.min(w / sprite.width, h / sprite.height) * 0.82;
  const sw = sprite.width * scale;
  const sh = sprite.height * scale;
  const cx = w * 0.5;
  const cy = h * 0.52 + bob;

  g.imageSmoothingEnabled = false;
  g.save();
  g.translate(cx, cy);

  g.globalAlpha = 0.35;
  g.fillStyle = "#000";
  g.beginPath();
  g.ellipse(0, sh * 0.38, sw * 0.42, sh * 0.07, 0, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;

  g.drawImage(sprite, -sw / 2, -sh / 2, sw, sh);

  g.globalCompositeOperation = "screen";
  g.globalAlpha = 0.08 + pulse * 0.04;
  g.fillStyle = accent;
  g.fillRect(-sw * 0.08, -sh * 0.42, sw * 0.16, sh * 0.84);
  g.globalCompositeOperation = "source-over";
  g.globalAlpha = 1;

  g.restore();
}
