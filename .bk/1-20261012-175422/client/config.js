// Local-development fallback only. Vercel's build regenerates dist/config.js
// from API_ORIGIN (with PUBLIC_API_BASE_URL kept as a compatibility fallback).
const isLocalPortfolio = ["localhost", "127.0.0.1", "::1"].includes(location.hostname);
window.APP_CONFIG = Object.freeze({
  apiBaseURL: isLocalPortfolio ? "http://127.0.0.1:48000" : "",
  statusIntervalMs: 30000,
  requestTimeoutMs: 7000
});
