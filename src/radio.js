// In-game radio, top-center HUD. Two backends:
//  1. Internet radio streams (SomaFM) — unlimited users, no API.
//  2. Spotify stations (playlist / show / podcast) — each player uses their
//     own Premium login; API calls only when you change station (~3 per tune).
//
// Curate stations in data/radio-stations.json (no server, no shared quota).

import { parseSpotify } from "./spotify-uri.js";

const FALLBACK_STATIONS = [
  { id: "off", name: "RADIO OFF", tag: "" },
  { id: "groove", name: "GROOVE SALAD", tag: "CHILL BEATS", url: "https://ice1.somafm.com/groovesalad-128-mp3" },
];

const SPOTIFY_SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
  "playlist-read-private",
  "playlist-read-collaborative",
].join(" ");
const LS = {
  station: "sfradio_station",
  volume: "sfradio_volume",
  clientId: "sfradio_sp_client",
  refresh: "sfradio_sp_refresh",
  verifier: "sfradio_sp_verifier",
  playlist: "sfradio_sp_playlist",
  bossTracks: "sfradio_sp_boss_tracks",
};

export class Radio {
  constructor() {
    this.stations = [...FALLBACK_STATIONS];
    this.idx = 0;
    this.audio = new Audio();
    this.audio.crossOrigin = "anonymous";
    this.audio.volume = parseFloat(localStorage.getItem(LS.volume) || "0.5");
    this.status = ""; // "", "TUNING...", error text
    this.spotify = {
      player: null,
      deviceId: null,
      token: null,
      expires: 0,
      track: "",
      paused: true,
      connecting: false,
      ready: false,
    };

    this.#buildUI();
    this.#handleAuthCallback();
    this.#loadStations().then(() => this.#afterStationsLoaded());

    this.audio.addEventListener("playing", () => { this.status = ""; this.#render(); });
    this.audio.addEventListener("waiting", () => { this.status = "TUNING..."; this.#render(); });
    this.audio.addEventListener("error", () => {
      if (this.station().url) { this.status = "NO SIGNAL"; this.#render(); }
    });
  }

  station() { return this.stations[this.idx]; }

  /** True if this station plays via the user's Spotify account. */
  #isSpotifyStation(st) {
    return Boolean(st?.spotify);
  }

  cycle(dir = 1) {
    this.tuneTo((this.idx + dir + this.stations.length) % this.stations.length);
  }

  tuneTo(i) {
    this.idx = i;
    const st = this.station();
    localStorage.setItem(LS.station, st.id);
    this.status = "";

    this.audio.pause();
    if (this.spotify.player && !this.#isSpotifyStation(st)) {
      this.spotify.player.pause().catch(() => {});
    }

    if (st.url) {
      this.status = "TUNING...";
      this.audio.src = st.url;
      this.audio.play().catch(() => { this.status = "CLICK TO PLAY"; this.#render(); });
    } else if (this.#isSpotifyStation(st)) {
      if (!this.isSpotifyConnected()) {
        this.status = "CLICK TO CONNECT SPOTIFY";
      } else {
        this.#playStationSpotify(st).catch(() => {});
      }
    }
    this.#flash();
    this.#render();
  }

  setVolume(v) {
    this.audio.volume = Math.max(0, Math.min(1, v));
    localStorage.setItem(LS.volume, String(this.audio.volume));
    if (this.spotify.player) this.spotify.player.setVolume(this.audio.volume).catch(() => {});
    this.#render();
  }

  /** Campaign boss — one track per race. */
  async playBossTrack(mission) {
    if (!mission) return;
    await this.#ensureSpotify({ keepStation: true });
    if (!(await this.#waitReady())) return;

    const overrides = this.#bossOverrides();
    const raw = overrides[mission.id] || mission.track || "";
    const parsed = parseSpotify(raw);
    if (parsed) {
      try {
        await this.#playParsed(parsed, { shuffle: false });
      } catch (e) {
        this.status = String(e.message || "PLAY FAILED").slice(0, 40).toUpperCase();
        this.#render();
      }
      return;
    }
    const q = mission.trackQuery;
    if (!q) return;
    try {
      await this.#playSearch(q);
    } catch (e) {
      this.status = String(e.message || "PLAY FAILED").slice(0, 40).toUpperCase();
      this.#render();
    }
  }

  /** Free roam / multiplayer — play whatever station is currently selected. */
  async playSessionPlaylist() {
    const st = this.station();
    if (!this.#isSpotifyStation(st)) return;
    await this.#playStationSpotify(st);
  }

  async #playStationSpotify(st) {
    await this.#ensureSpotify();
    if (!(await this.#waitReady())) return;

    let raw = st.spotify;
    if (st.id === "drive") {
      const override = localStorage.getItem(LS.playlist);
      if (override) raw = override;
    }
    if (!raw || String(raw).includes("YOUR_")) {
      this.status = "EDIT data/radio-stations.json";
      this.#render();
      return;
    }

    const parsed = parseSpotify(raw);
    if (!parsed) {
      this.status = "BAD SPOTIFY URI";
      this.#render();
      return;
    }

    const shuffle = st.shuffle ?? (parsed.type === "playlist" || parsed.type === "album");
    try {
      this.status = "TUNING...";
      this.#render();
      await this.#playParsed(parsed, { shuffle });
      this.status = "";
    } catch (e) {
      this.status = String(e.message || "PLAY FAILED").slice(0, 40).toUpperCase();
    }
    this.#render();
  }

  getPlaylistUri() { return localStorage.getItem(LS.playlist) || ""; }
  setPlaylistUri(v) { localStorage.setItem(LS.playlist, v.trim()); }

  isSpotifyConnected() { return Boolean(this.spotify.token); }

  /** main keydown hook; returns true if consumed */
  handleKey(e) {
    if (e.code === "KeyQ") { this.cycle(e.shiftKey ? -1 : 1); return true; }
    if (e.code === "Minus") { this.setVolume(this.audio.volume - 0.1); return true; }
    if (e.code === "Equal") { this.setVolume(this.audio.volume + 0.1); return true; }
    return false;
  }

  // ---------- UI ----------

  #buildUI() {
    const style = document.createElement("style");
    style.textContent = `
      #radio { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 10;
        font-family: "Press Start 2P", monospace; user-select: none; text-align: center; }
      #radio .pill { display: inline-flex; align-items: center; gap: 10px; padding: 7px 12px;
        background: rgba(10,10,16,0.72); border: 2px solid #3a362c; border-radius: 4px;
        box-shadow: 0 3px 0 rgba(0,0,0,0.4); cursor: pointer; }
      #radio .arrow { color: #8d8472; font-size: 10px; cursor: pointer; padding: 0 2px; }
      #radio .arrow:hover { color: #ffc24b; }
      #radio .icon { color: #ffc24b; font-size: 10px; }
      #radio .name { color: #e8e0cc; font-size: 10px; letter-spacing: 1px; }
      #radio .sub { margin-top: 5px; font-size: 8px; color: #8d8472; letter-spacing: 1px;
        text-shadow: 1px 1px 0 #000; min-height: 10px; }
      #radio .sub .track { color: #4be0c8; }
      #radio.flash .pill { border-color: #ffc24b; }
      #radio .vol { font-size: 8px; color: #5b5345; margin-left: 4px; }
      #sp-modal { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center;
        justify-content: center; background: rgba(5,5,10,0.85); font-family: "Press Start 2P", monospace; }
      #sp-modal .box { width: min(560px, 92vw); background: #14151a; border: 3px solid #1c1a16;
        outline: 2px solid #5b5345; padding: 26px; color: #e8e0cc; font-size: 9px; line-height: 2; }
      #sp-modal h3 { color: #1ed760; font-size: 12px; margin-bottom: 14px; }
      #sp-modal ol { margin: 10px 0 14px 18px; }
      #sp-modal a { color: #4be0c8; }
      #sp-modal input { width: 100%; box-sizing: border-box; background: #0c0d12; border: 2px solid #3a362c;
        color: #ffc24b; font-family: inherit; font-size: 10px; padding: 9px; margin: 8px 0 14px; }
      #sp-modal input:focus { outline: none; border-color: #ffc24b; }
      #sp-modal .lbl { color: #8d8472; font-size: 8px; margin-top: 10px; }
      #sp-modal .hint { color: #5b5345; font-size: 7px; line-height: 1.8; margin-bottom: 10px; }
      #sp-modal .row { display: flex; gap: 10px; }
      #sp-modal button { flex: 1; background: #1ed760; border: 0; color: #07140b; font-family: inherit;
        font-size: 10px; padding: 11px; cursor: pointer; }
      #sp-modal button.alt { background: #2a2b30; color: #b9ae96; }
      #sp-modal code { color: #ffc24b; }
    `;
    document.head.appendChild(style);

    this.el = document.createElement("div");
    this.el.id = "radio";
    this.el.innerHTML = `
      <div class="pill">
        <span class="arrow" data-d="-1">◀</span>
        <span class="icon">♪</span>
        <span class="name"></span>
        <span class="vol"></span>
        <span class="arrow" data-d="1">▶</span>
      </div>
      <div class="sub"></div>
    `;
    document.body.appendChild(this.el);
    this.nameEl = this.el.querySelector(".name");
    this.subEl = this.el.querySelector(".sub");
    this.volEl = this.el.querySelector(".vol");
    this.el.querySelectorAll(".arrow").forEach((a) => {
      a.addEventListener("click", (e) => { e.stopPropagation(); this.cycle(parseInt(a.dataset.d, 10)); });
    });
    this.el.querySelector(".pill").addEventListener("click", () => {
      const st = this.station();
      if (this.#isSpotifyStation(st) && !this.isSpotifyConnected()) this.#showSpotifySetup();
      else if (this.#isSpotifyStation(st) && this.isSpotifyConnected()) this.#playStationSpotify(st).catch(() => {});
      else if (st.url && this.audio.paused) this.audio.play().catch(() => {});
    });

    let touchX = null;
    this.el.addEventListener("touchstart", (e) => {
      touchX = e.changedTouches[0]?.clientX ?? null;
    }, { passive: true });
    this.el.addEventListener("touchend", (e) => {
      if (touchX == null) return;
      const dx = (e.changedTouches[0]?.clientX ?? touchX) - touchX;
      touchX = null;
      if (Math.abs(dx) > 36) this.cycle(dx < 0 ? 1 : -1);
    }, { passive: true });

    this.#render();
  }

  async #loadStations() {
    try {
      const res = await fetch("data/radio-stations.json");
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.stations) && data.stations.length) {
        this.stations = data.stations;
      }
    } catch {
      /* offline / missing file — use fallback */
    }
  }

  #afterStationsLoaded() {
    const saved = localStorage.getItem(LS.station);
    const savedIdx = this.stations.findIndex((s) => s.id === saved);
    if (savedIdx > 0) {
      this.pendingIdx = savedIdx;
      const resume = () => {
        if (this.pendingIdx != null) this.tuneTo(this.pendingIdx);
        this.pendingIdx = null;
        window.removeEventListener("keydown", resume);
        window.removeEventListener("pointerdown", resume);
      };
      window.addEventListener("keydown", resume);
      window.addEventListener("pointerdown", resume);
    }
    this.#render();
  }

  #render() {
    const st = this.station();
    this.nameEl.textContent = st.name;
    this.volEl.textContent = "VOL " + Math.round(this.audio.volume * 10);
    let sub = st.tag || "";
    if (this.status) sub = this.status;
    if (this.#isSpotifyStation(st)) {
      if (this.spotify.connecting) sub = "CONNECTING...";
      else if (this.spotify.track) sub = `<span class="track">${escapeHtml(this.spotify.track)}</span>`;
      else if (this.spotify.token) sub = st.tag || "SPOTIFY";
      else sub = "TAP TO CONNECT (PREMIUM)";
    }
    this.subEl.innerHTML = sub + (st.id !== "off" && !this.status ? "" : "");
  }

  #flash() {
    this.el.classList.add("flash");
    clearTimeout(this.flashT);
    this.flashT = setTimeout(() => this.el.classList.remove("flash"), 600);
  }

  // ---------- Spotify (PKCE + Web Playback SDK) ----------

  #redirectUri() {
    return location.origin + location.pathname;
  }

  #showSpotifySetup() {
    if (document.getElementById("sp-modal")) return;
    const modal = document.createElement("div");
    modal.id = "sp-modal";
    const cid = localStorage.getItem(LS.clientId) || "";
    const pl = localStorage.getItem(LS.playlist) || "";
    modal.innerHTML = `
      <div class="box">
        <h3>CONNECT SPOTIFY</h3>
        <div>Needs Spotify <b>Premium</b>. Dev API is free — you create a one-time app.</div>
        <ol>
          <li><a href="https://developer.spotify.com/dashboard" target="_blank">developer.spotify.com/dashboard</a> → CREATE APP</li>
          <li>Redirect URI: <code>${this.#redirectUri()}</code> · enable <b>Web Playback SDK</b></li>
          <li>Paste <b>Client ID</b> below</li>
        </ol>
        <div class="lbl">CLIENT ID</div>
        <input id="sp-cid" placeholder="SPOTIFY CLIENT ID" value="${escapeHtml(cid)}" spellcheck="false" />
        <div class="lbl">OPTIONAL — override NIGHT DRIVE playlist (local only)</div>
        <input id="sp-pl" placeholder="https://open.spotify.com/playlist/..." value="${escapeHtml(pl)}" spellcheck="false" />
        <div class="hint">Stations live in <code>data/radio-stations.json</code> — playlist, podcast show, or episode URLs. Each player logs into their own Spotify (Premium). Tuning costs ~3 API calls; streams cost zero. SomaFM stations need no login.</div>
        <div class="row">
          <button id="sp-go">CONNECT →</button>
          <button class="alt" id="sp-cancel">CANCEL</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector("#sp-cancel").addEventListener("click", () => modal.remove());
    modal.querySelector("#sp-go").addEventListener("click", async () => {
      const id = modal.querySelector("#sp-cid").value.trim();
      const pl = modal.querySelector("#sp-pl").value.trim();
      if (id.length < 16 && !this.spotify.token) return;
      if (id.length >= 16) localStorage.setItem(LS.clientId, id);
      if (pl) localStorage.setItem(LS.playlist, pl);
      modal.remove();
      if (this.spotify.token) {
        this.#playStationSpotify(this.station()).catch(() => {});
        return;
      }
      await this.#startAuth(id);
    });
  }

  async #startAuth(clientId) {
    const verifier = randomString(64);
    localStorage.setItem(LS.verifier, verifier);
    const challenge = base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: this.#redirectUri(),
      code_challenge_method: "S256",
      code_challenge: challenge,
      scope: SPOTIFY_SCOPES,
    });
    location.href = "https://accounts.spotify.com/authorize?" + params;
  }

  async #handleAuthCallback() {
    const code = new URLSearchParams(location.search).get("code");
    if (!code) return;
    history.replaceState(null, "", this.#redirectUri()); // clean the URL
    const clientId = localStorage.getItem(LS.clientId);
    const verifier = localStorage.getItem(LS.verifier);
    if (!clientId || !verifier) return;
    try {
      const res = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          grant_type: "authorization_code",
          code,
          redirect_uri: this.#redirectUri(),
          code_verifier: verifier,
        }),
      });
      const tok = await res.json();
      if (tok.access_token) {
        this.#storeToken(tok);
        const firstSp = this.stations.findIndex((s) => this.#isSpotifyStation(s));
        const saved = localStorage.getItem(LS.station);
        const savedIdx = this.stations.findIndex((s) => s.id === saved);
        this.idx = savedIdx >= 0 && this.#isSpotifyStation(this.stations[savedIdx])
          ? savedIdx
          : Math.max(firstSp, 0);
        localStorage.setItem(LS.station, this.station().id);
        await this.#initSpotify();
        this.#playStationSpotify(this.station()).catch(() => {});
      }
    } catch {
      this.status = "AUTH FAILED";
    }
    this.#render();
  }

  #storeToken(tok) {
    this.spotify.token = tok.access_token;
    this.spotify.expires = Date.now() + (tok.expires_in - 60) * 1000;
    if (tok.refresh_token) localStorage.setItem(LS.refresh, tok.refresh_token);
  }

  async #freshToken() {
    if (this.spotify.token && Date.now() < this.spotify.expires) return this.spotify.token;
    const refresh = localStorage.getItem(LS.refresh);
    const clientId = localStorage.getItem(LS.clientId);
    if (!refresh || !clientId) return null;
    try {
      const res = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: clientId, grant_type: "refresh_token", refresh_token: refresh }),
      });
      const tok = await res.json();
      if (tok.access_token) { this.#storeToken(tok); return this.spotify.token; }
    } catch { /* offline */ }
    return null;
  }

  async #ensureSpotify({ keepStation = false } = {}) {
    if (!keepStation) {
      const st = this.station();
      if (!this.#isSpotifyStation(st)) {
        const idx = this.stations.findIndex((s) => this.#isSpotifyStation(s));
        if (idx >= 0) this.idx = idx;
      }
    }
    await this.#initSpotify();
  }

  async #waitReady(timeoutMs = 10000) {
    await this.#initSpotify();
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (this.spotify.ready && this.spotify.deviceId) return true;
      await new Promise((r) => setTimeout(r, 150));
    }
    return false;
  }

  #bossOverrides() {
    try { return JSON.parse(localStorage.getItem(LS.bossTracks) || "{}"); }
    catch { return {}; }
  }

  async #api(method, path, body) {
    const token = await this.#freshToken();
    if (!token) throw new Error("no token");
    const res = await fetch("https://api.spotify.com/v1" + path, {
      method,
      headers: {
        Authorization: "Bearer " + token,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || res.statusText);
    return data;
  }

  async #transferToGameDevice() {
    const id = this.spotify.deviceId;
    if (!id) return;
    await this.#api("PUT", "/me/player", { device_ids: [id], play: false });
  }

  async #playParsed(parsed, { shuffle = false } = {}) {
    if (!parsed) return;
    await this.#transferToGameDevice();

    if (parsed.type === "track" || parsed.type === "episode") {
      await this.#api("PUT", "/me/player/play?device_id=" + encodeURIComponent(this.spotify.deviceId), {
        uris: [parsed.uri],
      });
      return;
    }

    if (parsed.type === "playlist" || parsed.type === "album" || parsed.type === "show") {
      await this.#api("PUT", "/me/player/shuffle?state=" + (shuffle ? "true" : "false") + "&device_id=" + encodeURIComponent(this.spotify.deviceId));
      await this.#api("PUT", "/me/player/play?device_id=" + encodeURIComponent(this.spotify.deviceId), {
        context_uri: parsed.uri,
      });
    }
  }

  async #playSearch(query) {
    const data = await this.#api("GET", "/search?" + new URLSearchParams({
      q: query,
      type: "track",
      limit: "1",
    }));
    const track = data.tracks?.items?.[0];
    if (!track?.uri) {
      this.status = "TRACK NOT FOUND";
      this.#render();
      return;
    }
    await this.#playParsed(parseSpotify(track.uri));
  }

  async #initSpotify() {
    if (this.spotify.player) {
      this.spotify.player.activateElement?.();
      if (this.spotify.deviceId) this.spotify.ready = true;
      this.#render();
      return;
    }
    const token = await this.#freshToken();
    if (!token) { this.#render(); return; } // not connected yet -> click to set up
    this.spotify.connecting = true;
    this.#render();

    if (!window.Spotify) {
      await new Promise((resolve) => {
        window.onSpotifyWebPlaybackSDKReady = resolve;
        const s = document.createElement("script");
        s.src = "https://sdk.scdn.co/spotify-player.js";
        document.head.appendChild(s);
      });
    }

    const player = new window.Spotify.Player({
      name: "RETRO RACER SF",
      getOAuthToken: (cb) => this.#freshToken().then((t) => cb(t)),
      volume: this.audio.volume,
    });
    player.addListener("player_state_changed", (st) => {
      if (!st) { this.spotify.track = ""; this.#render(); return; }
      const tr = st.track_window?.current_track;
      this.spotify.paused = st.paused;
      this.spotify.track = tr ? `${tr.name} — ${tr.artists.map((a) => a.name).join(", ")}` : "";
      this.#render();
    });
    player.addListener("ready", ({ device_id }) => {
      this.spotify.deviceId = device_id;
      this.spotify.connecting = false;
      this.spotify.ready = true;
      this.#render();
    });
    player.addListener("initialization_error", () => { this.status = "SDK ERROR"; this.spotify.connecting = false; this.#render(); });
    player.addListener("authentication_error", () => { this.status = "AUTH ERROR"; this.spotify.connecting = false; this.#render(); });
    player.addListener("account_error", () => { this.status = "PREMIUM REQUIRED"; this.spotify.connecting = false; this.#render(); });
    await player.connect();
    this.spotify.player = player;
  }
}

function randomString(n) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const arr = crypto.getRandomValues(new Uint8Array(n));
  let out = "";
  for (const b of arr) out += chars[b % chars.length];
  return out;
}

function base64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
