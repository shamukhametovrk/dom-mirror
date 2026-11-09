// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { diffFrame } from "../src/browser/frame-capture.js";
import { createHub, REPLACED_CLOSE_CODE } from "../src/mirror/hub.js";
import { createRewriter } from "../src/resources/rewrite.js";

const rewriter = createRewriter((href) => "/r?u=" + encodeURIComponent(href));

const rect = { id: 1, x: 0, y: 0, w: 50, h: 50 };

test("diffFrame: новый кадр, тот же кадр, сдвиг без кадра", () => {
  const first = diffFrame(undefined, rect, Buffer.from("A"));
  assert.equal(first.changed, true);
  assert.equal(first.update.img, Buffer.from("A").toString("base64"));

  const same = diffFrame(first.state, rect, Buffer.from("A"));
  assert.equal(same.changed, false);
  assert.equal(same.update.img, undefined);
  assert.equal(same.state.img, first.state.img);

  const moved = diffFrame(first.state, { ...rect, x: 5 }, null);
  assert.equal(moved.changed, true);
  assert.equal(moved.state.hash, first.state.hash);
});

const fakeFrames = () => {
  const calls = { clear: 0 };
  return { calls, frames: /** @type {any} */ ({ clearRects: () => calls.clear++, snapshot: () => [] }) };
};
const fakeClient = () => {
  const sent = [];
  const closed = [];
  return { sent, closed, client: { readyState: 1, send: (data) => sent.push(JSON.parse(data)), close: (code) => closed.push(code) } };
};

test("hub: новый клиент получает состояние, Meta начинает страницу заново", () => {
  const { calls, frames } = fakeFrames();
  const hub = createHub({ startUrl: "https://a.test/", currentUrl: () => "https://a.test/now", tabs: () => [], frames, rewriter });
  hub.recordEvent({ type: 3, data: { source: 0, adds: [] } });
  hub.recordEvent({ type: 4, data: { href: "https://b.test/" } });
  hub.recordEvent({ type: 2, data: { node: { type: 2, tagName: "img", attributes: { src: "i.png" }, childNodes: [] } } });

  const { sent, client } = fakeClient();
  hub.join(client);
  assert.equal(calls.clear, 1);
  assert.equal(hub.base, "https://b.test/");
  assert.deepEqual(sent.map((m) => m.type), ["tabs", "url", "events", "focus", "frames"]);
  assert.equal(sent[1].url, "https://a.test/now");
  assert.equal(sent[2].events.length, 2);
  assert.equal(sent[2].events[1].data.node.attributes.src, "/r?u=" + encodeURIComponent("https://b.test/i.png"));
});

test("hub: одна сессия — новое подключение вытесняет прежнее", () => {
  const hub = createHub({ startUrl: "https://a.test/", currentUrl: () => "", tabs: () => [], frames: fakeFrames().frames, rewriter });
  const first = fakeClient();
  const second = fakeClient();
  hub.join(first.client);
  hub.join(second.client);
  assert.deepEqual(first.sent.at(-1), { type: "replaced" });
  assert.deepEqual(first.closed, [REPLACED_CLOSE_CODE]);
  assert.equal(hub.size, 1);
  first.sent.length = 0;
  second.sent.length = 0;
  hub.setCursor("url(c.cur), pointer");
  assert.deepEqual(first.sent, []);
  assert.deepEqual(second.sent, [{ type: "cursor", cursor: `url(${"/r?u=" + encodeURIComponent("https://a.test/c.cur")}), pointer` }]);
});
