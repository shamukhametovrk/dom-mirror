// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { createUploads, safeFileName } from "../src/browser/uploads.js";
import { createFileChoosers } from "../src/browser/file-chooser.js";
import { createCommandHandler } from "../src/mirror/commands.js";
import { createFakeSession } from "./fakes.js";
import { sleep } from "../src/util/async.js";

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "dm-uploads-"));

test("имя файла: без пути и управляющих символов", () => {
  assert.equal(safeFileName("../../etc/passwd"), "passwd");
  assert.equal(safeFileName("C:\\Users\\me\\отчёт.pdf"), "отчёт.pdf");
  assert.equal(safeFileName("a\u0000b\nc.txt"), "abc.txt");
  assert.equal(safeFileName(".."), "file");
  assert.equal(safeFileName(""), "file");
});

test("загрузка сохраняется под своим именем; по id отдаётся только известный путь", async () => {
  const uploads = createUploads({ dir: tempDir() });
  const id = await uploads.save("фото.png", Readable.from([Buffer.from("png")]));
  const [file] = uploads.paths([id, "чужой-id"]);
  assert.equal(path.basename(file), "фото.png");
  assert.equal(fs.readFileSync(file, "utf8"), "png");
  assert.deepEqual(uploads.paths(["../../etc/passwd"]), []);
});

test("слишком большой файл не сохраняется", async () => {
  const dir = tempDir();
  const uploads = createUploads({ dir, maxBytes: 4 });
  await assert.rejects(uploads.save("big.bin", Readable.from([Buffer.from("12345")])));
  assert.deepEqual(fs.readdirSync(dir), []);
});

test("окно выбора файла: клиент узнаёт о нём, файлы ставятся в поле по id окна", async () => {
  const published = [];
  const choosers = createFileChoosers({ publish: (c) => published.push(c) });
  const session = createFakeSession({ "DOM.describeNode": { node: { attributes: ["type", "file", "accept", "image/*"] } } });
  await choosers.watch(/** @type {any} */ (session), () => true);
  assert.ok(session.calls.some((c) => c.method === "Page.setInterceptFileChooserDialog" && c.params.enabled));
  session.emit("Page.fileChooserOpened", { backendNodeId: 7, mode: "selectMultiple" });
  await sleep(0);
  assert.equal(published.length, 1);
  assert.deepEqual({ ...published[0], id: "?" }, { id: "?", multiple: true, accept: "image/*" });
  await choosers.attach("другое окно", ["/x"]);
  await choosers.attach(published[0].id, ["/data/uploads/1/a.png"]);
  await choosers.attach(published[0].id, ["/data/uploads/1/a.png"]);
  const set = session.calls.filter((c) => c.method === "DOM.setFileInputFiles");
  assert.deepEqual(set.map((c) => c.params), [{ files: ["/data/uploads/1/a.png"], backendNodeId: 7 }]);
});

test("окно выбора фоновой вкладки клиенту не показывается", async () => {
  const published = [];
  const choosers = createFileChoosers({ publish: (c) => published.push(c) });
  const session = createFakeSession();
  await choosers.watch(/** @type {any} */ (session), () => false);
  session.emit("Page.fileChooserOpened", { backendNodeId: 7, mode: "selectSingle" });
  await sleep(0);
  assert.equal(published.length, 0);
});

test("брошенные файлы: id заменяются путями и уходят в очередь ввода", async () => {
  const inputs = [];
  const handle = createCommandHandler({
    tab: /** @type {any} */ ({}),
    tabs: /** @type {any} */ ({}),
    input: async (msg) => { inputs.push(msg); },
    serial: (task) => task(),
    files: { paths: (ids) => ids.map((id) => `/up/${id}`), attach: async () => {} },
  });
  handle({ type: "drop", x: 1, y: 2, files: ["a", "b"] });
  await sleep(0);
  assert.deepEqual(inputs, [{ type: "drop", x: 1, y: 2, files: ["/up/a", "/up/b"] }]);
});
