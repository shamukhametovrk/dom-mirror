// @ts-check
// Файлы, которые скачивает серверный Chrome, ложатся в папку загрузок под именем guid и отдаются клиенту
// по защищённому адресу /download. Следим через события браузера (Browser.*) — страница их не видит.
import fs from "node:fs";
import path from "node:path";

/** @typedef {import("../cdp/connection.js").CdpConnection} CdpConnection */
/** @typedef {{ id: string, name: string, state: "started" | "done" | "failed" }} DownloadEvent */

const KEEP_MS = 60 * 60 * 1000;
const CLEANUP_EVERY_MS = 10 * 60 * 1000;
const GUID = /^[0-9a-f-]{36}$/i;

/** Удалить файлы старше maxAgeMs (0 — все). @param {string} dir @param {number} maxAgeMs */
export function removeOld(dir, maxAgeMs) {
  const now = Date.now();
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    if (now - fs.statSync(file).mtimeMs >= maxAgeMs) fs.rmSync(file, { force: true });
  }
}

/** @param {Map<string, string>} names @param {(e: DownloadEvent) => void} onEvent */
const progressHandler = (names, onEvent) => ({ guid, state }) => {
  if (state === "inProgress") return;
  onEvent({ id: guid, name: names.get(guid) ?? "file", state: state === "completed" ? "done" : "failed" });
};

/** @param {{ cdp: CdpConnection, dir: string, onEvent: (e: DownloadEvent) => void }} deps */
export async function startDownloads({ cdp, dir, onEvent }) {
  fs.mkdirSync(dir, { recursive: true });
  removeOld(dir, 0);
  /** @type {Map<string, string>} guid → имя, которое предложил сайт */
  const names = new Map();
  cdp.on("Browser.downloadWillBegin", ({ guid, suggestedFilename }) => {
    names.set(guid, suggestedFilename);
    onEvent({ id: guid, name: suggestedFilename, state: "started" });
  });
  cdp.on("Browser.downloadProgress", progressHandler(names, onEvent));
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allowAndName", downloadPath: dir, eventsEnabled: true });
  setInterval(() => removeOld(dir, KEEP_MS), CLEANUP_EVERY_MS).unref();
  return {
    /** @param {string | null} id @returns {{ file: string, name: string } | null} */
    find(id) {
      if (!id || !GUID.test(id) || !names.has(id)) return null;
      const file = path.join(dir, id);
      return fs.existsSync(file) ? { file, name: names.get(id) } : null;
    },
  };
}

/** @typedef {Awaited<ReturnType<typeof startDownloads>>} Downloads */
