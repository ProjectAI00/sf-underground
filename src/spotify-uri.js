/** Parse Spotify URLs / URIs → { type, id, uri } */

export function parseSpotify(input) {
  if (!input || typeof input !== "string") return null;
  const s = input.trim();
  if (!s) return null;

  let m = s.match(/^spotify:(track|episode|playlist|album|show):([a-zA-Z0-9]+)/);
  if (m) return { type: m[1], id: m[2], uri: `spotify:${m[1]}:${m[2]}` };

  m = s.match(/open\.spotify\.com\/(track|episode|playlist|album|show)\/([a-zA-Z0-9]+)/);
  if (m) return { type: m[1], id: m[2], uri: `spotify:${m[1]}:${m[2]}` };

  return null;
}

export function isPlayableUri(uri) {
  const p = parseSpotify(uri);
  return p && (p.type === "track" || p.type === "episode" || p.type === "playlist" || p.type === "album" || p.type === "show");
}
