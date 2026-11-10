// @ts-check
// Окно выбора файла, которое открыл сайт, перехватывается (Page.setInterceptFileChooserDialog) — страница этого
// не видит. Клиент выбирает файлы у себя, загружает их на сервер, и они ставятся в поле настоящими путями.
import crypto from "node:crypto";

/** @typedef {import("../cdp/session.js").CdpSession} CdpSession */
/** @typedef {import("../../shared/protocol.js").FileChooser} FileChooser */

/** @param {CdpSession} session @param {number} backendNodeId */
async function readAccept(session, backendNodeId) {
  const { node } = await session.send("DOM.describeNode", { backendNodeId }).catch(() => ({ node: null }));
  const attrs = node?.attributes ?? [];
  const i = attrs.findIndex((name, index) => index % 2 === 0 && name === "accept");
  return i < 0 ? "" : String(attrs[i + 1]);
}

/** @param {{ publish: (chooser: FileChooser) => void }} deps */
export function createFileChoosers({ publish }) {
  // ждёт ответа только последнее окно: открыли новое — прежнее уже не нужно
  /** @type {{ id: string, session: CdpSession, backendNodeId: number } | null} */
  let pending = null;
  const open = async (session, { backendNodeId, mode }) => {
    pending = { id: crypto.randomUUID(), session, backendNodeId };
    const { id } = pending;
    publish({ id, multiple: mode === "selectMultiple", accept: await readAccept(session, backendNodeId) });
  };
  return {
    /** @param {CdpSession} session @param {() => boolean} isActive */
    watch(session, isActive) {
      session.on("Page.fileChooserOpened", (event) => isActive() && event.backendNodeId && open(session, event));
      return session.send("Page.setInterceptFileChooserDialog", { enabled: true });
    },
    /** @param {string} id @param {string[]} paths */
    async attach(id, paths) {
      if (pending?.id !== id || !paths.length) return;
      const { session, backendNodeId } = pending;
      pending = null;
      await session.send("DOM.setFileInputFiles", { files: paths, backendNodeId });
    },
  };
}

/** @typedef {ReturnType<typeof createFileChoosers>} FileChoosers */
