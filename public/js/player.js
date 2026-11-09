// @ts-check
// Воспроизведение копии. Ввод всегда уходит на сервер, а текст в полях приходит обратно от rrweb.
import { EventType, IncrementalSource } from "../../shared/protocol.js";
import { smoothScrolling } from "./scroll-smoother.js";

/** @typedef {import("../../shared/protocol.js").FocusState} FocusState */
/** @typedef {Record<string, (e: Event) => void>} Handlers */

const REPLAYER_OPTIONS = { liveMode: true, mouseTail: false, triggerFocus: false, showWarning: false };
const FOCUS_DELAY_MS = 30;
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

/** @param {{ root: HTMLElement, handlers: Handlers, onFill: (id: number, value: string) => void, onBlur: () => void }} deps */
export function createPlayer({ root, handlers, onFill, onBlur }) {
  let replayer = null;
  const mirror = () => replayer.getMirror();
  const iframeHandlers = { ...handlers, input: createFillWatcher(mirror, onFill) };

  // rrweb пересобирает документ через document.open(), который стирает обработчики окна iframe
  const hookIframe = () => {
    const win = replayer?.iframe?.contentWindow;
    for (const [type, fn] of Object.entries(win ? iframeHandlers : {})) win.addEventListener(type, fn, true);
  };
  const focus = createFocusMirror(() => replayer, hookIframe, onBlur);
  const syncValues = createValueSync(mirror, focus.apply);

  return {
    reset() {
      root.innerHTML = "";
      replayer = new rrweb.Replayer([], { root, ...REPLAYER_OPTIONS });
      smoothScrolling(replayer);
      replayer.on("fullsnapshot-rebuilded", hookIframe);
      replayer.on("event-cast", syncValues);
      replayer.startLive(Date.now());
    },
    // время событий — по часам сервера; ставим свои, чтобы live-режим проигрывал сразу
    addEvent: (event) => replayer.addEvent({ ...event, timestamp: Date.now() }),
    setFocus: focus.set,
  };
}

/** @param {any} replayer @param {number | null} id */
function textFieldById(replayer, id) {
  const el = id ? replayer.getMirror().getNode(id) : null;
  return isTextField(el) ? el : null;
}

// Поле в фокусе на сервере фокусируем и в копии, вместе с кареткой.
/** @param {() => any} getReplayer @param {() => void} hookIframe @param {() => void} onBlur */
function createFocusMirror(getReplayer, hookIframe, onBlur) {
  /** @type {FocusState} */
  let focus = { id: null };
  const apply = () => {
    const doc = getReplayer()?.iframe?.contentDocument;
    if (!doc) return;
    hookIframe();
    const el = textFieldById(getReplayer(), focus.id);
    if (el) focusField(el, focus);
    else blurCopy(doc, onBlur);
  };
  return {
    apply,
    /** @param {FocusState} next */
    set(next) {
      focus = next;
      setTimeout(apply, FOCUS_DELAY_MS);
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
