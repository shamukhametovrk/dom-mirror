// @ts-check
// Ctrl+C и кнопки «Копировать» на сайтах кладут данные в буфер обмена сервера (X11 виртуального экрана),
// а не пользователя. Читаем его через xclip — страница этого не видит — и отдаём клиенту.
// Проверяем только после действий пользователя (клик, сочетание с Ctrl/Cmd), а не постоянным опросом.
import crypto from "node:crypto";
import { execFile } from "node:child_process";

/** @typedef {{ text: string } | { image: string }} ClipboardContent image — PNG в base64 */

const MAX_BYTES = 5 * 1024 * 1024;
const CHECK_AFTER_MS = [150, 600, 1500];   // кнопки копирования пишут в буфер не сразу

/** @param {string[]} args @param {BufferEncoding | "buffer"} encoding @returns {Promise<string | Buffer | null>} */
const xclip = (args, encoding) => new Promise((resolve) => {
  const options = { encoding, timeout: 1000, maxBuffer: MAX_BYTES };
  execFile("xclip", ["-selection", "clipboard", "-o", ...args], options, (err, out) => resolve(err ? null : out));
});

/** @returns {Promise<ClipboardContent | null>} */
async function readImage() {
  const png = await xclip(["-t", "image/png"], "buffer");
  return png ? { image: png.toString("base64") } : null;
}

/** @returns {Promise<ClipboardContent | null>} */
async function readText() {
  const text = await xclip(["-t", "UTF8_STRING"], "utf8");
  return typeof text === "string" && text ? { text } : null;
}

/** @returns {Promise<ClipboardContent | null>} */
export async function readClipboard() {
  const targets = String((await xclip(["-t", "TARGETS"], "utf8")) ?? "").split("\n");
  return targets.includes("image/png") ? readImage() : readText();
}

/** @param {ClipboardContent} content */
const fingerprint = (content) => crypto.createHash("sha1").update(JSON.stringify(content)).digest("hex");

/** @param {{ read?: () => Promise<ClipboardContent | null>, publish: (c: ClipboardContent) => void }} deps */
export function createClipboardWatcher({ read = readClipboard, publish }) {
  let last = null;
  let timers = [];
  const check = async (announce) => {
    const content = await read();
    const key = content && fingerprint(content);
    if (!key || key === last) return;
    last = key;
    if (announce) publish(content);
  };
  return {
    /** Запомнить, что уже лежит в буфере, чтобы не отправить клиенту старое. */
    prime: () => check(false),
    afterInput() {
      timers.forEach(clearTimeout);
      timers = CHECK_AFTER_MS.map((ms) => setTimeout(() => check(true), ms));
    },
  };
}

/** Что может положить что-то в буфер: отпускание кнопки мыши (кнопка «Копировать») и сочетания с Ctrl/Cmd. */
/** @param {import("../../shared/protocol.js").ClientMessage} msg */
export const mayCopy = (msg) => msg.type === "up" || (msg.type === "keydown" && (msg.ctrl || msg.meta));
