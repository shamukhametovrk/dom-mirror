// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAgentSource, toScript } from "../src/browser/agent-source.js";

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
