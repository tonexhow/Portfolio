import { escapeHTML } from "./helpers.js?v=40";

const { $ } = window.UI;
let certificatePage = 1;
let certificatePages = 1;
let currentItems = [];
let loadGeneration = 0;
const CERTIFICATE_CACHE_SCHEMA = "28";
const CERTIFICATE_CACHE_SCHEMA_KEY = "jpano-certificate-cache-schema";

try {
  if (localStorage.getItem(CERTIFICATE_CACHE_SCHEMA_KEY) !== CERTIFICATE_CACHE_SCHEMA) {
    window.CacheManager?.clearPrefix?.("certificates:");
    localStorage.setItem(CERTIFICATE_CACHE_SCHEMA_KEY, CERTIFICATE_CACHE_SCHEMA);
  }
} catch {}

function formatCertificateDate(value) {
  const match = String(value || "").match(/^(\d{4})/);
  return match ? match[1] : "Year unavailable";
}

function skeletonCard(index = 0) {
  return `<article class="certificate-card certificate-card-skeleton" aria-hidden="true" data-skeleton-index="${index}">
    <div class="certificate-image-skeleton"><span class="certificate-skeleton-shimmer"></span></div>
    <div class="certificate-card-body certificate-skeleton-body">
      <span class="certificate-skeleton-line line-long"></span>
      <span class="certificate-skeleton-line line-short"></span>
      <span class="certificate-skeleton-action"></span>
    </div>
  </article>`;
}

function progressiveCard(item) {
  return `<article class="certificate-card certificate-card-loading ${item.pinned ? "is-pinned" : ""}" data-certificate-card="${item.id}" aria-busy="true">
    <button class="certificate-image-button" type="button" data-certificate-view="${item.id}" aria-label="Expand certificate from ${escapeHTML(item.provider)}" disabled>
      <span class="certificate-image-loading" aria-hidden="true"><span class="spinner"></span><small>Loading certificate</small></span>
      <img data-certificate-image="${item.id}" alt="Certificate from ${escapeHTML(item.provider)}" decoding="async">
      <span class="certificate-view-label">View certificate</span>
    </button>
    <div class="certificate-card-body">
      <div class="certificate-provider-row"><strong>${escapeHTML(item.provider)}</strong>${item.pinned ? `<span class="certificate-pin">Pinned</span>` : ""}</div>
      <time datetime="${escapeHTML(item.date)}">${escapeHTML(formatCertificateDate(item.date))}</time>
      <a class="certificate-download" href="${escapeHTML(item.download_url)}" download>Download <span aria-hidden="true">↓</span></a>
    </div>
  </article>`;
}

function closeViewer() {
  const viewer = $("#certificateViewer");
  if (!viewer) return;
  viewer.hidden = true;
  document.documentElement.classList.remove("modal-open");
}

function openViewer(id) {
  const item = currentItems.find(entry => String(entry.id) === String(id));
  if (!item) return;
  $("#certificateViewerImage").src = item.image_url;
  $("#certificateViewerImage").alt = `Certificate from ${item.provider}`;
  $("#certificateViewerProvider").textContent = item.provider;
  $("#certificateViewerDate").textContent = formatCertificateDate(item.date);
  $("#certificateViewerDownload").href = item.download_url;
  const viewer = $("#certificateViewer");
  viewer.hidden = false;
  document.documentElement.classList.add("modal-open");
}

function renderSkeletons(count = 6) {
  const root = $("#certificateGrid");
  if (!root) return;
  root.innerHTML = Array.from({ length: Math.max(1, count) }, (_, index) => skeletonCard(index)).join("");
}

function waitForCertificateImage(image, source, generation) {
  return new Promise(resolve => {
    if (!image || generation !== loadGeneration) return resolve(false);
    let finished = false;
    const finish = ok => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      resolve(ok);
    };
    const timeout = window.setTimeout(() => finish(false), 30000);
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.src = source;
    if (image.complete && image.naturalWidth > 0) finish(true);
  });
}

async function hydrateCards(items, generation) {
  // Intentionally one at a time. Large certificate BLOBs should never compete with
  // the rest of the portfolio or flood a mobile connection with six downloads at once.
  for (const item of items) {
    if (generation !== loadGeneration) return;
    const card = document.querySelector(`[data-certificate-card="${String(item.id)}"]`);
    const image = card?.querySelector(`[data-certificate-image="${String(item.id)}"]`);
    const button = card?.querySelector("[data-certificate-view]");
    if (!card || !image || !button) continue;

    const loaded = await waitForCertificateImage(image, item.image_url, generation);
    if (generation !== loadGeneration) return;
    card.classList.remove("certificate-card-loading");
    card.classList.toggle("certificate-card-image-error", !loaded);
    card.removeAttribute("aria-busy");
    button.disabled = !loaded;
    const loading = card.querySelector(".certificate-image-loading");
    if (loading) {
      if (loaded) loading.remove();
      else loading.innerHTML = `<small>Preview unavailable</small>`;
    }
  }
}

export async function loadCertificates(page = certificatePage, { progressive = true } = {}) {
  const root = $("#certificateGrid");
  const prev = $("#certificatePrev");
  const next = $("#certificateNext");
  const pagination = $("#certificatePagination");
  if (!root || !prev || !next || !pagination) return;

  const generation = ++loadGeneration;
  prev.disabled = true;
  next.disabled = true;
  pagination.hidden = true;
  if (progressive) renderSkeletons(6);
  else root.replaceChildren();

  try {
    // Metadata is kept in localStorage by APIManager. On an ordinary reload this
    // resolves immediately while unchanged certificate images come from HTTP cache.
    const data = await window.APIManager.getCertificates(page, 6);
    if (generation !== loadGeneration) return;

    certificatePage = Number(data.page || 1);
    certificatePages = Math.max(1, Number(data.total_pages || 1));
    currentItems = data.items || [];
    const total = Number(data.total || 0);
    const count = $("#certificateCount");
    if (count) count.textContent = String(total);

    if (!total || !currentItems.length) {
      currentItems = [];
      root.replaceChildren();
      pagination.hidden = true;
      return;
    }

    root.innerHTML = currentItems.map(progressiveCard).join("");
    $("#certificatePage").textContent = `Page ${certificatePage} of ${certificatePages}`;
    prev.disabled = certificatePage <= 1;
    next.disabled = certificatePage >= certificatePages;
    pagination.hidden = total <= 6;
    window.UI.initReveal?.();

    await hydrateCards(currentItems, generation);
  } catch (error) {
    if (generation !== loadGeneration) return;
    currentItems = [];
    const count = $("#certificateCount");
    if (count) count.textContent = "0";
    root.innerHTML = `<div class="certificate-empty">Certificates are temporarily unavailable.</div>`;
    pagination.hidden = true;
    console.warn("Certificates could not be loaded:", error.message);
  }
}

export function wireCertificates() {
  const prev = $("#certificatePrev");
  const next = $("#certificateNext");
  const grid = $("#certificateGrid");
  const viewer = $("#certificateViewer");
  const close = $("#certificateViewerClose");
  if (!prev || !next || !grid || !viewer || !close) return;

  prev.addEventListener("click", () => certificatePage > 1 && loadCertificates(certificatePage - 1, { progressive: true }));
  next.addEventListener("click", () => certificatePage < certificatePages && loadCertificates(certificatePage + 1, { progressive: true }));
  grid.addEventListener("click", event => {
    const button = event.target.closest("[data-certificate-view]");
    if (button && !button.disabled) openViewer(button.dataset.certificateView);
  });
  close.addEventListener("click", closeViewer);
  viewer.addEventListener("click", event => { if (event.target.id === "certificateViewer") closeViewer(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !viewer.hidden) closeViewer(); });
}
