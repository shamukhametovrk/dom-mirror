// @ts-check
// Домен Runtime не включён, поэтому событий из страницы нет: сервер сам забирает эту очередь.

export const DRAIN_GLOBAL = "__mirrorDrain";

/** @type {[string, string][]} */
const queue = [];

/** @param {string} name @param {string} payload */
export const post = (name, payload) => {
  queue.push([name, payload]);
};

/** @param {string} name */
export function changeReporter(name) {
  let last;
  return (/** @type {string} */ payload) => {
    if (payload === last) return;
    last = payload;
    post(name, payload);
  };
}

export function exposeQueue() {
  window[DRAIN_GLOBAL] = () => (queue.length ? queue.splice(0) : null);
}
