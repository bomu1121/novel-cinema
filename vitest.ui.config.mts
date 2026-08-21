import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// UI 组件测试（jsdom + Testing Library + axe）
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.ui.test.{ts,tsx}"],
    setupFiles: ["./vitest.ui.setup.ts"],
    // Testing Library 自动 cleanup 依赖全局 afterEach
    globals: true,
  },
});
