// @ts-check
// Навигация, вкладки и файлы выполняются сразу, ввод — строго по очереди, чтобы нажатия не перемешивались.
import { isImmediate } from "../../shared/protocol.js";
import { normalizeUrl } from "../browser/input.js";

/** @typedef {import("../../shared/protocol.js").ClientMessage} ClientMessage */
/** @typedef {import("../../shared/protocol.js").InputMessage} InputMessage */

const MAX_VIEWPORT = { w: 3840, h: 2160 };
const MIN_VIEWPORT_SIDE = 100;

/** @param {number} value @param {number} max */
const clampSide = (value, max) => Math.min(max, Math.max(MIN_VIEWPORT_SIDE, Math.round(value)));

/** id загрузок в сообщении заменяются путями на сервере. @param {InputMessage} msg @param {(ids: string[]) => string[]} paths */
const withPaths = (msg, paths) => (msg.type === "drop" ? { ...msg, files: paths(msg.files) } : msg);

/**
 * @param {{
 *   tab: import("../browser/active-tab.js").ActiveTab["tab"],
 *   tabs: Pick<import("../browser/tabs.js").Tabs, "activate" | "close">,
 *   input: (msg: InputMessage) => Promise<unknown>,
 *   serial: <T>(task: () => Promise<T>) => Promise<T>,
 *   files: { paths: (ids: string[]) => string[], attach: (chooser: string, paths: string[]) => Promise<void> },
 * }} deps
 */
export function createCommandHandler({ tab, tabs, input, serial, files }) {
  const immediate = {
    viewport: (msg) => tab.resize(clampSide(msg.w, MAX_VIEWPORT.w), clampSide(msg.h, MAX_VIEWPORT.h)),
    goto: (msg) => tab.navigate(normalizeUrl(msg.url)),
    back: () => tab.back(),
    reload: () => tab.reload(),
    tabSwitch: (msg) => tabs.activate(msg.id),
    tabClose: (msg) => tabs.close(msg.id),
    attach: (msg) => files.attach(msg.chooser, files.paths(msg.files)),
  };
  return (/** @type {ClientMessage} */ msg) => {
    const task = isImmediate(msg) ? immediate[msg.type](msg) : serial(() => input(withPaths(msg, files.paths)));
    Promise.resolve(task).catch((e) => console.error(msg.type, e.message));
  };
}
