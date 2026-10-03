import { _electron as electron, expect, test } from "@playwright/test";
import { resolve } from "node:path";

test("desktop and main panes dock and resize while every synthetic feed stays live", async () => {
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).flatMap(([key, value]) =>
      value === undefined ? [] : [[key, value]],
    ),
  );
  env.OPENAWARE_TEST = "1";
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: process.env.OPENAWARE_EXECUTABLE,
    args: [
      ...(process.env.OPENAWARE_EXECUTABLE ? [] : ["."]),
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
    ],
    cwd: resolve("."),
    env,
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      window.webContents.setBackgroundThrottling(false);
      window.showInactive();
      window.setContentSize(1440, 960);
    });
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
    const initialCameraBoard = page.getByTestId("camera-feed-dock-board");
    await expect
      .poll(async () => {
        const first = await initialCameraBoard
          .locator(`:scope > [data-pane-id="${cameraId}"]`)
          .boundingBox();
        const second = await initialCameraBoard
          .locator(`:scope > [data-pane-id="${virtualCameraId}"]`)
          .boundingBox();
        return (
          !!first &&
          !!second &&
          Math.abs(first.y - second.y) < 2 &&
          second.x > first.x
        );
      })
      .toBe(true);
    const firstDesktop = page.locator(
      `[data-testid="source-tile"][data-source-id="${firstId}"]`,
    );
    await expect(secondary).toHaveAttribute("data-source-id", secondId);
    await expect(secondary).toHaveAttribute("data-presentation", "secondary");
    const lowerPreview = secondary.locator(".source-preview canvas");
    // Sample a row through the generated moving rectangle. This proves the
    // lower rendered canvas changes, rather than only checking live metadata.
    const previewSignature = () =>
      lowerPreview.evaluate((node) => {
        const canvas = node as HTMLCanvasElement;
        const pixels = canvas
          .getContext("2d")!
          .getImageData(0, 200, canvas.width, 1).data;
        return pixels.reduce(
          (hash, byte) => Math.imul(hash ^ byte, 16777619) >>> 0,
          2166136261,
        );
      });
    const previousPixels = await previewSignature();
    await expect.poll(previewSignature).not.toBe(previousPixels);
    await expect(
      page.locator(".chat-welcome, .question-chip, .compose-note"),
    ).toHaveCount(0);
    await expect(firstDesktop.locator(".source-settings")).toHaveCount(0);
    const firstName = (await firstDesktop.getByRole("heading").textContent())!;
    const settings = firstDesktop.getByRole("button", {
      name: `Settings for ${firstName}`,
    });
    await settings.click();
    await expect(
      firstDesktop.getByRole("checkbox", { name: "AI analysis" }),
    ).not.toBeChecked();
    const motionToggle = firstDesktop.getByRole("checkbox", {
      name: "Motion alerts",
    });
    await motionToggle.click();
    await expect(motionToggle).toBeChecked();
    await expect
      .poll(() =>
        page.evaluate(
          async (id) =>
            (
              await window.openAware!.invoke({ type: "state.get" })
            ).sources.find((source) => source.id === id)!.motionEnabled,
          firstId,
        ),
      )
      .toBe(true);
    await motionToggle.click();
    await expect(motionToggle).not.toBeChecked();
    await motionToggle.press("Escape");
    await expect(firstDesktop.locator(".source-settings")).toHaveCount(0);
    await expect(settings).toBeFocused();
    await page.getByRole("button", { name: "Choose question sources" }).click();
    const scopeMenu = page.getByRole("group", { name: "Question sources" });
    await expect(scopeMenu.getByRole("checkbox")).toHaveCount(4);
    await scopeMenu
      .getByRole("checkbox", {
        name: "Secondary synthetic monitor",
        exact: true,
      })
      .uncheck();
    await expect(
      page.getByRole("button", { name: "Choose question sources" }),
    ).toContainText("Sources (3)");
    await scopeMenu
      .getByRole("checkbox", {
        name: "Secondary synthetic monitor",
        exact: true,
      })
      .check();
    await page.getByRole("button", { name: "Choose question sources" }).click();
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
      await expect
        .poll(() =>
          page.evaluate(() => {
            const stop = document
              .querySelector('[data-testid="stop-all"]')!
              .getBoundingClientRect();
            const textarea = document.querySelector(
              ".conversation-panel textarea",
            )!;
            const composer = textarea.getBoundingClientRect();
            const pane = textarea
              .closest(".dock-pane-content")!
              .getBoundingClientRect();
            const hit = document.elementFromPoint(
              composer.x + composer.width / 2,
              composer.y + composer.height / 2,
            );
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
                composer.bottom <= innerHeight &&
                composer.x >= pane.x &&
                composer.right <= pane.right &&
                composer.y >= pane.y &&
                composer.bottom <= pane.bottom &&
                (hit === textarea || (!!hit && textarea.contains(hit))),
            };
          }),
        )
        .toEqual({ stop: true, composer: true });
      expect(
        (await page
          .getByTestId("dashboard-dock-board")
          .locator(':scope > [data-pane-id="actions"]')
          .boundingBox())!.height,
      ).toBeLessThanOrEqual(100);
      expect(
        await page
          .getByRole("button", { name: "Open Operator", exact: true })
          .evaluate((button) => {
            const box = button.getBoundingClientRect();
            const pane = button
              .closest(".dock-pane-content")!
              .getBoundingClientRect();
            const hit = document.elementFromPoint(
              box.x + box.width / 2,
              box.y + box.height / 2,
            );
            return (
              box.top >= pane.top &&
              box.bottom <= pane.bottom &&
              box.left >= pane.left &&
              box.right <= pane.right &&
              (hit === button || (!!hit && button.contains(hit)))
            );
          }),
      ).toBe(true);
      await page.evaluate(() => {
        for (const pane of document.querySelectorAll(".dock-pane-content"))
          pane.scrollTo(0, 0);
        for (const selector of [".feeds-section", ".chat-body"])
          document.querySelector(selector)?.scrollTo(0, 0);
      });
      const upper = await firstDesktop.locator(".source-preview").boundingBox();
      const lower = await secondary.locator(".source-preview").boundingBox();
      expect(upper).not.toBeNull();
      expect(lower).not.toBeNull();
      expect(lower!.width).toBeGreaterThanOrEqual(370);
      expect(lower!.width).toBeCloseTo(upper!.width, 0);
      expect(lower!.height).toBeGreaterThanOrEqual(180);
      expect(lower!.y).toBeGreaterThanOrEqual(upper!.y + upper!.height);
      await lowerPreview.scrollIntoViewIfNeeded();
      await secondary
        .getByRole("button", { name: "Disconnect", exact: true })
        .scrollIntoViewIfNeeded();
      await page.evaluate(() => {
        for (const pane of document.querySelectorAll(".dock-pane-content"))
          pane.scrollTo(0, 0);
        document.querySelector(".feeds-section")?.scrollTo(0, 0);
      });
      await page.screenshot({ path: resolve("assets", file), fullPage: false });
      // Full desktop previews use the upper workspace. The independently live
      // camera section must still be reachable through its existing scroller.
      for (const tile of [camera, virtualCamera]) {
        await tile.locator("video").scrollIntoViewIfNeeded();
        await expect
          .poll(() =>
            tile.locator("video").evaluate((video) => {
              const frame = video.getBoundingClientRect();
              const pane = document
                .querySelector('[data-pane-id="cameras"] > .dock-pane-content')!
                .getBoundingClientRect();
              const top = Math.max(frame.top, pane.top, 0);
              const bottom = Math.min(frame.bottom, pane.bottom, innerHeight);
              const left = Math.max(frame.left, pane.left, 0);
              const right = Math.min(frame.right, pane.right, innerWidth);
              return (
                bottom - top >= 100 &&
                right - left >= 100 &&
                document.elementFromPoint(
                  (left + right) / 2,
                  (top + bottom) / 2,
                ) === video
              );
            }),
          )
          .toBe(true);
        await tile.locator(".source-bottom").scrollIntoViewIfNeeded();
        await expect
          .poll(() =>
            tile.evaluate((node) => {
              const pane = document
                .querySelector('[data-pane-id="cameras"] > .dock-pane-content')!
                .getBoundingClientRect();
              return Array.from(
                node.querySelectorAll(".source-bottom button"),
              ).every((button) => {
                const box = button.getBoundingClientRect();
                const hit = document.elementFromPoint(
                  box.x + box.width / 2,
                  box.y + box.height / 2,
                );
                return (
                  box.top >= pane.top &&
                  box.bottom <= pane.bottom &&
                  box.left >= pane.left &&
                  box.right <= pane.right &&
                  (hit === button || (!!hit && button.contains(hit)))
                );
              });
            }),
          )
          .toBe(true);
      }
    }
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 960),
    );
    await expect
      .poll(() =>
        page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
      )
      .toEqual({ width: 1440, height: 960 });
    await expect
      .poll(() =>
        page.getByTestId("dashboard-dock-board").evaluate((board) => {
          const bounds = board.getBoundingClientRect();
          const panes = Array.from(
            board.querySelectorAll(":scope > .dock-pane"),
          ).map((pane) => pane.getBoundingClientRect());
          return (
            Math.abs(
              Math.max(...panes.map((pane) => pane.right)) - bounds.right,
            ) < 2 &&
            Math.abs(
              Math.max(...panes.map((pane) => pane.bottom)) - bounds.bottom,
            ) < 2
          );
        }),
      )
      .toBe(true);
    const ids = [firstId, secondId, cameraId, virtualCameraId];
    const sourceIdentity = () =>
      page.evaluate(async (sourceIds) => {
        const state = await window.openAware!.invoke({ type: "state.get" });
        return sourceIds.map((id) => {
          const source = state.sources.find((item) => item.id === id)!;
          return {
            id: source.id,
            deviceId: source.deviceId,
            revision: source.revision,
            status: source.status,
          };
        });
      }, ids);
    const identitiesBeforeDocking = await sourceIdentity();
    const held = await page.evaluateHandle((sourceIds) => {
      const tile = (id: string) =>
        document.querySelector(
          `[data-testid="source-tile"][data-source-id="${id}"]`,
        )!;
      const first = tile(sourceIds[0]!).querySelector("canvas")!;
      const second = tile(sourceIds[1]!).querySelector("canvas")!;
      const camera = tile(sourceIds[2]!).querySelector("video")!;
      const virtual = tile(sourceIds[3]!).querySelector("video")!;
      const cameraStream = camera.srcObject as MediaStream;
      const virtualStream = virtual.srcObject as MediaStream;
      return { first, second, camera, virtual, cameraStream, virtualStream };
    }, ids);
    const assertMountedCapture = async () => {
      expect(
        await held.evaluate((refs) => ({
          canvases: refs.first.isConnected && refs.second.isConnected,
          videos: refs.camera.isConnected && refs.virtual.isConnected,
          sameStreams:
            refs.camera.srcObject === refs.cameraStream &&
            refs.virtual.srcObject === refs.virtualStream,
          tracksLive: [
            ...refs.cameraStream.getTracks(),
            ...refs.virtualStream.getTracks(),
          ].every((track) => track.readyState === "live"),
        })),
      ).toEqual({
        canvases: true,
        videos: true,
        sameStreams: true,
        tracksLive: true,
      });
      expect(await sourceIdentity()).toEqual(identitiesBeforeDocking);
    };
    const assistantDivider = page
      .getByTestId("dashboard-dock-board")
      .locator('[data-divider-id="main-assistant"]');
    await assistantDivider.focus();
    await assistantDivider.press("Home");
    await expect
      .poll(
        async () =>
          (await page
            .getByTestId("dashboard-dock-board")
            .locator(':scope > [data-pane-id="assistant"]')
            .boundingBox())!.height,
      )
      .toBeLessThanOrEqual(241);
    const sourcesButton = page.getByRole("button", {
      name: "Choose question sources",
    });
    await sourcesButton.click();
    const boundedSources = page.getByRole("group", {
      name: "Question sources",
    });
    for (const input of await boundedSources.getByRole("checkbox").all()) {
      await input.scrollIntoViewIfNeeded();
      await expect
        .poll(() =>
          input.evaluate((node) => {
            const box = node.getBoundingClientRect();
            const menu = node
              .closest(".question-sources-menu")!
              .getBoundingClientRect();
            const pane = node
              .closest(".dock-pane-content")!
              .getBoundingClientRect();
            return (
              box.top >= menu.top &&
              box.bottom <= menu.bottom &&
              box.top >= pane.top &&
              box.bottom <= pane.bottom &&
              document.elementFromPoint(
                box.x + box.width / 2,
                box.y + box.height / 2,
              ) === node
            );
          }),
        )
        .toBe(true);
      await input.uncheck();
      await expect(input).not.toBeChecked();
      await input.check();
      await expect(input).toBeChecked();
    }
    await boundedSources.getByRole("checkbox").last().press("Escape");
    await expect(boundedSources).toHaveCount(0);
    await expect(sourcesButton).toBeFocused();
    await assertMountedCapture();
    await page.getByRole("button", { name: "Reset dashboard layout" }).click();
    const feedBoard = page.getByTestId("feed-dock-board");
    const firstFeedPane = feedBoard.locator(
      `:scope > [data-pane-id="${firstId}"]`,
    );
    const secondFeedPane = feedBoard.locator(
      `:scope > [data-pane-id="${secondId}"]`,
    );
    await page
      .getByRole("button", { name: "Place desktop feeds side by side" })
      .click();
    await expect(
      page.getByRole("separator", { name: "Resize desktop feeds height" }),
    ).toHaveAttribute("aria-valuenow", "340");
    await expect
      .poll(async () => {
        const a = await firstFeedPane.boundingBox();
        const b = await secondFeedPane.boundingBox();
        return !!a && !!b && Math.abs(a.y - b.y) < 2 && b.x > a.x;
      })
      .toBe(true);
    await assertMountedCapture();
    let firstBounds = (await firstFeedPane.boundingBox())!;
    await page
      .getByRole("button", {
        name: "Move Secondary synthetic monitor",
        exact: true,
      })
      .dragTo(firstFeedPane, {
        targetPosition: { x: 5, y: Math.floor(firstBounds.height / 2) },
      });
    await expect
      .poll(async () => {
        const a = await firstFeedPane.boundingBox();
        const b = await secondFeedPane.boundingBox();
        return !!a && !!b && b.x < a.x && Math.abs(a.y - b.y) < 2;
      })
      .toBe(true);
    await assertMountedCapture();
    const feedDivider = feedBoard.getByRole("separator", {
      name: "Resize feed horizontal split",
    });
    const firstWidth = (await firstFeedPane.boundingBox())!.width;
    await feedDivider.focus();
    await feedDivider.press("ArrowRight");
    await expect
      .poll(async () => (await firstFeedPane.boundingBox())!.width)
      .toBeLessThan(firstWidth);
    firstBounds = (await firstFeedPane.boundingBox())!;
    await page
      .getByRole("button", {
        name: "Move Secondary synthetic monitor",
        exact: true,
      })
      .dragTo(firstFeedPane, {
        targetPosition: {
          x: Math.floor(firstBounds.width / 2),
          y: firstBounds.height - 5,
        },
      });
    await expect
      .poll(async () => {
        const a = await firstFeedPane.boundingBox();
        const b = await secondFeedPane.boundingBox();
        return !!a && !!b && b.y > a.y && Math.abs(a.x - b.x) < 2;
      })
      .toBe(true);
    await assertMountedCapture();
    await page.getByRole("button", { name: "Reset feed layout" }).click();
    const heightControl = page.getByRole("separator", {
      name: "Resize desktop feeds height",
    });
    const originalHeight = Number(
      await heightControl.getAttribute("aria-valuenow"),
    );
    await heightControl.focus();
    await heightControl.press("ArrowDown");
    await expect(heightControl).toHaveAttribute(
      "aria-valuenow",
      String(originalHeight + 20),
    );

    const cameraBoard = page.getByTestId("camera-feed-dock-board");
    const cameraPane = cameraBoard.locator(
      `:scope > [data-pane-id="${cameraId}"]`,
    );
    const virtualPane = cameraBoard.locator(
      `:scope > [data-pane-id="${virtualCameraId}"]`,
    );
    await page
      .getByRole("combobox", {
        name: "Arrange Virtual camera (synthetic)",
        exact: true,
      })
      .selectOption(`${cameraId}/left`);
    await expect
      .poll(async () => {
        const cameraRect = await cameraPane.boundingBox();
        const virtualRect = await virtualPane.boundingBox();
        return (
          !!cameraRect &&
          !!virtualRect &&
          virtualRect.x < cameraRect.x &&
          Math.abs(virtualRect.y - cameraRect.y) < 2
        );
      })
      .toBe(true);
    await assertMountedCapture();
    await page
      .getByRole("combobox", {
        name: "Arrange Virtual camera (synthetic)",
        exact: true,
      })
      .selectOption(`${cameraId}/bottom`);
    await expect
      .poll(async () => {
        const cameraRect = await cameraPane.boundingBox();
        const virtualRect = await virtualPane.boundingBox();
        return (
          !!cameraRect &&
          !!virtualRect &&
          virtualRect.y > cameraRect.y &&
          Math.abs(virtualRect.x - cameraRect.x) < 2
        );
      })
      .toBe(true);
    await assertMountedCapture();

    const dashboard = page.getByTestId("dashboard-dock-board");
    const workspacePane = dashboard.locator(
      ':scope > [data-pane-id="workspace"]',
    );
    const assistantPane = dashboard.locator(
      ':scope > [data-pane-id="assistant"]',
    );
    const composer = page.locator(".conversation-panel textarea");
    await composer.fill("Keep this unsent draft while I arrange the panes.");
    const workspaceBounds = (await workspacePane.boundingBox())!;
    await page
      .getByRole("button", { name: "Move Workspace assistant", exact: true })
      .dragTo(workspacePane, {
        targetPosition: { x: 5, y: Math.floor(workspaceBounds.height / 2) },
      });
    await expect
      .poll(async () => {
        const a = await assistantPane.boundingBox();
        const w = await workspacePane.boundingBox();
        return !!a && !!w && a.x < w.x && Math.abs(a.y - w.y) < 2;
      })
      .toBe(true);
    await expect(composer).toHaveValue(
      "Keep this unsent draft while I arrange the panes.",
    );
    await assertMountedCapture();
    await page.getByRole("button", { name: "Reset dashboard layout" }).click();
    await expect(
      page.getByRole("button", { name: "Place camera feeds side by side" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("separator", { name: "Resize camera feeds height" }),
    ).toHaveAttribute("aria-valuenow", "340");
    await expect(
      page.getByRole("button", { name: "Stack desktop feeds" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(heightControl).toHaveAttribute(
      "aria-valuenow",
      String(originalHeight),
    );
    const mainDivider = dashboard.locator('[data-divider-id="main-columns"]');
    const dividerBounds = (await mainDivider.boundingBox())!;
    const workspaceWidth = (await workspacePane.boundingBox())!.width;
    await page.mouse.move(
      dividerBounds.x + dividerBounds.width / 2,
      dividerBounds.y + dividerBounds.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      dividerBounds.x - 70,
      dividerBounds.y + dividerBounds.height / 2,
    );
    await page.mouse.up();
    await expect
      .poll(async () => (await workspacePane.boundingBox())!.width)
      .toBeLessThan(workspaceWidth - 30);
    await assertMountedCapture();
    await page
      .getByRole("button", { name: "Place desktop feeds side by side" })
      .click();
    await mainDivider.focus();
    await mainDivider.press("Home");
    await expect
      .poll(async () => (await workspacePane.boundingBox())!.width)
      .toBeLessThanOrEqual(321);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const scroller = document.querySelector(".feeds-section")!;
          return scroller.scrollWidth > scroller.clientWidth;
        }),
      )
      .toBe(true);
    for (const tile of [firstDesktop, secondary, camera, virtualCamera]) {
      for (const button of [
        tile.getByRole("button", { name: "Disconnect", exact: true }),
        tile.getByRole("button", { name: /^Remove / }),
      ]) {
        await button.scrollIntoViewIfNeeded();
        const bounds = (await button.boundingBox())!;
        const tileBounds = (await tile.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(tileBounds.x);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(
          tileBounds.x + tileBounds.width + 1,
        );
        expect(
          await button.evaluate((node) => {
            const rect = node.getBoundingClientRect();
            const hit = document.elementFromPoint(
              rect.x + rect.width / 2,
              rect.y + rect.height / 2,
            );
            return hit === node || (!!hit && node.contains(hit));
          }),
        ).toBe(true);
      }
    }
    await assertMountedCapture();
    await page.getByRole("button", { name: "Reset dashboard layout" }).click();
    await expect(composer).toHaveValue(
      "Keep this unsent draft while I arrange the panes.",
    );
    await page
      .getByRole("combobox", {
        name: "Arrange Workspace assistant",
        exact: true,
      })
      .selectOption("workspace/top");
    await expect
      .poll(async () => {
        const assistantRect = await assistantPane.boundingBox();
        const workspaceRect = await workspacePane.boundingBox();
        return (
          !!assistantRect &&
          !!workspaceRect &&
          assistantRect.y < workspaceRect.y &&
          Math.abs(assistantRect.x - workspaceRect.x) < 2
        );
      })
      .toBe(true);
    await assertMountedCapture();
    await page.getByRole("button", { name: "Reset dashboard layout" }).click();
    // Narrow/zoomed layouts stack the main panes in the actual docking order;
    // they must not silently keep the original JSX order after a move.
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      window.setMinimumSize(600, 500);
      window.setContentSize(820, 720);
    });
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(820);
    await page
      .getByRole("combobox", {
        name: "Arrange Workspace assistant",
        exact: true,
      })
      .selectOption("workspace/top");
    await expect
      .poll(async () => {
        const assistantRect = await assistantPane.boundingBox();
        const workspaceRect = await workspacePane.boundingBox();
        return (
          !!assistantRect &&
          !!workspaceRect &&
          assistantRect.y < workspaceRect.y
        );
      })
      .toBe(true);
    await assertMountedCapture();
    await expect(
      page.getByText("Stacked layout", {
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Reset dashboard layout" }).click();
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      window.setContentSize(1440, 960);
      window.setMinimumSize(1040, 720);
    });
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(1440);
    const afterPixels = await previewSignature();
    await expect.poll(previewSignature).not.toBe(afterPixels);
    await held.dispose();
    await page.evaluate(() =>
      document.querySelector(".feeds-section")?.scrollTo(0, 0),
    );
    await secondary
      .getByRole("button", { name: "Focus Secondary synthetic monitor" })
      .click();
    await expect(secondary).toHaveAttribute("data-presentation", "primary");
    await expect(firstDesktop).toHaveAttribute(
      "data-presentation",
      "secondary",
    );
    await expect
      .poll(() =>
        page.evaluate(
          async (ids) => {
            const state = await window.openAware!.invoke({ type: "state.get" });
            return ids.every((id) =>
              state.sources.some(
                (source) => source.id === id && source.status === "live",
              ),
            );
          },
          [firstId, secondId],
        ),
      )
      .toBe(true);
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

test("four desktop columns retain reachable source controls through inner horizontal scrolling", async () => {
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).flatMap(([key, value]) =>
      value === undefined ? [] : [[key, value]],
    ),
  );
  env.OPENAWARE_TEST = "1";
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: process.env.OPENAWARE_EXECUTABLE,
    args: [
      ...(process.env.OPENAWARE_EXECUTABLE ? [] : ["."]),
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
    ],
    cwd: resolve("."),
    env,
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      window.webContents.setBackgroundThrottling(false);
      window.showInactive();
      window.setContentSize(1024, 720);
    });
    const ids = await page.evaluate(async () => {
      const ids: string[] = [];
      for (let index = 0; index < 4; index++) {
        const id = crypto.randomUUID();
        await window.openAware!.invoke({
          type: "source.add",
          source: {
            id,
            name: `Synthetic display ${index + 1}`,
            kind: "demo",
            deviceId: `synthetic-column-${index}`,
          },
        });
        await window.openAware!.invoke({
          type: "source.update",
          sourceId: id,
          patch: { analysisEnabled: false },
        });
        ids.push(id);
      }
      return ids;
    });
    await expect(page.getByTestId("source-tile")).toHaveCount(4);
    for (const id of ids) {
      const tile = page.locator(
        `[data-testid="source-tile"][data-source-id="${id}"]`,
      );
      await tile.getByRole("button", { name: "Connect", exact: true }).click();
      await expect(tile.locator("canvas")).toHaveCount(1);
    }
    await page
      .getByRole("button", { name: "Place desktop feeds side by side" })
      .click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const scroller = document.querySelector(".feeds-section")!;
          const board = document.querySelector(
            '[data-testid="feed-dock-board"]',
          )!;
          return (
            scroller.scrollWidth > scroller.clientWidth &&
            board.getBoundingClientRect().width >= 1064
          );
        }),
      )
      .toBe(true);
    for (const id of ids) {
      const tile = page.locator(
        `[data-testid="source-tile"][data-source-id="${id}"]`,
      );
      const preview = (await tile.locator(".source-preview").boundingBox())!;
      expect(preview.width).toBeGreaterThanOrEqual(258);
      expect(preview.height).toBeGreaterThanOrEqual(180);
      for (const button of [
        tile.getByRole("button", { name: "Disconnect", exact: true }),
        tile.getByRole("button", { name: /^Remove / }),
      ]) {
        await button.scrollIntoViewIfNeeded();
        const control = (await button.boundingBox())!;
        const bounds = (await tile.boundingBox())!;
        expect(control.x).toBeGreaterThanOrEqual(bounds.x);
        expect(control.x + control.width).toBeLessThanOrEqual(
          bounds.x + bounds.width + 1,
        );
        expect(
          await button.evaluate((node) => {
            const rect = node.getBoundingClientRect();
            const hit = document.elementFromPoint(
              rect.x + rect.width / 2,
              rect.y + rect.height / 2,
            );
            return hit === node || (!!hit && node.contains(hit));
          }),
        ).toBe(true);
      }
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(
        async () =>
          (
            await window.openAware!.invoke({ type: "state.get" })
          ).sources.filter((source) => source.status === "live").length,
      ),
    ).toBe(4);
    await page.getByTestId("stop-all").click();
    await expect(
      page.locator('[data-testid="source-tile"] canvas'),
    ).toHaveCount(0);
  } finally {
    await app.close();
  }
});
