// @ts-check
// Колесо через CDP Chrome считает «точной» прокруткой, как с тачпада: щелчок в 100 px — один прыжок за кадр,
// и копия повторяет эти прыжки. Поэтому щелчок разбиваем на шаги по кадрам с замедлением к концу, как это
// делает сам Chrome с настоящей мышью. Новые щелчки во время анимации добавляются к оставшемуся пути.
// Шаги идут по таймеру, не дожидаясь подтверждения: Chrome подтверждает колесо только на следующем кадре,
// и ожидание делало шаг через кадр. Размер шага — по прошедшему времени, поэтому поздний тик не замедляет ход.

/** @typedef {{ dx: number, dy: number }} Delta */

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

/** @param {(step: Delta) => Promise<unknown>} sendStep */
export function createSmoothWheel(sendStep) {
  const remaining = { dx: 0, dy: 0 };
  let timer = null;
  let lastTick = 0;

  const tick = () => {
    const now = performance.now();
    const step = nextStep(remaining, now - lastTick);
    lastTick = now;
    remaining.dx -= step.dx;
    remaining.dy -= step.dy;
    sendStep(step).catch(() => {});
    timer = remaining.dx || remaining.dy ? setTimeout(tick, TICK_MS) : null;
  };

  return {
    get running() { return timer !== null; },
    /** @param {Delta} delta */
    add(delta) {
      remaining.dx += delta.dx;
      remaining.dy += delta.dy;
      if (timer !== null) return;
      lastTick = performance.now() - TICK_MS;
      tick();
    },
  };
}
