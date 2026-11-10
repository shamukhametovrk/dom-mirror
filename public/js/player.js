// @ts-check
// Воспроизведение копии. Ввод всегда уходит на сервер, а текст в полях приходит обратно от rrweb.
import { EventType, IncrementalSource } from "../../shared/protocol.js";
import { smoothScrolling } from "./scroll-smoother.js";
import { createLocalScroll } from "./local-scroll.js";
import { focusedPoint, predictCaret } from "./caret.js";

/** @typedef {import("../../shared/protocol.js").FocusState} FocusState */
/** @typedef {Record<string, (e: Event) => void>} Handlers */

const REPLAYER_OPTIONS = { liveMode: true, mouseTail: false, triggerFocus: false, showWarning: false };
const FOCUS_DELAY_MS = 30;
// столько копия держит предсказанную каретку, если сервер не сообщил о фокусе (клик мимо поля на сервере)
const PREDICTION_HOLD_MS = 700;
const FILL_DEBOUNCE_MS = 150;
const TEXT_FIELDS = new Set(["INPUT", "TEXTAREA"]);
const FORM_FIELDS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

const isTextField = (el) => Boolean(el) && TEXT_FIELDS.has(el.tagName);
const isFormField = (el) => Boolean(el) && FORM_FIELDS.has(el.tagName);

/** @param {any} event */
const attributeChanges = (event) => (event.type === EventType.IncrementalSnapshot && event.data.source === IncrementalSource.Mutation
  ? (event.data.attributes ?? []).filter((c) => c.attributes && "value" in c.attributes)
  : []);

/** @param {HTMLInputElement | HTMLTextAreaElement} el @param {FocusState} focus */
function focusField(el, focus) {
  if (el.ownerDocument.activeElement !== el) el.focus({ preventScroll: true });
  try {
    if (focus.start != null) el.setSelectionRange(focus.start, focus.end);
  } catch { /* поле без выделения (type=email и т.п.) */ }
}

// Прокрутка: копия ведёт её сама (local-scroll), позиции сервера — для остального (scroll-smoother).
/** @param {() => any} getReplayer @param {(msg: import("../../shared/protocol.js").ClientMessage) => void} send */
function createScrolling(getReplayer, send) {
  let smoother = null;
  const local = createLocalScroll({ getReplayer, send, adopt: (scroller, data) => smoother?.move(scroller, data) });
  return {
    attach(replayer) {
      local.reset();
      smoother = smoothScrolling(replayer, local.ignores);
      replayer.on("fullsnapshot-rebuilded", local.reset);
    },
    handle: local.handle,
    flush: local.flush,
  };
}

// Редактор в копии с фокусом можно было бы править локально (IME, перетаскивание) — DOM копии разошёлся бы с сервером.
// Обычные поля не трогаем: ввод с экранной клавиатуры телефона идёт через их локальное изменение (createFillWatcher).
/** @param {Event} e */
const keepEditorsReadOnly = (e) => /** @type {HTMLElement} */ (e.target)?.isContentEditable && e.preventDefault();

/** @param {Handlers} handlers @param {(e: Event) => void} input @returns {Handlers} */
const copyHandlers = (handlers, input) => ({ ...handlers, input, beforeinput: keepEditorsReadOnly, drop: keepEditorsReadOnly });

// rrweb пересобирает документ через document.open(), который стирает обработчики окна iframe
/** @param {() => any} getReplayer @param {Handlers} handlers */
const createIframeHook = (getReplayer, handlers) => () => {
  const win = getReplayer()?.iframe?.contentWindow;
  for (const [type, fn] of Object.entries(win ? handlers : {})) win.addEventListener(type, fn, true);
};

/**
 * @param {{ root: HTMLElement, handlers: Handlers, onFill: (id: number, value: string) => void, onBlur: () => void,
 *   send: (msg: import("../../shared/protocol.js").ClientMessage) => void }} deps
 */
export function createPlayer({ root, handlers, onFill, onBlur, send }) {
  let replayer = null;
  const scrolling = createScrolling(() => replayer, send);
  const mirror = () => replayer.getMirror();
  const hookIframe = createIframeHook(() => replayer, copyHandlers(handlers, createFillWatcher(mirror, onFill)));
  const focus = createFocusMirror(() => replayer, hookIframe, onBlur);
  const syncValues = createValueSync(mirror, focus.apply);

  return {
    reset() {
      root.innerHTML = "";
      replayer = new rrweb.Replayer([], { root, ...REPLAYER_OPTIONS });
      scrolling.attach(replayer);
      replayer.on("fullsnapshot-rebuilded", hookIframe);
      replayer.on("event-cast", syncValues);
      replayer.startLive(Date.now());
    },
    // время событий — по часам сервера; ставим свои, чтобы live-режим проигрывал сразу
    addEvent: (event) => replayer.addEvent({ ...event, timestamp: Date.now() }),
    setFocus: focus.set,
    predictFocus: focus.predict,
    focusedPoint: () => focusedPoint(replayer.iframe),
    scrollLocally: scrolling.handle,
    flushScroll: scrolling.flush,
  };
}

// Редактор (contenteditable): фокус и выделение по нумерации rrweb — тогда браузер рисует каретку там же, где на сервере.
/** @param {Document} doc @param {any} mirror @param {NonNullable<FocusState["editable"]>} sel */
function selectRange(doc, mirror, sel) {
  const anchor = mirror.getNode(sel.anchorId);
  const head = mirror.getNode(sel.focusId);
  try {
    if (anchor && head) doc.getSelection().setBaseAndExtent(anchor, sel.anchorOffset, head, sel.focusOffset);
  } catch { /* узел есть, но смещение в копии вне его — оставляем как есть */ }
}

/** @param {any} mirror @param {HTMLElement} el @param {FocusState} focus */
function focusEditable(mirror, el, focus) {
  if (el.ownerDocument.activeElement !== el) el.focus({ preventScroll: true });
  if (focus.editable) selectRange(el.ownerDocument, mirror, focus.editable);
}

/** @param {any} el @returns {"field" | "editable" | null} */
const focusKind = (el) => (isTextField(el) ? "field" : el?.isContentEditable ? "editable" : null);

/** @param {any} replayer @param {FocusState} focus @returns {boolean} фокус поставлен */
function placeCaret(replayer, focus) {
  const mirror = replayer.getMirror();
  const el = focus.id ? mirror.getNode(focus.id) : null;
  const kind = focusKind(el);
  if (kind === "field") focusField(el, focus);
  if (kind === "editable") focusEditable(mirror, el, focus);
  return kind !== null;
}

// Поле или редактор в фокусе на сервере фокусируем и в копии, вместе с кареткой. По клику в поле копия ставит
// каретку сразу, не дожидаясь сервера; его ответ потом уточняет её или снимает.
/** @param {() => any} getReplayer @param {() => void} hookIframe @param {() => void} onBlur */
function createFocusMirror(getReplayer, hookIframe, onBlur) {
  /** @type {FocusState} */
  let focus = { id: null };
  let holdUntil = 0;
  const doc = () => getReplayer()?.iframe?.contentDocument;
  const apply = () => {
    if (!doc()) return;
    hookIframe();
    if (Date.now() >= holdUntil && !placeCaret(getReplayer(), focus)) blurCopy(doc(), onBlur);
  };
  return {
    apply,
    /** @param {FocusState} next */
    set(next) {
      focus = next;
      holdUntil = 0;
      setTimeout(apply, FOCUS_DELAY_MS);
    },
    /** @param {number} x @param {number} y — координаты в копии */
    predict(x, y) {
      if (!doc() || !predictCaret(doc(), x, y)) return;
      holdUntil = Date.now() + PREDICTION_HOLD_MS;
      setTimeout(apply, PREDICTION_HOLD_MS);
    },
  };
}

/** @param {Document} doc @param {() => void} onBlur */
function blurCopy(doc, onBlur) {
  /** @type {any} */ (doc.activeElement)?.blur?.();
  onBlur();
}

// Значение часто отражается в атрибут value, но у уже изменённого поля атрибут не управляет отображением.
/** @param {() => any} mirror @param {() => void} afterChange */
function createValueSync(mirror, afterChange) {
  const apply = (change) => {
    const el = mirror().getNode(change.id);
    const value = change.attributes.value == null ? "" : String(change.attributes.value);
    if (!isFormField(el) || el.value === value) return false;
    el.value = value;
    return true;
  };
  return (event) => {
    if (attributeChanges(event).map(apply).some(Boolean)) afterChange();
  };
}

// Изменение без клавиш (автозаполнение, IME, экранная клавиатура) сделал пользователь: rrweb ставит value без события.
/** @param {() => any} mirror @param {(id: number, value: string) => void} onFill */
function createFillWatcher(mirror, onFill) {
  const timers = new Map();
  return (/** @type {Event} */ e) => {
    const el = /** @type {HTMLInputElement} */ (e.target);
    const id = isTextField(el) ? mirror().getId(el) : 0;
    if (!(id > 0)) return;
    clearTimeout(timers.get(id));
    timers.set(id, setTimeout(() => onFill(id, el.value), FILL_DEBOUNCE_MS));
  };
}
