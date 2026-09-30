import { cleanupIndexPage, initIndexPage } from "./pages/index/index.js?v=43";
window.CacheManager?.registerServiceWorker?.();
const start = () => { window.UI?.PageLoader?.show?.(); return initIndexPage().catch(error => { console.error("Portfolio initialization:", error); window.UI?.PageLoader?.hide?.(); }); };
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true }); else void start();
window.addEventListener("beforeunload", cleanupIndexPage, { once: true });
