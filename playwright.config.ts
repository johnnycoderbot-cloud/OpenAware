import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: [
    "desktop.spec.ts",
    "ui.spec.ts",
    "background.spec.ts",
    "tray.spec.ts",
    "visual.spec.ts",
    "native-capture.spec.ts",
    "adversarial.spec.ts",
  ],
  workers: 1,
  timeout: 45_000,
  reporter: "list",
  use: { trace: "retain-on-failure" },
});
