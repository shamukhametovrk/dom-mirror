// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { heldButton, keyEventParams, keyModifiers, normalizeUrl } from "../src/browser/input.js";
import { createInputDispatcher } from "../src/browser/input-dispatcher.js";
import { createFakeSession } from "./fakes.js";

const key = (overrides) => ({
  type: "keydown", key: "a", code: "KeyA", keyCode: 65, loc: 0, repeat: false,
  ctrl: false, alt: false, meta: false, shift: false, altgr: false, ...overrides,
});

test("печатный символ уходит как keyDown с текстом", () => {
  assert.deepEqual(keyEventParams(key({}), "keyDown"), {
    type: "keyDown", key: "a", code: "KeyA", modifiers: 0, windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65,
    location: 0, text: "a", unmodifiedText: "a",
  });
});

test("Enter вводит \\r, служебные клавиши — rawKeyDown без текста", () => {
  assert.equal(keyEventParams(key({ key: "Enter", code: "Enter", keyCode: 13 }), "keyDown").text, "\r");
  const tab = keyEventParams(key({ key: "Tab", code: "Tab", keyCode: 9 }), "keyDown");
  assert.equal(tab.type, "rawKeyDown");
  assert.equal(tab.text, undefined);
});

test("горячие клавиши на кириллице получают латинскую букву", () => {
  const ctrlC = keyEventParams(key({ key: "с", code: "KeyC", ctrl: true }), "keyDown");
  assert.equal(ctrlC.key, "c");
  assert.equal(ctrlC.type, "rawKeyDown");
  assert.equal(ctrlC.modifiers, 2);
  assert.equal(keyEventParams(key({ key: "Ф", code: "KeyA", ctrl: true, shift: true }), "keyDown").key, "A");
});

test("AltGr с Ctrl остаётся вводом символа", () => {
  const p = keyEventParams(key({ key: "@", code: "KeyQ", ctrl: true, alt: true, altgr: true }), "keyDown");
  assert.equal(p.key, "@");
  assert.equal(p.text, "@");
});

test("повтор, keyUp и пропускаемые клавиши", () => {
  assert.equal(keyEventParams(key({ repeat: true }), "keyDown").autoRepeat, true);
  assert.equal(keyEventParams(key({}), "keyUp").text, undefined);
  assert.equal(keyEventParams(key({ key: "Dead" }), "keyDown"), null);
});

test("модификаторы, кнопки и адреса", () => {
  assert.equal(keyModifiers({ alt: true, ctrl: true, meta: true, shift: true }), 15);
  assert.equal(heldButton(0), "none");
  assert.equal(heldButton(2 | 4), "middle");
  assert.equal(normalizeUrl("example.com"), "https://example.com");
  assert.equal(normalizeUrl("http://example.com"), "http://example.com");
});

test("диспетчер: клик двигает мышь, жмёт и отпускает кнопку", async () => {
  const session = createFakeSession();
  const dispatch = createInputDispatcher({ session, world: /** @type {any} */ ({}) });
  await dispatch({ type: "down", x: 10, y: 20, button: "left", count: 1 });
  await dispatch({ type: "up", x: 10, y: 20, button: "left", count: 1 });
  assert.deepEqual(session.calls.map((c) => [c.params.type, c.params.buttons]), [
    ["mouseMoved", 0], ["mousePressed", 1], ["mouseReleased", 0],
  ]);
});

test("диспетчер: пустое значение fill очищает поле клавишей Delete", async () => {
  const session = createFakeSession();
  const world = /** @type {any} */ ({ evaluate: async () => true });
  await createInputDispatcher({ session, world })({ type: "fill", id: 5, value: "" });
  assert.deepEqual(session.calls.map((c) => c.params.type), ["rawKeyDown", "keyUp"]);
});
