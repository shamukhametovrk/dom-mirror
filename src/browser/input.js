// @ts-check
// Преобразование сообщений клиента в параметры Input.* CDP. Без побочных эффектов.

/** @typedef {import("../../shared/protocol.js").KeyMessage} KeyMessage */
/** @typedef {import("../../shared/protocol.js").MouseButton} MouseButton */
/**
 * @typedef {{ type: string, key: string, code: string, modifiers: number, windowsVirtualKeyCode: number,
 *   nativeVirtualKeyCode: number, location: number, text?: string, unmodifiedText?: string, autoRepeat?: boolean }} KeyEventParams
 */

const MODIFIER_BITS = /** @type {const} */ ([["alt", 1], ["ctrl", 2], ["meta", 4], ["shift", 8]]);
const BUTTON_BITS = { left: 1, right: 2, middle: 4 };
const SKIP_KEYS = new Set(["Dead", "Unidentified", "Process"]);

/** @param {Partial<KeyMessage>} msg */
export const keyModifiers = (msg) => MODIFIER_BITS.reduce((acc, [name, bit]) => acc | (msg[name] ? bit : 0), 0);

/** @param {{ mod?: number }} msg */
export const mouseModifiers = (msg) => (Number(msg.mod) | 0) & 15;

/** @param {MouseButton} button */
export const buttonBit = (button) => BUTTON_BITS[button] ?? 1;

/** @param {number} buttons @returns {MouseButton | "none"} */
export function heldButton(buttons) {
  if (buttons & 1) return "left";
  if (buttons & 4) return "middle";
  return buttons & 2 ? "right" : "none";
}

// Горячие клавиши на нелатинской раскладке: странице нужна латинская буква (Ctrl+С → c).
/** @param {KeyMessage} msg */
function shortcutKey(msg) {
  const letter = /^Key([A-Z])$/.exec(msg.code)?.[1];
  if (!letter) return msg.key;
  return msg.shift ? letter : letter.toLowerCase();
}

/** @param {KeyMessage} msg */
const resolveKey = (msg) => ((msg.ctrl || msg.meta) && !msg.altgr ? shortcutKey(msg) : msg.key);

/** @param {KeyMessage} msg @param {string} key */
function typedText(msg, key) {
  if (key === "Enter") return "\r";
  return isPrintable(msg, key) && (!msg.ctrl || msg.altgr) ? key : "";
}

/** @param {KeyMessage} msg @param {string} key */
const isPrintable = (msg, key) => key.length === 1 && !msg.meta;

/** @param {KeyMessage} msg @param {KeyEventParams} params @returns {KeyEventParams} */
function withTypedText(msg, params) {
  const text = typedText(msg, params.key);
  const base = msg.repeat ? { ...params, autoRepeat: true } : params;
  return text ? { ...base, text, unmodifiedText: text } : { ...base, type: "rawKeyDown" };
}

/** @param {KeyMessage} msg @param {"keyDown" | "keyUp"} type @returns {KeyEventParams | null} */
export function keyEventParams(msg, type) {
  if (SKIP_KEYS.has(msg.key)) return null;
  const vk = msg.keyCode | 0;
  const params = {
    type, key: resolveKey(msg), code: msg.code, modifiers: keyModifiers(msg),
    windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, location: msg.loc | 0,
  };
  return type === "keyDown" ? withTypedText(msg, params) : params;
}

/** @param {string} url */
export const normalizeUrl = (url) => (/^https?:\/\//.test(url) ? url : `https://${url}`);
