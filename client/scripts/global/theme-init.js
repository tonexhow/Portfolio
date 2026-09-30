(() => {
  let mode;
  try {
    const saved = localStorage.getItem("jpano-theme");
    if (saved === "light" || saved === "dark") mode = saved;
  } catch {}
  if (!mode) mode = matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
  document.documentElement.dataset.theme = mode;
})();
