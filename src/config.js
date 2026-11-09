// @ts-check

/** @param {string | undefined} value @param {number} fallback */
const toInt = (value, fallback) => {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
};

/** @param {NodeJS.ProcessEnv} env */
export function loadConfig(env = process.env) {
  return Object.freeze({
    port: toInt(env.PORT, 8080),
    startUrl: env.START_URL || "https://ru.wikipedia.org/",
    cdpUrl: env.CDP_URL || "http://127.0.0.1:9222",
    frames: env.FRAMES !== "0",
    settleMs: toInt(env.SETTLE_MS, 80),
  });
}

/** @typedef {ReturnType<typeof loadConfig>} Config */
