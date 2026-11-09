// @ts-check
// Отладка: что на самом деле видит браузер на сервере.

/** @typedef {import("./router.js").Route} Route */

const PAGE_STATE_EXPRESSION = `(() => {
  const idOf = (el) => (window.rrweb ? window.rrweb.record.mirror.getId(el) : null);
  const el = document.activeElement;
  const fields = [...document.querySelectorAll("input, textarea")].map((f) => ({
    tag: f.tagName, type: f.type, name: f.name, id: f.id, value: f.value, rrwebId: idOf(f),
  }));
  return { url: location.href, active: el && { tag: el.tagName, type: el.type, id: el.id, value: el.value }, fields };
})()`;

/** @param {import("node:http").ServerResponse} res @param {unknown} data */
function sendJson(res, data) {
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data, null, 2));
}

/**
 * @param {{
 *   session: import("../cdp/session.js").CdpSession,
 *   world: import("../browser/world.js").World,
 *   stats: () => object,
 * }} deps
 * @returns {Record<string, Route>}
 */
export const debugRoutes = ({ session, world, stats }) => ({
  "/debug/shot.png": async (_req, res) => {
    const { data } = await session.send("Page.captureScreenshot", { format: "png" });
    res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
    res.end(Buffer.from(data, "base64"));
  },
  "/debug/stats": (_req, res) => sendJson(res, stats()),
  "/debug/state": async (_req, res) => sendJson(res, await world.evaluate(PAGE_STATE_EXPRESSION)),
});
