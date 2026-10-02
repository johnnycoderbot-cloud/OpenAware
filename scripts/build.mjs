import { build as bundle } from "esbuild";
import { build as viteBuild } from "vite";
import { resolve } from "node:path";
import { mkdir, copyFile } from "node:fs/promises";

await mkdir("dist", { recursive: true });
await mkdir("dist/capture", { recursive: true });
await copyFile("apps/desktop/capture/index.html", "dist/capture/index.html");
await bundle({
  entryPoints: ["apps/desktop/capture/capture.ts"],
  outfile: "dist/capture/capture.js",
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "chrome150",
  sourcemap: false,
  logLevel: "info",
});
for (const [name, entry] of Object.entries({
  main: "apps/desktop/main/index.ts",
  preload: "apps/desktop/preload/index.ts",
  service: "apps/service/index.ts",
})) {
  await bundle({
    entryPoints: [entry],
    outfile: `dist/${name}.cjs`,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node24",
    external: ["electron"],
    sourcemap: true,
    logLevel: "info",
  });
}
await viteBuild({
  root: resolve("apps/desktop/renderer"),
  base: "./",
  resolve: {
    alias: {
      "@openaware/contracts": resolve("packages/contracts/src/index.ts"),
    },
  },
  build: {
    outDir: resolve("dist/renderer"),
    emptyOutDir: true,
    sourcemap: false,
  },
});
