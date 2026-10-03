import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page,
} from "@playwright/test";
import { resolve } from "node:path";

async function launchVisual() {
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
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!;
    window.webContents.setBackgroundThrottling(false);
    window.showInactive();
    window.setMinimumSize(600, 500);
    window.setContentSize(1440, 960);
  });
  return { app, page };
}

async function viewport(
  app: ElectronApplication,
  page: Page,
  width: number,
  height: number,
) {
  await app.evaluate(
    ({ BrowserWindow }, size) =>
      BrowserWindow.getAllWindows()[0]!.setContentSize(size.width, size.height),
    { width, height },
  );
  await expect
    .poll(() =>
      page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
    )
    .toEqual({ width, height });
}

function tile(page: Page, id: string) {
  return page.locator(`[data-testid="source-tile"][data-source-id="${id}"]`);
}
function pane(page: Page, id: string) {
  return page
    .getByTestId("dashboard-dock-board")
    .locator(`:scope > [data-pane-id="${id}"]`);
}

async function addFixture(
  page: Page,
  kind: "demo" | "camera" | "virtual_camera",
  name: string,
) {
  const id = await page.evaluate(
    async ({ kind, name }) => {
      const id = crypto.randomUUID();
      await window.openAware!.invoke({
        type: "source.add",
        source: {
          id,
          name,
          kind,
          deviceId:
            kind === "demo" ? `synthetic-${id}` : "synthetic-camera-fixture",
        },
      });
      await window.openAware!.invoke({
        type: "source.update",
        sourceId: id,
        patch: { analysisEnabled: false },
      });
      return id;
    },
    { kind, name },
  );
  await tile(page, id)
    .getByRole("button", { name: "Connect", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        async (id) =>
          (await window.openAware!.invoke({ type: "state.get" })).sources.find(
            (source) => source.id === id,
          )?.lastFrameAt ?? 0,
        id,
      ),
    )
    .toBeGreaterThan(0);
  return id;
}

async function generatedCamera(page: Page) {
  // Only a locally painted canvas supplies the camera fixtures. Actual video
  // delivery runs without requesting hardware or recording personal feeds.
  await page.evaluate(() => {
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
  });
}

async function frames(page: Page) {
  return page.evaluate(async () =>
    (await window.openAware!.invoke({ type: "state.get" })).sources.map(
      (source) => ({
        id: source.id,
        deviceId: source.deviceId,
        revision: source.revision,
        status: source.status,
        lastFrameAt: source.lastFrameAt ?? 0,
      }),
    ),
  );
}
async function framesAdvance(
  page: Page,
  before: Awaited<ReturnType<typeof frames>>,
) {
  await expect
    .poll(() =>
      page.evaluate(async (previous) => {
        const state = await window.openAware!.invoke({ type: "state.get" });
        return {
          ids: state.sources.map((source) => source.id),
          live: previous.every((item) => {
            const source = state.sources.find(
              (source) => source.id === item.id,
            );
            return (
              source?.status === "live" &&
              (source.lastFrameAt ?? 0) > item.lastFrameAt
            );
          }),
        };
      }, before),
    )
    .toEqual({ ids: before.map((source) => source.id), live: true });
}
async function reachable(control: Locator) {
  await control.scrollIntoViewIfNeeded();
  await expect(control).toBeVisible();
  await expect
    .poll(() =>
      control.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
        );
        return (
          rect.left >= 0 &&
          rect.right <= innerWidth + 1 &&
          rect.top >= 0 &&
          rect.bottom <= innerHeight + 1 &&
          (hit === node || (!!hit && node.contains(hit)))
        );
      }),
    )
    .toBe(true);
}

async function fullyContained(control: Locator, region: string, label: string) {
  await expect(control).toBeVisible();
  await expect
    .poll(
      () =>
        control.evaluate((node, selector) => {
          const box = node.getBoundingClientRect();
          const area = node.closest(selector)!.getBoundingClientRect();
          const pane = node.closest(".dock-pane")!.getBoundingClientRect();
          const inside = (bounds: DOMRect) =>
            box.left >= bounds.left - 0.5 &&
            box.right <= bounds.right + 0.5 &&
            box.top >= bounds.top - 0.5 &&
            box.bottom <= bounds.bottom + 0.5;
          return {
            region: inside(area),
            pane: inside(pane),
            viewport:
              box.left >= 0 &&
              box.right <= innerWidth + 0.5 &&
              box.top >= 0 &&
              box.bottom <= innerHeight + 0.5,
          };
        }, region),
      { message: `${label} must fit completely inside its pane and viewport` },
    )
    .toEqual({ region: true, pane: true, viewport: true });
}

async function fittedSource(source: Locator) {
  const inspect = () =>
    source.evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      const header = node
        .querySelector(".dock-pane-handle")!
        .getBoundingClientRect();
      const preview = node
        .querySelector(".source-preview")!
        .getBoundingClientRect();
      const footer = node
        .querySelector(".source-bottom")!
        .getBoundingClientRect();
      const media = node.querySelector("video, canvas")!;
      const nativeWidth =
        media instanceof HTMLVideoElement
          ? media.videoWidth
          : (media as HTMLCanvasElement).width;
      const nativeHeight =
        media instanceof HTMLVideoElement
          ? media.videoHeight
          : (media as HTMLCanvasElement).height;
      return {
        width: preview.width,
        height: preview.height,
        nativeWidth,
        nativeHeight,
        headerHeight: header.height,
        footerHeight: footer.height,
        gapAbove: preview.top - header.bottom,
        gapBelow: footer.top - preview.bottom,
        unusedHeight:
          bounds.height - header.height - preview.height - footer.height,
      };
    });
  await expect
    .poll(
      async () => {
        const dimensions = await inspect();
        return (
          dimensions.nativeWidth > 0 &&
          dimensions.nativeHeight > 0 &&
          Math.abs(dimensions.height - (dimensions.width * 9) / 16) <= 2
        );
      },
      { message: "Default preview must settle at its native16:9 aspect" },
    )
    .toBe(true);
  const dimensions = await inspect();
  expect(dimensions.nativeWidth).toBeGreaterThan(0);
  expect(dimensions.nativeHeight).toBeGreaterThan(0);
  expect(
    Math.abs(dimensions.nativeWidth / dimensions.nativeHeight - 16 / 9),
  ).toBeLessThan(0.01);
  expect(
    Math.abs(dimensions.height - (dimensions.width * 9) / 16),
  ).toBeLessThanOrEqual(2);
  expect(Math.abs(dimensions.headerHeight - 40)).toBeLessThanOrEqual(1);
  expect(Math.abs(dimensions.footerHeight - 32)).toBeLessThanOrEqual(1);
  expect(dimensions.gapAbove).toBeGreaterThanOrEqual(-1);
  expect(dimensions.gapAbove).toBeLessThanOrEqual(2);
  expect(dimensions.gapBelow).toBeGreaterThanOrEqual(-1);
  expect(dimensions.gapBelow).toBeLessThanOrEqual(2);
  expect(dimensions.unusedHeight).toBeGreaterThanOrEqual(0);
  expect(dimensions.unusedHeight).toBeLessThanOrEqual(4);
}

async function extraBelowSources(page: Page, ids: string[]) {
  const extra = pane(page, "extra");
  await expect(
    page.getByRole("heading", { name: "New pane", exact: true }),
  ).toHaveCount(1);
  await expect
    .poll(async () => {
      const extraRect = (await extra.boundingBox())!;
      const sourceRects = await Promise.all(
        ids.map((id) => pane(page, id).boundingBox()),
      );
      return sourceRects.every(
        (rect) => !!rect && extraRect.y >= rect.y + rect.height,
      );
    })
    .toBe(true);
}
async function pairPosition(
  a: Locator,
  b: Locator,
  side: "left" | "right" | "top" | "bottom",
) {
  const first = await a.boundingBox();
  const second = await b.boundingBox();
  if (!first || !second) return false;
  if (side === "left" || side === "right")
    return (
      Math.abs(first.y - second.y) < 2 &&
      (side === "left"
        ? second.x + second.width <= first.x + 2
        : first.x + first.width <= second.x + 2)
    );
  return (
    Math.abs(first.x - second.x) < 2 &&
    (side === "top"
      ? second.y + second.height <= first.y + 2
      : first.y + first.height <= second.y + 2)
  );
}
async function dividerBetween(
  page: Page,
  a: Locator,
  b: Locator,
  axis: "horizontal" | "vertical",
) {
  const first = (await a.boundingBox())!;
  const second = (await b.boundingBox())!;
  const id = await page
    .getByTestId("dashboard-dock-board")
    .locator(`.dock-divider.${axis}`)
    .evaluateAll(
      (nodes, { first, second, axis }) => {
        const sorted = [first, second].sort((a, b) =>
          axis === "horizontal" ? a.x - b.x : a.y - b.y,
        );
        const left = sorted[0]!;
        const right = sorted[1]!;
        return nodes
          .find((node) => {
            const rect = node.getBoundingClientRect();
            return axis === "horizontal"
              ? rect.x >= left.x + left.width - 2 &&
                  rect.right <= right.x + 2 &&
                  Math.abs(rect.y - left.y) < 2
              : rect.y >= left.y + left.height - 2 &&
                  rect.bottom <= right.y + 2 &&
                  Math.abs(rect.x - left.x) < 2;
          })
          ?.getAttribute("data-divider-id");
      },
      { first, second, axis },
    );
  expect(id).toBeTruthy();
  return page
    .getByTestId("dashboard-dock-board")
    .locator(`[data-divider-id="${id}"]`);
}

test("one workspace docks direct live sources and sidebar panes without restarting captures", async () => {
  const { app, page } = await launchVisual();
  try {
    const dashboard = page.getByTestId("dashboard-dock-board");
    await expect(dashboard).toHaveCount(1);
    await expect(
      page.locator(".camera-empty, [data-pane-id='cameras']"),
    ).toHaveCount(0);
    await page.getByTestId("add-source").click();
    await page
      .getByRole("textbox", { name: "Source name", exact: true })
      .fill("Primary synthetic monitor");
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
    const firstId = await page.evaluate(async () => {
      const id = (await window.openAware!.invoke({ type: "state.get" }))
        .sources[0]!.id;
      await window.openAware!.invoke({
        type: "source.update",
        sourceId: id,
        patch: { analysisEnabled: false },
      });
      return id;
    });
    const secondId = await addFixture(
      page,
      "demo",
      "Secondary synthetic monitor",
    );
    await generatedCamera(page);
    const cameraId = await addFixture(
      page,
      "camera",
      "Camera fixture (synthetic)",
    );
    const virtualId = await addFixture(
      page,
      "virtual_camera",
      "Virtual camera (synthetic)",
    );
    const ids = [firstId, secondId, cameraId, virtualId];
    const first = tile(page, firstId);
    const second = tile(page, secondId);
    const camera = tile(page, cameraId);
    const virtual = tile(page, virtualId);
    const firstPane = pane(page, firstId);
    const secondPane = pane(page, secondId);
    const cameraPane = pane(page, cameraId);
    const virtualPane = pane(page, virtualId);
    const assistantPane = dashboard.locator(
      ':scope > [data-pane-id="assistant"]',
    );
    await expect(page.getByTestId("source-tile")).toHaveCount(4);
    await expect(page.locator(".dock-board")).toHaveCount(1);
    await expect(
      dashboard.locator(":scope > .dock-pane.source-pane"),
    ).toHaveCount(4);
    await expect(dashboard.locator(":scope > .dock-pane")).toHaveCount(7);
    await expect(dashboard.locator('[data-pane-id="actions"]')).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Computer actions", exact: true }),
    ).toHaveCount(0);
    await extraBelowSources(page, ids);
    await expect(
      page.locator(
        ".feed-layout, .feed-height-resizer, .session-strip, .dock-layout-tools",
      ),
    ).toHaveCount(0);
    await expect(dashboard.locator(".dock-board, .source-title")).toHaveCount(
      0,
    );
    for (const name of [
      "Primary synthetic monitor",
      "Secondary synthetic monitor",
      "Camera fixture (synthetic)",
      "Virtual camera (synthetic)",
    ])
      await expect(
        page.getByRole("heading", { name, exact: true }),
      ).toHaveCount(1);
    await expect
      .poll(() => pairPosition(firstPane, secondPane, "right"))
      .toBe(true);
    await expect
      .poll(() => pairPosition(cameraPane, virtualPane, "right"))
      .toBe(true);
    expect((await cameraPane.boundingBox())!.y).toBeGreaterThan(
      (await firstPane.boundingBox())!.y,
    );
    await expect(camera.locator("video")).toBeVisible();
    await expect(virtual.locator("video")).toBeVisible();
    const previewSignature = () =>
      second.locator("canvas").evaluate((node) => {
        const canvas = node as HTMLCanvasElement;
        const pixels = canvas
          .getContext("2d")!
          .getImageData(0, 200, canvas.width, 1).data;
        return pixels.reduce(
          (hash, byte) => Math.imul(hash ^ byte, 16777619) >>> 0,
          2166136261,
        );
      });
    const pixels = await previewSignature();
    await expect.poll(previewSignature).not.toBe(pixels);

    const settings = first.getByRole("button", {
      name: "Settings for Primary synthetic monitor",
      exact: true,
    });
    await settings.click();
    await expect(
      first.getByRole("checkbox", { name: "AI analysis" }),
    ).not.toBeChecked();
    const motion = first.getByRole("checkbox", { name: "Motion alerts" });
    // Source switches are controlled by the service snapshot returned over IPC.
    // Wait for that update instead of check()'s immediate DOM-state assertion.
    await motion.click();
    await expect(motion).toBeChecked();
    await motion.click();
    await expect(motion).not.toBeChecked();
    await motion.press("Escape");
    await expect(first.locator(".source-settings")).toHaveCount(0);
    await expect(settings).toBeFocused();
    const scopeButton = page.getByRole("button", {
      name: "Choose question sources",
    });
    await scopeButton.click();
    const scope = page.getByRole("group", { name: "Question sources" });
    await expect(scope.getByRole("checkbox")).toHaveCount(4);
    const scopedSecond = scope.getByRole("checkbox", {
      name: "Secondary synthetic monitor",
      exact: true,
    });
    await scopedSecond.uncheck();
    await expect(scopeButton).toContainText("Sources (3)");
    await scopedSecond.check();
    await scopedSecond.press("Escape");
    await expect(scope).toHaveCount(0);
    await expect(scopeButton).toBeFocused();

    // Only generated fixtures appear in these user-facing screenshots.
    for (const [width, height, file] of [
      [1440, 960, "prototype-desktop-multisource.png"],
      [1024, 720, "prototype-desktop-compact.png"],
    ] as const) {
      await viewport(app, page, width, height);
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true);
      await expect
        .poll(
          () =>
            dashboard.evaluate((board) => {
              const scroller = board.closest(".dock-viewport")!;
              const bounds = scroller.getBoundingClientRect();
              const rect = board.getBoundingClientRect();
              return {
                noHorizontalScroll:
                  scroller.scrollWidth <= scroller.clientWidth + 1,
                widthInsideScroller:
                  rect.left >= bounds.left - 0.5 &&
                  rect.right <= bounds.right + 0.5,
                widthInsideViewport:
                  rect.left >= 0 && rect.right <= innerWidth + 0.5,
              };
            }),
          {
            message:
              "The fitted default board must fit the viewport width without horizontal scrolling",
          },
        )
        .toEqual({
          noHorizontalScroll: true,
          widthInsideScroller: true,
          widthInsideViewport: true,
        });
      await fullyContained(
        assistantPane.getByRole("button", {
          name: "Send question",
          exact: true,
        }),
        ".dock-pane-content",
        "Assistant Send",
      );
      await fullyContained(
        assistantPane.getByRole("textbox", {
          name: "Ask about your workspace",
          exact: true,
        }),
        ".dock-pane-content",
        "Assistant textarea",
      );
      await fullyContained(
        assistantPane.locator(".session-model"),
        ".dock-pane-handle",
        "Assistant model picker",
      );
      await fullyContained(
        assistantPane.getByRole("combobox", {
          name: "Arrange Workspace assistant",
          exact: true,
        }),
        ".dock-pane-handle",
        "Assistant Arrange",
      );
      await expect
        .poll(() => pairPosition(firstPane, secondPane, "right"))
        .toBe(true);
      for (const source of [first, second, camera, virtual]) {
        const preview = (await source
          .locator(".source-preview")
          .boundingBox())!;
        expect(preview.width).toBeGreaterThanOrEqual(258);
        expect(preview.height).toBeGreaterThanOrEqual(144);
        await fittedSource(source);
        await reachable(
          source.getByRole("button", { name: "Disconnect", exact: true }),
        );
        await reachable(source.getByRole("button", { name: /^Remove / }));
      }
      await reachable(page.getByTestId("stop-all"));
      await reachable(
        page.getByRole("button", { name: "Start watching", exact: true }),
      );
      await reachable(
        page.getByRole("button", {
          name: "Reset dashboard layout",
          exact: true,
        }),
      );
      await reachable(page.locator(".conversation-panel textarea"));
      await reachable(
        page.getByRole("button", { name: "Operator", exact: true }),
      );
      await page.evaluate(() => {
        for (const node of document.querySelectorAll(
          ".dock-pane-content, .dashboard-dock-layout, .dock-viewport, .dock-board, main",
        ))
          node.scrollTo(0, 0);
      });
      await page.screenshot({ path: resolve("assets", file), fullPage: false });
    }
    await viewport(app, page, 1440, 960);

    // Navigation can remount preview DOM, while capture IDs and delivery remain live.
    const beforeNavigation = await frames(page);
    await page
      .getByRole("button", { name: "Connections", exact: true })
      .click();
    await expect(dashboard).toHaveCount(0);
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    await expect(page.locator(".dock-board")).toHaveCount(1);
    await framesAdvance(page, beforeNavigation);
    await expect
      .poll(() => pairPosition(firstPane, secondPane, "right"))
      .toBe(true);
    const identities = (await frames(page)).map(
      ({ lastFrameAt: _time, ...identity }) => identity,
    );
    const beforeDocking = await frames(page);
    const held = await page.evaluateHandle((ids) => {
      const source = (id: string) =>
        document.querySelector(
          `[data-testid="source-tile"][data-source-id="${id}"]`,
        )!;
      const first = source(ids[0]!).querySelector("canvas")!;
      const second = source(ids[1]!).querySelector("canvas")!;
      const camera = source(ids[2]!).querySelector("video")!;
      const virtual = source(ids[3]!).querySelector("video")!;
      return {
        first,
        second,
        camera,
        virtual,
        cameraStream: camera.srcObject as MediaStream,
        virtualStream: virtual.srcObject as MediaStream,
      };
    }, ids);
    const assertContinuity = async () => {
      expect(
        await held.evaluate((refs) => ({
          mounted: [refs.first, refs.second, refs.camera, refs.virtual].every(
            (node) => node.isConnected,
          ),
          sameStreams:
            refs.camera.srcObject === refs.cameraStream &&
            refs.virtual.srcObject === refs.virtualStream,
          liveTracks: [
            ...refs.cameraStream.getTracks(),
            ...refs.virtualStream.getTracks(),
          ].every((track) => track.readyState === "live"),
        })),
      ).toEqual({ mounted: true, sameStreams: true, liveTracks: true });
      expect(
        (await frames(page)).map(
          ({ lastFrameAt: _time, ...identity }) => identity,
        ),
      ).toEqual(identities);
    };
    const reset = async () => {
      await page
        .getByRole("button", { name: "Reset dashboard layout", exact: true })
        .click();
      await expect
        .poll(() => pairPosition(firstPane, secondPane, "right"))
        .toBe(true);
      await assertContinuity();
      await extraBelowSources(page, ids);
    };

    const extraPane = pane(page, "extra");
    const extraDivider = await dividerBetween(
      page,
      cameraPane,
      extraPane,
      "vertical",
    );
    const extraHeight = (await extraPane.boundingBox())!.height;
    const beforeExtraResize = await frames(page);
    await extraDivider.focus();
    await extraDivider.press("ArrowUp");
    await expect
      .poll(async () => (await extraPane.boundingBox())!.height)
      .toBeGreaterThan(extraHeight);
    await framesAdvance(page, beforeExtraResize);
    expect((await extraPane.boundingBox())!.height).toBeGreaterThan(
      extraHeight,
    );
    await assertContinuity();
    await reset();
    await page
      .getByRole("combobox", { name: "Arrange New pane", exact: true })
      .selectOption(`${firstId}/top`);
    await expect
      .poll(() => pairPosition(firstPane, extraPane, "top"))
      .toBe(true);
    await assertContinuity();
    await reset();

    // Pointer drag and keyboard separators manipulate source peers on one board.
    let firstBounds = (await firstPane.boundingBox())!;
    await page
      .getByRole("button", {
        name: "Move Secondary synthetic monitor",
        exact: true,
      })
      .dragTo(firstPane, {
        targetPosition: { x: 5, y: Math.floor(firstBounds.height / 2) },
      });
    await expect
      .poll(() => pairPosition(firstPane, secondPane, "left"))
      .toBe(true);
    await assertContinuity();
    const sourceDivider = await dividerBetween(
      page,
      firstPane,
      secondPane,
      "horizontal",
    );
    const sourceWidth = (await firstPane.boundingBox())!.width;
    const beforeSourceResize = await frames(page);
    await sourceDivider.focus();
    await sourceDivider.press("ArrowRight");
    await expect
      .poll(async () => (await firstPane.boundingBox())!.width)
      .toBeLessThan(sourceWidth);
    await framesAdvance(page, beforeSourceResize);
    expect((await firstPane.boundingBox())!.width).toBeLessThan(sourceWidth);
    await assertContinuity();
    await page
      .getByRole("combobox", {
        name: "Arrange Secondary synthetic monitor",
        exact: true,
      })
      .selectOption(`${firstId}/bottom`);
    await expect
      .poll(() => pairPosition(firstPane, secondPane, "bottom"))
      .toBe(true);
    // Stacking initially reaches both panes' minimum height. Give their group
    // space, then prove its internal vertical divider can actually move.
    const heightAtMinimum = (await firstPane.boundingBox())!.height;
    await viewport(app, page, 1440, 1200);
    const sourceGroupDivider = await dividerBetween(
      page,
      secondPane,
      cameraPane,
      "vertical",
    );
    await sourceGroupDivider.focus();
    await sourceGroupDivider.press("End");
    await expect
      .poll(async () => (await firstPane.boundingBox())!.height)
      .toBeGreaterThan(heightAtMinimum);
    await assertContinuity();
    const verticalSourceDivider = await dividerBetween(
      page,
      firstPane,
      secondPane,
      "vertical",
    );
    const sourceHeight = (await firstPane.boundingBox())!.height;
    const beforeVerticalResize = await frames(page);
    await verticalSourceDivider.focus();
    await verticalSourceDivider.press("ArrowUp");
    await expect
      .poll(async () => (await firstPane.boundingBox())!.height)
      .toBeLessThan(sourceHeight);
    await framesAdvance(page, beforeVerticalResize);
    expect((await firstPane.boundingBox())!.height).toBeLessThan(sourceHeight);
    await assertContinuity();
    await viewport(app, page, 1440, 960);
    await reset();
    await page
      .getByRole("combobox", {
        name: "Arrange Virtual camera (synthetic)",
        exact: true,
      })
      .selectOption(`${cameraId}/left`);
    await expect
      .poll(() => pairPosition(cameraPane, virtualPane, "left"))
      .toBe(true);
    await assertContinuity();
    await page
      .getByRole("combobox", {
        name: "Arrange Virtual camera (synthetic)",
        exact: true,
      })
      .selectOption(`${cameraId}/bottom`);
    await expect
      .poll(() => pairPosition(cameraPane, virtualPane, "bottom"))
      .toBe(true);
    await assertContinuity();
    await reset();

    // The assistant moves like any other pane and retains its unsent draft.
    const composer = page.locator(".conversation-panel textarea");
    const draft = "Keep this unsent draft while I arrange the panes.";
    await composer.fill(draft);
    firstBounds = (await firstPane.boundingBox())!;
    await page
      .getByRole("button", { name: "Move Workspace assistant", exact: true })
      .dragTo(firstPane, {
        targetPosition: { x: 5, y: Math.floor(firstBounds.height / 2) },
      });
    await expect
      .poll(() => pairPosition(firstPane, assistantPane, "left"))
      .toBe(true);
    await expect(composer).toHaveValue(draft);
    await assertContinuity();
    await reset();
    await page
      .getByRole("combobox", {
        name: "Arrange Workspace assistant",
        exact: true,
      })
      .selectOption(`${firstId}/top`);
    await expect
      .poll(() => pairPosition(firstPane, assistantPane, "top"))
      .toBe(true);
    await expect(composer).toHaveValue(draft);
    await assertContinuity();
    await reset();
    const mainDividerId = await dashboard
      .locator(".dock-divider.horizontal")
      .evaluateAll((nodes) =>
        [...nodes]
          .sort(
            (a, b) =>
              b.getBoundingClientRect().height -
              a.getBoundingClientRect().height,
          )[0]!
          .getAttribute("data-divider-id"),
      );
    const mainDivider = dashboard.locator(
      `[data-divider-id="${mainDividerId}"]`,
    );
    const dividerBounds = (await mainDivider.boundingBox())!;
    const widthBeforePointer = (await firstPane.boundingBox())!.width;
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
      .poll(async () => (await firstPane.boundingBox())!.width)
      .toBeLessThan(widthBeforePointer - 10);
    await assertContinuity();
    await mainDivider.focus();
    await mainDivider.press("Home");
    await expect(mainDivider).toHaveAttribute(
      "aria-valuenow",
      (await mainDivider.getAttribute("aria-valuemin"))!,
    );
    await assertContinuity();
    await reset();

    // Compact mode keeps docking order and scrolls one board, with usable controls.
    await viewport(app, page, 820, 720);
    await page
      .getByRole("combobox", {
        name: "Arrange Workspace assistant",
        exact: true,
      })
      .selectOption(`${firstId}/top`);
    await expect
      .poll(
        async () =>
          (await assistantPane.boundingBox())!.y <
          (await firstPane.boundingBox())!.y,
      )
      .toBe(true);
    for (const source of [first, second, camera, virtual]) {
      expect(
        (await source.locator(".source-preview").boundingBox())!.height,
      ).toBeGreaterThanOrEqual(144);
      await reachable(
        source.getByRole("button", { name: "Disconnect", exact: true }),
      );
      await reachable(source.getByRole("button", { name: /^Remove / }));
    }
    await reachable(composer);
    await reachable(page.getByTestId("stop-all"));
    await expect(page.locator(".dock-board")).toHaveCount(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await assertContinuity();
    await viewport(app, page, 1440, 960);
    await reset();
    await framesAdvance(page, beforeDocking);
    const afterPixels = await previewSignature();
    await expect.poll(previewSignature).not.toBe(afterPixels);
    await pane(page, secondId)
      .getByRole("button", {
        name: "Focus Secondary synthetic monitor",
        exact: true,
      })
      .click();
    await expect(second).toHaveAttribute("data-presentation", "primary");
    await expect(first).toHaveAttribute("data-presentation", "secondary");
    await expect(secondPane).toBeFocused();
    await assertContinuity();
    await held.dispose();
    await page.getByTestId("stop-all").click();
    await expect
      .poll(() =>
        page.evaluate(async () =>
          (await window.openAware!.invoke({ type: "state.get" })).sources.every(
            (source) => source.status === "stopped",
          ),
        ),
      )
      .toBe(true);
    await expect(
      page.locator(
        '[data-testid="source-tile"] video, [data-testid="source-tile"] canvas',
      ),
    ).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test("four generated displays start in readable 2x2 panes and can scroll as one custom row", async () => {
  const { app, page } = await launchVisual();
  try {
    await viewport(app, page, 1024, 720);
    const ids: string[] = [];
    let extraAfterTwo: { y: number; height: number } | undefined;
    for (let i = 0; i < 4; i++) {
      ids.push(await addFixture(page, "demo", `Synthetic display ${i + 1}`));
      if (i === 1) {
        await fittedSource(tile(page, ids[0]!));
        extraAfterTwo = (await pane(page, "extra").boundingBox())!;
      }
    }
    const dashboard = page.getByTestId("dashboard-dock-board");
    await expect(page.locator(".dock-board")).toHaveCount(1);
    await expect(dashboard.locator(":scope > .source-pane")).toHaveCount(4);
    await expect(dashboard.locator(":scope > .dock-pane")).toHaveCount(7);
    await expect(dashboard.locator('[data-pane-id="actions"]')).toHaveCount(0);
    await expect(dashboard.locator(".dock-board")).toHaveCount(0);
    await expect(
      page.locator(
        ".camera-empty, [data-pane-id='cameras'], .feed-layout, .source-title",
      ),
    ).toHaveCount(0);
    await extraBelowSources(page, ids);
    // Additional monitors occupy the former empty lower area; only the unused
    // remainder stays available as New pane beneath the fitted source rows.
    await expect
      .poll(async () => {
        const extra = (await pane(page, "extra").boundingBox())!;
        return (
          extra.y > extraAfterTwo!.y && extra.height < extraAfterTwo!.height
        );
      })
      .toBe(true);
    await expect
      .poll(() =>
        pairPosition(pane(page, ids[0]!), pane(page, ids[1]!), "right"),
      )
      .toBe(true);
    await expect
      .poll(() =>
        pairPosition(pane(page, ids[2]!), pane(page, ids[3]!), "right"),
      )
      .toBe(true);
    expect((await pane(page, ids[2]!).boundingBox())!.y).toBeGreaterThan(
      (await pane(page, ids[0]!).boundingBox())!.y,
    );
    const before = await frames(page);
    for (const id of ids) {
      const source = tile(page, id);
      const preview = (await source.locator(".source-preview").boundingBox())!;
      expect(preview.width).toBeGreaterThanOrEqual(258);
      expect(preview.height).toBeGreaterThanOrEqual(144);
      await fittedSource(source);
      await reachable(
        source.getByRole("button", { name: "Disconnect", exact: true }),
      );
      await reachable(source.getByRole("button", { name: /^Remove / }));
    }
    const held = await page.evaluateHandle(
      (ids) =>
        ids.map((id) =>
          document.querySelector(
            `[data-testid="source-tile"][data-source-id="${id}"] canvas`,
          )!,
        ),
      ids,
    );
    for (let index = 1; index < ids.length; index++) {
      await page
        .getByRole("combobox", {
          name: `Arrange Synthetic display ${index + 1}`,
          exact: true,
        })
        .selectOption(`${ids[index - 1]}/right`);
    }
    for (let index = 1; index < ids.length; index++) {
      await expect
        .poll(() =>
          pairPosition(
            pane(page, ids[index - 1]!),
            pane(page, ids[index]!),
            "right",
          ),
        )
        .toBe(true);
    }
    const scroller = page.locator(".dashboard-dock-layout > .dock-viewport");
    await expect(scroller).toHaveCount(1);
    await expect
      .poll(() =>
        scroller.evaluate((node) => node.scrollWidth > node.clientWidth),
      )
      .toBe(true);
    for (const id of ids) {
      const source = tile(page, id);
      expect(
        (await source.locator(".source-preview").boundingBox())!.width,
      ).toBeGreaterThanOrEqual(258);
      await reachable(
        source.getByRole("button", { name: "Disconnect", exact: true }),
      );
      await reachable(source.getByRole("button", { name: /^Remove / }));
    }
    const focusPicker = page.getByRole("combobox", {
      name: "Focused desktop source",
      exact: true,
    });
    // Select a different primary each time so this exercises the actual change
    // handler. Focus must reveal offscreen peers without rearranging the row.
    await focusPicker.selectOption(ids[3]!);
    await expect(pane(page, ids[3]!)).toBeFocused();
    await fullyContained(
      pane(page, ids[3]!),
      ".dock-viewport",
      "Focused last display",
    );
    const lastScroll = await scroller.evaluate((node) => node.scrollLeft);
    await focusPicker.selectOption(ids[0]!);
    await expect(pane(page, ids[0]!)).toBeFocused();
    await fullyContained(
      pane(page, ids[0]!),
      ".dock-viewport",
      "Focused first display",
    );
    const firstScroll = await scroller.evaluate((node) => node.scrollLeft);
    expect(firstScroll).toBeLessThan(lastScroll);
    await focusPicker.selectOption(ids[3]!);
    await expect(pane(page, ids[3]!)).toBeFocused();
    await expect(tile(page, ids[3]!)).toHaveAttribute(
      "data-presentation",
      "primary",
    );
    await fullyContained(
      pane(page, ids[3]!),
      ".dock-viewport",
      "Refocused last display",
    );
    await expect
      .poll(() => scroller.evaluate((node) => node.scrollLeft))
      .toBeGreaterThan(firstScroll);
    expect(
      await held.evaluate((nodes) => nodes.every((node) => node.isConnected)),
    ).toBe(true);
    await held.dispose();
    await expect(page.locator(".dock-board")).toHaveCount(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await framesAdvance(page, before);
    await reachable(page.getByTestId("stop-all"));
    await page.getByTestId("stop-all").click();
    await expect(
      page.locator('[data-testid="source-tile"] canvas'),
    ).toHaveCount(0);
  } finally {
    await app.close();
  }
});
