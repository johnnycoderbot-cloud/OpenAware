import { _electron as electron, expect, test } from "@playwright/test";
import { resolve } from "node:path";

test("concept dashboard keeps controls in the viewport and separates synthetic desktop and camera sources", async () => {
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).flatMap(([key, value]) =>
      value === undefined ? [] : [[key, value]],
    ),
  );
  env.OPENAWARE_TEST = "1";
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: process.env.OPENAWARE_EXECUTABLE,
    args: process.env.OPENAWARE_EXECUTABLE ? [] : ["."],
    cwd: resolve("."),
    env,
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 960),
    );
    await page.getByTestId("add-source").click();
    await page
      .getByRole("button", { name: "Connect source", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            (await window.openAware!.invoke({ type: "state.get" })).sources[0]
              ?.lastFrameAt ?? 0,
        ),
      )
      .toBeGreaterThan(0);
    // A generated canvas is the only camera input. No hardware permission or
    // personal feed is requested. Actual HTMLVideoElement delivery still runs.
    const cameraId = await page.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 360;
      const context = canvas.getContext("2d")!;
      const paint = () => {
        context.fillStyle = "#143549";
        context.fillRect(0, 0, 640, 360);
        context.fillStyle = "#19495e";
        context.fillRect(35, 40, 220, 140);
        context.fillStyle = "#3879a5";
        context.fillRect(50, 55, 190, 110);
        context.fillStyle = "#34545f";
        context.fillRect(100, 230, 470, 25);
        context.fillRect(120, 255, 15, 80);
        context.fillRect(535, 255, 15, 80);
        context.fillStyle = "#15232c";
        context.fillRect(290, 155, 190, 100);
        context.fillStyle = "#4696e8";
        context.fillRect(300, 165, 170, 75);
        context.fillStyle = "#66cfac";
        context.beginPath();
        context.arc(
          535,
          125,
          20 + 5 * Math.sin(Date.now() / 400),
          0,
          Math.PI * 2,
        );
        context.fill();
        context.fillStyle = "#e2f1ff";
        context.font = "bold 18px sans-serif";
        context.fillText("SYNTHETIC CAMERA FIXTURE", 30, 325);
        requestAnimationFrame(paint);
      };
      paint();
      const stream = canvas.captureStream(15);
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: async (constraints: MediaStreamConstraints) => {
          const video = constraints.video as MediaTrackConstraints;
          if (
            (video.deviceId as ConstrainDOMStringParameters)?.exact !==
            "synthetic-camera-fixture"
          )
            throw new Error("Only the synthetic fixture is available");
          return stream.clone();
        },
      });
      const id = crypto.randomUUID();
      await window.openAware!.invoke({
        type: "source.add",
        source: {
          id,
          name: "Camera fixture (synthetic)",
          kind: "camera",
          deviceId: "synthetic-camera-fixture",
        },
      });
      await window.openAware!.invoke({
        type: "source.update",
        sourceId: id,
        patch: { analysisEnabled: false },
      });
      return id;
    });
    const camera = page.getByTestId("source-tile").filter({
      has: page.getByRole("heading", {
        name: "Camera fixture (synthetic)",
        exact: true,
      }),
    });
    await camera.getByRole("button", { name: "Connect", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(
          async (id) =>
            (
              await window.openAware!.invoke({ type: "state.get" })
            ).sources.find((s) => s.id === id)?.lastFrameAt ?? 0,
          cameraId,
        ),
      )
      .toBeGreaterThan(0);
    await expect(camera.locator("video")).toBeVisible();
    const virtualCameraId = await page.evaluate(async () => {
      const id = crypto.randomUUID();
      await window.openAware!.invoke({
        type: "source.add",
        source: {
          id,
          name: "Virtual camera (synthetic)",
          kind: "virtual_camera",
          deviceId: "synthetic-camera-fixture",
        },
      });
      await window.openAware!.invoke({
        type: "source.update",
        sourceId: id,
        patch: { analysisEnabled: false },
      });
      return id;
    });
    const virtualCamera = page.getByTestId("source-tile").filter({
      has: page.getByRole("heading", {
        name: "Virtual camera (synthetic)",
        exact: true,
      }),
    });
    await virtualCamera
      .getByRole("button", { name: "Connect", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          async (id) =>
            (
              await window.openAware!.invoke({ type: "state.get" })
            ).sources.find((source) => source.id === id)?.lastFrameAt ?? 0,
          virtualCameraId,
        ),
      )
      .toBeGreaterThan(0);
    await expect(virtualCamera.locator("video")).toBeVisible();
    const secondId = await page.evaluate(async () => {
      const id = crypto.randomUUID();
      await window.openAware!.invoke({
        type: "source.add",
        source: {
          id,
          name: "Secondary synthetic monitor",
          kind: "demo",
          deviceId: "synthetic-secondary",
        },
      });
      await window.openAware!.invoke({
        type: "source.update",
        sourceId: id,
        patch: { analysisEnabled: false },
      });
      return id;
    });
    await page
      .getByRole("combobox", { name: "Focused desktop source" })
      .selectOption(secondId);
    const secondary = page.getByTestId("source-tile").filter({
      has: page.getByRole("heading", {
        name: "Secondary synthetic monitor",
        exact: true,
      }),
    });
    await secondary
      .getByRole("button", { name: "Connect", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          async (id) =>
            (
              await window.openAware!.invoke({ type: "state.get" })
            ).sources.find((s) => s.id === id)?.lastFrameAt ?? 0,
          secondId,
        ),
      )
      .toBeGreaterThan(0);
    const firstId = await page.evaluate(
      async () =>
        (await window.openAware!.invoke({ type: "state.get" })).sources[0]!.id,
    );
    await page.evaluate(async (id) => {
      await window.openAware!.invoke({
        type: "source.update",
        sourceId: id,
        patch: { analysisEnabled: false },
      });
    }, firstId);
    await page
      .getByRole("combobox", { name: "Focused desktop source" })
      .selectOption(firstId);
    await expect(page.getByTestId("source-tile")).toHaveCount(4);
    for (const name of [
      "Live workspace",
      "Workspace assistant",
      "Computer actions",
      "Recent activity",
    ])
      await expect(
        page.getByRole("heading", { name, exact: true }),
      ).toBeVisible();
    for (const [width, height, file] of [
      [1440, 960, "prototype-desktop-multisource.png"],
      [1024, 720, "prototype-desktop-compact.png"],
    ] as const) {
      await app.evaluate(
        ({ BrowserWindow }, size) =>
          BrowserWindow.getAllWindows()[0]!.setContentSize(
            size.width,
            size.height,
          ),
        { width, height },
      );
      await expect
        .poll(() =>
          page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
        )
        .toEqual({ width, height });
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true);
      const visible = await page.evaluate(() => {
        const stop = document
          .querySelector('[data-testid="stop-all"]')!
          .getBoundingClientRect();
        const composer = document
          .querySelector(".conversation-panel textarea")!
          .getBoundingClientRect();
        return {
          stop:
            stop.x >= 0 &&
            stop.right <= innerWidth &&
            stop.y >= 0 &&
            stop.bottom <= innerHeight,
          composer:
            composer.x >= 0 &&
            composer.right <= innerWidth &&
            composer.y >= 0 &&
            composer.bottom <= innerHeight,
        };
      });
      expect(visible).toEqual({ stop: true, composer: true });
      await page.evaluate(() => {
        for (const selector of [".feeds-section", ".chat-body"])
          document.querySelector(selector)?.scrollTo(0, 0);
      });
      if (width === 1440) {
        for (const tile of [camera, virtualCamera]) {
          const frame = await tile.locator("video").boundingBox();
          expect(frame).not.toBeNull();
          expect(frame!.y).toBeGreaterThan(0);
          expect(frame!.height).toBeGreaterThanOrEqual(100);
          expect(frame!.y + frame!.height).toBeLessThanOrEqual(height);
        }
      }
      await page.screenshot({ path: resolve("assets", file), fullPage: false });
    }
    await page.getByTestId("stop-all").click();
    await expect
      .poll(() =>
        page.evaluate(async () =>
          (await window.openAware!.invoke({ type: "state.get" })).sources.every(
            (s) => s.status === "stopped",
          ),
        ),
      )
      .toBe(true);
    await expect(camera.locator("video")).toHaveCount(0);
    await expect(virtualCamera.locator("video")).toHaveCount(0);
  } finally {
    await app.close();
  }
});
