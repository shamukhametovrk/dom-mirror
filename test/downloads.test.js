// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { removeOld, startDownloads } from "../src/browser/downloads.js";
import { contentDisposition } from "../src/http/download.js";

const GUID = "0b8a3c1e-1234-4abc-9def-0123456789ab";

function fakeBrowser() {
  const listeners = new Map();
  const calls = [];
  return {
    calls,
    emit: (method, params) => (listeners.get(method) ?? []).forEach((fn) => fn(params)),
    cdp: /** @type {any} */ ({
      send: async (method, params) => { calls.push({ method, params }); return {}; },
      on: (method, fn) => listeners.set(method, [...(listeners.get(method) ?? []), fn]),
    }),
  };
}

test("загрузки Chrome идут в папку по guid, клиент узнаёт о начале и конце", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dm-dl-"));
  const browser = fakeBrowser();
  const events = [];
  const downloads = await startDownloads({ cdp: browser.cdp, dir, onEvent: (e) => events.push(e) });
  assert.deepEqual(browser.calls[0], { method: "Browser.setDownloadBehavior", params: { behavior: "allowAndName", downloadPath: dir, eventsEnabled: true } });

  browser.emit("Browser.downloadWillBegin", { guid: GUID, suggestedFilename: "отчёт.pdf" });
  browser.emit("Browser.downloadProgress", { guid: GUID, state: "inProgress" });
  assert.equal(downloads.find(GUID), null, "файла ещё нет");
  fs.writeFileSync(path.join(dir, GUID), "data");
  browser.emit("Browser.downloadProgress", { guid: GUID, state: "completed" });

  assert.deepEqual(events, [
    { id: GUID, name: "отчёт.pdf", state: "started" },
    { id: GUID, name: "отчёт.pdf", state: "done" },
  ]);
  assert.deepEqual(downloads.find(GUID), { file: path.join(dir, GUID), name: "отчёт.pdf" });
});

test("чужие и кривые id не отдаются", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dm-dl-"));
  const downloads = await startDownloads({ cdp: fakeBrowser().cdp, dir, onEvent: () => {} });
  fs.writeFileSync(path.join(dir, GUID), "data");
  assert.equal(downloads.find(GUID), null, "Chrome о такой загрузке не сообщал");
  assert.equal(downloads.find("../password"), null);
  assert.equal(downloads.find(null), null);
});

test("старые файлы удаляются, свежие остаются", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dm-dl-"));
  fs.writeFileSync(path.join(dir, "old"), "x");
  fs.writeFileSync(path.join(dir, "new"), "x");
  const hourAgo = new Date(Date.now() - 2 * 3600 * 1000);
  fs.utimesSync(path.join(dir, "old"), hourAgo, hourAgo);
  removeOld(dir, 3600 * 1000);
  assert.deepEqual(fs.readdirSync(dir), ["new"]);
});

test("имя файла в заголовке: запасное ASCII и полное в UTF-8", () => {
  assert.equal(contentDisposition("отчёт \"Q1\".pdf"), `attachment; filename="_____ _Q1_.pdf"; filename*=UTF-8''${encodeURIComponent("отчёт \"Q1\".pdf")}`);
  assert.equal(contentDisposition("a.txt"), `attachment; filename="a.txt"; filename*=UTF-8''a.txt`);
});
