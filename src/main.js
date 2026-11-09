// @ts-check
import { EventEmitter } from "node:events";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { connectCdp } from "./cdp/connection.js";
import { openTab } from "./browser/tab.js";
import { redirectPopups } from "./browser/popups.js";
import { createWorld, startAgentChannel } from "./browser/world.js";
import { buildAgentSource } from "./browser/agent-source.js";
import { createInputDispatcher } from "./browser/input-dispatcher.js";
import { createFrameCapture, startFrameCapture } from "./browser/frame-capture.js";
import { createLoadTracker } from "./resources/tracker.js";
import { acceptLanguage, createResourceResolver, fromChromeCache, viaChromeNetwork, viaNode } from "./resources/resolvers.js";
import { createAgentHandlers, createHub } from "./mirror/hub.js";
import { createCommandHandler } from "./mirror/commands.js";
import { createRouter } from "./http/router.js";
import { staticRoutes } from "./http/static.js";
import { createProxyRoute } from "./http/proxy.js";
import { debugRoutes } from "./http/debug.js";
import { attachWebSocket } from "./http/ws.js";
import { createActivity, createSerialQueue } from "./util/async.js";

/** @typedef {import("./config.js").Config} Config */
/** @typedef {Awaited<ReturnType<typeof startBrowser>>} Browser */
/** @typedef {ReturnType<typeof startMirror>} Mirror */

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const RRWEB_DIR = path.join(ROOT, "node_modules/rrweb/dist");

/** @param {Config} config @param {EventEmitter} bus */
async function startBrowser(config, bus) {
  const cdp = await connectCdp(config.cdpUrl);
  cdp.onClose(() => bus.emit("fatal", "chrome disconnected"));
  const tab = await openTab({ cdp, bus });
  const tracker = createLoadTracker(tab.session);
  await tracker.enable();
  bus.on("document", tracker.forget);
  const source = buildAgentSource(fs.readFileSync(path.join(RRWEB_DIR, "rrweb.umd.min.cjs"), "utf8"));
  const world = await createWorld({ tab, bus, source });
  return { cdp, tab, tracker, world };
}

/** @param {Config} config @param {Browser} browser @param {EventEmitter} bus */
function startMirror(config, { tab, world }, bus) {
  const serial = createSerialQueue();
  const activity = createActivity();
  const frames = createFrameCapture({ session: tab.session, serial, activity, settleMs: config.settleMs });
  const hub = createHub({ startUrl: config.startUrl, currentUrl: () => tab.url, frames });
  const publishUrl = (url) => hub.broadcast({ type: "url", url });
  bus.on("document", publishUrl);
  bus.on("url", publishUrl);
  startAgentChannel({ world, handlers: createAgentHandlers({ hub, frames }) });
  if (config.frames) startFrameCapture(frames, () => hub.size > 0, (list) => hub.broadcast({ type: "frames", frames: list }));
  const input = createInputDispatcher({ session: tab.session, world });
  return { hub, onMessage: createCommandHandler({ tab, input, serial, activity }) };
}

// User-Agent и Accept-Language запасного пути — как у самого Chrome, чтобы не расходились с navigator.
/** @param {Browser} browser @param {Mirror} mirror */
async function createResolver({ cdp, tab, tracker }, { hub }) {
  const { userAgent } = await cdp.send("Browser.getVersion");
  const languages = acceptLanguage(await tab.evaluate("navigator.languages"));
  console.log("connected to", userAgent, "|", languages);
  return createResourceResolver([
    fromChromeCache(tracker),
    viaChromeNetwork(tab.session, () => tab.frameId),
    viaNode({ userAgent, acceptLanguage: languages, referer: () => hub.base }),
  ]);
}

/** @param {Browser} browser @param {Mirror} mirror */
async function createRoutes(browser, mirror) {
  const stats = { chrome: 0, loaded: 0, fallback: 0 };
  return {
    ...staticRoutes({ root: ROOT, rrwebDir: RRWEB_DIR }),
    "/r": createProxyRoute({ resolve: await createResolver(browser, mirror), stats }),
    ...debugRoutes({ session: browser.tab.session, world: browser.world, stats: () => ({ ...stats, tracked: browser.tracker.size }) }),
  };
}

async function main() {
  const config = loadConfig();
  const bus = new EventEmitter();
  bus.on("fatal", (reason) => {
    console.error(reason);
    process.exit(1);
  });
  const browser = await startBrowser(config, bus);
  const mirror = startMirror(config, browser, bus);
  const server = http.createServer(createRouter(await createRoutes(browser, mirror)));
  await redirectPopups(browser);
  browser.tab.navigate(config.startUrl).catch((e) => console.error("goto:", e.message));
  attachWebSocket({ server, hub: mirror.hub, onMessage: mirror.onMessage });
  server.listen(config.port, () => console.log(`dom-mirror: http://localhost:${config.port}  (start: ${config.startUrl})`));
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(0));
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
