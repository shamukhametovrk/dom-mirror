// @ts-check
// Полоса вкладок. Вкладки живут на сервере (настоящие вкладки Chrome); здесь только список и команды.

/** @typedef {import("../../shared/protocol.js").ClientMessage} ClientMessage */
/** @typedef {import("../../shared/protocol.js").TabInfo} TabInfo */

const MIDDLE_BUTTON = 1;

/** @param {TabInfo} tab @param {(msg: ClientMessage) => void} send */
function renderTab(tab, send) {
  const el = document.createElement("div");
  el.className = tab.active ? "tab active" : "tab";
  el.title = tab.url;
  const title = el.appendChild(document.createElement("span"));
  title.className = "title";
  title.textContent = tab.title || tab.url || "Новая вкладка";
  const close = el.appendChild(document.createElement("button"));
  close.className = "close";
  close.textContent = "×";
  close.title = "Закрыть вкладку";
  const closeTab = () => send({ type: "tabClose", id: tab.id });
  close.addEventListener("click", (e) => { e.stopPropagation(); closeTab(); });
  el.addEventListener("click", () => tab.active || send({ type: "tabSwitch", id: tab.id }));
  el.addEventListener("auxclick", (e) => e.button === MIDDLE_BUTTON && closeTab());
  return el;
}

/** @param {HTMLElement} strip @param {(msg: ClientMessage) => void} send @param {() => void} afterAction */
export function createTabStrip(strip, send, afterAction) {
  const newTab = /** @type {HTMLElement} */ (strip.querySelector("#new-tab"));
  /** @param {ClientMessage} msg */
  const act = (msg) => {
    send(msg);
    afterAction();
  };
  newTab.addEventListener("click", () => act({ type: "tabNew" }));
  return (/** @type {TabInfo[]} */ tabs) => {
    for (const el of strip.querySelectorAll(".tab")) el.remove();
    for (const tab of tabs) strip.insertBefore(renderTab(tab, act), newTab);
  };
}
