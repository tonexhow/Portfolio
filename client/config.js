// Public deployment settings only. Vercel's build regenerates this file.
window.APP_CONFIG = Object.freeze({
  apiBaseURL: ["localhost", "127.0.0.1", "::1"].includes(location.hostname) ? "http://127.0.0.1:48000" : "https://api.jpano.dev",
  statusIntervalMs: 30000,
  requestTimeoutMs: 7000
});
