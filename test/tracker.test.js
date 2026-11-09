// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { createLoadTracker, withoutHash } from "../src/resources/tracker.js";
import { createResourceResolver, acceptLanguage } from "../src/resources/resolvers.js";
import { createFakeSession } from "./fakes.js";

const request = (requestId, url, type = "Image") => ({ requestId, type, request: { method: "GET", url } });

test("отдаёт тело ответа, который Chrome уже загрузил, с учётом редиректа", async () => {
  const session = createFakeSession({ "Network.getResponseBody": { body: "aGk=", base64Encoded: true } });
  const tracker = createLoadTracker(session);
  session.emit("Network.requestWillBeSent", request("1", "https://a.test/x.png#frag"));
  session.emit("Network.requestWillBeSent", { ...request("1", "https://b.test/y.png"), redirectResponse: {} });
  session.emit("Network.responseReceived", { requestId: "1", response: { status: 200, headers: { "Content-Type": "image/png" } } });
  session.emit("Network.loadingFinished", { requestId: "1" });

  const res = await tracker.lookup("https://a.test/x.png");
  assert.deepEqual(res, { status: 200, type: "image/png", body: Buffer.from("hi"), url: "https://b.test/y.png" });
});

test("ждёт окончания загрузки и не отдаёт неудачные", async () => {
  const session = createFakeSession({ "Network.getResponseBody": { body: "ok", base64Encoded: false } });
  const tracker = createLoadTracker(session);
  session.emit("Network.requestWillBeSent", request("1", "https://a.test/ok.css", "Stylesheet"));
  session.emit("Network.requestWillBeSent", request("2", "https://a.test/bad.css", "Stylesheet"));
  const pending = tracker.lookup("https://a.test/ok.css");
  session.emit("Network.responseReceived", { requestId: "1", response: { status: 200, headers: {}, mimeType: "text/css" } });
  session.emit("Network.loadingFinished", { requestId: "1" });
  session.emit("Network.loadingFailed", { requestId: "2" });

  assert.equal((await pending).type, "text/css");
  assert.equal(await tracker.lookup("https://a.test/bad.css"), null);
});

test("не следит за POST и документами, забывает при навигации", () => {
  const session = createFakeSession();
  const tracker = createLoadTracker(session);
  session.emit("Network.requestWillBeSent", { ...request("1", "https://a.test/"), type: "Document" });
  session.emit("Network.requestWillBeSent", { requestId: "2", type: "Image", request: { method: "POST", url: "https://a.test/p" } });
  session.emit("Network.requestWillBeSent", request("3", "https://a.test/i.png"));
  assert.equal(tracker.size, 1);
  tracker.forget();
  assert.equal(tracker.size, 0);
});

test("цепочка стратегий берёт первый успешный результат", async () => {
  const resource = { status: 200, type: "x", body: Buffer.alloc(0), url: "u" };
  const resolve = createResourceResolver([
    { name: "a", load: async () => { throw new Error("no"); } },
    { name: "b", load: async () => null },
    { name: "c", load: async () => resource },
  ]);
  assert.deepEqual(await resolve("u"), { ...resource, via: "c" });
  assert.equal(await createResourceResolver([])("u"), null);
});

test("вспомогательные функции", () => {
  assert.equal(withoutHash("https://a.test/x#y"), "https://a.test/x");
  assert.equal(withoutHash("not a url"), "not a url");
  assert.equal(acceptLanguage(["ru-RU", "ru", "en"]), "ru-RU,ru;q=0.9,en;q=0.8");
});
