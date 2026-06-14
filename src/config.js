/** WebSocket URL for multiplayer. Override with localStorage key `sfracer_mp_url`. */
export function mpWsUrl() {
  try {
    const saved = localStorage.getItem("sfracer_mp_url");
    if (saved) return saved;
  } catch {
    /* private browsing */
  }
  const host = location.hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    return `ws://${host}:8787`;
  }
  // Production AWS EC2 relay — local dev uses localhost; Vercel needs wss:// (CloudFront).
  // Override anytime: localStorage.setItem('sfracer_mp_url', 'wss://...')
  return "ws://34.234.135.117:8787";
}
