// @ts-check
// Делегаты «активной вкладки»: ввод, прокси ресурсов, снимки iframe и отладка работают как с одной вкладкой,
// а за ними — та, что активна сейчас.

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

/** @param {Tabs} tabs @param {() => import("./tabs.js").TabContext} ctx */
const tabDelegate = (tabs, ctx) => ({
  get url() { return tabs.active?.tab.url ?? ""; },
  get frameId() { return ctx().tab.frameId; },
  evaluate: (/** @type {string} */ expression) => ctx().tab.evaluate(expression),
  navigate: (/** @type {string} */ url) => ctx().tab.navigate(url),
  reload: () => ctx().tab.reload(),
  back: () => ctx().tab.back(),
  forward: () => ctx().tab.forward(),
  resize: (width, height) => ctx().tab.resize(width, height),
});

/** @typedef {ReturnType<typeof createActiveTab>} ActiveTab */
