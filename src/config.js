// @ts-check
import path from "node:path";
import { DEFAULT_SITES, parseSites } from "./browser/sites.js";

/** @param {string | undefined} value @param {number} fallback */
const toInt = (value, fallback) => {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
};

/** @param {string | undefined} value */
const isOn = (value) => ["1", "true", "yes", "on"].includes(String(value).toLowerCase());

/** @param {string | undefined} value @param {string} fallback */
const orDefault = (value, fallback) => value || fallback;

/** @param {NodeJS.ProcessEnv} env */
export function loadConfig(env = process.env) {
  return Object.freeze({
    port: toInt(env.PORT, 8080),
    sites: parseSites(orDefault(env.SITES, DEFAULT_SITES)),
    cdpUrl: orDefault(env.CDP_URL, "http://127.0.0.1:9222"),
    password: orDefault(env.PASSWORD, ""),
    passwordFile: orDefault(env.PASSWORD_FILE, path.join(orDefault(env.DATA_DIR, ".data"), "password")),
    downloadsDir: path.join(orDefault(env.DATA_DIR, ".data"), "downloads"),
    uploadsDir: path.join(orDefault(env.DATA_DIR, ".data"), "uploads"),
    trustProxy: isOn(env.TRUST_PROXY),
    debug: isOn(env.DEBUG),
  });
}

/** @typedef {ReturnType<typeof loadConfig>} Config */
