// @ts-check
// Состояние копии и рассылка клиентам. Новому клиенту хватает событий с последнего Meta.
import { EventType } from "../../shared/protocol.js";
/** @typedef {import("../resources/rewrite.js").Rewriter} Rewriter */

/** @typedef {import("../../shared/protocol.js").ServerMessage} ServerMessage */
/** @typedef {import("../../shared/protocol.js").FocusState} FocusState */
/** @typedef {import("../../shared/protocol.js").TabInfo} TabInfo */
/** @typedef {import("../browser/frame-capture.js").FrameCapture} FrameCapture */
/** @typedef {{ readyState: number, send: (data: string) => void, close: (code?: number) => void }} Client */
/** @typedef {{ base: string, history: object[], focus: FocusState }} MirrorState */

const OPEN = 1;
const MAX_CURSOR_LENGTH = 500;
export const REPLACED_CLOSE_CODE = 4001;

/** @param {Client} client */
function evict(client) {
  if (client.readyState === OPEN) client.send(JSON.stringify({ type: "replaced" }));
  client.close(REPLACED_CLOSE_CODE);
}

// Одна сессия за раз: новое подключение вытесняет прежнее (оно увидит «открыто на другом устройстве»).
function createClientSet() {
  /** @type {Set<Client>} */
  const clients = new Set();
  return {
    /** @param {Client} client */
    add(client) {
      for (const old of clients) evict(old);
      clients.clear();
      clients.add(client);
    },
    remove: (/** @type {Client} */ client) => clients.delete(client),
    get size() { return clients.size; },
    /** @param {ServerMessage} msg */
    broadcast(msg) {
      const data = JSON.stringify(msg);
      for (const client of clients) if (client.readyState === OPEN) client.send(data);
    },
  };
}

/** @param {MirrorState} state @param {{ url: string, tabs: TabInfo[] }} now @param {FrameCapture} frames @returns {ServerMessage[]} */
const initialMessages = (state, { url, tabs }, frames) => [
  { type: "tabs", tabs },
  { type: "url", url },
  { type: "events", events: state.history },
  { type: "focus", ...state.focus },
  { type: "frames", frames: frames.snapshot() },
];

/** @param {{ startUrl: string, currentUrl: () => string, tabs: () => TabInfo[], frames: FrameCapture, rewriter: Rewriter }} deps */
export function createHub({ startUrl, currentUrl, tabs, frames, rewriter }) {
  const clients = createClientSet();
  /** @type {MirrorState} */
  const state = { base: startUrl, history: [], focus: { id: null } };
  const startPage = (href) => {
    Object.assign(state, { base: href || state.base, history: [], focus: { id: null } });
    frames.clearRects();
  };
  return {
    broadcast: clients.broadcast,
    leave: clients.remove,
    get base() { return state.base; },
    get size() { return clients.size; },
    /** @param {{ type: number, data: any }} event */
    recordEvent(event) {
      if (event.type === EventType.Meta) startPage(event.data.href);
      state.history.push(rewriter.event(event, state.base));
      clients.broadcast({ type: "events", events: [event] });
    },
    /** @param {FocusState} focus */
    setFocus: (focus) => clients.broadcast({ type: "focus", ...(state.focus = focus) }),
    /** @param {string} cursor */
    setCursor: (cursor) => clients.broadcast({ type: "cursor", cursor: rewriter.css(cursor.slice(0, MAX_CURSOR_LENGTH), state.base) }),
    /** @param {Client} client */
    join(client) {
      clients.add(client);
      for (const msg of initialMessages(state, { url: currentUrl(), tabs: tabs() }, frames)) client.send(JSON.stringify(msg));
    },
  };
}

/** @typedef {ReturnType<typeof createHub>} Hub */

/** @param {{ hub: Hub, frames: FrameCapture }} deps */
export const createAgentHandlers = ({ hub, frames }) => ({
  emit: (/** @type {string} */ raw) => hub.recordEvent(JSON.parse(raw)),
  focus: (/** @type {string} */ raw) => hub.setFocus(JSON.parse(raw)),
  cursor: (/** @type {string} */ cursor) => hub.setCursor(String(cursor)),
  frames: (/** @type {string} */ raw) => frames.setRects(JSON.parse(raw)),
});
