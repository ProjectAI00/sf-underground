/**
 * Retro Racer SF — lightweight multiplayer relay.
 * Rooms up to 100 drivers; each client only receives nearby players (~1.2km).
 */
import { WebSocketServer } from "ws";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.PORT) || 8787;
const MAX_ROOM = 100;
const INTEREST_M = 1200;
const INTEREST2 = INTEREST_M * INTEREST_M;
const TICK_MS = Math.round(1000 / 15);

/** @type {Map<string, Map<string, Player>>} */
const rooms = new Map();
/** @type {Map<import('ws').WebSocket, Player>} */
const clients = new Map();

/** @typedef {{ id: string, ws: import('ws').WebSocket, room: string, tag: string, carId: string, x: number, y: number, h: number, v: number }} Player */

function sanitizeRoom(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .slice(0, 20);
}

function getRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, new Map());
  return rooms.get(roomId);
}

function playerPayload(p) {
  return {
    id: p.id,
    tag: p.tag,
    carId: p.carId,
    x: p.x,
    y: p.y,
    h: p.h,
    v: p.v,
  };
}

function removeClient(ws) {
  const client = clients.get(ws);
  if (!client) return;
  const room = getRoom(client.room);
  room.delete(client.id);
  clients.delete(ws);
  if (room.size === 0) rooms.delete(client.room);
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcastSnapshots() {
  for (const client of clients.values()) {
    const room = getRoom(client.room);
    const nearby = [];
    for (const p of room.values()) {
      if (p.id === client.id) continue;
      const dx = p.x - client.x;
      const dy = p.y - client.y;
      if (dx * dx + dy * dy <= INTEREST2) nearby.push(playerPayload(p));
    }
    send(client.ws, {
      type: "snapshot",
      players: nearby,
      roomCount: room.size,
    });
  }
}

const httpServer = createServer((req, res) => {
  if (req.url === "/" || req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer });
httpServer.listen(PORT, () => {
  console.log(`[mp] listening on :${PORT} (interest ${INTEREST_M}m, max ${MAX_ROOM}/room)`);
});

setInterval(broadcastSnapshots, TICK_MS);

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (msg.type === "join") {
      const roomId = sanitizeRoom(msg.room);
      if (!roomId) {
        send(ws, { type: "error", msg: "INVALID ROOM CODE" });
        return;
      }

      removeClient(ws);

      const room = getRoom(roomId);
      if (room.size >= MAX_ROOM) {
        send(ws, { type: "error", msg: "ROOM FULL (100)" });
        return;
      }

      const id = randomBytes(4).toString("hex");
      /** @type {Player} */
      const player = {
        id,
        ws,
        room: roomId,
        tag: String(msg.tag || "DRIVER").slice(0, 16),
        carId: String(msg.carId || "944").slice(0, 24),
        x: Number(msg.x) || 0,
        y: Number(msg.y) || 0,
        h: Number(msg.h) || 0,
        v: 0,
      };

      room.set(id, player);
      clients.set(ws, player);

      send(ws, {
        type: "welcome",
        id,
        room: roomId,
        roomCount: room.size,
      });
      broadcastSnapshots();
      return;
    }

    const client = clients.get(ws);
    if (!client) return;

    if (msg.type === "state") {
      if (Number.isFinite(msg.x)) client.x = msg.x;
      if (Number.isFinite(msg.y)) client.y = msg.y;
      if (Number.isFinite(msg.h)) client.h = msg.h;
      if (Number.isFinite(msg.v)) client.v = msg.v;
    }

    if (msg.type === "ping") {
      send(ws, { type: "pong", t: msg.t });
    }
  });

  ws.on("close", () => {
    removeClient(ws);
    broadcastSnapshots();
  });
});
