// @ts-check
// Вход по паролю. Сессия — подписанная метка времени в cookie: переживает перезапуск сервера,
// а смена пароля обнуляет все сессии (ключ подписи выводится из пароля).
import crypto from "node:crypto";
import { sleep } from "../util/async.js";

/** @typedef {import("node:http").IncomingMessage} Request */
/** @typedef {import("node:http").ServerResponse} Response */
/** @typedef {import("./router.js").Route} Route */

const COOKIE = "dm_session";
const SESSION_MAX_AGE_S = 30 * 24 * 3600;
const FAILED_LOGIN_DELAY_MS = 1000;
const MAX_BODY_BYTES = 4096;

/** @param {string} a @param {string} b */
const sameSecret = (a, b) => crypto.timingSafeEqual(crypto.createHash("sha256").update(a).digest(), crypto.createHash("sha256").update(b).digest());

/** @param {Request} req @param {string} name */
export function readCookie(req, name) {
  const pair = (req.headers.cookie ?? "").split(/;\s*/).find((c) => c.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : null;
}

/** @param {Request} req @param {boolean} trustProxy */
export const isHttps = (req, trustProxy) => trustProxy && String(req.headers["x-forwarded-proto"] ?? "").startsWith("https");

/** @param {Request} req */
async function readForm(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_BODY_BYTES) break;
  }
  return new URLSearchParams(body);
}

/** @param {Response} res @param {string} location @param {string} [cookie] */
function redirect(res, location, cookie) {
  res.writeHead(303, { Location: location, ...(cookie ? { "Set-Cookie": cookie } : {}), "Cache-Control": "no-store" });
  res.end();
}

/** @param {{ password: string, trustProxy: boolean }} options */
export function createAuth({ password, trustProxy }) {
  const key = crypto.createHash("sha256").update(`dom-mirror-session:${password}`).digest();
  const mac = (issued) => crypto.createHmac("sha256", key).update(String(issued)).digest("base64url");
  const issue = () => { const now = Math.floor(Date.now() / 1000); return `${now}.${mac(now)}`; };
  const isValid = (token) => {
    const [issued, signature = ""] = String(token).split(".");
    const fresh = Date.now() / 1000 - Number(issued) < SESSION_MAX_AGE_S;
    return fresh && signature.length > 0 && sameSecret(signature, mac(issued));
  };
  const cookie = (req, value, maxAge) =>
    `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${isHttps(req, trustProxy) ? "; Secure" : ""}`;

  return {
    /** @param {Request} req */
    isAuthorized: (req) => isValid(readCookie(req, COOKIE)),
    /** @param {Request} req @param {Response} res */
    login: async (req, res) => {
      const form = await readForm(req);
      if (sameSecret(form.get("password") ?? "", password)) return redirect(res, "/", cookie(req, issue(), SESSION_MAX_AGE_S));
      await sleep(FAILED_LOGIN_DELAY_MS);
      redirect(res, "/login?error=1");
    },
    /** @type {Route} */
    logout: (req, res) => redirect(res, "/login", cookie(req, "", 0)),
  };
}

/** @typedef {ReturnType<typeof createAuth>} Auth */

/** @param {Route} route @param {Auth} auth @returns {Route} */
export const requireLogin = (route, auth) => (req, res, url) => {
  if (auth.isAuthorized(req)) return route(req, res, url);
  if (url.pathname === "/") return redirect(res, "/login");
  res.writeHead(401);
  res.end();
};

/** @param {Record<string, Route>} routes @param {Auth} auth @returns {Record<string, Route>} */
export const guardRoutes = (routes, auth) =>
  Object.fromEntries(Object.entries(routes).map(([path, route]) => [path, requireLogin(route, auth)]));
