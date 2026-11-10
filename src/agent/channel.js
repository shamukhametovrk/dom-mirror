// @ts-check
// Домен Runtime не включён, поэтому событий из страницы нет. Сервер ждёт очередь long-poll'ом:
// обещание выполняется, как только в очереди что-то появилось (или по таймауту — пустым списком).

export const DRAIN_GLOBAL = "__mirrorDrain";

// При переключении вкладки сервер просит сообщить всё заново: сообщения фоновой вкладки он отбрасывал.
/** @type {(() => void)[]} */
const refreshers = [];
/** @param {() => void} fn */
export const onRefresh = (fn) => { refreshers.push(fn); };

/** @type {[string, string][]} */
const queue = [];
/** @type {(() => void) | null} */
let wakeWaiter = null;

/** @param {string} name @param {string} payload */
export const post = (name, payload) => {
  queue.push([name, payload]);
  wakeWaiter?.();
};

/** @param {string} name */
export function changeReporter(name) {
  let last;
  onRefresh(() => { last = undefined; });
  return (/** @type {string} */ payload) => {
    if (payload === last) return;
    last = payload;
    post(name, payload);
  };
}

/** @param {number} timeoutMs @returns {Promise<[string, string][]>} */
function waitForItems(timeoutMs) {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      wakeWaiter = null;
      resolve(queue.splice(0));
    };
    const timer = setTimeout(finish, timeoutMs);
    // микрозадача: события одной синхронной пачки (мутации rrweb) уходят вместе
    wakeWaiter = () => {
      wakeWaiter = null;
      queueMicrotask(finish);
    };
  });
}

export function exposeQueue() {
  window.__mirrorRefresh = () => refreshers.forEach((fn) => fn());
  window[DRAIN_GLOBAL] = (timeoutMs) => (queue.length ? queue.splice(0) : waitForItems(timeoutMs));
}
