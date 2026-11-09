// @ts-check
import fs from "node:fs";
import path from "node:path";
import { reply } from "./router.js";

/** @typedef {import("./router.js").Route} Route */

const JS = "application/javascript; charset=utf-8";

/** @param {string} file @param {string} type @returns {Route} */
export const serveFile = (file, type) => (_req, res) => {
  fs.createReadStream(file)
    .once("open", () => res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" }))
    .on("error", () => reply(res, 404))
    .pipe(res);
};

/** @param {string} dir @param {string} prefix */
const scriptRoutes = (dir, prefix) => Object.fromEntries(fs.readdirSync(dir)
  .filter((name) => name.endsWith(".js"))
  .map((name) => [`${prefix}/${name}`, serveFile(path.join(dir, name), JS)]));

/** @param {{ root: string, rrwebDir: string }} dirs @returns {Record<string, Route>} */
export const staticRoutes = ({ root, rrwebDir }) => ({
  "/": serveFile(path.join(root, "public/index.html"), "text/html; charset=utf-8"),
  "/rrweb.js": serveFile(path.join(rrwebDir, "rrweb.umd.min.cjs"), JS),
  "/rrweb.css": serveFile(path.join(rrwebDir, "style.css"), "text/css; charset=utf-8"),
  ...scriptRoutes(path.join(root, "public/js"), "/js"),
  ...scriptRoutes(path.join(root, "shared"), "/shared"),
});
