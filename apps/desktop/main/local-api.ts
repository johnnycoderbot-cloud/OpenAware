import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { dirname } from "node:path";
import { mkdir, readFile, lstat, unlink, writeFile } from "node:fs/promises";
import { readFileSync, unlinkSync } from "node:fs";
import {
  commandSchema,
  type Command,
  type Snapshot,
} from "../../../packages/contracts/src/index.js";
import { parseUnambiguousJson } from "../../../packages/core/src/json.js";

const BODY_LIMIT = 32 * 1024;
const ALLOWED = new Set([
  "state.get",
  "monitor.start",
  "monitor.pause",
  "session.stop",
  "conversation.ask",
  "conversation.cancel",
  "history.search",
  "history.summarize",
  "pipeline.configure",
  "rule.add",
  "rule.update",
  "rule.remove",
]);
export interface LocalApiOptions {
  descriptorPath: string;
  command(command: Command): Promise<unknown>;
  timeoutMs?: number;
}
export interface LocalApi {
  port: number;
  close(): Promise<void>;
}
export function publicStatus(state: Snapshot) {
  return {
    version: state.version,
    session: state.session,
    epoch: state.epoch,
    busy: state.busy,
    queueSize: state.queueSize,
    binding: {
      provider: state.binding.provider,
      modelId: state.binding.modelId,
      status: state.binding.status,
    },
    sources: state.sources.map((source) => ({
      id: source.id,
      name: source.name,
      kind: source.kind,
      revision: source.revision,
      status: source.status,
      analysisEnabled: source.analysisEnabled,
      lastFrameAt: source.lastFrameAt,
      width: source.width,
      height: source.height,
      maskCount: source.masks.length,
    })),
    pipeline: state.pipeline,
    historySummary: state.historySummary,
    captionCount: state.observations.length,
    lastCaption: state.observations.at(-1),
    lastError: state.lastError,
  };
}
function responseBody(value: unknown) {
  if (
    value &&
    typeof value === "object" &&
    "binding" in value &&
    "sources" in value
  )
    return publicStatus(value as Snapshot);
  return value;
}
function send(response: ServerResponse, status: number, body: unknown) {
  if (response.destroyed || response.writableEnded) return;
  const encoded = JSON.stringify(body);
  if (Buffer.byteLength(encoded) > 2 * 1024 * 1024) {
    response.writeHead(500, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    response.end('{"error":"RESPONSE_LIMIT"}');
    return;
  }
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    Connection: "close",
  });
  response.end(encoded);
}
async function readCommand(request: IncomingMessage): Promise<Command> {
  const declared = Number(request.headers["content-length"] || 0);
  if (!Number.isFinite(declared) || declared > BODY_LIMIT)
    throw new Error("BODY_TOO_LARGE");
  let size = 0;
  const parts: Buffer[] = [];
  for await (const part of request) {
    size += part.length;
    if (size > BODY_LIMIT) throw new Error("BODY_TOO_LARGE");
    parts.push(Buffer.from(part));
  }
  let raw: unknown;
  try {
    raw = parseUnambiguousJson(
      new TextDecoder("utf-8", { fatal: true }).decode(
        Buffer.concat(parts, size),
      ),
    );
  } catch {
    throw new Error("INVALID_COMMAND");
  }
  if (
    !raw ||
    typeof raw !== "object" ||
    !ALLOWED.has(String((raw as { type?: unknown }).type))
  )
    throw new Error("FORBIDDEN_COMMAND");
  const parsed = commandSchema.safeParse(raw);
  if (!parsed.success) throw new Error("INVALID_COMMAND");
  return parsed.data;
}

/** Opt-in, same-user control only. It cannot acquire sources or authorize inputs. */
export async function startLocalApi(
  options: LocalApiOptions,
): Promise<LocalApi> {
  const secret = randomBytes(32).toString("hex");
  const expected = Buffer.from(`Bearer ${secret}`);
  let port = 0,
    active = 0,
    closed = false;
  const pending = new Set<ServerResponse>();
  const server = createServer((request, response) => {
    void (async () => {
      if (closed) return send(response, 503, { error: "STOPPED" });
      if (request.headers.host !== `127.0.0.1:${port}`)
        return send(response, 403, { error: "INVALID_HOST" });
      if (
        request.headers.origin !== undefined ||
        request.headers["sec-fetch-site"] !== undefined
      )
        return send(response, 403, { error: "ORIGIN_FORBIDDEN" });
      const received = Buffer.from(request.headers.authorization || "");
      if (
        received.length !== expected.length ||
        !timingSafeEqual(received, expected)
      )
        return send(response, 401, { error: "UNAUTHORIZED" });
      // Two bounded parsing slots remain available for Stop during a full queue.
      const stopOnly = active >= 8;
      if (active >= 10 || (stopOnly && request.method !== "POST"))
        return send(response, 429, { error: "BUSY" });
      if (!(
        (request.method === "GET" && request.url === "/v1/status") ||
        (request.method === "POST" && request.url === "/v1/command")
      ))
        return send(response, 404, { error: "NOT_FOUND" });
      if (
        request.method === "POST" &&
        !/^application\/json(?:;\s*charset=utf-8)?$/i.test(
          request.headers["content-type"] || "",
        )
      )
        return send(response, 415, { error: "INVALID_CONTENT_TYPE" });
      active++;
      pending.add(response);
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        active--;
        pending.delete(response);
        clearTimeout(timer);
      };
      const timer = setTimeout(() => {
        send(response, 504, { error: "TIMEOUT" });
        request.destroy();
      }, options.timeoutMs ?? 25_000);
      try {
        const command =
          request.method === "GET"
            ? { type: "state.get" as const }
            : await readCommand(request);
        if (stopOnly && command.type !== "session.stop")
          return send(response, 429, { error: "BUSY" });
        if (response.destroyed || response.writableEnded || closed) return;
        const value = await options.command(command);
        if (!closed) send(response, 200, { data: responseBody(value) });
      } catch (error) {
        const code = error instanceof Error ? error.message : "";
        send(
          response,
          code === "BODY_TOO_LARGE"
            ? 413
            : code === "FORBIDDEN_COMMAND"
              ? 403
              : code === "INVALID_COMMAND"
                ? 400
                : 422,
          {
            error: [
              "BODY_TOO_LARGE",
              "FORBIDDEN_COMMAND",
              "INVALID_COMMAND",
            ].includes(code)
              ? code
              : "COMMAND_FAILED",
          },
        );
      } finally {
        finish();
      }
    })().catch(() => send(response, 500, { error: "INTERNAL_ERROR" }));
  });
  server.headersTimeout = 5000;
  server.requestTimeout = 10_000;
  server.maxHeadersCount = 32;
  server.maxConnections = 32;
  server.on("clientError", (_error, socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Local CLI bridge could not bind");
  port = address.port;
  try {
    await mkdir(dirname(options.descriptorPath), {
      recursive: true,
      mode: 0o700,
    });
    try {
      const stat = await lstat(options.descriptorPath);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 4096)
        throw new Error("Invalid local CLI connection file");
      const previous = parseUnambiguousJson(
        new TextDecoder("utf-8", { fatal: true }).decode(
          await readFile(options.descriptorPath),
        ),
      );
      if (
        !previous ||
        typeof previous !== "object" ||
        Array.isArray(previous) ||
        !("pid" in previous) ||
        typeof previous.pid !== "number" ||
        !Number.isSafeInteger(previous.pid) ||
        previous.pid < 1
      )
        throw new Error("Invalid local CLI connection file");
      let live = true;
      try {
        process.kill(previous.pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") live = false;
      }
      if (live) throw new Error("Another OpenAware CLI session is active");
      await unlink(options.descriptorPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await writeFile(
      options.descriptorPath,
      JSON.stringify({ version: 1, port, token: secret, pid: process.pid }),
      { mode: 0o600, flag: "wx" },
    );
  } catch (error) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw error;
  }
  return {
    port,
    async close() {
      if (closed) return;
      closed = true;
      for (const response of pending) response.destroy();
      // Electron may exit before an asynchronous filesystem cleanup completes.
      try {
        const current = parseUnambiguousJson(
          new TextDecoder("utf-8", { fatal: true }).decode(
            readFileSync(options.descriptorPath),
          ),
        );
        if (
          current &&
          typeof current === "object" &&
          "token" in current &&
          current.token === secret
        )
          unlinkSync(options.descriptorPath);
      } catch {
        /* A removed/replaced descriptor does not belong to this session. */
      }
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
