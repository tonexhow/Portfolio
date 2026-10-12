(() => {
  "use strict";
  // Management readiness requires trusted Go + PostgreSQL. Public database
  // availability is independently verified using Supabase public-read RPCs.
  // A public connection must NEVER unlock privileged admin actions.
  let online = null, ready = null, directPublic = false, aiOnline = false, aiConfigured = false;
  let databaseReason = "", databaseAdvice = "", checking = null, initialized = false;
  const locked = new Map();
  const selector = "[data-requires-server], #feedbackIdentityButton, #feedbackAuthClear, [data-feedback-provider], #contactGoogleButton, #contactSubmit, #feedbackSubmit, #endSessionButton, #confirmEndSession, #saveInformationButton, #confirmInformationSave, #addProjectButton, #editProjectPositionButton, [data-project-visible], [data-project-ping], [data-project-edit], [data-project-delete], [data-move-project], [data-refresh-view], .admin-body form button[type=submit], .access-body form button[type=submit], #saveProjectButton, #saveCertificateButton, #addCertificateButton, [data-certificate-edit], [data-certificate-delete], [data-certificate-visible], [data-certificate-pin], [data-contact-action], [data-feedback-action], [data-action]";
  let portal = null, activeIndicator = null, lastDetails = [];

  function publicDatabaseOnline() { return directPublic === true || ready === true; }
  function level() {
    const allFull = online === true && publicDatabaseOnline() && aiOnline === true;
    const anyUseful = online === true || publicDatabaseOnline() || aiOnline === true;
    return allFull ? "good" : anyUseful ? "warning" : "danger";
  }
  const statusLabel = state => state ? "Online" : "Unavailable";
  function detailLines() {
    const db = directPublic && ready ? "Supabase public reads and Go management database are available"
      : directPublic ? "Supabase public records are online; privileged management still requires Go"
      : ready ? "Go management database is connected; direct Supabase public reads are not verified"
      : "Public database access is not verified; cached published content may still display";
    const ai = aiOnline ? "Assistant answers are available"
      : aiConfigured ? "Assistant may respond with its built-in portfolio knowledge"
      : "Portfolio guidance remains available";
    return [
      { name: "Server", state: online === true, detail: online === true ? "Connected to website services" : "Some interactive features are temporarily unavailable" },
      { name: "Database", state: publicDatabaseOnline(), detail: db, label: directPublic && !ready ? "Online (public)" : undefined },
      { name: "AI Assistant", state: aiOnline, detail: ai, label: aiConfigured && !aiOnline ? "Limited" : undefined, pending: aiConfigured && !aiOnline }
    ];
  }
  function healthSummary() {
    const value = level();
    return value === "good" ? "All three services operational" : value === "danger" ? "No service currently verified online" : "One or more services unavailable";
  }
  function ensurePortal() {
    if (portal || !document.body) return;
    portal = document.createElement("div");
    portal.id = "jpano-service-popover";
    portal.className = "service-health-popover";
    portal.setAttribute("role", "tooltip");
    portal.hidden = true;
    document.body.append(portal);
    for (const name of ["scroll", "resize"]) {
      addEventListener(name, () => { if (activeIndicator) placePortal(activeIndicator); }, { passive: true, capture: name === "scroll" });
    }
    document.addEventListener("keydown", e => { if (e.key === "Escape") hidePortal(); });
    document.addEventListener("pointerdown", e => {
      if (activeIndicator && !e.target.closest?.("[data-backend-status]")) hidePortal();
    });
  }
  function placePortal(node) {
    if (!portal || portal.hidden || !node?.isConnected) return;
    const rect = node.getBoundingClientRect(), pad = 12, width = Math.min(350, innerWidth - pad * 2);
    portal.style.width = `${width}px`;
    const left = Math.min(Math.max(pad, rect.right - width), innerWidth - pad - width);
    const height = portal.getBoundingClientRect().height;
    const below = innerHeight - rect.bottom - pad >= height + 10;
    const top = below ? rect.bottom + 10 : Math.max(pad, rect.top - height - 10);
    portal.style.left = `${left}px`;
    portal.style.top = `${top}px`;
  }
  function paintPortal() {
    if (!portal) return;
    portal.replaceChildren();
    const heading = document.createElement("div"); heading.className = "service-health-heading";
    const title = document.createElement("strong"); title.textContent = "Service health";
    const summary = document.createElement("span"); summary.textContent = healthSummary(); summary.dataset.level = level();
    heading.append(title, summary); portal.append(heading);
    for (const item of lastDetails) {
      const row = document.createElement("div"); row.className = "service-health-row";
      const dot = document.createElement("span"); dot.className = "service-health-dot"; dot.dataset.state = item.state ? "online" : item.pending ? "pending" : "offline";
      const info = document.createElement("div"), label = document.createElement("strong"), note = document.createElement("small");
      label.textContent = item.name; note.textContent = item.detail; info.append(label, note);
      const state = document.createElement("span"); state.className = "service-health-value"; state.textContent = item.label || statusLabel(item.state);
      row.append(dot, info, state); portal.append(row);
    }
    if (document.body?.classList.contains("admin-body") && ready !== true && online === true && databaseAdvice) {
      const hint = document.createElement("p"); hint.className = "service-health-advice"; hint.textContent = databaseAdvice;
      portal.append(hint);
    }
    if (activeIndicator) placePortal(activeIndicator);
  }
  function showPortal(node) {
    ensurePortal(); if (!portal) return;
    activeIndicator = node; portal.hidden = false;
    paintPortal(); placePortal(node);
    node.setAttribute("aria-describedby", portal.id);
  }
  function hidePortal() {
    if (activeIndicator) activeIndicator.removeAttribute("aria-describedby");
    activeIndicator = null; if (portal) portal.hidden = true;
  }
  function bindIndicator(node) {
    if (node.dataset.healthBound) return;
    node.dataset.healthBound = "true";
    // The old CSS tooltip was clipped by the header. This content is portaled.
    node.querySelector(".backend-tooltip")?.remove();
    node.removeAttribute("data-tooltip");
    node.addEventListener("mouseenter", () => showPortal(node));
    node.addEventListener("mouseleave", () => { if (document.activeElement !== node) hidePortal(); });
    node.addEventListener("focus", () => showPortal(node));
    node.addEventListener("blur", () => hidePortal());
    node.addEventListener("click", () => activeIndicator === node ? hidePortal() : showPortal(node));
  }
  function paint() {
    const serverOnline = online === true, databaseReady = ready === true;
    const publicReady = publicDatabaseOnline();
    document.documentElement.dataset.serverStatus = serverOnline ? "online" : "offline";
    document.documentElement.dataset.serverReady = databaseReady ? "ready" : "not-ready";
    document.documentElement.dataset.publicDatabase = publicReady ? "online" : "offline";
    document.documentElement.dataset.serviceHealth = level();
    lastDetails = detailLines();
    const summary = healthSummary();
    document.querySelectorAll("[data-backend-status]").forEach(node => {
      bindIndicator(node);
      node.dataset.state = level();
      node.setAttribute("aria-label", `${summary}. Server: ${statusLabel(serverOnline)}. Database: ${publicReady ? directPublic && !databaseReady ? "Online for public reads" : "Available" : "Unavailable"}. AI assistant: ${statusLabel(aiOnline)}. Focus for details.`);
    });
    paintPortal();
    document.querySelectorAll("[data-offline-notice]").forEach(node => {
      node.hidden = databaseReady;
      if (!databaseReady) {
        const isAdmin = document.body?.classList.contains("admin-body");
        if (!isAdmin) {
          node.textContent = "Some interactive features are temporarily unavailable. You can continue browsing the portfolio.";
        } else if (serverOnline) {
          node.textContent = `Server connected, but management database access is unavailable${databaseReason ? ` (${databaseReason.replaceAll("_", " ")})` : ""}. Published portfolio browsing remains available; management changes are paused.`;
        } else {
          node.textContent = "Server unavailable. Public portfolio browsing remains available; management features will resume when services reconnect.";
        }
      }
    });
    if (databaseReady) {
      for (const [node, prior] of locked) {
        if (node.isConnected) {
          if ("disabled" in node) node.disabled = prior.disabled;
          if (prior.aria === null) node.removeAttribute("aria-disabled"); else node.setAttribute("aria-disabled", prior.aria);
          node.classList.remove("server-unavailable");
          if (prior.title === null) node.removeAttribute("title"); else node.setAttribute("title", prior.title);
        }
      }
      locked.clear(); return;
    }
    const unavailableMessage = serverOnline ? "Management database temporarily unavailable" : "Server temporarily unavailable";
    document.querySelectorAll(selector).forEach(node => {
      if (!locked.has(node)) locked.set(node, { disabled: Boolean(node.disabled), aria: node.getAttribute("aria-disabled"), title: node.getAttribute("title") });
      if ("disabled" in node) node.disabled = true;
      node.setAttribute("aria-disabled", "true"); node.classList.add("server-unavailable"); node.title = unavailableMessage;
    });
  }
  function setState(server, goDatabase, direct, ai, configured, reason, advice) {
    const before = JSON.stringify([online, ready, directPublic, aiOnline, aiConfigured, databaseReason]);
    online = server === true; ready = online && goDatabase === true;
    directPublic = direct === true; aiOnline = online && ai === true; aiConfigured = online && configured === true;
    databaseReason = typeof reason === "string" ? reason.slice(0, 70) : "";
    databaseAdvice = typeof advice === "string" ? advice.slice(0, 380) : "";
    const changed = before !== JSON.stringify([online, ready, directPublic, aiOnline, aiConfigured, databaseReason]);
    paint();
    if (changed) document.dispatchEvent(new CustomEvent("portfolio:server-status", { detail: { online, ready, directPublic, aiOnline, level: level() } }));
  }
  async function check() {
    if (checking) return checking;
    checking = (async () => {
      let go = false, db = false, direct = false, ai = false, configured = false, reason = "", advice = "", revision;
      try {
        const response = await fetch(window.PublicStore.apiURL("/api/health"), { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(4000) });
        const data = await response.json();
        go = response.ok && data.online === true && data.service === "jpano-portfolio-api";
        db = go && data.database === true && data.ready === true;
        revision = data.revision;
        reason = go && !db ? data.database_reason : "";
        advice = go && !db ? data.database_advice : "";
      } catch { /* Go is optional for public browsing. */ }
      if (window.PublicStore?.refreshDirectPublic) {
        // Probe Supabase independently of Go, even when Go is healthy. A URL
        // or publishable key alone is NOT evidence that the RPC is accessible.
        // A successful RPC grants public READ visibility only, never Admin.
        try { direct = !!(await window.PublicStore.refreshDirectPublic()); } catch { direct = false; }
      }
      if (go) {
        try {
          const response = await fetch(window.PublicStore.apiURL("/api/public/ai/status"), { cache:"no-store",credentials:"omit",signal:AbortSignal.timeout(3300) });
          if (response.ok) { const data = await response.json(); ai = data.online === true; configured = data.enabled === true; }
        } catch { /* Failure here doesn't alter Go or database status. */ }
      }
      const wasReady = ready;
      setState(go, db, direct, ai, configured, reason, advice);
      if (db && (!initialized || wasReady !== true || revision !== window.PublicStore.revision)) {
        try { await window.PublicStore.refresh(); initialized = true; }
        catch (error) { console.warn("Portfolio public content refresh failed:", error?.message || error); }
      }
    })().finally(() => { checking = null; });
    return checking;
  }
  document.addEventListener("click", event => {
    if (ready !== true && event.target.closest?.(selector)) {
      event.preventDefault(); event.stopImmediatePropagation();
      window.UI?.toast("Management is temporarily unavailable. Check the service status for details.", { title: "Admin unavailable", type: "error" });
    }
  }, true);
  document.addEventListener("submit", event => {
    if (event.target?.id === "botChatForm") return;
    if (ready !== true) {
      event.preventDefault(); event.stopImmediatePropagation();
      window.UI?.toast("This service is temporarily unavailable. Your message has not been sent.", { title: "Service unavailable", type: "error" });
    }
  }, true);
  window.ServerStatus = Object.freeze({
    get online() { return online; }, get ready() { return ready; },
    get databaseOnline() { return publicDatabaseOnline(); }, get directPublic() { return directPublic; },
    get aiOnline() { return aiOnline; }, get level() { return level(); },
    get databaseReason() { return databaseReason; }, get databaseAdvice() { return databaseAdvice; },
    check, paint,
    noteResponse: () => { void check(); },
    noteDatabaseSuccess: () => { if (online !== true || ready !== true) void check(); },
    noteNetworkFailure: () => { void check(); }
  });
  function start() {
    ensurePortal(); paint(); void check();
    let queued = false;
    new MutationObserver(mutations => {
      if (mutations.every(m => m.target.closest?.("#jpano-service-popover"))) return;
      if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; if (ready !== true) paint(); }); }
    }).observe(document.body, { childList: true, subtree: true });
    setInterval(() => { if (!document.hidden) void check(); }, Math.max(10000, window.APP_CONFIG?.statusIntervalMs || 30000));
    addEventListener("online", () => void check());
    addEventListener("offline", () => setState(false, false, false, false, false, "", ""));
    document.addEventListener("visibilitychange", () => { if (!document.hidden) void check(); });
    document.addEventListener("portfolio:ai-response", () => void check());
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true }); else start();
})();
