// @ts-check
// Серверный Chrome скачал файл — сохраняем его у пользователя и показываем уведомление.
// Ссылка в уведомлении нужна, если браузер не дал скачать автоматически (несколько файлов подряд).

/** @typedef {import("../../shared/protocol.js").DownloadInfo} DownloadInfo */
/** @typedef {import("./toasts.js").Toast} Toast */

const HIDE_AFTER_MS = 8000;

/** @param {string} id */
const downloadUrl = (id) => `/download?id=${encodeURIComponent(id)}`;

/** @param {DownloadInfo} d */
function saveFile(d) {
  const a = document.createElement("a");
  a.href = downloadUrl(d.id);
  a.download = d.name;
  a.click();
}

/** @type {Record<DownloadInfo["state"], (d: DownloadInfo) => Toast>} */
const TOASTS = {
  started: (d) => ({ key: d.id, text: `Скачивается: ${d.name}` }),
  done: (d) => ({ key: d.id, text: `Скачано: ${d.name}`, hideAfterMs: HIDE_AFTER_MS, link: { href: downloadUrl(d.id), download: d.name, label: "сохранить ещё раз" } }),
  failed: (d) => ({ key: d.id, text: `Не удалось скачать: ${d.name}`, kind: "failed", hideAfterMs: HIDE_AFTER_MS }),
};

/** @param {(t: Toast) => unknown} toast */
export const createDownloads = (toast) => (/** @type {DownloadInfo} */ d) => {
  toast(TOASTS[d.state](d));
  if (d.state === "done") saveFile(d);
};
