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
import { createFileChoosers } from "./browser/file-chooser.js";
import { createUploads } from "./browser/uploads.js";
import { startDownloads } from "./browser/downloads.js";
import { createClipboardWatcher, mayCopy } from "./browser/clipboard.js";
import { acceptLanguage, createResourceResolver, fromChromeCache, viaChromeNetwork, viaNode } from "./resources/resolvers.js";
import { createAgentHandlers, createHub } from "./mirror/hub.js";
import { createCommandHandler } from "./mirror/commands.js";
import { createRewriter } from "./resources/rewrite.js";
import { createUrlSigner, PROXY_PATH } from "./resources/signing.js";
import { createRouter, reply } from "./http/router.js";
import { serveFile, staticRoutes } from "./http/static.js";
import { createProxyRoute } from "./http/proxy.js";
import { debugRoutes } from "./http/debug.js";
import { createDownloadRoute } from "./http/download.js";
import { createUploadRoute } from "./http/upload.js";
import { attachWebSocket, isSameOrigin } from "./http/ws.js";
import { createAuth, guardRoutes } from "./http/auth.js";
import { resolvePassword } from "./http/password.js";
import { createSerialQueue } from "./util/async.js";

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
  /** @type {import("./browser/tabs.js").Tabs | null} */
  let tabs = null;
  const active = createActiveTab(/** @type {any} */ ({ get active() { return tabs?.active ?? null; } }));
  const signer = createUrlSigner();
  const rewriter = createRewriter(signer.sign);
  const hub = createHub({ startUrl: config.sites[0].url, currentUrl: () => active.tab.url, tabs: () => tabs?.list() ?? [], rewriter });
  const choosers = createFileChoosers({ publish: (chooser) => hub.broadcast({ type: "fileChooser", ...chooser }) });
  tabs = createTabs({ cdp, source, handlers: createAgentHandlers(hub), choosers, sites: config.sites });
  tabs.events.on("url", (url) => hub.broadcast({ type: "url", url }));
  tabs.events.on("changed", (list) => hub.broadcast({ type: "tabs", tabs: list }));
  tabs.events.on("activated", () => active.tab.refit().catch((e) => console.error("refit:", e.message)));
  const uploads = createUploads({ dir: config.uploadsDir });
  const files = { paths: uploads.paths, attach: choosers.attach };
  const command = createCommandHandler({ tab: active.tab, tabs, input: active.input, serial: createSerialQueue(), files });
  return { hub, signer, rewriter, tabs, active, uploads, onMessage: withClipboard(hub, command) };
}

/** После действий, которые могут что-то скопировать, буфер сервера сверяется и уходит клиенту. */
/** @param {import("./mirror/hub.js").Hub} hub @param {(msg: any) => void} command */
function withClipboard(hub, command) {
  const clipboard = createClipboardWatcher({ publish: (content) => hub.broadcast({ type: "clipboard", ...content }) });
  clipboard.prime();
  return (msg) => {
    command(msg);
    if (mayCopy(msg)) clipboard.afterInput();
  };
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
/** @param {Browser} browser @param {Mirror} mirror @param {{ auth: Auth, downloads: import("./browser/downloads.js").Downloads }} access */
async function createRoutes(browser, mirror, { auth, downloads }) {
  const stats = { chrome: 0, loaded: 0, fallback: 0 };
  const loginPage = serveFile(path.join(ROOT, "public/login.html"), "text/html; charset=utf-8");
  const { active } = mirror;
  const debug = debugRoutes({ session: active.session, world: active.world, stats: () => ({ ...stats, tracked: active.tracker.size }) });
  return {
    ...guardRoutes({ ...staticRoutes({ root: ROOT, rrwebDir: RRWEB_DIR }), ...debug, "/download": createDownloadRoute(downloads), "/upload": createUploadRoute(mirror.uploads) }, auth),
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
  server.listen(config.port, () => console.log(`dom-mirror: http://localhost:${config.port}  (${config.sites.map((s) => s.name).join(", ")})`));
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
  const downloads = await startDownloads({
    cdp: browser.cdp, dir: config.downloadsDir, onEvent: (event) => mirror.hub.broadcast({ type: "download", ...event }),
  });
  const routes = await createRoutes(browser, mirror, { auth, downloads });
  startServer({ config, mirror, auth, routes });
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(0));
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
