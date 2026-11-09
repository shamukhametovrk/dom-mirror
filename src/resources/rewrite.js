// @ts-check
// Ссылки на ресурсы в событиях rrweb ведут на прокси сервера: браузер пользователя не ходит на сайт сам.
import { EventType, IncrementalSource, NodeType } from "../../shared/protocol.js";

import { PROXY_PREFIX } from "./signing.js";

/** @typedef {{ base: string, sign: (href: string) => string }} Context base — адрес страницы, sign — путь на прокси */

const KEEP_SCHEMES = /^(data:|blob:|about:|javascript:|#)/i;
const LINK_TAGS = new Set(["link", "image", "use"]);
const RESOURCE_EXT = /\.(css|ico|png|svg|woff2?)(\?|$)/i;

/** @param {string} url @param {Context} ctx */
function toProxy(url, ctx) {
  try {
    const abs = new URL(url, ctx.base);
    return /^https?:$/.test(abs.protocol) ? ctx.sign(abs.href) : null;
  } catch {
    return null;
  }
}

/** @param {string} url */
const isKept = (url) => !url || KEEP_SCHEMES.test(url) || url.startsWith(PROXY_PREFIX);

/** @param {string} url @param {Context} ctx */
export function proxied(url, ctx) {
  const trimmed = url?.trim();
  return isKept(trimmed) ? url : toProxy(trimmed, ctx) ?? url;
}

/** @param {string} css @param {Context} ctx */
export const rewriteCss = (css, ctx) => css
  .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (_, q, url) => `url(${q}${proxied(url, ctx)}${q})`)
  .replace(/@import\s+(['"])([^'"]+)\1/gi, (_, q, url) => `@import ${q}${proxied(url, ctx)}${q}`);

/** @param {string} srcset @param {Context} ctx */
const rewriteSrcset = (srcset, ctx) => srcset
  .split(",")
  .map((part) => {
    const [url, ...descriptors] = part.trim().split(/\s+/);
    return [proxied(url, ctx), ...descriptors].join(" ");
  })
  .join(", ");

/** @type {Record<string, (value: string, ctx: Context) => string>} */
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

/** @param {Record<string, unknown> | undefined} attrs @param {string | null} tag @param {Context} ctx */
function rewriteAttributes(attrs, tag, ctx) {
  for (const [key, value] of Object.entries(attrs ?? {})) {
    const rewrite = typeof value === "string" && attributeRewriter(key, value, tag);
    if (rewrite) attrs[key] = rewrite(value, ctx);
  }
}

const isStyleText = (node, parentTag) => node.type === NodeType.Text && (node.isStyle || parentTag === "style") && node.textContent;

/** @param {any} node @param {Context} ctx @param {string} [parentTag] */
function rewriteNode(node, ctx, parentTag) {
  if (!node) return;
  if (node.type === NodeType.Element) rewriteAttributes(node.attributes, node.tagName, ctx);
  if (isStyleText(node, parentTag)) node.textContent = rewriteCss(node.textContent, ctx);
  rewriteChildren(node, ctx);
}

/** @param {any} node @param {Context} ctx */
function rewriteChildren(node, ctx) {
  for (const child of node.childNodes ?? []) rewriteNode(child, ctx, node.tagName);
}

/** @type {Record<number, (data: any, ctx: Context) => void>} */
const BY_SOURCE = {
  [IncrementalSource.Mutation]: (data, ctx) => {
    for (const add of data.adds ?? []) rewriteNode(add.node, ctx);
    for (const change of data.attributes ?? []) rewriteAttributes(change.attributes, null, ctx);
  },
  [IncrementalSource.StyleSheetRule]: (data, ctx) => {
    for (const add of data.adds ?? []) add.rule &&= rewriteCss(add.rule, ctx);
  },
};

/** @type {Record<number, (data: any, ctx: Context) => void>} */
const BY_EVENT_TYPE = {
  [EventType.FullSnapshot]: (data, ctx) => rewriteNode(data.node, ctx),
  [EventType.IncrementalSnapshot]: (data, ctx) => BY_SOURCE[data.source]?.(data, ctx),
};

/**
 * Мутирует событие rrweb на месте.
 * @template {{ type: number, data: any }} E @param {E} event @param {Context} ctx @returns {E}
 */
export function rewriteEvent(event, ctx) {
  BY_EVENT_TYPE[event.type]?.(event.data, ctx);
  return event;
}

/** @param {(href: string) => string} sign */
export const createRewriter = (sign) => ({
  /** @template {{ type: number, data: any }} E @param {E} event @param {string} base @returns {E} */
  event: (event, base) => rewriteEvent(event, { base, sign }),
  /** @param {string} css @param {string} base */
  css: (css, base) => rewriteCss(css, { base, sign }),
});

/** @typedef {ReturnType<typeof createRewriter>} Rewriter */
