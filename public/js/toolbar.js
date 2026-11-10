// @ts-check

/** @typedef {import("../../shared/protocol.js").ClientMessage} ClientMessage */

const byId = (id) => document.getElementById(id);

/** @param {(msg: ClientMessage) => void} send @param {() => void} afterAction */
export function createToolbar(send, afterAction) {
  const status = byId("status");
  for (const type of /** @type {const} */ (["back", "reload"])) {
    byId(type).onclick = () => {
      send({ type });
      afterAction();
    };
  }
  return {
    /** @param {string} text */
    setStatus: (text) => { status.textContent = text; },
  };
}
