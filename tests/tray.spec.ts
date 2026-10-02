import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
} from "@playwright/test";
import { resolve } from "node:path";

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0); // Read-only liveness check of this test's own process.
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

test("production tray installs real Show, Stop, and Quit callbacks without selecting a feed", async () => {
  test.skip(
    process.platform !== "win32",
    "Windows tray prototype verification",
  );
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).flatMap(([key, value]) =>
      value === undefined ? [] : [[key, value]],
    ),
  );
  env.OPENAWARE_TEST = "0";
  delete env.ELECTRON_RUN_AS_NODE;
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({
      executablePath: process.env.OPENAWARE_EXECUTABLE,
      args: process.env.OPENAWARE_EXECUTABLE
        ? ["--headless"]
        : [".", "--headless"],
      cwd: resolve("."),
      env,
    });
    const pid = await app.evaluate(() => process.pid);
    const page = await app.firstWindow();
    await expect
      .poll(() => page.evaluate(() => typeof window.openAware?.getDesktopState))
      .toBe("function");
    await expect
      .poll(() => page.evaluate(() => window.openAware!.getDesktopState()))
      .toMatchObject({
        backgroundMode: true,
        windowVisible: false,
        trayAvailable: true,
        launchMode: "background",
      });
    const initial = await page.evaluate(() =>
      window.openAware!.invoke({ type: "state.get" }),
    );
    expect(initial.session).toBe("idle");
    expect(initial.sources).toHaveLength(0);
    expect(initial.binding.status).toBe("unconfigured");
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.isVisible(),
      ),
    ).toBe(false);

    // Observe the actual menu passed to the actual native Tray. This temporary
    // main-process spy always delegates to Electron and adds no production API.
    // We invoke installed MenuItem callbacks below; this is not an OS mouse test.
    await app.evaluate(({ Tray }) => {
      const original = Tray.prototype.setContextMenu;
      Reflect.set(globalThis, "trayTestOriginalSetMenu", original);
      Tray.prototype.setContextMenu = function (menu) {
        Reflect.set(globalThis, "trayTestInstalledMenu", menu);
        Reflect.set(globalThis, "trayTestNativeTray", this);
        return original.call(this, menu);
      };
    });
    // Force a genuine menu update to capture the existing tray instance.
    await page.evaluate(() => window.openAware!.setBackgroundMode(false));
    await page.evaluate(() => window.openAware!.setBackgroundMode(true));
    const installed = await app.evaluate(() => {
      const menu = Reflect.get(globalThis, "trayTestInstalledMenu") as
        Electron.Menu | undefined;
      const tray = Reflect.get(globalThis, "trayTestNativeTray") as
        Electron.Tray | undefined;
      return {
        trayAlive: Boolean(tray && !tray.isDestroyed()),
        items: menu?.items.map((item) => ({
          label: item.label,
          type: item.type,
          checked: item.checked,
        })),
      };
    });
    expect(installed.trayAlive).toBe(true);
    expect(installed.items).toEqual([
      { label: "Show OpenAware", type: "normal", checked: false },
      {
        label: "Keep running in background",
        type: "checkbox",
        checked: true,
      },
      { label: "Stop all capture and actions", type: "normal", checked: false },
      { label: "", type: "separator", checked: false },
      { label: "Quit", type: "normal", checked: false },
    ]);
    await app.evaluate(() => {
      const menu = Reflect.get(
        globalThis,
        "trayTestInstalledMenu",
      ) as Electron.Menu;
      const item = menu.items.find(
        (candidate) => candidate.label === "Show OpenAware",
      );
      if (!item) throw new Error("Missing installed Show callback");
      item.click(item, undefined, {});
    });
    await expect
      .poll(() => page.evaluate(() => window.openAware!.getDesktopState()))
      .toMatchObject({
        backgroundMode: true,
        windowVisible: true,
        trayAvailable: true,
      });
    await expect
      .poll(() =>
        app!.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]!.isVisible(),
        ),
      )
      .toBe(true);
    await app.evaluate(() => {
      const menu = Reflect.get(
        globalThis,
        "trayTestInstalledMenu",
      ) as Electron.Menu;
      const item = menu.items.find(
        (candidate) => candidate.label === "Stop all capture and actions",
      );
      if (!item) throw new Error("Missing installed Stop callback");
      item.click(item, undefined, {});
    });
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const state = await window.openAware!.invoke({ type: "state.get" });
          return {
            session: state.session,
            sources: state.sources.length,
            pendingPlan: state.pendingPlan,
          };
        }),
      )
      .toEqual({ session: "stopped", sources: 0, pendingPlan: undefined });
    expect(
      await page.evaluate(() => window.openAware!.getDesktopState()),
    ).toMatchObject({ backgroundMode: true, trayAvailable: true });

    const closed = app.waitForEvent("close", { timeout: 10_000 });
    await app
      .evaluate(({ Tray }) => {
        // Restore the test spy before exercising the genuine Quit callback.
        Tray.prototype.setContextMenu = Reflect.get(
          globalThis,
          "trayTestOriginalSetMenu",
        );
        const menu = Reflect.get(
          globalThis,
          "trayTestInstalledMenu",
        ) as Electron.Menu;
        const item = menu.items.find((candidate) => candidate.label === "Quit");
        if (!item) throw new Error("Missing installed Quit callback");
        item.click(item, undefined, {});
      })
      .catch((error: unknown) => {
        if (
          !(error instanceof Error) ||
          !/closed|destroyed/i.test(error.message)
        )
          throw error;
      });
    await closed;
    await expect.poll(() => processIsRunning(pid)).toBe(false);
  } finally {
    if (app)
      await app.close().catch((error: unknown) => {
        if (
          !(error instanceof Error) ||
          !/closed|destroyed/i.test(error.message)
        )
          throw error;
      });
  }
});
