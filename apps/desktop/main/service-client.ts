import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Command, Snapshot } from "../../../packages/contracts/src/index";

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}
export class ServiceClient {
  private child?: ChildProcess;
  private pending = new Map<string, Pending>();
  private closed = false;
  constructor(
    private onState: (state: Snapshot) => void,
    private onCrash: (message: string) => void,
  ) {}
  start(path: string): void {
    this.child = fork(path, [], {
      execPath: process.execPath,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      windowsHide: true,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      serialization: "json",
    });
    this.child.on("message", (message: unknown) => {
      if (!message || typeof message !== "object") return;
      const data = message as {
        type?: string;
        state?: Snapshot;
        id?: string;
        data?: unknown;
        error?: string;
      };
      if (data.type === "state" && data.state) {
        this.onState(data.state);
        return;
      }
      if (typeof data.id !== "string") return;
      const pending = this.pending.get(data.id);
      if (!pending) return;
      this.pending.delete(data.id);
      clearTimeout(pending.timer);
      typeof data.error === "string"
        ? pending.reject(new Error(data.error.slice(0, 500)))
        : pending.resolve(data.data);
    });
    this.child.on("error", (error) => this.fail(error.message));
    this.child.on("exit", (code, signal) => {
      if (!this.closed)
        this.fail(
          `Service exited (${signal ?? code ?? "unknown"}). Restart OpenAware.`,
        );
    });
    this.child.on("disconnect", () => {
      if (!this.closed) this.fail("Service disconnected. Restart OpenAware.");
    });
  }
  private fail(message: string): void {
    const wasClosed = this.closed;
    this.closed = true;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("OpenAware service unavailable"));
    }
    this.pending.clear();
    this.child?.kill();
    if (!wasClosed) this.onCrash(message.slice(0, 300));
  }
  request<T = Snapshot>(command: Command): Promise<T> {
    if (this.closed || !this.child?.connected)
      return Promise.reject(new Error("OpenAware service unavailable"));
    if (this.pending.size >= 64)
      return Promise.reject(new Error("Service request queue is full"));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Service request timed out"));
      }, 24_000);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      this.child!.send({ id, command }, (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.reject(new Error("Unable to send service request"));
      });
    });
  }
  close(): void {
    this.closed = true;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("OpenAware is closing"));
    }
    this.pending.clear();
    this.child?.kill();
  }
}
