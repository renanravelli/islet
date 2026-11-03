import { defineConfig } from "vitest/config";

export default defineConfig({
  define: { __ISLET_DEBUG__: "false" },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.ts"],
  },
});
