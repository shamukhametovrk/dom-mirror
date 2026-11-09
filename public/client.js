"use strict";
const $ = (id) => document.getElementById(id);
const stage = $("stage"), overlay = $("overlay"), urlInput = $("url"), status = $("status");

let ws, replayer;

function connect() {
  ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
  ws.onopen = () => { status.textContent = "онлайн"; setFrames([]); resetReplayer(); sendViewport(); overlay.focus(); };
  ws.onclose = () => { status.textContent = "нет связи"; setTimeout(connect, 1000); };
  ws.onmessage = (msg) => {
    const m = JSON.parse(msg.data);
    if (m.type === "url" && document.activeElement !== urlInput) urlInput.value = m.url;
    if (m.type === "events") for (const e of m.events) addEvent(e);
    if (m.type === "focus") { focus = m; setTimeout(applyFocus, 30); }   // после применения значения поля
    if (m.type === "cursor") overlay.style.cursor = m.cursor;
    if (m.type === "frames") setFrames(m.frames);
  };
}

// --- Cross-origin iframe -------------------------------------------------------
// Содержимое iframe с чужого сайта rrweb не видит, поэтому сервер присылает картинку этой области.
// Клики по ней всё равно уходят через слой overlay на настоящую страницу.
const framesEl = $("frames"), frameImgs = new Map();
function setFrames(list) {
  const seen = new Set();
  for (const f of list) {
    seen.add(f.id);
    let img = frameImgs.get(f.id);
    if (!img) {
      img = new Image();
      img.draggable = false;
      img.onload = () => { img.style.visibility = "visible"; };
      framesEl.appendChild(img);
      frameImgs.set(f.id, img);
    }
    Object.assign(img.style, { left: f.x + "px", top: f.y + "px", width: f.w + "px", height: f.h + "px" });
    if (f.img) img.src = "data:image/jpeg;base64," + f.img;
  }
  for (const [id, img] of frameImgs) if (!seen.has(id)) { img.remove(); frameImgs.delete(id); }
}
const send = (m) => ws && ws.readyState === 1 && ws.send(JSON.stringify(m));

// --- Воспроизведение DOM -------------------------------------------------------
function resetReplayer() {
  $("player").innerHTML = "";
  replayer = new rrweb.Replayer([], {
    root: $("player"),
    liveMode: true,
    mouseTail: false,
    triggerFocus: false,
    showWarning: false,
  });
  replayer.on("fullsnapshot-rebuilded", hookIframe);
  replayer.on("event-cast", syncFieldValues);
  replayer.startLive(Date.now() - 100);
}

// React (и не только) часто отражает значение поля в атрибут value, и rrweb присылает
// именно изменение атрибута. Но у поля, которое уже меняли, атрибут value больше не управляет
// тем, что отображается, — поэтому дублируем его в свойство .value.
function syncFieldValues(e) {
  if (e.type !== 3 || e.data.source !== 0 || !e.data.attributes) return;
  let touched = false;
  for (const a of e.data.attributes) {
    if (!a.attributes || !("value" in a.attributes)) continue;
    const el = replayer.getMirror().getNode(a.id);
    if (!el || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) continue;
    const v = a.attributes.value == null ? "" : String(a.attributes.value);
    if (el.value !== v) { el.value = v; touched = true; }
  }
  if (touched) applyFocus();   // после смены value каретка улетает в конец — вернуть на место
}

// Когда на сервере в фокусе поле ввода, фокусируем такое же поле в копии и ставим каретку.
// Ввод при этом всё равно уходит на сервер, а текст в поле приходит обратно от rrweb.
let focus = { id: null };
function applyFocus() {
  const doc = replayer && replayer.iframe && replayer.iframe.contentDocument;
  if (!doc) return;
  hookIframe();
  const el = focus.id ? replayer.getMirror().getNode(focus.id) : null;
  if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) {
    if (doc.activeElement !== el) el.focus({ preventScroll: true });
    try { if (focus.start != null) el.setSelectionRange(focus.start, focus.end); } catch {}
  } else {
    if (doc.activeElement && doc.activeElement.blur) doc.activeElement.blur();
    if (document.activeElement !== urlInput) overlay.focus();
  }
}
// Клавиши, нажатые пока фокус в поле копии, перехватываем так же, как на слое поверх.
// При пересборке страницы rrweb делает document.open(), а он стирает все обработчики окна iframe,
// поэтому вешаем их заново каждый раз (повторный addEventListener той же функции ничего не дублирует).
function hookIframe() {
  const win = replayer.iframe && replayer.iframe.contentWindow;
  if (!win) return;
  win.addEventListener("keydown", onKeyDown, true);
  win.addEventListener("keyup", onKeyUp, true);
  win.addEventListener("paste", onPaste, true);
  win.addEventListener("input", onLocalInput, true);
}

// Значение поля в копии могло измениться без нажатий клавиш: автозаполнение браузера,
// подсказки, ввод через IME или экранную клавиатуру телефона. Такие изменения rrweb сам
// не вызывает (он ставит value программно, без события input), значит это пользователь —
// отправляем значение на сервер, где Playwright заполнит настоящее поле.
const fillTimers = new Map();
function onLocalInput(e) {
  const el = e.target;
  if (!el || (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA")) return;
  const id = replayer.getMirror().getId(el);
  if (!(id > 0)) return;
  clearTimeout(fillTimers.get(id));
  fillTimers.set(id, setTimeout(() => send({ type: "fill", id, value: el.value }), 150));
}
function addEvent(e) {
  // время событий — по часам сервера; переводим на свои, чтобы live-режим проигрывал сразу
  e.timestamp = Date.now();
  replayer.addEvent(e);
}

// --- Размер окна → размер страницы на сервере ------------------------------------
let vpTimer;
function sendViewport() {
  clearTimeout(vpTimer);
  vpTimer = setTimeout(() => send({ type: "viewport", w: stage.clientWidth, h: stage.clientHeight }), 200);
}
window.addEventListener("resize", sendViewport);

// --- Мышь --------------------------------------------------------------------
const pos = (e) => { const r = overlay.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
const BUTTONS = ["left", "middle", "right"];
// модификаторы: Alt=1, Ctrl=2, Meta=4, Shift=8 (как в CDP)
const mods = (e) => (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
let held = 0;   // зажатые кнопки мыши (битовая маска по e.button)
overlay.addEventListener("mousedown", (e) => {
  e.preventDefault();
  if (document.activeElement === urlInput) overlay.focus();
  flushMove();
  held |= 1 << e.button;
  send({ type: "down", ...pos(e), button: BUTTONS[e.button] || "left", count: e.detail || 1, mod: mods(e) });
});
// Отпускание ловим на всём окне: если кнопку отпустили за пределами слоя, на сервере она не должна остаться зажатой
window.addEventListener("mouseup", (e) => {
  if (!(held & (1 << e.button))) return;
  held &= ~(1 << e.button);
  flushMove();
  send({ type: "up", ...pos(e), button: BUTTONS[e.button] || "left", count: e.detail || 1, mod: mods(e) });
}, true);
overlay.addEventListener("contextmenu", (e) => e.preventDefault());
// Ход мыши отдаём примерно 60 раз в секунду, а последнюю позицию досылаем обязательно — иначе :hover «залипает»
let lastMove = 0, moveTimer = 0, pendingMove = null;
function flushMove() {
  clearTimeout(moveTimer); moveTimer = 0;
  if (pendingMove) { send(pendingMove); pendingMove = null; lastMove = Date.now(); }
}
window.addEventListener("mousemove", (e) => {
  if (!held && e.target !== overlay) return;   // при зажатой кнопке (выделение, перетаскивание) следим и за пределами слоя
  pendingMove = { type: "move", ...pos(e), mod: mods(e) };
  const wait = 16 - (Date.now() - lastMove);
  if (wait <= 0) flushMove(); else if (!moveTimer) moveTimer = setTimeout(flushMove, wait);
});
overlay.addEventListener("wheel", (e) => {
  e.preventDefault();
  // deltaMode: 0 — пиксели, 1 — строки (Firefox), 2 — страницы
  const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? stage.clientHeight : 1;
  send({ type: "wheel", ...pos(e), dx: e.deltaX * k, dy: e.deltaY * k, mod: mods(e) });
}, { passive: false });

// --- Клавиатура ----------------------------------------------------------------
// Нажатие и отпускание уходят отдельными сообщениями, с настоящими code/keyCode и признаком повтора:
// так страница видит ту длительность нажатия, которую задал сам пользователь.
const skippedKeys = new Set();   // клавиши, чей keydown не отправили (Ctrl+V) — keyup тоже пропускаем
const keyMsg = (type, e) => ({
  type, key: e.key, code: e.code, keyCode: e.keyCode, loc: e.location, repeat: e.repeat,
  ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey, shift: e.shiftKey,
  altgr: !!(e.getModifierState && e.getModifierState("AltGraph")),
});
function onKeyDown(e) {
  if (e.isComposing) return;
  // Ctrl/Cmd+V — вставку забираем из события paste, чтобы передать текст (по code — работает и на русской раскладке)
  if ((e.ctrlKey || e.metaKey) && e.code === "KeyV") { skippedKeys.add(e.code); return; }
  e.preventDefault();
  e.stopPropagation();
  send(keyMsg("keydown", e));
}
function onKeyUp(e) {
  if (e.isComposing) return;
  if (skippedKeys.delete(e.code)) return;
  e.preventDefault();
  e.stopPropagation();
  send(keyMsg("keyup", e));
}
function onPaste(e) {
  e.preventDefault();
  const text = e.clipboardData.getData("text");
  if (text) send({ type: "text", text });
}
overlay.addEventListener("keydown", onKeyDown);
overlay.addEventListener("keyup", onKeyUp);
overlay.addEventListener("paste", onPaste);

// --- Адресная строка -----------------------------------------------------------
urlInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { send({ type: "goto", url: urlInput.value.trim() }); overlay.focus(); } });
$("back").onclick = () => send({ type: "back" });
$("forward").onclick = () => send({ type: "forward" });
$("reload").onclick = () => send({ type: "reload" });

connect();
