import { initAccessShell } from "./common.js";

window.UI.Theme.init();

const title = document.querySelector("#grantTitle");
const message = document.querySelector("#grantMessage");
const icon = document.querySelector("#grantIcon");
const actions = document.querySelector("#grantActions");

function showSuccess(text) {
  icon.innerHTML = "✓";
  title.textContent = "Access granted.";
  message.textContent = text;
  actions.hidden = false;
}

function showError(text) {
  icon.textContent = "!";
  icon.style.background = "color-mix(in srgb,var(--danger) 12%,var(--surface))";
  icon.style.color = "var(--danger)";
  title.textContent = "Grant unavailable.";
  message.textContent = text;
  actions.hidden = false;
}

(async function grant() {
  const token = new URLSearchParams(location.hash.slice(1)).get("token");
  history.replaceState(null, "", "/access/grant");
  if (!token) {
    showError("This grant link is missing its one-time token or has already been cleaned from the address bar.");
    return;
  }
  try {
    const data = await window.APIManager.grantManagementAccess(token);
    try {
      const finalized = await window.APIManager.finalizeManagementAccess(data.request_id);
      localStorage.setItem("jpano-management-known-until",String(Date.now()+12*60*60*1000));
      location.replace(finalized.redirect || "/admin");
      return;
    } catch {
      showSuccess("The original requesting browser has been notified. Return to that browser to continue into management.");
    }
  } catch (error) {
    showError(error.message);
  }
})();
