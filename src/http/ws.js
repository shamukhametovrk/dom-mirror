// @ts-check
import { WebSocketServer } from "ws";
import { parseClientMessage } from "../../shared/protocol.js";

/** @typedef {import("../../shared/protocol.js").ClientMessage} ClientMessage */
/** @typedef {import("node:http").IncomingMessage} Request */

// Без трафика прокси (nginx и др.) рвут WebSocket через ~60 с, а копия при переподключении пересобирается.
const PING_INTERVAL_MS = 25_000;

/** @param {Request} req @param {boolean} trustProxy */
const hostOf = (req, trustProxy) => String((trustProxy && req.headers["x-forwarded-host"]) || req.headers.host || "");

// Защита от подключения со сторонних сайтов: Origin должен совпадать с адресом самого сервиса.
/** @param {Request} req @param {boolean} trustProxy */
export function isSameOrigin(req, trustProxy) {
  try {
    return new URL(req.headers.origin ?? "").host === hostOf(req, trustProxy);
  } catch {
    return false;
  }
}

/** @param {import("ws").WebSocketServer} wss */
function keepAlive(wss) {
  const alive = new WeakSet();
  wss.on("connection", (ws) => {
    alive.add(ws);
    ws.on("pong", () => alive.add(ws));
  });
  setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.delete(ws)) ws.terminate();
      else ws.ping();
    }
  }, PING_INTERVAL_MS).unref();
}

/**
 * @param {{
 *   server: import("node:http").Server,
 *   hub: import("../mirror/hub.js").Hub,
 *   onMessage: (msg: ClientMessage) => void,
 *   isAllowed: (req: Request) => boolean,
 *   debug: boolean,
 * }} deps
 */
export function attachWebSocket({ server, hub, onMessage, isAllowed, debug }) {
  const verifyClient = ({ req }, done) => done(isAllowed(req), 401);
  const wss = new WebSocketServer({ server, path: "/ws", verifyClient });
  keepAlive(wss);
  wss.on("connection", (ws) => {
    hub.join(ws);
    ws.on("message", (raw) => {
      const msg = parseClientMessage(String(raw));
      if (debug && msg) console.log("input", msg.type);
      if (msg) onMessage(msg);
    });
    ws.on("close", () => hub.leave(ws));
  });
}
