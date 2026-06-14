// Speed zones - areas with speed limits that trigger police when violated
// Placed at key locations around SF

const ZONE_RADIUS = 50;
const VIOLATION_TIME = 2.5; // seconds of speeding before triggering (more forgiving)

// Speed zones around SF (x, y, limit in km/h, name)
// Downtown, residential areas = lower limits
// Highways, main roads = higher limits
const ZONES = [
  // Downtown / Financial (strict)
  { x: 1600, y: -2400, limit: 40, name: "FINANCIAL DISTRICT" },
  { x: 1800, y: -2800, limit: 40, name: "DOWNTOWN" },
  { x: 1400, y: -2600, limit: 45, name: "UNION SQUARE" },
  
  // Chinatown (very strict)
  { x: 1200, y: -2600, limit: 35, name: "CHINATOWN" },
  { x: 1000, y: -2700, limit: 35, name: "CHINATOWN" },
  
  // North Beach
  { x: 1500, y: -3200, limit: 40, name: "NORTH BEACH" },
  { x: 1700, y: -3400, limit: 45, name: "FISHERMAN'S WHARF" },
  
  // Marina
  { x: 200, y: -3600, limit: 50, name: "MARINA" },
  { x: -300, y: -3400, limit: 50, name: "PRESIDIO" },
  
  // Mission (moderate)
  { x: 1000, y: 200, limit: 45, name: "MISSION" },
  { x: 1200, y: 600, limit: 45, name: "MISSION" },
  { x: 800, y: -100, limit: 50, name: "SOMA" },
  
  // Castro
  { x: 0, y: 400, limit: 40, name: "CASTRO" },
  { x: -200, y: 700, limit: 40, name: "NOE VALLEY" },
  
  // Haight
  { x: -800, y: 200, limit: 45, name: "HAIGHT" },
  { x: -1200, y: 0, limit: 45, name: "HAIGHT-ASHBURY" },
  
  // Sunset / Richmond (residential)
  { x: -3000, y: -500, limit: 40, name: "SUNSET" },
  { x: -3500, y: -1000, limit: 40, name: "OUTER SUNSET" },
  { x: -2500, y: -2500, limit: 45, name: "RICHMOND" },
  
  // Highway zones (higher limits but still enforced)
  { x: 2200, y: -1500, limit: 70, name: "101 FREEWAY" },
  { x: 2000, y: -500, limit: 70, name: "101 FREEWAY" },
  { x: 1800, y: 800, limit: 70, name: "101 FREEWAY" },
  
  // Embarcadero
  { x: 2100, y: -2200, limit: 50, name: "EMBARCADERO" },
  { x: 2300, y: -3000, limit: 50, name: "EMBARCADERO" },
  
  // Golden Gate area
  { x: -1800, y: -4200, limit: 55, name: "GOLDEN GATE" },
];

export class SpeedZones {
  constructor() {
    this.zones = ZONES.map(z => ({
      ...z,
      radius: ZONE_RADIUS,
      violationTimer: 0,
    }));
    this.currentZone = null;
    this.warningShown = false;
  }

  update(dt, player, police) {
    const playerSpeed = player.speed() * 3.6; // km/h
    let inZone = null;
    let worstViolation = 0;

    for (const zone of this.zones) {
      const dx = player.x - zone.x;
      const dy = player.y - zone.y;
      const dist = Math.hypot(dx, dy);

      if (dist < zone.radius) {
        inZone = zone;
        const over = playerSpeed - zone.limit;

        // Only trigger if significantly over (20+ km/h)
        if (over > 20) {
          zone.violationTimer += dt;
          worstViolation = Math.max(worstViolation, over);

          if (zone.violationTimer > VIOLATION_TIME) {
            // Always just 1 star - less punishing
            police.addWanted(1);
            zone.violationTimer = 0;
          }
        } else {
          zone.violationTimer = Math.max(0, zone.violationTimer - dt * 2);
        }
      } else {
        zone.violationTimer = Math.max(0, zone.violationTimer - dt * 0.5);
      }
    }

    this.currentZone = inZone;
    return { inZone, violation: worstViolation };
  }

  getZones() {
    return this.zones;
  }
  
  get currentLimit() {
    return this.currentZone ? this.currentZone.limit : 50; // Default 50 km/h
  }

  drawRadarZones(ctx, car, camRot, cx, cy, radius, scale) {
    const RADAR_M = 320;
    const cos = Math.cos(camRot);
    const sin = Math.sin(camRot);

    for (const zone of this.zones) {
      const dx = zone.x - car.x;
      const dy = zone.y - car.y;
      const dist = Math.hypot(dx, dy);
      
      if (dist > RADAR_M + zone.radius) continue;

      const rx = dx * cos + dy * sin;
      const ry = -dx * sin + dy * cos;

      const isViolating = zone.violationTimer > 0.3;
      const alpha = isViolating ? 0.4 : 0.15;
      const color = isViolating ? "rgba(255,80,60," + alpha + ")" : "rgba(255,200,75," + alpha + ")";

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx + rx * scale, cy + ry * scale, zone.radius * scale, 0, Math.PI * 2);
      ctx.fill();

      if (isViolating) {
        ctx.strokeStyle = "rgba(255,80,60,0.6)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }
}
