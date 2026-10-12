import { escapeHTML } from "./helpers.js";
const { $ } = window.UI;
const PAGE_SIZE = 9;
const PLACEHOLDER = "/assets/projects/project-placeholder.svg";
let page = 1, pages = 1, openKey = "", gallery = [], imageIndex = 0, returnFocus = null;
const media = value => window.PublicStore.mediaURL(value, PLACEHOLDER);
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
function renderCards(items) {
  const root = $("#projectGrid");
  if (!items.length) { root.innerHTML = '<div class="empty-state project-empty">Projects will appear here when published.</div>'; return; }
  root.innerHTML = items.map((project, index) => `<article class="project-card project-visual-card">
    <div class="project-cover">
      <img class="project-cover-image" src="${escapeHTML(media(project.images?.[0]))}" alt="${escapeHTML(project.name)} preview" loading="lazy" decoding="async" width="720" height="450">
      ${project.icon ? `<span class="project-floating-logo"><img data-logo="true" src="${escapeHTML(media(project.icon))}" alt="" loading="lazy"></span>` : ""}
      <span class="project-cover-type">${escapeHTML(project.type || "Project")}</span>
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
function showImage(index) {
  imageIndex = Math.max(0, Math.min(gallery.length-1, index));
  const image = $("#projectGalleryImage"); image.src = media(gallery[imageIndex]); image.alt = `${$("#projectViewerTitle").textContent} — image ${imageIndex+1}`;
  $("#projectImageCount").textContent = `${imageIndex+1} / ${gallery.length}`;
  $("#projectImagePrev").hidden = gallery.length <= 1; $("#projectImageNext").hidden = gallery.length <= 1;
  $("#projectImagePrev").disabled = imageIndex <= 0; $("#projectImageNext").disabled = imageIndex >= gallery.length-1;
  $("#projectGalleryThumbs").querySelectorAll("button").forEach((button,i) => { button.classList.toggle("active", i === imageIndex); button.setAttribute("aria-pressed", String(i === imageIndex)); });
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
  $("#projectGalleryThumbs").innerHTML = gallery.map((src,i) => `<button type="button" data-gallery-index="${i}" aria-label="Show image ${i+1}" aria-pressed="false"><img src="${escapeHTML(media(src))}" alt="" loading="lazy"><span>${String(i+1).padStart(2,"0")}</span></button>`).join("");
  $("#projectGalleryThumbs").hidden = gallery.length < 2;
  protectImages($("#projectGalleryThumbs")); showImage(imageIndex);
}
function openProject(key, trigger) {
  const project = window.PublicStore.current?.projects.find(item => item.key === key); if (!project) return;
  openKey = key; gallery = []; imageIndex = 0; returnFocus = trigger;
  updateViewer(project);
  const viewer = $("#projectViewer"); viewer.showModal(); document.documentElement.classList.add("project-dialog-open");
  $("#projectViewerClose").focus();
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
  $("#projectGrid").addEventListener("click", event => { const button = event.target.closest("[data-view-project]"); if (button) openProject(button.dataset.viewProject, button); });
  const turnPage = async target => { await loadProjects(target); $("#projects").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" }); };
  $("#projectPrev").addEventListener("click", () => { if (page > 1) void turnPage(page-1); });
  $("#projectNext").addEventListener("click", () => { if (page < pages) void turnPage(page+1); });
  const viewer = $("#projectViewer");
  $("#projectViewerClose").addEventListener("click", () => viewer.close());
  viewer.addEventListener("click", event => { if (event.target === viewer) { const rect = viewer.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) viewer.close(); } });
  viewer.addEventListener("close", () => { document.documentElement.classList.remove("project-dialog-open"); const key = openKey; openKey = ""; if (returnFocus?.isConnected) returnFocus.focus(); else document.querySelector(`[data-view-project="${CSS.escape(key)}"]`)?.focus(); });
  viewer.addEventListener("keydown", event => { if (event.target.closest("a,button")) return; if (event.key === "ArrowLeft") showImage(imageIndex-1); if (event.key === "ArrowRight") showImage(imageIndex+1); });
  viewer.querySelectorAll("a").forEach(anchor => anchor.addEventListener("click", event => { if (anchor.getAttribute("aria-disabled") === "true") event.preventDefault(); }));
  $("#projectImagePrev").addEventListener("click", () => showImage(imageIndex-1)); $("#projectImageNext").addEventListener("click", () => showImage(imageIndex+1));
  $("#projectGalleryThumbs").addEventListener("click", event => { const button = event.target.closest("[data-gallery-index]"); if (button) showImage(Number(button.dataset.galleryIndex)); });
  $("#projectGalleryImage").addEventListener("error", event => { if (!event.target.src.endsWith(PLACEHOLDER)) event.target.src = PLACEHOLDER; });
  // An old cached green badge must not remain a live-status claim indefinitely.
  setInterval(() => { if (!document.hidden) void loadProjects(); }, 60000);
}
