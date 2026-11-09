// @ts-check
// Вкладки — настоящие вкладки Chrome. Копируется активная, фоновые живут своей жизнью (грузятся, играют звук).
// Вкладки, которые открыл сам сайт (target=_blank, window.open), подхватываются и становятся активными —
// у них сохраняется window.opener, поэтому работают окна входа через Google, VK и т.п.
import { EventEmitter } from "node:events";
import { createTab } from "./tab.js";
import { createWorld, startAgentChannel } from "./world.js";
import { createInputDispatcher } from "./input-dispatcher.js";
import { createLoadTracker } from "../resources/tracker.js";

/** @typedef {import("../cdp/connection.js").CdpConnection} CdpConnection */
/** @typedef {import("./world.js").AgentHandlers} AgentHandlers */
/** @typedef {import("../../shared/protocol.js").TabInfo} TabInfo */
/** @typedef {{ cdp: CdpConnection, source: string, handlers: AgentHandlers }} ContextDeps */
/** @typedef {Awaited<ReturnType<typeof openContext>>} TabContext */

export const MAX_TABS = 10;
// при переключении агент активной вкладки делает свежий снимок, и копия пересобирается обычным путём
const TAKE_SNAPSHOT = "window.rrweb && window.rrweb.record.takeFullSnapshot(); 0";

/** Сообщения агента фоновой вкладки отбрасываются. @param {() => boolean} isActive @param {AgentHandlers} handlers */
export const onlyWhenActive = (isActive, handlers) =>
  Object.fromEntries(Object.entries(handlers).map(([name, fn]) => [name, (payload) => isActive() && fn(payload)]));

/** @param {ContextDeps} deps @param {string} targetId @param {() => boolean} isActive */
async function openContext({ cdp, source, handlers }, targetId, isActive) {
  const tab = await createTab({ cdp, targetId });
  const tracker = createLoadTracker(tab.session);
  await tracker.enable();
  tab.events.on("document", tracker.forget);
  const world = await createWorld({ tab, source });
  const channel = startAgentChannel({ world, handlers: onlyWhenActive(isActive, handlers) });
  const input = createInputDispatcher({ session: tab.session, world });
  return { id: targetId, tab, tracker, world, channel, input, info: { title: "", url: tab.url } };
}

/** Состояние вкладок без побочных эффектов: что открыто и какая активна. */
export function createTabRegistry() {
  /** @type {Map<string, TabContext>} */
  const tabs = new Map();
  const state = { activeId: /** @type {string | null} */ (null) };
  return {
    tabs,
    state,
    get active() { return tabs.get(state.activeId) ?? null; },
    /** @returns {TabInfo[]} */
    list: () => [...tabs.values()].map((c) => ({ id: c.id, title: c.info.title, url: c.info.url, active: c.id === state.activeId })),
    /** Какую вкладку сделать активной после закрытия этой. @param {string} closedId */
    successor: (closedId) => [...tabs.keys()].filter((id) => id !== closedId).at(-1) ?? null,
  };
}

/** @typedef {ReturnType<typeof createTabRegistry>} TabRegistry */

/** @param {ContextDeps & { startUrl: string }} deps */
export function createTabs({ cdp, source, handlers, startUrl }) {
  const registry = createTabRegistry();
  const events = new EventEmitter();   // changed(list), url(url) — только для активной вкладки
  const changed = () => events.emit("changed", registry.list());
  const adopt = createAdopter({ cdp, source, handlers }, registry, { events, changed });
  const activate = createActivator(cdp, registry, { events, changed, adopt });

  const openNew = async (url = startUrl) => {
    if (registry.tabs.size >= MAX_TABS) return;
    const { targetId } = await cdp.send("Target.createTarget", { url });
    await activate(targetId);
  };
  const forget = createForgetter(registry, { adopt, activate, openNew, changed });
  return {
    events,
    list: registry.list,
    get active() { return registry.active; },
    openNew,
    activate,
    close: (/** @type {string} */ id) => cdp.send("Target.closeTarget", { targetId: id }).catch(() => {}),
    init: () => followTargets({ cdp, registry, startUrl }, { adopt, activate, forget, changed, openNew }),
  };
}

// Закрыли активную — активной становится последняя из оставшихся; закрыли последнюю — открывается стартовая.
/**
 * @param {TabRegistry} registry
 * @param {{ adopt: { drop: (id: string) => void }, activate: (id: string) => Promise<void>, openNew: () => Promise<void>, changed: () => void }} deps
 */
function createForgetter(registry, { adopt, activate, openNew, changed }) {
  return async (/** @type {string} */ id) => {
    const ctx = registry.tabs.get(id);
    if (!ctx) return;
    ctx.channel.stop();
    adopt.drop(id);
    const wasActive = registry.state.activeId === id;
    const next = registry.successor(id);
    registry.tabs.delete(id);
    if (!wasActive) return changed();
    registry.state.activeId = null;
    return next ? activate(next) : openNew();
  };
}

/** Подключение к вкладке ровно один раз, даже если о ней сообщили дважды. */
/** @param {ContextDeps} deps @param {TabRegistry} registry @param {{ events: EventEmitter, changed: () => void }} notify */
function createAdopter(deps, registry, { events, changed }) {
  /** @type {Map<string, Promise<TabContext>>} */
  const pending = new Map();
  const track = (ctx) => {
    const onUrl = (url) => {
      ctx.info.url = url;
      if (registry.state.activeId === ctx.id) events.emit("url", url);
      changed();
    };
    ctx.tab.events.on("document", onUrl);
    ctx.tab.events.on("url", onUrl);
    registry.tabs.set(ctx.id, ctx);
    changed();
    return ctx;
  };
  /** @param {string} targetId */
  const adopt = (targetId) => {
    if (!pending.has(targetId)) pending.set(targetId, openContext(deps, targetId, () => registry.state.activeId === targetId).then(track));
    return pending.get(targetId);
  };
  return Object.assign(adopt, { drop: (/** @type {string} */ id) => pending.delete(id) });
}

/** @param {CdpConnection} cdp @param {TabRegistry} registry @param {{ events: EventEmitter, changed: () => void, adopt: (id: string) => Promise<TabContext> }} deps */
function createActivator(cdp, registry, { events, changed, adopt }) {
  return async (/** @type {string} */ id) => {
    if (registry.state.activeId === id) return;
    const ctx = await adopt(id);
    registry.state.activeId = id;
    await cdp.send("Target.activateTarget", { targetId: id }).catch(() => {});
    await ctx.world.evaluate(TAKE_SNAPSHOT).catch(() => {});
    events.emit("url", ctx.tab.url);
    changed();
  };
}

const TITLE_REFRESH_MS = 1000;

/** @param {TabRegistry} registry @param {{ targetId: string, title: string, url: string }} t */
function applyInfo(registry, t) {
  const ctx = registry.tabs.get(t.targetId);
  if (!ctx || (ctx.info.title === t.title && ctx.info.url === t.url)) return false;
  Object.assign(ctx.info, { title: t.title, url: t.url });
  return true;
}

// Смену заголовка Chrome событием не присылает (только промежуточный — адрес), поэтому сверяем раз в секунду.
/** @param {CdpConnection} cdp @param {TabRegistry} registry @param {() => void} changed */
function refreshTitles(cdp, registry, changed) {
  setInterval(async () => {
    const { targetInfos } = await cdp.send("Target.getTargets").catch(() => ({ targetInfos: [] }));
    const updated = targetInfos.filter((t) => applyInfo(registry, t));
    if (updated.length) changed();
  }, TITLE_REFRESH_MS).unref();
}

/** Вкладки, которые открывает и закрывает сам Chrome или сайт; заголовки для полосы вкладок. */
/**
 * @param {{ cdp: CdpConnection, registry: TabRegistry, startUrl: string }} deps
 * @param {{ adopt: Function, activate: Function, forget: Function, changed: () => void, openNew: Function }} actions
 */
async function followTargets({ cdp, registry }, { adopt, activate, forget, changed, openNew }) {
  cdp.on("Target.targetCreated", ({ targetInfo: t }) => {
    if (t.type !== "page" || registry.tabs.has(t.targetId)) return;
    if (registry.tabs.size >= MAX_TABS) return void cdp.send("Target.closeTarget", { targetId: t.targetId }).catch(() => {});
    activate(t.targetId).catch((e) => console.error("tab:", e.message));
  });
  cdp.on("Target.targetInfoChanged", ({ targetInfo: t }) => applyInfo(registry, t) && changed());
  cdp.on("Target.targetDestroyed", ({ targetId }) => forget(targetId));
  refreshTitles(cdp, registry, changed);
  await cdp.send("Target.setDiscoverTargets", { discover: true });
  const { targetInfos } = await cdp.send("Target.getTargets");
  const pages = targetInfos.filter((t) => t.type === "page");
  for (const page of pages) await adopt(page.targetId);
  return pages.length ? activate(pages[0].targetId) : openNew();
}

/** @typedef {ReturnType<typeof createTabs>} Tabs */
