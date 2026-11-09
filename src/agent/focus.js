// @ts-check
import { changeReporter } from "./channel.js";

const FIELD_TAGS = new Set(["INPUT", "TEXTAREA"]);
const FOCUS_EVENTS = ["focusin", "focusout", "selectionchange", "input", "keyup", "mouseup"];

/** @param {Element | null} el @returns {el is HTMLInputElement | HTMLTextAreaElement} */
const isTextField = (el) => Boolean(el) && FIELD_TAGS.has(el.tagName);

/** @param {Element} el */
function mirrorId(el) {
  const id = window.rrweb?.record.mirror.getId(el);
  return id > 0 ? id : null;
}

/** @param {HTMLInputElement | HTMLTextAreaElement} el */
function readSelection(el) {
  try {
    return { start: el.selectionStart, end: el.selectionEnd };
  } catch {
    return { start: null, end: null };
  }
}

/** @returns {import("../../shared/protocol.js").FocusState} */
function focusState() {
  const el = document.activeElement;
  if (!isTextField(el)) return { id: null, start: null, end: null };
  return { id: mirrorId(el), ...readSelection(el) };
}

export function watchFocus() {
  const report = changeReporter("focus");
  const update = () => setTimeout(() => report(JSON.stringify(focusState())), 0);
  for (const type of FOCUS_EVENTS) document.addEventListener(type, update, true);
}
