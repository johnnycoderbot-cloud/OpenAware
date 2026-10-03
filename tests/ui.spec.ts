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
async function closeServer(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  );
}

test("motion-only watching is explicit and Stop all remains keyboard accessible", async () => {
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({
      executablePath: process.env.OPENAWARE_EXECUTABLE,
      args: process.env.OPENAWARE_EXECUTABLE ? [] : ["."],
      cwd: resolve("."),
      env: environment(),
    });
    const page = await app.firstWindow();
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
    await app?.close();
  }
});

test("connection forms verify a synthetic image and chat uses only selected masked source", async () => {
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
        requests.push(JSON.parse(body));
        res.end(
          JSON.stringify({
            output: [
              {
                type: "message",
                content:
                  "Red square, blue circle, OPENAWARE 42. This is a deterministic test fixture, not a real model response.",
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
      args: process.env.OPENAWARE_EXECUTABLE ? [] : ["."],
      cwd: resolve("."),
      env: environment(),
    });
    const page = await app.firstWindow();
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
        page.evaluate(async () => {
          const state = await window.openAware!.invoke({ type: "state.get" });
          const alpha = state.sources.find((s) => s.name === "Alpha demo");
          return alpha?.lastFrameAt && Date.now() - alpha.lastFrameAt < 3000;
        }),
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
  } finally {
    await app?.close();
    if (server.listening) await closeServer(server);
  }
});
