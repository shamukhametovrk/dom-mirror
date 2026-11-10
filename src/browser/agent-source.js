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

// rrweb выбрасывает новый узел, если его соседа справа нет в своей таблице (id -1), и дальше теряет все узлы,
// вставленные перед ним, — так в ChatGPT пропадали сообщения. Такого соседа нет и в копии, поэтому верно
// поступить как с исключённым (id -2): вставить перед следующим известным. Правка — в минифицированном rrweb 2.2.1.
const NEXT_ID_LOOP = /for\(;(\w+)===-2;\)(\w+)=\2&&(\w+)\.nextSibling\(\2\),\1=\2&&this\.mirror\.getId\(\2\);/;

/** @param {string} rrwebSource */
export function patchRrweb(rrwebSource) {
  if (!NEXT_ID_LOOP.test(rrwebSource)) throw new Error("rrweb: не найдено место для правки (сменилась версия?)");
  return rrwebSource.replace(NEXT_ID_LOOP, (loop, id) => loop.replace(`${id}===-2;`, `(${id}===-2||${id}===-1);`));
}

/** @param {string} rrwebSource */
export function buildAgentSource(rrwebSource) {
  const modules = MODULES.map(readModule).join("\n");
  return `if (window.top === window) {\n${rrwebSource}\n;(() => {\n${modules}\nstartAgent();\n})();\n}`;
}
