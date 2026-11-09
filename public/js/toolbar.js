// @ts-check

/** @typedef {import("../../shared/protocol.js").ClientMessage} ClientMessage */

const byId = (id) => document.getElementById(id);

/** @param {(msg: ClientMessage) => void} send @param {() => void} onSubmit */
export function createToolbar(send, onSubmit) {
  const urlInput = /** @type {HTMLInputElement} */ (byId("url"));
  const status = byId("status");
  urlInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    send({ type: "goto", url: urlInput.value.trim() });
    onSubmit();
  });
  for (const type of /** @type {const} */ (["back", "forward", "reload"])) byId(type).onclick = () => send({ type });

  const isEditing = () => document.activeElement === urlInput;
  return {
    isEditing,
    /** @param {string} url */
    setUrl: (url) => { if (!isEditing()) urlInput.value = url; },
    /** @param {string} text */
    setStatus: (text) => { status.textContent = text; },
  };
}
