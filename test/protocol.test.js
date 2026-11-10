// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { isImmediate, parseClientMessage } from "../shared/protocol.js";

const parse = (msg) => parseClientMessage(JSON.stringify(msg));

test("принимает корректные сообщения", () => {
  assert.ok(parse({ type: "move", x: 1, y: 2 }));
  assert.ok(parse({ type: "down", x: 1, y: 2, button: "left", count: 1, mod: 2 }));
  assert.ok(parse({ type: "text", text: "привет" }));
  assert.ok(parse({ type: "reload" }));
});

test("отбрасывает мусор", () => {
  assert.equal(parseClientMessage("{not json"), null);
  assert.equal(parseClientMessage("null"), null);
  assert.equal(parse({ type: "unknown" }), null);
  assert.equal(parse({ type: "toString" }), null);
  assert.equal(parse({ type: "move", x: "1", y: 2 }), null);
  assert.equal(parse({ type: "down", x: 1, y: 2, button: "side", count: 1 }), null);
  assert.equal(parse({ type: "viewport", w: Infinity, h: 1 }), null);
  assert.equal(parse({ type: "attach", chooser: "c", files: [1] }), null);
  assert.equal(parse({ type: "drop", x: 1, y: 1, files: Array(21).fill("f") }), null);
});

test("различает команды и ввод", () => {
  assert.equal(isImmediate({ type: "goto", url: "x" }), true);
  assert.equal(isImmediate({ type: "text", text: "x" }), false);
  assert.equal(isImmediate({ type: "drop", x: 1, y: 1, files: [] }), false);
  assert.equal(isImmediate({ type: "attach", chooser: "c", files: [] }), true);
});
