// Public runtime configuration for Vercel. This is a SERVERLESS FUNCTION,
// not a static copy of .env. Read only allowlisted browser-safe values on
// each invocation. Never serialize credentials, database URLs or tokens.
export function publicClientConfig(environment = process.env) {
  const raw = String(environment.PUBLIC_API_BASE_URL || environment.API_ORIGIN || "").trim();
  if (!raw) throw new Error("Set PUBLIC_API_BASE_URL in the frontend hosting environment.");
  let url;
  try { url = new URL(raw); } catch { throw new Error("PUBLIC_API_BASE_URL must be a valid HTTP(S) origin."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("PUBLIC_API_BASE_URL must be an origin without paths, credentials or parameters.");
  }
  if (url.protocol !== "https:" && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("The public API must use HTTPS.");
  }
  const supabaseURL = String(environment.PUBLIC_SUPABASE_URL || "").trim();
  const supabasePublishableKey = String(environment.PUBLIC_SUPABASE_PUBLISHABLE_KEY || "").trim();
  if ((supabaseURL || supabasePublishableKey) &&
      (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseURL) || !supabasePublishableKey)) {
    throw new Error("Public Supabase configuration is incomplete.");
  }
  if (supabasePublishableKey) {
    let valid = /^sb_publishable_[A-Za-z0-9_-]+$/.test(supabasePublishableKey);
    if (!valid && /^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(supabasePublishableKey)) {
      try { valid = JSON.parse(Buffer.from(supabasePublishableKey.split(".")[1], "base64url").toString("utf8")).role === "anon"; } catch { valid = false; }
    }
    if (!valid) throw new Error("Only a public Supabase publishable/anon key may be sent to the browser.");
  }
  return Object.freeze({
    apiBaseURL: url.origin,
    supabaseURL,
    supabasePublishableKey,
    statusIntervalMs: 30000,
    requestTimeoutMs: 7000
  });
}

export function renderPublicConfig(config) {
  const serialized = JSON.stringify(config).replace(/</g, "\\u003c");
  return `window.APP_CONFIG=Object.freeze(${serialized});\n` +
    `try { if (location.protocol === "http:" && location.hostname === "localhost" && new URL(window.APP_CONFIG.apiBaseURL).hostname === "127.0.0.1") { location.replace(\`http://127.0.0.1:\${location.port}\${location.pathname}\${location.search}\${location.hash}\`); } } catch {}\n`;
}

export default function handler(req, res) {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "private, no-store, max-age=0, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, HEAD");
    res.end("// Method not allowed.\n");
    return;
  }
  try {
    const script = renderPublicConfig(publicClientConfig(process.env));
    res.statusCode = 200;
    res.end(req.method === "HEAD" ? "" : script);
  } catch (error) {
    // No raw .env contents or secret values are returned to visitors.
    res.statusCode = 503;
    res.end("// Portfolio runtime configuration is unavailable. Check PUBLIC_API_BASE_URL.\n");
  }
}
