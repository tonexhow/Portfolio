/* Accessible text-only composer: grows upward to three visual text rows.
 * No dependencies. The footer stays fixed while the message list gives way.
 */
export function bindChatComposer(input) {
  if (!input || input.dataset.composerBound === "1") return () => {};
  input.dataset.composerBound = "1";
  input.rows = 1;
  const adjust = () => {
    const style = getComputedStyle(input);
    const line = parseFloat(style.lineHeight) || (parseFloat(style.fontSize) || 14) * 1.45;
    const extra = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0)
      + (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
    input.style.height = "auto";
    // Keep at least one row, cap the input at three rows with internal scrolling.
    const controlHeight = parseFloat(style.minHeight) || 0;
    const height = Math.max(controlHeight, line + extra, Math.min(input.scrollHeight, line * 3 + extra));
    input.style.height = `${Math.ceil(height)}px`;
    input.style.overflowY = input.scrollHeight > height + 1 ? "auto" : "hidden";
  };
  input.addEventListener("input", adjust);
  requestAnimationFrame(adjust);
  // Both WebSocket sends and Bot sends clear the textarea synchronously.
  const form = input.form;
  form?.addEventListener("submit", () => requestAnimationFrame(adjust));
  return adjust;
}
