// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { advance, isFarJump } from "../public/js/scroll-smoother.js";

test("advance: копия догоняет цель, быстрее при большем шаге времени, и встаёт точно", () => {
  const a = { x: 0, y: 0, tx: 0, ty: 100 };
  const b = { x: 0, y: 0, tx: 0, ty: 100 };
  advance(a, 16);
  advance(b, 32);
  assert.ok(a.y > 40 && a.y < 60);
  assert.ok(b.y > a.y);
  let done = false;
  for (let i = 0; i < 100 && !done; i++) done = advance(a, 16);
  assert.equal(done, true);
  assert.equal(a.y, 100);
});

test("isFarJump: далёкий переход применяется сразу", () => {
  assert.equal(isFarJump({ x: 0, y: 0, tx: 0, ty: 100 }), false);
  assert.equal(isFarJump({ x: 0, y: 5000, tx: 0, ty: 0 }), true);
});
