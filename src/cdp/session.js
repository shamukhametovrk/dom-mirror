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

/** @param {CdpConnection} cdp */
async function findOrCreatePage(cdp) {
  const { targetInfos } = await cdp.send("Target.getTargets");
  const page = targetInfos.find((t) => t.type === "page");
  return page?.targetId ?? (await cdp.send("Target.createTarget", { url: "about:blank" })).targetId;
}

/** @param {CdpConnection} cdp @returns {Promise<{ targetId: string, session: CdpSession }>} */
export async function attachToPage(cdp) {
  const targetId = await findOrCreatePage(cdp);
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  return { targetId, session: createSession(cdp, sessionId) };
}
