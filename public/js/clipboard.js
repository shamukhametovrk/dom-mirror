// @ts-check
// Сервер прислал, что скопировано у него (Ctrl+C, кнопка «Копировать»), — кладём это в буфер пользователя.
// Без клика запись разрешает не каждый браузер (Safari, Firefox): тогда просим нажать на уведомление.

/** @typedef {{ text?: string, image?: string }} ClipboardContent */
/** @typedef {import("./toasts.js").Toast} Toast */

const CONFIRM_MS = 1500;
const OFFER_MS = 15000;

// без HTTPS (кроме localhost) Clipboard API нет — копируем текст старым способом, он работает по клику
/** @param {string} text */
function copyTextLegacy(text) {
  const area = Object.assign(document.createElement("textarea"), { value: text });
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  return ok ? Promise.resolve() : Promise.reject(new Error("copy failed"));
}

/** @param {ClipboardContent} c */
function write(c) {
  if (!navigator.clipboard) return c.text ? copyTextLegacy(c.text) : Promise.reject(new Error("no clipboard"));
  if (!c.image) return navigator.clipboard.writeText(c.text);
  const png = fetch(`data:image/png;base64,${c.image}`).then((r) => r.blob());
  return navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}

/** @param {(t: Toast) => unknown} toast */
export function createClipboardSync(toast) {
  const confirm = () => toast({ key: "clipboard", text: "Скопировано", hideAfterMs: CONFIRM_MS });
  const fail = () => toast({ key: "clipboard", text: "Не удалось скопировать", kind: "failed", hideAfterMs: CONFIRM_MS * 2 });
  return (/** @type {ClipboardContent} */ c) => write(c).then(confirm, () => toast({
    key: "clipboard",
    text: "Скопировано на сервере — нажмите, чтобы скопировать к себе",
    hideAfterMs: OFFER_MS,
    onClick: () => write(c).then(confirm, fail),
  }));
}
