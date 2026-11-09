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
/** @typedef {MoveMessage | ButtonMessage | WheelMessage | KeyMessage | TextMessage | FillMessage | ScrollToMessage} InputMessage */
/** @typedef {{ type: "viewport", w: number, h: number }} ViewportMessage */
/** @typedef {{ type: "goto", url: string }} GotoMessage */
/** @typedef {{ type: "back" | "forward" | "reload" }} HistoryMessage */
/** @typedef {{ type: "tabNew" } | { type: "tabSwitch" | "tabClose", id: string }} TabMessage */
/** @typedef {ViewportMessage | GotoMessage | HistoryMessage | TabMessage} NavigationMessage */
/** @typedef {InputMessage | NavigationMessage} ClientMessage */

/** @typedef {{ id: number | null, start?: number | null, end?: number | null }} FocusState */
/** @typedef {{ id: number, x: number, y: number, w: number, h: number }} FrameRect */
/** @typedef {FrameRect & { img?: string }} FrameUpdate */
/** @typedef {{ id: string, title: string, url: string, active: boolean }} TabInfo */
/**
 * @typedef {{ type: "url", url: string } | { type: "events", events: object[] } | ({ type: "focus" } & FocusState)
 *   | { type: "cursor", cursor: string } | { type: "frames", frames: FrameUpdate[] }
 *   | { type: "tabs", tabs: TabInfo[] } | { type: "replaced" }} ServerMessage
 */

export const EventType = Object.freeze({ FullSnapshot: 2, IncrementalSnapshot: 3, Meta: 4 });
export const IncrementalSource = Object.freeze({ Mutation: 0, StyleSheetRule: 8 });
export const NodeType = Object.freeze({ Element: 2, Text: 3 });

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
  viewport: { w: num, h: num },
  goto: { url: str },
  back: {},
  forward: {},
  reload: {},
  tabNew: {},
  tabSwitch: { id: str },
  tabClose: { id: str },
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

const NAVIGATION_TYPES = new Set(["viewport", "goto", "back", "forward", "reload", "tabNew", "tabSwitch", "tabClose"]);

/** @param {ClientMessage} msg @returns {msg is NavigationMessage} */
export const isNavigation = (msg) => NAVIGATION_TYPES.has(msg.type);
