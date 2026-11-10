// @ts-check

/** @typedef {{ x: number, y: number, mod?: number }} Point */
/** @typedef {"left" | "middle" | "right"} MouseButton */
/** @typedef {Point & { type: "move" }} MoveMessage */
/** @typedef {Point & { type: "down" | "up", button: MouseButton, count: number }} ButtonMessage */
/** @typedef {Point & { type: "wheel", dx: number, dy: number, raw?: boolean }} WheelMessage raw — шаг уже разложен копией */
/**
 * @typedef {{ type: "keydown" | "keyup", key: string, code: string, keyCode: number, loc: number, repeat: boolean,
 *   ctrl: boolean, alt: boolean, meta: boolean, shift: boolean, altgr: boolean }} KeyMessage
 */
/** @typedef {{ type: "text", text: string }} TextMessage */
/** @typedef {{ type: "fill", id: number, value: string }} FillMessage */
/** @typedef {{ type: "scrollTo", id: number, x: number, y: number }} ScrollToMessage */
/** @typedef {Point & { type: "drop", files: string[] }} DropMessage files — id загрузок; сервер заменяет их путями */
/** @typedef {MoveMessage | ButtonMessage | WheelMessage | KeyMessage | TextMessage | FillMessage | ScrollToMessage | DropMessage} InputMessage */
/** @typedef {{ type: "viewport", w: number, h: number, dark?: boolean }} ViewportMessage dark — тема браузера клиента */
/** @typedef {{ type: "goto", url: string }} GotoMessage */
/** @typedef {{ type: "back" | "reload" }} HistoryMessage */
/** @typedef {{ type: "tabSwitch" | "tabClose", id: string }} TabMessage */
/** @typedef {{ type: "attach", chooser: string, files: string[] }} AttachMessage файлы для окна выбора, открытого сайтом */
/** @typedef {ViewportMessage | GotoMessage | HistoryMessage | TabMessage | AttachMessage} ImmediateMessage */
/** @typedef {InputMessage | ImmediateMessage} ClientMessage */

/** @typedef {{ anchorId: number, anchorOffset: number, focusId: number, focusOffset: number }} EditableSelection */
/** @typedef {{ id: number | null, start?: number | null, end?: number | null, editable?: EditableSelection | null }} FocusState editable — каретка в contenteditable */
/** @typedef {{ id: string, title: string, url: string, active: boolean, pinned: boolean }} TabInfo pinned — сайт из списка */
/** @typedef {{ id: string, multiple: boolean, accept: string }} FileChooser */
/** @typedef {{ id: string, name: string, state: "started" | "done" | "failed" }} DownloadInfo */
/**
 * @typedef {{ type: "url", url: string } | { type: "events", events: object[] } | ({ type: "focus" } & FocusState)
 *   | { type: "cursor", cursor: string } | ({ type: "fileChooser" } & FileChooser)
 *   | { type: "tabs", tabs: TabInfo[] } | { type: "replaced" } | ({ type: "download" } & DownloadInfo)
 *   | { type: "clipboard", text?: string, image?: string }} ServerMessage
 */

export const EventType = Object.freeze({ FullSnapshot: 2, IncrementalSnapshot: 3, Meta: 4 });
export const IncrementalSource = Object.freeze({ Mutation: 0, StyleSheetRule: 8 });
export const NodeType = Object.freeze({ Element: 2, Text: 3 });
export const MAX_FILES = 20;

/** @typedef {(value: unknown) => boolean} Check */

/** @type {Check} */
const num = (v) => typeof v === "number" && Number.isFinite(v);
/** @type {Check} */
const str = (v) => typeof v === "string";
/** @type {Check} */
const bool = (v) => typeof v === "boolean";
/** @type {(check: Check) => Check} */
const optional = (check) => (v) => v === undefined || check(v);
/** @type {Check} */
const button = (v) => v === "left" || v === "middle" || v === "right";
/** @type {Check} */
const fileIds = (v) => Array.isArray(v) && v.length <= MAX_FILES && v.every(str);

const POINT = { x: num, y: num, mod: optional(num) };
const KEY = {
  key: str, code: str, keyCode: num, loc: num, repeat: bool,
  ctrl: bool, alt: bool, meta: bool, shift: bool, altgr: bool,
};

/** @type {Record<ClientMessage["type"], Record<string, Check>>} */
const SCHEMAS = {
  move: POINT,
  down: { ...POINT, button, count: num },
  up: { ...POINT, button, count: num },
  wheel: { ...POINT, dx: num, dy: num, raw: optional(bool) },
  keydown: KEY,
  keyup: KEY,
  text: { text: str },
  fill: { id: num, value: str },
  scrollTo: { id: num, x: num, y: num },
  drop: { ...POINT, files: fileIds },
  viewport: { w: num, h: num, dark: optional(bool) },
  goto: { url: str },
  back: {},
  reload: {},
  tabSwitch: { id: str },
  tabClose: { id: str },
  attach: { chooser: str, files: fileIds },
};

/** @param {any} msg @param {Record<string, Check>} schema */
const matches = (msg, schema) => Object.entries(schema).every(([field, check]) => check(msg[field]));

/** @param {string} raw */
function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** @param {any} msg */
const schemaFor = (msg) => (Object.hasOwn(SCHEMAS, msg?.type) ? SCHEMAS[msg.type] : null);

/** @param {string} raw @returns {ClientMessage | null} */
export function parseClientMessage(raw) {
  const msg = parseJson(raw);
  const schema = schemaFor(msg);
  return schema && matches(msg, schema) ? msg : null;
}

const IMMEDIATE_TYPES = new Set(["viewport", "goto", "back", "reload", "tabSwitch", "tabClose", "attach"]);

/** Выполняется сразу, а не в очереди ввода. @param {ClientMessage} msg @returns {msg is ImmediateMessage} */
export const isImmediate = (msg) => IMMEDIATE_TYPES.has(msg.type);
