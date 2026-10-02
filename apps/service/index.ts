import { createService } from "./engine.js";
import { commandSchema } from "../../packages/contracts/src/index.js";

const service = createService({
  onState(state) {
    if (process.connected) process.send?.({ type: "state", state });
  },
});
process.on("message", (message: unknown) => {
  if (!message || typeof message !== "object" || Array.isArray(message)) return;
  const value = message as Record<string, unknown>;
  if (typeof value.id !== "string" || value.id.length > 100) return;
  const parsed = commandSchema.safeParse(value.command);
  if (!parsed.success) {
    process.send?.({ id: value.id, error: "Invalid command" });
    return;
  }
  void service.command(parsed.data).then(
    (data) => {
      if (process.connected) process.send?.({ id: value.id, data });
    },
    (error) => {
      if (process.connected)
        process.send?.({
          id: value.id,
          error:
            error instanceof Error
              ? error.message.slice(0, 300)
              : "Operation failed",
        });
    },
  );
});
process.once("disconnect", () => {
  service.dispose();
  process.exit(0);
});
process.once("SIGTERM", () => {
  service.dispose();
  process.exit(0);
});
process.once("SIGINT", () => {
  service.dispose();
  process.exit(0);
});
