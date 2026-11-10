// @ts-check
// Настоящий ввод через Input.*: события в странице доверенные. Время и паузы задаёт сам пользователь.
import { buttonBit, heldButton, keyEventParams, mouseModifiers } from "./input.js";
import { createSmoothWheel, isNotch } from "../../shared/smooth-wheel.js";

/** @typedef {import("../../shared/protocol.js").InputMessage} InputMessage */
/** @typedef {import("../cdp/session.js").CdpSession} CdpSession */
/** @typedef {import("./world.js").World} World */

const DELETE_KEY = { key: "Delete", code: "Delete", windowsVirtualKeyCode: 46, nativeVirtualKeyCode: 46 };

/** @param {number} id */
const focusNodeExpression = (id) => `(() => {
  const el = window.rrweb && window.rrweb.record.mirror.getNode(${id | 0});
  if (!el) return false;
  el.focus();
  if (el.select) el.select();
  return true;
})()`;

const CTRL = 2;

/** @param {number} id @param {number} x @param {number} y */
const scrollToExpression = (id, x, y) => `(() => {
  const node = window.rrweb && window.rrweb.record.mirror.getNode(${id | 0});
  const target = node && node.nodeType === Node.DOCUMENT_NODE ? node.defaultView : node;
  if (target && target.scrollTo) target.scrollTo({ left: ${Number(x)}, top: ${Number(y)}, behavior: "instant" });
})()`;

/** @typedef {(type: string, extra: object) => Promise<unknown>} MouseDispatch */

// Шаги колеса не ждут подтверждения: Chrome подтверждает колесо только на следующем кадре, и общая очередь
// ввода копила бы задержку. Порядок с кликами сохраняется: команды уходят в Chrome по одному соединению.
// raw — шаг уже разложен копией (она прокручивается сама), анимировать не нужно. Ctrl+колесо — масштаб.
/** @param {MouseDispatch} dispatch */
function createWheel(dispatch) {
  let modifiers = 0;
  const inflight = new Set();
  const send = (dx, dy, mods) => {
    const sent = dispatch("mouseWheel", { deltaX: dx, deltaY: dy, modifiers: mods }).catch(() => {});
    inflight.add(sent);
    sent.finally(() => inflight.delete(sent));
  };
  const smooth = createSmoothWheel((step) => send(step.dx, step.dy, modifiers));
  const shouldAnimate = (msg) => !msg.raw && !(mouseModifiers(msg) & CTRL) && (smooth.running || isNotch({ dx: msg.dx, dy: msg.dy }));
  const wheel = (msg) => {
    if (!shouldAnimate(msg)) return send(msg.dx, msg.dy, mouseModifiers(msg));
    modifiers = mouseModifiers(msg);
    smooth.add({ dx: msg.dx, dy: msg.dy });
  };
  /** Все отправленные шаги колеса Chrome уже применил. */
  const settled = () => Promise.allSettled([...inflight]);
  return { wheel, settled };
}

/** @param {CdpSession} session @param {World} world */
function createMouse(session, world) {
  const state = { x: 0, y: 0, buttons: 0 };
  const dispatch = (type, extra) => session.send("Input.dispatchMouseEvent", {
    type, x: state.x, y: state.y, buttons: state.buttons, ...extra,
  });
  const moveTo = async (msg) => {
    if (msg.x === state.x && msg.y === state.y) return;
    Object.assign(state, { x: msg.x, y: msg.y });
    await dispatch("mouseMoved", { button: heldButton(state.buttons), modifiers: mouseModifiers(msg) });
  };
  const button = (type, toggle) => async (msg) => {
    await moveTo(msg);
    state.buttons = toggle(state.buttons, buttonBit(msg.button));
    return dispatch(type, { button: msg.button, clickCount: msg.count, modifiers: mouseModifiers(msg) });
  };
  const { wheel, settled } = createWheel(dispatch);
  return {
    move: moveTo,
    down: button("mousePressed", (buttons, bit) => buttons | bit),
    up: button("mouseReleased", (buttons, bit) => buttons & ~bit),
    wheel: (msg) => moveTo(msg).then(() => wheel(msg)),
    scrollTo: createScrollTo(world, settled),
  };
}

// Позиция, которую видит копия (конец жеста или клик посреди прокрутки). Сначала дожидаемся, пока Chrome
// применит отправленные шаги колеса, иначе они докрутят страницу сверх; клик идёт следом по той же очереди.
/** @param {World} world @param {() => Promise<unknown>} settled */
const createScrollTo = (world, settled) => async (msg) => {
  await settled();
  return world.evaluate(scrollToExpression(msg.id, msg.x, msg.y));
};

// Значение появилось в поле копии в обход клавиш (автозаполнение, IME): фокус ставим в мире агента,
// а само значение вводим настоящим вводом, чтобы страница получила обычные события input.
/** @param {CdpSession} session @param {World} world */
function createFill(session, world) {
  const clear = async () => {
    await session.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...DELETE_KEY });
    return session.send("Input.dispatchKeyEvent", { type: "keyUp", ...DELETE_KEY });
  };
  return async (msg) => {
    if (!(await world.evaluate(focusNodeExpression(msg.id)))) return;
    return msg.value === "" ? clear() : session.send("Input.insertText", { text: msg.value });
  };
}

const DRAG_COPY = 1;

// Файлы, брошенные на страницу (или вставленные из буфера): настоящее перетаскивание с путями на сервере.
/** @param {CdpSession} session */
const createDrop = (session) => async (msg) => {
  if (!msg.files.length) return;
  const data = { items: [], files: msg.files, dragOperationsMask: DRAG_COPY };
  for (const type of ["dragEnter", "dragOver", "drop"]) await session.send("Input.dispatchDragEvent", { type, x: msg.x, y: msg.y, data });
};

/** @param {{ session: CdpSession, world: World }} deps @returns {(msg: InputMessage) => Promise<unknown>} */
export function createInputDispatcher({ session, world }) {
  const key = (type) => (msg) => {
    const params = keyEventParams(msg, type);
    return params && session.send("Input.dispatchKeyEvent", params);
  };
  const handlers = {
    ...createMouse(session, world),
    keydown: key("keyDown"),
    keyup: key("keyUp"),
    text: (msg) => session.send("Input.insertText", { text: msg.text }),
    fill: createFill(session, world),
    drop: createDrop(session),
  };
  return async (msg) => handlers[msg.type](msg);
}
