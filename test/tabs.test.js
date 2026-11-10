// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTabs, MAX_POPUPS, onlyWhenActive } from "../src/browser/tabs.js";
import { parseSites, planSites } from "../src/browser/sites.js";
import { sleep } from "../src/util/async.js";

const SITES = parseSites("A=https://a.test/,B=https://b.test/,C=https://c.test/");

/** Поддельный Chrome: вкладки-цели, сессии и события Target.* — как их шлёт настоящий. */
function createFakeChrome(initial = [["t1", "about:blank"]]) {
  const listeners = new Map();
  const calls = [];
  let next = initial.length;
  const emit = (method, params) => (listeners.get(method) ?? []).forEach((fn) => fn(params, undefined));
  const page = (id, url = "about:blank", extra = {}) => ({ targetId: id, type: "page", url, title: "", ...extra });
  const later = (fn) => setTimeout(fn, 0);
  const responses = {
    "Target.getTargets": () => ({ targetInfos: initial.map(([id, url]) => page(id, url)) }),
    "Target.attachToTarget": ({ targetId }) => ({ sessionId: `s-${targetId}` }),
    "Page.getFrameTree": () => ({ frameTree: { frame: { id: "frame", url: "about:blank" } } }),
    "Page.createIsolatedWorld": () => ({ executionContextId: 1 }),
    // долгий опрос очереди агента «висит» — так цикл не держит тест таймерами
    "Runtime.evaluate": ({ expression }) => (expression.includes("__mirrorDrain(") ? new Promise(() => {}) : { result: { value: 0 } }),
    "Target.createTarget": ({ url }) => {
      const targetId = `t${++next}`;
      later(() => emit("Target.targetCreated", { targetInfo: page(targetId, url) }));
      return { targetId };
    },
    "Target.closeTarget": ({ targetId }) => later(() => emit("Target.targetDestroyed", { targetId })) && {},
  };
  return {
    calls,
    emit,
    page,
    cdp: {
      send: async (method, params = {}, sessionId) => {
        calls.push({ method, params, sessionId });
        return responses[method]?.(params) ?? {};
      },
      on: (method, fn) => listeners.set(method, [...(listeners.get(method) ?? []), fn]),
      onClose: () => {},
    },
  };
}

const settle = () => sleep(20);
const choosers = /** @type {any} */ ({ watch: async () => {} });
const openTabs = async (chrome) => {
  const tabs = createTabs({ cdp: /** @type {any} */ (chrome.cdp), source: "", handlers: {}, choosers, sites: SITES });
  await tabs.init();
  return tabs;
};
const activeIds = (tabs) => tabs.list().filter((t) => t.active).map((t) => t.id);
const titles = (tabs) => tabs.list().map((t) => t.title);
const sent = (chrome, method) => chrome.calls.filter((c) => c.method === method);
const snapshots = (chrome) => sent(chrome, "Runtime.evaluate").filter((c) => c.params.expression.includes("takeFullSnapshot")).map((c) => c.sessionId);
const focusCalls = (chrome) => sent(chrome, "Emulation.setFocusEmulationEnabled").map((c) => `${c.sessionId}:${c.params.enabled}`);

test("при запуске пустая вкладка уходит под первый сайт, остальные открываются; активен первый", async () => {
  const chrome = createFakeChrome();
  const tabs = await openTabs(chrome);
  assert.deepEqual(titles(tabs), ["A", "B", "C"]);
  assert.ok(tabs.list().every((t) => t.pinned));
  assert.deepEqual(activeIds(tabs), ["t1"]);
  assert.deepEqual(sent(chrome, "Page.navigate").map((c) => c.params.url), ["https://a.test/"]);
  assert.deepEqual(sent(chrome, "Target.createTarget").map((c) => c.params.url), ["https://b.test/", "https://c.test/"]);
  assert.deepEqual(snapshots(chrome), ["s-t1"]);
  assert.deepEqual(focusCalls(chrome), ["s-t1:true"]);
});

test("вкладки с прошлого запуска подхватываются по адресу, лишние закрываются", () => {
  const pages = [{ id: "x", url: "https://other.test/" }, { id: "c", url: "https://www.c.test/chat" }, { id: "y", url: "about:blank" }];
  const { claims, extra } = planSites(SITES, [...pages, { id: "z", url: "about:blank" }]);
  assert.deepEqual(claims.map((c) => [c.site.name, c.id, c.navigate]), [["A", "x", true], ["B", "y", true], ["C", "c", false]]);
  assert.deepEqual(extra, ["z"]);
});

test("переключение: эмуляция фокуса у новой вкладки, у прежней выключается, копия берёт снимок", async () => {
  const chrome = createFakeChrome();
  const tabs = await openTabs(chrome);
  const second = tabs.list()[1].id;
  await tabs.activate(second);
  assert.deepEqual(activeIds(tabs), [second]);
  assert.deepEqual(focusCalls(chrome).slice(1), ["s-t1:false", `s-${second}:true`]);
  assert.ok(sent(chrome, "Target.activateTarget").some((c) => c.params.targetId === second));
  assert.equal(snapshots(chrome).at(-1), `s-${second}`);
});

test("окно, открытое сайтом, становится активным; закрыли — возвращаемся туда, откуда открыли", async () => {
  const chrome = createFakeChrome();
  const tabs = await openTabs(chrome);
  const second = tabs.list()[1].id;
  await tabs.activate(second);
  chrome.emit("Target.targetCreated", { targetInfo: chrome.page("popup", "https://login.test/", { openerId: second }) });
  await settle();
  assert.deepEqual(activeIds(tabs), ["popup"]);
  assert.equal(tabs.list().at(-1).pinned, false);
  await tabs.close("popup");
  await settle();
  assert.equal(tabs.list().length, 3);
  assert.deepEqual(activeIds(tabs), [second]);
});

test("чужие вкладки без открывшего окна не подхватываются", async () => {
  const chrome = createFakeChrome();
  const tabs = await openTabs(chrome);
  chrome.emit("Target.targetCreated", { targetInfo: chrome.page("stray") });
  await settle();
  assert.equal(tabs.list().length, 3);
});

test("вкладку сайта закрыть нельзя; если её закрыл сам сайт — открывается заново", async () => {
  const chrome = createFakeChrome();
  const tabs = await openTabs(chrome);
  await tabs.close("t1");
  await settle();
  assert.equal(sent(chrome, "Target.closeTarget").length, 0);
  chrome.emit("Target.targetDestroyed", { targetId: "t1" });
  await settle();
  assert.deepEqual(titles(tabs), ["A", "B", "C"]);
  assert.notEqual(tabs.list()[0].id, "t1");
  assert.deepEqual(activeIds(tabs), [tabs.list()[0].id]);
});

test("сверх лимита окно, открытое сайтом, закрывается", async () => {
  const chrome = createFakeChrome();
  const tabs = await openTabs(chrome);
  for (let i = 0; i <= MAX_POPUPS; i++) chrome.emit("Target.targetCreated", { targetInfo: chrome.page(`p${i}`, "https://x.test/", { openerId: "t1" }) });
  await settle();
  assert.equal(tabs.list().length, 3 + MAX_POPUPS);
  assert.ok(sent(chrome, "Target.closeTarget").some((c) => c.params.targetId === `p${MAX_POPUPS}`));
});

test("сообщения агента фоновой вкладки отбрасываются", () => {
  const seen = [];
  let active = false;
  const handlers = onlyWhenActive(() => active, { emit: (p) => seen.push(p) });
  handlers.emit("фон");
  active = true;
  handlers.emit("активная");
  assert.deepEqual(seen, ["активная"]);
});

test("заголовок окна сверяется с Chrome; у вкладки сайта — имя сайта", async () => {
  const chrome = createFakeChrome();
  const tabs = await openTabs(chrome);
  chrome.emit("Target.targetCreated", { targetInfo: chrome.page("popup", "https://login.test/", { openerId: "t1" }) });
  await settle();
  const originalSend = chrome.cdp.send;
  chrome.cdp.send = async (method, params, sessionId) => (method === "Target.getTargets"
    ? { targetInfos: [{ ...chrome.page("popup", "https://login.test/"), title: "Вход" }, { ...chrome.page("t1", "https://a.test/"), title: "Чат" }] }
    : originalSend(method, params, sessionId));
  await sleep(1100);
  assert.deepEqual(titles(tabs), ["A", "B", "C", "Вход"]);
});

test("список сайтов: имя и адрес, или только адрес", () => {
  assert.deepEqual(parseSites(" Алиса=https://alice.yandex.ru/ , https://chatgpt.com/?a=b "), [
    { name: "Алиса", url: "https://alice.yandex.ru/", host: "alice.yandex.ru" },
    { name: "chatgpt.com", url: "https://chatgpt.com/?a=b", host: "chatgpt.com" },
  ]);
});
