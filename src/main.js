// @ts-check
import { EventEmitter } from "node:events";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { connectCdp } from "./cdp/connection.js";
import { createTabs } from "./browser/tabs.js";
import { createActiveTab } from "./browser/active-tab.js";
import { buildAgentSource } from "./browser/agent-source.js";
import { createFrameCapture, startFrameCapture } from "./browser/frame-capture.js";
import { acceptLanguage, createResourceResolver, fromChromeCache, viaChromeNetwork, viaNode } from "./resources/resolvers.js";
import { createAgentHandlers, createHub } from "./mirror/hub.js";
import { createCommandHandler } from "./mirror/commands.js";
import { createRewriter } from "./resources/rewrite.js";
import { createUrlSigner, PROXY_PATH } from "./resources/signing.js";
import { createRouter, reply } from "./http/router.js";
import { serveFile, staticRoutes } from "./http/static.js";
import { createProxyRoute } from "./http/proxy.js";
import { debugRoutes } from "./http/debug.js";
import { attachWebSocket, isSameOrigin } from "./http/ws.js";
import { createAuth, guardRoutes } from "./http/auth.js";
import { resolvePassword } from "./http/password.js";
import { createActivity, createSerialQueue } from "./util/async.js";

/** @typedef {import("./config.js").Config} Config */
/** @typedef {Awaited<ReturnType<typeof startBrowser>>} Browser */
/** @typedef {ReturnType<typeof startMirror>} Mirror */
/** @typedef {import("./http/auth.js").Auth} Auth */

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const RRWEB_DIR = path.join(ROOT, "node_modules/rrweb/dist");

/** @param {Config} config @param {EventEmitter} bus */
async function startBrowser(config, bus) {
  const cdp = await connectCdp(config.cdpUrl);
  cdp.onClose(() => bus.emit("fatal", "chrome disconnected"));
  const source = buildAgentSource(fs.readFileSync(path.join(RRWEB_DIR, "rrweb.umd.min.cjs"), "utf8"));
  return { cdp, source };
}

// Хабу нужен список вкладок, вкладкам — обработчики хаба: связываем через позднее обращение к tabs.
/** @param {Config} config @param {Browser} browser */
function startMirror(config, { cdp, source }) {
  const serial = createSerialQueue();
  const activity = createActivity();
  /** @type {import("./browser/tabs.js").Tabs | null} */
  let tabs = null;
  const active = createActiveTab(/** @type {any} */ ({ get active() { return tabs?.active ?? null; } }));
  const frames = createFrameCapture({ session: active.session, serial, activity, settleMs: config.settleMs });
  const signer = createUrlSigner();
  const rewriter = createRewriter(signer.sign);
  const hub = createHub({ startUrl: config.startUrl, currentUrl: () => active.tab.url, tabs: () => tabs?.list() ?? [], frames, rewriter });
  tabs = createTabs({ cdp, source, handlers: createAgentHandlers({ hub, frames }), startUrl: config.startUrl });
  tabs.events.on("url", (url) => hub.broadcast({ type: "url", url }));
  tabs.events.on("changed", (list) => hub.broadcast({ type: "tabs", tabs: list }));
  if (config.frames) startFrameCapture(frames, () => hub.size > 0, (list) => hub.broadcast({ type: "frames", frames: list }));
  const onMessage = createCommandHandler({ tab: active.tab, tabs, input: active.input, serial, activity });
  return { hub, signer, rewriter, tabs, active, onMessage };
}

// User-Agent и Accept-Language запасного пути — как у самого Chrome, чтобы не расходились с navigator.
/** @param {Browser} browser @param {Mirror} mirror */
async function createResolver({ cdp }, { hub, active }) {
  const { userAgent } = await cdp.send("Browser.getVersion");
  const languages = acceptLanguage(await active.tab.evaluate("navigator.languages"));
  console.log("connected to", userAgent, "|", languages);
  return createResourceResolver([
    fromChromeCache(active.tracker),
    viaChromeNetwork(active.session, () => active.tab.frameId),
    viaNode({ userAgent, acceptLanguage: languages, referer: () => hub.base }),
  ]);
}

// Без входа доступны только страница входа, проверка живости и подписанный прокси.
/** @param {Browser} browser @param {Mirror} mirror @param {Auth} auth */
async function createRoutes(browser, mirror, auth) {
  const stats = { chrome: 0, loaded: 0, fallback: 0 };
  const loginPage = serveFile(path.join(ROOT, "public/login.html"), "text/html; charset=utf-8");
  const { active } = mirror;
  const debug = debugRoutes({ session: active.session, world: active.world, stats: () => ({ ...stats, tracked: active.tracker.size }) });
  return {
    ...guardRoutes({ ...staticRoutes({ root: ROOT, rrwebDir: RRWEB_DIR }), ...debug }, auth),
    "/login": (req, res, url) => (req.method === "POST" ? auth.login(req, res) : loginPage(req, res, url)),
    "/logout": auth.logout,
    "/health": (_req, res) => reply(res, 200, "ok"),
    [PROXY_PATH]: createProxyRoute({ resolve: await createResolver(browser, mirror), stats, signer: mirror.signer, rewriter: mirror.rewriter }),
  };
}

/** @param {{ config: Config, mirror: Mirror, auth: Auth, routes: Record<string, import("./http/router.js").Route> }} deps */
function startServer({ config, mirror, auth, routes }) {
  const server = http.createServer(createRouter(routes));
  const isAllowed = (req) => auth.isAuthorized(req) && isSameOrigin(req, config.trustProxy);
  attachWebSocket({ server, hub: mirror.hub, onMessage: mirror.onMessage, isAllowed, debug: config.debug });
  server.listen(config.port, () => console.log(`dom-mirror: http://localhost:${config.port}  (start: ${config.startUrl})`));
}

async function main() {
  const config = loadConfig();
  const bus = new EventEmitter();
  bus.on("fatal", (reason) => {
    console.error(reason);
    process.exit(1);
  });
  const auth = createAuth({ password: resolvePassword(config), trustProxy: config.trustProxy });
  const browser = await startBrowser(config, bus);
  const mirror = startMirror(config, browser);
  await mirror.tabs.init();
  if (mirror.active.tab.url === "about:blank") mirror.active.tab.navigate(config.startUrl).catch((e) => console.error("goto:", e.message));
  const routes = await createRoutes(browser, mirror, auth);
  startServer({ config, mirror, auth, routes });
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(0));
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
