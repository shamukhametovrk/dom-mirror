// @ts-check

/** @typedef {import("../../shared/protocol.js").ClientMessage} ClientMessage */
/** @typedef {(msg: ClientMessage) => void} Send */

const BUTTONS = /** @type {const} */ (["left", "middle", "right"]);
const MOVE_INTERVAL_MS = 16;
const LINE_HEIGHT_PX = 16;

/** Alt=1, Ctrl=2, Meta=4, Shift=8 — как в CDP. @param {MouseEvent} e */
const modifierMask = (e) => (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);

// Ход мыши ~60 раз в секунду; последнюю позицию досылаем обязательно, иначе :hover «залипает».
/** @param {Send} send */
function createMoveThrottle(send) {
  let last = 0;
  let timer = 0;
  let pending = null;
  const flush = () => {
    clearTimeout(timer);
    timer = 0;
    if (!pending) return;
    send(pending);
    pending = null;
    last = Date.now();
  };
  const queue = (msg) => {
    pending = msg;
    const wait = MOVE_INTERVAL_MS - (Date.now() - last);
    if (wait <= 0) flush();
    else timer ||= window.setTimeout(flush, wait);
  };
  return { queue, flush };
}

/** @param {HTMLElement} overlay */
const positionIn = (overlay) => (/** @type {MouseEvent} */ e) => {
  const r = overlay.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top, mod: modifierMask(e) };
};

/**
 * onWheel возвращает true, если копия прокрутила сама; иначе колесо уходит на сервер.
 * @param {HTMLElement} overlay @param {Send} send
 * @param {{ onPress: (e: MouseEvent) => void, onWheel: (wheel: import("./local-scroll.js").Wheel) => boolean }} hooks
 */
export function bindMouse(overlay, send, { onPress, onWheel }) {
  const position = positionIn(overlay);
  const buttonMessage = (type, e) => ({ type, ...position(e), button: BUTTONS[e.button] ?? "left", count: e.detail || 1 });
  const moves = createMoveThrottle(send);
  const held = new Set();

  overlay.addEventListener("mousedown", (e) => {
    e.preventDefault();
    onPress(e);
    moves.flush();
    held.add(e.button);
    send(buttonMessage("down", e));
  });
  // отпускание ловим на всём окне: кнопка не должна остаться зажатой на сервере
  window.addEventListener("mouseup", (e) => {
    if (!held.delete(e.button)) return;
    moves.flush();
    send(buttonMessage("up", e));
  }, true);
  window.addEventListener("mousemove", (e) => (held.size || e.target === overlay) && moves.queue({ type: "move", ...position(e) }));
  bindWheel(overlay, position, (wheel, e) => {
    if (!e.ctrlKey && onWheel(wheel)) return;   // Ctrl+колесо — масштаб на сервере
    send({ type: "wheel", ...wheel });
  });
}

/**
 * @param {HTMLElement} overlay @param {(e: MouseEvent) => { x: number, y: number, mod: number }} position
 * @param {(wheel: import("./local-scroll.js").Wheel, e: WheelEvent) => void} onWheel
 */
function bindWheel(overlay, position, onWheel) {
  const scale = (e) => [1, LINE_HEIGHT_PX, overlay.clientHeight][e.deltaMode] ?? 1;
  overlay.addEventListener("contextmenu", (e) => e.preventDefault());
  overlay.addEventListener("wheel", (e) => {
    e.preventDefault();
    onWheel({ ...position(e), dx: e.deltaX * scale(e), dy: e.deltaY * scale(e) }, e);
  }, { passive: false });
}
