import { _electron as electron, expect, test } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

test("real synthetic file, direct HTTP video and web player capture stay isolated and Stop revokes every owner", async () => {
  test.setTimeout(90_000);
  const directory = await mkdtemp(join(tmpdir(), "oa-video-fixture-"));
  const file = join(directory, "synthetic.webm");
  let movie = Buffer.alloc(0);
  let origin = "";
  let pageOrigin = "";
  const rangeReceipts: string[] = [];
  const server = createServer((request, response) => {
    if (request.url?.startsWith("/short")) {
      response.writeHead(302, {
        location: `${pageOrigin}/page?secret=fixture`,
      });
      response.end();
      return;
    }
    if (request.url?.startsWith("/page")) {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(
        '<!doctype html><html><body style="margin:0;background:#cc1818"><video id="fixture-video" controls muted loop style="width:100%;height:90vh" src="/movie?secret=fixture"></video></body></html>',
      );
      return;
    }
    if (!request.url?.startsWith("/movie")) {
      response.writeHead(404);
      response.end();
      return;
    }
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
    rangeReceipts.push(request.headers.range ?? "");
    const start = range ? Number(range[1]) : 0;
    const end = Math.min(
      movie.length - 1,
      range?.[2] ? Number(range[2]) : movie.length - 1,
    );
    if (start >= movie.length) {
      response.writeHead(416, { "content-range": `bytes */${movie.length}` });
      response.end();
      return;
    }
    response.writeHead(range ? 206 : 200, {
      "content-type": "video/webm",
      "content-length": String(end - start + 1),
      ...(range
        ? { "content-range": `bytes ${start}-${end}/${movie.length}` }
        : {}),
    });
    // Deliberately omit CORS. Only the trusted owner's media proxy can decode
    // and sample a direct URL; the dashboard cannot fetch this address.
    response.end(movie.subarray(start, end + 1));
  });
  const pageServer = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(
      `<!doctype html><html><body style="margin:0;background:#cc1818"><video id="fixture-video" controls muted loop style="width:100%;height:90vh" src="${origin}/movie?secret=fixture"></video></body></html>`,
    );
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  await new Promise<void>((ready) => pageServer.listen(0, "127.0.0.1", ready));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No fixture server");
  origin = `http://127.0.0.1:${address.port}`;
  const pageAddress = pageServer.address();
  if (!pageAddress || typeof pageAddress === "string")
    throw new Error("No web fixture server");
  pageOrigin = `http://127.0.0.1:${pageAddress.port}`;
  const env = Object.fromEntries(
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
  let dashboard: Awaited<ReturnType<typeof app.firstWindow>> | undefined;
  try {
    const page = (dashboard = await app.firstWindow());
    await app.evaluate(({ app }) => {
      const owners: Record<number, { events: unknown[] }> = {};
      (
        globalThis as unknown as { nativeVideoDiagnostics: typeof owners }
      ).nativeVideoDiagnostics = owners;
      app.on("browser-window-created", (_event, owner) => {
        if (owner.getTitle() !== "OpenAware video player") return;
        const id = owner.id;
        const events: unknown[] = [];
        owners[id] = { events };
        const record = (event: unknown): void => {
          events.push(event);
          if (events.length > 64) events.shift();
        };
        const nativeCapture = owner.webContents.capturePage.bind(
          owner.webContents,
        );
        owner.webContents.capturePage = async (rect, opts) => {
          const event = { type: "capture", at: Date.now(), done: 0, error: "" };
          record(event);
          try {
            return await nativeCapture(rect, opts);
          } catch (error) {
            event.error = String(error).slice(0, 300);
            throw error;
          } finally {
            event.done = Date.now();
          }
        };
        const nativeExecute = owner.webContents.executeJavaScript.bind(
          owner.webContents,
        );
        owner.webContents.executeJavaScript = async (code, gesture) => {
          const observed =
            code === "window.openAwareVideo.take()" ||
            code === "window.openAwareVideo.start()";
          try {
            const result = await nativeExecute(code, gesture);
            if (observed) {
              const raw = result as
                | {
                    ended?: boolean;
                    frame?: {
                      capturedAt?: number;
                      sequence?: number;
                      width?: number;
                      height?: number;
                      fps?: number;
                      dataUrl?: string;
                    };
                  }
                | undefined;
              record({
                type: code.endsWith("take()") ? "take" : "start",
                at: Date.now(),
                ended: raw?.ended,
                frame: raw?.frame && {
                  capturedAt: raw.frame.capturedAt,
                  sequence: raw.frame.sequence,
                  width: raw.frame.width,
                  height: raw.frame.height,
                  fps: raw.frame.fps,
                  bytes: raw.frame.dataUrl?.length,
                },
              });
              if (raw?.ended) {
                const state = await nativeExecute(
                  "JSON.stringify(window.videoFixtureEvents ?? [])",
                );
                record({ type: "media-events", at: Date.now(), state });
              }
            }
            return result;
          } catch (error) {
            if (observed)
              record({
                type: "execute-error",
                at: Date.now(),
                error: String(error).slice(0, 300),
              });
            throw error;
          }
        };
        owner.webContents.on("did-finish-load", () => {
          if (!owner.webContents.getURL().startsWith("openaware-video:"))
            return;
          void nativeExecute(
            "(() => { const video = document.querySelector('video'); window.videoFixtureEvents=[]; for(const type of ['ended','error']) video.addEventListener(type, () => window.videoFixtureEvents.push({type,at:Date.now(),time:video.currentTime,duration:video.duration,error:video.error?.code ?? 0}), true); })()",
          ).catch(() => {});
        });
        owner.webContents.on("render-process-gone", (_event, details) =>
          record({
            type: "render-gone",
            at: Date.now(),
            reason: details.reason,
            exitCode: details.exitCode,
          }),
        );
        owner.once("closed", () => record({ type: "closed", at: Date.now() }));
      });
    });
    await expect
      .poll(() => page.evaluate(() => typeof window.openAware?.invoke))
      .toBe("function");
    const bytes = await app.evaluate(async ({ BrowserWindow }) => {
      const recorder = new BrowserWindow({
        show: false,
        webPreferences: {
          partition: "video-generated-fixture",
          sandbox: true,
          nodeIntegration: false,
          contextIsolation: true,
          backgroundThrottling: false,
          offscreen: true,
        },
      });
      try {
        await recorder.loadURL(
          "data:text/html,<canvas id='fixture' width='640' height='360'></canvas>",
        );
        return (await recorder.webContents.executeJavaScript(`(async () => {
          const canvas = document.querySelector('#fixture'), context = canvas.getContext('2d');
          let n = 0;
          const paint = () => { context.fillStyle = '#cc1818'; context.fillRect(0,0,640,360); context.fillStyle='#1818cc'; context.fillRect(10+(n++%40)*5,10,80,80); };
          paint();
          const stream = canvas.captureStream(0), track = stream.getVideoTracks()[0];
          const timer = setInterval(() => { paint(); track.requestFrame(); }, 67);
          const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
          const chunks = []; recorder.ondataavailable = event => chunks.push(event.data);
          const done = new Promise(resolve => recorder.onstop = resolve);
          recorder.start(); track.requestFrame(); await new Promise(resolve => setTimeout(resolve, 8000)); recorder.stop(); await done;
          clearInterval(timer); stream.getTracks().forEach(track => track.stop());
          return [...new Uint8Array(await new Blob(chunks).arrayBuffer())];
        })()`)) as number[];
      } finally {
        recorder.destroy();
      }
    });
    movie = Buffer.from(bytes);
    expect(movie.length).toBeGreaterThan(1000);
    await writeFile(file, movie);
    await app.evaluate(({ dialog }, selectedFile) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [selectedFile],
      });
    }, file);
    await page.evaluate(() => {
      const receipts: Record<
        string,
        { count: number; sequence: number; times: number[] }
      > = {};
      (window as unknown as { videoReceipts: typeof receipts }).videoReceipts =
        receipts;
      window.openAware!.onDesktopFrame(
        (frame) =>
          (receipts[frame.sourceId] = {
            count: (receipts[frame.sourceId]?.count ?? 0) + 1,
            sequence: frame.sequence,
            times: [
              ...(receipts[frame.sourceId]?.times ?? []),
              frame.capturedAt,
            ].slice(-20),
          }),
      );
    });
    await page.getByTestId("add-source").click();
    let picker = page.getByRole("dialog", { name: "Add a source" });
    await picker
      .getByRole("button", { name: "Video file", exact: true })
      .click();
    await picker
      .getByRole("button", { name: "Choose video file", exact: true })
      .click();
    await picker
      .getByRole("button", { name: "Connect source", exact: true })
      .click();
    await expect(picker).not.toBeVisible();
    const fileId = await page.evaluate(
      async () =>
        (await window.openAware!.invoke({ type: "state.get" })).sources.find(
          (source) => source.kind === "video_file",
        )!.id,
    );
    const fileTile = page.locator(
      `[data-testid="source-tile"][data-source-id="${fileId}"]`,
    );
    await expect
      .poll(
        () =>
          page.evaluate(async (id) => {
            const source = (
              await window.openAware!.invoke({ type: "state.get" })
            ).sources.find((source) => source.id === id);
            const count =
              (
                window as unknown as {
                  videoReceipts: Record<string, { count: number }>;
                }
              ).videoReceipts[id]?.count ?? 0;
            return {
              status: source?.status,
              error: source?.error ?? "",
              hasFrames: count > 1,
            };
          }, fileId),
        { timeout: 20_000 },
      )
      .toEqual({ status: "live", error: "", hasFrames: true });
    // The fixture has a finite duration. Hold actual playback after decoded
    // deliveries so UI action latency cannot race natural end while inspecting
    // the owner. Resume below to test the real ended lifecycle.
    const native = await app.evaluate(async ({ BrowserWindow }) => {
      const owner = BrowserWindow.getAllWindows().find((window) =>
        window.webContents.getURL().startsWith("openaware-video:"),
      );
      if (!owner) throw new Error("The decoded file player is unavailable");
      return {
        id: owner.id,
        hidden: !owner.isVisible(),
        player: await owner.webContents.executeJavaScript(
          "(() => { const video = document.querySelector('video'); video.pause(); return {node:typeof require,bridge:typeof window.openAware,muted:video.muted,decoded:video.videoWidth,paused:video.paused}; })()",
        ),
      };
    });
    expect(native).toMatchObject({
      hidden: true,
      player: {
        node: "undefined",
        bridge: "undefined",
        muted: true,
        decoded: 640,
        paused: true,
      },
    });
    await expect
      .poll(() =>
        fileTile.locator("canvas").evaluate((canvas) => {
          const preview = canvas as HTMLCanvasElement;
          const pixel = preview
            .getContext("2d")!
            .getImageData(
              Math.floor(preview.width / 2),
              Math.floor(preview.height / 2),
              1,
              1,
            ).data;
          return pixel[0]! - pixel[2]!;
        }),
      )
      .toBeGreaterThan(80);
    await fileTile
      .getByRole("button", { name: "Open player", exact: true })
      .click();
    await expect
      .poll(() =>
        app.evaluate(
          ({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.isVisible(),
          native.id,
        ),
      )
      .toBe(true);
    const duplicateAdmission = await page.evaluate(async (id) => {
      const bridge = window.openAware!;
      const existing = (
        await bridge.invoke({ type: "state.get" })
      ).sources.find((source) => source.id === id)!;
      const prepared = (await bridge.chooseVideoFile())!;
      let newRefFailed = false,
        sameRefFailed = false,
        newRefRevoked = false;
      try {
        await bridge.invoke({
          type: "source.add",
          source: { id, ...prepared },
        });
      } catch (error) {
        newRefFailed = String(error).includes("Source already exists");
      }
      try {
        await bridge.invoke({
          type: "source.add",
          source: {
            id,
            name: existing.name,
            kind: existing.kind,
            deviceId: existing.deviceId,
          },
        });
      } catch (error) {
        sameRefFailed = String(error).includes("Source already exists");
      }
      try {
        await bridge.invoke({
          type: "source.add",
          source: { id: crypto.randomUUID(), ...prepared },
        });
      } catch (error) {
        newRefRevoked = String(error).includes("Choose the video source again");
      }
      return { newRefFailed, sameRefFailed, newRefRevoked };
    }, fileId);
    expect(duplicateAdmission).toEqual({
      newRefFailed: true,
      sameRefFailed: true,
      newRefRevoked: true,
    });
    await app.evaluate(async ({ BrowserWindow }, id) => {
      const owner = BrowserWindow.fromId(id);
      if (!owner) throw new Error("The paused file player is unavailable");
      await owner.webContents.executeJavaScript(
        "document.querySelector('video').play()",
      );
    }, native.id);
    await expect
      .poll(
        () =>
          page.evaluate(
            async (id) =>
              (
                await window.openAware!.invoke({ type: "state.get" })
              ).sources.find((source) => source.id === id)?.status,
            fileId,
          ),
        { timeout: 15_000 },
      )
      .toBe("unavailable");
    const beforeReconnect = await page.evaluate(
      (id) =>
        (
          window as unknown as {
            videoReceipts: Record<string, { count: number }>;
          }
        ).videoReceipts[id]?.count ?? 0,
      fileId,
    );
    await fileTile
      .getByRole("button", { name: "Connect", exact: true })
      .click();
    await expect
      .poll(
        () =>
          page.evaluate(
            async ({ id, count }) => {
              const state = await window.openAware!.invoke({
                type: "state.get",
              });
              const receipts =
                (
                  window as unknown as {
                    videoReceipts: Record<string, { count: number }>;
                  }
                ).videoReceipts[id]?.count ?? 0;
              const source = state.sources.find((source) => source.id === id);
              return {
                status: source?.status,
                error: source?.error ?? "",
                freshFrames: receipts > count + 1,
              };
            },
            { id: fileId, count: beforeReconnect },
          ),
        { timeout: 20_000 },
      )
      .toEqual({ status: "live", error: "", freshFrames: true });
    const reconnectedFileOwnerId = await app.evaluate(
      async ({ BrowserWindow }) => {
        const owner = BrowserWindow.getAllWindows().find((window) =>
          window.webContents.getURL().startsWith("openaware-video:"),
        );
        if (!owner)
          throw new Error("The reconnected file player is unavailable");
        await owner.webContents.executeJavaScript(
          "document.querySelector('video').pause()",
        );
        const events = ((
          globalThis as unknown as { heldVideoEvents?: unknown[] }
        ).heldVideoEvents ??= []);
        const capturePage = owner.webContents.capturePage.bind(
          owner.webContents,
        );
        const ownerId = owner.id;
        (
          globalThis as unknown as { heldFilePausedAt?: number }
        ).heldFilePausedAt = Date.now();
        let slowWake = true;
        owner.webContents.capturePage = async (rect, opts) => {
          const event = {
            id: ownerId,
            at: Date.now(),
            completedAt: 0,
            error: "",
          };
          events.push(event);
          if (events.length > 40) events.shift();
          try {
            const image = await capturePage(rect, opts);
            if (slowWake) {
              slowWake = false;
              (
                globalThis as unknown as { slowVideoWake?: typeof event }
              ).slowVideoWake = event;
              await new Promise((resolve) => setTimeout(resolve, 6000));
            }
            return image;
          } catch (error) {
            event.error = String(error);
            throw error;
          } finally {
            event.completedAt = Date.now();
          }
        };
        owner.once("closed", () =>
          events.push({ id: ownerId, closedAt: Date.now() }),
        );
        return ownerId;
      },
    );
    await expect
      .poll(
        () =>
          app.evaluate(
            () =>
              (
                globalThis as unknown as {
                  slowVideoWake?: { completedAt: number };
                }
              ).slowVideoWake?.completedAt ?? 0,
          ),
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0);
    expect(
      await app.evaluate(
        ({ BrowserWindow }, id) => Boolean(BrowserWindow.fromId(id)),
        reconnectedFileOwnerId,
      ),
    ).toBe(true);
    await page.getByTestId("add-source").click();
    picker = page.getByRole("dialog", { name: "Add a source" });
    await picker
      .getByRole("button", { name: "Video link", exact: true })
      .click();
    await picker
      .getByLabel("Video link", { exact: true })
      .fill(`${origin}/movie?secret=fixture`);
    await picker.getByLabel("Video link type").selectOption("direct");
    await picker
      .getByRole("button", { name: "Connect source", exact: true })
      .click();
    await expect(picker).not.toBeVisible();
    const directId = await page.evaluate(
      async () =>
        (await window.openAware!.invoke({ type: "state.get" })).sources.find(
          (source) => source.kind === "video_url",
        )!.id,
    );
    await expect
      .poll(
        () =>
          page.evaluate(
            (id) =>
              (
                window as unknown as {
                  videoReceipts: Record<string, { count: number }>;
                }
              ).videoReceipts[id]?.count ?? 0,
            directId,
          ),
        { timeout: 20_000 },
      )
      .toBeGreaterThan(1);
    const directOwnerId = await app.evaluate(
      async ({ BrowserWindow }, fileOwnerId) => {
        const owner = BrowserWindow.getAllWindows().find(
          (window) =>
            window.id !== fileOwnerId &&
            window.webContents.getURL().startsWith("openaware-video:"),
        );
        if (!owner) throw new Error("The direct video player is unavailable");
        await owner.webContents.executeJavaScript(
          "document.querySelector('video').pause()",
        );
        const events = ((
          globalThis as unknown as { heldVideoEvents?: unknown[] }
        ).heldVideoEvents ??= []);
        const capturePage = owner.webContents.capturePage.bind(
          owner.webContents,
        );
        const ownerId = owner.id;
        owner.webContents.capturePage = async (rect, opts) => {
          const event = {
            id: ownerId,
            at: Date.now(),
            completedAt: 0,
            error: "",
          };
          events.push(event);
          if (events.length > 40) events.shift();
          try {
            return await capturePage(rect, opts);
          } catch (error) {
            event.error = String(error);
            throw error;
          } finally {
            event.completedAt = Date.now();
          }
        };
        owner.once("closed", () =>
          events.push({ id: ownerId, closedAt: Date.now() }),
        );
        return ownerId;
      },
      reconnectedFileOwnerId,
    );
    expect(rangeReceipts.some((range) => /^bytes=0-\d+$/.test(range))).toBe(
      true,
    );
    await page.getByTestId("add-source").click();
    picker = page.getByRole("dialog", { name: "Add a source" });
    await picker
      .getByRole("button", { name: "Video link", exact: true })
      .click();
    await picker
      .getByLabel("Video link", { exact: true })
      .fill(`${origin}/short?secret=fixture`);
    await picker
      .getByRole("button", { name: "Connect source", exact: true })
      .click();
    await expect(picker).not.toBeVisible();
    const webId = await page.evaluate(
      async () =>
        (await window.openAware!.invoke({ type: "state.get" })).sources.find(
          (source) => source.kind === "web_video",
        )!.id,
    );
    await expect
      .poll(() =>
        page.evaluate(
          (id) =>
            (
              window as unknown as {
                videoReceipts: Record<string, { count: number }>;
              }
            ).videoReceipts[id]?.count ?? 0,
          webId,
        ),
      )
      .toBeGreaterThan(1);
    const playerPage = await app
      .waitForEvent("window", {
        predicate: (candidate) => candidate.url().startsWith(pageOrigin),
        timeout: 1000,
      })
      .catch(() => undefined);
    const player =
      playerPage ??
      (await app.windows()).find((candidate) =>
        candidate.url().startsWith(pageOrigin),
      )!;
    expect(
      await player.evaluate(() => ({
        node: typeof (window as unknown as { require?: unknown }).require,
        bridge: typeof window.openAware,
      })),
    ).toEqual({ node: "undefined", bridge: "undefined" });
    await player.locator("#fixture-video").click();
    await app.evaluate(({ BrowserWindow }, origin) => {
      const owner = BrowserWindow.getAllWindows().find((window) =>
        window.webContents.getURL().startsWith(origin),
      )!;
      const nativeCapture = owner.webContents.capturePage.bind(
        owner.webContents,
      );
      let first = true;
      (
        globalThis as unknown as { delayedVideoCaptureAt: number }
      ).delayedVideoCaptureAt = 0;
      owner.webContents.capturePage = async (rect, opts) => {
        if (!first) return nativeCapture(rect, opts);
        first = false;
        (
          globalThis as unknown as { delayedVideoCaptureAt: number }
        ).delayedVideoCaptureAt = Date.now();
        const image = await nativeCapture(rect, opts);
        await new Promise((resolve) => setTimeout(resolve, 400));
        return image;
      };
    }, pageOrigin);
    await expect
      .poll(() =>
        app.evaluate(
          () =>
            (globalThis as unknown as { delayedVideoCaptureAt: number })
              .delayedVideoCaptureAt,
        ),
      )
      .toBeGreaterThan(0);
    const acquisitionStart = await app.evaluate(
      () =>
        (globalThis as unknown as { delayedVideoCaptureAt: number })
          .delayedVideoCaptureAt,
    );
    await expect
      .poll(() =>
        page.evaluate(
          ({ id, start }) => {
            const times =
              (
                window as unknown as {
                  videoReceipts: Record<string, { times: number[] }>;
                }
              ).videoReceipts[id]?.times ?? [];
            return times.some(
              (time) =>
                time >= start - 50 &&
                time <= start + 50 &&
                Date.now() - time >= 350,
            );
          },
          { id: webId, start: acquisitionStart },
        ),
      )
      .toBe(true);
    await player.evaluate((address) => {
      const link = document.createElement("a");
      const target = new URL(address);
      target.username = "forbidden";
      target.password = "credentials";
      link.href = target.href;
      document.body.append(link);
      link.click();
    }, `${origin}/page`);
    expect(player.url()).toContain(`${pageOrigin}/page`);
    const snapshot = await page.evaluate(() =>
      window.openAware!.invoke({ type: "state.get" }),
    );
    expect(JSON.stringify(snapshot)).not.toContain("secret=fixture");
    expect(JSON.stringify(snapshot)).not.toContain(directory);
    const heldOwners = await app.evaluate(
      async ({ BrowserWindow }, ids) => ({
        expectedIds: ids,
        windows: await Promise.all(
          BrowserWindow.getAllWindows().map(async (window) => ({
            id: window.id,
            kind: window.webContents.getURL().split(":")[0],
            visible: window.isVisible(),
            player: window.webContents.getURL().startsWith("openaware-video:")
              ? await window.webContents.executeJavaScript(
                  "(() => { const video=document.querySelector('video'); return {paused:video.paused,ended:video.ended,time:video.currentTime,duration:video.duration,ready:video.readyState}; })()",
                )
              : undefined,
          })),
        ),
        events: (globalThis as unknown as { heldVideoEvents?: unknown[] })
          .heldVideoEvents,
        slowWake: (globalThis as unknown as { slowVideoWake?: unknown })
          .slowVideoWake,
      }),
      [reconnectedFileOwnerId, directOwnerId],
    );
    const heldDiagnostic = JSON.stringify({
      ...heldOwners,
      sources: snapshot.sources.map(({ id, kind, status, error }) => ({
        id,
        kind,
        status,
        error,
      })),
    });
    await writeFile(
      test.info().outputPath("held-video-owners.json"),
      heldDiagnostic,
    );
    await test.info().attach("held-video-owners", {
      body: heldDiagnostic,
      contentType: "application/json",
    });
    const pausedAt = await app.evaluate(
      () =>
        (globalThis as unknown as { heldFilePausedAt: number })
          .heldFilePausedAt,
    );
    const pausedTimes = await page.evaluate(
      (id) =>
        (
          window as unknown as {
            videoReceipts: Record<string, { times: number[] }>;
          }
        ).videoReceipts[id]?.times ?? [],
      fileId,
    );
    expect(pausedTimes.length).toBeGreaterThan(0);
    expect(Math.max(...pausedTimes)).toBeLessThanOrEqual(pausedAt + 1000);
    // Both finite sources remain connected until Stop, rather than merely
    // checking cleanup after they have already ended on their own.
    expect(
      await app.evaluate(
        ({ BrowserWindow }, ids) =>
          ids.every((id) => Boolean(BrowserWindow.fromId(id))),
        [reconnectedFileOwnerId, directOwnerId],
      ),
    ).toBe(true);
    // Keep an actual discarded native image pending across Stop and reconnect.
    // Its late completion must neither emit evidence nor restart the old loop.
    await app.evaluate(({ BrowserWindow }, id) => {
      const owner = BrowserWindow.fromId(id);
      if (!owner) throw new Error("The held file player is unavailable");
      const capturePage = owner.webContents.capturePage.bind(owner.webContents);
      const pending: {
        calls: number;
        startedAt: number;
        release?: () => void;
      } = { calls: 0, startedAt: 0 };
      (
        globalThis as unknown as { stoppedVideoWake: typeof pending }
      ).stoppedVideoWake = pending;
      owner.webContents.capturePage = async (rect, opts) => {
        pending.calls++;
        const image = await capturePage(rect, opts);
        pending.startedAt = Date.now();
        return new Promise((resolve) => {
          pending.release = () => resolve(image);
        });
      };
    }, reconnectedFileOwnerId);
    await expect
      .poll(() =>
        app.evaluate(
          () =>
            (
              globalThis as unknown as {
                stoppedVideoWake: { startedAt: number };
              }
            ).stoppedVideoWake.startedAt,
        ),
      )
      .toBeGreaterThan(0);
    await page.evaluate(() => window.openAware!.stopAll());
    await expect
      .poll(() =>
        app.evaluate(
          ({ BrowserWindow }) =>
            BrowserWindow.getAllWindows().filter(
              (window) => window.getTitle() === "OpenAware video player",
            ).length,
        ),
      )
      .toBe(0);
    const stoppedReceipts = await page.evaluate(() =>
      JSON.stringify(
        (window as unknown as { videoReceipts: unknown }).videoReceipts,
      ),
    );
    await page.waitForTimeout(400);
    expect(
      await page.evaluate(() =>
        JSON.stringify(
          (window as unknown as { videoReceipts: unknown }).videoReceipts,
        ),
      ),
    ).toBe(stoppedReceipts);
    expect(
      (
        await page.evaluate(() =>
          window.openAware!.invoke({ type: "state.get" }),
        )
      ).sources.every((source) => source.status === "stopped"),
    ).toBe(true);
    const beforeStoppedReconnect = await page.evaluate(
      (id) =>
        (
          window as unknown as {
            videoReceipts: Record<string, { count: number }>;
          }
        ).videoReceipts[id]?.count ?? 0,
      fileId,
    );
    await fileTile
      .getByRole("button", { name: "Connect", exact: true })
      .click();
    await expect
      .poll(
        () =>
          page.evaluate(
            async ({ id, count }) => {
              const source = (
                await window.openAware!.invoke({ type: "state.get" })
              ).sources.find((source) => source.id === id);
              const received =
                (
                  window as unknown as {
                    videoReceipts: Record<string, { count: number }>;
                  }
                ).videoReceipts[id]?.count ?? 0;
              return {
                status: source?.status,
                error: source?.error ?? "",
                freshFrames: received > count + 1,
              };
            },
            { id: fileId, count: beforeStoppedReconnect },
          ),
        { timeout: 20_000 },
      )
      .toEqual({ status: "live", error: "", freshFrames: true });
    const freshOwner = await app.evaluate(async ({ BrowserWindow }, oldId) => {
      const owner = BrowserWindow.getAllWindows().find(
        (window) =>
          window.id !== oldId &&
          window.webContents.getURL().startsWith("openaware-video:"),
      );
      if (!owner) throw new Error("The freshly decoded replay is unavailable");
      return {
        id: owner.id,
        player: await owner.webContents.executeJavaScript(
          "(() => { const video=document.querySelector('video'); const before={paused:video.paused,ended:video.ended,time:video.currentTime,duration:video.duration,error:video.error?.code ?? 0}; video.pause(); return {...before,held:video.paused}; })()",
        ),
      };
    }, reconnectedFileOwnerId);
    expect(freshOwner.player).toMatchObject({
      ended: false,
      error: 0,
      held: true,
    });
    await app.evaluate(() => {
      const pending = (
        globalThis as unknown as { stoppedVideoWake: { release?: () => void } }
      ).stoppedVideoWake;
      pending.release?.();
      pending.release = undefined;
    });
    await page.waitForTimeout(400);
    expect(
      await app.evaluate(
        () =>
          (globalThis as unknown as { stoppedVideoWake: { calls: number } })
            .stoppedVideoWake.calls,
      ),
    ).toBe(1);
    const releasedSource = (
      await page.evaluate(() => window.openAware!.invoke({ type: "state.get" }))
    ).sources.find((source) => source.id === fileId);
    const releasedOwner = await app.evaluate(async ({ BrowserWindow }, id) => {
      const owner = BrowserWindow.fromId(id);
      return {
        exists: Boolean(owner),
        player: owner
          ? await owner.webContents.executeJavaScript(
              "(() => { const video=document.querySelector('video'); return {paused:video.paused,ended:video.ended,time:video.currentTime,duration:video.duration,error:video.error?.code ?? 0}; })()",
            )
          : undefined,
      };
    }, freshOwner.id);
    await test.info().attach("fresh-player-after-late-wake", {
      body: JSON.stringify({
        before: freshOwner,
        after: releasedOwner,
        source: {
          status: releasedSource?.status,
          error: releasedSource?.error,
        },
      }),
      contentType: "application/json",
    });
    expect({
      status: releasedSource?.status,
      error: releasedSource?.error ?? "",
      ownerExists: releasedOwner.exists,
    }).toEqual({ status: "live", error: "", ownerExists: true });
    expect(releasedOwner.player).toMatchObject({
      paused: true,
      ended: false,
      error: 0,
    });
    await page.evaluate(() => window.openAware!.stopAll());
    await expect
      .poll(() =>
        app.evaluate(
          ({ BrowserWindow }) =>
            BrowserWindow.getAllWindows().filter(
              (window) => window.getTitle() === "OpenAware video player",
            ).length,
        ),
      )
      .toBe(0);
  } finally {
    const diagnostics = await app
      .evaluate(
        () =>
          (globalThis as unknown as { nativeVideoDiagnostics?: unknown })
            .nativeVideoDiagnostics,
      )
      .catch(() => undefined);
    const diagnosticSources = await dashboard
      ?.evaluate(async () =>
        (await window.openAware!.invoke({ type: "state.get" })).sources.map(
          ({ id, kind, status, error }) => ({ id, kind, status, error }),
        ),
      )
      .catch(() => undefined);
    await writeFile(
      test.info().outputPath("native-video-diagnostics.json"),
      JSON.stringify({ diagnostics, sources: diagnosticSources }),
    );
    await app.close();
    await new Promise<void>((ready) => server.close(() => ready()));
    await new Promise<void>((ready) => pageServer.close(() => ready()));
    const fixtureTarget = resolve(directory);
    const fixtureRelative = relative(resolve(tmpdir()), fixtureTarget);
    if (
      !fixtureRelative ||
      fixtureRelative.startsWith("..") ||
      isAbsolute(fixtureRelative) ||
      !basename(fixtureTarget).startsWith("oa-video-fixture-")
    )
      throw new Error(
        "Refusing fixture cleanup outside the generated temp directory",
      );
    await rm(fixtureTarget, { recursive: true, force: true });
  }
});
