// Local-development fallback only. Vercel's build regenerates dist/config.js
// from API_ORIGIN (with PUBLIC_API_BASE_URL kept as a compatibility fallback).
const isLocalPortfolio = ["localhost", "127.0.0.1", "::1"].includes(location.hostname);
window.APP_CONFIG = Object.freeze({
  apiBaseURL: isLocalPortfolio ? "http://127.0.0.1:48000" : "",
  // Optional: public, read-only Supabase RPC. Leave unset until staging RLS/security checks pass.
  supabaseURL: "",
  supabasePublishableKey: "",
  statusIntervalMs: 30000,
  requestTimeoutMs: 7000
});

// Management cookies and OAuth callbacks must not mix localhost with 127.0.0.1.
// In local development, follow the API's loopback hostname consistently.
try {
  if (location.protocol === "http:" && location.hostname === "localhost" &&
      new URL(window.APP_CONFIG.apiBaseURL).hostname === "127.0.0.1") {
    location.replace(`http://127.0.0.1:${location.port}${location.pathname}${location.search}${location.hash}`);
  }
} catch { /* A missing custom config must not block the portfolio. */ }
