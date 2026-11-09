// @ts-check
// Изолированный мир: отдельный JS-контекст над теми же DOM-узлами, страница не видит ни rrweb, ни очереди.
import { DRAIN_GLOBAL } from "../agent/channel.js";
import { repeat } from "../util/async.js";

const WORLD_NAME = "mirror-world";
const DRAIN_EXPRESSION = `window.${DRAIN_GLOBAL} ? window.${DRAIN_GLOBAL}() : null`;

/** @typedef {import("./tab.js").Tab} Tab */
/** @typedef {Awaited<ReturnType<typeof createWorld>>} World */
/** @typedef {Record<string, (payload: string) => void>} AgentHandlers */

/** @param {{ tab: Tab, bus: import("node:events").EventEmitter, source: string }} deps */
export async function createWorld({ tab, bus, source }) {
  let contextId = null;
  bus.on("document", () => { contextId = null; });
  await tab.session.send("Page.addScriptToEvaluateOnNewDocument", { source, worldName: WORLD_NAME });

  const resolveContext = async () => {
    const world = await tab.session.send("Page.createIsolatedWorld", { frameId: tab.frameId, worldName: WORLD_NAME });
    return (contextId = world.executionContextId);
  };
  const run = async (expression) => tab.session.send("Runtime.evaluate", {
    expression, contextId: contextId ?? (await resolveContext()), returnByValue: true, awaitPromise: true,
  });
  const forgetContext = () => { contextId = null; };
  const runWithRetry = (expression) => run(expression)
    .catch(() => { forgetContext(); return run(expression); })
    .catch((e) => { forgetContext(); throw e; });

  /** @param {string} expression */
  async function evaluate(expression) {
    const { result, exceptionDetails } = await runWithRetry(expression);
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
  }
  return { evaluate };
}

/** @param {{ world: World, handlers: AgentHandlers, intervalMs?: number }} deps */
export function startAgentChannel({ world, handlers, intervalMs = 20 }) {
  const dispatch = ([name, payload]) => {
    try { handlers[name]?.(payload); } catch (e) { console.error(name, e.message); }
  };
  const drain = async () => {
    const items = await world.evaluate(DRAIN_EXPRESSION).catch(() => null);
    for (const item of items ?? []) dispatch(item);
  };
  repeat("drain", intervalMs, drain);
}
