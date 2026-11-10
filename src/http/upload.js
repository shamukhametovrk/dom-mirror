// @ts-check
// POST /upload?name=<имя> — тело запроса и есть файл. Ответ: { id }.
import { reply } from "./router.js";
import { MAX_UPLOAD_BYTES } from "../browser/uploads.js";

/** @param {import("node:http").IncomingMessage} req */
const tooLarge = (req) => Number(req.headers["content-length"] ?? 0) > MAX_UPLOAD_BYTES;

/** @param {import("../browser/uploads.js").Uploads} uploads @returns {import("./router.js").Route} */
export const createUploadRoute = (uploads) => async (req, res, url) => {
  if (req.method !== "POST") return reply(res, 405);
  if (tooLarge(req)) return reply(res, 413, "файл слишком большой");
  const id = await uploads.save(url.searchParams.get("name") ?? "file", req).catch(() => null);
  if (!id) return reply(res, 413, "не удалось сохранить файл");
  res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify({ id }));
};
