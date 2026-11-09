// @ts-check
// Сайты открывают ссылки в новой вкладке: закрываем её и открываем адрес в нашей.

/** @typedef {import("../cdp/connection.js").CdpConnection} CdpConnection */
/** @typedef {import("./tab.js").Tab} Tab */

/** @param {{ cdp: CdpConnection, tab: Tab }} deps */
export async function redirectPopups({ cdp, tab }) {
  /** @type {Map<string, boolean>} targetId → уже перенаправлена */
  const popups = new Map();
  const redirect = (target) => {
    if (popups.get(target.targetId) || !target.url || target.url === "about:blank") return;
    popups.set(target.targetId, true);
    cdp.send("Target.closeTarget", { targetId: target.targetId }).catch(() => {});
    tab.navigate(target.url).catch(() => {});
  };
  // вкладки, открытые до подписки, приходят до ответа на setDiscoverTargets — их не трогаем
  await cdp.send("Target.setDiscoverTargets", { discover: true });
  cdp.on("Target.targetCreated", ({ targetInfo }) => {
    if (targetInfo.type !== "page" || targetInfo.targetId === tab.targetId) return;
    popups.set(targetInfo.targetId, false);
    redirect(targetInfo);
  });
  cdp.on("Target.targetInfoChanged", ({ targetInfo }) => popups.has(targetInfo.targetId) && redirect(targetInfo));
  cdp.on("Target.targetDestroyed", ({ targetId }) => popups.delete(targetId));
}
