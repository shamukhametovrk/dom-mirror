// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildAgentSource, patchRrweb, toScript } from "../src/browser/agent-source.js";

test("toScript убирает импорты и export", () => {
  const code = `// @ts-check\nimport { a } from "./a.js";\nexport const b = 1;\nexport function c() {}\n`;
  assert.equal(toScript(code), "const b = 1;\nfunction c() {}\n");
});

test("собранный агент — корректный скрипт без конфликтов имён", () => {
  const source = buildAgentSource("var rrweb = {};");
  assert.doesNotThrow(() => new Function(source));
  assert.doesNotMatch(source, /^\s*(import|export)\s/m);
  assert.match(source, /startAgent\(\);/);
});

test("rrweb: узел с неизвестным соседом справа вставляется перед следующим известным, а не выбрасывается", () => {
  const original = fs.readFileSync(new URL("../node_modules/rrweb/dist/rrweb.umd.min.cjs", import.meta.url), "utf8");
  const patched = patchRrweb(original);
  assert.notEqual(patched, original);
  assert.match(patched, /for\(;\((\w+)===-2\|\|\1===-1\);\)/);
  assert.doesNotThrow(() => new Function(patched));
  assert.throws(() => patchRrweb("var rrweb = {};"), /rrweb/);
});
