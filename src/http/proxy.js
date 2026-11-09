// @ts-check
import { rewriteCss } from "../resources/rewrite.js";
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

// ссылки внутри CSS — относительно самого CSS
/** @param {ResolvedResource} resource */
const bodyOf = (resource) => (/text\/css/i.test(resource.type)
  ? Buffer.from(rewriteCss(resource.body.toString("utf8"), resource.url))
  : resource.body);

/** @param {import("node:http").ServerResponse} res @param {ResolvedResource} resource */
function sendResource(res, resource) {
  res.writeHead(resource.status, {
    "Content-Type": resource.type,
    "Cache-Control": resource.status < 400 ? "public, max-age=3600" : "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(bodyOf(resource));
}

/**
 * @param {{ resolve: (href: string) => Promise<ResolvedResource | null>, stats: ProxyStats }} deps
 * @returns {import("./router.js").Route}
 */
export const createProxyRoute = ({ resolve, stats }) => async (_req, res, url) => {
  const target = parseTarget(url.searchParams.get("u"));
  if (!target) return reply(res, 400);
  const resource = await resolve(target.href);
  if (!resource) return reply(res, 502);
  stats[resource.via] = (stats[resource.via] ?? 0) + 1;
  sendResource(res, resource);
};
