import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": here("./src"),
      // Next enforces this at build time; under vitest it would throw on import.
      "server-only": here("./tests/stubs/empty.ts"),
    },
  },
  test: { include: ["tests/unit/**/*.test.ts"], environment: "node" },
});
