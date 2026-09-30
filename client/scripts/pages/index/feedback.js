import { escapeHTML, formatDate, FEEDBACK_COOLDOWN_KEY } from "./helpers.js?v=40";

const { $, $$ } = window.UI;
let selectedRating = 5;
let feedbackPage = 1;
let feedbackPages = 1;
let feedbackCooldownTimer = null;
let feedbackIdentity = null;
let authProvidersLoaded = false;
const FEEDBACK_COMMENT_LIMIT = 300;

function providerLabel(provider) {
  return ({ google: "Google", github: "GitHub", facebook: "Facebook", telegram: "Telegram", legacy: "Guest" })[provider] || "Verified";
}

function providerIcon(provider) {
  const icons = {
    google: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.4 12.2c0-.7-.1-1.3-.2-1.9H12v3.6h4.7a4 4 0 0 1-1.7 2.6v2.2h2.8c1.7-1.5 2.6-3.8 2.6-6.5Z"/><path d="M12 20.7c2.4 0 4.4-.8 5.8-2.1L15 16.4c-.8.5-1.8.9-3 .9a5.2 5.2 0 0 1-4.9-3.6H4.2V16A8.8 8.8 0 0 0 12 20.7Z"/><path d="M7.1 13.7a5.3 5.3 0 0 1 0-3.4V8H4.2a8.8 8.8 0 0 0 0 8l2.9-2.3Z"/><path d="M12 6.7c1.3 0 2.5.5 3.4 1.3l2.5-2.5A8.5 8.5 0 0 0 4.2 8l2.9 2.3A5.2 5.2 0 0 1 12 6.7Z"/></svg>`,
    github: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.7a9.5 9.5 0 0 0-3 18.5c.5.1.7-.2.7-.5v-1.9c-2.8.6-3.4-1.2-3.4-1.2-.5-1.1-1.1-1.4-1.1-1.4-.9-.6.1-.6.1-.6 1 0 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.7.3-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-4.7 0-1 .4-1.9 1-2.6-.1-.3-.4-1.3.1-2.6 0 0 .8-.3 2.7 1a9.2 9.2 0 0 1 4.9 0c1.9-1.3 2.7-1 2.7-1 .5 1.3.2 2.3.1 2.6.7.7 1 1.6 1 2.6 0 3.6-2.4 4.4-4.6 4.7.4.3.7.9.7 1.7v2.6c0 .3.2.6.7.5A9.5 9.5 0 0 0 12 2.7Z"/></svg>`,
    facebook: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.7 21v-8h2.7l.4-3h-3.1V8.1c0-.9.3-1.5 1.6-1.5H17V3.9c-.3 0-1.3-.1-2.4-.1-2.4 0-4 1.4-4 4.1V10H8v3h2.6v8h3.1Z"/></svg>`,
    telegram: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 4-3.1 15.1c-.2 1.1-.9 1.4-1.8.9l-4.7-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.3-4.8L17.2 6c.4-.3-.1-.5-.6-.2L5.8 12.6 1.2 11c-1-.3-1-1 .2-1.5l18-6.9c.8-.3 1.6.2 1.6 1.4Z"/></svg>`
  };
  return icons[provider] || `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M8 12h8M12 8v8"/></svg>`;
}

function initials(name) {
  return String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase() || "").join("") || "?";
}

function setRating(value) {
  selectedRating = value;
  $("#rating").value = String(value);
  $$("#stars button").forEach(button => {
    const active = Number(button.dataset.rating) <= value;
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", String(Number(button.dataset.rating) === value));
  });
}

function getCooldownRemaining() {
  const until = Number(localStorage.getItem(FEEDBACK_COOLDOWN_KEY) || 0);
  return Math.max(0, Math.ceil((until - Date.now()) / 1000));
}

function renderFeedbackCooldown() {
  const button = $("#feedbackSubmit");
  const note = $("#feedbackCooldownNote");
  if (!button || !note) return;
  const remaining = getCooldownRemaining();
  if (remaining <= 0) {
    button.disabled = false;
    if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml;
    note.classList.remove("sent");
    note.textContent = "Your feedback will appear after moderation. A 30-second cooldown starts after a successful submission.";
    localStorage.removeItem(FEEDBACK_COOLDOWN_KEY);
    if (feedbackCooldownTimer) {
      clearInterval(feedbackCooldownTimer);
      feedbackCooldownTimer = null;
    }
    return;
  }
  if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `<span>Submit again in ${remaining}s</span>`;
  note.classList.add("sent");
  note.textContent = `Feedback sent and awaiting review. You can submit again in ${remaining} second${remaining === 1 ? "" : "s"}.`;
}

function startFeedbackCooldown(seconds = 30) {
  localStorage.setItem(FEEDBACK_COOLDOWN_KEY, String(Date.now() + (Math.max(1, seconds) * 1000)));
  renderFeedbackCooldown();
  if (feedbackCooldownTimer) clearInterval(feedbackCooldownTimer);
  feedbackCooldownTimer = setInterval(renderFeedbackCooldown, 1000);
}

function publishFeedbackIdentity() {
  document.dispatchEvent(new CustomEvent("portfolio:feedback-identity", {
    detail: feedbackIdentity ? { ...feedbackIdentity, authenticated: true } : { authenticated: false }
  }));
}

function renderIdentity(identity) {
  feedbackIdentity = identity?.authenticated ? identity : null;
  const name = $("#feedbackIdentityName");
  const meta = $("#feedbackIdentityMeta");
  const button = $("#feedbackIdentityButton");
  const clear = $("#feedbackAuthClear");
  const avatar = $("#feedbackIdentityAvatar");
  if (!feedbackIdentity) {
    name.value = "";
    meta.hidden = false;
    meta.classList.add("unverified");
    $("#feedbackIdentityProvider").textContent = "Identity not verified";
    $("#feedbackIdentityCredential").textContent = "Verify an account before submitting feedback.";
    avatar.innerHTML = "<b>!</b>";
    button.textContent = "Verify identity";
    clear.hidden = true;
    publishFeedbackIdentity();
    return;
  }
  meta.classList.remove("unverified");
  name.value = feedbackIdentity.display_name || "Verified account";
  $("#feedbackIdentityProvider").textContent = `Verified with ${providerLabel(feedbackIdentity.provider)}`;
  $("#feedbackIdentityCredential").textContent = feedbackIdentity.credential || "Verified account";
  avatar.innerHTML = `<b>${escapeHTML(initials(feedbackIdentity.display_name))}</b>`;
  if (feedbackIdentity.avatar_url) {
    const image = document.createElement("img");
    image.src = `${window.APIManager.apiURL(feedbackIdentity.avatar_url)}?v=${Date.now()}`;
    image.alt = "";
    image.addEventListener("load", () => avatar.prepend(image));
  }
  meta.hidden = false;
  button.textContent = "Change account";
  clear.hidden = false;
  publishFeedbackIdentity();
}

async function loadFeedbackIdentity() {
  try {
    renderIdentity(await window.APIManager.getFeedbackAuthSession());
  } catch {
    renderIdentity(null);
  }
}

async function loadAuthProviders() {
  if (authProvidersLoaded) return;
  const root = $("#feedbackAuthProviders");
  try {
    const data = await window.APIManager.getFeedbackAuthProviders();
    root.innerHTML = (data.providers || []).map(provider => {
      const disabled = !provider.configured;
      const account = provider.id === "google" ? "Name · photo · email" :
        provider.id === "github" ? "Name · avatar · GitHub user" :
        provider.id === "facebook" ? "Name · photo · email when available" :
        "Name · photo · Telegram user/ID";
      return `<button class="feedback-provider ${disabled ? "unavailable" : ""}" type="button" data-feedback-provider="${escapeHTML(provider.id)}" ${disabled ? "disabled" : ""}>
        <span class="feedback-provider-icon ${escapeHTML(provider.id)}">${providerIcon(provider.id)}</span>
        <span><strong>Continue with ${escapeHTML(provider.label)}</strong><small>${escapeHTML(disabled ? "Not configured" : account)}</small></span>
        <i aria-hidden="true">→</i>
      </button>`;
    }).join("") || `<div class="feedback-auth-loading">No identity provider is configured yet.</div>`;
    authProvidersLoaded = true;
  } catch (error) {
    root.innerHTML = `<div class="feedback-auth-loading">${escapeHTML(error.message)}</div>`;
  }
}

async function openAuthModal() {
  const modal = $("#feedbackAuthModal");
  modal.hidden = false;
  document.documentElement.classList.add("modal-open");
  await loadAuthProviders();
}

function closeAuthModal() {
  $("#feedbackAuthModal").hidden = true;
  document.documentElement.classList.remove("modal-open");
}

function handleAuthResult() {
  const params = new URLSearchParams(location.search);
  const status = params.get("feedback_auth");
  if (!status) return;
  const messages = {
    ok: ["Identity verified", "You can now submit feedback."],
    cancelled: ["Sign-in cancelled", "No identity was changed."],
    invalid: ["Could not verify identity", "The sign-in request expired or was invalid."],
    failed: ["Could not verify identity", "The provider did not return a usable account identity."],
    unavailable: ["Provider unavailable", "That sign-in provider is not configured."]
  };
  const [title, message] = messages[status] || messages.failed;
  window.UI.toast(message, { title, type: status === "ok" || status === "cancelled" ? undefined : "error" });
  params.delete("feedback_auth");
  const query = params.toString();
  history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash || "#feedback"}`);
}

function bindAvatarFallbacks(root) {
  root.querySelectorAll("img[data-avatar-image]").forEach(image => {
    image.addEventListener("error", () => image.remove(), { once: true });
  });
}

export async function loadFeedback(page = feedbackPage) {
  const root = $("#reviewList");
  const prev = $("#feedbackPrev");
  const next = $("#feedbackNext");
  prev.disabled = true;
  next.disabled = true;

  try {
    const data = await window.APIManager.getFeedback(page, 5);
    feedbackPage = Number(data.page || 1);
    feedbackPages = Math.max(1, Number(data.total_pages || 1));
    $("#avgRating").textContent = data.rating_count ? Number(data.average_rating).toFixed(1) : "0.0";
    $("#ratingCount").textContent = data.rating_count ? `${data.rating_count} public rating${data.rating_count === 1 ? "" : "s"}` : "No public ratings yet";
    root.innerHTML = data.items?.length
      ? data.items.map(item => `<article class="review-card ${item.pinned ? "is-pinned" : ""}">
          <div class="review-identity">
            <span class="review-avatar"><b>${escapeHTML(initials(item.display_name))}</b>${item.avatar_url ? `<img data-avatar-image src="${escapeHTML(window.APIManager.apiURL(item.avatar_url))}" alt="">` : ""}</span>
            <div class="review-person"><div class="review-name-line"><strong>${escapeHTML(item.display_name)}</strong>${item.pinned ? `<span class="review-pin">Pinned</span>` : ""}<span class="review-provider" title="${escapeHTML(providerLabel(item.auth_provider))}">${providerIcon(item.auth_provider)}</span></div>${item.credential ? `<small>${escapeHTML(item.credential)}</small>` : ""}</div>
            <time>${formatDate(item.created_at)}</time>
          </div>
          <div class="review-stars">${"★".repeat(item.rating)}${"☆".repeat(5 - item.rating)}</div>
          <p title="${escapeHTML(item.comment)}">${escapeHTML(item.comment)}</p>
        </article>`).join("")
      : `<div class="empty-state">Approved comments will appear here.</div>`;
    bindAvatarFallbacks(root);
    $("#feedbackPage").textContent = `Page ${feedbackPage} of ${feedbackPages}`;
    prev.disabled = feedbackPage <= 1;
    next.disabled = feedbackPage >= feedbackPages;
  } catch (error) {
    root.innerHTML = `<div class="empty-state">Feedback is temporarily unavailable.</div>`;
    window.UI.toast(error.message, { title: "Feedback unavailable", type: "error" });
  }
}

function updateFeedbackCharacterCount() {
  const textarea = $("#feedbackComment");
  const counter = $("#feedbackCommentCount");
  if (!textarea || !counter) return;
  const current = textarea.value.length;
  counter.textContent = `${current} / ${FEEDBACK_COMMENT_LIMIT}`;
  counter.classList.toggle("limit-reached", current >= FEEDBACK_COMMENT_LIMIT);
}

export function wireFeedback() {
  $$("#stars button").forEach(button => button.addEventListener("click", () => setRating(Number(button.dataset.rating))));
  setRating(5);
  updateFeedbackCharacterCount();
  $("#feedbackComment").addEventListener("input", updateFeedbackCharacterCount);
  renderFeedbackCooldown();
  handleAuthResult();
  const identityReady = loadFeedbackIdentity();
  document.addEventListener("portfolio:server-status", event => { if (event.detail.ready) void loadFeedbackIdentity(); });
  $("#feedbackPrev").addEventListener("click", () => { if (feedbackPage > 1) loadFeedback(feedbackPage - 1); });
  $("#feedbackNext").addEventListener("click", () => { if (feedbackPage < feedbackPages) loadFeedback(feedbackPage + 1); });
  $("#feedbackIdentityButton").addEventListener("click", openAuthModal);
  $("#feedbackAuthClose").addEventListener("click", closeAuthModal);
  $("#feedbackAuthModal").addEventListener("click", event => { if (event.target.id === "feedbackAuthModal") closeAuthModal(); });
  $("#feedbackAuthProviders").addEventListener("click", event => {
    const button = event.target.closest("[data-feedback-provider]");
    if (!button || button.disabled) return;
    window.location.assign(window.APIManager.apiURL(`/auth/feedback/${encodeURIComponent(button.dataset.feedbackProvider)}/start`));
  });
  $("#feedbackAuthClear").addEventListener("click", async () => {
    try {
      await window.APIManager.clearFeedbackAuthSession();
      renderIdentity(null);
      closeAuthModal();
      window.UI.toast("Choose another provider whenever you are ready.", { title: "Identity cleared" });
    } catch (error) {
      window.UI.toast(error.message, { title: "Could not clear identity", type: "error" });
    }
  });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !$("#feedbackAuthModal").hidden) closeAuthModal(); });

  const form = $("#feedbackForm");
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!feedbackIdentity) {
      window.UI.toast("Choose a verified account before sending feedback.", { title: "Verify identity" });
      openAuthModal();
      return;
    }
    if (getCooldownRemaining() > 0) {
      renderFeedbackCooldown();
      window.UI.toast("Please wait for the feedback cooldown to finish.", { title: "Feedback cooldown", type: "error" });
      return;
    }
    const button = $("#feedbackSubmit");
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.rating = Number(payload.rating);
    window.UI.setButtonLoading(button, true, "Submitting");
    try {
      const result = await window.APIManager.submitFeedback(payload);
      form.reset();
      setRating(5);
      updateFeedbackCharacterCount();
      renderIdentity(feedbackIdentity);
      window.UI.toast(result.message, { title: "Feedback sent" });
      startFeedbackCooldown(Number(result.cooldown_seconds || 30));
    } catch (error) {
      if (error.status === 401) {
        renderIdentity(null);
        openAuthModal();
      }
      if (error.status === 429 && error.data?.retry_after) startFeedbackCooldown(Number(error.data.retry_after));
      else window.UI.setButtonLoading(button, false);
      window.UI.toast(error.message, { title: "Could not submit", type: "error" });
    }
  });

  return identityReady;
}

export function cleanupFeedback() {
  if (feedbackCooldownTimer) clearInterval(feedbackCooldownTimer);
}
