import { defineConfig } from "vitest/config";
import path from "node:path";

// Unit tests only — pure functions in src/lib, no DOM, no Supabase, no React.
// (The project's first test runner, introduced with the deposit receipt/
// discount work: the REVIEWER's throwaway verification harnesses kept proving
// things once and evaporating; these run on every `npm test` instead.)
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
