// @ts-check
// Содержимое iframe с чужого сайта rrweb не видит: сообщаем, где он на экране, сервер пришлёт картинку.
import { changeReporter } from "./channel.js";

const MIN_FRAME_SIDE = 20;
const SCAN_INTERVAL_MS = 300;

/** @param {HTMLIFrameElement} frame */
function isCrossOrigin(frame) {
  try {
    return !frame.contentDocument;
  } catch {
    return true;
  }
}

/** @param {HTMLIFrameElement} frame */
function isVisible(frame) {
  const style = getComputedStyle(frame);
  return style.visibility !== "hidden" && parseFloat(style.opacity) >= 0.05;
}

/** @param {HTMLIFrameElement} frame */
function visibleBox(frame) {
  const r = frame.getBoundingClientRect();
  const x = Math.max(0, r.left);
  const y = Math.max(0, r.top);
  const w = Math.min(innerWidth, r.right) - x;
  const h = Math.min(innerHeight, r.bottom) - y;
  return w < MIN_FRAME_SIDE || h < MIN_FRAME_SIDE ? null : { x, y, w, h };
}

/** @param {{ x: number, y: number, w: number, h: number }} box @param {number} id */
const frameRect = (box, id) => ({
  id, x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h),
  sx: Math.round(scrollX), sy: Math.round(scrollY),
});

function createFrameScanner() {
  const ids = new WeakMap();
  let nextId = 1;
  const idOf = (frame) => ids.get(frame) ?? ids.set(frame, nextId++).get(frame);
  const describe = (frame) => {
    const box = visibleBox(frame);
    return box && frameRect(box, idOf(frame));
  };
  return () => [...document.querySelectorAll("iframe")]
    .filter((frame) => isCrossOrigin(frame) && isVisible(frame))
    .map(describe)
    .filter(Boolean)
    .sort((a, b) => b.w * b.h - a.w * a.h);
}

export function watchFrames() {
  const scan = createFrameScanner();
  const report = changeReporter("frames");
  const update = () => report(JSON.stringify(scan()));
  setInterval(update, SCAN_INTERVAL_MS);
  addEventListener("scroll", update, true);
  addEventListener("resize", update);
}
