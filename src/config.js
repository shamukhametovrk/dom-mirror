// @ts-check
import path from "node:path";

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
    startUrl: orDefault(env.START_URL, "https://ru.wikipedia.org/"),
    cdpUrl: orDefault(env.CDP_URL, "http://127.0.0.1:9222"),
    frames: env.FRAMES !== "0",
    settleMs: toInt(env.SETTLE_MS, 80),
    password: orDefault(env.PASSWORD, ""),
    passwordFile: orDefault(env.PASSWORD_FILE, path.join(orDefault(env.DATA_DIR, ".data"), "password")),
    trustProxy: isOn(env.TRUST_PROXY),
    debug: isOn(env.DEBUG),
  });
}

/** @typedef {ReturnType<typeof loadConfig>} Config */
