// @ts-check
import { changeReporter } from "./channel.js";

const POINTER_SELECTOR = "a[href], button, [role=button], label, summary, select";
const TEXT_SELECTOR = "input, textarea, [contenteditable=''], [contenteditable=true]";

/** @param {Element} el */
const hasOwnText = (el) => [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());

/** @param {Element} el */
function inferredCursor(el) {
  if (el.closest(POINTER_SELECTOR)) return "pointer";
  if (el.closest(TEXT_SELECTOR)) return "text";
  return hasOwnText(el) ? "text" : "default";
}

/** @param {any} el @returns {string} */
function cursorFor(el) {
  if (el?.nodeType !== Node.ELEMENT_NODE) return "default";
  const css = getComputedStyle(el).cursor;
  return css && css !== "auto" ? css : inferredCursor(el);
}

export function watchCursor() {
  const report = changeReporter("cursor");
  document.addEventListener("mousemove", (e) => report(cursorFor(e.target)), true);
}
