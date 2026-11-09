// @ts-check
// Настоящий ввод через Input.*: события в странице доверенные. Время и паузы задаёт сам пользователь.
import { buttonBit, heldButton, keyEventParams, mouseModifiers } from "./input.js";
import { createSmoothWheel, isNotch } from "./smooth-wheel.js";

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

/** @typedef {(type: string, extra: object) => Promise<unknown>} MouseDispatch */

// Ctrl+колесо — масштаб страницы, его не анимируем. Шаги анимации идут мимо общей очереди ввода:
// подтверждения колеса приходят по кадру, и очередь накапливала бы задержку.
/** @param {MouseDispatch} dispatch */
function createWheel(dispatch) {
  let modifiers = 0;
  const smooth = createSmoothWheel((step) => dispatch("mouseWheel", { deltaX: step.dx, deltaY: step.dy, modifiers }));
  const shouldAnimate = (msg) => !(mouseModifiers(msg) & CTRL) && (smooth.running || isNotch({ dx: msg.dx, dy: msg.dy }));
  return (msg) => {
    if (!shouldAnimate(msg)) return dispatch("mouseWheel", { deltaX: msg.dx, deltaY: msg.dy, modifiers: mouseModifiers(msg) });
    modifiers = mouseModifiers(msg);
    smooth.add({ dx: msg.dx, dy: msg.dy });
  };
}

/** @param {CdpSession} session */
function createMouse(session) {
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
  const wheel = createWheel(dispatch);
  return {
    move: moveTo,
    down: button("mousePressed", (buttons, bit) => buttons | bit),
    up: button("mouseReleased", (buttons, bit) => buttons & ~bit),
    wheel: (msg) => moveTo(msg).then(() => wheel(msg)),
  };
}

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

/** @param {{ session: CdpSession, world: World }} deps @returns {(msg: InputMessage) => Promise<unknown>} */
export function createInputDispatcher({ session, world }) {
  const key = (type) => (msg) => {
    const params = keyEventParams(msg, type);
    return params && session.send("Input.dispatchKeyEvent", params);
  };
  const handlers = {
    ...createMouse(session),
    keydown: key("keyDown"),
    keyup: key("keyUp"),
    text: (msg) => session.send("Input.insertText", { text: msg.text }),
    fill: createFill(session, world),
  };
  return async (msg) => handlers[msg.type](msg);
}
