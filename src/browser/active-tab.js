// @ts-check
// Делегаты «активной вкладки»: ввод, прокси ресурсов и отладка работают как с одной вкладкой,
// а за ними — та, что активна сейчас.

import { createSerialQueue } from "../util/async.js";

/** @typedef {import("./tabs.js").Tabs} Tabs */
/** @typedef {import("../cdp/session.js").CdpSession} CdpSession */

/** @param {Tabs} tabs */
export function createActiveTab(tabs) {
  const ctx = () => {
    if (!tabs.active) throw new Error("нет активной вкладки");
    return tabs.active;
  };
  /** @type {CdpSession} */
  const session = {
    send: (method, params) => ctx().tab.session.send(method, params),
    on: () => { throw new Error("подписка на события — только у конкретной вкладки"); },
  };
  return {
    session,
    world: { evaluate: (/** @type {string} */ expression) => ctx().world.evaluate(expression) },
    tracker: {
      lookup: (/** @type {string} */ href) => ctx().tracker.lookup(href),
      get size() { return tabs.active?.tracker.size ?? 0; },
    },
    input: (msg) => ctx().input(msg),
    tab: tabDelegate(tabs, ctx),
  };
}

/** @typedef {{ width: number, height: number, dark?: boolean }} ClientView */

/** @param {import("./tab.js").Tab} tab @param {ClientView} view */
async function applyView(tab, view) {
  await tab.resize(view.width, view.height);
  if (view.dark !== undefined) await tab.setColorScheme(view.dark);
}

// Размер и тему клиента запоминаем: после переключения вкладки окно и тема подгоняются заново.
// Подгонки идут по одной: размер клиента и переключение вкладки могут прийти одновременно.
/** @param {Tabs} tabs @param {() => import("./tabs.js").TabContext} ctx */
const tabDelegate = (tabs, ctx) => {
  /** @type {ClientView | null} */
  let view = null;
  const serial = createSerialQueue();
  const fit = () => serial(async () => view && applyView(ctx().tab, view));
  return {
    get url() { return tabs.active?.tab.url ?? ""; },
    get frameId() { return ctx().tab.frameId; },
    evaluate: (/** @type {string} */ expression) => ctx().tab.evaluate(expression),
    navigate: (/** @type {string} */ url) => ctx().tab.navigate(url),
    reload: () => ctx().tab.reload(),
    back: () => ctx().tab.back(),
    resize: (/** @type {ClientView} */ next) => {
      view = next;
      return fit();
    },
    refit: fit,
  };
};

/** @typedef {ReturnType<typeof createActiveTab>} ActiveTab */
