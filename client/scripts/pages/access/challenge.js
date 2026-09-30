import { clearAccessState, collectDeviceInfo, formatRemaining, initAccessShell, recoverPendingState, saveAccessState, setStatus } from "./common.js";

initAccessShell();

const display = document.querySelector("#challengeDisplay");
const inputsRoot = document.querySelector("#challengeInputs");
const countdown = document.querySelector("#challengeCountdown");
const timebar = document.querySelector("#challengeTimebar");
const stateLabel = document.querySelector("#challengeState");
const correctCount = document.querySelector("#correctCount");
const correctProgress = document.querySelector("#correctProgress");
const hint = document.querySelector("#challengeHint");
const status = document.querySelector("#accessStatus");
const noCopy = document.querySelector("#challengeNoCopy");

let challenge = null;
let challengeId = "";
let expiresAt = 0;
let refreshTimer = null;
let countdownTimer = null;
let submitting = false;
let generation = 0;

function makeInputs() {
  inputsRoot.replaceChildren();
  for (let index = 0; index < 12; index += 1) {
    const input = document.createElement("input");
    input.className = "challenge-char";
    input.type = "text";
    input.maxLength = 1;
    input.autocomplete = "off";
    input.autocapitalize = "off";
    input.spellcheck = false;
    input.inputMode = "text";
    input.setAttribute("aria-label", `Challenge character ${index + 1}`);
    ["copy", "cut", "paste", "drop", "contextmenu"].forEach(event => input.addEventListener(event, e => e.preventDefault()));
    input.addEventListener("keydown", event => {
      if ((event.ctrlKey || event.metaKey) && ["a", "c", "v", "x"].includes(event.key.toLowerCase())) event.preventDefault();
      if (event.key === "Backspace" && !input.value && index > 0) inputsRoot.children[index - 1]?.focus();
      if (event.key === "ArrowLeft" && index > 0) inputsRoot.children[index - 1]?.focus();
      if (event.key === "ArrowRight" && index < 11) inputsRoot.children[index + 1]?.focus();
    });
    input.addEventListener("input", () => {
      if (input.value.length > 1) input.value = input.value.slice(-1);
      if (input.value && index < 11) inputsRoot.children[index + 1]?.focus();
      updateProgress();
    });
    inputsRoot.append(input);
  }
}

noCopy?.addEventListener("copy", event => event.preventDefault());
noCopy?.addEventListener("contextmenu", event => event.preventDefault());

function lockInputs(locked) {
  [...inputsRoot.children].forEach(input => { input.disabled = locked; });
}

function enteredValue() {
  return [...inputsRoot.children].map(input => input.value).join("");
}

function updateProgress() {
  if (!challenge) return;
  let correct = 0;
  let filled = 0;
  [...inputsRoot.children].forEach((input, index) => {
    const value = input.value;
    input.classList.remove("correct", "incorrect");
    if (!value) return;
    filled += 1;
    if (value === challenge[index]) {
      correct += 1;
      input.classList.add("correct");
    } else {
      input.classList.add("incorrect");
    }
  });
  correctCount.textContent = `${correct} / 12 correct`;
  correctProgress.style.width = `${(correct / 12) * 100}%`;
  hint.textContent = filled === 12 && correct < 12 ? "Some characters do not match" : "Type each character manually";

  if (correct === 12 && filled === 12 && !submitting) submitChallenge();
}

function updateCountdown() {
  const remaining = Math.max(0, expiresAt - Date.now());
  countdown.textContent = formatRemaining(remaining);
  timebar.style.width = `${Math.max(0, Math.min(100, remaining / 600))}%`;
  if (remaining <= 0) stateLabel.textContent = "Challenge expired";
}

async function loadChallenge() {
  const myGeneration = ++generation;
  submitting = false;
  clearTimeout(refreshTimer);
  clearInterval(countdownTimer);
  makeInputs();
  lockInputs(true);
  display.textContent = "••••••••••••";
  correctCount.textContent = "0 / 12 correct";
  correctProgress.style.width = "0%";
  stateLabel.textContent = "Generating new key";
  setStatus(status, "Preparing challenge", "A new 12-character key is being generated for this browser.", "working");

  try {
    const data = await window.APIManager.createAccessChallenge();
    if (myGeneration !== generation) return;
    challenge = data.challenge;
    challengeId = data.challenge_id;
    expiresAt = Date.parse(data.expires_at) || Date.now() + 60000;
    display.textContent = challenge;
    stateLabel.textContent = "Active";
    lockInputs(false);
    inputsRoot.querySelector("input")?.focus();
    setStatus(status, "Waiting for input", "Complete the challenge to request the verification email automatically.");
    updateCountdown();
    countdownTimer = setInterval(updateCountdown, 200);
    refreshTimer = setTimeout(loadChallenge, Math.max(250, expiresAt - Date.now() + 50));
  } catch (error) {
    stateLabel.textContent = "Unavailable";
    setStatus(status, "Challenge unavailable", error.message, "error");
    refreshTimer = setTimeout(loadChallenge, 10000);
  }
}

async function submitChallenge() {
  submitting = true;
  clearTimeout(refreshTimer);
  lockInputs(true);
  stateLabel.textContent = "Matched";
  setStatus(status, "Challenge matched", "Preparing your email verification request…", "working");

  try {
    const data = await window.APIManager.requestManagementAccess({
      challenge_id: challengeId,
      key: enteredValue(),
      device: collectDeviceInfo()
    });
    saveAccessState(data);
    setStatus(status, "Verification email sent", `Continue with the OTP or Grant Access link sent to ${data.destination}.`, "working");
    location.replace("/access/verify");
  } catch (error) {
    submitting = false;
    const retry = error.data?.retry_after;
    const message = retry ? `${error.message} Try again in ${formatRemaining(retry * 1000)}.` : error.message;
    setStatus(status, "Email request blocked", message, "error");
    window.UI.toast(message, { title: "Access request", type: "error" });
    setTimeout(loadChallenge, 1600);
  }
}

(async function start() {
  clearAccessState();
  const pending = await recoverPendingState().catch(() => null);
  if (pending) {
    location.replace("/access/verify");
    return;
  }
  loadChallenge();
})();
