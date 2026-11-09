// @ts-check

/** @param {number} ms */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Очередь задач, выполняемых строго по одной.
 * @returns {<T>(task: () => Promise<T>) => Promise<T>}
 */
export function createSerialQueue() {
  /** @type {Promise<unknown>} */
  let tail = Promise.resolve();
  return (task) => {
    const run = tail.then(task);
    tail = run.catch(() => {});
    return run;
  };
}

/**
 * Повторяет задачу с паузой между запусками; запуски не перекрываются.
 * @param {string} name @param {number} intervalMs @param {() => unknown} task
 */
export async function repeat(name, intervalMs, task) {
  for (;;) {
    try { await task(); } catch (e) { console.error(`${name}:`, e.message); }
    await sleep(intervalMs);
  }
}

export function createActivity() {
  let last = 0;
  return {
    touch: () => { last = Date.now(); },
    idleFor: () => Date.now() - last,
  };
}

/** @typedef {ReturnType<typeof createActivity>} Activity */
