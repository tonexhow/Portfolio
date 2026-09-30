const ACCESS_STATE_KEY = "jpano-management-access";

export function initAccessShell() {
  window.UI.Theme.init();
  updateClock();
  const timer = window.setInterval(updateClock, 1000);
  window.addEventListener("pagehide", () => clearInterval(timer), { once: true });
}

export function updateClock() {
  const date = document.querySelector("#accessDate");
  const time = document.querySelector("#accessTime");
  const now = new Date();
  if (date) date.textContent = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(now);
  if (time) time.textContent = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(now);
}

export function collectDeviceInfo() {
  const nav = navigator;
  return {
    user_agent: nav.userAgent || "",
    platform: nav.userAgentData?.platform || nav.platform || "",
    language: nav.language || "",
    languages: Array.isArray(nav.languages) ? nav.languages.join(", ") : "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    screen_width: screen?.width || 0,
    screen_height: screen?.height || 0,
    color_depth: screen?.colorDepth || 0,
    hardware_concurrency: nav.hardwareConcurrency || 0,
    device_memory: nav.deviceMemory || 0,
    touch_points: nav.maxTouchPoints || 0
  };
}

export function saveAccessState(data) {
  const state = {
    request_id: data.request_id,
    expires_at: data.expires_at,
    destination: data.destination || "configured email"
  };
  localStorage.setItem(ACCESS_STATE_KEY, JSON.stringify(state));
  return state;
}

export function readAccessState() {
  try {
    const raw = localStorage.getItem(ACCESS_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.request_id) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearAccessState() {
  localStorage.removeItem(ACCESS_STATE_KEY);
}

export async function recoverPendingState() {
  const saved = readAccessState();
  let pending;
  try { pending = await window.APIManager.getPendingAccess(); }
  catch { return saved; } // A network outage must not erase an in-progress verification.
  if (!pending?.active) {
    clearAccessState();
    return null;
  }
  if (!pending.destination && saved?.destination) pending.destination = saved.destination;
  return saveAccessState(pending);
}

export function formatRemaining(ms) {
  const safe = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function setStatus(root, title, text, mode = "") {
  if (!root) return;
  root.classList.remove("working", "error");
  if (mode) root.classList.add(mode);
  const strong = root.querySelector("strong");
  const paragraph = root.querySelector("p");
  if (strong) strong.textContent = title;
  if (paragraph) paragraph.textContent = text;
}
