import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
} from "@playwright/test";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";

const environment = (): Record<string, string> => {
  const env = Object.fromEntries(
    Object.entries(process.env).flatMap(([key, value]) =>
      value === undefined ? [] : [[key, value]],
    ),
  );
  env.OPENAWARE_TEST = "1";
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
};
async function bounded<T>(work: Promise<T>, timeout: number, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function closeServer(server: Server) {
  if (!server.listening) return;
  const closed = new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  );
  server.closeAllConnections();
  await bounded(closed, 3000, "Fixture HTTP server did not close");
}
async function closeElectron(app?: ElectronApplication) {
  if (!app) return;
  const child = app.process();
  try {
    await bounded(app.close(), 5000, "Fixture Electron did not close");
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) {
      let onExit: () => void;
      const exited = new Promise<void>((done) => {
        onExit = done;
        child.once("exit", onExit);
      });
      try {
        child.kill("SIGKILL");
        await bounded(exited, 2000, "Fixture Electron process did not exit");
      } finally {
        child.off("exit", onExit!);
      }
    }
    throw error;
  }
}

test("motion-only watching is explicit and Stop all remains keyboard accessible", async () => {
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({
      executablePath: process.env.OPENAWARE_EXECUTABLE,
      args: [
        ...(process.env.OPENAWARE_EXECUTABLE ? [] : ["."]),
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-background-timer-throttling",
      ],
      cwd: resolve("."),
      env: environment(),
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(10_000);
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      window.webContents.setBackgroundThrottling(false);
      window.showInactive();
    });
    await page.getByTestId("add-source").click();
    await page
      .getByRole("button", { name: "Connect source", exact: true })
      .click();
    const tile = page.getByTestId("source-tile");
    await expect(tile).toHaveCount(1);
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            (await window.openAware!.invoke({ type: "state.get" })).sources[0]
              ?.status,
        ),
      )
      .toBe("live");
    await expect(
      page.getByRole("button", { name: "Start watching", exact: true }),
    ).toBeDisabled();
    // Effective permissions are authoritative service state, so wait for the IPC acknowledgement.
    const sourceName = await page.evaluate(
      async () =>
        (await window.openAware!.invoke({ type: "state.get" })).sources[0]!
          .name,
    );
    const settings = tile.getByRole("button", {
      name: `Settings for ${sourceName}`,
      exact: true,
    });
    await expect(
      tile.getByRole("checkbox", { name: "AI analysis", exact: true }),
    ).not.toBeVisible();
    await settings.click();
    await expect(settings).toHaveAttribute("aria-expanded", "true");
    await tile.getByRole("checkbox", { name: "AI analysis" }).click();
    await expect(
      tile.getByRole("checkbox", { name: "AI analysis" }),
    ).not.toBeChecked();
    await tile.getByRole("checkbox", { name: "Motion alerts" }).click();
    await expect(
      tile.getByRole("checkbox", { name: "Motion alerts" }),
    ).toBeChecked();
    await settings.click();
    await expect(settings).toHaveAttribute("aria-expanded", "false");
    await page
      .getByRole("button", { name: "Start watching", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            (await window.openAware!.invoke({ type: "state.get" })).session,
        ),
      )
      .toBe("monitoring");
    expect(
      await page.evaluate(
        async () =>
          (await window.openAware!.invoke({ type: "state.get" })).binding
            .status,
      ),
    ).toBe("unconfigured");
    await page.getByTestId("stop-all").focus();
    await page.keyboard.press("Enter");
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            (await window.openAware!.invoke({ type: "state.get" })).session,
        ),
      )
      .toBe("stopped");
    await expect(tile.locator("canvas")).toHaveCount(0);
  } finally {
    await closeElectron(app);
  }
});

test("local connection, masked chat, caption memory and rule controls preserve explicit scope", async () => {
  test.setTimeout(90_000);
  const requests: Array<{
    input: Array<{ type: string; content?: string; data_url?: string }>;
    store?: boolean;
  }> = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/api/v1/models")
        res.end(
          JSON.stringify({
            models: [
              {
                type: "llm",
                key: "ui-fixture",
                display_name: "UI vision fixture",
                capabilities: { vision: true },
                loaded_instances: [{}],
              },
            ],
          }),
        );
      else if (req.url === "/api/v1/chat") {
        const request = JSON.parse(body) as (typeof requests)[number];
        requests.push(request);
        const prompt = request.input
          .map((item) => item.content || "")
          .join("\n");
        const definitions = /Rules are observational only: (\[[^\n]*\])/.exec(
          prompt,
        );
        const content = definitions
          ? JSON.stringify({
              summary: "Synthetic semantic fixture caption",
              rules: (
                JSON.parse(definitions[1]!) as Array<{
                  ruleId: string;
                  ruleRevision: number;
                }>
              ).map((rule) => ({
                ruleId: rule.ruleId,
                ruleRevision: rule.ruleRevision,
                verdict: "match",
                evidence:
                  "Synthetic fixture condition, not a real model finding",
              })),
            })
          : "Red square, blue circle, OPENAWARE 42. This is a deterministic test fixture, not a real model response.";
        res.end(
          JSON.stringify({
            output: [
              {
                type: "message",
                content,
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
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing test server address");
    app = await electron.launch({
      executablePath: process.env.OPENAWARE_EXECUTABLE,
      args: [
        ...(process.env.OPENAWARE_EXECUTABLE ? [] : ["."]),
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-background-timer-throttling",
      ],
      cwd: resolve("."),
      env: environment(),
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(10_000);
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      window.webContents.setBackgroundThrottling(false);
      window.showInactive();
    });
    for (const name of ["Alpha demo", "Beta demo"]) {
      await page.getByTestId("add-source").click();
      await page.getByLabel("Source name", { exact: true }).fill(name);
      await page
        .getByRole("button", { name: "Connect source", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name, exact: true }),
      ).toBeVisible();
    }
    const alphaId = await page.evaluate(
      async () =>
        (await window.openAware!.invoke({ type: "state.get" })).sources.find(
          (source) => source.name === "Alpha demo",
        )!.id,
    );
    const alpha = page.locator(
      `[data-testid="source-tile"][data-source-id="${alphaId}"]`,
    );
    await alpha
      .getByRole("button", { name: "Settings for Alpha demo", exact: true })
      .click();
    await alpha
      .getByRole("button", { name: "Privacy masks for Alpha demo" })
      .click();
    await page.getByRole("button", { name: "Add mask", exact: true }).click();
    const inputs = page.getByRole("spinbutton");
    await inputs.nth(0).fill("0");
    await inputs.nth(1).fill("0");
    await inputs.nth(2).fill("100");
    await inputs.nth(3).fill("100");
    await page
      .getByRole("button", { name: "Save reviewed masks", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByTestId("connections").click();
    await page
      .getByLabel("Server endpoint", { exact: true })
      .fill(`http://127.0.0.1:${address.port}`);
    await page
      .getByRole("button", { name: "Discover models", exact: true })
      .click();
    await page.getByRole("button", { name: /UI vision fixture/ }).click();
    await page
      .getByRole("button", { name: "View test image", exact: true })
      .click();
    await expect(
      page.getByAltText(/Synthetic vision test showing/),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Run vision test", exact: true })
      .click();
    await expect(
      page.getByText(
        "Image response verified. Return to Overview and explicitly start watching.",
      ),
    ).toBeVisible();
    expect(requests).toHaveLength(1);
    expect(requests[0].store).toBe(false);
    expect(
      requests[0].input.filter((item) => item.type === "image"),
    ).toHaveLength(1);
    const questionCaptureAfter = await page.evaluate(() => Date.now());
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    // No automatic monitor start is needed for an explicit, scoped question.
    const questionSources = page.getByRole("button", {
      name: "Choose question sources",
      exact: true,
    });
    await questionSources.click();
    await expect(
      page.getByRole("checkbox", { name: "Alpha demo", exact: true }),
    ).toBeChecked();
    await page
      .getByRole("checkbox", { name: "Beta demo", exact: true })
      .uncheck();
    await expect(
      page.getByRole("checkbox", { name: "Beta demo", exact: true }),
    ).not.toBeChecked();
    await questionSources.click();
    await page
      .getByRole("textbox", { name: "Ask about your workspace" })
      .fill("Describe the MASKED_SOURCE_ONLY_TEST image");
    await expect
      .poll(() =>
        page.evaluate(async (after) => {
          const state = await window.openAware!.invoke({ type: "state.get" });
          const alpha = state.sources.find((s) => s.name === "Alpha demo");
          return (
            alpha?.analysisEnabled &&
            alpha.status === "live" &&
            alpha.lastFrameAt !== undefined &&
            alpha.lastFrameAt > after &&
            Date.now() - alpha.lastFrameAt < 3000
          );
        }, questionCaptureAfter),
      )
      .toBe(true);
    await page
      .getByRole("button", { name: "Send question", exact: true })
      .click();
    await expect(
      page
        .getByRole("region", { name: "Ask your workspace" })
        .getByText(
          "Red square, blue circle, OPENAWARE 42. This is a deterministic test fixture, not a real model response.",
          { exact: true },
        ),
    ).toBeVisible();
    const chat = requests.find((request) =>
      request.input.some((item) =>
        item.content?.includes("MASKED_SOURCE_ONLY_TEST"),
      ),
    );
    expect(chat).toBeDefined();
    const images = chat!.input.filter((item) => item.type === "image");
    expect(images).toHaveLength(1);
    const maxPixel = await page.evaluate(async (dataUrl) => {
      const image = new Image();
      image.src = dataUrl!;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const c = canvas.getContext("2d")!;
      c.drawImage(image, 0, 0);
      const pixels = c.getImageData(0, 0, canvas.width, canvas.height).data;
      let max = 0;
      for (let i = 0; i < pixels.length; i++)
        if (i % 4 !== 3) max = Math.max(max, pixels[i]);
      return max;
    }, images[0].data_url);
    expect(maxPixel).toBeLessThanOrEqual(2);

    const memory = page.getByRole("region", {
      name: "Video memory",
      exact: true,
    });
    await expect(memory.locator(".memory-caption-row")).toHaveCount(1);
    await memory
      .getByRole("combobox", { name: "Memory source" })
      .selectOption({ label: "Beta demo" });
    await expect(
      memory.getByText("No captions in this scope", { exact: true }),
    ).toBeVisible();
    await memory
      .getByRole("combobox", { name: "Memory source" })
      .selectOption(alphaId);
    const requestsBeforeSearch = requests.length;
    await memory
      .getByRole("searchbox", { name: "Search captions", exact: true })
      .fill("unmatched synthetic caption needle");
    await memory
      .getByRole("button", { name: "Search captions", exact: true })
      .click();
    await expect(memory.locator(".memory-caption-row")).toHaveCount(0);
    await expect(
      memory.getByText("No captions in this scope", { exact: true }),
    ).toBeVisible();
    await memory
      .getByRole("searchbox", { name: "Search captions", exact: true })
      .fill("Red square");
    await memory
      .getByRole("button", { name: "Search captions", exact: true })
      .click();
    await expect(memory.locator(".memory-caption-row")).toHaveCount(1);
    await expect(memory.locator(".memory-caption-row")).toContainText(
      "Alpha demo",
    );
    expect(requests).toHaveLength(requestsBeforeSearch);
    await memory
      .getByRole("combobox", { name: "Memory time range" })
      .selectOption("custom");
    const future = await page.evaluate(() =>
      new Date(Date.now() + 60_000 - new Date().getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 19),
    );
    await memory.getByLabel("Memory from", { exact: true }).fill(future);
    await expect(
      memory.getByText("No captions in this scope", { exact: true }),
    ).toBeVisible();
    await memory
      .getByRole("combobox", { name: "Memory time range" })
      .selectOption("session");
    await memory
      .getByRole("button", { name: "Summarize history", exact: true })
      .click();
    const historical = memory.getByRole("region", {
      name: "Historical summary",
      exact: true,
    });
    await expect(historical).toContainText("completed");
    await expect(historical).toContainText("Alpha demo");
    const summaryRequest = requests.at(-1)!;
    expect(
      summaryRequest.input.filter((item) => item.type === "image"),
    ).toHaveLength(0);
    expect(summaryRequest.store).toBe(false);
    expect(
      await page.evaluate(
        async () =>
          (await window.openAware!.invoke({ type: "state.get" })).session,
      ),
    ).toBe("paused");

    await page.getByTestId("connections").click();
    const pipeline = page.getByRole("region", {
      name: "Monitoring pipeline",
      exact: true,
    });
    const temporal = pipeline.getByRole("checkbox", {
      name: "Temporal monitoring",
      exact: true,
    });
    await expect(temporal).toBeChecked();
    await temporal.click();
    await expect(temporal).not.toBeChecked();
    await temporal.click();
    await expect(temporal).toBeChecked();
    await pipeline
      .getByRole("textbox", { name: "Rule name", exact: true })
      .fill("Synthetic square");
    await pipeline
      .getByRole("textbox", { name: "Rule condition", exact: true })
      .fill("A red square is visible.");
    const ruleSources = pipeline.getByRole("group", {
      name: "Rule sources",
      exact: true,
    });
    await ruleSources
      .getByRole("checkbox", { name: "Alpha demo", exact: true })
      .check();
    await expect(
      ruleSources.getByRole("checkbox", { name: "Beta demo", exact: true }),
    ).not.toBeChecked();
    await pipeline
      .getByRole("button", { name: "Add rule", exact: true })
      .click();
    const rule = pipeline.locator(".semantic-rule-row");
    await expect(rule).toHaveCount(1);
    await expect(rule).toContainText("unknown");
    await expect(rule).toContainText("Alpha demo");
    await expect(rule).not.toContainText("Beta demo");
    await rule
      .getByRole("button", { name: "Edit Synthetic square", exact: true })
      .click();
    await pipeline
      .getByRole("textbox", { name: "Rule condition", exact: true })
      .fill("A blue circle is visible.");
    await pipeline
      .getByRole("button", { name: "Save rule", exact: true })
      .click();
    await expect(rule).toContainText("A blue circle is visible.");
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    await page
      .getByRole("button", { name: "Resume watching", exact: true })
      .click();
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const state = await window.openAware!.invoke({ type: "state.get" });
            return state.pipeline.rules[0]?.status;
          }),
        { timeout: 15_000 },
      )
      .toBe("active");
    await expect(
      page.locator(".activity-row").filter({ hasText: "Synthetic square:" }),
    ).toBeVisible();
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name: /^Event log(?: \d+)?$/ })
      .click();
    const alert = page
      .locator(".event-table-row")
      .filter({ hasText: "Synthetic square:" });
    await expect(alert.locator(".event-type.alert")).toHaveText("alert");
    await alert
      .getByRole("button", { name: "Acknowledge", exact: true })
      .click();
    await expect(
      alert.getByRole("button", { name: "Reviewed", exact: true }),
    ).toBeDisabled();
    expect(
      await page.evaluate(
        async () =>
          (await window.openAware!.invoke({ type: "state.get" })).pendingPlan,
      ),
    ).toBeUndefined();
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    await page.getByRole("button", { name: "Pause AI", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            (await window.openAware!.invoke({ type: "state.get" })).session,
        ),
      )
      .toBe("paused");
    await page.getByTestId("connections").click();
    const enabled = rule.getByRole("checkbox", {
      name: "Enable Synthetic square",
      exact: true,
    });
    await enabled.click();
    await expect(enabled).not.toBeChecked();
    await expect(rule).toContainText("disabled");
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    await page.getByTestId("stop-all").click();
    await expect(
      memory.getByRole("button", { name: "Summarize history", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Remove Alpha demo", exact: true })
      .click();
    await expect(page.locator('[data-testid="source-tile"]')).toHaveCount(1);
    await page.getByTestId("connections").click();
    await rule
      .getByRole("button", { name: "Edit Synthetic square", exact: true })
      .click();
    await ruleSources
      .getByRole("checkbox", { name: "Beta demo", exact: true })
      .check();
    await pipeline
      .getByRole("button", { name: "Save rule", exact: true })
      .click();
    await expect(rule).toContainText("Beta demo");
    await expect(rule).not.toContainText("Removed source");
    const repairedScope = await page.evaluate(async () => {
      const state = await window.openAware!.invoke({ type: "state.get" });
      return {
        selected: state.pipeline.rules[0].sourceIds,
        registered: state.sources.map((source) => source.id),
      };
    });
    expect(repairedScope.selected).toEqual(repairedScope.registered);
    await rule
      .getByRole("button", {
        name: "Remove rule Synthetic square",
        exact: true,
      })
      .click();
    await expect(rule).toHaveCount(0);
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    await expect(page.locator('[data-testid="source-tile"]')).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "Operator", exact: true }),
    ).toBeVisible();
  } finally {
    try {
      await closeServer(server);
    } finally {
      await closeElectron(app);
    }
  }
});
