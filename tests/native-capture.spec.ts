import { _electron as electron, expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type {
  BrowserWindow as NativeWindow,
  WebContents as NativeContents,
} from "electron";

interface PreviewReceipt {
  count: number;
  sequence: number;
  capturedAt: number;
  width: number;
  height: number;
  nativeWidth: number;
  nativeHeight: number;
}

test("isolated native owners capture two exact fixture windows and Stop releases both", async () => {
  test.skip(process.platform !== "win32", "Native Windows capture regression");
  const fixtureNames = [
    `OpenAware native fixture A ${randomUUID()}`,
    `OpenAware native fixture B ${randomUUID()}`,
  ];
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).flatMap(([key, value]) =>
      value === undefined ? [] : [[key, value]],
    ),
  );
  env.OPENAWARE_TEST = "0";
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: process.env.OPENAWARE_EXECUTABLE,
    args: process.env.OPENAWARE_EXECUTABLE ? [] : ["."],
    cwd: resolve("."),
    env,
  });
  try {
    const page = await app.firstWindow();
    await expect
      .poll(() => page.evaluate(() => typeof window.openAware?.invoke))
      .toBe("function");
    const dashboardWindowId = await app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.id,
    );
    await page.evaluate(() => {
      const receipts: Record<string, PreviewReceipt> = {};
      (
        window as unknown as { nativePreviewReceipts: typeof receipts }
      ).nativePreviewReceipts = receipts;
      window.openAware!.onDesktopFrame((frame) => {
        // Retain metadata only; the test never exports captured pixels.
        receipts[frame.sourceId] = {
          count: (receipts[frame.sourceId]?.count || 0) + 1,
          sequence: frame.sequence,
          capturedAt: frame.capturedAt,
          width: frame.width,
          height: frame.height,
          nativeWidth: frame.nativeWidth,
          nativeHeight: frame.nativeHeight,
        };
      });
    });

    await app.evaluate(async ({ BrowserWindow, desktopCapturer }, names) => {
      // Never enumerate screen pixels or request thumbnails. The real native
      // selector receives only these two generated windows, with its original
      // DesktopCapturerSource objects intact. No getDisplayMedia mock is used.
      const nativeGetSources = desktopCapturer.getSources.bind(desktopCapturer);
      desktopCapturer.getSources = async () => {
        const choices = await nativeGetSources({
          types: ["window"],
          thumbnailSize: { width: 0, height: 0 },
          fetchWindowIcons: false,
        });
        return choices.filter((choice) => names.includes(choice.name));
      };
      for (const [index, name] of names.entries()) {
        const fixture = new BrowserWindow({
          title: name,
          width: 640,
          height: 360,
          show: false,
          backgroundColor: index === 0 ? "#901818" : "#181890",
          webPreferences: {
            // An isolated partition avoids the application's renderer CSP.
            // This generated document makes no network requests and exposes
            // no preload, Node, camera, desktop, or model capabilities.
            partition: `native-fixture-${index}-${name}`,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            backgroundThrottling: false,
          },
        });
        const color = index === 0 ? "#901818" : "#181890";
        const html = `<!doctype html><html><head><title>${name}</title>
          <style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:${color};color:white;font:22px sans-serif}
          h1{font-size:22px;margin:24px}p{margin:24px}i{position:absolute;left:20px;bottom:25px;width:70px;height:70px;background:#ffee22;animation:move 1s linear infinite alternate}
          @keyframes move{to{transform:translateX(420px)}}</style></head>
          <body><h1>SYNTHETIC NATIVE CAPTURE ${index + 1}</h1>
          <p>Generated test window only. No personal desktop content.</p><i></i></body></html>`;
        await fixture.loadURL(`data:text/html,${encodeURIComponent(html)}`);
        fixture.showInactive();
      }
    }, fixtureNames);

    await expect
      .poll(async () => {
        const choices = await page.evaluate(() =>
          window.openAware!.listDesktopSources(),
        );
        return choices.map((choice) => choice.name).sort();
      })
      .toEqual([...fixtureNames].sort());

    const sourceIds: string[] = [];
    for (const name of fixtureNames) {
      await page.getByTestId("add-source").click();
      const dialog = page.getByRole("dialog", { name: "Add a source" });
      await dialog.getByRole("button", { name: "Window", exact: true }).click();
      await dialog.getByRole("button", { name, exact: true }).click();
      await dialog
        .getByRole("button", { name: "Connect source", exact: true })
        .click();
      await expect(dialog).not.toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(async (sourceName) => {
            const source = (
              await window.openAware!.invoke({ type: "state.get" })
            ).sources.find((item) => item.name === sourceName);
            return {
              status: source?.status,
              decodedFrame: !!source?.lastFrameAt,
              error: source?.error || "",
            };
          }, name),
        )
        .toEqual({ status: "live", decodedFrame: true, error: "" });
      const id = await page.evaluate(async (sourceName) => {
        const source = (
          await window.openAware!.invoke({ type: "state.get" })
        ).sources.find((item) => item.name === sourceName)!;
        await window.openAware!.invoke({
          type: "source.update",
          sourceId: source.id,
          patch: { analysisEnabled: false },
        });
        return source.id;
      }, name);
      sourceIds.push(id);
    }

    await expect(page.getByTestId("source-tile")).toHaveCount(2);
    const framesBeforeFocus = await page.evaluate(async () =>
      (await window.openAware!.invoke({ type: "state.get" })).sources.map(
        (source) => source.lastFrameAt || 0,
      ),
    );
    await page
      .getByRole("combobox", { name: "Focused desktop source" })
      .selectOption(sourceIds[1]!);
    await page
      .getByRole("combobox", { name: "Focused desktop source" })
      .selectOption(sourceIds[0]!);
    await expect
      .poll(() =>
        page.evaluate(async (previous) => {
          const state = await window.openAware!.invoke({ type: "state.get" });
          return state.sources.every(
            (source, index) =>
              source.status === "live" &&
              (source.lastFrameAt || 0) > previous[index]!,
          );
        }, framesBeforeFocus),
      )
      .toBe(true);

    const nativeVideos = await app.evaluate(async ({ BrowserWindow }) => {
      const owners = BrowserWindow.getAllWindows().filter(
        (candidate) =>
          candidate.getTitle() === "OpenAware capture worker" &&
          candidate.webContents.getURL().endsWith("/capture/index.html"),
      );
      (
        globalThis as unknown as {
          nativeCaptureOwners: {
            window: NativeWindow;
            contents: NativeContents;
          }[];
        }
      ).nativeCaptureOwners = owners.map((owner) => ({
        window: owner,
        contents: owner.webContents,
      }));
      return Promise.all(
        owners.map(async (owner) => ({
          hidden: !owner.isVisible(),
          native: await owner.webContents.executeJavaScript(`(() => {
            const video = document.querySelector('#capture');
            const stream = video.srcObject;
            return {
              width: video.videoWidth,
              height: video.videoHeight,
              decoded: video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA,
              tracks: stream.getTracks().map(track => ({
                kind: track.kind,
                live: track.readyState === 'live',
                surface: track.getSettings().displaySurface
              })),
              bridge: typeof window.openAware,
              node: typeof require
            };
          })()`),
        })),
      );
    });
    expect(nativeVideos).toHaveLength(2);
    for (const owner of nativeVideos) {
      expect(owner.hidden).toBe(true);
      expect(owner.native.width).toBeGreaterThan(0);
      expect(owner.native.height).toBeGreaterThan(0);
      expect(owner.native.decoded).toBe(true);
      expect(owner.native.tracks).toEqual([
        { kind: "video", live: true, surface: "window" },
      ]);
      expect(owner.native.bridge).toBe("undefined");
      expect(owner.native.node).toBe("undefined");
    }
    expect(
      await page.evaluate(() =>
        [...document.querySelectorAll("video")].some(
          (video) => video.srcObject instanceof MediaStream,
        ),
      ),
    ).toBe(false);
    for (const [index, name] of fixtureNames.entries()) {
      const tile = page.getByTestId("source-tile").filter({
        has: page.getByRole("heading", { name, exact: true }),
      });
      await expect(tile.locator("canvas")).toBeVisible();
      const pixel = await tile.locator("canvas").evaluate((canvas) => {
        const preview = canvas as HTMLCanvasElement;
        return [
          ...preview
            .getContext("2d")!
            .getImageData(
              Math.floor(preview.width / 2),
              Math.floor(preview.height / 2),
              1,
              1,
            ).data,
        ];
      });
      // The two generated windows have different solid backgrounds. This
      // checks exact source routing through the owner's JPEG preview boundary.
      expect(
        index === 0 ? pixel[0]! - pixel[2]! : pixel[2]! - pixel[0]!,
      ).toBeGreaterThan(40);
      const receipt = await page.evaluate(
        (sourceId) =>
          (
            window as unknown as {
              nativePreviewReceipts: Record<string, PreviewReceipt>;
            }
          ).nativePreviewReceipts[sourceId]!,
        sourceIds[index]!,
      );
      expect(receipt.count).toBeGreaterThan(1);
      expect(receipt.nativeWidth).toBeGreaterThan(0);
      expect(receipt.nativeHeight).toBeGreaterThan(0);
      expect(Math.max(receipt.width, receipt.height)).toBeLessThanOrEqual(1280);
    }
    // Both exact helper owners are still live here. Their consent must never
    // authorize legacy acquisition from the dashboard's separate session.
    await page.getByTestId("add-source").click();
    const legacyCapture = await page.evaluate(async () => {
      let stream: MediaStream | undefined;
      let selectionRejected = false;
      let captureAttempted = false;
      const state = await window.openAware!.invoke({ type: "state.get" });
      try {
        await window.openAware!.selectDesktopSource(state.sources[0]!.deviceId);
      } catch {
        selectionRejected = true;
      }
      try {
        // Even though the old selection IPC now rejects, actually attempt
        // legacy acquisition. An early IPC rejection must not hide a bypass.
        // Both IDs belong to this test's generated windows only.
        captureAttempted = true;
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            mandatory: {
              chromeMediaSource: "desktop",
              chromeMediaSourceId: state.sources[1]!.deviceId,
            },
          } as MediaTrackConstraints,
          audio: false,
        });
        return {
          granted: true,
          selectionRejected,
          captureAttempted,
          tracks: stream.getTracks().map((track) => ({
            kind: track.kind,
            label: track.label,
            settings: track.getSettings(),
          })),
        };
      } catch (error) {
        return {
          granted: false,
          selectionRejected,
          captureAttempted,
          error: error instanceof DOMException ? error.name : String(error),
        };
      } finally {
        stream?.getTracks().forEach((track) => track.stop());
      }
    });
    if (legacyCapture.granted)
      console.error(
        "Generated-window legacy route unexpectedly granted",
        JSON.stringify(legacyCapture),
      );
    expect(legacyCapture.selectionRejected).toBe(true);
    expect(legacyCapture.captureAttempted).toBe(true);
    expect(legacyCapture.granted).toBe(false);
    expect("error" in legacyCapture && legacyCapture.error).toBe(
      "NotAllowedError",
    );
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    expect(
      await app.evaluate(
        ({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().filter(
            (candidate) => candidate.getTitle() === "OpenAware capture worker",
          ).length,
      ),
    ).toBe(2);
    const framesBeforeBackground = await page.evaluate(async () =>
      (await window.openAware!.invoke({ type: "state.get" })).sources.map(
        (source) => source.lastFrameAt || 0,
      ),
    );
    await page.evaluate(() => window.openAware!.setBackgroundMode(true));
    await expect
      .poll(() => page.evaluate(() => window.openAware!.getDesktopState()))
      .toMatchObject({ backgroundMode: true, windowVisible: false });
    await expect
      .poll(() =>
        page.evaluate(async (previous) => {
          const state = await window.openAware!.invoke({ type: "state.get" });
          return state.sources.every(
            (source, index) =>
              source.status === "live" &&
              (source.lastFrameAt || 0) > previous[index]!,
          );
        }, framesBeforeBackground),
      )
      .toBe(true);
    await app.evaluate(
      ({ BrowserWindow }, id) => BrowserWindow.fromId(id)!.show(),
      dashboardWindowId,
    );
    await page.evaluate(() => window.openAware!.setBackgroundMode(false));
    await expect
      .poll(() => page.evaluate(() => window.openAware!.getDesktopState()))
      .toMatchObject({ backgroundMode: false, windowVisible: true });
    const modelState = await page.evaluate(() =>
      window.openAware!.invoke({ type: "state.get" }),
    );
    expect(modelState.binding.status).toBe("unconfigured");
    expect(modelState.observations).toEqual([]);
    expect(modelState.pendingPlan).toBeUndefined();

    await page.getByTestId("stop-all").click();
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => ({
          owners: BrowserWindow.getAllWindows().filter(
            (candidate) => candidate.getTitle() === "OpenAware capture worker",
          ).length,
          // Destruction closes the sole native stream's owning context. A
          // destroyed context cannot be queried for its JS track readyState.
          retired: (
            globalThis as unknown as {
              nativeCaptureOwners: {
                window: NativeWindow;
                contents: NativeContents;
              }[];
            }
          ).nativeCaptureOwners.map((owner) => ({
            window: owner.window.isDestroyed(),
            contents: owner.contents.isDestroyed(),
          })),
        })),
      )
      .toEqual({
        owners: 0,
        retired: [
          { window: true, contents: true },
          { window: true, contents: true },
        ],
      });
    await expect(page.getByTestId("source-tile").locator("canvas")).toHaveCount(
      0,
    );
    const stopped = await page.evaluate(() =>
      window.openAware!.invoke({ type: "state.get" }),
    );
    expect(stopped.sources.every((source) => source.status === "stopped")).toBe(
      true,
    );
    const stoppedFrames = stopped.sources.map((source) => source.lastFrameAt);
    const stoppedReceipts = await page.evaluate(
      () =>
        (
          window as unknown as {
            nativePreviewReceipts: Record<string, PreviewReceipt>;
          }
        ).nativePreviewReceipts,
    );

    // An actual user gesture keeps rejection attributable to source consent,
    // rather than getDisplayMedia's transient-activation prerequisite.
    await page.getByTestId("add-source").click();
    const unselected = await page.evaluate(async () => {
      let stream: MediaStream | undefined;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false,
        });
        return "unexpected grant";
      } catch (error) {
        return error instanceof DOMException ? error.name : String(error);
      } finally {
        stream?.getTracks().forEach((track) => track.stop());
      }
    });
    expect(unselected).toBe("NotAllowedError");
    const audio = await page.evaluate(async () => {
      let stream: MediaStream | undefined;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });
        return "unexpected grant";
      } catch (error) {
        return error instanceof DOMException ? error.name : String(error);
      } finally {
        stream?.getTracks().forEach((track) => track.stop());
        await window.openAware!.stopAll();
      }
    });
    // Electron reports the deliberately empty display-selector response as
    // AbortError; a permission-handler denial reports NotAllowedError.
    expect(["AbortError", "NotAllowedError"]).toContain(audio);
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();

    const pendingStop = await page.evaluate(async (sourceId) => {
      // Send a valid start and Stop in the same turn. Ownership must be
      // invalidated while main may still await authoritative service state;
      // no late helper or frame may appear after the acknowledgement.
      const starting = window.openAware!.startDesktopCapture(
        sourceId,
        crypto.randomUUID(),
      );
      const stopping = window.openAware!.stopAll();
      const [startResult, stopResult] = await Promise.allSettled([
        starting,
        stopping,
      ]);
      return {
        startStatus: startResult.status,
        stopStatus: stopResult.status,
        startError:
          startResult.status === "rejected" ? String(startResult.reason) : "",
      };
    }, sourceIds[0]!);
    expect(pendingStop.startStatus).toBe("rejected");
    expect(pendingStop.stopStatus).toBe("fulfilled");
    expect(pendingStop.startError).toContain("stopped");
    await expect
      .poll(() =>
        app.evaluate(
          ({ BrowserWindow }) =>
            BrowserWindow.getAllWindows().filter(
              (candidate) =>
                candidate.getTitle() === "OpenAware capture worker",
            ).length,
        ),
      )
      .toBe(0);
    await expect
      .poll(() =>
        page.evaluate(async () =>
          (await window.openAware!.invoke({ type: "state.get" })).sources.every(
            (source) => source.status === "stopped",
          ),
        ),
      )
      .toBe(true);
    await page.waitForTimeout(2100);
    expect(
      await page.evaluate(async () =>
        (await window.openAware!.invoke({ type: "state.get" })).sources.map(
          (source) => source.lastFrameAt,
        ),
      ),
    ).toEqual(stoppedFrames);
    expect(
      await page.evaluate(
        () =>
          (
            window as unknown as {
              nativePreviewReceipts: Record<string, PreviewReceipt>;
            }
          ).nativePreviewReceipts,
      ),
    ).toEqual(stoppedReceipts);
  } finally {
    await app.close();
  }
});
