// @ts-check
import { headerValue } from "./tracker.js";

/** @typedef {import("./tracker.js").Resource} Resource */
/** @typedef {import("../cdp/session.js").CdpSession} CdpSession */
/** @typedef {{ name: string, load: (href: string) => Promise<Resource | null> }} Strategy */
/** @typedef {Resource & { via: string }} ResolvedResource */

const CHUNK_SIZE = 1 << 20;

/** @param {string[]} languages */
export const acceptLanguage = (languages) => languages
  .map((lang, i) => (i ? `${lang};q=${Math.max(0.1, 1 - i * 0.1).toFixed(1)}` : lang))
  .join(",");

/** @param {CdpSession} session @param {string} handle */
async function readStream(session, handle) {
  const chunks = [];
  try {
    for (let eof = false; !eof;) {
      const chunk = await session.send("IO.read", { handle, size: CHUNK_SIZE });
      chunks.push(Buffer.from(chunk.data, chunk.base64Encoded ? "base64" : "utf8"));
      eof = chunk.eof;
    }
  } finally {
    session.send("IO.close", { handle }).catch(() => {});
  }
  return Buffer.concat(chunks);
}

/** @param {import("./tracker.js").LoadTracker} tracker @returns {Strategy} */
export const fromChromeCache = (tracker) => ({ name: "chrome", load: tracker.lookup });

// Chrome скачивает ресурс своим сетевым стеком, не выполняя код страницы. Строгий CSP сайта это запрещает.
/** @param {CdpSession} session @param {() => string} frameId @returns {Strategy} */
export const viaChromeNetwork = (session, frameId) => ({
  name: "loaded",
  load: async (href) => {
    const options = { disableCache: false, includeCredentials: true };
    const { resource } = await session.send("Network.loadNetworkResource", { frameId: frameId(), url: href, options });
    if (!resource.success || !resource.stream) return null;
    const type = headerValue(resource.headers, "content-type") || "application/octet-stream";
    return { status: resource.httpStatusCode || 200, type, body: await readStream(session, resource.stream), url: href };
  },
});

/** @param {{ userAgent: string, acceptLanguage: string, referer: () => string }} identity @returns {Strategy} */
export const viaNode = ({ userAgent, acceptLanguage, referer }) => ({
  name: "fallback",
  load: async (href) => {
    console.log("proxy: запасной путь (Node, Chrome не смог):", href.slice(0, 140));
    const headers = { "User-Agent": userAgent, Referer: referer(), "Accept-Language": acceptLanguage };
    const res = await fetch(href, { headers, redirect: "follow" });
    const type = res.headers.get("content-type") || "application/octet-stream";
    return { status: res.status, type, body: Buffer.from(await res.arrayBuffer()), url: res.url };
  },
});

/** @param {Strategy[]} strategies @returns {(href: string) => Promise<ResolvedResource | null>} */
export function createResourceResolver(strategies) {
  return async (href) => {
    for (const { name, load } of strategies) {
      const resource = await load(href).catch(() => null);
      if (resource) return { ...resource, via: name };
    }
    return null;
  };
}
