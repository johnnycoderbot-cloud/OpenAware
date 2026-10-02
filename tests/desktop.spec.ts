import { _electron as electron, expect, test } from "@playwright/test";
import { createServer } from "node:http";
import { resolve } from "node:path";

test("desktop runs synthetic preview, scopes local vision, stops acquisition, and rejects raw privileges", async () => {
  const requests: Record<string, unknown>[] = [];
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
                key: "fixture-vision",
                display_name: "Fixture vision (mock)",
                capabilities: { vision: true },
                loaded_instances: [{ id: "fixture" }],
              },
            ],
          }),
        );
      } else if (req.url === "/api/v1/chat") {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        requests.push(parsed);
        res.end(
          JSON.stringify({
            model_instance_id: "fixture-vision",
            output: [
              {
                type: "message",
                content:
                  "A red square and a blue circle. The text reads OPENAWARE 42. Synthetic fixture, not actual model vision.",
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
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing fixture address");
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
    await expect(
      page.getByRole("heading", { name: "Live workspace", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => typeof window.openAware?.invoke))
      .toBe("function");
    const isolated = await page.evaluate(() => ({
      require: typeof (window as unknown as { require?: unknown }).require,
      process: typeof (window as unknown as { process?: unknown }).process,
    }));
    expect(isolated).toEqual({ require: "undefined", process: "undefined" });
    await page.getByTestId("add-source").click();
    await page.getByTestId("add-demo").click();
    await page
      .getByRole("button", { name: "Connect source", exact: true })
      .click();
    await expect(page.getByTestId("source-tile")).toHaveCount(1);
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            (await window.openAware!.invoke({ type: "state.get" })).sources[0]
              ?.status,
        ),
      )
      .toBe("live");
    await expect
      .poll(() =>
        page.evaluate(async () =>
          Boolean(
            (await window.openAware!.invoke({ type: "state.get" })).sources[0]
              ?.lastFrameAt,
          ),
        ),
      )
      .toBe(true);
    const source = await page.evaluate(
      async () =>
        (await window.openAware!.invoke({ type: "state.get" })).sources[0],
    );
    await page.evaluate(async (endpoint) => {
      await window.openAware!.invoke({
        type: "provider.discover",
        provider: "lmstudio",
        endpoint,
      });
      await window.openAware!.invoke({
        type: "provider.select",
        modelId: "fixture-vision",
      });
    }, `http://127.0.0.1:${address.port}`);
    await page.evaluate(async (id) => {
      const state = await window.openAware!.invoke({ type: "state.get" });
      const source = state.sources.find((s) => s.id === id)!;
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 360;
      const c = canvas.getContext("2d")!;
      c.fillStyle = "#fff";
      c.fillRect(0, 0, 640, 360);
      c.fillStyle = "red";
      c.fillRect(50, 50, 100, 100);
      c.fillStyle = "blue";
      c.beginPath();
      c.arc(300, 100, 50, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#000";
      c.font = "30px sans-serif";
      c.fillText("OPENAWARE 42", 30, 300);
      await window.openAware!.invoke({
        type: "provider.probe",
        frame: {
          id: crypto.randomUUID(),
          sourceId: source.id,
          sourceRevision: source.revision,
          capturedAt: Date.now(),
          width: 640,
          height: 360,
          dataUrl: canvas.toDataURL("image/jpeg"),
        },
      });
    }, source.id);
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            (await window.openAware!.invoke({ type: "state.get" })).binding
              .status,
        ),
      )
      .toBe("verified");
    await page.evaluate(async () => {
      await window.openAware!.invoke({ type: "monitor.start" });
    });
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            (await window.openAware!.invoke({ type: "state.get" })).observations
              .length,
        ),
      )
      .toBeGreaterThan(0);
    expect(requests.length).toBeGreaterThan(1);
    expect(
      requests.every(
        (request) => request.store === false && request.stream === false,
      ),
    ).toBe(true);
    expect(
      requests.some(
        (request) =>
          Array.isArray(request.input) &&
          request.input.some(
            (item: { type?: string }) => item.type === "image",
          ),
      ),
    ).toBe(true);
    const rejection = await page.evaluate(async () => {
      try {
        await window.openAware!.invoke({
          type: "shell.exec",
          command: "anything",
        } as never);
        return false;
      } catch {
        return true;
      }
    });
    expect(rejection).toBe(true);
    await page.screenshot({
      path: resolve("assets/prototype-desktop.png"),
      fullPage: true,
    });
    await page.getByTestId("stop-all").click();
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            (await window.openAware!.invoke({ type: "state.get" })).session,
        ),
      )
      .toBe("stopped");
    await page.waitForTimeout(300);
    const stopped = await page.evaluate(
      async () => await window.openAware!.invoke({ type: "state.get" }),
    );
    expect(stopped.sources.every((s) => s.status === "stopped")).toBe(true);
    const stopCount = requests.length;
    await page.waitForTimeout(2100);
    expect(requests.length).toBe(stopCount);
  } finally {
    await app.close();
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
  }
});
