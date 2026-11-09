// @ts-check
// Ссылки на ресурсы в событиях rrweb ведут на прокси сервера: браузер пользователя не ходит на сайт сам.
import { EventType, IncrementalSource, NodeType } from "../../shared/protocol.js";

const KEEP_SCHEMES = /^(data:|blob:|about:|javascript:|#)/i;
const PROXY_PREFIX = "/r?u=";
const LINK_TAGS = new Set(["link", "image", "use"]);
const RESOURCE_EXT = /\.(css|ico|png|svg|woff2?)(\?|$)/i;

/** @param {string} url @param {string} base */
function toProxy(url, base) {
  try {
    const abs = new URL(url, base);
    return /^https?:$/.test(abs.protocol) ? PROXY_PREFIX + encodeURIComponent(abs.href) : null;
  } catch {
    return null;
  }
}

/** @param {string} url */
const isKept = (url) => !url || KEEP_SCHEMES.test(url) || url.startsWith(PROXY_PREFIX);

/** @param {string} url @param {string} base */
export function proxied(url, base) {
  const trimmed = url?.trim();
  return isKept(trimmed) ? url : toProxy(trimmed, base) ?? url;
}

/** @param {string} css @param {string} base */
export const rewriteCss = (css, base) => css
  .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (_, q, url) => `url(${q}${proxied(url, base)}${q})`)
  .replace(/@import\s+(['"])([^'"]+)\1/gi, (_, q, url) => `@import ${q}${proxied(url, base)}${q}`);

/** @param {string} srcset @param {string} base */
const rewriteSrcset = (srcset, base) => srcset
  .split(",")
  .map((part) => {
    const [url, ...descriptors] = part.trim().split(/\s+/);
    return [proxied(url, base), ...descriptors].join(" ");
  })
  .join(", ");

/** @type {Record<string, (value: string, base: string) => string>} */
const BY_ATTRIBUTE = { src: proxied, poster: proxied, srcset: rewriteSrcset, style: rewriteCss, _cssText: rewriteCss };

// У изменений атрибутов тег неизвестен (null) — тогда ресурс узнаём по расширению.
/** @param {string} key @param {string} value @param {string | null} tag */
const isResourceLink = (key, value, tag) =>
  key === "xlink:href" || (key === "href" && (LINK_TAGS.has(tag) || (tag === null && RESOURCE_EXT.test(value))));

/** @param {string} key @param {string} value @param {string | null} tag */
function attributeRewriter(key, value, tag) {
  if (Object.hasOwn(BY_ATTRIBUTE, key)) return BY_ATTRIBUTE[key];
  return isResourceLink(key, value, tag) ? proxied : null;
}

/** @param {Record<string, unknown> | undefined} attrs @param {string | null} tag @param {string} base */
function rewriteAttributes(attrs, tag, base) {
  for (const [key, value] of Object.entries(attrs ?? {})) {
    const rewrite = typeof value === "string" && attributeRewriter(key, value, tag);
    if (rewrite) attrs[key] = rewrite(value, base);
  }
}

const isStyleText = (node, parentTag) => node.type === NodeType.Text && (node.isStyle || parentTag === "style") && node.textContent;

/** @param {any} node @param {string} base @param {string} [parentTag] */
function rewriteNode(node, base, parentTag) {
  if (!node) return;
  if (node.type === NodeType.Element) rewriteAttributes(node.attributes, node.tagName, base);
  if (isStyleText(node, parentTag)) node.textContent = rewriteCss(node.textContent, base);
  rewriteChildren(node, base);
}

/** @param {any} node @param {string} base */
function rewriteChildren(node, base) {
  for (const child of node.childNodes ?? []) rewriteNode(child, base, node.tagName);
}

/** @type {Record<number, (data: any, base: string) => void>} */
const BY_SOURCE = {
  [IncrementalSource.Mutation]: (data, base) => {
    for (const add of data.adds ?? []) rewriteNode(add.node, base);
    for (const change of data.attributes ?? []) rewriteAttributes(change.attributes, null, base);
  },
  [IncrementalSource.StyleSheetRule]: (data, base) => {
    for (const add of data.adds ?? []) add.rule &&= rewriteCss(add.rule, base);
  },
};

/** @type {Record<number, (data: any, base: string) => void>} */
const BY_EVENT_TYPE = {
  [EventType.FullSnapshot]: (data, base) => rewriteNode(data.node, base),
  [EventType.IncrementalSnapshot]: (data, base) => BY_SOURCE[data.source]?.(data, base),
};

/**
 * Мутирует событие rrweb на месте; base — адрес текущей страницы.
 * @template {{ type: number, data: any }} E @param {E} event @param {string} base @returns {E}
 */
export function rewriteEvent(event, base) {
  BY_EVENT_TYPE[event.type]?.(event.data, base);
  return event;
}
