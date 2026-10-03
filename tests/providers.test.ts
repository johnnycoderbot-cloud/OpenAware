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
import type { TextSummaryInput } from "../packages/providers/src/index.js";

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

function llamaCompletion(content = "Observed fixture") {
  return {
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: { role: "assistant", content },
      },
    ],
  };
}

test("llama.cpp discovery uses model IDs and explicit capabilities without name guessing or loading", async (t) => {
  const requests: string[] = [];
  let models: unknown = [
    { id: "llava-name-without-proof", meta: null },
    {
      id: "vision",
      architecture: { input_modalities: ["text", "image"] },
      meta: {},
    },
    {
      id: "text",
      architecture: { input_modalities: ["text"] },
      status: { value: "sleeping" },
    },
  ];
  const endpoint = await server(t, (request, response) => {
    requests.push(`${request.method} ${request.url}`);
    json(response, { data: models });
  });
  const provider = createProvider({ provider: "llamacpp", endpoint });
  const found = await provider.discover(new AbortController().signal);
  assert.deepEqual(
    found.map((m) => [m.id, m.vision, m.loaded]),
    [
      ["llava-name-without-proof", "unknown", false],
      ["vision", "declared", true],
      ["text", "unsupported", false],
    ],
  );
  for (const invalid of [
    null,
    [{ id: "" }],
    [{ id: "repeat" }, { id: "repeat" }],
    Array.from({ length: 257 }, (_, i) => ({ id: String(i) })),
    [{ id: "bad", architecture: { input_modalities: [7] } }],
  ]) {
    models = invalid;
    await assert.rejects(provider.discover(new AbortController().signal));
  }
  assert(requests.every((path) => path === "GET /v1/models"));
});

test("llama.cpp image requests preserve model and chronological selected frames with bounded JSON mode", async (t) => {
  const received: Record<string, any>[] = [];
  const endpoint = await server(t, async (request, response) => {
    assert.equal(request.url, "/v1/chat/completions");
    assert.equal(request.headers.authorization, "Bearer fixture-token");
    received.push(await body(request));
    json(response, llamaCompletion('{"summary":"Recorded sequence"}'));
  });
  const provider = createProvider({
    provider: "llamacpp",
    endpoint,
    token: "fixture-token",
  });
  const frames = [frame(), frame()];
  frames[0].capturedAt = 1000;
  frames[1].capturedAt = 3000;
  for (const mode of ["observe", "plan", "chat"] as const) {
    const value = await provider.analyze(
      {
        modelId: "selected-alias",
        frames,
        question: "Describe",
        mode,
        structured: mode === "observe",
      },
      new AbortController().signal,
    );
    assert.equal(value, '{"summary":"Recorded sequence"}');
  }
  for (const input of received) {
    assert.equal(input.model, "selected-alias");
    assert.equal(input.stream, false);
    assert.equal(input.max_tokens, 1024);
    assert.equal(input.reasoning_effort, "none");
    assert.deepEqual(input.chat_template_kwargs, { enable_thinking: false });
    assert.match(input.messages[0].content, /untrusted evidence/);
    assert.deepEqual(
      input.messages[1].content.map((part: any) => part.type),
      ["text", "image_url", "image_url"],
    );
    assert.deepEqual(
      input.messages[1].content.slice(1).map((part: any) => part.image_url.url),
      frames.map((f) => f.dataUrl),
    );
    assert.match(
      input.messages[1].content[0].text,
      /captured 1000.*captured 3000/,
    );
    assert.equal(input.tools, undefined);
    assert.equal(input.functions, undefined);
  }
  assert.deepEqual(received[0].response_format, { type: "json_object" });
  assert.deepEqual(received[1].response_format, { type: "json_object" });
  assert.match(received[1].messages[1].content[0].text, /Every step requires/);
  assert.equal(received[2].response_format, undefined);
});

test("llama.cpp historical summaries use only validated caption text", async (t) => {
  const received: Record<string, any>[] = [];
  const endpoint = await server(t, async (request, response) => {
    received.push(await body(request));
    json(response, llamaCompletion("The recorded circle moved right."));
  });
  const provider = createProvider({ provider: "llamacpp", endpoint });
  assert.equal(
    await provider.summarize!(historyInput(), new AbortController().signal),
    "The recorded circle moved right.",
  );
  const input = received[0];
  assert.equal(input.max_tokens, 512);
  assert.equal(input.model, "vision");
  assert.match(input.messages[1].content, /historical caption records/);
  assert.match(input.messages[1].content, /8000/);
  assert.doesNotMatch(
    JSON.stringify(input),
    /data:image|image_url|previous_response_id/,
  );
  assert.equal(input.tools, undefined);
  await assert.rejects(
    provider.summarize!(
      { ...historyInput(), captions: [] },
      new AbortController().signal,
    ),
  );
  await assert.rejects(
    provider.summarize!(
      {
        ...historyInput(),
        captions: Array.from({ length: 25 }, () => ({
          ...historyInput().captions[0],
          summary: "x".repeat(1500),
        })),
      },
      new AbortController().signal,
    ),
    /context limit/,
  );
  assert.equal(received.length, 1);
});

test("llama.cpp rejects tools, incomplete or ambiguous assistant completions without exposing output", async (t) => {
  let output: unknown;
  const endpoint = await server(t, (_request, response) =>
    json(response, output),
  );
  const provider = createProvider({ provider: "llamacpp", endpoint });
  for (const invalid of [
    { choices: [] },
    { choices: [llamaCompletion().choices[0], llamaCompletion().choices[0]] },
    { choices: [{ ...llamaCompletion().choices[0], finish_reason: "length" }] },
    { choices: [{ ...llamaCompletion().choices[0], index: 1 }] },
    llamaCompletion(""),
    llamaCompletion("x".repeat(16_385)),
    {
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: { role: "user", content: "secret-fixture" },
        },
      ],
    },
    {
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: "secret-fixture",
            tool_calls: [{}],
          },
        },
      ],
    },
    {
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: "secret-fixture",
            tool_calls: "bad",
          },
        },
      ],
    },
    {
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: "secret-fixture",
            function_call: {},
          },
        },
      ],
    },
    {
      choices: [
        {
          index: 0,
          finish_reason: "tool_calls",
          message: { role: "assistant", content: "secret-fixture" },
        },
      ],
    },
  ]) {
    output = invalid;
    await assert.rejects(
      provider.analyze(
        {
          modelId: "vision",
          frames: [frame()],
          question: "Describe",
          mode: "chat",
        },
        new AbortController().signal,
      ),
      (error) =>
        error instanceof Error && !error.message.includes("secret-fixture"),
    );
    await assert.rejects(
      provider.summarize!(historyInput(), new AbortController().signal),
    );
  }
});

test("llama.cpp inherits cancellation, response and serialized image limits", async (t) => {
  let requests = 0;
  const endpoint = await server(t, async (request, response) => {
    requests++;
    await body(request);
    response.end("x".repeat(RESPONSE_LIMIT + 1));
  });
  const provider = createProvider({ provider: "llamacpp", endpoint });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(provider.discover(controller.signal), /cancelled/);
  assert.equal(requests, 0);
  const bytes = Buffer.concat([
    Buffer.from(png.split(",")[1], "base64"),
    Buffer.alloc(900_000),
  ]);
  await assert.rejects(
    provider.analyze(
      {
        modelId: "vision",
        question: "Describe",
        mode: "observe",
        frames: Array.from({ length: 4 }, () => ({
          ...frame(),
          dataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
        })),
      },
      new AbortController().signal,
    ),
    /serialized request limit/,
  );
  assert.equal(requests, 0);
  await assert.rejects(
    provider.summarize!(historyInput(), new AbortController().signal),
    /2 MiB/,
  );
  assert.equal(requests, 1);
});

const historyInput = (): TextSummaryInput => ({
  modelId: "vision",
  question: "What changed?",
  captions: [
    {
      id: randomUUID(),
      sourceNames: ["Monitor 1"],
      capturedAt: 10000,
      captureStartAt: 8000,
      summary: "A blue circle moved to the right.",
    },
  ],
});

test("historical summaries send only bounded text with no storage or tools to LM Studio", async (t) => {
  let received: Record<string, any> | undefined;
  const endpoint = await server(t, async (request, response) => {
    assert.equal(request.url, "/api/v1/chat");
    received = await body(request);
    json(response, {
      output: [
        { type: "message", content: "The recorded circle moved right." },
      ],
    });
  });
  const provider = createProvider({ provider: "lmstudio", endpoint });
  assert.equal(
    await provider.summarize!(historyInput(), new AbortController().signal),
    "The recorded circle moved right.",
  );
  assert.deepEqual(
    received?.input.map((part: any) => part.type),
    ["text"],
  );
  assert.match(received?.input[0].content, /historical caption/);
  assert.match(received?.input[0].content, /8000/);
  assert.equal(received?.store, false);
  assert.equal(received?.max_output_tokens, 512);
  assert.deepEqual(received?.integrations, []);
  assert.doesNotMatch(
    JSON.stringify(received),
    /data:image|previous_response_id/,
  );
});

test("Ollama discovery skips declared cloud routes and temporal requests use JSON without thinking", async (t) => {
  const shown: string[] = [];
  let received: Record<string, any> | undefined;
  const endpoint = await server(t, async (request, response) => {
    if (request.url === "/api/tags")
      return json(response, {
        models: [
          { name: "vision" },
          { name: "unavailable-cloud", remote_host: "https://ollama.com" },
        ],
      });
    if (request.url === "/api/show") {
      const input = await body(request);
      shown.push(input.model);
      if (input.model === "unavailable-cloud") {
        response.writeHead(410);
        response.end();
        return;
      }
      return json(response, { capabilities: ["vision", "thinking"] });
    }
    received = await body(request);
    json(response, {
      done: true,
      message: { content: '{"summary":"Observed"}' },
    });
  });
  const provider = createProvider({ provider: "ollama", endpoint });
  assert.deepEqual(
    (await provider.discover(new AbortController().signal)).map(
      (m) => m.vision,
    ),
    ["declared", "unsupported"],
  );
  assert.deepEqual(shown, ["vision"]);
  await provider.analyze(
    {
      modelId: "vision",
      frames: [frame(), frame()],
      question: "Describe this sequence",
      mode: "observe",
      structured: true,
    },
    new AbortController().signal,
  );
  assert.equal(received?.format, "json");
  assert.equal(received?.think, false);
  assert.equal(received?.messages[1].images.length, 2);
  await provider.summarize!(historyInput(), new AbortController().signal);
  assert.equal(received?.think, false);
  assert.equal(received?.format, undefined);
  assert.equal(received?.messages[1].images, undefined);
  assert.equal(received?.tools, undefined);
});

test("historical summaries reject remote proxies, invalid evidence and tool responses", async (t) => {
  let chats = 0;
  const endpoint = await server(t, async (request, response) => {
    if (request.url === "/api/show")
      return json(response, { remote_model: "elsewhere" });
    chats++;
    json(response, {
      output: [{ type: "message", content: "Fine" }, { type: "tool_call" }],
    });
  });
  const ollama = createProvider({ provider: "ollama", endpoint });
  await assert.rejects(
    ollama.summarize!(historyInput(), new AbortController().signal),
    /remote model/,
  );
  assert.equal(chats, 0);
  const lm = createProvider({ provider: "lmstudio", endpoint });
  for (const captions of [
    [],
    Array.from({ length: 26 }, () => historyInput().captions[0]),
    [{ ...historyInput().captions[0], captureStartAt: 10001 }],
    [{ ...historyInput().captions[0], summary: "x".repeat(2001) }],
    Array.from({ length: 25 }, () => ({
      ...historyInput().captions[0],
      summary: "x".repeat(1500),
    })),
  ]) {
    await assert.rejects(
      lm.summarize!(
        { ...historyInput(), captions },
        new AbortController().signal,
      ),
    );
  }
  assert.equal(chats, 0);
  await assert.rejects(
    lm.summarize!(historyInput(), new AbortController().signal),
    /unsupported tool/,
  );
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    lm.summarize!(historyInput(), aborted.signal),
    /cancelled/,
  );
});

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
