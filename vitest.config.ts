import { defineConfig } from "vitest/config";

// The server packages run in Node; the web app has its own project because it needs a DOM.
export default defineConfig({
  test: {
    projects: [
      { test: { name: "node", include: ["packages/**/*.test.ts"], exclude: ["packages/web/**", "**/node_modules/**"], environment: "node" } },
      "packages/web",
    ],
  },
});
