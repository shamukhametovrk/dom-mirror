// @ts-check

/** @typedef {import("node:http").IncomingMessage} Request */
/** @typedef {import("node:http").ServerResponse} Response */
/** @typedef {(req: Request, res: Response, url: URL) => unknown} Route */

/** @param {Response} res @param {number} status @param {string | Buffer} [body] */
export function reply(res, status, body) {
  res.writeHead(status);
  res.end(body);
}

/** @type {Route} */
const notFound = (_req, res) => reply(res, 404);

/** @param {Response} res @param {Error} error */
function fail(res, error) {
  if (!res.headersSent) res.writeHead(500);
  res.end(error.message);
}

/** @param {Record<string, Route>} routes */
export function createRouter(routes) {
  return (/** @type {Request} */ req, /** @type {Response} */ res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const route = Object.hasOwn(routes, url.pathname) ? routes[url.pathname] : notFound;
    Promise.resolve()
      .then(() => route(req, res, url))
      .catch((e) => fail(res, e));
  };
}
