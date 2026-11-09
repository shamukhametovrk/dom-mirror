// Запускается внутри контейнера (docker exec ... node /tmp/probe.mjs <режим>): смотрит на серверную страницу
// напрямую через CDP. Только для стенда — в продукт не входит.
//   scroll        — текущая позиция прокрутки страницы
//   watch-clicks  — запоминать, по какому элементу и при какой прокрутке пришёлся каждый mousedown
//   clicks        — отдать запомненное
const mode = process.argv[2];
const targets = await (await fetch("http://127.0.0.1:9222/json")).json();
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id) pending.get(d.id)?.(d); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.result.value;

const MODES = {
  scroll: () => ev("({ x: scrollX, y: scrollY })"),
  "watch-clicks": () => ev(`window.__clicks = []; if (!window.__clicksOn) { window.__clicksOn = 1;
    addEventListener('mousedown', (e) => __clicks.push({ text: (e.target.textContent || '').trim().slice(0, 60), y: scrollY }), true); } 0`),
  clicks: () => ev("window.__clicks"),
  "clear-cache": () => send("Network.clearBrowserCache").then(() => "ok"),
};
console.log(JSON.stringify(await MODES[mode]()));
process.exit(0);
