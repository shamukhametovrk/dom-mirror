// Замеры скорости синхронизации. Клиент — Chrome с портом отладки, сервер — контейнер dom-mirror.
// node bench/run.mjs --client=9224 --mirror=http://localhost:8099 --password=bench --container=<имя> [--only=typing,scroll,nav] [--netem=8100]
// --netem — порт счётчика байт bench/netem.mjs (listen+1), если клиент ходит через него.
import { execSync } from "node:child_process";
import { command, connectPage, fmt, login, parseArgs, sleep, stats, waitFor } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
const MIRROR = args.mirror ?? "http://localhost:8098";
const ONLY = new Set((args.only ?? "typing,scroll,nav").split(","));
const PAGES = (args.pages ?? [
  "https://ru.wikipedia.org/wiki/Москва",
  "https://habr.com/ru/articles/",
  "https://github.com/rrweb-io/rrweb",
  "https://www.bbc.com/news",
].join(",")).split(",");

const page = await connectPage(args.client ?? "9224");
await page.send("Network.enable");
const cookie = await login(page, MIRROR, args.password ?? "bench");
const goto = async (url) => command(MIRROR, cookie, { type: "goto", url });
const copyExpr = (body) => `(() => { const f = document.querySelector('#player iframe'); const d = f?.contentDocument; const w = f?.contentWindow; ${body} })()`;
// переход с ожиданием, пока в копии появится новая страница (через example.com — чтобы заголовок точно сменился)
const open = async (url) => {
  await goto("https://example.com/");
  await waitFor(() => page.ev(copyExpr("return d?.title === 'Example Domain';")), 30000);
  await goto(url);
  await waitFor(() => page.ev(copyExpr("return d?.title && d.title !== 'Example Domain';")), 60000);
};
const result = {};

// CPU контейнера (мкс) и процесса node — по cgroup и /proc.
const cpu = () => {
  if (!args.container) return null;
  const out = execSync(`docker exec ${args.container} sh -c "grep usage_usec /sys/fs/cgroup/cpu.stat; cat /proc/$(pidof node)/stat"`, { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
  const total = Number(/usage_usec (\d+)/.exec(out)[1]) / 1000;
  const fields = out.trim().split("\n").at(-1).split(") ")[1].split(" ");
  return { total, node: (Number(fields[11]) + Number(fields[12])) * 10 };
};
const wireBytes = async (reset) => (args.netem ? (await (await fetch(`http://127.0.0.1:${args.netem}/${reset ? "?reset" : ""}`)).json()).down : NaN);

// --- ввод: нажатие → символ в поле копии --------------------------------------------
async function typing() {
  await open("https://httpbin.org/forms/post");
  const box = await waitFor(() => page.ev(copyExpr(`const i = d?.querySelector('input[name=custname]'); if (!i) return null;
    const r = i.getBoundingClientRect(), fr = f.getBoundingClientRect(); return r.width ? { x: fr.left + r.left + 10, y: fr.top + r.top + r.height / 2 } : null;`)));
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1, buttons: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 });
  await sleep(1500);
  await page.ev(copyExpr(`window.__lat = [];
    const field = () => f.contentDocument.querySelector('input[name=custname]');
    const measure = () => { const t0 = performance.now(), before = field().value, ch = new MessageChannel();
      ch.port1.onmessage = () => { const dt = performance.now() - t0; if (field().value !== before) __lat.push(dt); else if (dt < 3000) ch.port2.postMessage(0); else __lat.push(-1); };
      ch.port2.postMessage(0); };
    window.addEventListener('keydown', measure, true); w.addEventListener('keydown', measure, true); return 0;`));
  for (let i = 0; i < 25; i++) {
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", text: "a", windowsVirtualKeyCode: 65 });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
    await sleep(250);
  }
  await sleep(1500);
  const lat = await page.ev("window.__lat");
  const server = await (await fetch(`${MIRROR}/debug/state`, { headers: { Cookie: cookie } })).json();
  result.typing = { ...stats(lat), lost: lat.filter((x) => x < 0).length, serverValueLength: server.active?.value?.length };
  console.log(`ввод: ${fmt(result.typing)}; потеряно ${result.typing.lost}; на сервере ${result.typing.serverValueLength} символов`);
}

// --- прокрутка: шаг колеса → копия начала двигаться / остановилась ---------------------
async function scroll() {
  if (args.cold) probe("clear-cache");
  await open("https://www.rfc-editor.org/rfc/rfc9110.html");
  await waitFor(() => page.ev(copyExpr("return (d?.body?.scrollHeight ?? 0) > 5000;")), 60000);
  await sleep(Number(args.warmup ?? 2000));
  // отсчёт — от события wheel в странице клиента: так не учитывается задержка синтетического ввода самого Chrome
  await page.ev(copyExpr(`window.__track = () => new Promise((resolve) => {
    const overlay = document.getElementById('overlay');
    let t0 = 0, last = w.scrollY, first = null, lastChange = null; const frames = [], log = [[0, Math.round(w.scrollY)]];
    overlay.addEventListener('wheel', () => { t0 = performance.now(); requestAnimationFrame(loop); }, { once: true, capture: true });
    const loop = () => { const now = performance.now(), y = w.scrollY;
      if (y !== last) { last = y; first ??= now - t0; lastChange = now - t0; frames.push(now); log.push([Math.round(now - t0), Math.round(y)]); }
      if (lastChange !== null && now - t0 - lastChange > 600) return resolve({ first, settle: lastChange, log, frames: frames.slice(1).map((t, i) => t - frames[i]) });
      if (now - t0 > 5000) return resolve({ first, settle: lastChange, frames: [] });
      requestAnimationFrame(loop); };
  }); return 0;`));
  const first = [], settle = [], gaps = [];
  for (let i = 0; i < 10; i++) {
    const tracking = page.ev("window.__track()");
    await page.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 600, y: 400, deltaX: 0, deltaY: i % 2 ? -100 : 100 });
    const r = await tracking;
    if (r.first !== null) { first.push(r.first); settle.push(r.settle); gaps.push(...r.frames); }
    if (r.settle > 300) (result.slowGestures ??= []).push(r.log);
  }
  result.scroll = { first: stats(first), settle: stats(settle), frameGap: stats(gaps) };
  console.log(`прокрутка: начало ${fmt(result.scroll.first)}; конец ${fmt(result.scroll.settle)}; между кадрами ${fmt(result.scroll.frameGap)}`);
}

// --- согласованность: сервер догоняет копию; клик сразу после прокрутки попадает туда же -------
const probe = (mode) => JSON.parse(execSync(`docker exec ${args.container} node /tmp/probe.mjs ${mode}`,
  { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } }));

async function sync() {
  execSync(`docker cp bench/probe.mjs ${args.container}:/tmp/probe.mjs`, { env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
  await open("https://www.rfc-editor.org/rfc/rfc9110.html");
  await waitFor(() => page.ev(copyExpr("return (d?.body?.scrollHeight ?? 0) > 5000;")), 60000);
  await sleep(2000);
  probe("watch-clicks");
  const copyY = () => page.ev(copyExpr("return w.scrollY;"));
  const at = { x: 600, y: 300 };
  // что видит пользователь в точке клика — сразу после того, как клиент обработал mousedown (и докрутил прокрутку)
  await page.ev(copyExpr(`window.__seen = []; window.addEventListener('mousedown', () => setTimeout(() => {
    const el = d.elementFromPoint(${at.x}, ${at.y}); __seen.push({ text: (el?.textContent || '').trim().slice(0, 60), y: w.scrollY }); }), true); return 0;`));
  const gaps = [];
  for (let i = 0; i < 8; i++) {
    for (let n = 0; n < 3; n++) {
      await page.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: at.x, y: at.y, deltaX: 0, deltaY: i % 2 ? -100 : 100 });
      await sleep(30);
    }
    await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: at.x, y: at.y, button: "left", clickCount: 1, buttons: 1 });
    await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: at.x, y: at.y, button: "left", clickCount: 1 });
    await sleep(1500);
    gaps.push(Math.abs((await copyY()) - probe("scroll").y));
  }
  const seen = await page.ev("window.__seen");
  const clicked = probe("clicks");
  const sameTarget = seen.filter((s, i) => clicked[i] && clicked[i].text === s.text).length;
  const sameScroll = seen.filter((s, i) => clicked[i] && Math.abs(clicked[i].y - s.y) <= 1).length;
  result.sync = { finalGapPx: stats(gaps), clicks: seen.length, sameTarget, sameScroll, seen, clicked };
  console.log(`согласованность: разница позиций через 1,5 с после жеста ${fmt(result.sync.finalGapPx, "px")}; клик сразу после прокрутки — тот же элемент ${sameTarget}/${seen.length}, та же прокрутка ${sameScroll}/${seen.length}`);
}

// --- переход: команда → копия отрисована → ресурсы догрузились; трафик и CPU -----------
const traffic = { wsBytes: 0, proxyBytes: 0, proxyRequests: 0, lastProxy: 0, proxied: new Set() };
page.on("Network.webSocketFrameReceived", (p) => { traffic.wsBytes += Buffer.byteLength(p.response.payloadData); });
page.on("Network.requestWillBeSent", (p) => { if (p.request.url.includes("/r?u=")) traffic.proxied.add(p.requestId); });
page.on("Network.loadingFinished", (p) => {
  if (!traffic.proxied.has(p.requestId)) return;
  traffic.proxyBytes += p.encodedDataLength;
  traffic.proxyRequests++;
  traffic.lastProxy = performance.now();
});

async function navigateOnce(url) {
  const titleBefore = await page.ev(copyExpr("return d?.title ?? '';"));
  Object.assign(traffic, { wsBytes: 0, proxyBytes: 0, proxyRequests: 0, lastProxy: 0 });
  await page.send("Network.clearBrowserCache");
  await wireBytes(true);
  const cpu0 = cpu();
  const t0 = performance.now();
  await goto(url);
  const rendered = await waitFor(() => page.ev(copyExpr(`return d && d.title && d.title !== ${JSON.stringify(titleBefore)} && d.body && d.body.childElementCount > 0;`)), 60000, 20);
  const tRender = performance.now() - t0;
  await waitFor(async () => performance.now() - Math.max(traffic.lastProxy, t0 + tRender) > 2000, 60000, 200);
  const cpu1 = cpu();
  return {
    url, rendered: Boolean(rendered), render: tRender, complete: Math.max(traffic.lastProxy - t0, tRender),
    wsKB: traffic.wsBytes / 1024, proxyKB: traffic.proxyBytes / 1024, proxyRequests: traffic.proxyRequests,
    wireKB: (await wireBytes(false)) / 1024,
    cpuMs: cpu1 && cpu1.total - cpu0.total, nodeCpuMs: cpu1 && cpu1.node - cpu0.node,
  };
}

async function nav() {
  result.nav = [];
  for (const url of PAGES) {
    await goto("https://example.com/");
    await sleep(3000);
    await navigateOnce(url);   // прогрев: кэш серверного Chrome
    await goto("https://example.com/");
    await sleep(3000);
    const r = await navigateOnce(url);
    result.nav.push(r);
    console.log(`переход ${new URL(url).host}: отрисовка ${r.render.toFixed(0)} мс, полностью ${r.complete.toFixed(0)} мс; WS ${r.wsKB.toFixed(0)} КБ, /r ${r.proxyRequests} шт ${r.proxyKB.toFixed(0)} КБ, на проводе ${r.wireKB.toFixed(0)} КБ; CPU ${r.cpuMs?.toFixed(0)} мс (node ${r.nodeCpuMs?.toFixed(0)})`);
  }
}

for (const [name, fn] of [["typing", typing], ["scroll", scroll], ["sync", sync], ["nav", nav]]) if (ONLY.has(name)) await fn();
if (args.out) (await import("node:fs")).writeFileSync(args.out, JSON.stringify(result, null, 2));
process.exit(0);
