// @ts-check
import { WebSocketServer } from "ws";
import { parseClientMessage } from "../../shared/protocol.js";

/** @typedef {import("../../shared/protocol.js").ClientMessage} ClientMessage */

const QUIET_TYPES = new Set(["move", "wheel", "keydown", "keyup"]);

/** @param {string} raw @param {(msg: ClientMessage) => void} onMessage */
function receive(raw, onMessage) {
  const msg = parseClientMessage(raw);
  if (!msg) return;
  if (!QUIET_TYPES.has(msg.type)) console.log("input", JSON.stringify(msg).slice(0, 200));
  onMessage(msg);
}

/**
 * @param {{
 *   server: import("node:http").Server,
 *   hub: import("../mirror/hub.js").Hub,
 *   onMessage: (msg: ClientMessage) => void,
 * }} deps
 */
export function attachWebSocket({ server, hub, onMessage }) {
  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (ws) => {
    hub.join(ws);
    ws.on("message", (raw) => receive(String(raw), onMessage));
    ws.on("close", () => hub.leave(ws));
  });
}
