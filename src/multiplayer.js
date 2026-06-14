import { mpWsUrl } from "./config.js";

const SEND_HZ = 15;

export function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "SF-";
  for (let i = 0; i < 4; i++) {
    code += chars[(Math.random() * chars.length) | 0];
  }
  return code;
}

export class Multiplayer {
  constructor({ onSnapshot, onWelcome, onError, onDisconnect } = {}) {
    this.callbacks = { onSnapshot, onWelcome, onError, onDisconnect };
    this.ws = null;
    this.id = null;
    this.room = null;
    this.roomCount = 0;
    this.connected = false;
    this.sendAccum = 0;
  }

  connect(room, profile, spawn) {
    this.disconnect();
    this.room = room;
    const ws = new WebSocket(mpWsUrl());
    this.ws = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: "join",
        room,
        tag: profile?.tag || "DRIVER",
        carId: profile?.carId || "944",
        x: spawn.x,
        y: spawn.y,
        h: spawn.h,
      }));
    };

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === "welcome") {
        this.id = msg.id;
        this.roomCount = msg.roomCount ?? 1;
        this.connected = true;
        this.callbacks.onWelcome?.(msg);
      } else if (msg.type === "snapshot") {
        this.roomCount = msg.roomCount ?? this.roomCount;
        this.callbacks.onSnapshot?.(msg.players || []);
      } else if (msg.type === "error") {
        this.callbacks.onError?.(msg.msg || "ERROR");
      }
    };

    ws.onclose = () => {
      const wasConnected = this.connected;
      this.connected = false;
      this.ws = null;
      if (wasConnected) this.callbacks.onDisconnect?.();
    };

    ws.onerror = () => {
      this.callbacks.onError?.("CONNECTION FAILED");
    };
  }

  sendState(car) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      type: "state",
      x: car.x,
      y: car.y,
      h: car.h,
      v: car.speed(),
    }));
  }

  update(dt, car) {
    if (!this.connected || !car) return;
    this.sendAccum += dt;
    if (this.sendAccum >= 1 / SEND_HZ) {
      this.sendAccum = 0;
      this.sendState(car);
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
    }
    this.ws = null;
    this.connected = false;
    this.id = null;
    this.room = null;
    this.roomCount = 0;
  }
}
