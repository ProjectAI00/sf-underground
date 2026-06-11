// CAMPAIGN: 10 street races against the tech industry, climbing the food
// chain from intern to the final boss — Sam Altman in his red McLaren F1.

export const MISSIONS = [
  {
    id: 0, name: "THE INTERN", title: "RACE 1 — THE INTERN",
    taunt: "STILL ON PROBATION", skill: 0.62, circuit: "chinatown",
    car: { color: "#b9bdc4", accent: "#2a2a30", shape: "liftback",
      stats: { speed: 4, accel: 6, brakes: 4, cornering: 3, aura: 1 } },
  },
  {
    id: 1, name: "GARRY T.", title: "RACE 2 — GARRY T.",
    taunt: "FUND RAISING LAPS", skill: 0.68, circuit: "chinatown",
    car: { color: "#e8762e", accent: "#1d1d22", shape: "wedge",
      stats: { speed: 5, accel: 5, brakes: 5, cornering: 5, aura: 4 } },
  },
  {
    id: 2, name: "PG", title: "RACE 3 — PG",
    taunt: "MAKE SOMETHING PEOPLE OVERTAKE", skill: 0.73, circuit: "grandtour",
    car: { color: "#cfc3a4", accent: "#6b5a3e", shape: "sedan",
      stats: { speed: 5, accel: 5, brakes: 6, cornering: 6, aura: 6 } },
  },
  {
    id: 3, name: "PATRICK C.", title: "RACE 4 — PATRICK C.",
    taunt: "SEVEN LINES OF CODE, ZERO BRAKES", skill: 0.78, circuit: "grandtour",
    car: { color: "#5469d4", accent: "#e8e6e1", shape: "sedan",
      stats: { speed: 6, accel: 6, brakes: 6, cornering: 6, aura: 5 } },
  },
  {
    id: 4, name: "BRIAN A.", title: "RACE 5 — BRIAN A.",
    taunt: "BELONG ANYWHERE. ESPECIALLY P1", skill: 0.82, circuit: "sunset",
    car: { color: "#ff5a5f", accent: "#e8e6e1", shape: "coupe",
      stats: { speed: 6, accel: 6, brakes: 6, cornering: 7, aura: 5 } },
  },
  {
    id: 5, name: "JENSEN H.", title: "RACE 6 — JENSEN H.",
    taunt: "THE MORE YOU RACE THE MORE YOU LOSE", skill: 0.86, circuit: "sunset",
    car: { color: "#1f2024", accent: "#76b900", shape: "coupe",
      stats: { speed: 7, accel: 7, brakes: 7, cornering: 7, aura: 8 } },
  },
  {
    id: 6, name: "SATYA N.", title: "RACE 7 — SATYA N.",
    taunt: "EMBRACE, EXTEND, OVERTAKE", skill: 0.9, circuit: "chinatown",
    car: { color: "#3f83c4", accent: "#e8e6e1", shape: "liftback",
      stats: { speed: 7, accel: 7, brakes: 7, cornering: 7, aura: 6 } },
  },
  {
    id: 7, name: "SUNDAR P.", title: "RACE 8 — SUNDAR P.",
    taunt: "YOUR ROUTE HAS BEEN DEPRECATED", skill: 0.93, circuit: "grandtour",
    car: { color: "#e8e6e1", accent: "#34a853", shape: "sedan",
      stats: { speed: 8, accel: 7, brakes: 7, cornering: 7, aura: 6 } },
  },
  {
    id: 8, name: "ELON M.", title: "RACE 9 — ELON M.",
    taunt: "FULL SELF-DRIVING (SUPERVISED)", skill: 0.96, circuit: "sunset",
    car: { color: "#a8acb4", accent: "#1d1d22", shape: "wedge",
      stats: { speed: 9, accel: 9, brakes: 6, cornering: 6, aura: 9 } },
  },
  {
    id: 9, name: "SAM ALTMAN", title: "FINAL — SAM ALTMAN",
    taunt: "AGI: ACTUAL GRAND-PRIX INTELLIGENCE", skill: 0.99, circuit: "grandtour",
    car: { color: "#c8332a", accent: "#d4af37", shape: "f1",
      stats: { speed: 10, accel: 9, brakes: 8, cornering: 9, aura: 10 } },
  },
];

const KEY = "sfracer_campaign";

/** index of the next mission to beat (0..10; 10 = campaign complete) */
export function campaignProgress() {
  const v = parseInt(localStorage.getItem(KEY) || "0", 10);
  return Number.isFinite(v) ? Math.max(0, Math.min(MISSIONS.length, v)) : 0;
}

export function markBeaten(missionId) {
  if (missionId === campaignProgress()) {
    localStorage.setItem(KEY, String(missionId + 1));
  }
}
