import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/**"] },
  js.configs.recommended,
  {
    rules: {
      complexity: ["error", 5],
      "max-depth": ["error", 2],
      "max-nested-callbacks": ["error", 2],
      "max-lines-per-function": ["error", { max: 25, skipBlankLines: true, skipComments: true }],
      "max-params": ["error", 3],
      "no-else-return": "error",
      "no-lonely-if": "error",
      "prefer-const": "error",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", ignoreRestSiblings: true }],
    },
  },
  { files: ["src/**", "test/**", "*.js"], languageOptions: { globals: globals.node } },
  { files: ["src/agent/**", "public/**"], languageOptions: { globals: { ...globals.browser, rrweb: "readonly" } } },
  { files: ["shared/**"], languageOptions: { globals: globals["shared-node-browser"] } },
  { files: ["test/**"], rules: { "max-nested-callbacks": "off", "max-lines-per-function": "off" } },
  // стенд замеров — вспомогательные сценарии, длинные по природе
  {
    files: ["bench/**"],
    languageOptions: { globals: globals.node },
    rules: { complexity: "off", "max-depth": "off", "max-nested-callbacks": "off", "max-lines-per-function": "off", "max-params": "off" },
  },
];
