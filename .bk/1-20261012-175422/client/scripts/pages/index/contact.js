import { CONTACT_COOLDOWN_KEY } from "./helpers.js?v=40";

const { $ } = window.UI;
const CONTACT_DRAFT_KEY = "jpano-contact-oauth-draft";
let contactCooldownTimer = null;
let contactIdentity = null;
let hasDedicatedContactIdentity = false;
let contactIdentitySyncPromise = Promise.resolve();

function initials(name) {
  return String(name || "G").split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase() || "").join("") || "G";
}

function getCooldownRemaining() {
  const until = Number(localStorage.getItem(CONTACT_COOLDOWN_KEY) || 0);
  return Math.max(0, Math.ceil((until - Date.now()) / 1000));
}

function renderContactCooldown() {
  const button = $("#contactSubmit");
  const note = $("#contactCooldownNote");
  if (!button || !note) return;
  const remaining = getCooldownRemaining();
  if (remaining <= 0) {
    button.disabled = false;
    if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml;
    note.classList.remove("sent");
    note.textContent = "A 30-second cooldown starts after a successful message.";
    localStorage.removeItem(CONTACT_COOLDOWN_KEY);
    if (contactCooldownTimer) {
      clearInterval(contactCooldownTimer);
      contactCooldownTimer = null;
    }
    return;
  }
  if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `<span>Send again in ${remaining}s</span>`;
  note.classList.add("sent");
  note.textContent = `Message sent successfully. You can send another message in ${remaining} second${remaining === 1 ? "" : "s"}.`;
}

function startContactCooldown(seconds = 30) {
  localStorage.setItem(CONTACT_COOLDOWN_KEY, String(Date.now() + (seconds * 1000)));
  googleButton.href = window.APIManager.apiURL("/auth/contact/google/start");
  document.addEventListener("portfolio:server-status", event => { if (event.detail.ready) contactIdentitySyncPromise = syncContactIdentity(); });
  renderContactCooldown();
  if (contactCooldownTimer) clearInterval(contactCooldownTimer);
  contactCooldownTimer = setInterval(renderContactCooldown, 1000);
}

function saveDraft() {
  const form = $("#contactForm");
  if (!form) return;
  const data = Object.fromEntries(new FormData(form).entries());
  sessionStorage.setItem(CONTACT_DRAFT_KEY, JSON.stringify(data));
}

function restoreDraft({ restoreName = true } = {}) {
  const raw = sessionStorage.getItem(CONTACT_DRAFT_KEY);
  if (!raw) return;
  sessionStorage.removeItem(CONTACT_DRAFT_KEY);
  try {
    const data = JSON.parse(raw);
    const name = $("#contactName");
    const subject = document.querySelector('#contactForm [name="subject"]');
    const message = document.querySelector('#contactForm [name="message"]');
    if (restoreName && data.full_name && name && !name.value) name.value = data.full_name;
    if (data.subject && subject) subject.value = data.subject;
    if (data.message && message) message.value = data.message;
  } catch {}
}

function renderContactIdentity(identity, { forceName = false } = {}) {
  contactIdentity = identity?.authenticated && identity.provider === "google" && identity.email_verified ? identity : null;
  const name = $("#contactName");
  const email = $("#contactGoogleEmail");
  const provider = $("#contactGoogleProvider");
  const meta = $("#contactGoogleMeta");
  const avatar = $("#contactGoogleAvatar");
  const button = $("#contactGoogleButton");

  // Be tolerant of a stale service-worker document/script pair during an update.
  if (!name || !email || !provider || !meta || !avatar || !button) return;

  meta.hidden = false;
  if (!contactIdentity) {
    meta.classList.add("unverified");
    provider.textContent = "Gmail not verified";
    email.textContent = "Verify with Google so replies use a confirmed email address.";
    avatar.innerHTML = "<b>G</b>";
    button.textContent = "Verify Gmail";
    return;
  }

  meta.classList.remove("unverified");
  provider.textContent = "Verified with Google";
  email.textContent = contactIdentity.email;
  avatar.innerHTML = `<b>${initials(contactIdentity.display_name)}</b>`;
  if (contactIdentity.avatar_url) {
    const image = document.createElement("img");
    image.src = `${window.APIManager.apiURL(contactIdentity.avatar_url)}?v=${Date.now()}`;
    image.alt = "";
    image.addEventListener("load", () => avatar.prepend(image));
  }
  button.textContent = "Change account";
  if (forceName || !name.value.trim() || name.dataset.identityAutofill === "true") {
    name.value = contactIdentity.display_name || "";
    name.dataset.identityAutofill = "true";
  }
}

async function fetchIdentity(path) { return window.APIManager.request(path, { cache: "no-store" }); }

async function syncContactIdentity({ forceName = false } = {}) {
  try {
    const contact = await fetchIdentity("/api/public/contact-auth/session");
    if (contact?.authenticated) {
      hasDedicatedContactIdentity = true;
      renderContactIdentity(contact, { forceName });
      return;
    }
    hasDedicatedContactIdentity = false;
    const feedback = await fetchIdentity("/api/public/feedback-auth/session");
    renderContactIdentity(feedback?.provider === "google" && feedback?.email_verified ? feedback : null, { forceName });
  } catch {
    hasDedicatedContactIdentity = false;
    renderContactIdentity(null);
  }
}

function handleContactAuthResult() {
  const params = new URLSearchParams(location.search);
  const status = params.get("contact_auth");
  if (!status) return "";
  const messages = {
    ok: ["Gmail verified", "Your verified Google email is ready for contact replies."],
    cancelled: ["Verification cancelled", "No contact account was changed."],
    invalid: ["Verification expired", "Please start Gmail verification again."],
    failed: ["Could not verify Gmail", "Google did not return a usable verified email."],
    unavailable: ["Google sign-in unavailable", "Google OAuth is not configured on the server yet."]
  };
  const [title, message] = messages[status] || messages.failed;
  window.UI.toast(message, { title, type: status === "ok" || status === "cancelled" ? undefined : "error" });
  params.delete("contact_auth");
  const query = params.toString();
  history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}#contact`);
  return status;
}

export function wireContact() {
  const form = $("#contactForm");
  const name = $("#contactName");
  const googleButton = $("#contactGoogleButton");
  if (!form || !name || !googleButton) return Promise.resolve();

  renderContactCooldown();
  const contactAuthStatus = handleContactAuthResult();
  restoreDraft({ restoreName: contactAuthStatus !== "ok" });
  contactIdentitySyncPromise = syncContactIdentity({ forceName: contactAuthStatus === "ok" });
  document.addEventListener("portfolio:feedback-identity", event => {
    if (!hasDedicatedContactIdentity && event.detail?.provider === "google") renderContactIdentity(event.detail);
  });
  name.addEventListener("input", () => { name.dataset.identityAutofill = "false"; });
  googleButton.addEventListener("click", () => {
    saveDraft();
    // Navigation is handled by the real href/target on the link.
    // This also works when the public portfolio is rendered inside a preview iframe.
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    await contactIdentitySyncPromise.catch(() => {});
    if (!contactIdentity) {
      saveDraft();
      window.UI.toast("Verify your Gmail account before sending the message.", { title: "Gmail verification required" });
      const oauthURL = window.APIManager.apiURL("/auth/contact/google/start");
      try {
        window.top.location.href = oauthURL;
      } catch {
        window.location.href = oauthURL;
      }
      return;
    }
    if (getCooldownRemaining() > 0) {
      renderContactCooldown();
      window.UI.toast("Please wait for the contact cooldown to finish.", { title: "Message cooldown", type: "error" });
      return;
    }
    const button = $("#contactSubmit");
    const payload = Object.fromEntries(new FormData(form).entries());
    window.UI.setButtonLoading(button, true, "Sending");
    try {
      const result = await window.APIManager.submitContact(payload);
      form.reset();
      renderContactIdentity(contactIdentity);
      window.UI.toast(result.message, { title: "Message sent" });
      startContactCooldown(Number(result.cooldown_seconds || 30));
    } catch (error) {
      if (error.status === 401) {
        renderContactIdentity(null);
        saveDraft();
      }
      if (error.status === 429 && error.data?.retry_after) startContactCooldown(Number(error.data.retry_after));
      else window.UI.setButtonLoading(button, false);
      window.UI.toast(error.message, { title: "Message not sent", type: "error" });
    }
  });

  return contactIdentitySyncPromise;
}

export function cleanupContact() {
  if (contactCooldownTimer) clearInterval(contactCooldownTimer);
}
