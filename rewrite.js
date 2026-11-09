// Переписывает ссылки на ресурсы (картинки, шрифты, CSS) в событиях rrweb на прокси сервера,
// чтобы браузер пользователя не ходил на сайт напрямую и не светил свой IP.

export const proxied = (url, base) => {
  if (!url) return url;
  const u = url.trim();
  if (/^(data:|blob:|about:|javascript:|#)/i.test(u) || u.startsWith("/r?u=")) return url;
  try {
    const abs = new URL(u, base);
    if (abs.protocol !== "http:" && abs.protocol !== "https:") return url;
    return "/r?u=" + encodeURIComponent(abs.href);
  } catch {
    return url;
  }
};

// url(...) и @import "..." внутри CSS
export const rewriteCss = (css, base) =>
  css
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, u) => `url(${q}${proxied(u, base)}${q})`)
    .replace(/@import\s+(['"])([^'"]+)\1/gi, (m, q, u) => `@import ${q}${proxied(u, base)}${q}`);

const rewriteSrcset = (v, base) =>
  v.split(",").map((part) => {
    const [u, ...rest] = part.trim().split(/\s+/);
    return [proxied(u, base), ...rest].join(" ");
  }).join(", ");

// tagName известен у узлов из снимка; у изменений атрибутов его нет (tag = null)
function rewriteAttrs(attrs, tag, base) {
  if (!attrs) return;
  for (const key of Object.keys(attrs)) {
    const v = attrs[key];
    if (typeof v !== "string") continue;
    if (key === "src" || key === "poster") attrs[key] = proxied(v, base);
    else if (key === "srcset") attrs[key] = rewriteSrcset(v, base);
    else if (key === "style" || key === "_cssText") attrs[key] = rewriteCss(v, base);
    else if (key === "href" && (tag === "link" || (tag === null && /\.(css|ico|png|svg|woff2?)(\?|$)/i.test(v))))
      attrs[key] = proxied(v, base);
    else if (key === "xlink:href" || (key === "href" && (tag === "image" || tag === "use"))) attrs[key] = proxied(v, base);
  }
}

function rewriteNode(node, base, parentTag) {
  if (!node) return;
  if (node.type === 2) rewriteAttrs(node.attributes, node.tagName, base);       // элемент
  if (node.type === 3 && (node.isStyle || parentTag === "style") && node.textContent)  // текст внутри <style>
    node.textContent = rewriteCss(node.textContent, base);
  for (const child of node.childNodes || []) rewriteNode(child, base, node.tagName);
}

// Мутирует событие rrweb на месте. base — адрес текущей страницы.
export function rewriteEvent(e, base) {
  if (e.type === 2) rewriteNode(e.data.node, base);                // полный снимок
  if (e.type === 3) {                                               // инкрементальное событие
    const d = e.data;
    if (d.source === 0) {                                           // мутации DOM
      for (const a of d.adds || []) rewriteNode(a.node, base);
      for (const a of d.attributes || []) rewriteAttrs(a.attributes, null, base);
    }
    if (d.source === 8) {                                           // правила стилей
      for (const a of d.adds || []) if (a.rule) a.rule = rewriteCss(a.rule, base);
    }
  }
  return e;
}
