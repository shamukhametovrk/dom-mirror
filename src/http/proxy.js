// @ts-check
import { reply } from "./router.js";

/** @typedef {import("../resources/resolvers.js").ResolvedResource} ResolvedResource */
/** @typedef {Record<string, number>} ProxyStats */

/** @param {string | null} value */
function parseTarget(value) {
  try {
    const url = new URL(value ?? "");
    return /^https?:$/.test(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

/**
 * @param {import("node:http").ServerResponse} res @param {ResolvedResource} resource
 * @param {import("../resources/rewrite.js").Rewriter} rewriter
 */
function sendResource(res, resource, rewriter) {
  // ссылки внутри CSS — относительно самого CSS
  const body = /text\/css/i.test(resource.type)
    ? Buffer.from(rewriter.css(resource.body.toString("utf8"), resource.url))
    : resource.body;
  res.writeHead(resource.status, {
    "Content-Type": resource.type,
    "Cache-Control": resource.status < 400 ? "public, max-age=3600" : "no-store",
    // копия живёт в sandbox-iframe с непрозрачным origin: шрифтам и CSS нужен CORS
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

/**
 * @param {{
 *   resolve: (href: string) => Promise<ResolvedResource | null>,
 *   stats: ProxyStats,
 *   signer: import("../resources/signing.js").UrlSigner,
 *   rewriter: import("../resources/rewrite.js").Rewriter,
 * }} deps
 * @returns {import("./router.js").Route}
 */
export const createProxyRoute = ({ resolve, stats, signer, rewriter }) => async (_req, res, url) => {
  const target = parseTarget(url.searchParams.get("u"));
  if (!target) return reply(res, 400);
  if (!signer.verify(url.searchParams.get("u"), url.searchParams.get("s"))) return reply(res, 403);
  const resource = await resolve(target.href);
  if (!resource) return reply(res, 502);
  stats[resource.via] = (stats[resource.via] ?? 0) + 1;
  sendResource(res, resource, rewriter);
};
