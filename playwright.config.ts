import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: ["desktop.spec.ts", "ui.spec.ts"],
  workers: 1,
  timeout: 45_000,
  reporter: "list",
  use: { trace: "retain-on-failure" },
});
