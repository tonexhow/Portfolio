/* JPano digital business card. Front-end only, no server or authentication required. */
const ASSETS = Object.freeze({
  front: "/assets/cards/front-bc.png",
  back: "/assets/cards/back-bc.png"
});

const ICONS = Object.freeze({
  close: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/></svg>',
  flip: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11a8 8 0 0 1 13.8-5.5L20 8M20 4v4h-4M20 13a8 8 0 0 1-13.8 5.5L4 16m0 4v-4h4"/></svg>'
});

export function initBusinessCardModal() {
  // Use event delegation: the footer is rendered dynamically and can be re-mounted.
  if (document.getElementById("jpanoBusinessCardDialog")) return;

  const dialog = document.createElement("dialog");
  dialog.id = "jpanoBusinessCardDialog";
  dialog.className = "business-card-dialog";
  dialog.setAttribute("aria-labelledby", "businessCardTitle");
  dialog.setAttribute("aria-describedby", "businessCardDescription");
  dialog.innerHTML = `
    <div class="business-card-panel">
      <div class="business-card-head">
        <div class="business-card-brand">
          <span class="business-card-monogram" aria-hidden="true">JP<span>.</span></span>
          <div class="business-card-heading">
            <span class="business-card-eyebrow">JPANO.DEV <span aria-hidden="true">/</span> DIGITAL BUSINESS CARD</span>
            <h2 id="businessCardTitle">Jhon Anthony Pano</h2>
            <p id="businessCardDescription">Full Stack Developer <span aria-hidden="true">·</span> Available for collaboration</p>
          </div>
        </div>
        <button class="business-card-close" type="button" data-business-card-close aria-label="Close business card">${ICONS.close}</button>
      </div>

      <div class="business-card-toolbar">
        <span class="business-card-side-caption" role="status" aria-live="polite" aria-atomic="true" data-card-side-label>01 <span>/ 02</span> &nbsp; FRONT SIDE</span>
        <div class="business-card-switch" role="group" aria-label="Select business card side">
          <button type="button" data-card-side="front" aria-pressed="true">Front</button>
          <button type="button" data-card-side="back" aria-pressed="false">Back <span aria-hidden="true">·</span> QR</button>
        </div>
      </div>

      <button class="business-card-stage" type="button" data-card-flip aria-label="Flip to the back of the business card" title="Flip card to view the other side">
        <span class="business-card-rotator" data-business-card-rotator>
          <span class="business-card-face business-card-front"><img src="${ASSETS.front}" alt="Front of Jhon Anthony Pano's JPano.dev business card" width="1659" height="948" decoding="async"></span>
          <span class="business-card-face business-card-back"><img src="${ASSETS.back}" alt="Back of Jhon Anthony Pano's business card showing contact information and QR code" width="1672" height="941" decoding="async"></span>
        </span>
        <span class="business-card-stage-hint" aria-hidden="true">${ICONS.flip} Click to flip</span>
      </button>

      <div class="business-card-actions">
        <div class="business-card-quality"><span class="business-card-quality-icon" aria-hidden="true">✓</span><span><strong>Original quality</strong><small>PNG · Save either side</small></span></div>
        <div class="business-card-downloads" aria-label="Download business card images">
          <a href="${ASSETS.front}" download="Jhon-Anthony-Pano-Business-Card-Front.png" class="business-card-download is-current" data-download-card="front">${ICONS.download} <span>Download front</span></a>
          <a href="${ASSETS.back}" download="Jhon-Anthony-Pano-Business-Card-Back.png" class="business-card-download" data-download-card="back">${ICONS.download} <span>Download back</span></a>
        </div>
      </div>
    </div>`;
  document.body.append(dialog);

  const rotator = dialog.querySelector("[data-business-card-rotator]");
  const sideButtons = [...dialog.querySelectorAll("[data-card-side]")];
  const downloads = [...dialog.querySelectorAll("[data-download-card]")];
  const flipButton = dialog.querySelector("[data-card-flip]");
  const status = dialog.querySelector("[data-card-side-label]");
  const closeButton = dialog.querySelector("[data-business-card-close]");
  let selected = "front";
  let restoreFocus = null;
  let oldOverflow = "";

  function choose(side) {
    if (!Object.hasOwn(ASSETS, side)) return;
    selected = side;
    rotator.classList.toggle("is-flipped", side === "back");
    sideButtons.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.cardSide === side)));
    downloads.forEach(link => link.classList.toggle("is-current", link.dataset.downloadCard === side));
    status.innerHTML = side === "front" ? '01 <span>/ 02</span> &nbsp; FRONT SIDE' : '02 <span>/ 02</span> &nbsp; BACK &amp; QR';
    flipButton.setAttribute("aria-label", `Flip to the ${side === "front" ? "back" : "front"} of the business card`);
  }

  function open(trigger) {
    if (dialog.open) return;
    restoreFocus = trigger;
    oldOverflow = document.body.style.overflow;
    choose("front");
    dialog.showModal();
    document.body.style.overflow = "hidden";
    closeButton.focus({ preventScroll: true });
  }
  function close() { if (dialog.open) dialog.close(); }

  document.addEventListener("click", event => {
    const trigger = event.target.closest?.("[data-business-card-open]");
    if (trigger && !dialog.contains(trigger)) open(trigger);
  });
  sideButtons.forEach(button => button.addEventListener("click", () => choose(button.dataset.cardSide)));
  flipButton.addEventListener("click", () => choose(selected === "front" ? "back" : "front"));
  closeButton.addEventListener("click", close);
  dialog.addEventListener("click", event => { if (event.target === dialog) close(); });
  dialog.addEventListener("keydown", event => {
    if (["ArrowLeft", "ArrowRight"].includes(event.key) && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      choose(event.key === "ArrowLeft" ? "front" : "back");
    }
  });
  dialog.addEventListener("close", () => {
    document.body.style.overflow = oldOverflow;
    restoreFocus?.focus({ preventScroll: true });
    restoreFocus = null;
  });
}
