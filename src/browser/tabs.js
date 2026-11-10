// @ts-check
// Вкладки — настоящие вкладки Chrome: по одной постоянной на каждый сайт из списка, плюс окна, которые открыл сам
// сайт (вход через Google и т.п.) — у них сохраняется window.opener. Копируется активная вкладка.
import { EventEmitter } from "node:events";
import { createTab } from "./tab.js";
import { createWorld, startAgentChannel } from "./world.js";
import { createInputDispatcher } from "./input-dispatcher.js";
import { createLoadTracker } from "../resources/tracker.js";
import { planSites } from "./sites.js";

/** @typedef {import("../cdp/connection.js").CdpConnection} CdpConnection */
/** @typedef {import("./world.js").AgentHandlers} AgentHandlers */
/** @typedef {import("./sites.js").Site} Site */
/** @typedef {import("./file-chooser.js").FileChoosers} FileChoosers */
/** @typedef {import("../../shared/protocol.js").TabInfo} TabInfo */
/** @typedef {{ cdp: CdpConnection, source: string, handlers: AgentHandlers, choosers: FileChoosers }} ContextDeps */
/** @typedef {Awaited<ReturnType<typeof openContext>>} TabContext */

export const MAX_POPUPS = 5;
// при переключении агент делает свежий снимок и заново сообщает фокус — копия пересобирается обычным путём
const TAKE_SNAPSHOT = "window.rrweb && window.rrweb.record.takeFullSnapshot(); window.__mirrorRefresh && window.__mirrorRefresh(); 0";

/** Сообщения агента фоновой вкладки отбрасываются. @param {() => boolean} isActive @param {AgentHandlers} handlers */
export const onlyWhenActive = (isActive, handlers) =>
  Object.fromEntries(Object.entries(handlers).map(([name, fn]) => [name, (payload) => isActive() && fn(payload)]));

/** @param {ContextDeps} deps @param {string} targetId @param {() => boolean} isActive */
async function openContext({ cdp, source, handlers, choosers }, targetId, isActive) {
  const tab = await createTab({ cdp, targetId });
  const tracker = createLoadTracker(tab.session);
  await tracker.enable();
  tab.events.on("document", tracker.forget);
  await choosers.watch(tab.session, isActive);
  const world = await createWorld({ tab, source });
  const channel = startAgentChannel({ world, handlers: onlyWhenActive(isActive, handlers) });
  const input = createInputDispatcher({ session: tab.session, world });
  const site = /** @type {Site | null} */ (null);
  return { id: targetId, tab, tracker, world, channel, input, site, info: { title: "", url: tab.url } };
}

/** @param {TabContext} c @param {string | null} activeId @returns {TabInfo} */
const describe = (c, activeId) => ({
  id: c.id, title: c.site?.name ?? c.info.title, url: c.info.url, active: c.id === activeId, pinned: Boolean(c.site),
});

/** Состояние вкладок без побочных эффектов: что открыто и какая активна. @param {Site[]} sites */
export function createTabRegistry(sites) {
  /** @type {Map<string, TabContext>} */
  const tabs = new Map();
  const state = { activeId: /** @type {string | null} */ (null), previousId: /** @type {string | null} */ (null) };
  const ordered = () => [...tabs.values()].sort((a, b) => rank(a) - rank(b));
  const rank = (/** @type {TabContext} */ c) => (c.site ? sites.indexOf(c.site) : sites.length);
  return {
    tabs,
    state,
    get active() { return tabs.get(state.activeId) ?? null; },
    popups: () => [...tabs.values()].filter((c) => !c.site).length,
    /** @returns {TabInfo[]} */
    list: () => ordered().map((c) => describe(c, state.activeId)),
    /** Куда вернуться после закрытия окна: в вкладку, с которой его открыли, иначе в первую. @param {string} closedId */
    fallback: (closedId) => [state.previousId, ordered()[0]?.id].find((id) => id && id !== closedId && tabs.has(id)) ?? null,
  };
}

/** @typedef {ReturnType<typeof createTabRegistry>} TabRegistry */

/** @param {ContextDeps & { sites: Site[] }} deps */
export function createTabs({ sites, ...deps }) {
  const { cdp } = deps;
  const registry = createTabRegistry(sites);
  const events = new EventEmitter();   // changed(list), url(url) — только для активной вкладки
  const changed = () => events.emit("changed", registry.list());
  const adopt = createAdopter(deps, registry, { events, changed });
  const activate = createActivator(cdp, registry, { events, changed, adopt });
  const openSite = async (/** @type {Site} */ site) => {
    const { targetId } = await cdp.send("Target.createTarget", { url: site.url });
    return claim(await adopt(targetId), site, changed);
  };
  const forget = createForgetter(registry, { adopt, activate, openSite, changed });
  return {
    events,
    list: registry.list,
    get active() { return registry.active; },
    activate,
    close: (/** @type {string} */ id) => registry.tabs.get(id)?.site
      || cdp.send("Target.closeTarget", { targetId: id }).catch(() => {}),
    init: () => followTargets({ cdp, registry, sites }, { adopt, activate, forget, changed, openSite }),
  };
}

/** @param {TabContext} ctx @param {Site} site @param {() => void} changed */
function claim(ctx, site, changed) {
  ctx.site = site;
  changed();
  return ctx;
}

// Закрыли окно — возвращаемся туда, откуда его открыли. Вкладку сайта закрыть нельзя: если её закрыл сам сайт,
// открываем заново.
/**
 * @param {TabRegistry} registry
 * @param {{ adopt: { drop: (id: string) => void }, activate: (id: string) => Promise<void>,
 *   openSite: (site: Site) => Promise<TabContext>, changed: () => void }} deps
 */
function createForgetter(registry, { adopt, activate, openSite, changed }) {
  /** @param {TabContext} ctx @returns {Promise<string | null>} */
  const successor = async (ctx) => (ctx.site ? (await openSite(ctx.site)).id : registry.fallback(ctx.id));
  const replace = async (/** @type {TabContext} */ ctx, /** @type {boolean} */ wasActive) => {
    const next = await successor(ctx);
    return wasActive && next ? activate(next) : changed();
  };
  return async (/** @type {string} */ id) => {
    const ctx = registry.tabs.get(id);
    if (!ctx) return;
    ctx.channel.stop();
    adopt.drop(id);
    registry.tabs.delete(id);
    const wasActive = registry.state.activeId === id;
    if (wasActive) registry.state.activeId = null;
    return replace(ctx, wasActive);
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
    return ctx;
  };
  /** @param {string} targetId */
  const adopt = (targetId) => {
    if (!pending.has(targetId)) pending.set(targetId, openContext(deps, targetId, () => registry.state.activeId === targetId).then(track));
    return pending.get(targetId);
  };
  return Object.assign(adopt, { drop: (/** @type {string} */ id) => pending.delete(id) });
}

// Фокус клавиатуры: без эмуляции фокуса страница, у которой его забрал Chrome (адресная строка после открытия
// вкладки), не получает нажатий. Фоновым вкладкам эмуляцию выключаем — у настоящего браузера фокус только у одной.
/** @param {CdpConnection} cdp @param {TabRegistry} registry @param {{ events: EventEmitter, changed: () => void, adopt: (id: string) => Promise<TabContext> }} deps */
function createActivator(cdp, registry, { events, changed, adopt }) {
  return async (/** @type {string} */ id) => {
    if (registry.state.activeId === id) return;
    const ctx = await adopt(id);
    const previous = registry.active;
    Object.assign(registry.state, { previousId: registry.state.activeId, activeId: id });
    await previous?.tab.setFocused(false);
    await cdp.send("Target.activateTarget", { targetId: id }).catch(() => {});
    await ctx.tab.setFocused(true);
    events.emit("activated", id);
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

// Окно, которое открыл сайт (у него есть openerId), становится активным. Сверх лимита — закрывается.
/** @param {CdpConnection} cdp @param {TabRegistry} registry @param {(id: string) => Promise<void>} activate */
function onTargetCreated(cdp, registry, activate) {
  const opening = new Set();
  return ({ targetInfo: t }) => {
    if (t.type !== "page" || !t.openerId || registry.tabs.has(t.targetId)) return;
    if (registry.popups() + opening.size >= MAX_POPUPS) return void cdp.send("Target.closeTarget", { targetId: t.targetId }).catch(() => {});
    opening.add(t.targetId);
    activate(t.targetId).catch((e) => console.error("tab:", e.message)).finally(() => opening.delete(t.targetId));
  };
}

/** Вкладки сайтов при запуске: подхватываем оставшиеся с прошлого раза, недостающие открываем. */
/**
 * @param {{ cdp: CdpConnection, registry: TabRegistry, sites: Site[] }} deps
 * @param {{ adopt: (id: string) => Promise<TabContext>, openSite: (site: Site) => Promise<TabContext>, changed: () => void }} actions
 */
async function claimSites({ cdp, sites }, actions) {
  const { targetInfos } = await cdp.send("Target.getTargets");
  const pages = targetInfos.filter((t) => t.type === "page").map((t) => ({ id: t.targetId, url: t.url }));
  const { claims, extra } = planSites(sites, pages);
  for (const id of extra) await cdp.send("Target.closeTarget", { targetId: id }).catch(() => {});
  for (const c of claims) await (c.id ? reuseTab(c, actions) : actions.openSite(c.site));
}

/** @param {import("./sites.js").SiteClaim} c @param {{ adopt: (id: string) => Promise<TabContext>, changed: () => void }} actions */
async function reuseTab({ site, id, navigate }, { adopt, changed }) {
  const ctx = claim(await adopt(id), site, changed);
  if (navigate) await ctx.tab.navigate(site.url).catch((e) => console.error("site:", e.message));
}

/**
 * @param {{ cdp: CdpConnection, registry: TabRegistry, sites: Site[] }} deps
 * @param {{ adopt: (id: string) => Promise<TabContext>, activate: (id: string) => Promise<void>, forget: (id: string) => Promise<void>,
 *   changed: () => void, openSite: (site: Site) => Promise<TabContext> }} actions
 */
async function followTargets(deps, actions) {
  const { cdp, registry } = deps;
  cdp.on("Target.targetCreated", onTargetCreated(cdp, registry, actions.activate));
  cdp.on("Target.targetInfoChanged", ({ targetInfo: t }) => applyInfo(registry, t) && actions.changed());
  cdp.on("Target.targetDestroyed", ({ targetId }) => actions.forget(targetId));
  refreshTitles(cdp, registry, actions.changed);
  await cdp.send("Target.setDiscoverTargets", { discover: true });
  await claimSites(deps, actions);
  return actions.activate(registry.list()[0].id);
}

/** @typedef {ReturnType<typeof createTabs>} Tabs */
