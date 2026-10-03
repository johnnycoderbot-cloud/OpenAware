import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, stat, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { request, createServer } from "node:http";
import { randomUUID } from "node:crypto";
import {
  startLocalApi,
  publicStatus,
  type LocalApiOptions,
} from "../apps/desktop/main/local-api.js";
import {
  initialSnapshot,
  type Command,
} from "../packages/contracts/src/index.js";
import { cliCommand, runCli } from "../apps/cli/index.js";

async function fixture(
  t: test.TestContext,
  command: LocalApiOptions["command"] = async () => initialSnapshot(),
  timeoutMs?: number,
) {
  const dir = await mkdtemp(join(tmpdir(), "openaware-cli-test-"));
  const file = join(dir, "local-api.json");
  const api = await startLocalApi({ descriptorPath: file, command, timeoutMs });
  const connection = JSON.parse(await readFile(file, "utf8"));
  t.after(async () => {
    await api.close();
    await rm(dir, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${api.port}`;
  const auth = { Authorization: `Bearer ${connection.token}` };
  return { dir, file, api, url, connection, auth };
}

test("CLI bridge authenticates, rejects browser/alternate hosts, and exposes redacted state", async (t) => {
  const state = initialSnapshot();
  state.binding.endpoint = "http://127.0.0.1:1234";
  const f = await fixture(t, async () => state);
  assert.equal((await fetch(`${f.url}/v1/status`)).status, 401);
  assert.equal(
    (
      await fetch(`${f.url}/v1/status`, {
        headers: { Authorization: "Bearer wrong" },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(`${f.url}/v1/status`, {
        headers: { ...f.auth, Origin: "https://evil.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(`${f.url}/v1/status`, {
        headers: { ...f.auth, "Sec-Fetch-Site": "same-origin" },
      })
    ).status,
    403,
  );
  const alternateHost = await new Promise<number>((resolve, reject) => {
    const raw = request(
      `${f.url}/v1/status`,
      {
        headers: { ...f.auth, Host: `localhost:${f.api.port}` },
      },
      (response) => {
        response.resume();
        resolve(response.statusCode!);
      },
    );
    raw.on("error", reject);
    raw.end();
  });
  assert.equal(alternateHost, 403);
  const response = await fetch(`${f.url}/v1/status`, { headers: f.auth });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  const value = (await response.json()) as any;
  assert.equal(value.data.version, state.version);
  assert.equal(value.data.binding.endpoint, undefined);
  assert.equal(value.data.pendingPlan, undefined);
  assert.doesNotMatch(JSON.stringify(value), new RegExp(f.connection.token));
  if (process.platform !== "win32")
    assert.equal((await stat(f.file)).mode & 0o077, 0);
  assert.equal(publicStatus(state).captionCount, 0);
});

test("CLI whitelist denies acquisition, pixels, provider and automation commands before dispatch", async (t) => {
  const dispatched: Command[] = [];
  const f = await fixture(t, async (command) => {
    dispatched.push(command);
    return initialSnapshot();
  });
  for (const type of [
    "source.add",
    "source.frame",
    "provider.configure",
    "binding.select",
    "automation.plan",
    "automation.confirm",
    "history.clear",
  ]) {
    const response = await fetch(`${f.url}/v1/command`, {
      method: "POST",
      headers: { ...f.auth, "Content-Type": "application/json" },
      body: JSON.stringify({ type }),
    });
    assert.equal(response.status, 403, type);
  }
  const invalid = await fetch(`${f.url}/v1/command`, {
    method: "POST",
    headers: { ...f.auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "conversation.ask",
      text: "Describe",
      sourceIds: [],
    }),
  });
  assert.equal(invalid.status, 400);
  assert.equal(dispatched.length, 0);
  assert.equal(
    (
      await fetch(`${f.url}/v1/command`, {
        method: "POST",
        headers: f.auth,
        body: "{}",
      })
    ).status,
    415,
  );
  assert.equal(
    (await fetch(`${f.url}/v1/status?token=oops`, { headers: f.auth })).status,
    404,
  );
});

test("local API bounds request bodies, concurrency, timeout and redacts backend errors", async (t) => {
  const f = await fixture(t, async () => {
    throw new Error("secret backend text");
  });
  const tooBig = await fetch(`${f.url}/v1/command`, {
    method: "POST",
    headers: { ...f.auth, "Content-Type": "application/json" },
    body: "x".repeat(32769),
  });
  assert.equal(tooBig.status, 413);
  assert.equal(((await tooBig.json()) as any).error, "BODY_TOO_LARGE");
  const failed = await fetch(`${f.url}/v1/status`, { headers: f.auth });
  assert.deepEqual(await failed.json(), { error: "COMMAND_FAILED" });
  const waiting: Array<(value: unknown) => void> = [];
  const busy = await fixture(
    t,
    async (command) =>
      command.type === "session.stop"
        ? initialSnapshot()
        : new Promise((resolve) => waiting.push(resolve)),
    1000,
  );
  const pending = Array.from({ length: 8 }, () =>
    fetch(`${busy.url}/v1/status`, { headers: busy.auth }),
  );
  for (let count = 0; waiting.length < 8 && count < 30; count++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(waiting.length, 8);
  assert.equal(
    (await fetch(`${busy.url}/v1/status`, { headers: busy.auth })).status,
    429,
  );
  const stopped = await runCli(["--connection", busy.file, "watch", "stop"]);
  assert.equal(stopped.session, "idle");
  const notStop = await fetch(`${busy.url}/v1/command`, {
    method: "POST",
    headers: { ...busy.auth, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "state.get" }),
  });
  assert.equal(notStop.status, 429);
  assert.equal(waiting.length, 8);
  for (const resolve of waiting) resolve(initialSnapshot());
  assert(
    (await Promise.all(pending)).every((response) => response.status === 200),
  );
  const slow = await fixture(
    t,
    async () =>
      new Promise((resolve) =>
        setTimeout(() => resolve(initialSnapshot()), 70),
      ),
    20,
  );
  assert.equal(
    (await fetch(`${slow.url}/v1/status`, { headers: slow.auth })).status,
    504,
  );
});

test("CLI parses exact source and history scope and performs an authenticated roundtrip including Stop", async (t) => {
  const id = randomUUID(),
    ruleId = randomUUID();
  assert.deepEqual(cliCommand(["ask", "Describe", "--sources", id]).command, {
    type: "conversation.ask",
    text: "Describe",
    sourceIds: [id],
  });
  assert.deepEqual(
    cliCommand(["captions", "search", "blue", "--sources", id, "--limit", "5"])
      .command,
    { type: "history.search", query: "blue", sourceIds: [id], limit: 5 },
  );
  assert.equal(
    cliCommand(["rules", "update", ruleId, "--enabled", "false"]).command.type,
    "rule.update",
  );
  for (const args of [
    ["watch", "start", "extra"],
    ["captions", "search"],
    ["captions", "search", "q", "--limit", "51"],
    ["ask", "x", "--sources", "invalid"],
    ["rules", "update", ruleId],
    ["rules", "update", ruleId, "--enabled", "maybe"],
    [
      "captions",
      "summary",
      "--from",
      "2026-10-03T00:00:00Z",
      "--to",
      "2026-10-02T00:00:00Z",
    ],
    ["rules", "add", "--name", "a", "--name", "b"],
  ])
    assert.throws(() => cliCommand(args));
  const commands: Command[] = [];
  const f = await fixture(t, async (command) => {
    commands.push(command);
    return initialSnapshot();
  });
  const status = await runCli(["--connection", f.file, "status"]);
  assert.equal(status.version, initialSnapshot().version);
  assert.deepEqual(await runCli(["--connection", f.file, "sources"]), {
    sources: [],
  });
  assert.deepEqual(await runCli(["--connection", f.file, "rules", "list"]), {
    rules: [],
  });
  await runCli(["--connection", f.file, "watch", "stop"]);
  assert.equal(commands.at(-1)?.type, "session.stop");
  await f.api.close();
  await assert.rejects(readFile(f.file), { code: "ENOENT" });
  await assert.rejects(runCli(["--connection", f.file, "status"]));
});

test("CLI connection descriptors cannot overwrite an active session or delete another session's descriptor", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    startLocalApi({
      descriptorPath: f.file,
      command: async () => initialSnapshot(),
    }),
    /Another OpenAware/,
  );
  const changed = { ...f.connection, token: "a".repeat(64) };
  await writeFile(f.file, JSON.stringify(changed));
  await f.api.close();
  assert.deepEqual(JSON.parse(await readFile(f.file, "utf8")), changed);
  await assert.rejects(
    runCli(["--connection", f.file, "status"]),
    /connection failed/,
  );
});

test("CLI malformed connection and response errors cannot echo private content", async (t) => {
  const f = await fixture(t);
  await writeFile(f.file, '{"token":"private-sensitive-sentinel');
  await assert.rejects(
    runCli(["--connection", f.file, "status"]),
    (error) =>
      error instanceof Error &&
      error.message === "Invalid OpenAware connection file",
  );
  const remote = createServer((_request, response) =>
    response.end("private-sensitive-sentinel"),
  );
  await new Promise<void>((resolve) => remote.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    remote.closeAllConnections();
    await new Promise<void>((resolve) => remote.close(() => resolve()));
  });
  const addr = remote.address();
  assert(addr && typeof addr !== "string");
  await writeFile(f.file, JSON.stringify({ ...f.connection, port: addr.port }));
  await assert.rejects(
    runCli(["--connection", f.file, "status"]),
    (error) =>
      error instanceof Error && error.message === "Invalid OpenAware response",
  );
});
