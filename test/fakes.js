// @ts-check

/** Поддельная CDP-сессия: запоминает команды, отвечает по таблице, позволяет слать события. */
export function createFakeSession(responses = {}) {
  const listeners = new Map();
  const calls = [];
  return {
    calls,
    send: async (method, params = {}) => {
      calls.push({ method, params });
      const answer = responses[method];
      return typeof answer === "function" ? answer(params) : answer ?? {};
    },
    on: (method, fn) => listeners.set(method, [...(listeners.get(method) ?? []), fn]),
    emit: (method, params) => (listeners.get(method) ?? []).forEach((fn) => fn(params)),
  };
}
