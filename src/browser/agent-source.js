// @ts-check
// Модули агента — обычные файлы для линтера и проверки типов; в страницу они уходят одним скриптом.
// Ограничение: импорты в агенте только однострочные, имена верхнего уровня не повторяются между файлами.
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const AGENT_DIR = new URL("../agent/", import.meta.url);
const MODULES = ["channel.js", "recorder.js", "focus.js", "cursor.js", "index.js"];

/** @param {string} code */
export const toScript = (code) => code
  .replace(/^\/\/ @ts-check\r?\n/m, "")
  .replace(/^import .*;\r?\n/gm, "")
  .replace(/^export /gm, "");

const readModule = (name) => toScript(fs.readFileSync(fileURLToPath(new URL(name, AGENT_DIR)), "utf8"));

/** @param {string} rrwebSource */
export function buildAgentSource(rrwebSource) {
  const modules = MODULES.map(readModule).join("\n");
  return `if (window.top === window) {\n${rrwebSource}\n;(() => {\n${modules}\nstartAgent();\n})();\n}`;
}
