export const ORIGINAL_TITLE = "Jhon Anthony Pano · Portfolio";
export const CONTACT_COOLDOWN_KEY = "jpano-contact-cooldown-until";
export const FEEDBACK_COOLDOWN_KEY = "jpano-feedback-cooldown-until";

export const ICONS = {
  github:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3.3-.4 6.8-1.6 6.8-7A5.4 5.4 0 0 0 19.4 4 5 5 0 0 0 19.3.5S18.1.1 15 1.8a13.4 13.4 0 0 0-7 0C4.9.1 3.7.5 3.7.5A5 5 0 0 0 3.6 4a5.4 5.4 0 0 0-1.4 3.7c0 5.3 3.5 6.5 6.8 6.9A4.8 4.8 0 0 0 8 18v4"/><path d="M8 19c-3 .9-3-1.5-4-2"/></svg>',
  linkedin:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="9" width="4" height="12"/><circle cx="5" cy="5" r="2"/><path d="M11 21V9h4v2c1-1.6 2.5-2.4 4-2 2 .4 2 2.2 2 5v7h-4v-6c0-1.5-.5-2.5-1.8-2.5S15 13.6 15 15v6z"/></svg>',
  facebook:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 8h4V4h-4c-3 0-5 2-5 5v3H6v4h3v6h4v-6h4l1-4h-5V9c0-.7.3-1 1-1z"/></svg>',
  x:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4l16 16M20 4 4 20"/></svg>',
  email:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  phone:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c1 .3 1.9.6 2.9.7a2 2 0 0 1 1.7 2z"/></svg>'
};

export function escapeHTML(value) {
  const el = document.createElement("div");
  el.textContent = String(value ?? "");
  return el.innerHTML;
}

export function isVisibleValue(value) {
  if (value === undefined || value === null) return false;
  const text = String(value).trim();
  return text !== "" && !/^(n\/?a|none|null|undefined|-)$/i.test(text);
}

export function formatMoney(value, currency = "PHP") {
  try {
    return new Intl.NumberFormat("en-PH", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(value) || 0);
  } catch {
    return `₱${Number(value || 0).toLocaleString("en-PH")}`;
  }
}

export function compactMoney(value, currency = "PHP") {
  const num = Number(value) || 0;
  if (currency === "PHP" && num >= 1000) {
    return `₱${(num / 1000).toLocaleString("en-PH", { maximumFractionDigits: 1 })}K`;
  }
  return formatMoney(num, currency);
}

export function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function secureRandomIndex(max, excluded = -1) {
  if (max <= 1) return max ? 0 : -1;
  const available = Array.from({ length: max }, (_, i) => i).filter(i => i !== excluded);
  const values = new Uint32Array(1);
  const range = 0x100000000;
  const limit = range - (range % available.length);
  let value;
  do {
    crypto.getRandomValues(values);
    value = values[0];
  } while (value >= limit);
  return available[value % available.length];
}

export function phoneHref(value) {
  return `tel:${String(value || "").replace(/[^+\d]/g, "")}`;
}
