import { secureRandomIndex } from "./helpers.js";

const { $ } = window.UI;
let profilePaths = [];
let currentProfile = -1;
let profileTimer = null;

export async function initProfileRotation(getPersonal) {
  const image = $("#profileImage");
  const loader = $("#portraitLoader");
  const card = $("#portraitCard");
  if (!image) return;
  cleanupProfileRotation();

  const show = (index, animate = false) => new Promise(resolve => {
    const path = profilePaths[index];
    if (!path) { resolve(false); return; }
    const preload = new Image();
    preload.onload = () => {
      const commit = () => {
        image.classList.remove("loaded");
        image.src = preload.src;
        image.alt = `Portrait of ${getPersonal()?.name?.full || "Jhon Anthony Pano"}`;
        requestAnimationFrame(() => image.classList.add("loaded"));
        loader?.classList.add("hidden");
        currentProfile = index;
        resolve(true);
      };

      if (!animate || matchMedia("(prefers-reduced-motion: reduce)").matches) {
        commit();
        return;
      }

      card?.classList.remove("profile-switching");
      void card?.offsetWidth;
      card?.classList.add("profile-switching");
      window.setTimeout(commit, 590);
      window.setTimeout(() => card?.classList.remove("profile-switching"), 1220);
    };
    preload.onerror = () => { loader?.classList.add("hidden"); resolve(false); };
    preload.src = window.PublicStore.mediaURL(path, "/assets/profiles/1.png");
  });

  try {
    const result = await window.APIManager.getProfiles();
    profilePaths = Array.isArray(result.items) ? result.items : [];
    if (!profilePaths.length) throw new Error("No profile images found.");
    await show(secureRandomIndex(profilePaths.length), false);
    if (profilePaths.length > 1) {
      profileTimer = window.setInterval(() => { void show(secureRandomIndex(profilePaths.length, currentProfile), true); }, 60000);
    }
  } catch (error) {
    loader?.classList.add("hidden");
    image.alt = "Profile image unavailable";
    console.warn(error.message);
  }
}

export function cleanupProfileRotation() {
  if (profileTimer) window.clearInterval(profileTimer);
}
