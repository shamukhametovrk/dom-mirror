// @ts-check
// Состояние копии и рассылка клиентам. Новому клиенту хватает событий с последнего Meta.
import { EventType } from "../../shared/protocol.js";
import { rewriteCss, rewriteEvent } from "../resources/rewrite.js";

/** @typedef {import("../../shared/protocol.js").ServerMessage} ServerMessage */
/** @typedef {import("../../shared/protocol.js").FocusState} FocusState */
/** @typedef {import("../browser/frame-capture.js").FrameCapture} FrameCapture */
/** @typedef {{ readyState: number, send: (data: string) => void }} Client */
/** @typedef {{ base: string, history: object[], focus: FocusState }} MirrorState */

const OPEN = 1;
const MAX_CURSOR_LENGTH = 500;

function createClientSet() {
  /** @type {Set<Client>} */
  const clients = new Set();
  return {
    add: (/** @type {Client} */ client) => clients.add(client),
    remove: (/** @type {Client} */ client) => clients.delete(client),
    get size() { return clients.size; },
    /** @param {ServerMessage} msg */
    broadcast(msg) {
      const data = JSON.stringify(msg);
      for (const client of clients) if (client.readyState === OPEN) client.send(data);
    },
  };
}

/** @param {MirrorState} state @param {string} url @param {FrameCapture} frames @returns {ServerMessage[]} */
const initialMessages = (state, url, frames) => [
  { type: "url", url },
  { type: "events", events: state.history },
  { type: "focus", ...state.focus },
  { type: "frames", frames: frames.snapshot() },
];

/** @param {{ startUrl: string, currentUrl: () => string, frames: FrameCapture }} deps */
export function createHub({ startUrl, currentUrl, frames }) {
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
      state.history.push(rewriteEvent(event, state.base));
      clients.broadcast({ type: "events", events: [event] });
    },
    /** @param {FocusState} focus */
    setFocus: (focus) => clients.broadcast({ type: "focus", ...(state.focus = focus) }),
    /** @param {string} cursor */
    setCursor: (cursor) => clients.broadcast({ type: "cursor", cursor: rewriteCss(cursor.slice(0, MAX_CURSOR_LENGTH), state.base) }),
    /** @param {Client} client */
    join(client) {
      clients.add(client);
      for (const msg of initialMessages(state, currentUrl(), frames)) client.send(JSON.stringify(msg));
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
