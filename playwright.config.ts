import { defineConfig } from "@playwright/test";

// e2e 基线（docs/06 §8.3）：先 npm run build，再 npm run test:e2e
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3124",
    screenshot: "on",
    trace: "on-first-retry",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { viewport: { width: 375, height: 812 } } },
  ],
  webServer: {
    command: "npm run start",
    url: "http://127.0.0.1:3124",
    reuseExistingServer: true,
    env: { PORT: "3124" },
    timeout: 60_000,
  },
});
