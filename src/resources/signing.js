// @ts-check
// Прокси отдаёт только адреса, которые сервер сам вставил в копию: без подписи /r был бы открытым
// прокси с cookies серверного браузера. Секрет живёт в памяти, после перезапуска копия переподписывается.
import crypto from "node:crypto";

export const PROXY_PATH = "/r";
export const PROXY_PREFIX = `${PROXY_PATH}?u=`;
const SIGNATURE_LENGTH = 22;

/** @param {Buffer} [secret] */
export function createUrlSigner(secret = crypto.randomBytes(32)) {
  /** @param {string} href */
  const mac = (href) => crypto.createHmac("sha256", secret).update(href).digest("base64url").slice(0, SIGNATURE_LENGTH);
  return {
    /** @param {string} href */
    sign: (href) => `${PROXY_PREFIX}${encodeURIComponent(href)}&s=${mac(href)}`,
    /** @param {string} href @param {string | null} signature */
    verify: (href, signature) => signature?.length === SIGNATURE_LENGTH
      && crypto.timingSafeEqual(Buffer.from(mac(href)), Buffer.from(signature)),
  };
}

/** @typedef {ReturnType<typeof createUrlSigner>} UrlSigner */
