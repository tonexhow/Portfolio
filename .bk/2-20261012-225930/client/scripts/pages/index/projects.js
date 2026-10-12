import { escapeHTML } from "./helpers.js";
const { $ } = window.UI;
const PAGE_SIZE = 9;
const PLACEHOLDER = "/assets/projects/project-placeholder.svg";
const GALLERY_INTERVAL_MS = 5000;
let page = 1, pages = 1, openKey = "", gallery = [], imageIndex = 0, returnFocus = null;
let galleryTimer = null;
let refreshTimer = null;
const media = value => window.PublicStore.mediaURL(value, PLACEHOLDER);
function transitionImage(node, url) {
  node.draggable = false;
  if (node.getAttribute("src") === url) return;
  node.src = url;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  node.classList.remove("project-image-revealing");
  void node.offsetWidth; // Restart a short transition for each image change.
  node.classList.add("project-image-revealing");
}
const link = value => window.PublicStore.safeURL(value);
function status(project) {
  const checked = Date.parse(project.checked_at || "");
  if (!project.url) return { kind: "unknown", text: "No live site", hint: "No public website has been added." };
  if (!Number.isFinite(checked) || Date.now() - checked > 300000 || checked > Date.now() + 60000) return { kind: "unknown", text: "Not checked", hint: "Live availability has not been checked recently." };
  if (project.status === "online") return { kind: "online", text: "Online", hint: `Last checked ${new Date(checked).toLocaleString()}` };
  if (project.status === "offline") return { kind: "offline", text: "Offline", hint: `Last checked ${new Date(checked).toLocaleString()}` };
  return { kind: "unknown", text: "Not checked", hint: "Live availability is currently unknown." };
}
function statusMarkup(project) {
  const value = status(project);
  return `<span class="site-status status-${value.kind}" title="${escapeHTML(value.hint)}"><i aria-hidden="true"></i>${value.text}</span>`;
}
function protectImages(root) {
  root.querySelectorAll("img").forEach(image => image.addEventListener("error", () => {
    if (image.dataset.logo === "true") { image.parentElement.hidden = true; return; }
    if (!image.src.endsWith(PLACEHOLDER)) image.src = PLACEHOLDER;
  }, { once: true }));
}
function categoryFor(project){
  const raw=String(project.type||'').trim();
  if(raw && !/^(project|software|app|application|other)$/i.test(raw))return raw;
  const description=`${project.description||''} ${(project.stack||[]).join(' ')}`.toLowerCase();
  if(/iot|esp32|raspberry|rfid|microcontroller|sensor/.test(description))return 'IoT';
  if(/android|flutter|ios|kotlin|react native/.test(description))return 'Mobile App';
  if(/avalonia|wpf|winforms|desktop application/.test(description))return 'Desktop App';
  if(/website|web app|html|css|react|nextjs|vite|web dashboard/.test(description))return 'Website';
  return raw||'Software';
}
function renderCards(items) {
  const root = $("#projectGrid");
  if (!items.length) { root.innerHTML = '<div class="empty-state project-empty">Projects will appear here when published.</div>'; return; }
  root.innerHTML = items.map((project, index) => `<article class="project-card project-visual-card">
    <div class="project-cover">
      <img class="project-cover-image" src="${escapeHTML(media(project.images?.[0]))}" alt="${escapeHTML(project.name)} preview" loading="lazy" decoding="async" width="720" height="450">
      ${project.icon ? `<span class="project-floating-logo"><img data-logo="true" src="${escapeHTML(media(project.icon))}" alt="" loading="lazy"></span>` : ""}
      <span class="project-cover-type">${escapeHTML(categoryFor(project))}</span>
    </div>
    <div class="project-card-body"><div class="project-card-heading"><h3>${escapeHTML(project.name)}</h3>${statusMarkup(project)}</div>
      <p class="project-description">${escapeHTML(project.description || "Explore this project to learn more.")}</p>
      <div class="project-card-footer"><span class="project-index" aria-label="Project ${(page-1)*PAGE_SIZE+index+1}">${String((page-1)*PAGE_SIZE+index+1).padStart(2,"0")}</span><button class="project-view-button" type="button" data-view-project="${escapeHTML(project.key)}" aria-label="View ${escapeHTML(project.name)}">View <span aria-hidden="true">↗</span></button></div>
    </div></article>`).join("");
  protectImages(root);
}
function setAction(node, url, enabled, disabledMessage) {
  const safe = link(url);
  if (enabled && safe) { node.href = safe; node.removeAttribute("aria-disabled"); node.removeAttribute("title"); node.tabIndex = 0; }
  else { node.removeAttribute("href"); node.setAttribute("aria-disabled", "true"); node.title = disabledMessage; node.tabIndex = 0; }
}
function stopGalleryAutoplay() {
  if (galleryTimer !== null) clearInterval(galleryTimer);
  galleryTimer = null;
}
function startGalleryAutoplay() {
  stopGalleryAutoplay();
  if (!$("#projectViewer").open || $("#projectLightbox").open || gallery.length < 2 || document.hidden ||
      matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  galleryTimer = setInterval(() => {
    if (!$("#projectViewer").open || $("#projectLightbox").open || document.hidden) { stopGalleryAutoplay(); return; }
    showImage(imageIndex + 1, { resetTimer: false });
  }, GALLERY_INTERVAL_MS);
}
function showImage(index, { resetTimer = true } = {}) {
  if (!gallery.length) return;
  imageIndex = (index % gallery.length + gallery.length) % gallery.length;
  const title = $("#projectViewerTitle").textContent;
  const image = $("#projectGalleryImage");
  transitionImage(image, media(gallery[imageIndex]));
  image.alt = `${title} — image ${imageIndex + 1}`;
  $("#projectImageExpand").setAttribute("aria-label", `Enlarge ${title}, image ${imageIndex + 1} of ${gallery.length}`);
  $("#projectImageCount").textContent = `${imageIndex + 1} / ${gallery.length}`;
  for (const id of ["#projectImagePrev", "#projectImageNext", "#projectLightboxPrev", "#projectLightboxNext"]) {
    $(id).hidden = gallery.length < 2;
  }
  $("#projectGalleryThumbs").querySelectorAll("button").forEach((button, i) => {
    button.classList.toggle("active", i === imageIndex);
    button.setAttribute("aria-pressed", String(i === imageIndex));
  });
  if ($("#projectLightbox").open) {
    transitionImage($("#projectLightboxImage"), media(gallery[imageIndex]));
    $("#projectLightboxImage").alt = `${title} — enlarged image ${imageIndex + 1}`;
    $("#projectLightboxCount").textContent = `${imageIndex + 1} / ${gallery.length}`;
  }
  if (resetTimer) startGalleryAutoplay();
}
function openLightbox() {
  const lightbox = $("#projectLightbox");
  if (!$("#projectViewer").open || lightbox.open) return;
  stopGalleryAutoplay();
  $("#projectLightboxTitle").textContent = $("#projectViewerTitle").textContent;
  lightbox.showModal();
  showImage(imageIndex, { resetTimer: false });
  $("#projectLightboxClose").focus();
}
function updateViewer(project) {
  $("#projectViewerTitle").textContent = project.name;
  $("#projectViewerCaption").textContent = project.name;
  $("#projectViewerDescription").textContent = project.description || "No additional description has been added.";
  $("#projectViewerStack").innerHTML = (project.stack || []).map(item => `<span>${escapeHTML(item)}</span>`).join("") || '<span class="stack-empty">Not specified</span>';
  $("#projectViewerStatus").innerHTML = statusMarkup(project);
  setAction($("#projectSourceCode"), project.source_url, true, "Source code is not publicly available.");
  setAction($("#projectVisit"), project.url, status(project).kind === "online", "Visit is unavailable until the project is confirmed online.");
  const nextGallery = project.images?.length ? project.images : [PLACEHOLDER];
  const changed = JSON.stringify(gallery) !== JSON.stringify(nextGallery); gallery = [...nextGallery];
  if (changed) imageIndex = 0;
  $("#projectGalleryThumbs").innerHTML = gallery.map((src,i) => `<button type="button" data-gallery-index="${i}" aria-label="Show image ${i+1}" aria-pressed="false"><img src="${escapeHTML(media(src))}" alt="" loading="lazy" draggable="false"><span>${String(i+1).padStart(2,"0")}</span></button>`).join("");
  $("#projectGalleryThumbs").hidden = gallery.length < 2;
  protectImages($("#projectGalleryThumbs")); showImage(imageIndex);
}
function openProject(key, trigger) {
  const project = window.PublicStore.current?.projects.find(item => item.key === key); if (!project) return;
  openKey = key; gallery = []; imageIndex = 0; returnFocus = trigger;
  updateViewer(project);
  const viewer = $("#projectViewer"); viewer.showModal(); document.documentElement.classList.add("project-dialog-open");
  $("#projectViewerClose").focus();
  startGalleryAutoplay();
}
export async function loadProjects(target = page) {
  const result = await window.APIManager.getProjects(target, PAGE_SIZE);
  page = Number(result.page || 1); pages = Number(result.total_pages || 1); renderCards(result.items || []);
  $("#projectPage").textContent = `Page ${page} of ${pages}`;
  $("#projectPrev").disabled = page <= 1; $("#projectNext").disabled = page >= pages;
  $("#projectPagination").hidden = Number(result.total || 0) <= PAGE_SIZE;
  if (openKey && $("#projectViewer").open) {
    const project = window.PublicStore.current?.projects.find(item => item.key === openKey);
    if (project) updateViewer(project); else $("#projectViewer").close();
  }
}
export function wireProjectPagination() {
  // Public chat cards may open already-published project details.
  // Reuse the existing viewer instead of a second modal implementation.
  document.addEventListener("portfolio:open-project", event => {
    const key = event.detail?.key;
    const trigger = event.detail?.trigger;
    if (typeof key === "string" && key) openProject(key, trigger);
  });
  $("#projectGrid").addEventListener("click", event => { const button = event.target.closest("[data-view-project]"); if (button) openProject(button.dataset.viewProject, button); });
  const turnPage = async target => { await loadProjects(target); $("#projects").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" }); };
  $("#projectPrev").addEventListener("click", () => { if (page > 1) void turnPage(page-1); });
  $("#projectNext").addEventListener("click", () => { if (page < pages) void turnPage(page+1); });
  const viewer = $("#projectViewer");
  const lightbox = $("#projectLightbox");
  $("#projectViewerClose").addEventListener("click", () => viewer.close());
  viewer.addEventListener("click", event => {
    if (event.target !== viewer) return;
    const rect = viewer.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) viewer.close();
  });
  viewer.addEventListener("close", () => {
    stopGalleryAutoplay();
    if (lightbox.open) lightbox.close();
    document.documentElement.classList.remove("project-dialog-open");
    const key = openKey; openKey = "";
    if (returnFocus?.isConnected) returnFocus.focus();
    else document.querySelector(`[data-view-project="${CSS.escape(key)}"]`)?.focus();
  });
  viewer.addEventListener("keydown", event => {
    if (event.target.closest("input,textarea,select,[contenteditable=true]")) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      showImage(imageIndex + (event.key === "ArrowLeft" ? -1 : 1));
    }
  });
  viewer.querySelectorAll("a").forEach(anchor => anchor.addEventListener("click", event => {
    if (anchor.getAttribute("aria-disabled") === "true") event.preventDefault();
  }));
  $("#projectImagePrev").addEventListener("click", () => showImage(imageIndex - 1));
  $("#projectImageNext").addEventListener("click", () => showImage(imageIndex + 1));
  $("#projectGalleryThumbs").addEventListener("click", event => {
    const button = event.target.closest("[data-gallery-index]");
    if (button) showImage(Number(button.dataset.galleryIndex));
  });
  $("#projectImageExpand").addEventListener("click", openLightbox);
  $("#projectGalleryImage").addEventListener("error", event => {
    if (!event.target.src.endsWith(PLACEHOLDER)) event.target.src = PLACEHOLDER;
  });
  $("#projectLightboxImage").addEventListener("error", event => {
    if (!event.target.src.endsWith(PLACEHOLDER)) event.target.src = PLACEHOLDER;
  });
  $("#projectLightboxClose").addEventListener("click", () => lightbox.close());
  $("#projectLightboxPrev").addEventListener("click", () => showImage(imageIndex - 1));
  $("#projectLightboxNext").addEventListener("click", () => showImage(imageIndex + 1));
  lightbox.addEventListener("keydown", event => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      showImage(imageIndex + (event.key === "ArrowLeft" ? -1 : 1));
    }
  });
  lightbox.addEventListener("click", event => {
    if (event.target !== lightbox) return;
    const rect = lightbox.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) lightbox.close();
  });
  lightbox.addEventListener("close", () => {
    if (viewer.open) {
      $("#projectImageExpand").focus();
      startGalleryAutoplay();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopGalleryAutoplay(); else startGalleryAutoplay();
  });
  for (const image of [$("#projectGalleryImage"), $("#projectLightboxImage")]) {
    image.draggable = false;
    image.addEventListener("dragstart", event => event.preventDefault());
    image.addEventListener("selectstart", event => event.preventDefault());
  }
  // Touch gestures work in the expanded viewer; arrows remain available on every device.
  let touchX = null;
  lightbox.addEventListener("touchstart", event => { touchX = event.changedTouches[0]?.clientX ?? null; }, { passive: true });
  lightbox.addEventListener("touchend", event => {
    if (touchX === null || gallery.length < 2) return;
    const delta = (event.changedTouches[0]?.clientX ?? touchX) - touchX;
    touchX = null;
    if (Math.abs(delta) > 55) showImage(imageIndex + (delta < 0 ? 1 : -1));
  }, { passive: true });
  // An old cached green badge must not remain a live-status claim indefinitely.
  refreshTimer = setInterval(() => { if (!document.hidden) void loadProjects(); }, 60000);
}
export function cleanupProjectGallery() {
  stopGalleryAutoplay();
  if (refreshTimer !== null) clearInterval(refreshTimer);
  refreshTimer = null;
}
