import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import type { DesktopState } from "../packages/contracts/src/index";

const closedApps = new WeakSet<ElectronApplication>();

function processExists(pid: number): boolean {
  try {
    // Signal zero checks only this application's known PID; it sends no signal.
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

function environment(): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(process.env).flatMap(([key, value]) =>
      value === undefined ? [] : [[key, value]],
    ),
  );
  env.OPENAWARE_TEST = "1";
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

async function launch(extraArgs: string[] = []): Promise<ElectronApplication> {
  const app = await electron.launch({
    executablePath: process.env.OPENAWARE_EXECUTABLE,
    args: process.env.OPENAWARE_EXECUTABLE ? extraArgs : [".", ...extraArgs],
    cwd: resolve("."),
    env: environment(),
  });
  app.on("close", () => closedApps.add(app));
  return app;
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  );
}

async function closeIfRunning(
  app: ElectronApplication | undefined,
): Promise<void> {
  if (!app || closedApps.has(app)) return;
  await app.close().catch((error: unknown) => {
    if (!(error instanceof Error) || !/closed|destroyed/i.test(error.message))
      throw error;
  });
}

async function quitThroughBridge(
  app: ElectronApplication,
  page: Page,
): Promise<void> {
  const pid = await app.evaluate(() => process.pid);
  const closed = app.waitForEvent("close", { timeout: 10_000 });
  await page
    .evaluate(() => window.openAware!.quit())
    .catch((error: unknown) => {
      // Quitting can destroy the renderer before its invoke promise resolves.
      if (!(error instanceof Error) || !/closed|destroyed/i.test(error.message))
        throw error;
    });
  await closed;
  await expect.poll(() => processExists(pid)).toBe(false);
}

async function bindMockVision(page: Page, endpoint: string): Promise<void> {
  await page.evaluate(async (url) => {
    await window.openAware!.invoke({
      type: "provider.discover",
      provider: "lmstudio",
      endpoint: url,
    });
    await window.openAware!.invoke({
      type: "provider.select",
      modelId: "background-fixture",
    });
    const state = await window.openAware!.invoke({ type: "state.get" });
    const source = state.sources[0]!;
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "red";
    context.fillRect(50, 50, 100, 100);
    context.fillStyle = "blue";
    context.beginPath();
    context.arc(300, 100, 50, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "black";
    context.font = "30px sans-serif";
    context.fillText("OPENAWARE 42", 30, 300);
    await window.openAware!.invoke({
      type: "provider.probe",
      frame: {
        id: crypto.randomUUID(),
        sourceId: source.id,
        sourceRevision: source.revision,
        capturedAt: Date.now(),
        width: canvas.width,
        height: canvas.height,
        dataUrl: canvas.toDataURL("image/jpeg"),
      },
    });
  }, endpoint);
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          (await window.openAware!.invoke({ type: "state.get" })).binding
            .status,
      ),
    )
    .toBe("verified");
}

test("background mode preserves synthetic capture and model work, Show restores it, and Quit exits", async () => {
  const requests: Array<{ store?: boolean; stream?: boolean }> = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/api/v1/models") {
        res.end(
          JSON.stringify({
            models: [
              {
                type: "llm",
                key: "background-fixture",
                display_name: "Background test fixture",
                capabilities: { vision: true },
                loaded_instances: [{}],
              },
            ],
          }),
        );
      } else if (req.url === "/api/v1/chat") {
        requests.push(JSON.parse(body));
        res.end(
          JSON.stringify({
            output: [
              {
                type: "message",
                content:
                  "Red square, blue circle, OPENAWARE 42. Synthetic background test, not actual model vision.",
              },
            ],
          }),
        );
      } else {
        res.statusCode = 404;
        res.end("{}");
      }
    });
  });
  let app: ElectronApplication | undefined;
  try {
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing background fixture address");
    app = await launch();
    const page = await app.firstWindow();
    await expect
      .poll(() => page.evaluate(() => typeof window.openAware?.getDesktopState))
      .toBe("function");
    expect(
      await page.evaluate(() => window.openAware!.getDesktopState()),
    ).toMatchObject({
      backgroundMode: false,
      windowVisible: false,
      trayAvailable: false,
      launchMode: "window",
    });
    await page.evaluate(() => window.openAware!.setBackgroundMode(false));
    await expect
      .poll(() =>
        app!.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]!.isVisible(),
        ),
      )
      .toBe(true);
    // Runtime validation must refuse values a forged renderer could send.
    expect(
      await page.evaluate(async () => {
        try {
          await window.openAware!.setBackgroundMode("yes" as never);
          return false;
        } catch {
          return true;
        }
      }),
    ).toBe(true);
    await page.evaluate(() => {
      Reflect.set(window, "backgroundTestEvents", []);
      const unsubscribe = window.openAware!.onDesktopState((state) => {
        (Reflect.get(window, "backgroundTestEvents") as DesktopState[]).push(
          state,
        );
      });
      Reflect.set(window, "backgroundTestUnsubscribe", unsubscribe);
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
    await bindMockVision(page, `http://127.0.0.1:${address.port}`);
    await page.evaluate(() =>
      window.openAware!.invoke({ type: "monitor.start" }),
    );
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            (await window.openAware!.invoke({ type: "state.get" })).observations
              .length,
        ),
      )
      .toBeGreaterThan(0);
    const baseline = await page.evaluate(() =>
      window.openAware!.invoke({ type: "state.get" }),
    );
    const requestCount = requests.length;
    const hidden = await page.evaluate(() =>
      window.openAware!.setBackgroundMode(true),
    );
    expect(hidden).toMatchObject({
      backgroundMode: true,
      windowVisible: false,
    });
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.isVisible(),
      ),
    ).toBe(false);
    await expect
      .poll(
        () =>
          page.evaluate(
            async () =>
              (await window.openAware!.invoke({ type: "state.get" })).sources[0]
                ?.lastFrameAt ?? 0,
          ),
        { timeout: 10_000 },
      )
      .toBeGreaterThan(baseline.sources[0]!.lastFrameAt! + 2000);
    await expect
      .poll(() => requests.length, { timeout: 10_000 })
      .toBeGreaterThan(requestCount);
    const backgroundState = await page.evaluate(() =>
      window.openAware!.invoke({ type: "state.get" }),
    );
    expect(backgroundState.session).toBe("monitoring");
    expect(backgroundState.sources[0]!.status).toBe("live");
    expect(backgroundState.observations.length).toBeGreaterThan(
      baseline.observations.length,
    );
    expect(
      requests.every(
        (request) => request.store === false && request.stream === false,
      ),
    ).toBe(true);
    await page.evaluate(() => window.openAware!.setBackgroundMode(false));
    await expect
      .poll(() =>
        app!.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]!.isVisible(),
        ),
      )
      .toBe(true);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const events = Reflect.get(
            window,
            "backgroundTestEvents",
          ) as DesktopState[];
          return (
            events.some(
              (state) => state.backgroundMode && !state.windowVisible,
            ) &&
            events.some((state) => !state.backgroundMode && state.windowVisible)
          );
        }),
      )
      .toBe(true);
    await page.evaluate(() => window.openAware!.setBackgroundMode(true));
    // Tray Show brings the window back without clearing the close-to-tray preference.
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.show(),
    );
    await expect
      .poll(() => page.evaluate(() => window.openAware!.getDesktopState()))
      .toMatchObject({
        backgroundMode: true,
        windowVisible: true,
      });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.close(),
    );
    expect(closedApps.has(app)).toBe(false);
    expect(
      await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        return Boolean(window && !window.isDestroyed() && !window.isVisible());
      }),
    ).toBe(true);
    await expect
      .poll(() => page.evaluate(() => window.openAware!.getDesktopState()))
      .toMatchObject({
        backgroundMode: true,
        windowVisible: false,
      });
    await quitThroughBridge(app, page);
    const quitCount = requests.length;
    await new Promise((done) => setTimeout(done, 2200));
    expect(requests.length).toBe(quitCount);
  } finally {
    await closeIfRunning(app);
    if (server.listening) await closeServer(server);
  }
});

test("--headless starts idle with no selected feeds and quits without reopening the dashboard", async () => {
  let app: ElectronApplication | undefined;
  try {
    app = await launch(["--headless"]);
    const page = await app.firstWindow();
    await expect
      .poll(() => page.evaluate(() => typeof window.openAware?.getDesktopState))
      .toBe("function");
    await expect
      .poll(() => page.evaluate(() => window.openAware!.getDesktopState()))
      .toMatchObject({
        backgroundMode: true,
        windowVisible: false,
        trayAvailable: false,
        launchMode: "background",
      });
    const state = await page.evaluate(() =>
      window.openAware!.invoke({ type: "state.get" }),
    );
    expect(state.session).toBe("idle");
    expect(state.sources).toHaveLength(0);
    expect(state.binding.status).toBe("unconfigured");
    expect(
      await page.evaluate(() => window.openAware!.listDesktopSources()),
    ).toEqual([]);
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.isVisible(),
      ),
    ).toBe(false);
    await quitThroughBridge(app, page);
  } finally {
    await closeIfRunning(app);
  }
});

test("closing the window outside background mode exits the application", async () => {
  let app: ElectronApplication | undefined;
  try {
    app = await launch();
    const page = await app.firstWindow();
    await expect
      .poll(() => page.evaluate(() => typeof window.openAware?.getDesktopState))
      .toBe("function");
    await page.evaluate(() => window.openAware!.setBackgroundMode(false));
    expect(
      await page.evaluate(() => window.openAware!.getDesktopState()),
    ).toMatchObject({ backgroundMode: false, windowVisible: true });
    const pid = await app.evaluate(() => process.pid);
    const closed = app.waitForEvent("close", { timeout: 10_000 });
    await app
      .evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.close(),
      )
      .catch((error: unknown) => {
        if (
          !(error instanceof Error) ||
          !/closed|destroyed/i.test(error.message)
        )
          throw error;
      });
    await closed;
    await expect.poll(() => processExists(pid)).toBe(false);
  } finally {
    await closeIfRunning(app);
  }
});
