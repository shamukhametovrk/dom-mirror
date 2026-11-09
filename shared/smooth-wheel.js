// @ts-check
// Плавный щелчок колеса: путь раскладывается на шаги по кадрам с замедлением к концу, как у Chrome с мышью.
// Используется и копией (локальная прокрутка), и сервером (колесо над тем, что копия прокрутить не может).
// Размер шага — по прошедшему времени, поэтому поздний тик не замедляет ход. Новые щелчки добавляются к пути.

/** @typedef {{ dx: number, dy: number }} Delta */
/** @typedef {(tick: () => void) => unknown} Schedule */
/** @typedef {{ remaining: Delta, running: boolean, lastTick: number }} WheelState */

export const NOTCH_MIN_PX = 40;
const TAU_MS = 37;   // за кадр (16 мс) проходится ~35% оставшегося пути
const TICK_MS = 16;
const SNAP_PX = 0.5;

/** @param {number} remaining @param {number} elapsedMs */
export const easedStep = (remaining, elapsedMs) =>
  (Math.abs(remaining) <= SNAP_PX ? remaining : remaining * (1 - Math.exp(-elapsedMs / TAU_MS)));

/** @param {Delta} remaining @param {number} elapsedMs @returns {Delta} */
export const nextStep = (remaining, elapsedMs) => ({ dx: easedStep(remaining.dx, elapsedMs), dy: easedStep(remaining.dy, elapsedMs) });

/** @param {Delta} delta */
export const isNotch = (delta) => Math.max(Math.abs(delta.dx), Math.abs(delta.dy)) >= NOTCH_MIN_PX;

/** @type {Schedule} */
const byTimer = (tick) => setTimeout(tick, TICK_MS);

/** @param {WheelState} state @param {(step: Delta) => unknown} sendStep @param {Schedule} schedule */
function createTick(state, sendStep, schedule) {
  const tick = () => {
    if (!state.running) return;
    const now = performance.now();
    const step = nextStep(state.remaining, now - state.lastTick);
    state.lastTick = now;
    state.remaining.dx -= step.dx;
    state.remaining.dy -= step.dy;
    state.running = Boolean(state.remaining.dx || state.remaining.dy);
    sendStep(step);
    if (state.running) schedule(tick);
  };
  return tick;
}

/** @param {(step: Delta) => unknown} sendStep @param {Schedule} [schedule] */
export function createSmoothWheel(sendStep, schedule = byTimer) {
  /** @type {WheelState} */
  const state = { remaining: { dx: 0, dy: 0 }, running: false, lastTick: 0 };
  const tick = createTick(state, sendStep, schedule);
  return {
    get running() { return state.running; },
    /** @param {Delta} delta */
    add(delta) {
      state.remaining.dx += delta.dx;
      state.remaining.dy += delta.dy;
      if (state.running) return;
      Object.assign(state, { running: true, lastTick: performance.now() - TICK_MS });
      tick();
    },
    /** Остаток пути одним куском; анимация останавливается. @returns {Delta} */
    takeRemaining() {
      const rest = { ...state.remaining };
      Object.assign(state, { remaining: { dx: 0, dy: 0 }, running: false });
      return rest;
    },
  };
}
