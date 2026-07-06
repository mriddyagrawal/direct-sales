import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Non-app content: the frozen Claude Design deliverable (support.js
    // carries its own "GENERATED ... do not edit" header) and archived v0
    // drafts — neither is app source this config should lint.
    "design/**",
    "archive/**",
  ]),
]);

export default eslintConfig;
