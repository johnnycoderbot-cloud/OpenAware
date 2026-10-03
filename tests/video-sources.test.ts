import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  VideoSourceRegistry,
  validateVideoUrl,
  parseMediaRange,
  localVideoResponse,
  remoteVideoResponse,
  MAX_MEDIA_RANGE_BYTES,
} from "../apps/desktop/main/video-sources";

test("video URL registration rejects privileges/credentials and exports opaque metadata only", () => {
  for (const address of [
    "file:///secret.mp4",
    "javascript:alert(1)",
    "http://user:pass@example.com/v",
    "https://example.com/\nsecret",
    "blob:https://example.com/v",
    "invalid",
  ])
    assert.throws(() => validateVideoUrl(address));
  const registry = new VideoSourceRegistry();
  const selection = registry.url(
    "https://example.com/private/video?token=secret#fragment",
    "page",
  );
  assert.match(selection.deviceId, /^video:[0-9a-f-]{36}$/);
  assert.equal(selection.name, "example.com");
  assert.equal(selection.kind, "web_video");
  assert.equal(JSON.stringify(selection).includes("secret"), false);
  assert.equal(registry.get(selection.deviceId)?.kind, "web_video");
  assert.throws(() =>
    registry.claim(selection.deviceId, "video_url", "source-a"),
  );
  registry.claim(selection.deviceId, "web_video", "source-a");
  assert.equal(
    registry.get(selection.deviceId, "web_video", "source-b"),
    undefined,
  );
  registry.remove("source-a");
  assert.equal(registry.get(selection.deviceId), undefined);
});

test("failed duplicate source admission rolls back only its newly claimed video handle", () => {
  const registry = new VideoSourceRegistry();
  const committed = registry.url("https://example.com/first", "direct");
  assert.equal(
    registry.claim(committed.deviceId, committed.kind, "existing-source"),
    true,
  );
  const duplicate = registry.url("https://example.com/second", "direct");
  assert.equal(
    registry.claim(duplicate.deviceId, duplicate.kind, "existing-source"),
    true,
  );
  registry.rollback(duplicate.deviceId, "existing-source");
  assert.ok(
    registry.get(committed.deviceId, committed.kind, "existing-source"),
  );
  assert.equal(registry.get(duplicate.deviceId), undefined);
  assert.equal(
    registry.claim(committed.deviceId, committed.kind, "existing-source"),
    false,
  );
});

test("local video registry exposes basename and rejects missing/unsupported files", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "oa-video-registry-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "fixture.webm");
  await writeFile(path, Buffer.from([1, 2, 3]));
  const registry = new VideoSourceRegistry();
  const selected = await registry.file(path);
  assert.equal(selected.name, "fixture.webm");
  assert.equal(JSON.stringify(selected).includes(dir), false);
  await assert.rejects(registry.file(join(dir, "missing.webm")), /unavailable/);
  await assert.rejects(registry.file(join(dir, "unsupported.txt")), /Choose/);
});

test("media range parser caps each file response and rejects multiple/overflow ranges", () => {
  const size = MAX_MEDIA_RANGE_BYTES * 3;
  assert.deepEqual(parseMediaRange("bytes=0-", size), {
    start: 0,
    end: MAX_MEDIA_RANGE_BYTES - 1,
  });
  assert.deepEqual(parseMediaRange("bytes=-3", size), {
    start: size - 3,
    end: size - 1,
  });
  assert.deepEqual(parseMediaRange("bytes=4-9", size), { start: 4, end: 9 });
  for (const range of [
    "bytes=3-2",
    "bytes=0-3,8-12",
    "bytes=-0",
    `bytes=${size}-`,
    "bytes=9007199254740993-",
    "items=0-4",
  ])
    assert.equal(parseMediaRange(range, size), undefined);
});

test("local file streaming serves the exact requested bytes and revoked requests cannot read", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "oa-video-range-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "fixture.webm");
  await writeFile(path, Buffer.from([1, 2, 3, 4, 5, 6]));
  const controller = new AbortController();
  const response = await localVideoResponse(
    path,
    "bytes=2-4",
    controller.signal,
  );
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 2-4/6");
  assert.deepEqual(
    [...new Uint8Array(await response.arrayBuffer())],
    [3, 4, 5],
  );
  assert.equal(
    (await localVideoResponse(path, "bytes=6-", controller.signal)).status,
    416,
  );
  controller.abort();
  await assert.rejects(
    localVideoResponse(path, null, controller.signal),
    /stopped/,
  );
});

test("direct HTTP video proxy preserves byte ranges without CORS and rejects HTML, redirects and invalid ranges", async (t) => {
  const ranges: string[] = [];
  const server = createServer((request, response) => {
    ranges.push(request.headers.range ?? "");
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "/movie" });
      response.end();
    } else if (request.url === "/cross") {
      response.writeHead(302, { location: "https://example.com/movie" });
      response.end();
    } else if (request.url === "/html") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("not a video");
    } else if (request.url === "/bad-range") {
      response.writeHead(206, {
        "content-type": "video/webm",
        "content-range": "bytes 2-5/6",
      });
      response.end("xxxx");
    } else if (request.url === "/overrun") {
      response.writeHead(206, {
        "content-type": "video/webm",
        "content-range": "bytes 0-3/6",
      });
      response.end("123456789");
    } else {
      response.writeHead(206, {
        "content-type": "video/webm",
        "content-range": "bytes 0-5/6",
        "content-length": "6",
      });
      response.end("123456");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const signal = new AbortController().signal;
  const result = await remoteVideoResponse(
    `${origin}/redirect`,
    "bytes=0-",
    signal,
  );
  assert.equal(result.status, 206);
  assert.equal(await result.text(), "123456");
  assert.ok(
    ranges.every((range) => range === `bytes=0-${MAX_MEDIA_RANGE_BYTES - 1}`),
  );
  await assert.rejects(
    remoteVideoResponse(`${origin}/cross`, null, signal),
    /cross-site/,
  );
  await assert.rejects(
    remoteVideoResponse(`${origin}/html`, null, signal),
    /Web player/,
  );
  await assert.rejects(
    remoteVideoResponse(`${origin}/bad-range`, null, signal),
    /invalid byte range/,
  );
  const oversized = await remoteVideoResponse(
    `${origin}/overrun`,
    "bytes=0-3",
    signal,
  );
  await assert.rejects(oversized.arrayBuffer(), /exceeded its byte range/);
  assert.equal(
    (await remoteVideoResponse(`${origin}/movie`, "bytes=0-3,8-12", signal))
      .status,
    416,
  );
});
