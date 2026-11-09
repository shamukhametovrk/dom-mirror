// @ts-check
import fs from "node:fs";
import { reply } from "./router.js";

/** Имя файла для заголовка: ASCII-запасной вариант и полное имя в UTF-8 (RFC 6266). @param {string} name */
export function contentDisposition(name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "file";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** @param {import("../browser/downloads.js").Downloads} downloads @returns {import("./router.js").Route} */
export const createDownloadRoute = (downloads) => (_req, res, url) => {
  const found = downloads.find(url.searchParams.get("id"));
  if (!found) return reply(res, 404);
  res.writeHead(200, {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": contentDisposition(found.name),
    "Content-Length": fs.statSync(found.file).size,
    "Cache-Control": "no-store",
  });
  fs.createReadStream(found.file).pipe(res);
};
