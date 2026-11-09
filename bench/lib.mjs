// Общие помощники стенда: CDP-подключение к клиентскому Chrome, ожидание, статистика, вход.

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Подключение к первой вкладке Chrome с открытым портом отладки. */
export async function connectPage(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id) pending.get(d.id)?.(d);
    else for (const fn of listeners.get(d.method) ?? []) fn(d.params);
  };
  const send = (method, params = {}) => new Promise((r) => {
    const i = ++id;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const on = (method, fn) => listeners.set(method, [...(listeners.get(method) ?? []), fn]);
  const ev = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
  return { send, on, ev };
}

export async function waitFor(fn, ms = 30000, step = 100) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v || Date.now() > end) return v;
    await sleep(step);
  }
}

export function stats(xs) {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, median: q(0.5), p90: q(0.9), min: s[0], max: s.at(-1) };
}

export const fmt = (st, unit = "мс") => `median ${st.median?.toFixed(0)}${unit}, p90 ${st.p90?.toFixed(0)}${unit} (n=${st.n})`;

/** Вход через форму; возвращает cookie сессии для запросов из Node. */
export async function login(page, mirror, password) {
  await page.send("Page.navigate", { url: `${mirror}/login` });
  await waitFor(() => page.ev("!!document.querySelector('input[name=password]')"));
  await page.ev(`document.querySelector('input[name=password]').value = ${JSON.stringify(password)}; document.querySelector('form').submit(); 0`);
  await waitFor(() => page.ev("document.getElementById('status')?.textContent === 'онлайн'"));
  const { cookies } = await page.send("Network.getCookies", { urls: [mirror] }).then((r) => r.result);
  const session = cookies.find((c) => c.name === "dm_session");
  return session ? `dm_session=${session.value}` : "";
}

/** Отправка команды серверу через WebSocket с cookie (как это делает клиент). */
export async function command(mirror, cookie, msg) {
  const { default: WebSocket } = await import("ws");
  const url = new URL(mirror);
  const ws = new WebSocket(`ws://${url.host}/ws`, { headers: { Origin: url.origin, Cookie: cookie } });
  await new Promise((resolve, reject) => { ws.on("open", resolve); ws.on("error", reject); });
  ws.send(JSON.stringify(msg));
  await sleep(200);
  ws.close();
}

export const parseArgs = (argv) => Object.fromEntries(argv.map((a) => a.replace(/^--/, "").split("=")).map(([k, v = "1"]) => [k, v]));
