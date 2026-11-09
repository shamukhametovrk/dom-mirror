// @ts-check
// Уведомления в правом нижнем углу. С ключом — новое уведомление заменяет прежнее с тем же ключом.

/**
 * @typedef {{
 *   key?: string, text: string, kind?: "failed", hideAfterMs?: number | null,
 *   link?: { href: string, download: string, label: string }, onClick?: () => void,
 * }} Toast
 */

/** @param {Toast} t */
function render(t) {
  const el = document.createElement("div");
  el.className = t.kind ? `toast ${t.kind}` : "toast";
  el.textContent = t.text;
  if (t.link) el.appendChild(Object.assign(document.createElement("a"), { href: t.link.href, download: t.link.download, textContent: t.link.label }));
  if (t.onClick) {
    el.classList.add("clickable");
    el.addEventListener("click", () => { el.remove(); t.onClick(); }, { once: true });
  }
  return el;
}

/** @param {HTMLElement} container @returns {(t: Toast) => HTMLElement} */
export function createToaster(container) {
  /** @type {Map<string, HTMLElement>} */
  const byKey = new Map();
  return (t) => {
    if (t.key) byKey.get(t.key)?.remove();
    const el = container.appendChild(render(t));
    if (t.key) byKey.set(t.key, el);
    if (t.hideAfterMs) setTimeout(() => el.remove(), t.hideAfterMs);
    return el;
  };
}
