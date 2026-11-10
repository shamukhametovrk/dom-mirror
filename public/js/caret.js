// @ts-check
// Каретка по клику: копия сама находит поле под курсором и ставит в него каретку, не дожидаясь сервера.

const TEXT_FIELDS = new Set(["INPUT", "TEXTAREA"]);

/** @param {any} el @returns {el is HTMLInputElement | HTMLTextAreaElement} */
const isTextField = (el) => Boolean(el) && TEXT_FIELDS.has(el.tagName);

/** @param {Document} doc @param {number} x @param {number} y @returns {{ node: Node, offset: number } | null} */
function caretAt(doc, x, y) {
  const pos = /** @type {any} */ (doc).caretPositionFromPoint?.(x, y);
  if (pos) return { node: pos.offsetNode, offset: pos.offset };
  const range = doc.caretRangeFromPoint?.(x, y);
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
}

/** @param {HTMLInputElement | HTMLTextAreaElement} el */
const isWritable = (el) => !el.disabled && !el.readOnly;

/** @param {Document} doc @param {number} x @param {number} y @returns {HTMLElement | null} */
function editableAt(doc, x, y) {
  const el = /** @type {any} */ (doc.elementFromPoint(x, y));
  if (isTextField(el)) return isWritable(el) ? el : null;
  return el?.isContentEditable ? el.closest("[contenteditable]:not([contenteditable=false])") : null;
}

/** @param {HTMLElement} el @param {{ node: Node, offset: number }} caret */
function moveCaret(el, caret) {
  if (isTextField(el)) return caret.node === el && el.setSelectionRange(caret.offset, caret.offset);
  if (el.contains(caret.node)) el.ownerDocument.getSelection().collapse(caret.node, caret.offset);
}

/** @param {Document} doc @param {number} x @param {number} y @returns {boolean} каретка поставлена */
export function predictCaret(doc, x, y) {
  const el = editableAt(doc, x, y);
  if (!el) return false;
  el.focus({ preventScroll: true });
  const caret = caretAt(doc, x, y);
  if (caret) moveCaret(el, caret);
  return true;
}

/** @param {DOMRect} r */
const center = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

/** Поле с фокусом в копии, если оно есть. @param {HTMLIFrameElement} iframe */
function focusedBox(iframe) {
  const el = iframe.contentDocument?.activeElement;
  return el && el !== el.ownerDocument.body ? el.getBoundingClientRect() : null;
}

// Куда «бросить» вставленный файл: в середину поля с фокусом, иначе в середину страницы.
/** @param {HTMLIFrameElement} iframe */
export function focusedPoint(iframe) {
  const box = focusedBox(iframe);
  return center(box?.width ? box : new DOMRect(0, 0, iframe.clientWidth, iframe.clientHeight));
}
