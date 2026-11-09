// @ts-check
// Навигация и вкладки выполняются сразу, ввод — строго по очереди, чтобы нажатия не перемешивались.
import { isNavigation } from "../../shared/protocol.js";
import { normalizeUrl } from "../browser/input.js";

/** @typedef {import("../../shared/protocol.js").ClientMessage} ClientMessage */

const MAX_VIEWPORT = { w: 3840, h: 2160 };
const MIN_VIEWPORT_SIDE = 100;

/** @param {number} value @param {number} max */
const clampSide = (value, max) => Math.min(max, Math.max(MIN_VIEWPORT_SIDE, Math.round(value)));

/**
 * @param {{
 *   tab: import("../browser/active-tab.js").ActiveTab["tab"],
 *   tabs: Pick<import("../browser/tabs.js").Tabs, "openNew" | "activate" | "close">,
 *   input: (msg: import("../../shared/protocol.js").InputMessage) => Promise<unknown>,
 *   serial: <T>(task: () => Promise<T>) => Promise<T>,
 *   activity: import("../util/async.js").Activity,
 * }} deps
 */
export function createCommandHandler({ tab, tabs, input, serial, activity }) {
  const navigation = {
    viewport: (msg) => tab.resize(clampSide(msg.w, MAX_VIEWPORT.w), clampSide(msg.h, MAX_VIEWPORT.h)),
    goto: (msg) => tab.navigate(normalizeUrl(msg.url)),
    back: () => tab.back(),
    forward: () => tab.forward(),
    reload: () => tab.reload(),
    tabNew: () => tabs.openNew(),
    tabSwitch: (msg) => tabs.activate(msg.id),
    tabClose: (msg) => tabs.close(msg.id),
  };
  return (/** @type {ClientMessage} */ msg) => {
    activity.touch();
    const task = isNavigation(msg) ? navigation[msg.type](msg) : serial(() => input(msg));
    Promise.resolve(task).catch((e) => console.error(msg.type, e.message));
  };
}
