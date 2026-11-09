// @ts-check

/** @typedef {import("./connection.js").CdpConnection} CdpConnection */
/**
 * @typedef {{
 *   send: (method: string, params?: object) => Promise<any>,
 *   on: (method: string, fn: (params: any) => void) => void,
 * }} CdpSession
 */

/** @param {CdpConnection} cdp @param {string} sessionId @returns {CdpSession} */
export function createSession(cdp, sessionId) {
  return {
    send: (method, params = {}) => cdp.send(method, params, sessionId),
    on: (method, fn) => cdp.on(method, (params, sid) => {
      if (sid === sessionId) fn(params);
    }),
  };
}

/** @param {CdpConnection} cdp @param {string} targetId @returns {Promise<CdpSession>} */
export async function attachToTarget(cdp, targetId) {
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  return createSession(cdp, sessionId);
}
