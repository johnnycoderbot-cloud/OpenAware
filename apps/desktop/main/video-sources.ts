import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { Readable } from "node:stream";
import {
  MAX_SOURCES,
  type VideoSourceSelection,
} from "../../../packages/contracts/src/index";

export const MAX_MEDIA_RANGE_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 16 * 1024 * 1024 * 1024;
const TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".ogv": "video/ogg",
};
export type RegisteredVideo =
  | { kind: "video_file"; path: string; name: string }
  | { kind: "video_url" | "web_video"; url: string; name: string };
type Registration = RegisteredVideo & { sourceId?: string; expiresAt: number };

export function validateVideoUrl(raw: unknown): URL {
  if (
    typeof raw !== "string" ||
    raw.length > 8192 ||
    /[\u0000-\u001f\u007f]/.test(raw)
  )
    throw new Error("Enter an HTTP or HTTPS video address.");
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("Enter an HTTP or HTTPS video address.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password
  )
    throw new Error("Use HTTP or HTTPS without embedded account credentials.");
  url.hash = "";
  return url;
}
function displayName(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 80) || "Video";
}
export function videoFileType(path: string): string | undefined {
  return TYPES[extname(path).toLowerCase()];
}

/** Paths and complete URLs remain in this main-process memory registry only. */
export class VideoSourceRegistry {
  private readonly entries = new Map<string, Registration>();
  private purge(): void {
    for (const [id, entry] of this.entries)
      if (!entry.sourceId && entry.expiresAt < Date.now())
        this.entries.delete(id);
  }
  private add(video: RegisteredVideo): VideoSourceSelection {
    this.purge();
    if (this.entries.size >= MAX_SOURCES * 2)
      throw new Error("Remove an unused video source before adding another.");
    const deviceId = `video:${randomUUID()}`;
    this.entries.set(deviceId, {
      ...video,
      expiresAt: Date.now() + 10 * 60_000,
    });
    return { deviceId, name: video.name, kind: video.kind };
  }
  async file(path: string): Promise<VideoSourceSelection> {
    if (!videoFileType(path))
      throw new Error("Choose an MP4, WebM, MOV, M4V or OGV video.");
    const info = await stat(path).catch(() => undefined);
    if (!info?.isFile() || info.size < 1 || info.size > MAX_VIDEO_BYTES)
      throw new Error("The selected video is unavailable or exceeds 16 GiB.");
    return this.add({
      kind: "video_file",
      path,
      name: displayName(basename(path)),
    });
  }
  url(raw: unknown, mode: unknown): VideoSourceSelection {
    if (mode !== "direct" && mode !== "page")
      throw new Error("Choose a direct video or web player.");
    const url = validateVideoUrl(raw);
    return this.add({
      kind: mode === "page" ? "web_video" : "video_url",
      url: url.href,
      name: displayName(url.hostname),
    });
  }
  get(
    deviceId: string,
    kind?: string,
    sourceId?: string,
  ): RegisteredVideo | undefined {
    this.purge();
    const entry = this.entries.get(deviceId);
    if (
      !entry ||
      (kind && entry.kind !== kind) ||
      (sourceId && entry.sourceId && entry.sourceId !== sourceId)
    )
      return undefined;
    return entry;
  }
  claim(deviceId: string, kind: string, sourceId: string): boolean {
    const entry = this.get(deviceId, kind, sourceId) as
      Registration | undefined;
    if (!entry)
      throw new Error("Choose the video source again before connecting.");
    const newlyClaimed = !entry.sourceId;
    entry.sourceId = sourceId;
    return newlyClaimed;
  }
  rollback(deviceId: string, sourceId: string): void {
    const entry = this.entries.get(deviceId);
    if (entry?.sourceId === sourceId) this.entries.delete(deviceId);
  }
  remove(sourceId: string): void {
    for (const [id, entry] of this.entries)
      if (entry.sourceId === sourceId) this.entries.delete(id);
  }
  clear(): void {
    this.entries.clear();
  }
}

export function parseMediaRange(
  raw: string | null,
  size: number,
): { start: number; end: number } | undefined {
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_VIDEO_BYTES)
    return undefined;
  if (!raw)
    return { start: 0, end: Math.min(size - 1, MAX_MEDIA_RANGE_BYTES - 1) };
  const match = /^bytes=(\d*)-(\d*)$/.exec(raw);
  if (!match || (!match[1] && !match[2])) return undefined;
  const first = match[1] ? Number(match[1]) : undefined;
  const last = match[2] ? Number(match[2]) : undefined;
  if (
    (first !== undefined && !Number.isSafeInteger(first)) ||
    (last !== undefined && !Number.isSafeInteger(last))
  )
    return undefined;
  const start = first ?? Math.max(0, size - last!);
  const requestedEnd = first === undefined ? size - 1 : (last ?? size - 1);
  if (
    start < 0 ||
    start >= size ||
    requestedEnd < start ||
    (first === undefined && last === 0)
  )
    return undefined;
  return {
    start,
    end: Math.min(requestedEnd, size - 1, start + MAX_MEDIA_RANGE_BYTES - 1),
  };
}
function mediaHeaders(type: string): Record<string, string> {
  return {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
  };
}
export async function localVideoResponse(
  path: string,
  range: string | null,
  signal: AbortSignal,
): Promise<Response> {
  if (signal.aborted) throw new Error("Video stopped.");
  const info = await stat(path);
  const type = videoFileType(path);
  if (!info.isFile() || !type) throw new Error("Video unavailable.");
  const bounds = parseMediaRange(range, info.size);
  if (!bounds)
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${info.size}` },
    });
  const body = createReadStream(path, {
    ...bounds,
    highWaterMark: 64 * 1024,
    signal,
  });
  return new Response(Readable.toWeb(body) as ReadableStream<Uint8Array>, {
    status: 206,
    headers: {
      ...mediaHeaders(type),
      "Content-Length": String(bounds.end - bounds.start + 1),
      "Content-Range": `bytes ${bounds.start}-${bounds.end}/${info.size}`,
    },
  });
}

/** Same-origin redirects only; never forward cookies, authorization or arbitrary
 * dashboard headers. Streaming bodies preserve backpressure and never buffer a
 * video in app memory. The owner aborts every request when its capture stops. */
export async function remoteVideoResponse(
  address: string,
  range: string | null,
  signal: AbortSignal,
): Promise<Response> {
  const original = validateVideoUrl(address);
  const match = range ? /^bytes=(\d+)-(\d*)$/.exec(range) : undefined;
  if (range && !match) return new Response(null, { status: 416 });
  const start = match ? Number(match[1]) : 0;
  const requestedEnd = match?.[2]
    ? Number(match[2])
    : start + MAX_MEDIA_RANGE_BYTES - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    requestedEnd < start ||
    start >= MAX_VIDEO_BYTES
  )
    return new Response(null, { status: 416 });
  const end = Math.min(
    requestedEnd,
    start + MAX_MEDIA_RANGE_BYTES - 1,
    MAX_VIDEO_BYTES - 1,
  );
  let url = original;
  for (let redirect = 0; redirect <= 3; redirect++) {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      headers: {
        Range: `bytes=${start}-${end}`,
        Accept: "video/*,application/octet-stream;q=0.8",
        "Accept-Encoding": "identity",
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location || redirect === 3)
        throw new Error("Video redirect is unavailable.");
      const next = validateVideoUrl(new URL(location, url).href);
      if (next.origin !== original.origin)
        throw new Error(
          "Use the final direct video address; cross-site redirects are not supported.",
        );
      url = next;
      continue;
    }
    const type = (response.headers.get("content-type") ?? "")
      .split(";", 1)[0]!
      .trim()
      .toLowerCase();
    const length = response.headers.get("content-length");
    if (
      ![200, 206].includes(response.status) ||
      !response.body ||
      (!type.startsWith("video/") && type !== "application/octet-stream") ||
      (length && (!/^\d+$/.test(length) || Number(length) > MAX_VIDEO_BYTES))
    ) {
      await response.body?.cancel();
      throw new Error(
        "The address did not provide a supported direct video. Try Web player.",
      );
    }
    const headers = mediaHeaders(type);
    let bodyLimit = MAX_VIDEO_BYTES;
    if (length) headers["Content-Length"] = length;
    const contentRange = response.headers.get("content-range");
    if (response.status === 206) {
      const parsed = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange ?? "");
      if (
        !parsed ||
        !parsed
          .slice(1)
          .every((value) => Number.isSafeInteger(Number(value))) ||
        Number(parsed[1]) !== start ||
        Number(parsed[2]) > end ||
        Number(parsed[2]) < start ||
        Number(parsed[3]) > MAX_VIDEO_BYTES ||
        Number(parsed[3]) <= Number(parsed[2])
      ) {
        await response.body.cancel();
        throw new Error("The direct video returned an invalid byte range.");
      }
      headers["Content-Range"] = contentRange!;
      bodyLimit = Number(parsed[2]) - Number(parsed[1]) + 1;
      if (length && Number(length) !== bodyLimit) {
        await response.body.cancel();
        throw new Error("The direct video returned an invalid byte length.");
      }
    } else if (start !== 0) {
      await response.body.cancel();
      throw new Error("The direct video server does not support seeking.");
    }
    let received = 0;
    const body = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          received += chunk.byteLength;
          if (received > bodyLimit)
            throw new Error("The direct video exceeded its byte range.");
          controller.enqueue(chunk);
        },
        flush() {
          if (
            (response.status === 206 || length) &&
            received !== (response.status === 206 ? bodyLimit : Number(length))
          )
            throw new Error("The direct video response was incomplete.");
        },
      }),
    );
    return new Response(body, { status: response.status, headers });
  }
  throw new Error("Video redirect is unavailable.");
}
