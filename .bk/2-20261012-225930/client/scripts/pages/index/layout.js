const { $ } = window.UI;

let resizeObserver = null;
let resizeHandler = null;

function syncSkillStickySide() {
  const technical = $("#technicalSkillBoard");
  const soft = $("#softSkillBoard");
  if (!technical || !soft) return;

  technical.classList.remove("sticky-shorter");
  soft.classList.remove("sticky-shorter");

  if (window.innerWidth < 900) return;

  const technicalHeight = technical.getBoundingClientRect().height;
  const softHeight = soft.getBoundingClientRect().height;
  if (!technicalHeight || !softHeight) return;

  (technicalHeight <= softHeight ? technical : soft).classList.add("sticky-shorter");
}

export function initAdaptiveIndexLayout() {
  syncSkillStickySide();

  if ("ResizeObserver" in window) {
    resizeObserver = new ResizeObserver(syncSkillStickySide);
    const technical = $("#technicalSkillBoard");
    const soft = $("#softSkillBoard");
    if (technical) resizeObserver.observe(technical);
    if (soft) resizeObserver.observe(soft);
  }

  resizeHandler = () => window.requestAnimationFrame(syncSkillStickySide);
  window.addEventListener("resize", resizeHandler, { passive: true });
}

export function refreshAdaptiveIndexLayout() {
  window.requestAnimationFrame(syncSkillStickySide);
}

export function cleanupAdaptiveIndexLayout() {
  resizeObserver?.disconnect();
  if (resizeHandler) window.removeEventListener("resize", resizeHandler);
  resizeObserver = null;
  resizeHandler = null;
}
