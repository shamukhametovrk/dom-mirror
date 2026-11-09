// @ts-check
// Ресурсы для копии берём из ответов, которые Chrome уже загрузил для настоящей страницы:
// на сайт уходят только запросы самого браузера, с его TLS-отпечатком, cookies и Referer.
import { sleep } from "../util/async.js";

/** @typedef {import("../cdp/session.js").CdpSession} CdpSession */
/** @typedef {{ status: number, type: string, body: Buffer, url: string }} Resource */
/**
 * @typedef {{ requestId: string, key: string, finalUrl: string, state: "pending" | "done" | "failed",
 *   status: number, type: string, done: Promise<void>, finish: () => void }} Load
 */

const TRACKED_TYPES = new Set(["Image", "Stylesheet", "Font", "Other"]);
const MAX_TRACKED = 4000;
const START_GRACE_MS = 250;
const FINISH_TIMEOUT_MS = 10_000;
const BUFFERS = { maxTotalBufferSize: 128 * 1024 * 1024, maxResourceBufferSize: 32 * 1024 * 1024 };

/** @param {string} url */
export function withoutHash(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.href;
  } catch {
    return url;
  }
}

/** @param {Record<string, string> | undefined} headers @param {string} name */
export function headerValue(headers, name) {
  const key = Object.keys(headers ?? {}).find((h) => h.toLowerCase() === name);
  return key && headers[key];
}

const isTrackable = ({ request, type }) => request.method === "GET" && TRACKED_TYPES.has(type) && /^https?:/.test(request.url);

/** @param {string} requestId @param {string} url @returns {Load} */
function createLoad(requestId, url) {
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  return { requestId, key: withoutHash(url), finalUrl: url, state: "pending", status: 0, type: "", done, finish };
}

function createRegistry() {
  /** @type {Map<string, Load>} */
  const byUrl = new Map();
  /** @type {Map<string, Load>} */
  const byRequest = new Map();
  const evictOldest = () => {
    if (byUrl.size <= MAX_TRACKED) return;
    const [key, oldest] = byUrl.entries().next().value;
    byUrl.delete(key);
    byRequest.delete(oldest.requestId);
  };
  return {
    /** @param {Load} load */
    add(load) {
      byUrl.set(load.key, load);
      byRequest.set(load.requestId, load);
      evictOldest();
    },
    byRequest: (/** @type {string} */ id) => byRequest.get(id),
    byUrl: (/** @type {string} */ key) => byUrl.get(key),
    clear: () => { byUrl.clear(); byRequest.clear(); },
    get size() { return byUrl.size; },
  };
}

/** @typedef {ReturnType<typeof createRegistry>} Registry */

/** @param {Registry} loads @returns {Record<string, (params: any) => void>} */
function networkHandlers(loads) {
  const finishWith = (state) => ({ requestId }) => {
    const load = loads.byRequest(requestId);
    if (!load) return;
    load.state = state;
    load.finish();
  };
  return {
    "Network.requestWillBeSent": (p) => {
      const redirected = p.redirectResponse && loads.byRequest(p.requestId);
      if (redirected) redirected.finalUrl = p.request.url;
      if (!p.redirectResponse && isTrackable(p)) loads.add(createLoad(p.requestId, p.request.url));
    },
    "Network.responseReceived": ({ requestId, response }) => {
      const load = loads.byRequest(requestId);
      if (load) Object.assign(load, { status: response.status, type: headerValue(response.headers, "content-type") || response.mimeType });
    },
    "Network.loadingFinished": finishWith("done"),
    "Network.loadingFailed": finishWith("failed"),
  };
}

/** @param {CdpSession} session @param {Registry} loads */
function followNetwork(session, loads) {
  for (const [event, handler] of Object.entries(networkHandlers(loads))) session.on(event, handler);
}

/** @param {Registry} loads @param {string} key */
async function findLoad(loads, key) {
  if (loads.byUrl(key)) return loads.byUrl(key);
  await sleep(START_GRACE_MS);
  return loads.byUrl(key);
}

/** @param {Load | undefined} load */
async function settled(load) {
  if (load?.state === "pending") await Promise.race([load.done, sleep(FINISH_TIMEOUT_MS)]);
  return isReadable(load) ? load : null;
}

/** @param {Load | undefined} load */
const isReadable = (load) => load?.state === "done" && load.status > 0;

/** @param {CdpSession} session @param {Load} load @returns {Promise<Resource>} */
async function readBody(session, load) {
  const { body, base64Encoded } = await session.send("Network.getResponseBody", { requestId: load.requestId });
  const type = load.type || "application/octet-stream";
  return { status: load.status, type, body: Buffer.from(body, base64Encoded ? "base64" : "utf8"), url: load.finalUrl };
}

/** @param {CdpSession} session */
export function createLoadTracker(session) {
  const loads = createRegistry();
  followNetwork(session, loads);
  return {
    enable: () => session.send("Network.enable", BUFFERS),
    forget: () => loads.clear(),
    get size() { return loads.size; },
    /** @param {string} href @returns {Promise<Resource | null>} */
    lookup: async (href) => {
      const load = await settled(await findLoad(loads, withoutHash(href)));
      return load && readBody(session, load);
    },
  };
}

/** @typedef {ReturnType<typeof createLoadTracker>} LoadTracker */
