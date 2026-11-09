// @ts-check

/** @typedef {import("../../shared/protocol.js").ClientMessage} ClientMessage */
/** @typedef {import("../../shared/protocol.js").ServerMessage} ServerMessage */

const RECONNECT_MS = 1000;
const REPLACED_CLOSE_CODE = 4001;   // сервер: «открыто на другом устройстве»

// Вытесненный клиент сам не переподключается — иначе два открытых устройства выбивали бы друг друга по кругу.
/**
 * @param {{ onOpen: () => void, onClose: () => void, onReplaced: () => void, onMessage: (msg: ServerMessage) => void }} handlers
 */
export function createConnection({ onOpen, onClose, onReplaced, onMessage }) {
  /** @type {WebSocket | null} */
  let ws = null;
  const connect = () => {
    ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
    ws.onopen = onOpen;
    ws.onclose = (event) => {
      if (event.code === REPLACED_CLOSE_CODE) return onReplaced();
      onClose();
      setTimeout(connect, RECONNECT_MS);
    };
    ws.onmessage = (event) => onMessage(JSON.parse(event.data));
  };
  connect();
  return {
    connect,
    /** @param {ClientMessage} msg */
    send: (msg) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg)),
  };
}
