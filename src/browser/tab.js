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
/** @param {{ cdp: CdpConnection, targetId: string, evaluate: (e: string) => Promise<any> }} ctx */
async function resizeWindow({ cdp, targetId, evaluate }, width, height) {
  const { windowId } = await cdp.send("Browser.getWindowForTarget", { targetId });
  await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
  const chrome = await evaluate("({ w: outerWidth - innerWidth, h: outerHeight - innerHeight })");
  const bounds = { left: 0, top: 0, width: width + chrome.w, height: height + chrome.h };
  await cdp.send("Browser.setWindowBounds", { windowId, bounds });
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
    forward: () => stepHistory(session, 1),
    resize: (width, height) => resizeWindow({ cdp, targetId, evaluate }, width, height),
  };
}
