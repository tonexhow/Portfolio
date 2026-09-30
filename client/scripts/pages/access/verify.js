import { clearAccessState, formatRemaining, initAccessShell, recoverPendingState, saveAccessState } from "./common.js";

initAccessShell();

const root = document.querySelector("#otpInputs");
const destination = document.querySelector("#verifyDestination");
const attempts = document.querySelector("#attemptCount");
const countdown = document.querySelector("#requestCountdown");
const timebar = document.querySelector("#requestTimebar");
const approval = document.querySelector("#approvalChannel");
const approvalTitle = document.querySelector("#approvalTitle");
const approvalText = document.querySelector("#approvalText");

let requestState = null;
let eventSource = null;
let busy = false;
let expiryTimer = null;

function createOTPInputs() {
  root.replaceChildren();
  for (let index = 0; index < 6; index += 1) {
    const input = document.createElement("input");
    input.className = "otp-char";
    input.type = "text";
    input.inputMode = "numeric";
    input.pattern = "[0-9]*";
    input.maxLength = 1;
    input.autocomplete = index === 0 ? "one-time-code" : "off";
    input.setAttribute("aria-label", `OTP digit ${index + 1}`);
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "").slice(-1);
      if (input.value && index < 5) root.children[index + 1]?.focus();
      maybeSubmit();
    });
    input.addEventListener("keydown", event => {
      if (event.key === "Backspace" && !input.value && index > 0) root.children[index - 1]?.focus();
      if (event.key === "ArrowLeft" && index > 0) root.children[index - 1]?.focus();
      if (event.key === "ArrowRight" && index < 5) root.children[index + 1]?.focus();
    });
    input.addEventListener("paste", event => {
      const digits = event.clipboardData?.getData("text").replace(/\D/g, "").slice(0, 6) || "";
      if (!digits) return;
      event.preventDefault();
      [...digits].forEach((digit, digitIndex) => { if (root.children[digitIndex]) root.children[digitIndex].value = digit; });
      root.children[Math.min(digits.length, 6) - 1]?.focus();
      maybeSubmit();
    });
    root.append(input);
  }
}

function otpValue() {
  return [...root.children].map(input => input.value).join("");
}

function lockOTP(locked) {
  [...root.children].forEach(input => { input.disabled = locked; });
}

function setApproval(title, text, live = true) {
  approval.classList.toggle("live", live);
  approvalTitle.textContent = title;
  approvalText.textContent = text;
}

function updateExpiry() {
  const expires = Date.parse(requestState?.expires_at || "");
  if (!expires) return;
  const remaining = Math.max(0, expires - Date.now());
  countdown.textContent = formatRemaining(remaining);
  timebar.style.width = `${Math.min(100, Math.max(0, remaining / (15 * 60 * 10)))}%`;
  if (remaining <= 0) {
    clearInterval(expiryTimer);
    clearAccessState();
    eventSource?.close();
    window.UI.toast("The verification window expired. Start a new challenge.", { title: "Access expired", type: "error" });
    setTimeout(() => location.replace("/access"), 900);
  }
}

async function maybeSubmit() {
  if (busy || window.ServerStatus?.ready !== true || !requestState) return;
  const otp = otpValue();
  if (otp.length !== 6) return;
  busy = true;
  lockOTP(true);
  setApproval("Checking OTP", "Verifying the 6-digit code for this browser…", true);
  try {
    const data = await window.APIManager.verifyAccessOTP({ request_id: requestState.request_id, otp });
    clearAccessState();
    eventSource?.close();
    localStorage.setItem("jpano-management-known-until",String(Date.now()+12*60*60*1000));
    location.replace(data.redirect || "/admin");
  } catch (error) {
    if (error.data?.reset_challenge) {
      clearAccessState();
      eventSource?.close();
      window.UI.toast(error.message, { title: "Challenge reset", type: "error" });
      setTimeout(() => location.replace("/access"), 900);
      return;
    }
    const remaining = Number(error.data?.attempts_remaining);
    if (Number.isFinite(remaining)) attempts.textContent = `${remaining} attempt${remaining === 1 ? "" : "s"}`;
    [...root.children].forEach(input => { input.value = ""; });
    root.children[0]?.focus();
    window.UI.toast(error.message, { title: "Incorrect OTP", type: "error" });
    setApproval("Waiting for verification", "Enter the OTP again or use Grant Access from the email.", true);
  } finally {
    busy = false;
    lockOTP(window.ServerStatus?.ready !== true);
  }
}

async function finalizeGrant() {
  if (busy) return;
  busy = true;
  lockOTP(true);
  setApproval("Grant received", "Creating the 12-hour management session for this browser…", true);
  try {
    const data = await window.APIManager.finalizeManagementAccess(requestState.request_id);
    clearAccessState();
    eventSource?.close();
    localStorage.setItem("jpano-management-known-until",String(Date.now()+12*60*60*1000));
    location.replace(data.redirect || "/admin");
  } catch (error) {
    busy = false;
    lockOTP(window.ServerStatus?.ready !== true);
    setApproval("Grant could not be finalized", error.message, false);
    window.UI.toast(error.message, { title: "Access", type: "error" });
  }
}

function connectEvents() {
  eventSource?.close();
  eventSource = window.APIManager.openAccessEvents(requestState.request_id);
  eventSource.addEventListener("open", () => setApproval("Waiting for email approval", "Live approval channel connected. OTP entry also remains available.", true));
  eventSource.addEventListener("granted", finalizeGrant);
  eventSource.addEventListener("expired", () => {
    clearAccessState();
    eventSource.close();
    setApproval("Request expired", "Start a new challenge to request access again.", false);
    setTimeout(() => location.replace("/access"), 900);
  });
  eventSource.addEventListener("reset", () => {
    clearAccessState();
    eventSource.close();
    setTimeout(() => location.replace("/access"), 400);
  });
  eventSource.onerror = () => setApproval("Reconnecting approval channel", "The live connection was interrupted. The browser will reconnect automatically without polling.", false);
}

(async function start() {
  createOTPInputs();
  requestState = await recoverPendingState().catch(() => null);
  if (!requestState) {
    location.replace("/access");
    return;
  }
  saveAccessState(requestState);
  destination.textContent = requestState.destination || "your configured email";
  root.children[0]?.focus();
  updateExpiry();
  expiryTimer = setInterval(updateExpiry, 250);
  lockOTP(window.ServerStatus?.ready !== true);
  connectEvents();
})();
document.addEventListener("portfolio:server-status",event=>{
  lockOTP(busy||!event.detail.ready);
  if(!event.detail.ready)setApproval("Server is offline","Your pending verification is preserved. Reconnect before entering the code.",false);
});
