// @ts-check
// Полоса вкладок: постоянные вкладки сайтов и окна, которые открыл сам сайт (их можно закрыть).

/** @typedef {import("../../shared/protocol.js").ClientMessage} ClientMessage */
/** @typedef {import("../../shared/protocol.js").TabInfo} TabInfo */

/** @param {TabInfo} tab @param {(msg: ClientMessage) => void} send */
function closeButton(tab, send) {
  const close = document.createElement("button");
  close.className = "close";
  close.textContent = "×";
  close.title = "Закрыть окно";
  close.addEventListener("click", (e) => { e.stopPropagation(); send({ type: "tabClose", id: tab.id }); });
  return close;
}

/** @param {TabInfo} tab @param {(msg: ClientMessage) => void} send */
function renderTab(tab, send) {
  const el = document.createElement("div");
  el.className = tab.active ? "tab active" : "tab";
  el.title = tab.url;
  const title = el.appendChild(document.createElement("span"));
  title.className = "title";
  title.textContent = tab.title || tab.url || "Окно";
  if (!tab.pinned) el.appendChild(closeButton(tab, send));
  el.addEventListener("click", () => tab.active || send({ type: "tabSwitch", id: tab.id }));
  return el;
}

/** @param {HTMLElement} strip @param {(msg: ClientMessage) => void} send @param {() => void} afterAction */
export function createTabStrip(strip, send, afterAction) {
  /** @param {ClientMessage} msg */
  const act = (msg) => {
    send(msg);
    afterAction();
  };
  return (/** @type {TabInfo[]} */ tabs) => strip.replaceChildren(...tabs.map((tab) => renderTab(tab, act)));
}
