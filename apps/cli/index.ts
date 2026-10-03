import { readFile, lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import {
  commandSchema,
  type Command,
} from "../../packages/contracts/src/index.js";

const usage = `OpenAware local video workflows
Start OpenAware with --enable-cli and configure sources/model in the app first.

node dist/cli.cjs status
node dist/cli.cjs sources
node dist/cli.cjs watch start|pause|stop
node dist/cli.cjs ask "What changed?" --sources UUID,UUID
node dist/cli.cjs captions search "query" [--sources UUID,UUID] [--from ISO] [--to ISO] [--limit 20]
node dist/cli.cjs captions summary [--sources UUID,UUID] [--from ISO] [--to ISO] [--question "Summarize changes"]
node dist/cli.cjs rules list
node dist/cli.cjs rules add --name "Name" --condition "Visible condition" --sources UUID,UUID
node dist/cli.cjs rules update UUID [--name "Name"] [--condition "Condition"] [--sources UUID,UUID] [--enabled true|false]
node dist/cli.cjs rules remove UUID

Optional leading --connection PATH uses a private connection descriptor.
JSON output. No commands acquire sources, change models, or execute computer actions.`;

function flags(args: string[], allowed: string[]) {
  const result = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index],
      value = args[index + 1];
    if (
      !key?.startsWith("--") ||
      !allowed.includes(key.slice(2)) ||
      value === undefined ||
      value.startsWith("--") ||
      result.has(key.slice(2))
    )
      throw new Error("Invalid or repeated command option");
    result.set(key.slice(2), value);
  }
  return result;
}
function required(values: Map<string, string>, key: string) {
  const value = values.get(key);
  if (!value) throw new Error(`Missing --${key}`);
  return value;
}
function ids(value: string | undefined) {
  return value?.split(",").map((id) => id.trim());
}
function time(value: string | undefined) {
  if (!value) return undefined;
  if (!/^\d{4}-\d\d-\d\dT/.test(value))
    throw new Error("Times must be ISO date-times");
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("Invalid time");
  return parsed;
}
export function cliCommand(args: string[]): {
  command: Command;
  projection?: "sources" | "rules";
} {
  const [group, action, ...rest] = args;
  let command: unknown, projection: "sources" | "rules" | undefined;
  if (["status", "sources"].includes(group) && action === undefined) {
    command = { type: "state.get" };
    if (group === "sources") projection = "sources";
  } else if (
    group === "watch" &&
    rest.length === 0 &&
    ["start", "pause", "stop"].includes(action)
  ) {
    command = {
      type:
        action === "start"
          ? "monitor.start"
          : action === "pause"
            ? "monitor.pause"
            : "session.stop",
    };
  } else if (group === "ask" && action) {
    const options = flags(rest, ["sources"]);
    command = {
      type: "conversation.ask",
      text: action,
      sourceIds: ids(required(options, "sources")),
    };
  } else if (group === "captions" && ["search", "summary"].includes(action)) {
    const query =
      action === "search" && rest[0] && !rest[0].startsWith("--")
        ? rest.shift()
        : "";
    const options = flags(rest, [
      "sources",
      "from",
      "to",
      action === "search" ? "limit" : "question",
    ]);
    const scope = {
      ...(options.has("sources")
        ? { sourceIds: ids(required(options, "sources")) }
        : {}),
      ...(options.has("from") ? { from: time(required(options, "from")) } : {}),
      ...(options.has("to") ? { to: time(required(options, "to")) } : {}),
    };
    command =
      action === "search"
        ? {
            type: "history.search",
            query,
            ...scope,
            ...(options.has("limit")
              ? { limit: Number(required(options, "limit")) }
              : {}),
          }
        : {
            type: "history.summarize",
            ...scope,
            ...(options.has("question")
              ? { question: required(options, "question") }
              : {}),
          };
  } else if (group === "rules" && action === "list" && rest.length === 0) {
    command = { type: "state.get" };
    projection = "rules";
  } else if (group === "rules" && action === "add") {
    const options = flags(rest, ["name", "condition", "sources"]);
    command = {
      type: "rule.add",
      name: required(options, "name"),
      condition: required(options, "condition"),
      sourceIds: ids(required(options, "sources")),
    };
  } else if (group === "rules" && action === "remove" && rest.length === 1) {
    command = { type: "rule.remove", ruleId: rest[0] };
  } else if (group === "rules" && action === "update" && rest.length) {
    const ruleId = rest.shift();
    const options = flags(rest, ["name", "condition", "sources", "enabled"]);
    if (!options.size) throw new Error("Specify a rule change");
    const enabled = options.get("enabled");
    if (enabled !== undefined && enabled !== "true" && enabled !== "false")
      throw new Error("--enabled must be true or false");
    command = {
      type: "rule.update",
      ruleId,
      patch: {
        ...(options.has("name") ? { name: required(options, "name") } : {}),
        ...(options.has("condition")
          ? { condition: required(options, "condition") }
          : {}),
        ...(options.has("sources")
          ? { sourceIds: ids(required(options, "sources")) }
          : {}),
        ...(enabled !== undefined ? { enabled: enabled === "true" } : {}),
      },
    };
  } else throw new Error("Unknown command. Use --help");
  const result = commandSchema.safeParse(command);
  if (!result.success) throw new Error("Invalid command values. Use --help");
  return { command: result.data, projection };
}

async function connectionFile(explicit?: string) {
  if (explicit) return explicit;
  if (process.env.OPENAWARE_CONNECTION_FILE)
    return process.env.OPENAWARE_CONNECTION_FILE;
  const base =
    process.platform === "win32"
      ? process.env.APPDATA
      : process.platform === "darwin"
        ? join(homedir(), "Library", "Application Support")
        : process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  if (!base)
    throw new Error("Application data folder unavailable. Use --connection");
  for (const name of ["OpenAware", "openaware"]) {
    const path = join(base, name, "local-api.json");
    try {
      await lstat(path);
      return path;
    } catch {
      /* Try the other application name. */
    }
  }
  throw new Error(
    "OpenAware CLI is not enabled. Open the app with --enable-cli",
  );
}
export async function runCli(args: string[]) {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h")
    return usage;
  let path: string | undefined;
  if (args[0] === "--connection") {
    if (!args[1]) throw new Error("Missing connection path");
    path = args[1];
    args = args.slice(2);
  }
  const operation = cliCommand(args);
  const file = await connectionFile(path);
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096)
    throw new Error("Invalid OpenAware connection file");
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0)
    throw new Error("OpenAware connection file must be private");
  let config;
  try {
    config = JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw new Error("Invalid OpenAware connection file");
  }
  if (
    config.version !== 1 ||
    !Number.isInteger(config.port) ||
    config.port < 1 ||
    config.port > 65535 ||
    typeof config.token !== "string" ||
    !/^[a-f0-9]{64}$/.test(config.token) ||
    !Number.isInteger(config.pid) ||
    config.pid < 1
  )
    throw new Error("Invalid OpenAware connection file");
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${config.port}/v1/command`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify(operation.command),
      signal: AbortSignal.timeout(26_000),
      redirect: "error",
    });
  } catch {
    throw new Error("OpenAware CLI connection failed or timed out");
  }
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > 2 * 1024 * 1024) {
    await response.body?.cancel();
    throw new Error("OpenAware response is too large");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty OpenAware response");
  let size = 0;
  const parts: Uint8Array[] = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 2 * 1024 * 1024) {
        await reader.cancel();
        throw new Error("OpenAware response is too large");
      }
      parts.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  let result;
  try {
    result = JSON.parse(Buffer.concat(parts, size).toString("utf8"));
  } catch {
    throw new Error("Invalid OpenAware response");
  }
  if (!response.ok) {
    const allowed = [
      "COMMAND_FAILED",
      "INVALID_COMMAND",
      "FORBIDDEN_COMMAND",
      "UNAUTHORIZED",
      "BUSY",
      "TIMEOUT",
    ];
    throw new Error(
      `OpenAware request failed (${allowed.includes(result.error) ? result.error : response.status})`,
    );
  }
  if (operation.projection === "sources")
    return { sources: result.data.sources };
  if (operation.projection === "rules")
    return { rules: result.data.pipeline.rules };
  return result.data;
}

const invoked =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
// esbuild's CommonJS output has no import.meta; its explicit bundle marker is set at build time.
declare const OPENAWARE_CLI_ENTRY: boolean | undefined;
if (
  invoked ||
  (typeof OPENAWARE_CLI_ENTRY !== "undefined" && OPENAWARE_CLI_ENTRY)
) {
  runCli(process.argv.slice(2))
    .then((value) => {
      process.stdout.write(
        typeof value === "string" ? value + "\n" : JSON.stringify(value) + "\n",
      );
    })
    .catch((error) => {
      process.stderr.write(
        (error instanceof Error ? error.message : "OpenAware CLI failed") +
          "\n",
      );
      process.exitCode = 1;
    });
}
