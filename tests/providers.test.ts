import test from "node:test";
import assert from "node:assert/strict";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomUUID } from "node:crypto";
import {
  boundedJson,
  createProvider,
  localEndpoint,
  RESPONSE_LIMIT,
} from "../packages/providers/src/index.js";
import { validateImage, parsePlan } from "../packages/core/src/index.js";
import type { Frame } from "../packages/contracts/src/index.js";

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN/8AAAAASUVORK5CYII=";
const frame = (): Frame => ({
  id: randomUUID(),
  sourceId: randomUUID(),
  sourceRevision: 1,
  capturedAt: Date.now(),
  width: 1,
  height: 1,
  dataUrl: png,
});
async function server(
  t: test.TestContext,
  handler: (
    request: IncomingMessage,
    response: ServerResponse,
  ) => void | Promise<void>,
): Promise<string> {
  const instance = createServer((request, response) => {
    void handler(request, response);
  });
  await new Promise<void>((resolve) =>
    instance.listen(0, "127.0.0.1", resolve),
  );
  t.after(async () => {
    instance.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      instance.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const address = instance.address();
  assert(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}
async function body(request: IncomingMessage): Promise<Record<string, any>> {
  const parts: Buffer[] = [];
  for await (const part of request) parts.push(Buffer.from(part));
  return JSON.parse(Buffer.concat(parts).toString());
}
function json(response: ServerResponse, value: unknown) {
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(value));
}

test("provider origins reject remote addresses, credentials, encoded alternate hosts and URL paths", () => {
  for (const value of [
    "http://example.com",
    "http://127.0.0.2",
    "http://0x7f000001",
    "http://2130706433",
    "http://127.1",
    "http://user:secret@localhost",
    "http://localhost/api",
    "http://localhost/?token=secret",
    "http://localhost/#x",
    "http://localhost:0",
    "http://localhost:65536",
    "file:///tmp/image",
    "http://localhost\\evil",
  ])
    assert.throws(() => localEndpoint(value));
  assert.equal(
    localEndpoint("http://localhost:1234/"),
    "http://127.0.0.1:1234",
  );
  assert.equal(localEndpoint("http://[::1]:11434"), "http://[::1]:11434");
});

test("LM Studio discovers real native model keys and sends bounded native images with store:false and no tools", async (t) => {
  let received: Record<string, any> | undefined;
  const endpoint = await server(t, async (request, response) => {
    assert.equal(request.headers.authorization, "Bearer memory-only-secret");
    if (request.url === "/api/v1/models")
      return json(response, {
        models: [
          {
            type: "llm",
            key: "local/vision",
            display_name: "Local vision",
            capabilities: { vision: true },
            loaded_instances: [{ id: "instance" }],
          },
          {
            type: "llm",
            key: "text",
            capabilities: { vision: false },
            loaded_instances: [],
          },
          { type: "embedding", key: "embedding" },
        ],
      });
    assert.equal(request.url, "/api/v1/chat");
    received = await body(request);
    json(response, {
      model_instance_id: "local/vision",
      output: [
        { type: "reasoning", content: "private reasoning" },
        {
          type: "message",
          content: "A red square and a blue circle, OPENAWARE42.",
        },
      ],
    });
  });
  const provider = createProvider({
    provider: "lmstudio",
    endpoint,
    token: "memory-only-secret",
  });
  const models = await provider.discover(new AbortController().signal);
  assert.deepEqual(
    models.map((model) => [model.id, model.vision, model.loaded]),
    [
      ["local/vision", "declared", true],
      ["text", "unsupported", false],
    ],
  );
  const result = await provider.analyze(
    {
      modelId: "local/vision",
      frames: [frame()],
      question: "Describe",
      mode: "probe",
    },
    new AbortController().signal,
  );
  assert.match(result, /OPENAWARE42/);
  assert.doesNotMatch(result, /reasoning/);
  assert.equal(received?.store, false);
  assert.equal(received?.stream, false);
  assert.equal(received?.max_output_tokens, 1024);
  assert.deepEqual(received?.integrations, []);
  assert.equal(received?.input[1].type, "image");
  assert.equal(received?.input[1].data_url, png);
  assert.equal(received?.model, "local/vision");
  assert.equal(received?.previous_response_id, undefined);
});

test("Ollama reads capabilities, denies remote model routes and sends base64 to selected local model only", async (t) => {
  let received: Record<string, any> | undefined;
  let chats = 0;
  const endpoint = await server(t, async (request, response) => {
    if (request.url === "/api/tags")
      return json(response, {
        models: [
          { name: "vision:latest" },
          { name: "text:latest" },
          {
            name: "remote:latest",
            remote_host: "https://ollama.com",
            remote_model: "vision",
          },
        ],
      });
    if (request.url === "/api/show") {
      const value = await body(request);
      return json(response, {
        capabilities:
          value.model === "text:latest"
            ? ["completion"]
            : ["completion", "vision"],
        ...(value.model === "remote:latest"
          ? { remote_host: "https://ollama.com", remote_model: "vision" }
          : {}),
      });
    }
    chats++;
    received = await body(request);
    json(response, {
      model: "vision:latest",
      done: true,
      message: { role: "assistant", content: "Visible test" },
    });
  });
  const provider = createProvider({ provider: "ollama", endpoint });
  assert.deepEqual(
    (await provider.discover(new AbortController().signal)).map(
      (item) => item.vision,
    ),
    ["declared", "unsupported", "unsupported"],
  );
  await assert.rejects(
    provider.analyze(
      {
        modelId: "remote:latest",
        frames: [frame()],
        question: "Describe",
        mode: "observe",
      },
      new AbortController().signal,
    ),
    /remote model route/,
  );
  assert.equal(chats, 0);
  assert.equal(
    await provider.analyze(
      {
        modelId: "vision:latest",
        frames: [frame()],
        question: "Describe",
        mode: "chat",
      },
      new AbortController().signal,
    ),
    "Visible test",
  );
  assert.equal(received?.messages[1].images[0], png.split(",")[1]);
  assert.equal(received?.stream, false);
  assert.equal(received?.options.num_predict, 1024);
  assert.equal(received?.tools, undefined);
});

test("redirects cannot forward bearer tokens; cancellation and timeout return content-free errors", async (t) => {
  let destination = 0;
  const endpoint = await server(t, (request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "/destination" });
      response.end();
    } else if (request.url === "/destination") {
      destination++;
      json(response, {});
    } else if (request.url === "/error") {
      response.writeHead(500);
      response.end("secret-token sensitive prompt");
    }
  });
  await assert.rejects(
    boundedJson(
      endpoint,
      "/redirect",
      "secret-token",
      new AbortController().signal,
    ),
    (error) =>
      error instanceof Error && !error.message.includes("secret-token"),
  );
  assert.equal(destination, 0);
  await assert.rejects(
    boundedJson(
      endpoint,
      "/error",
      "secret-token",
      new AbortController().signal,
    ),
    /failed \(500\)/,
  );
  const controller = new AbortController();
  const cancelled = boundedJson(
    endpoint,
    "/hang",
    undefined,
    controller.signal,
  );
  controller.abort();
  await assert.rejects(cancelled, /cancelled/);
  await assert.rejects(
    boundedJson(
      endpoint,
      "/hang",
      undefined,
      new AbortController().signal,
      undefined,
      10,
    ),
    /timed out/,
  );
});

test("both declared and chunked oversized provider bodies are rejected before parsing", async (t) => {
  const endpoint = await server(t, (request, response) => {
    if (request.url === "/declared")
      response.setHeader("content-length", RESPONSE_LIMIT + 1);
    response.end("x".repeat(RESPONSE_LIMIT + 1));
  });
  await assert.rejects(
    boundedJson(endpoint, "/declared", undefined, new AbortController().signal),
    /2 MiB/,
  );
  await assert.rejects(
    boundedJson(endpoint, "/chunked", undefined, new AbortController().signal),
    /2 MiB/,
  );
});

test("serialized multi-image batch is rejected without silently dropping selected frames", async (t) => {
  let requests = 0;
  const endpoint = await server(t, (_request, response) => {
    requests++;
    json(response, { output: [{ type: "message", content: "wrong" }] });
  });
  const bytes = Buffer.concat([
    Buffer.from(png.split(",")[1], "base64"),
    Buffer.alloc(900_000),
  ]);
  const frames = Array.from({ length: 4 }, () => ({
    ...frame(),
    dataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
  }));
  await assert.rejects(
    createProvider({ provider: "lmstudio", endpoint }).analyze(
      {
        modelId: "vision",
        frames,
        question: "Describe every source",
        mode: "chat",
      },
      new AbortController().signal,
    ),
    /serialized request limit/,
  );
  assert.equal(requests, 0);
});

test("image dimensions, actual image format, typed action parameters, and model tool calls are checked", async (t) => {
  assert.doesNotThrow(() => validateImage(frame()));
  assert.throws(() => validateImage({ ...frame(), width: 1024 }), /dimensions/);
  assert.throws(
    () =>
      validateImage({ ...frame(), dataUrl: "data:image/jpeg;base64,aGVsbG8=" }),
    /JPEG/,
  );
  assert.throws(() =>
    parsePlan(
      '{"steps":[{"type":"click","x":1.2,"y":0.5,"description":"outside"}]}',
    ),
  );
  assert.throws(() =>
    parsePlan(
      '{"steps":[{"type":"shell","text":"do stuff","description":"bad"}]}',
    ),
  );
  assert.throws(() =>
    parsePlan(
      '{"steps":[{"type":"key","key":"DELETE","description":"unavailable"}]}',
    ),
  );
  assert.deepEqual(
    parsePlan(
      '{"steps":[{"type":"key","key":"CTRL+A","description":"Select text"}]}',
    )[0].key,
    "CTRL+A",
  );
  const endpoint = await server(t, (request, response) =>
    json(response, {
      output: [
        { type: "message", content: "fine" },
        { type: "tool_call", tool: "shell", arguments: {} },
      ],
    }),
  );
  await assert.rejects(
    createProvider({ provider: "lmstudio", endpoint }).analyze(
      {
        modelId: "vision",
        frames: [frame()],
        question: "Describe",
        mode: "observe",
      },
      new AbortController().signal,
    ),
    /unsupported tool/,
  );
});
