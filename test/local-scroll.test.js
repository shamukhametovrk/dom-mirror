// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPixelCarry, hasRoom } from "../public/js/local-scroll.js";

test("hasRoom: копия прокручивает только туда, где есть место", () => {
  assert.equal(hasRoom(0, 100, 10), true);
  assert.equal(hasRoom(100, 100, 10), false);
  assert.equal(hasRoom(99.8, 100, 10), false, "дробный остаток у края — места нет");
  assert.equal(hasRoom(0, 100, -10), false);
  assert.equal(hasRoom(50, 100, -10), true);
  assert.equal(hasRoom(50, 100, 0), false);
});

test("createPixelCarry: только целые пиксели, дробный остаток не теряется", () => {
  const pixels = createPixelCarry();
  const steps = [35.2, 22.9, 14.8, 9.6, 6.3, 4.1, 2.7, 1.7, 1.1, 0.7, 0.5, 0.4].map((dy) => pixels.take({ dx: 0, dy }).dy);
  assert.ok(steps.every(Number.isInteger));
  assert.equal(steps.reduce((a, b) => a + b, 0), 100);
  assert.deepEqual(pixels.take({ dx: -0.6, dy: 0 }), { dx: -1, dy: 0 }, "округление до ближайшего");
  assert.deepEqual(pixels.take({ dx: 0.6, dy: 0 }), { dx: 1, dy: 0 }, "и путь возвращается ровно в ноль");
});
