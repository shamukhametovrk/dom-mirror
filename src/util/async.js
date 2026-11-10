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
