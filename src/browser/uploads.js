// @ts-check
// Файлы, которые пользователь прикрепляет к сообщению. Каждый лежит в своей папке под исходным именем —
// так сайт видит настоящее имя файла. Клиент знает только id: путь на сервере он указать не может.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { removeOld } from "./downloads.js";

const KEEP_MS = 60 * 60 * 1000;
const CLEANUP_EVERY_MS = 10 * 60 * 1000;
const MAX_NAME_LENGTH = 200;
export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

/** Имя без пути и управляющих символов. @param {string} name */
export function safeFileName(name) {
  const printable = [...String(name).replace(/\\/g, "/")].filter((ch) => ch.charCodeAt(0) > 31 && ch !== "\x7f").join("");
  const base = path.basename(printable).trim();
  return base === "." || base === ".." || !base ? "file" : base.slice(0, MAX_NAME_LENGTH);
}

/** @param {number} max */
function sizeLimit(max) {
  let total = 0;
  return new Transform({
    transform(chunk, _encoding, done) {
      total += chunk.length;
      done(total > max ? new Error("файл слишком большой") : null, chunk);
    },
  });
}

/** @param {{ dir: string, maxBytes?: number }} deps */
export function createUploads({ dir, maxBytes = MAX_UPLOAD_BYTES }) {
  fs.mkdirSync(dir, { recursive: true });
  removeOld(dir, 0);
  setInterval(() => removeOld(dir, KEEP_MS), CLEANUP_EVERY_MS).unref();
  /** @type {Map<string, string>} id → путь */
  const files = new Map();
  return {
    /** @param {string} name @param {NodeJS.ReadableStream} body @returns {Promise<string>} id */
    async save(name, body) {
      const id = crypto.randomUUID();
      const file = path.join(dir, id, safeFileName(name));
      fs.mkdirSync(path.dirname(file));
      await pipeline(body, sizeLimit(maxBytes), fs.createWriteStream(file))
        .catch((e) => { fs.rmSync(path.dirname(file), { recursive: true, force: true }); throw e; });
      files.set(id, file);
      return id;
    },
    /** Пути загрузок, которые ещё на месте. @param {string[]} ids */
    paths: (ids) => ids.map((id) => files.get(id)).filter((file) => file && fs.existsSync(file)),
  };
}

/** @typedef {ReturnType<typeof createUploads>} Uploads */
