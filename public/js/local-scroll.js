// @ts-check
// Копия прокручивается сама, сразу по колесу, а сервер её догоняет: каждый шаг локальной анимации уходит
// на сервер настоящим колесом (raw — без серверной анимации), страница видит обычные wheel и scroll.
// Пока копия ведёт прокрутку элемента, эхо его позиции от сервера игнорируется. В конце жеста сервер
// выравнивается под копию (scrollTo). Если сервер так и не встал туда же, через ECHO_TIMEOUT_MS
// копия принимает позицию сервера — клики должны попадать в одно и то же место.
// То, что копия прокрутить не может (карта, canvas, страница с overflow: hidden), уходит на сервер как раньше.
import { createSmoothWheel, isNotch } from "../../shared/smooth-wheel.js";

/** @typedef {import("../../shared/protocol.js").ClientMessage} ClientMessage */
/** @typedef {{ x: number, y: number, mod: number, dx: number, dy: number }} Wheel */
/** @typedef {{ id: number, x: number, y: number }} ScrollData */
/** @typedef {Window | Element} Scroller */
/** @typedef {{ scroller: Scroller, node: Node }} Target */
/** @typedef {{ settling: boolean, latest: ScrollData | null, timer: number }} Ownership */

const GESTURE_END_MS = 150;
const ECHO_TIMEOUT_MS = 3000;
const MATCH_PX = 1;
const SCROLLABLE = /(auto|scroll|overlay)/;

/** @param {number} position @param {number} max @param {number} delta */
export const hasRoom = (position, max, delta) => (delta > 0 ? position < max - 0.5 : delta < 0 && position > 0.5);

/** @param {Element} el @param {"X" | "Y"} axis */
const overflows = (el, axis) => SCROLLABLE.test(el.ownerDocument.defaultView.getComputedStyle(el)[`overflow${axis}`]);

/** @param {Element} el @param {Wheel} w */
const elementCanScroll = (el, w) =>
  (overflows(el, "Y") && hasRoom(el.scrollTop, el.scrollHeight - el.clientHeight, w.dy))
  || (overflows(el, "X") && hasRoom(el.scrollLeft, el.scrollWidth - el.clientWidth, w.dx));

/** @param {Document} doc */
const rootLocked = (doc) => [doc.body, doc.scrollingElement]
  .some((el) => el && doc.defaultView.getComputedStyle(el).overflow === "hidden");

/** @param {Document} doc @param {Wheel} w */
function rootCanScroll(doc, w) {
  const root = doc.scrollingElement;
  return Boolean(root) && !rootLocked(doc) && (hasRoom(root.scrollTop, root.scrollHeight - root.clientHeight, w.dy)
    || hasRoom(root.scrollLeft, root.scrollWidth - root.clientWidth, w.dx));
}

/** @param {Document} doc @param {Wheel} w @returns {Element | null} */
function scrollableAncestor(doc, w) {
  const stop = new Set([doc.scrollingElement, doc.body]);
  for (let el = doc.elementFromPoint(w.x, w.y); el && !stop.has(el); el = el.parentElement) {
    if (elementCanScroll(el, w)) return el;
  }
  return null;
}

/** Ближайший прокручиваемый элемент под курсором, как у Chrome; null — копия прокрутить не может. */
/** @param {Document} doc @param {Wheel} w @returns {Target | null} */
export function scrollTargetAt(doc, w) {
  const el = scrollableAncestor(doc, w);
  if (el) return { scroller: el, node: el };
  return rootCanScroll(doc, w) ? { scroller: doc.defaultView, node: doc } : null;
}

/** @param {Scroller} s */
export const positionOf = (s) => ("scrollX" in s ? { x: s.scrollX, y: s.scrollY } : { x: s.scrollLeft, y: s.scrollTop });

/** @param {Scroller} s @param {ScrollData} data */
const matches = (s, data) => {
  const p = positionOf(s);
  return Math.abs(p.x - data.x) <= MATCH_PX && Math.abs(p.y - data.y) <= MATCH_PX;
};

/** @param {Map<Scroller, Ownership>} owned @param {Scroller} scroller */
const release = (owned, scroller) => {
  clearTimeout(owned.get(scroller)?.timer);
  owned.delete(scroller);
};

/** @param {Map<Scroller, Ownership>} owned @param {Scroller} scroller @param {(s: Scroller, d: ScrollData) => void} adopt */
const giveUp = (owned, scroller, adopt) => {
  const latest = owned.get(scroller)?.latest;
  release(owned, scroller);
  if (latest && !matches(scroller, latest)) adopt(scroller, latest);
};

/** Чьи позиции сейчас ведёт копия и что делать с эхом сервера. */
/** @param {(scroller: Scroller, data: ScrollData) => void} adopt */
function createOwnership(adopt) {
  /** @type {Map<Scroller, Ownership>} */
  const owned = new Map();
  const settle = (scroller) => {
    const own = owned.get(scroller);
    if (own) Object.assign(own, { settling: true, timer: window.setTimeout(() => giveUp(owned, scroller, adopt), ECHO_TIMEOUT_MS) });
  };
  return {
    settle,
    lead(scroller) {
      release(owned, scroller);
      owned.set(scroller, { settling: false, latest: null, timer: 0 });
    },
    /** true — позицию от сервера не применять. @param {Scroller} scroller @param {ScrollData} data */
    ignores(scroller, data) {
      const own = owned.get(scroller);
      if (!own) return false;
      own.latest = data;
      if (own.settling && matches(scroller, data)) release(owned, scroller);
      return true;
    },
    clear: () => [...owned.keys()].forEach((s) => release(owned, s)),
  };
}

// Браузеры по-разному округляют дробную прокрутку, и копия с сервером расходились на пиксель.
// Поэтому обе стороны прокручиваются только на целые пиксели: шаг — это округлённый накопленный путь
// минус уже пройденный, так что дробные остатки не теряются и последний пиксель не отстаёт.
export function createPixelCarry() {
  const ideal = { dx: 0, dy: 0 };
  const done = { dx: 0, dy: 0 };
  const advance = (axis, delta) => {
    ideal[axis] += delta;
    const whole = Math.round(ideal[axis]) - done[axis];
    done[axis] += whole;
    return whole;
  };
  return {
    /** @param {{ dx: number, dy: number }} delta */
    take: (delta) => ({ dx: advance("dx", delta.dx), dy: advance("dy", delta.dy) }),
  };
}

/** @param {any} replayer @param {(msg: ClientMessage) => void} send @param {Target} target */
function sendPosition(replayer, send, target) {
  const id = replayer.getMirror().getId(target.node);
  const { x, y } = positionOf(target.scroller);
  if (id > 0) send({ type: "scrollTo", id, x, y });
}

/** Текущий жест: шаг прокручивает копию и уходит на сервер; в конце жеста — выравнивание сервера. */
/** @param {{ getReplayer: () => any, send: (msg: ClientMessage) => void, ownership: ReturnType<typeof createOwnership> }} deps */
function createGesture({ getReplayer, send, ownership }) {
  const state = { target: /** @type {Target | null} */ (null), point: { x: 0, y: 0, mod: 0 }, timer: 0, busy: () => false };
  const sync = () => sendPosition(getReplayer(), send, state.target);
  const finish = () => {
    if (state.busy()) return restart();
    state.timer = 0;
    sync();
    ownership.settle(state.target.scroller);
  };
  const restart = () => {
    clearTimeout(state.timer);
    state.timer = window.setTimeout(finish, GESTURE_END_MS);
  };
  const pixels = createPixelCarry();
  /** @param {{ dx: number, dy: number }} delta */
  const step = (delta) => {
    const { dx, dy } = pixels.take(delta);
    if (!dx && !dy) return;
    state.target.scroller.scrollBy({ left: dx, top: dy, behavior: "instant" });
    send({ type: "wheel", ...state.point, dx, dy, raw: true });
    restart();
  };
  /** Клик посреди прокрутки: сервер сразу встаёт туда, где копия. */
  const syncIfActive = () => state.timer && sync();
  return { state, step, syncIfActive };
}

/** @param {any} replayer @param {Wheel} wheel */
const findTarget = (replayer, wheel) => {
  const doc = replayer?.iframe?.contentDocument;
  return doc ? scrollTargetAt(doc, wheel) : null;
};

/** @param {{ getReplayer: () => any, send: (msg: ClientMessage) => void, adopt: (scroller: Scroller, data: ScrollData) => void }} deps */
export function createLocalScroll({ getReplayer, send, adopt }) {
  const ownership = createOwnership(adopt);
  const gesture = createGesture({ getReplayer, send, ownership });
  const animator = createSmoothWheel(gesture.step, (tick) => requestAnimationFrame(tick));
  gesture.state.busy = () => animator.running;
  const ctx = { gesture, animator, ownership };
  return {
    flush() {
      flushAnimation(ctx);
      gesture.syncIfActive();
    },
    ignores: ownership.ignores,
    /** true — прокручено локально; false — пусть колесо обработает сервер. @param {Wheel} wheel */
    handle(wheel) {
      const next = findTarget(getReplayer(), wheel);
      if (next) continueGesture(ctx, next, wheel);
      return Boolean(next);
    },
    reset() {
      animator.takeRemaining();
      ownership.clear();
      gesture.state.target = null;
    },
  };
}

/** @typedef {{ gesture: ReturnType<typeof createGesture>, animator: ReturnType<typeof createSmoothWheel>, ownership: ReturnType<typeof createOwnership> }} Context */

/** Остаток анимации — сразу одним шагом (перед кликом или сменой элемента). @param {Context} ctx */
function flushAnimation({ gesture, animator }) {
  const rest = animator.takeRemaining();
  if (rest.dx || rest.dy) gesture.step(rest);
}

/** @param {Context} ctx @param {Target} next @param {Wheel} wheel */
function continueGesture(ctx, next, wheel) {
  const { gesture, animator, ownership } = ctx;
  if (gesture.state.target?.scroller !== next.scroller) flushAnimation(ctx);
  Object.assign(gesture.state, { target: next, point: { x: wheel.x, y: wheel.y, mod: wheel.mod } });
  ownership.lead(next.scroller);
  const delta = { dx: wheel.dx, dy: wheel.dy };
  if (animator.running || isNotch(delta)) animator.add(delta);
  else gesture.step(delta);
}
