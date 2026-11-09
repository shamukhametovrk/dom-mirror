// @ts-check

/** @typedef {import("../../shared/protocol.js").ClientMessage} ClientMessage */
/** @typedef {import("../../shared/protocol.js").ServerMessage} ServerMessage */

const RECONNECT_MS = 1000;

/** @param {{ onOpen: () => void, onClose: () => void, onMessage: (msg: ServerMessage) => void }} handlers */
export function createConnection({ onOpen, onClose, onMessage }) {
  /** @type {WebSocket | null} */
  let ws = null;
  const connect = () => {
    ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
    ws.onopen = onOpen;
    ws.onclose = () => {
      onClose();
      setTimeout(connect, RECONNECT_MS);
    };
    ws.onmessage = (event) => onMessage(JSON.parse(event.data));
  };
  connect();
  return {
    /** @param {ClientMessage} msg */
    send: (msg) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg)),
  };
}
