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
    // The local analysis workspace is gitignored, but this config replaces
    // eslint-config-next's defaults rather than extending them, so without
    // this line eslint walks into analysis/.venv and lints a vendored
    // matplotlib JS bundle — 5 errors + 17 warnings from code we do not own.
    // Lint is a real signal on this project; burying src/ errors under 22
    // permanent problems is how a genuine one gets missed.
    "analysis/**",
  ]),
]);

export default eslintConfig;
