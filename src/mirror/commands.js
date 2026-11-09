// @ts-check
// Навигация выполняется сразу, ввод — строго по очереди, чтобы нажатия не перемешивались.
import { isNavigation } from "../../shared/protocol.js";
import { normalizeUrl } from "../browser/input.js";

/** @typedef {import("../../shared/protocol.js").ClientMessage} ClientMessage */

const MAX_VIEWPORT = { w: 3840, h: 2160 };
const MIN_VIEWPORT_SIDE = 100;

/** @param {number} value @param {number} max */
const clampSide = (value, max) => Math.min(max, Math.max(MIN_VIEWPORT_SIDE, Math.round(value)));

/**
 * @param {{
 *   tab: import("../browser/tab.js").Tab,
 *   input: (msg: import("../../shared/protocol.js").InputMessage) => Promise<unknown>,
 *   serial: <T>(task: () => Promise<T>) => Promise<T>,
 *   activity: import("../util/async.js").Activity,
 * }} deps
 */
export function createCommandHandler({ tab, input, serial, activity }) {
  const navigation = {
    viewport: (msg) => tab.resize(clampSide(msg.w, MAX_VIEWPORT.w), clampSide(msg.h, MAX_VIEWPORT.h)),
    goto: (msg) => tab.navigate(normalizeUrl(msg.url)),
    back: () => tab.back(),
    forward: () => tab.forward(),
    reload: () => tab.reload(),
  };
  return (/** @type {ClientMessage} */ msg) => {
    activity.touch();
    const task = isNavigation(msg) ? navigation[msg.type](msg) : serial(() => input(msg));
    task.catch((e) => console.error(msg.type, e.message));
  };
}
