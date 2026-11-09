// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { createClipboardWatcher, mayCopy } from "../src/browser/clipboard.js";
import { sleep } from "../src/util/async.js";

test("в клиент уходит только новое: старое содержимое и повторы — нет", async () => {
  let current = { text: "было до запуска" };
  const published = [];
  const watcher = createClipboardWatcher({ read: async () => current, publish: (c) => published.push(c) });
  await watcher.prime();
  watcher.afterInput();
  await sleep(1700);
  assert.deepEqual(published, [], "то, что лежало в буфере до действий, не отправляется");

  current = { text: "скопировал" };
  watcher.afterInput();
  await sleep(1700);
  assert.deepEqual(published, [{ text: "скопировал" }], "новое — ровно один раз, хотя проверок было несколько");
});

test("пустой буфер ничего не отправляет", async () => {
  const published = [];
  const watcher = createClipboardWatcher({ read: async () => null, publish: (c) => published.push(c) });
  await watcher.prime();
  watcher.afterInput();
  await sleep(1700);
  assert.deepEqual(published, []);
});

test("буфер проверяется после клика и сочетаний с Ctrl/Cmd, но не после обычных клавиш и движений", () => {
  const key = (over) => ({ type: "keydown", key: "c", code: "KeyC", keyCode: 67, loc: 0, repeat: false, ctrl: false, alt: false, meta: false, shift: false, altgr: false, ...over });
  assert.equal(mayCopy(/** @type {any} */ ({ type: "up", x: 1, y: 1, button: "left", count: 1 })), true);
  assert.equal(mayCopy(/** @type {any} */ (key({ ctrl: true }))), true);
  assert.equal(mayCopy(/** @type {any} */ (key({ meta: true }))), true);
  assert.equal(mayCopy(/** @type {any} */ (key({}))), false);
  assert.equal(mayCopy(/** @type {any} */ ({ type: "move", x: 1, y: 1 })), false);
});
