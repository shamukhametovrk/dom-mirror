// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSmoothWheel, easedStep, isNotch } from "../shared/smooth-wheel.js";
import { createInputDispatcher } from "../src/browser/input-dispatcher.js";
import { sleep } from "../src/util/async.js";
import { createFakeSession } from "./fakes.js";

const sum = (xs) => xs.reduce((a, b) => a + b, 0);

test("easedStep: доля оставшегося пути зависит от прошедшего времени, хвост — целиком", () => {
  assert.ok(Math.abs(easedStep(100, 16) - 35) < 1);
  assert.ok(Math.abs(easedStep(-100, 16) + 35) < 1);
  assert.ok(easedStep(100, 32) > easedStep(100, 16));
  assert.equal(easedStep(0.4, 16), 0.4);
  assert.equal(easedStep(0, 16), 0);
});

test("isNotch: щелчок колеса против мелких шагов тачпада", () => {
  assert.equal(isNotch({ dx: 0, dy: 100 }), true);
  assert.equal(isNotch({ dx: -120, dy: 0 }), true);
  assert.equal(isNotch({ dx: 0, dy: 12 }), false);
});

test("анимация проходит ровно весь путь в одну сторону, новые щелчки добавляются", async () => {
  const steps = [];
  const wheel = createSmoothWheel(async (step) => { steps.push(step.dy); });
  wheel.add({ dx: 0, dy: 100 });
  await sleep(40);
  wheel.add({ dx: 0, dy: 100 });
  while (wheel.running) await sleep(10);
  assert.ok(Math.abs(sum(steps) - 200) < 1e-9);
  assert.ok(steps.length > 5);
  assert.ok(steps.every((s) => s > 0));
  assert.ok(Math.abs(steps[0] - 35) < 1, "первый шаг — сразу и примерно треть щелчка");
});

test("диспетчер: щелчок анимируется, тачпад и Ctrl+колесо уходят как есть", async () => {
  const session = createFakeSession();
  const dispatch = createInputDispatcher({ session, world: /** @type {any} */ ({}) });
  const wheels = () => session.calls.filter((c) => c.params.type === "mouseWheel").map((c) => c.params);

  await dispatch({ type: "wheel", x: 1, y: 1, dx: 0, dy: 12 });
  await dispatch({ type: "wheel", x: 1, y: 1, dx: 0, dy: 100, mod: 2 });
  assert.deepEqual(wheels().map((w) => w.deltaY), [12, 100]);

  await dispatch({ type: "wheel", x: 1, y: 1, dx: 0, dy: 100 });
  await sleep(400);
  const animated = wheels().slice(2).map((w) => w.deltaY);
  assert.ok(animated.length > 5);
  assert.ok(Math.abs(sum(animated) - 100) < 1e-9);
});

test("takeRemaining: остаток пути одним куском, анимация останавливается", () => {
  const steps = [];
  const wheel = createSmoothWheel((step) => steps.push(step.dy), () => {});
  wheel.add({ dx: 0, dy: 100 });
  const rest = wheel.takeRemaining();
  assert.equal(wheel.running, false);
  assert.ok(Math.abs(steps[0] + rest.dy - 100) < 1e-9);
});

test("диспетчер: raw-шаг от копии уходит сразу, без серверной анимации", async () => {
  const session = createFakeSession();
  const dispatch = createInputDispatcher({ session, world: /** @type {any} */ ({}) });
  await dispatch({ type: "wheel", x: 1, y: 1, dx: 0, dy: 100, raw: true });
  await sleep(100);
  assert.deepEqual(session.calls.filter((c) => c.params.type === "mouseWheel").map((c) => c.params.deltaY), [100]);
});

test("диспетчер: scrollTo ставит позицию узла в мире агента", async () => {
  const expressions = [];
  const world = /** @type {any} */ ({ evaluate: async (e) => { expressions.push(e); } });
  await createInputDispatcher({ session: createFakeSession(), world })({ type: "scrollTo", id: 7, x: 0, y: 1234.5 });
  assert.match(expressions[0], /getNode\(7\)/);
  assert.match(expressions[0], /top: 1234\.5/);
});
