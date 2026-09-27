// Rooftop prop kit. Every prop is drawn centred at (0,0) in metres, axis-aligned;
// the roof baker rotates/positions it and draws the cast shadow first.
// Each entry: { w, d, h, shape: "rect"|"circle", draw(g, r, lw) }.

import { INK, pick } from "./style.js";

function box(g, w, d, top, lw) {
  g.fillStyle = top;
  g.fillRect(-w / 2, -d / 2, w, d);
  g.lineWidth = lw;
  g.strokeStyle = INK;
  g.strokeRect(-w / 2, -d / 2, w, d);
}

function rim(g, w, d, color, t) {
  g.fillStyle = color;
  g.fillRect(-w / 2, -d / 2, w, t);
  g.fillRect(-w / 2, -d / 2, t, d);
}

function disc(g, x, y, r, fill, lw) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = fill;
  g.fill();
  if (lw) {
    g.lineWidth = lw;
    g.strokeStyle = INK;
    g.stroke();
  }
}

export const KIT = {
  ac: {
    w: 2.2, d: 1.4, h: 1.2, shape: "rect",
    draw(g, r, lw) {
      box(g, 2.2, 1.4, "#e4e6ea", lw);
      rim(g, 2.2, 1.4, "#f7f8fa", 0.18);
      g.fillStyle = "#b9bec7";
      for (let i = 0; i < 4; i++) g.fillRect(-0.95 + i * 0.28, -0.5, 0.14, 1.0);
      disc(g, 0.55, 0, 0.45, "#9aa1ad", lw * 0.7);
      disc(g, 0.55, 0, 0.12, "#6e7582");
    },
  },
  fan: {
    w: 4.2, d: 4.2, h: 1.6, shape: "rect",
    draw(g, r, lw) {
      box(g, 4.2, 4.2, "#c9ced6", lw);
      rim(g, 4.2, 4.2, "#e1e5eb", 0.25);
      disc(g, 0, 0, 1.75, "#8e96a3", lw);
      g.strokeStyle = "#dfe3e9";
      g.lineWidth = 0.28;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + r() * 0.3;
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(Math.cos(a) * 1.6, Math.sin(a) * 1.6);
        g.stroke();
      }
      disc(g, 0, 0, 0.35, "#5d6470", lw * 0.7);
    },
  },
  tank: {
    w: 3.2, d: 3.2, h: 4.5, shape: "circle",
    draw(g, r, lw) {
      disc(g, 0, 0, 1.6, "#a86f4c", lw);
      g.strokeStyle = "#8e5a3b";
      g.lineWidth = 0.1;
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        g.beginPath();
        g.moveTo(Math.cos(a) * 0.3, Math.sin(a) * 0.3);
        g.lineTo(Math.cos(a) * 1.55, Math.sin(a) * 1.55);
        g.stroke();
      }
      g.beginPath();
      g.arc(0, 0, 1.6, Math.PI * 0.9, Math.PI * 1.6);
      g.strokeStyle = "#d6a07a";
      g.lineWidth = 0.22;
      g.stroke();
      disc(g, 0, 0, 0.32, "#6f4630", lw * 0.7);
    },
  },
  skylight: {
    w: 2.4, d: 1.6, h: 0.5, shape: "rect",
    draw(g, r, lw) {
      box(g, 2.4, 1.6, "#8fc3e0", lw);
      g.fillStyle = "#c4e3f2";
      g.beginPath();
      g.moveTo(-1.1, 0.7);
      g.lineTo(-0.3, -0.7);
      g.lineTo(0.2, -0.7);
      g.lineTo(-0.6, 0.7);
      g.fill();
      g.strokeStyle = "#e9eef2";
      g.lineWidth = 0.12;
      g.beginPath();
      g.moveTo(0, -0.8);
      g.lineTo(0, 0.8);
      g.stroke();
    },
  },
  vent: {
    w: 0.9, d: 0.9, h: 0.8, shape: "circle",
    draw(g, r, lw) {
      disc(g, 0, 0, 0.45, "#b8bcc4", lw);
      disc(g, 0, 0, 0.22, "#4d525c");
    },
  },
  chimney: {
    w: 1.0, d: 0.8, h: 1.8, shape: "rect",
    draw(g, r, lw) {
      box(g, 1.0, 0.8, "#b8664f", lw);
      g.fillStyle = "#3d3438";
      g.fillRect(-0.3, -0.2, 0.6, 0.4);
    },
  },
  bulkhead: {
    w: 4.5, d: 3.4, h: 3.0, shape: "rect",
    draw(g, r, lw) {
      box(g, 4.5, 3.4, "#d9d5cc", lw);
      rim(g, 4.5, 3.4, "#ece9e2", 0.3);
      g.fillStyle = "#b8b3a8";
      g.fillRect(-1.6, -1.1, 1.4, 1.4);
      disc(g, 1.2, 0.6, 0.35, "#9aa1ad", lw * 0.6);
    },
  },
  solar: {
    w: 5.0, d: 3.2, h: 0.4, shape: "rect",
    draw(g, r, lw) {
      box(g, 5.0, 3.2, "#34508f", lw);
      g.strokeStyle = "#6f8fd0";
      g.lineWidth = 0.08;
      for (let x = -2.5 + 1.0; x < 2.5; x += 1.0) {
        g.beginPath();
        g.moveTo(x, -1.6);
        g.lineTo(x, 1.6);
        g.stroke();
      }
      g.beginPath();
      g.moveTo(-2.5, 0);
      g.lineTo(2.5, 0);
      g.stroke();
      g.fillStyle = "rgba(200,220,255,0.35)";
      g.fillRect(-2.4, -1.5, 1.8, 0.5);
    },
  },
  garden: {
    w: 6.0, d: 4.0, h: 0.6, shape: "rect",
    draw(g, r, lw) {
      g.fillStyle = "#b08a62";
      g.fillRect(-3.0, -2.0, 6.0, 4.0);
      g.fillStyle = "#86c064";
      g.fillRect(-2.7, -1.7, 5.4, 3.4);
      g.lineWidth = lw;
      g.strokeStyle = INK;
      g.strokeRect(-3.0, -2.0, 6.0, 4.0);
      for (let i = 0; i < 5; i++) {
        const x = -2.2 + r() * 4.4, y = -1.2 + r() * 2.4, rad = 0.5 + r() * 0.5;
        disc(g, x + 0.15, y + 0.2, rad, "#4f8c43");
        disc(g, x, y, rad, pick(r, ["#6fae52", "#79b85a", "#5f9f4a"]));
        disc(g, x - rad * 0.3, y - rad * 0.3, rad * 0.4, "#a4d57f");
      }
    },
  },
  deck: {
    w: 5.0, d: 3.5, h: 0.2, shape: "rect",
    draw(g, r, lw) {
      box(g, 5.0, 3.5, "#c79a6b", lw);
      g.strokeStyle = "#a97f55";
      g.lineWidth = 0.08;
      for (let y = -1.75 + 0.5; y < 1.75; y += 0.5) {
        g.beginPath();
        g.moveTo(-2.5, y);
        g.lineTo(2.5, y);
        g.stroke();
      }
      disc(g, 1.2, 0.2, 0.7, "#f2efe6", lw * 0.6);
      disc(g, -1.3, -0.4, 0.45, "#e46f5a", lw * 0.6);
    },
  },
  helipad: {
    w: 12, d: 12, h: 0.1, shape: "circle",
    draw(g, r, lw) {
      disc(g, 0, 0, 5.8, "#5b5e68", lw);
      g.lineWidth = 0.35;
      g.strokeStyle = "#f5c84a";
      g.beginPath();
      g.arc(0, 0, 4.9, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = "#f4f1e8";
      g.fillRect(-1.6, -2.2, 0.7, 4.4);
      g.fillRect(0.9, -2.2, 0.7, 4.4);
      g.fillRect(-0.9, -0.35, 1.8, 0.7);
    },
  },
};

/** Which props a roof gets, by building size. Weighted lists of kit keys. */
export function propMenu(levels, area) {
  if (levels >= 16) return { big: ["bulkhead", "fan", "fan", "helipad"], small: ["ac", "ac", "vent", "fan"] };
  if (levels >= 6) return { big: ["tank", "bulkhead", "garden", "solar"], small: ["ac", "ac", "vent", "skylight"] };
  if (area > 180) return { big: ["solar", "deck", "garden", "skylight"], small: ["ac", "vent", "skylight", "chimney"] };
  return { big: ["skylight", "deck"], small: ["vent", "chimney", "skylight", "ac"] };
}
