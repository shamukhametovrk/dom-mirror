// @ts-check
// Одна вкладка Chrome: своя CDP-сессия, навигация и события document/url.
import { EventEmitter } from "node:events";
import { attachToTarget } from "../cdp/session.js";

/** @typedef {import("../cdp/connection.js").CdpConnection} CdpConnection */
/** @typedef {import("../cdp/session.js").CdpSession} CdpSession */
/** @typedef {Awaited<ReturnType<typeof createTab>>} Tab */

/** @param {CdpSession} session @param {number} delta */
async function stepHistory(session, delta) {
  const { entries, currentIndex } = await session.send("Page.getNavigationHistory");
  const entry = entries[currentIndex + delta];
  if (entry) await session.send("Page.navigateToHistoryEntry", { entryId: entry.id });
}

/** @param {CdpSession} session @param {{ frameId: string, url: string }} state @param {EventEmitter} events */
function trackNavigation(session, state, events) {
  session.on("Page.frameNavigated", ({ frame }) => {
    if (frame.parentId) return;
    state.frameId = frame.id;
    state.url = frame.url + (frame.urlFragment ?? "");
    events.emit("document", state.url);
  });
  session.on("Page.navigatedWithinDocument", ({ frameId, url }) => {
    if (frameId !== state.frameId) return;
    state.url = url;
    events.emit("url", url);
  });
}

// Размер меняем настоящим окном, а не эмуляцией, чтобы innerWidth/outerWidth оставались правдоподобными.
// Browser.setContentsSize задаёт область страницы, а рамку окна Chrome считает сам: замер innerHeight
// ненадёжен — только что показанная вкладка ещё отдаёт старый размер.
/** @param {CdpConnection} cdp @param {string} targetId @param {{ width: number, height: number }} size */
async function resizeWindow(cdp, targetId, { width, height }) {
  const { windowId } = await cdp.send("Browser.getWindowForTarget", { targetId });
  await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
  await cdp.send("Browser.setContentsSize", { windowId, width, height });
}

/** @param {{ cdp: CdpConnection, targetId: string }} deps */
export async function createTab({ cdp, targetId }) {
  const session = await attachToTarget(cdp, targetId);
  const events = new EventEmitter();
  await session.send("Page.enable");
  const { frame } = (await session.send("Page.getFrameTree")).frameTree;
  const state = { frameId: frame.id, url: frame.url + (frame.urlFragment ?? "") };
  trackNavigation(session, state, events);

  /** @param {string} expression */
  const evaluate = async (expression) => (await session.send("Runtime.evaluate", { expression, returnByValue: true })).result.value;
  return {
    targetId,
    session,
    events,
    evaluate,
    get frameId() { return state.frameId; },
    get url() { return state.url; },
    navigate: (/** @type {string} */ url) => session.send("Page.navigate", { url }),
    reload: () => session.send("Page.reload"),
    back: () => stepHistory(session, -1),
    resize: (/** @type {number} */ width, /** @type {number} */ height) => resizeWindow(cdp, targetId, { width, height }),
    // тема как у браузера клиента: копия берёт prefers-color-scheme у него, страница на сервере должна совпадать
    setColorScheme: (/** @type {boolean} */ dark) => session.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }],
    }),
    setFocused: (/** @type {boolean} */ enabled) => session.send("Emulation.setFocusEmulationEnabled", { enabled }).catch(() => {}),
  };
}
