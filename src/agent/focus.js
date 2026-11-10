// @ts-check
// Где фокус и каретка: в поле ввода — позиция выделения; в редакторе (contenteditable, как у ChatGPT) —
// узлы и смещения выделения по нумерации rrweb, чтобы копия поставила каретку туда же.
import { changeReporter, onRefresh } from "./channel.js";

/** @typedef {import("../../shared/protocol.js").FocusState} FocusState */

const FIELD_TAGS = new Set(["INPUT", "TEXTAREA"]);
const FOCUS_EVENTS = ["focusin", "focusout", "selectionchange", "input", "keyup", "mouseup"];
const NO_FOCUS = { id: null, start: null, end: null };

/** @param {Element | null} el @returns {el is HTMLInputElement | HTMLTextAreaElement} */
const isTextField = (el) => Boolean(el) && FIELD_TAGS.has(el.tagName);

/** @param {Node | null} node */
function mirrorId(node) {
  const id = node && window.rrweb?.record.mirror.getId(node);
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

/** @returns {FocusState["editable"]} */
function editableSelection() {
  const sel = document.getSelection();
  if (!sel?.anchorNode) return null;
  const anchorId = mirrorId(sel.anchorNode);
  const focusId = mirrorId(sel.focusNode);
  return anchorId && focusId ? { anchorId, anchorOffset: sel.anchorOffset, focusId, focusOffset: sel.focusOffset } : null;
}

/** @returns {FocusState} */
function focusState() {
  const el = document.activeElement;
  if (isTextField(el)) return { id: mirrorId(el), ...readSelection(el) };
  if (/** @type {HTMLElement} */ (el)?.isContentEditable) return { ...NO_FOCUS, id: mirrorId(el), editable: editableSelection() };
  return NO_FOCUS;
}

export function watchFocus() {
  const report = changeReporter("focus");
  const update = () => setTimeout(() => report(JSON.stringify(focusState())), 0);
  for (const type of FOCUS_EVENTS) document.addEventListener(type, update, true);
  onRefresh(update);
}
