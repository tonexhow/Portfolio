import { renderGreeting, renderPersonalInformation, wireTabMessages } from "./personal.js?v=40";
import { initProfileRotation, cleanupProfileRotation } from "./profile.js?v=40";
import { loadProjects, wireProjectPagination } from "./projects.js?v=40";
import { loadCertificates, wireCertificates } from "./certificates.js?v=40";
import { loadFeedback, wireFeedback, cleanupFeedback } from "./feedback.js?v=40";
import { wireContact, cleanupContact } from "./contact.js?v=40";
import { cleanupAdaptiveIndexLayout, initAdaptiveIndexLayout, refreshAdaptiveIndexLayout } from "./layout.js?v=40";
import { initManagementAccess } from "./management.js?v=40";
import { initCareerProfile, initLiveChat, cleanupCareerChat } from "./career-chat.js?v=43";
let personal = {}, greetingTimer, refreshQueued = false, started = false, profileSignature = "", visitSent = false;
const quiet = task => Promise.resolve(task).catch(error => console.warn(error?.message || error));
async function renderData() {
  const data = await window.PublicStore.init(); personal = data.information;
  renderPersonalInformation(personal);
  const signature = JSON.stringify(data.profiles?.items || []);
  if (signature !== profileSignature) { profileSignature = signature; void quiet(initProfileRotation(() => personal)); }
  await Promise.allSettled([loadProjects(), loadCertificates(), loadFeedback()]);
  refreshAdaptiveIndexLayout(); window.UI.initReveal();
}
function scheduleRefresh() {
  if (!started || refreshQueued) return;
  refreshQueued = true;
  requestAnimationFrame(() => { refreshQueued = false; void quiet(renderData()); });
}
function recordVisit() {
  if (visitSent || window.ServerStatus?.ready !== true) return;
  visitSent = true;
  if (window.CacheManager?.shouldRecordVisit?.()) void window.APIManager.recordVisit().catch(() => { visitSent = false; });
}
export async function initIndexPage() {
  const loaderStarted=performance.now();
  window.UI.PageLoader?.show?.(); window.UI.PageLoader?.setProgress?.(12); window.UI.PageLoader?.setMessage?.("Loading your portfolio");
  window.UI.Theme.init(); window.UI.initNavigation(); window.UI.initReveal();
  // Rendering never waits for API health, OAuth, fonts, or remote images.
  await window.PublicStore.init();
  window.UI.PageLoader?.setProgress?.(42); window.UI.PageLoader?.setMessage?.("Preparing projects and profile");
  wireTabMessages(() => personal); wireProjectPagination(); wireCertificates();
  void quiet(wireFeedback()); void quiet(wireContact()); void quiet(initManagementAccess());
  initAdaptiveIndexLayout(); initCareerProfile(); initLiveChat();
  started = true;
  document.addEventListener("portfolio:content-updated", scheduleRefresh);
  await renderData();
  window.UI.PageLoader?.setProgress?.(92); window.UI.PageLoader?.setMessage?.("Almost ready");
  // A health refresh can finish during the initial asynchronous render.
  // Reconcile once after wiring so that no first-load revision is missed.
  scheduleRefresh();
  document.addEventListener("portfolio:server-status", recordVisit); recordVisit();
  greetingTimer = setInterval(() => renderGreeting(personal, true), 60000);
  window.UI.PageLoader?.setProgress?.(100);
  const minimum=420-(performance.now()-loaderStarted); if(minimum>0)await new Promise(resolve=>setTimeout(resolve,minimum));
  await window.UI.PageLoader?.hide?.();
}
export function cleanupIndexPage() {
  cleanupProfileRotation(); cleanupContact(); cleanupFeedback(); cleanupAdaptiveIndexLayout(); cleanupCareerChat(); clearInterval(greetingTimer);
  document.removeEventListener("portfolio:content-updated", scheduleRefresh); document.removeEventListener("portfolio:server-status", recordVisit);
}
