// @ts-check
// Нажатие и отпускание уходят раздельно, с настоящими code/keyCode: длительность нажатия задаёт пользователь.

/** @typedef {import("../../shared/protocol.js").ClientMessage} ClientMessage */

/** @param {"keydown" | "keyup"} type @param {KeyboardEvent} e @returns {ClientMessage} */
const keyMessage = (type, e) => ({
  type, key: e.key, code: e.code, keyCode: e.keyCode, loc: e.location, repeat: e.repeat,
  ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey, shift: e.shiftKey,
  altgr: Boolean(e.getModifierState?.("AltGraph")),
});

/** @param {KeyboardEvent} e */
const isPasteShortcut = (e) => (e.ctrlKey || e.metaKey) && e.code === "KeyV";

/** @param {(msg: ClientMessage) => void} send */
export function createKeyboard(send) {
  // Ctrl+V не отправляем: текст вставки придёт из события paste. Его keyup тоже пропускаем.
  const skipped = new Set();
  const forward = (type, e) => {
    e.preventDefault();
    e.stopPropagation();
    send(keyMessage(type, e));
  };
  return {
    keydown: (/** @type {KeyboardEvent} */ e) => {
      if (e.isComposing) return;
      if (isPasteShortcut(e)) skipped.add(e.code);
      else forward("keydown", e);
    },
    keyup: (/** @type {KeyboardEvent} */ e) => {
      if (e.isComposing || skipped.delete(e.code)) return;
      forward("keyup", e);
    },
    paste: (/** @type {ClipboardEvent} */ e) => {
      e.preventDefault();
      const text = e.clipboardData.getData("text");
      if (text) send({ type: "text", text });
    },
  };
}
