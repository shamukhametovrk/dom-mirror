// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createUrlSigner } from "../src/resources/signing.js";
import { createAuth, readCookie, requireLogin } from "../src/http/auth.js";
import { isSameOrigin } from "../src/http/ws.js";
import { createProxyRoute } from "../src/http/proxy.js";
import { createRewriter } from "../src/resources/rewrite.js";

const fakeRes = () => {
  const res = { status: 0, headers: {}, body: "", headersSent: false };
  return Object.assign(res, {
    writeHead(status, headers = {}) { res.status = status; res.headers = headers; return res; },
    end(body = "") { res.body = String(body); },
  });
};
const req = (headers = {}, body = "", method = "GET") => Object.assign(Readable.from([body]), { headers, method });

test("подпись: свой адрес проходит, чужой и подделанный — нет", () => {
  const signer = createUrlSigner();
  const path = signer.sign("https://a.test/x.png?y=1");
  const url = new URL(path, "http://mirror");
  assert.equal(signer.verify(url.searchParams.get("u"), url.searchParams.get("s")), true);
  assert.equal(signer.verify("https://evil.test/", url.searchParams.get("s")), false);
  assert.equal(signer.verify(url.searchParams.get("u"), null), false);
  assert.equal(createUrlSigner().verify(url.searchParams.get("u"), url.searchParams.get("s")), false);
});

test("прокси отвечает 403 на неподписанный адрес и не ходит за ним", async () => {
  const signer = createUrlSigner();
  let fetched = false;
  const route = createProxyRoute({ resolve: async () => { fetched = true; return null; }, stats: {}, signer, rewriter: createRewriter(signer.sign) });
  const res = fakeRes();
  await route(/** @type {any} */ ({}), /** @type {any} */ (res), new URL("http://m/r?u=" + encodeURIComponent("http://127.0.0.1:9222/json")));
  assert.equal(res.status, 403);
  assert.equal(fetched, false);
});

test("вход: верный пароль даёт сессию, неверный — нет", async () => {
  const auth = createAuth({ password: "секрет", trustProxy: false });
  const ok = fakeRes();
  await auth.login(/** @type {any} */ (req({}, "password=%D1%81%D0%B5%D0%BA%D1%80%D0%B5%D1%82", "POST")), /** @type {any} */ (ok));
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.Location, "/");
  const cookie = String(ok.headers["Set-Cookie"]);
  assert.match(cookie, /HttpOnly; SameSite=Strict/);
  const session = cookie.split(";")[0];
  assert.equal(auth.isAuthorized(/** @type {any} */ (req({ cookie: session }))), true);
  assert.equal(createAuth({ password: "другой", trustProxy: false }).isAuthorized(/** @type {any} */ (req({ cookie: session }))), false);
  assert.equal(auth.isAuthorized(/** @type {any} */ (req({ cookie: "dm_session=123.abc" }))), false);
});

test("закрытые маршруты: страница уводит на вход, остальное — 401", () => {
  const auth = createAuth({ password: "p", trustProxy: false });
  const route = requireLogin(() => assert.fail("не должно вызываться"), auth);
  const page = fakeRes();
  route(/** @type {any} */ (req()), /** @type {any} */ (page), new URL("http://m/"));
  assert.equal(page.headers.Location, "/login");
  const api = fakeRes();
  route(/** @type {any} */ (req()), /** @type {any} */ (api), new URL("http://m/debug/state"));
  assert.equal(api.status, 401);
});

test("Origin WebSocket должен совпадать с адресом сервиса", () => {
  const r = (headers) => /** @type {any} */ ({ headers });
  assert.equal(isSameOrigin(r({ host: "m.test:8095", origin: "http://m.test:8095" }), false), true);
  assert.equal(isSameOrigin(r({ host: "m.test:8095", origin: "https://evil.test" }), false), false);
  assert.equal(isSameOrigin(r({ host: "m.test:8095" }), false), false);
  assert.equal(isSameOrigin(r({ host: "127.0.0.1:8080", "x-forwarded-host": "m.test", origin: "https://m.test" }), true), true);
  assert.equal(isSameOrigin(r({ host: "127.0.0.1:8080", "x-forwarded-host": "m.test", origin: "https://m.test" }), false), false);
  assert.equal(readCookie(r({ cookie: "a=1; dm_session=x.y" }), "dm_session"), "x.y");
});
