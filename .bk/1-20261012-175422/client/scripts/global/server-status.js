(() => {
  "use strict";
  let online = null, ready = null, checking = null, initialized = false;
  const locked = new Map();
  const selector = "[data-requires-server], #feedbackIdentityButton, #feedbackAuthClear, [data-feedback-provider], #contactGoogleButton, #contactSubmit, #feedbackSubmit, #endSessionButton, #confirmEndSession, #saveInformationButton, #confirmInformationSave, #addProjectButton, #editProjectPositionButton, [data-project-visible], [data-project-ping], [data-project-edit], [data-project-delete], [data-move-project], [data-refresh-view], .admin-body form button[type=submit], .access-body form button[type=submit], #saveProjectButton, #saveCertificateButton, #addCertificateButton, [data-certificate-edit], [data-certificate-delete], [data-certificate-visible], [data-certificate-pin], [data-contact-action], [data-feedback-action], [data-action]";

  function paint() {
    const serverOnline = online === true;
    const databaseReady = ready === true;
    const message = serverOnline ? "Server is online" : "Server is offline";
    document.documentElement.dataset.serverStatus = serverOnline ? "online" : "offline";
    document.documentElement.dataset.serverReady = databaseReady ? "ready" : "not-ready";

    document.querySelectorAll("[data-backend-status]").forEach(node => {
      node.dataset.state = serverOnline ? "online" : "offline";
      node.setAttribute("aria-label", message);
      const tooltip = node.querySelector(".backend-tooltip");
      if (tooltip && tooltip.textContent !== message) tooltip.textContent = message;
    });
    document.querySelectorAll("[data-offline-notice]").forEach(node => { node.hidden = databaseReady; });

    if (databaseReady) {
      for (const [node, prior] of locked) {
        if (node.isConnected) {
          if ("disabled" in node) node.disabled = prior.disabled;
          if (prior.aria === null) node.removeAttribute("aria-disabled"); else node.setAttribute("aria-disabled", prior.aria);
          node.classList.remove("server-unavailable");
          if (prior.title === null) node.removeAttribute("title"); else node.setAttribute("title", prior.title);
        }
      }
      locked.clear();
      return;
    }

    const unavailableMessage = serverOnline ? "Database is not ready" : "Server is offline";
    document.querySelectorAll(selector).forEach(node => {
      if (!locked.has(node)) locked.set(node, { disabled: Boolean(node.disabled), aria: node.getAttribute("aria-disabled"), title: node.getAttribute("title") });
      if ("disabled" in node) node.disabled = true;
      node.setAttribute("aria-disabled", "true");
      node.classList.add("server-unavailable");
      node.title = unavailableMessage;
    });
  }

  function setState(serverOnline, databaseReady = false) {
    const normalizedOnline = serverOnline === true;
    const normalizedReady = normalizedOnline && databaseReady === true;
    const changed = online !== normalizedOnline || ready !== normalizedReady;
    online = normalizedOnline;
    ready = normalizedReady;
    paint();
    if (changed) document.dispatchEvent(new CustomEvent("portfolio:server-status", { detail: { online, ready } }));
  }

  async function check() {
    if (checking) return checking;
    checking = (async () => {
      try {
        const response = await fetch(window.PublicStore.apiURL("/api/health"), { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(3500) });
        const result = await response.json();
        const serverOnline = response.ok && result.online === true && result.service === "jpano-portfolio-api";
        const databaseReady = serverOnline && result.ready === true && result.database === true;
        const wasReady = ready;
        setState(serverOnline, databaseReady);
        if (databaseReady && (!initialized || wasReady !== true || result.revision !== window.PublicStore.revision)) {
          try {
            await window.PublicStore.refresh();
            initialized = true;
          } catch (error) {
            // Content refresh and server reachability are different states. A slow or
            // malformed snapshot must not turn a successful health check red.
            setState(serverOnline, databaseReady);
            console.warn("Portfolio content refresh failed after a successful health check:", error?.message || error);
          }
        }
      } catch (error) {
        setState(false, false);
        console.warn("Portfolio API health check failed:", error?.message || error);
      }
    })().finally(() => { checking = null; });
    return checking;
  }

  document.addEventListener("click", event => {
    if (ready !== true && event.target.closest?.(selector)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const title = online === true ? "Database unavailable" : "Server is offline";
      const message = online === true ? "The server is running, but the database is not ready yet." : "This action will be available when the server reconnects.";
      window.UI?.toast(message, { title, type: "error" });
    }
  }, true);

  document.addEventListener("submit", event => {
    if (ready !== true) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const title = online === true ? "Database unavailable" : "Not sent";
      const message = online === true ? "The server is running, but the database is not ready yet." : "The server is offline. Your form has not been sent.";
      window.UI?.toast(message, { title, type: "error" });
    }
  }, true);

  window.ServerStatus = Object.freeze({
    get online() { return online; },
    get ready() { return ready; },
    check,
    paint,
    noteResponse: status => setState(true, status !== 503 && ready === true),
    noteDatabaseSuccess: () => setState(true, true),
    noteNetworkFailure: () => setState(false, false)
  });

  function start() {
    paint();
    void check();
    let queued = false;
    new MutationObserver(() => {
      if (!queued) {
        queued = true;
        requestAnimationFrame(() => { queued = false; if (ready !== true) paint(); });
      }
    }).observe(document.body, { childList: true, subtree: true });
    setInterval(() => { if (!document.hidden) void check(); }, Math.max(10000, window.APP_CONFIG?.statusIntervalMs || 30000));
    addEventListener("online", () => void check());
    addEventListener("offline", () => setState(false, false));
    document.addEventListener("visibilitychange", () => { if (!document.hidden) void check(); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true }); else start();
})();
