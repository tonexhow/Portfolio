(() => {
  "use strict";
  const config = window.APP_CONFIG || {};
  const base = String(config.apiBaseURL || "").replace(/\/$/, "");
  const cacheKey = `jpano-public-v4:${base}`;
  const signalKey = `${cacheKey}:signal`;
  let snapshot = null, bundled = null, loading = null, refreshing = null, directRefreshing = null;
  let channel = null;
  try { channel = new BroadcastChannel("jpano-public-updates-v4"); } catch {}
  const valid = data => data && data.schema_version === 1 && data.information && typeof data.information === "object"
    && Array.isArray(data.projects) && Array.isArray(data.certificates) && Array.isArray(data.feedback) && (data.career_profiles === undefined || Array.isArray(data.career_profiles));
  const emit = source => document.dispatchEvent(new CustomEvent("portfolio:content-updated", { detail: { source, revision: snapshot?.revision } }));
  function cache(data) { try { localStorage.setItem(cacheKey, JSON.stringify(data)); } catch {} }
  function restore() { try { const data = JSON.parse(localStorage.getItem(cacheKey)); if (valid(data)) snapshot = data; } catch {} }
  restore();
  async function init() {
    if (loading) { await loading; return snapshot; }
    loading = (async () => {
      try {
        const response = await fetch("/assets/data/public-snapshot.json", { cache: "no-cache", signal: AbortSignal.timeout(5000) });
        const data = await response.json();
        if (!response.ok || !valid(data)) throw new Error("Invalid public fallback.");
        bundled = data;
        if (!snapshot || Date.parse(data.updated_at) > Date.parse(snapshot.updated_at)) snapshot = data;
      } catch (error) { console.warn("Public fallback:", error.message); }
      if (!snapshot) snapshot = { schema_version: 1, revision: -1, information: {}, profiles: { items: [] }, projects: [], certificates: [], feedback: [], career_profiles: [] };
      return snapshot;
    })();
    await loading; return snapshot;
  }
  function apiURL(path) {
    if (!path) return "";
    if (/^https?:\/\//i.test(path)) return path;
    if (String(path).startsWith("/api/") || String(path).startsWith("/auth/")) return `${base}${path}`;
    return path;
  }
  function safeURL(value, { image = false } = {}) {
    if (typeof value !== "string" || !value.trim()) return "";
    value = value.trim();
    try {
      const parsed = new URL(value, document.baseURI);
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return "";
      if (image && value.startsWith("/") && !value.startsWith("//")) return apiURL(value);
      return parsed.href;
    } catch { return ""; }
  }
  function mediaURL(value, fallback = "/assets/projects/project-placeholder.svg") {
    if (!value) return fallback;
    const raw = String(value);
    if (window.ServerStatus?.online === false && raw.startsWith("/api/")) {
      const match = raw.match(/^\/api\/public\/certificates\/(\d+)\//);
      if (match) {
        const record = bundled?.certificates.find(item => String(item.id) === match[1]);
        if (record) return raw.includes("/download") ? record.download_url : record.image_url;
      }
      for (const project of bundled?.projects || []) {
        const live = snapshot?.projects.find(p => p.key === project.key);
        if (!live) continue;
        if (live.icon === raw && project.icon && !project.icon.startsWith("/api/")) return project.icon;
        const index = live.images?.indexOf(raw) ?? -1;
        if (index >= 0 && project.images?.[index] && !project.images[index].startsWith("/api/")) return project.images[index];
      }
      return fallback;
    }
    return safeURL(raw, { image: true }) || fallback;
  }

  // Optional DIRECT PUBLIC READ: only published projects are returned by the
  // explicitly granted public.jpano_public_projects() RPC. No client SQL,
  // service_role key, private schema exposure, or write permissions are used.
  function directProjectsConfigured() {
    return /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(String(config.supabaseURL || ""))
      && Boolean(config.supabasePublishableKey);
  }
  async function refreshDirectSnapshot() {
    if (!directProjectsConfigured()) return null;
    await init();
    const response = await fetch(`${config.supabaseURL}/rest/v1/rpc/jpano_public_snapshot`,{
      method:"POST",cache:"no-store",credentials:"omit",
      headers:{apikey:config.supabasePublishableKey,"Content-Type":"application/json"},
      body:"{}",signal:AbortSignal.timeout(8000)
    });
    if(!response.ok)throw new Error(`Public Supabase snapshot returned HTTP ${response.status}.`);
    const data=await response.json();
    if(!valid(data)||JSON.stringify(data).length>2*1024*1024||
       data.projects.some(p=>p.visible!==true)||data.feedback.some(f=>f.status==='pending'))throw new Error("Invalid published Supabase response.");
    // Only public records enter the browser cache; private schema remains inaccessible.
    if(!snapshot || Number(data.revision)>=Number(snapshot.revision)||data.updated_at>snapshot.updated_at){
      snapshot=data;cache(data);emit("supabase-snapshot");
    }
    return snapshot;
  }
  async function refreshDirectPublic(){
    if(!directProjectsConfigured())return null;
    try{return await refreshDirectSnapshot()}
    catch{return refreshDirectProjects()}
  }
  async function refreshDirectProjects() {
    if (!directProjectsConfigured()) return null;
    if (directRefreshing) return directRefreshing;
    directRefreshing = (async () => {
      await init();
      const endpoint = `${config.supabaseURL}/rest/v1/rpc/jpano_public_projects`;
      const response = await fetch(endpoint, {
        method: "POST", cache: "no-store", credentials: "omit",
        headers: { apikey: config.supabasePublishableKey, "Content-Type": "application/json" },
        body: "{}", signal: AbortSignal.timeout(7000)
      });
      if (!response.ok) throw new Error(`Public Supabase request returned HTTP ${response.status}.`);
      const rows = await response.json();
      if (!Array.isArray(rows) || rows.length > 500 || rows.some(item =>
        !item || typeof item.key !== "string" || typeof item.name !== "string" ||
        item.visible !== true || !Array.isArray(item.images) || !Array.isArray(item.stack))) {
        throw new Error("Invalid public project response.");
      }
      // Keep feedback, documents, and information from the existing public
      // snapshot until their dedicated public-only read surfaces are approved.
      snapshot = { ...snapshot, projects: rows };
      cache(snapshot);
      emit("supabase-projects");
      return snapshot;
    })().finally(() => { directRefreshing = null; });
    return directRefreshing;
  }
  async function refresh({ broadcast = false } = {}) {
    await init();
    if (refreshing) return refreshing;
    refreshing = (async () => {
      let data;
      try {
        data = await window.APIManager.request("/api/public/snapshot", { cache: "no-store" });
        if (!valid(data)) throw new Error("Invalid portfolio update.");
      } catch (error) {
        // When Go is offline, a configured Supabase read-only RPC can still
        // deliver freshly published projects. Otherwise keep the bundled copy.
        if (directProjectsConfigured()) return refreshDirectPublic();
        throw error;
      }
      snapshot = data; cache(data); emit("server");
      if (broadcast) {
        const signal = { base, revision: data.revision, timestamp: Date.now() };
        try { localStorage.setItem(signalKey, JSON.stringify(signal)); channel?.postMessage(signal); } catch {}
      }
      return data;
    })().finally(() => { refreshing = null; });
    return refreshing;
  }
  async function page(kind, number = 1, limit = 9) {
    const data = await init();
    const all = data[kind] || [];
    limit = Math.max(1, Math.min(kind === "projects" ? 9 : kind === "feedback" ? 5 : 6, Number(limit) || 9));
    const pages = Math.max(1, Math.ceil(all.length / limit));
    number = Math.max(1, Math.min(pages, Math.floor(Number(number) || 1)));
    let items = all.slice((number - 1) * limit, number * limit).map(item => ({ ...item }));
    if (kind === "certificates") items = items.map(item => ({ ...item, image_url: mediaURL(item.image_url), download_url: mediaURL(item.download_url) }));
    if (kind === "feedback") items = items.map(item => ({ ...item, avatar_url: item.avatar_url ? mediaURL(item.avatar_url, "") : "" }));
    return { items, page: number, page_size: limit, total: all.length, total_pages: pages,
      has_previous: number > 1, has_next: number < pages,
      rating_count: all.length, average_rating: all.length ? all.reduce((sum, item) => sum + (Number(item.rating) || 0), 0) / all.length : 0 };
  }
  function receive(signal) {
    if (signal?.base !== base) return;
    restore(); emit("another-tab");
    if (window.ServerStatus?.online) void refresh().catch(() => {});
  }
  if (channel) channel.onmessage = event => receive(event.data);
  addEventListener("storage", event => { if (event.key === signalKey) { try { receive(JSON.parse(event.newValue)); } catch {} } });
  document.addEventListener("portfolio:server-status", () => { if (snapshot) emit("connection"); });
  window.PublicStore = Object.freeze({ init, refresh, refreshDirectProjects, refreshDirectPublic, page, apiURL, mediaURL, safeURL,
    get current() { return snapshot; }, get revision() { return snapshot?.revision; } });
})();
