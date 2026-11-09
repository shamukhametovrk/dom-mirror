// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTabs, MAX_TABS, onlyWhenActive } from "../src/browser/tabs.js";
import { sleep } from "../src/util/async.js";

/** Поддельный Chrome: вкладки-цели, сессии и события Target.* — как их шлёт настоящий. */
function createFakeChrome(initialPages = ["t1"]) {
  const listeners = new Map();
  const calls = [];
  let next = initialPages.length;
  const emit = (method, params) => (listeners.get(method) ?? []).forEach((fn) => fn(params, undefined));
  const page = (id, url = "about:blank") => ({ targetId: id, type: "page", url, title: "" });
  const later = (fn) => setTimeout(fn, 0);
  const responses = {
    "Target.getTargets": () => ({ targetInfos: initialPages.map((id) => page(id)) }),
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
const openTabs = async (chrome) => {
  const tabs = createTabs({ cdp: /** @type {any} */ (chrome.cdp), source: "", handlers: {}, startUrl: "https://start.test/" });
  await tabs.init();
  return tabs;
};
const activeIds = (tabs) => tabs.list().filter((t) => t.active).map((t) => t.id);
const snapshots = (chrome) => chrome.calls.filter((c) => c.method === "Runtime.evaluate" && c.params.expression.includes("takeFullSnapshot")).map((c) => c.sessionId);

test("при запуске подхватывает открытую вкладку и делает её активной", async () => {
  const chrome = createFakeChrome(["t1"]);
  const tabs = await openTabs(chrome);
  assert.deepEqual(tabs.list().map((t) => t.id), ["t1"]);
  assert.deepEqual(activeIds(tabs), ["t1"]);
  assert.deepEqual(snapshots(chrome), ["s-t1"]);
});

test("новая вкладка открывается и становится активной, копия берёт её снимок", async () => {
  const chrome = createFakeChrome(["t1"]);
  const tabs = await openTabs(chrome);
  await tabs.openNew();
  await settle();
  assert.deepEqual(tabs.list().map((t) => t.id), ["t1", "t2"]);
  assert.deepEqual(activeIds(tabs), ["t2"]);
  assert.ok(chrome.calls.some((c) => c.method === "Target.createTarget" && c.params.url === "https://start.test/"));
  assert.ok(chrome.calls.some((c) => c.method === "Target.activateTarget" && c.params.targetId === "t2"));
  assert.equal(snapshots(chrome).at(-1), "s-t2");
});

test("вкладку, открытую сайтом (window.open), подхватывает без закрытия", async () => {
  const chrome = createFakeChrome(["t1"]);
  const tabs = await openTabs(chrome);
  chrome.emit("Target.targetCreated", { targetInfo: chrome.page("popup", "https://login.test/") });
  await settle();
  assert.deepEqual(activeIds(tabs), ["popup"]);
  assert.ok(!chrome.calls.some((c) => c.method === "Target.closeTarget"));
});

test("закрыли активную — активна последняя оставшаяся; закрыли последнюю — открывается стартовая", async () => {
  const chrome = createFakeChrome(["t1"]);
  const tabs = await openTabs(chrome);
  await tabs.openNew();
  await settle();
  await tabs.close("t2");
  await settle();
  assert.deepEqual(tabs.list().map((t) => t.id), ["t1"]);
  assert.deepEqual(activeIds(tabs), ["t1"]);
  await tabs.close("t1");
  await settle();
  assert.equal(tabs.list().length, 1);
  assert.notEqual(tabs.list()[0].id, "t1");
  assert.equal(activeIds(tabs).length, 1);
});

test("сверх лимита вкладка, открытая сайтом, закрывается", async () => {
  const chrome = createFakeChrome(Array.from({ length: MAX_TABS }, (_, i) => `t${i + 1}`));
  const tabs = await openTabs(chrome);
  chrome.emit("Target.targetCreated", { targetInfo: chrome.page("extra") });
  await settle();
  assert.equal(tabs.list().length, MAX_TABS);
  assert.ok(chrome.calls.some((c) => c.method === "Target.closeTarget" && c.params.targetId === "extra"));
});

test("заголовок и адрес вкладки обновляются из Target.targetInfoChanged", async () => {
  const chrome = createFakeChrome(["t1"]);
  const tabs = await openTabs(chrome);
  chrome.emit("Target.targetInfoChanged", { targetInfo: { ...chrome.page("t1", "https://a.test/"), title: "Страница А" } });
  assert.deepEqual(tabs.list()[0], { id: "t1", title: "Страница А", url: "https://a.test/", active: true });
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

test("заголовки сверяются с Chrome, даже если он не прислал события", async () => {
  const chrome = createFakeChrome(["t1"]);
  const tabs = await openTabs(chrome);
  const originalSend = chrome.cdp.send;
  chrome.cdp.send = async (method, params, sessionId) => (method === "Target.getTargets"
    ? { targetInfos: [{ ...chrome.page("t1", "https://a.test/"), title: "Новый заголовок" }] }
    : originalSend(method, params, sessionId));
  await sleep(1100);
  assert.equal(tabs.list()[0].title, "Новый заголовок");
});
