// Прототип DOM-зеркалирования: настоящий Chrome на сервере, пользователю уходит
// не видео, а копия DOM (rrweb), ввод пересылается обратно.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { connectCdp } from "./cdp.js";
import { rewriteEvent, rewriteCss } from "./rewrite.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || "8080", 10);
const START_URL = process.env.START_URL || "https://ru.wikipedia.org/";
const RRWEB_DIST = path.join(dir, "node_modules/rrweb/dist");
const rrwebUmd = fs.readFileSync(path.join(RRWEB_DIST, "rrweb.umd.min.cjs"), "utf8");

// --- Браузер -----------------------------------------------------------------
// Обычный Google Chrome уже запущен entrypoint.sh (окно на Xvfb, без флагов автоматизации,
// постоянный профиль). Мы подключаемся к нему по CDP напрямую, без Playwright, и не включаем
// домен Runtime: события из страницы забираем опросом очереди в изолированном мире.
const CDP_URL = process.env.CDP_URL || "http://127.0.0.1:9222";
const cdp = await connectCdp(CDP_URL);

let { targetInfos } = await cdp.send("Target.getTargets");
let target = targetInfos.find((t) => t.type === "page");
if (!target) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  target = { targetId };
}
const targetId = target.targetId;
const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
const P = (method, params) => cdp.send(method, params, sessionId);   // команда нашей вкладке

await P("Page.enable");

// --- Ресурсы, которые Chrome загружает сам ---------------------------------------
// Картинки, стили и шрифты для копии не запрашиваем с сервера заново: Chrome их и так грузит для настоящей
// страницы. Запоминаем эти загрузки и по запросу клиента отдаём тела ответов (Network.getResponseBody).
// Так на сайт уходят только запросы самого браузера — с его TLS-отпечатком, cookies и Referer.
const TRACKED = new Set(["Image", "Stylesheet", "Font", "Other"]);
const stats = { chrome: 0, loaded: 0, fallback: 0 };
const seen = new Map();        // адрес без #фрагмента → загрузка
const byRequest = new Map();   // requestId → загрузка
const norm = (u) => { try { const x = new URL(u); x.hash = ""; return x.href; } catch { return u; } };
const contentType = (r) => {
  const k = Object.keys(r.headers || {}).find((h) => h.toLowerCase() === "content-type");
  return (k && r.headers[k]) || r.mimeType || "application/octet-stream";
};
function forgetLoads() { seen.clear(); byRequest.clear(); }
await P("Network.enable", { maxTotalBufferSize: 128 * 1024 * 1024, maxResourceBufferSize: 32 * 1024 * 1024 });
cdp.on("Network.requestWillBeSent", (p, sid) => {
  if (sid !== sessionId) return;
  if (p.redirectResponse) { const e = byRequest.get(p.requestId); if (e) e.finalUrl = p.request.url; return; }
  if (p.request.method !== "GET" || !TRACKED.has(p.type) || !/^https?:/.test(p.request.url)) return;
  const e = { requestId: p.requestId, key: norm(p.request.url), finalUrl: p.request.url, state: "pending", status: 0, type: "" };
  e.done = new Promise((r) => { e.finish = r; });
  seen.set(e.key, e);
  byRequest.set(p.requestId, e);
  if (seen.size > 4000) { const [k, old] = seen.entries().next().value; seen.delete(k); byRequest.delete(old.requestId); }
});
cdp.on("Network.responseReceived", (p, sid) => {
  const e = sid === sessionId && byRequest.get(p.requestId);
  if (e) { e.status = p.response.status; e.type = contentType(p.response); }
});
const finishLoad = (state) => (p, sid) => {
  const e = sid === sessionId && byRequest.get(p.requestId);
  if (e) { e.state = state; e.finish(); }
};
cdp.on("Network.loadingFinished", finishLoad("done"));
cdp.on("Network.loadingFailed", finishLoad("failed"));

async function fromChrome(href) {
  const key = norm(href);
  let e = seen.get(key);
  if (!e) { await new Promise((r) => setTimeout(r, 250)); e = seen.get(key); }   // клиент мог спросить раньше, чем Chrome начал грузить
  if (!e) return null;
  if (e.state === "pending") await Promise.race([e.done, new Promise((r) => setTimeout(r, 10000))]);
  if (e.state !== "done" || !e.status) return null;
  const { body, base64Encoded } = await P("Network.getResponseBody", { requestId: e.requestId });
  return { status: e.status, type: e.type, body: Buffer.from(body, base64Encoded ? "base64" : "utf8"), url: e.finalUrl };
}

// Второй путь: Chrome сам скачивает ресурс своим сетевым стеком (с cookies), без выполнения кода страницы.
// На сайтах со строгим CSP (connect-src) Chrome такую загрузку запрещает — тогда остаётся запасной путь.
async function loadViaChrome(href) {
  const { resource } = await P("Network.loadNetworkResource", { frameId: mainFrameId, url: href, options: { disableCache: false, includeCredentials: true } });
  if (!resource.success || !resource.stream) return null;
  const chunks = [];
  try {
    for (let eof = false; !eof;) {
      const c = await P("IO.read", { handle: resource.stream, size: 1 << 20 });
      chunks.push(Buffer.from(c.data, c.base64Encoded ? "base64" : "utf8"));
      eof = c.eof;
    }
  } finally {
    P("IO.close", { handle: resource.stream }).catch(() => {});
  }
  const hk = Object.keys(resource.headers || {}).find((h) => h.toLowerCase() === "content-type");
  return { status: resource.httpStatusCode || 200, type: (hk && resource.headers[hk]) || "application/octet-stream", body: Buffer.concat(chunks), url: href };
}

const evalMain = async (expression) => (await P("Runtime.evaluate", { expression, returnByValue: true })).result.value;
const UA = (await cdp.send("Browser.getVersion")).userAgent;          // для прокси ресурсов — как у самого Chrome
const LANGS = await evalMain("navigator.languages");
// Accept-Language прокси берём у самого Chrome, чтобы не расходился с navigator.languages
const ACCEPT_LANG = LANGS.map((l, i) => (i ? `${l};q=${Math.max(0.1, 1 - i * 0.1).toFixed(1)}` : l)).join(",");
console.log("connected to", UA, "|", ACCEPT_LANG);

// --- Состояние вкладки -----------------------------------------------------------
let mainFrameId = (await P("Page.getFrameTree")).frameTree.frame.id;
let currentUrl = await (async () => { const h = await P("Page.getNavigationHistory"); return h.entries[h.currentIndex].url; })();
cdp.on("Page.frameNavigated", ({ frame }, sid) => {
  if (sid !== sessionId || frame.parentId) return;
  mainFrameId = frame.id;
  currentUrl = frame.url + (frame.urlFragment || "");
  worldCtx = null;
  forgetLoads();   // тела ответов прошлой страницы Chrome всё равно сбрасывает
  broadcast({ type: "url", url: currentUrl });
});
cdp.on("Page.navigatedWithinDocument", ({ frameId, url }, sid) => {   // pushState, #якорь
  if (sid !== sessionId || frameId !== mainFrameId) return;
  currentUrl = url;
  broadcast({ type: "url", url });
});
cdp.on("Target.targetDestroyed", ({ targetId: id }) => { if (id === targetId) { console.error("tab closed"); process.exit(1); } });

// Размер страницы меняем размером настоящего окна, а не эмуляцией: так window.innerWidth/outerWidth
// остаются правдоподобными. Рамка окна (вкладки, адресная строка) добавляется сверху.
async function resizeWindow(w, h) {
  const { windowId } = await cdp.send("Browser.getWindowForTarget", { targetId });
  await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
  const frame = JSON.parse(await evalMain("JSON.stringify({ dw: outerWidth - innerWidth, dh: outerHeight - innerHeight })"));
  await cdp.send("Browser.setWindowBounds", { windowId, bounds: { left: 0, top: 0, width: w + frame.dw, height: h + frame.dh } });
}

let history = [];        // события с последнего Meta: новому клиенту хватает их, чтобы собрать страницу
let base = START_URL;    // адрес текущей страницы, относительно него переписываются ссылки
let focusState = { id: null };
let frameRects = [];     // cross-origin iframe в видимой области: [{ id, x, y, w, h, sx, sy }]
let frameState = new Map();   // id → { id, x, y, w, h, img (base64 jpeg), hash } — что уже отправлено клиентам
const clients = new Set();
const broadcast = (msg) => { const s = JSON.stringify(msg); for (const ws of clients) if (ws.readyState === 1) ws.send(s); };

// --- Внедрение rrweb -----------------------------------------------------------
// Всё живёт в изолированном мире — отдельном JS-контексте над теми же DOM-узлами. Страница не видит
// ни window.rrweb, ни нашей очереди, ни подменённых rrweb прототипов (attachShadow и т.п.).
// Домен Runtime не включаем (из-за него Chrome ведёт себя иначе, чем без отладчика), а значит нет и
// событий из страницы: скрипт складывает сообщения в очередь, мы забираем её через Runtime.evaluate.
const WORLD = "mirror-world";
let worldCtx = null;   // id контекста изолированного мира главного фрейма; null — узнать заново

async function resolveWorld() {
  // мир с тем же именем, в котором уже отработал скрипт из addScriptToEvaluateOnNewDocument
  const { executionContextId } = await P("Page.createIsolatedWorld", { frameId: mainFrameId, worldName: WORLD });
  return (worldCtx = executionContextId);
}
async function inWorld(expression) {
  const run = async () => P("Runtime.evaluate", { expression, contextId: worldCtx ?? (await resolveWorld()), returnByValue: true, awaitPromise: true });
  let r;
  try { r = await run(); } catch { worldCtx = null; r = await run(); }
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

function onEmit(raw) {
  const e = JSON.parse(raw);
  if (e.type === 4) { base = e.data.href || base; history = []; focusState = { id: null }; frameRects = []; }   // Meta: новая страница
  rewriteEvent(e, base);
  history.push(e);
  broadcast({ type: "events", events: [e] });
}
const handlers = {
  emit: onEmit,
  // фокус и положение каретки в полях ввода: rrweb их не записывает, передаём отдельно
  focus: (raw) => { focusState = JSON.parse(raw); broadcast({ type: "focus", ...focusState }); },
  // url(...) курсоров — через прокси
  cursor: (cursor) => broadcast({ type: "cursor", cursor: rewriteCss(String(cursor).slice(0, 500), base) }),
  frames: (raw) => { frameRects = JSON.parse(raw).slice(0, 6); },
};

const initScript = `if (window.top === window) {` + rrwebUmd + `
;(() => {
  // очередь сообщений серверу; он забирает её через Runtime.evaluate
  const queue = [];
  window.__mirrorDrain = () => queue.length ? queue.splice(0) : null;
  const post = (name, payload) => queue.push([name, payload]);

  const start = () => {
    if (!window.rrweb) return setTimeout(start, 50);
    window.rrweb.record({
      emit: (e) => post("emit", JSON.stringify(e)),
      inlineStylesheet: true,
      recordCanvas: false,
      slimDOMOptions: "all",
      // положение мыши нужно плееру, чтобы подсвечивать :hover; отдаём быстро, без накопления по 500 мс.
      // input: "all" — значение поля на каждое нажатие (с "last" rrweb шлёт его только при потере фокуса)
      sampling: { mousemove: 30, mousemoveCallback: 30, mouseInteraction: false, scroll: 100, input: "all" },
    });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();

  // каретка: id узла по нумерации rrweb + выделение в поле
  let last = "";
  const report = () => {
    const el = document.activeElement;
    const isField = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
    const id = isField && window.rrweb ? window.rrweb.record.mirror.getId(el) : null;
    let start = null, end = null;
    try { if (isField) { start = el.selectionStart; end = el.selectionEnd; } } catch {}
    const s = JSON.stringify({ id: id > 0 ? id : null, start, end });
    if (s !== last) { last = s; post("focus", s); }
  };
  for (const ev of ["focusin", "focusout", "selectionchange", "input", "keyup", "mouseup"])
    document.addEventListener(ev, () => setTimeout(report, 0), true);

  // форма курсора под мышью: pointer над ссылками, text над текстом и т.д.
  let lastCursor = "";
  const cursorFor = (el) => {
    if (!el || el.nodeType !== 1) return "default";
    const c = getComputedStyle(el).cursor;
    if (c && c !== "auto") return c;
    if (el.closest("a[href], button, [role=button], label, summary, select")) return "pointer";
    if (el.closest("input, textarea, [contenteditable=''], [contenteditable=true]")) return "text";
    for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) return "text";
    return "default";
  };
  document.addEventListener("mousemove", (e) => {
    const c = cursorFor(e.target);
    if (c !== lastCursor) { lastCursor = c; post("cursor", c); }
  }, true);

  // iframe с чужого сайта (виджеты проверки, YouTube): rrweb их содержимое не видит, поэтому
  // сообщаем серверу, где они на экране, а он присылает картинку этой области
  const ids = new WeakMap(); let nextId = 1, lastFrames = "";
  const scanFrames = () => {
    const out = [];
    for (const f of document.querySelectorAll("iframe")) {
      let same = false; try { same = !!f.contentDocument; } catch {}
      if (same) continue;                                   // свой origin — rrweb записывает сам
      const cs = getComputedStyle(f);
      if (cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.05) continue;
      const r = f.getBoundingClientRect();
      const x0 = Math.max(0, r.left), y0 = Math.max(0, r.top);
      const x1 = Math.min(innerWidth, r.right), y1 = Math.min(innerHeight, r.bottom);
      if (x1 - x0 < 20 || y1 - y0 < 20) continue;           // пиксели трекеров и скрытые заглушки
      if (!ids.has(f)) ids.set(f, nextId++);
      out.push({ id: ids.get(f), x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0),
        sx: Math.round(scrollX), sy: Math.round(scrollY) });
    }
    out.sort((a, b) => b.w * b.h - a.w * a.h);
    const s = JSON.stringify(out);
    if (s !== lastFrames) { lastFrames = s; post("frames", s); }
  };
  setInterval(scanFrames, 300);
  addEventListener("scroll", scanFrames, true);
  addEventListener("resize", scanFrames);
})();
}`;
await P("Page.addScriptToEvaluateOnNewDocument", { source: initScript, worldName: WORLD });

// забираем очередь сообщений из страницы
let draining = false;
async function drain() {
  if (draining) return;
  draining = true;
  try {
    const items = await inWorld("window.__mirrorDrain ? window.__mirrorDrain() : null");
    for (const [name, payload] of items || []) {
      try { handlers[name]?.(payload); } catch (e) { console.error(name, e.message); }
    }
  } catch {
    worldCtx = null;   // страница как раз переходит на другой адрес — на следующем шаге узнаем контекст заново
  } finally {
    draining = false;
  }
}
setInterval(drain, 20);

// --- Картинки cross-origin iframe ------------------------------------------------
// Ввод и снимки экрана идут через одну очередь: пока снимается кадр, клики и клавиши, отправленные
// параллельно, иногда терялись (если на странице есть iframe с другого сайта).
const FRAMES = process.env.FRAMES !== "0";   // FRAMES=0 отключает показ iframe картинкой
const SETTLE_MS = parseInt(process.env.SETTLE_MS || "80", 10);
let queueTail = Promise.resolve();
const serial = (fn) => { const p = queueTail.then(fn); queueTail = p.catch(() => {}); return p; };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// После снимка Chrome ещё немного «приходит в себя»: событие мыши, пришедшее сразу следом, может потеряться.
// Поэтому пауза входит в ту же очередь — ввод, ожидающий за снимком, начнётся только после неё.
const shoot = (r) => serial(async () => {
  const s = await P("Page.captureScreenshot", {
    format: "jpeg", quality: 70,
    captureBeyondViewport: false, fromSurface: true,   // иначе Chrome на время снимка меняет окно
    clip: { x: r.x + r.sx, y: r.y + r.sy, width: r.w, height: r.h, scale: 1 },
  });
  await sleep(SETTLE_MS);
  return s;
}).then((s) => Buffer.from(s.data, "base64")).catch(() => null);

async function frameTick() {
  if (Date.now() - lastInput < 300) return;   // пока пользователь двигает мышь или печатает, кадры не снимаем — они тормозят страницу
  const next = new Map();
  const sent = [];
  let dirty = frameRects.length !== frameState.size;
  for (const r of frameRects) {
    const prev = frameState.get(r.id);
    let { img, hash } = prev || {};
    let fresh = false;
    const shot = await shoot(r);
    if (shot) {
      const h = crypto.createHash("md5").update(shot).digest("hex");
      if (h !== hash) { hash = h; img = shot.toString("base64"); fresh = true; }
    }
    if (!prev || fresh || prev.x !== r.x || prev.y !== r.y || prev.w !== r.w || prev.h !== r.h) dirty = true;
    next.set(r.id, { id: r.id, x: r.x, y: r.y, w: r.w, h: r.h, img, hash });
    sent.push({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h, img: fresh ? img : undefined });
  }
  frameState = next;
  if (dirty) broadcast({ type: "frames", frames: sent });
}
(async () => {
  for (;;) {
    try { if (FRAMES && clients.size && (frameRects.length || frameState.size)) await frameTick(); } catch (e) { console.error("frames:", e.message); }
    await new Promise((r) => setTimeout(r, 250));
  }
})();

// --- Новые вкладки ---------------------------------------------------------------
// Сайты открывают ссылки в новой вкладке — закрываем её и открываем адрес в нашей.
const popups = new Map();   // targetId → уже обработана
const checkPopup = (t) => {
  if (popups.get(t.targetId) || !t.url || t.url === "about:blank") return;
  popups.set(t.targetId, true);
  cdp.send("Target.closeTarget", { targetId: t.targetId }).catch(() => {});
  P("Page.navigate", { url: t.url }).catch(() => {});
};
await cdp.send("Target.setDiscoverTargets", { discover: true });   // уже открытые вкладки приходят до ответа — их не трогаем
cdp.on("Target.targetCreated", ({ targetInfo: t }) => {
  if (t.type !== "page" || t.targetId === targetId) return;
  popups.set(t.targetId, false);
  checkPopup(t);
});
cdp.on("Target.targetInfoChanged", ({ targetInfo: t }) => { if (popups.has(t.targetId)) checkPopup(t); });
cdp.on("Target.targetDestroyed", ({ targetId: id }) => popups.delete(id));

P("Page.navigate", { url: START_URL }).catch((e) => console.error("goto:", e.message));

// --- Ввод от пользователя ------------------------------------------------------
// Настоящий ввод через Input.*: события приходят в страницу доверенными, с правильными screenX/Y.
// Нажатие и отпускание клавиш, как и ход мыши, приходят от пользователя по отдельности и с его же
// временем — своих «человеческих» пауз не придумываем.
const mods = (m) => (m.alt ? 1 : 0) | (m.ctrl ? 2 : 0) | (m.meta ? 4 : 0) | (m.shift ? 8 : 0);
const mouseMods = (m) => (Number(m.mod) | 0) & 15;
const mouse = { x: 0, y: 0, buttons: 0 };
const BTN = { left: 1, right: 2, middle: 4 };
const heldButton = () => (mouse.buttons & 1 ? "left" : mouse.buttons & 4 ? "middle" : mouse.buttons & 2 ? "right" : "none");
const mouseEvent = (type, extra) => P("Input.dispatchMouseEvent", { type, x: mouse.x, y: mouse.y, buttons: mouse.buttons, ...extra });
async function moveTo(x, y, modifiers) {
  if (x === mouse.x && y === mouse.y) return;
  mouse.x = x; mouse.y = y;
  await mouseEvent("mouseMoved", { button: heldButton(), modifiers });
}

const SKIP_KEYS = new Set(["Dead", "Unidentified", "Process"]);
function keyParams(m, type) {
  if (SKIP_KEYS.has(m.key)) return null;
  let key = String(m.key);
  // горячие клавиши на нелатинской раскладке: key — кириллица, а странице нужна латиница (Ctrl+С → c)
  if ((m.ctrl || m.meta) && !m.altgr) {
    const mm = /^Key([A-Z])$/.exec(m.code || "");
    if (mm) key = m.shift ? mm[1] : mm[1].toLowerCase();
  }
  const vk = Number(m.keyCode) | 0;
  const p = { type, key, code: String(m.code || ""), modifiers: mods(m), windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, location: Number(m.loc) | 0 };
  if (type === "keyDown") {
    if (m.repeat) p.autoRepeat = true;
    const text = key === "Enter" ? "\r" : key.length === 1 && !m.meta && (!m.ctrl || m.altgr) ? key : "";
    if (text) { p.text = text; p.unmodifiedText = text; } else p.type = "rawKeyDown";   // без текста символ не вводится
  }
  return p;
}

async function handleInput(m) {
  switch (m.type) {
    case "move": return moveTo(m.x, m.y, mouseMods(m));
    case "down": {
      await moveTo(m.x, m.y, mouseMods(m));
      mouse.buttons |= BTN[m.button] || 1;
      return mouseEvent("mousePressed", { button: m.button, clickCount: m.count, modifiers: mouseMods(m) });
    }
    case "up": {
      await moveTo(m.x, m.y, mouseMods(m));
      mouse.buttons &= ~(BTN[m.button] || 1);
      return mouseEvent("mouseReleased", { button: m.button, clickCount: m.count, modifiers: mouseMods(m) });
    }
    case "wheel": {
      await moveTo(m.x, m.y, mouseMods(m));
      return mouseEvent("mouseWheel", { deltaX: m.dx, deltaY: m.dy, modifiers: mouseMods(m) });
    }
    case "keydown": { const p = keyParams(m, "keyDown"); return p && P("Input.dispatchKeyEvent", p); }
    case "keyup": { const p = keyParams(m, "keyUp"); return p && P("Input.dispatchKeyEvent", p); }
    case "text": return P("Input.insertText", { text: String(m.text) });
    case "fill": {   // значение, которое появилось в поле копии в обход клавиш (автозаполнение, IME, телефон)
      // узел ищем в изолированном мире (там живёт нумерация rrweb), ставим в нём фокус и выделение,
      // а само значение вводим настоящим вводом — так страница получает обычные события input
      const id = Number(m.id) | 0;
      const ok = await inWorld(`(() => { const el = window.rrweb && window.rrweb.record.mirror.getNode(${id});
        if (!el) return false; el.focus(); if (el.select) el.select(); return true; })()`);
      if (!ok) return;
      const v = String(m.value);
      if (v !== "") return P("Input.insertText", { text: v });
      const del = { key: "Delete", code: "Delete", windowsVirtualKeyCode: 46, nativeVirtualKeyCode: 46 };
      await P("Input.dispatchKeyEvent", { type: "rawKeyDown", ...del });
      return P("Input.dispatchKeyEvent", { type: "keyUp", ...del });
    }
  }
}

// Команды навигации выполняются сразу, а ввод — строго по очереди, чтобы нажатия не перемешивались
const NAV = {
  viewport: (m) => resizeWindow(m.w, m.h),
  goto: (m) => P("Page.navigate", { url: /^https?:\/\//.test(m.url) ? m.url : "https://" + m.url }),
  back: () => stepHistory(-1),
  forward: () => stepHistory(1),
  reload: () => P("Page.reload"),
};
async function stepHistory(delta) {
  const h = await P("Page.getNavigationHistory");
  const e = h.entries[h.currentIndex + delta];
  if (e) await P("Page.navigateToHistoryEntry", { entryId: e.id });
}
let lastInput = 0;
function onMessage(m) {
  lastInput = Date.now();
  if (NAV[m.type]) return NAV[m.type](m).catch((e) => console.error(m.type, e.message));
  serial(() => handleInput(m)).catch((e) => console.error(m.type, e.message));
}

// --- HTTP: страница клиента, rrweb, прокси ресурсов -----------------------------
const send = (res, file, type) => fs.createReadStream(file).on("error", () => { res.writeHead(404); res.end(); })
  .once("open", () => res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" })).pipe(res);

// Отдаём клиенту то, что Chrome уже загрузил для настоящей страницы (его TLS, его cookies, его заголовки),
// и только если такого ответа нет — грузим сами (запасной путь).
async function proxy(req, res, target) {
  let url;
  try { url = new URL(target); if (!/^https?:$/.test(url.protocol)) throw 0; } catch { res.writeHead(400); return res.end(); }
  const reply = (status, type, body, baseUrl) => {
    if (/text\/css/i.test(type)) body = Buffer.from(rewriteCss(body.toString("utf8"), baseUrl));   // ссылки внутри CSS — относительно самого CSS
    res.writeHead(status, {
      "Content-Type": type,
      "Cache-Control": status < 400 ? "public, max-age=3600" : "no-store",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(body);
  };
  try {
    const hit = await fromChrome(url.href).catch(() => null);
    if (hit) { stats.chrome++; return reply(hit.status, hit.type, hit.body, hit.url); }
    const loaded = await loadViaChrome(url.href).catch(() => null);
    if (loaded) { stats.loaded++; return reply(loaded.status, loaded.type, loaded.body, loaded.url); }
    stats.fallback++;
    console.log("proxy: запасной путь (Node, Chrome не смог):", url.href.slice(0, 140));
    const r = await fetch(url, { headers: { "User-Agent": UA, Referer: base, "Accept-Language": ACCEPT_LANG }, redirect: "follow" });
    reply(r.status, r.headers.get("content-type") || "application/octet-stream", Buffer.from(await r.arrayBuffer()), r.url);
  } catch (e) {
    res.writeHead(502); res.end();
  }
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/") return send(res, path.join(dir, "public/index.html"), "text/html; charset=utf-8");
  if (u.pathname === "/client.js") return send(res, path.join(dir, "public/client.js"), "application/javascript; charset=utf-8");
  if (u.pathname === "/rrweb.js") return send(res, path.join(RRWEB_DIST, "rrweb.umd.min.cjs"), "application/javascript; charset=utf-8");
  if (u.pathname === "/rrweb.css") return send(res, path.join(RRWEB_DIST, "style.css"), "text/css; charset=utf-8");
  if (u.pathname === "/r") return proxy(req, res, u.searchParams.get("u"));
  // отладка: что на самом деле видит браузер на сервере
  if (u.pathname === "/debug/shot.png") {
    return P("Page.captureScreenshot", { format: "png" }).then((s) => { res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" }); res.end(Buffer.from(s.data, "base64")); })
      .catch((e) => { res.writeHead(500); res.end(e.message); });
  }
  if (u.pathname === "/debug/stats") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ ...stats, tracked: seen.size })); }
  if (u.pathname === "/debug/state") {
    return inWorld(`(() => {
      const el = document.activeElement;
      const fields = [...document.querySelectorAll("input, textarea")].map((f) => ({
        tag: f.tagName, type: f.type, name: f.name, id: f.id, value: f.value,
        rrwebId: window.rrweb ? window.rrweb.record.mirror.getId(f) : null,
      }));
      return { url: location.href, active: el && { tag: el.tagName, type: el.type, id: el.id, value: el.value }, fields };
    })()`).then((st) => { res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(st, null, 2)); })
      .catch((e) => { res.writeHead(500); res.end(e.message); });
  }
  res.writeHead(404); res.end();
});

const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({ type: "url", url: currentUrl }));
  ws.send(JSON.stringify({ type: "events", events: history }));
  ws.send(JSON.stringify({ type: "focus", ...focusState }));
  ws.send(JSON.stringify({ type: "frames", frames: [...frameState.values()].map(({ id, x, y, w, h, img }) => ({ id, x, y, w, h, img })) }));
  ws.on("message", (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.type !== "move" && m.type !== "wheel" && m.type !== "keydown" && m.type !== "keyup") console.log("input", JSON.stringify(m).slice(0, 200));
    onMessage(m);
  });
  ws.on("close", () => clients.delete(ws));
});

server.listen(PORT, () => console.log(`dom-mirror: http://localhost:${PORT}  (start: ${START_URL})`));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(0));
