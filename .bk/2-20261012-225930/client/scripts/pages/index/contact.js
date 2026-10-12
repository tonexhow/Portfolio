import { CONTACT_COOLDOWN_KEY } from "./helpers.js?v=40";

const { $ } = window.UI;
const CONTACT_DRAFT_KEY = "jpano-contact-oauth-draft";
let contactCooldownTimer = null;
let contactIdentity = null;
let feedbackIdentity = null;
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

function renderContactIdentity(identity, { forceName = false, feedback = null } = {}) {
  // These objects are returned by the Go server's verified HTTP-only sessions,
  // never from an editable form field or a browser-managed OAuth token.
  contactIdentity = identity?.authenticated && identity.provider === "google" && identity.email_verified ? identity : null;
  feedbackIdentity = feedback?.authenticated ? feedback : null;
  const name = $("#contactName");
  const email = $("#contactGoogleEmail");
  const provider = $("#contactGoogleProvider");
  const meta = $("#contactGoogleMeta");
  const avatar = $("#contactGoogleAvatar");
  const button = $("#contactGoogleButton");
  if (!name || !email || !provider || !meta || !avatar || !button) return;

  const active = contactIdentity || feedbackIdentity;
  const selectedName = active?.display_name || "";
  if (selectedName && (forceName || !name.value.trim() || name.dataset.identityAutofill === "true")) {
    name.value = selectedName;
    name.dataset.identityAutofill = "true";
  }
  meta.hidden = false;
  meta.classList.toggle("unverified", !contactIdentity);
  avatar.replaceChildren();
  const initial = document.createElement("b");
  initial.textContent = initials(selectedName);
  avatar.append(initial);
  if (active?.avatar_url) {
    const image = document.createElement("img");
    image.src = `${window.APIManager.apiURL(active.avatar_url)}?v=${Date.now()}`;
    image.alt = "";
    image.addEventListener("load", () => avatar.prepend(image));
  }

  if (contactIdentity) {
    provider.textContent = "Google email verified";
    email.textContent = contactIdentity.email;
    button.textContent = "Change account";
  } else if (feedbackIdentity) {
    const label = ({ google: "Google", github: "GitHub", facebook: "Facebook", telegram: "Telegram" })[feedbackIdentity.provider] || "Account";
    provider.textContent = `Signed in with ${label}`;
    email.textContent = "A verified Google email is required to send a Contact message. Select Google to continue.";
    button.textContent = "Verify Google email";
  } else {
    provider.textContent = "Email not verified";
    email.textContent = "Choose Google to verify an email before sending. The same account can be used for Feedback.";
    button.textContent = "Verify account";
  }
}

async function syncContactIdentity({ forceName = false } = {}) {
  try {
    // Contact's session endpoint reuses a valid Feedback Google session on the
    // current Go backend, while retaining support for older dedicated sessions.
    const [contact, feedback] = await Promise.all([
      window.APIManager.getContactAuthSession(),
      window.APIManager.getFeedbackAuthSession()
    ]);
    renderContactIdentity(contact, { feedback, forceName });
  } catch {
    renderContactIdentity(null);
  }
}

function requestSharedIdentity() {
  saveDraft();
  document.dispatchEvent(new CustomEvent("portfolio:request-shared-identity", {
    detail: { source: "contact", preferredProvider: "google" }
  }));
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
    unavailable: ["Google sign-in unavailable", "This sign-in option is currently unavailable. Please try again later."]
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
  document.addEventListener("portfolio:feedback-identity", () => {
    contactIdentitySyncPromise = syncContactIdentity();
  });
  document.addEventListener("portfolio:server-status", event => {
    if (event.detail.ready) contactIdentitySyncPromise = syncContactIdentity();
  });
  name.addEventListener("input", () => { name.dataset.identityAutofill = "false"; });
  googleButton.addEventListener("click", requestSharedIdentity);

  form.addEventListener("submit", async event => {
    event.preventDefault();
    await contactIdentitySyncPromise.catch(() => {});
    if (!contactIdentity) {
      saveDraft();
      window.UI.toast("Choose Google in the shared account dialog to verify your email before sending.", { title: "Google verification required" });
      requestSharedIdentity();
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
