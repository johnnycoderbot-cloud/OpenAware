import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { createServer } from "node:http";
import { resolve } from "node:path";

async function launch() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
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
  });
  page.setDefaultTimeout(10_000);
  return { app, page };
}

async function close(app?: ElectronApplication) {
  if (!app) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      app.close(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Audit fixture failed to close")),
          5000,
        );
      }),
    ]);
  } catch (error) {
    const child = app.process();
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function addDemo(page: Page, name: string) {
  await page.getByTestId("add-source").click();
  await page.getByLabel("Source name", { exact: true }).fill(name);
  await page
    .getByRole("button", { name: "Connect source", exact: true })
    .click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        async (name) =>
          (await window.openAware!.invoke({ type: "state.get" })).sources.find(
            (s) => s.name === name,
          )?.status,
        name,
      ),
    )
    .toBe("live");
}

test("question scope and draft survive every page and source reconnect", async () => {
  let app: ElectronApplication | undefined;
  try {
    const fixture = await launch();
    app = fixture.app;
    const { page } = fixture;
    await addDemo(page, "Scope Alpha");
    await addDemo(page, "Scope Beta");
    const menu = page.getByRole("button", {
      name: "Choose question sources",
      exact: true,
    });
    await menu.click();
    await page
      .getByRole("checkbox", { name: "Scope Beta", exact: true })
      .uncheck();
    await menu.click();
    await page
      .getByRole("textbox", { name: "Ask about your workspace" })
      .fill("Keep this unsent question");
    for (const name of ["Connections", "Operator", "Event log"]) {
      await page
        .getByRole("button", {
          name: name === "Event log" ? /^Event log/ : name,
          exact: true,
        })
        .click();
      await page.getByRole("button", { name: "Overview", exact: true }).click();
      await expect
        .soft(page.getByRole("textbox", { name: "Ask about your workspace" }))
        .toHaveValue("Keep this unsent question");
      await menu.click();
      await expect
        .soft(page.getByRole("checkbox", { name: "Scope Alpha", exact: true }))
        .toBeChecked();
      await expect
        .soft(page.getByRole("checkbox", { name: "Scope Beta", exact: true }))
        .not.toBeChecked();
      await menu.click();
    }
    const beta = page
      .getByTestId("source-tile")
      .filter({
        has: page.getByRole("heading", { name: "Scope Beta", exact: true }),
      });
    await beta.getByRole("button", { name: "Disconnect", exact: true }).click();
    await beta.getByRole("button", { name: "Connect", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            (
              await window.openAware!.invoke({ type: "state.get" })
            ).sources.find((s) => s.name === "Scope Beta")?.status,
        ),
      )
      .toBe("live");
    await menu.click();
    await expect(
      page.getByRole("checkbox", { name: "Scope Beta", exact: true }),
    ).not.toBeChecked();
  } finally {
    await close(app);
  }
});

for (const composeCase of ["ime", "next-draft"] as const)
  test(
    composeCase === "ime"
      ? "IME confirmation Enter does not submit a workspace question"
      : "a completed question does not erase a newer unsent draft",
    async () => {
      let requests = 0;
      let deferReply = false;
      let releaseReply: (() => void) | undefined;
      const server = createServer((req, res) => {
        req.resume();
        req.on("end", () => {
          res.setHeader("Content-Type", "application/json");
          if (req.url === "/api/v1/models")
            res.end(
              JSON.stringify({
                models: [
                  {
                    type: "llm",
                    key: "audit-fixture",
                    display_name: "Audit vision fixture",
                    capabilities: { vision: true },
                    loaded_instances: [{}],
                  },
                ],
              }),
            );
          else if (req.url === "/api/v1/chat") {
            requests++;
            const reply = () =>
              res.end(
                JSON.stringify({
                  output: [
                    {
                      type: "message",
                      content:
                        "Red square, blue circle, OPENAWARE 42. Synthetic audit response.",
                    },
                  ],
                }),
              );
            if (deferReply) releaseReply = reply;
            else reply();
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
          throw new Error("Missing audit fixture address");
        const fixture = await launch();
        app = fixture.app;
        const { page } = fixture;
        await addDemo(page, "IME source");
        await page.getByTestId("connections").click();
        await page
          .getByLabel("Server endpoint", { exact: true })
          .fill(`http://127.0.0.1:${address.port}`);
        await page
          .getByRole("button", { name: "Discover models", exact: true })
          .click();
        await page
          .getByRole("button", { name: /Audit vision fixture/ })
          .click();
        await page
          .getByRole("button", { name: "Run vision test", exact: true })
          .click();
        await expect(
          page.getByText(
            "Image response verified. Return to Overview and explicitly start watching.",
          ),
        ).toBeVisible();
        const verifiedAt = await page.evaluate(() => Date.now());
        await page
          .getByRole("button", { name: "Overview", exact: true })
          .click();
        await expect
          .poll(() =>
            page.evaluate(async (verifiedAt) => {
              const source = (
                await window.openAware!.invoke({ type: "state.get" })
              ).sources[0]!;
              return (
                source.lastFrameAt !== undefined &&
                source.lastFrameAt > verifiedAt &&
                Date.now() - source.lastFrameAt < 3000
              );
            }, verifiedAt),
          )
          .toBe(true);
        const input = page.getByRole("textbox", {
          name: "Ask about your workspace",
        });
        await input.fill("正在输入");
        await expect(
          page.getByRole("button", { name: "Send question", exact: true }),
        ).toBeEnabled();
        const baseline = requests;
        if (composeCase === "ime") {
          const prevented = await input.evaluate((element) => {
            const event = new KeyboardEvent("keydown", {
              key: "Enter",
              code: "Enter",
              bubbles: true,
              cancelable: true,
              isComposing: true,
            });
            element.dispatchEvent(event);
            return event.defaultPrevented;
          });
          expect.soft(prevented).toBe(false);
          // A short bounded negative check catches a real provider call, not just DOM handling.
          await page.waitForTimeout(350);
          expect.soft(requests).toBe(baseline);
          await expect.soft(input).toHaveValue("正在输入");
          if (prevented) return;
        } else deferReply = true;
        await input.press("Enter");
        await expect.poll(() => requests).toBe(baseline + 1);
        if (composeCase === "next-draft") {
          await input.fill("Keep this newer draft while the answer arrives");
          releaseReply!();
          await expect(page.locator(".chat-message.assistant")).toHaveCount(1);
          await expect(input).toHaveValue(
            "Keep this newer draft while the answer arrives",
          );
        } else await expect(input).toHaveValue("");
      } finally {
        await close(app);
        server.closeAllConnections();
        await new Promise<void>((done, reject) =>
          server.close((error) => (error ? reject(error) : done())),
        );
      }
    },
  );
