// Минимальный клиент Chrome DevTools Protocol поверх одного WebSocket к браузеру.
// Вместо Playwright: он сам включает Runtime.enable и держит свои скрипты и миры во вкладке.
// Здесь вкладке отправляется только то, что мы просим явно.
import WebSocket from "ws";

export async function connectCdp(httpUrl) {
  const { webSocketDebuggerUrl } = await (await fetch(httpUrl + "/json/version")).json();
  const ws = new WebSocket(webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });

  let nextId = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.on("message", (raw) => {
    const m = JSON.parse(raw);
    if (m.id) {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.error) p.rej(new Error(`${p.method}: ${m.error.message}`)); else p.res(m.result);
    } else {
      for (const fn of listeners.get(m.method) || []) fn(m.params, m.sessionId);
    }
  });
  // Chrome закрылся или упал — выходим, контейнер перезапустится вместе с браузером
  ws.on("close", () => { console.error("chrome disconnected"); process.exit(1); });

  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const id = ++nextId;
    pending.set(id, { res, rej, method });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const on = (method, fn) => {
    if (!listeners.has(method)) listeners.set(method, []);
    listeners.get(method).push(fn);
  };
  return { send, on };
}
