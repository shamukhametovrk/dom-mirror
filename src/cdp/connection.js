// @ts-check
// Свой минимальный клиент вместо Playwright: вкладке уходят только те команды, которые мы просим явно.
import WebSocket from "ws";

/** @typedef {(params: any, sessionId?: string) => void} Listener */
/**
 * @typedef {{
 *   send: (method: string, params?: object, sessionId?: string) => Promise<any>,
 *   on: (method: string, fn: Listener) => void,
 *   onClose: (fn: () => void) => void,
 * }} CdpConnection
 */
/** @typedef {{ resolve: (v: any) => void, reject: (e: Error) => void, method: string }} PendingCall */

/** @param {string} httpUrl @returns {Promise<CdpConnection>} */
export async function connectCdp(httpUrl) {
  const { webSocketDebuggerUrl } = await (await fetch(`${httpUrl}/json/version`)).json();
  const ws = new WebSocket(webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  return createConnection(ws);
}

/** @param {Pick<WebSocket, "on">} ws @param {Map<number, PendingCall>} pending @param {Map<string, Listener[]>} listeners */
function routeMessages(ws, pending, listeners) {
  const settle = (msg) => {
    const call = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) call?.reject(new Error(`${call.method}: ${msg.error.message}`));
    else call?.resolve(msg.result);
  };
  const dispatch = (msg) => {
    for (const fn of listeners.get(msg.method) ?? []) fn(msg.params, msg.sessionId);
  };
  ws.on("message", (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.id) settle(msg);
    else dispatch(msg);
  });
}

/** @param {Pick<WebSocket, "on" | "send">} ws @returns {CdpConnection} */
export function createConnection(ws) {
  let nextId = 0;
  /** @type {Map<number, PendingCall>} */
  const pending = new Map();
  /** @type {Map<string, Listener[]>} */
  const listeners = new Map();

  routeMessages(ws, pending, listeners);
  return {
    send: (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject, method });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    }),
    on: (method, fn) => listeners.set(method, [...(listeners.get(method) ?? []), fn]),
    onClose: (fn) => ws.on("close", fn),
  };
}
