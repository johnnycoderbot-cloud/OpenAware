import { _electron as electron, expect, test } from "@playwright/test";
import { createServer } from "node:http";
import { resolve } from "node:path";

test("independent agents keep separate bindings, source scopes and chat while shared previews continue", async () => {
  test.setTimeout(90_000);
  const requests: Record<string, unknown>[][] = [[], []];
  const servers = requests.map((received, index) =>
    createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        response.setHeader("Content-Type", "application/json");
        const model = `fixture-vision-${index + 1}`;
        if (request.url === "/api/v1/models")
          response.end(
            JSON.stringify({
              models: [
                {
                  type: "llm",
                  key: model,
                  display_name: `Independent fixture ${index + 1} (mock)`,
                  capabilities: { vision: true },
                  loaded_instances: [{ id: model }],
                },
              ],
            }),
          );
        else if (request.url === "/api/v1/chat") {
          received.push(JSON.parse(body));
          response.end(
            JSON.stringify({
              model_instance_id: model,
              output: [
                {
                  type: "message",
                  content: `Mock agent ${index + 1}: red square, blue circle, OPENAWARE 42. Synthetic fixture response.`,
                },
              ],
            }),
          );
        } else {
          response.statusCode = 404;
          response.end("{}");
        }
      });
    }),
  );
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready)),
    ),
  );
  const endpoints = servers.map((server) => {
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing fixture address");
    return `http://127.0.0.1:${address.port}`;
  });
  const env = Object.fromEntries(
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
    page.setDefaultTimeout(10_000);
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      window.setSize(1440, 1000);
      window.webContents.setBackgroundThrottling(false);
      window.showInactive();
    });
    const state = () =>
      page.evaluate(() => window.openAware!.invoke({ type: "state.get" }));
    await expect.poll(async () => (await state()).agents.length).toBe(1);
    const firstId = (await state()).activeAgentId;
    async function addDemo(name: string) {
      await page.getByTestId("add-source").click();
      await page
        .getByRole("dialog", { name: "Add a source" })
        .getByLabel("Source name")
        .fill(name);
      await page
        .getByRole("button", { name: "Connect source", exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (await state()).sources.find((source) => source.name === name)
              ?.status,
        )
        .toBe("live");
    }
    await addDemo("Alpha fixture");
    await addDemo("Beta fixture");
    const [alpha, beta] = (await state()).sources;
    if (!alpha || !beta) throw new Error("Missing synthetic sources");
    const firstSeat = page.locator(`[data-agent-seat="${firstId}"]`);
    await firstSeat
      .getByRole("button", { name: "Edit Agent 1 and assigned feeds" })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("checkbox", { name: "Beta fixture" })
      .uncheck();
    await page.getByRole("button", { name: "Save agent", exact: true }).click();
    async function bind(index: number) {
      await page
        .getByRole("button", { name: "Connections", exact: true })
        .click();
      await page.getByLabel("Server endpoint").fill(endpoints[index]!);
      await page
        .getByRole("button", { name: "Discover models", exact: true })
        .click();
      await page
        .getByRole("button", {
          name: new RegExp(`Independent fixture ${index + 1}`),
        })
        .click();
      await page
        .getByRole("button", { name: "Run vision test", exact: true })
        .click();
      await expect
        .poll(async () => (await state()).binding.status)
        .toBe("verified");
      await page.getByRole("button", { name: "Overview", exact: true }).click();
    }
    await bind(0);
    await page.getByTestId("add-agent").click();
    await page.getByLabel("Agent name", { exact: true }).fill("Video observer");
    await page
      .getByRole("dialog")
      .getByRole("checkbox", { name: "Beta fixture" })
      .check();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Add agent", exact: true })
      .click();
    await expect.poll(async () => (await state()).agents.length).toBe(2);
    const secondId = (await state()).activeAgentId;
    expect(secondId).not.toBe(firstId);
    expect((await state()).binding.status).toBe("unconfigured");
    await expect(
      page
        .locator(`[data-agent-seat="${secondId}"]`)
        .getByTestId("agent-desk-outline"),
    ).toHaveCount(1);
    await bind(1);
    await page.evaluate(() => {
      const nodes = Array.from(
        document.querySelectorAll('[data-testid="source-tile"]'),
      );
      (window as unknown as { savedSourceNodes: Element[] }).savedSourceNodes =
        nodes;
    });
    await page
      .getByRole("button", {
        name: "Start watching Video observer",
        exact: true,
      })
      .click();
    await firstSeat
      .getByRole("button", { name: "Start watching Agent 1", exact: true })
      .click();
    await expect
      .poll(async () =>
        (await state()).agents.every((agent) => agent.session === "monitoring"),
      )
      .toBe(true);
    await expect
      .poll(async () =>
        (await state()).agents.every((agent) => agent.observations.length > 0),
      )
      .toBe(true);
    await firstSeat
      .getByRole("button", { name: "Pause Agent 1", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await state()).agents.find((agent) => agent.id === firstId)?.session,
      )
      .toBe("paused");
    expect(
      (await state()).agents.find((agent) => agent.id === secondId)?.session,
    ).toBe("monitoring");
    await page.getByRole("button", { name: "Choose question sources" }).click();
    await expect(
      page
        .getByRole("group", { name: "Question sources", exact: true })
        .getByRole("checkbox", { name: "Beta fixture" }),
    ).toBeChecked();
    await expect(
      page
        .getByRole("group", { name: "Question sources", exact: true })
        .getByRole("checkbox", { name: "Alpha fixture" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Choose question sources" }).click();
    await page
      .getByRole("textbox", { name: "Ask about your workspace" })
      .fill("Question for model B");
    await page
      .getByRole("button", { name: "Send question", exact: true })
      .click();
    await expect(page.locator(".chat-message.assistant")).toContainText(
      "Mock agent 2",
    );
    await page
      .getByRole("textbox", { name: "Ask about your workspace" })
      .fill("Draft B");
    const before = (await state()).sources.map(
      (source) => source.lastFrameAt || 0,
    );
    await firstSeat
      .getByRole("button", { name: "Select Agent 1", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Ask about your workspace" }),
    ).toHaveValue("");
    await expect(page.locator(".chat-message.assistant")).toHaveCount(0);
    await page
      .getByRole("textbox", { name: "Ask about your workspace" })
      .fill("Question for model A");
    // Pause invalidates analysis receipts. Await a genuinely new shared capture
    // before asking; visible preview pixels alone cannot satisfy this gate.
    const freshnessBoundary = Date.now();
    await expect
      .poll(
        async () =>
          (await state()).sources.find((source) => source.id === alpha.id)
            ?.lastFrameAt || 0,
      )
      .toBeGreaterThan(freshnessBoundary);
    await page
      .getByRole("button", { name: "Send question", exact: true })
      .click();
    await expect(page.locator(".chat-message.assistant")).toContainText(
      "Mock agent 1",
    );
    await page
      .getByRole("button", { name: "Select Video observer", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Ask about your workspace" }),
    ).toHaveValue("Draft B");
    expect(
      await page.evaluate(() => {
        const saved = (window as unknown as { savedSourceNodes: Element[] })
          .savedSourceNodes;
        return Array.from(
          document.querySelectorAll('[data-testid="source-tile"]'),
        ).every(
          (node, index) =>
            saved[index] === node && node.querySelector("canvas"),
        );
      }),
    ).toBe(true);
    await expect
      .poll(async () =>
        (await state()).sources.every(
          (source, index) => (source.lastFrameAt || 0) > before[index]!,
        ),
      )
      .toBe(true);
    const observed = await state();
    expect(
      observed.agents
        .find((agent) => agent.id === firstId)
        ?.observations.every((record) =>
          record.sourceIds.every((id) => id === alpha.id),
        ),
    ).toBe(true);
    expect(
      observed.agents
        .find((agent) => agent.id === secondId)
        ?.observations.every((record) =>
          record.sourceIds.every((id) => id === beta.id),
        ),
    ).toBe(true);
    expect(
      requests[0]!.some((request) =>
        JSON.stringify(request).includes(alpha.id),
      ),
    ).toBe(true);
    expect(
      requests[1]!.some((request) => JSON.stringify(request).includes(beta.id)),
    ).toBe(true);
    expect(
      requests[0]!.some((request) => JSON.stringify(request).includes(beta.id)),
    ).toBe(false);
    expect(
      requests[1]!.some((request) =>
        JSON.stringify(request).includes(alpha.id),
      ),
    ).toBe(false);
    await page
      .getByRole("button", { name: "Pause Video observer", exact: true })
      .click();
    for (const name of ["Gamma fixture", "Delta fixture", "Epsilon fixture"])
      await addDemo(name);
    await page.getByTestId("add-agent").click();
    await page
      .getByLabel("Agent name", { exact: true })
      .fill("Four-feed fixture");
    const assignmentDialog = page.getByRole("dialog");
    for (const name of [
      "Alpha fixture",
      "Beta fixture",
      "Gamma fixture",
      "Delta fixture",
    ])
      await assignmentDialog.getByRole("checkbox", { name }).check();
    await expect(
      assignmentDialog.getByRole("checkbox", { name: "Epsilon fixture" }),
    ).toBeDisabled();
    await assignmentDialog
      .getByRole("button", { name: "Add agent", exact: true })
      .click();
    await expect.poll(async () => (await state()).agents.length).toBe(3);
    await page.getByTestId("add-agent").click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Add agent", exact: true })
      .click();
    await expect.poll(async () => (await state()).agents.length).toBe(4);
    await expect(page.getByTestId("add-agent")).toBeDisabled();
    await expect(page.getByTestId("agent-desk-outline")).toHaveCount(2);
    // Long agent names and a watching/event badge must not push global controls
    // off screen. Icon navigation remains named for keyboard/screen-reader use.
    await page.evaluate(async (agentId) => {
      await window.openAware!.invoke({
        type: "agent.update",
        agentId,
        patch: { name: "Long named independent agent seat" },
      });
      await window.openAware!.invoke({ type: "agent.select", agentId });
      await window.openAware!.invoke({ type: "monitor.start", agentId });
    }, firstId);
    for (const width of [1024, 800, 600]) {
      await app.evaluate(({ BrowserWindow }, width) => {
        const window = BrowserWindow.getAllWindows()[0]!;
        window.setMinimumSize(600, 500);
        window.setContentSize(width, 720);
      }, width);
      await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
      await expect
        .poll(() =>
          page.evaluate(() => {
            const controls = document.querySelectorAll(
              ".app-navigation button, .app-navigation select",
            );
            return (
              document.documentElement.scrollWidth <= innerWidth &&
              Array.from(controls).every((control) => {
                const rect = control.getBoundingClientRect();
                return (
                  rect.width === 0 ||
                  (rect.left >= 0 && rect.right <= innerWidth)
                );
              })
            );
          }),
        )
        .toBe(true);
      for (const name of ["Overview", "Operator", "Connections", "Event log"])
        await expect(
          page
            .getByRole("navigation", { name: "Main navigation" })
            .getByRole("button", { name, exact: true }),
        ).toBeVisible();
    }
    await page.getByTestId("stop-all").click();
    await expect
      .poll(async () => {
        const snapshot = await state();
        return (
          snapshot.agents.every((agent) => agent.session === "stopped") &&
          snapshot.sources.every((source) => source.status === "stopped")
        );
      })
      .toBe(true);
    await expect(page.getByTestId("source-tile").locator("canvas")).toHaveCount(
      0,
    );
  } finally {
    await app.close();
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      ),
    );
  }
});
