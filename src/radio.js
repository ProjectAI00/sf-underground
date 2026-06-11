// In-game radio, top-center HUD. Two backends:
//  1. Built-in internet radio stations (SomaFM streams) — work instantly.
//  2. Spotify Connect: the game registers as a Spotify playback device via the
//     Web Playback SDK (requires Spotify Premium + a user-created app Client
//     ID, PKCE flow — no server needed). Pick "SF UNDERGROUND RADIO" in any
//     Spotify app and music/podcasts play here with track info in the HUD.

const STATIONS = [
  { id: "off", name: "RADIO OFF", tag: "" },
  { id: "u80s", name: "UNDERGROUND 80s", tag: "SYNTH // NEW WAVE", url: "https://ice2.somafm.com/u80s-128-mp3" },
  { id: "groove", name: "GROOVE SALAD", tag: "CHILL BEATS", url: "https://ice1.somafm.com/groovesalad-128-mp3" },
  { id: "defcon", name: "DEF CON RADIO", tag: "HACKER ELECTRONIC", url: "https://ice1.somafm.com/defcon-128-mp3" },
  { id: "secret", name: "SECRET AGENT", tag: "SPY LOUNGE", url: "https://ice1.somafm.com/secretagent-128-mp3" },
  { id: "metal", name: "METAL DETECTOR", tag: "METAL", url: "https://ice1.somafm.com/metal-128-mp3" },
  { id: "spotify", name: "SPOTIFY", tag: "CONNECT YOUR ACCOUNT" },
];

const SPOTIFY_SCOPES = "streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state";
const LS = {
  station: "sfradio_station",
  volume: "sfradio_volume",
  clientId: "sfradio_sp_client",
  refresh: "sfradio_sp_refresh",
  verifier: "sfradio_sp_verifier",
};

export class Radio {
  constructor() {
    this.idx = 0;
    this.audio = new Audio();
    this.audio.crossOrigin = "anonymous";
    this.audio.volume = parseFloat(localStorage.getItem(LS.volume) || "0.5");
    this.status = ""; // "", "TUNING...", error text
    this.spotify = { player: null, token: null, expires: 0, track: "", paused: true, connecting: false };

    this.#buildUI();
    this.#handleAuthCallback();

    const saved = localStorage.getItem(LS.station);
    const savedIdx = STATIONS.findIndex((s) => s.id === saved);
    // resume saved station on first user gesture (autoplay policy)
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

    this.audio.addEventListener("playing", () => { this.status = ""; this.#render(); });
    this.audio.addEventListener("waiting", () => { this.status = "TUNING..."; this.#render(); });
    this.audio.addEventListener("error", () => {
      if (this.station().url) { this.status = "NO SIGNAL"; this.#render(); }
    });
  }

  station() { return STATIONS[this.idx]; }

  cycle(dir = 1) {
    this.tuneTo((this.idx + dir + STATIONS.length) % STATIONS.length);
  }

  tuneTo(i) {
    this.idx = i;
    const st = this.station();
    localStorage.setItem(LS.station, st.id);
    this.status = "";

    // stop whatever was playing
    this.audio.pause();
    if (this.spotify.player && st.id !== "spotify") this.spotify.player.pause().catch(() => {});

    if (st.url) {
      this.status = "TUNING...";
      this.audio.src = st.url;
      this.audio.play().catch(() => { this.status = "CLICK TO PLAY"; this.#render(); });
    } else if (st.id === "spotify") {
      this.#initSpotify();
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
      if (st.id === "spotify" && !this.spotify.token) this.#showSpotifySetup();
      else if (st.url && this.audio.paused) this.audio.play().catch(() => {});
    });
    this.#render();
  }

  #render() {
    const st = this.station();
    this.nameEl.textContent = st.name;
    this.volEl.textContent = "VOL " + Math.round(this.audio.volume * 10);
    let sub = st.tag || "";
    if (this.status) sub = this.status;
    if (st.id === "spotify") {
      if (this.spotify.connecting) sub = "CONNECTING...";
      else if (this.spotify.track) sub = `<span class="track">${escapeHtml(this.spotify.track)}</span>`;
      else if (this.spotify.token) sub = "PICK 'SF UNDERGROUND RADIO' IN YOUR SPOTIFY APP";
      else sub = "CLICK TO CONNECT (PREMIUM)";
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
    modal.innerHTML = `
      <div class="box">
        <h3>CONNECT SPOTIFY</h3>
        <div>One-time setup (needs Spotify <b>Premium</b>):</div>
        <ol>
          <li>Open <a href="https://developer.spotify.com/dashboard" target="_blank">developer.spotify.com/dashboard</a> → CREATE APP</li>
          <li>Name: anything · Redirect URI: <code>${this.#redirectUri()}</code> · check "Web Playback SDK"</li>
          <li>Copy the app's <b>Client ID</b> and paste it below</li>
        </ol>
        <div>TIP: open the game via <code>http://127.0.0.1:8847/</code> — Spotify accepts that as a redirect URI.</div>
        <input id="sp-cid" placeholder="SPOTIFY CLIENT ID" value="${escapeHtml(cid)}" spellcheck="false" />
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
      if (id.length < 16) return;
      localStorage.setItem(LS.clientId, id);
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
        this.idx = STATIONS.findIndex((s) => s.id === "spotify");
        localStorage.setItem(LS.station, "spotify");
        this.#initSpotify();
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

  async #initSpotify() {
    if (this.spotify.player) { this.spotify.player.activateElement?.(); this.#render(); return; }
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
      name: "SF UNDERGROUND RADIO",
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
    player.addListener("ready", () => { this.spotify.connecting = false; this.#render(); });
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
