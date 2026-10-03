import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DesktopBackgroundController,
  launchModeFromArgs,
} from "../apps/desktop/main/background";
import type { DesktopState } from "../packages/contracts/src/index";
import { initialSnapshot } from "../packages/contracts/src/index";
import { EventEmitter } from "node:events";
import type { ChildProcess, fork } from "node:child_process";
import { ServiceClient } from "../apps/desktop/main/service-client";

function fixture(
  launchMode: DesktopState["launchMode"] = "window",
  synthetic = false,
) {
  const calls: string[] = [];
  const broadcasts: DesktopState[] = [];
  const controller = new DesktopBackgroundController(
    {
      showWindow: () => calls.push("show"),
      hideWindow: () => calls.push("hide"),
      stop: () => calls.push("stop"),
      closeService: () => calls.push("close-service"),
      destroyTray: () => calls.push("destroy-tray"),
      quitApp: () => calls.push("quit"),
      onState: (state) => broadcasts.push(state),
    },
    launchMode,
    synthetic,
  );
  return { controller, calls, broadcasts };
}

test("only exact explicit launch flags select background", () => {
  assert.equal(launchModeFromArgs(["electron", "."]), "window");
  assert.equal(
    launchModeFromArgs(["electron", ".", "--headless"]),
    "background",
  );
  assert.equal(
    launchModeFromArgs(["OpenAware.exe", "--background"]),
    "background",
  );
  assert.equal(
    launchModeFromArgs(["--headless=false", "my--background"]),
    "window",
  );
});

test("hidden startup needs a tray and never starts capture or model work", () => {
  const { controller, calls } = fixture("background");
  assert.equal(controller.launch(), false);
  assert.equal(controller.snapshot().backgroundMode, false);
  assert.deepEqual(calls, []);
  controller.setTrayAvailable(true);
  assert.equal(controller.launch(), true);
  assert.deepEqual(calls, ["hide"]);
  assert.deepEqual(controller.snapshot(), {
    backgroundMode: true,
    windowVisible: false,
    trayAvailable: true,
    launchMode: "background",
  });
});

test("background accepts an exact boolean and production refuses a missing tray", () => {
  const { controller, calls } = fixture();
  for (const value of [undefined, null, "true", 1, {}, []])
    assert.throws(() => controller.setBackgroundMode(value), /boolean/);
  assert.throws(() => controller.setBackgroundMode(true), /system tray/);
  assert.deepEqual(calls, []);
  const synthetic = fixture("background", true);
  assert.equal(synthetic.controller.launch(), true);
  assert.equal(synthetic.controller.snapshot().trayAvailable, false);
});

test("service failure during startup keeps the error dashboard visible", () => {
  const { controller, calls } = fixture("background");
  controller.setTrayAvailable(true);
  controller.serviceFailed();
  assert.equal(controller.launch(), false);
  assert.equal(controller.snapshot().windowVisible, true);
  assert.equal(controller.snapshot().backgroundMode, false);
  assert.deepEqual(calls, ["show"]);
  // The user can still explicitly choose background after reviewing the error.
  controller.setBackgroundMode(true);
  assert.deepEqual(calls, ["show", "hide"]);
});

test("Show preserves background preference and close hides without stopping", () => {
  const { controller, calls } = fixture();
  controller.setTrayAvailable(true);
  controller.setBackgroundMode(true);
  controller.show();
  assert.equal(controller.snapshot().backgroundMode, true);
  assert.equal(controller.snapshot().windowVisible, true);
  controller.closeRequested();
  assert.deepEqual(calls, ["hide", "show", "hide"]);
  assert.equal(controller.snapshot().windowVisible, false);
  assert.equal(controller.isQuitting(), false);
});

test("disabling background shows dashboard and normal close quits in revoke-first order", () => {
  const { controller, calls } = fixture();
  controller.setTrayAvailable(true);
  controller.setBackgroundMode(true);
  controller.setBackgroundMode(false);
  controller.closeRequested();
  assert.deepEqual(calls, [
    "hide",
    "show",
    "stop",
    "close-service",
    "destroy-tray",
    "quit",
  ]);
  assert.equal(controller.isQuitting(), true);
  assert.throws(() => controller.setBackgroundMode(true), /closing/);
  controller.beginQuit();
  controller.quit();
  controller.closeRequested();
  controller.show();
  assert.equal(calls.length, 6);
});

test("external visibility changes broadcast immutable snapshots", () => {
  const { controller, broadcasts } = fixture();
  controller.windowVisibilityChanged(true);
  controller.windowVisibilityChanged(true);
  controller.windowVisibilityChanged(false);
  assert.equal(broadcasts.length, 2);
  assert.equal(broadcasts[0].windowVisible, true);
  assert.equal(broadcasts[1].windowVisible, false);
  const snapshot = controller.snapshot();
  snapshot.windowVisible = true;
  assert.equal(controller.snapshot().windowVisible, false);
});

test("reported visibility follows the native window even if Show or Hide fails", () => {
  const calls: string[] = [];
  const broadcasts: DesktopState[] = [];
  let nativeVisible = false;
  const controller = new DesktopBackgroundController(
    {
      showWindow: () => calls.push("show"),
      hideWindow: () => calls.push("hide"),
      getWindowVisibility: () => nativeVisible,
      stop() {},
      closeService() {},
      destroyTray() {},
      quitApp() {},
      onState: (state) => broadcasts.push(state),
    },
    "window",
  );
  controller.show();
  assert.equal(controller.snapshot().windowVisible, false);
  assert.equal(broadcasts.at(-1)?.windowVisible, false);
  nativeVisible = true;
  assert.equal(controller.snapshot().windowVisible, true);
  controller.hide();
  assert.equal(controller.snapshot().windowVisible, true);
  assert.equal(broadcasts.at(-1)?.windowVisible, true);
  assert.deepEqual(calls, ["show", "hide"]);
});

test("native review cannot unexpectedly reveal a background dashboard", () => {
  const { controller, calls } = fixture();
  controller.setTrayAvailable(true);
  controller.setBackgroundMode(true);
  controller.restoreAfterReview(true);
  assert.deepEqual(calls, ["hide", "hide"]);
  controller.setBackgroundMode(false);
  controller.restoreAfterReview(false);
  assert.deepEqual(calls, ["hide", "hide", "show"]);
  controller.restoreAfterReview(true);
  assert.equal(calls.at(-1), "show");
  controller.beginQuit();
  const length = calls.length;
  controller.restoreAfterReview(true);
  assert.equal(calls.length, length);
});

test("tray loss and service failure reveal existing error state without restarting work", () => {
  const { controller, calls } = fixture();
  controller.setTrayAvailable(true);
  controller.setBackgroundMode(true);
  controller.setTrayAvailable(false);
  assert.equal(controller.snapshot().backgroundMode, false);
  assert.equal(controller.snapshot().windowVisible, true);
  controller.serviceFailed();
  assert.deepEqual(calls, ["hide", "show", "show"]);
});

test("cleanup failure cannot skip service shutdown or cause a second quit", () => {
  const calls: string[] = [];
  const controller = new DesktopBackgroundController(
    {
      showWindow() {},
      hideWindow() {},
      stop() {
        calls.push("stop");
        throw new Error("fixture");
      },
      closeService() {
        calls.push("close-service");
      },
      destroyTray() {
        calls.push("destroy-tray");
      },
      quitApp() {
        calls.push("quit");
      },
      onState() {},
      onCleanupError() {
        calls.push("cleanup-error");
      },
    },
    "window",
  );
  controller.quit();
  controller.quit();
  assert.deepEqual(calls, [
    "stop",
    "cleanup-error",
    "close-service",
    "destroy-tray",
    "quit",
  ]);
});

for (const fault of ["state", "error-report"] as const) {
  test(`shutdown continues when the ${fault} callback throws`, () => {
    const calls: string[] = [];
    const controller = new DesktopBackgroundController(
      {
        showWindow() {},
        hideWindow() {},
        stop() {
          calls.push("stop");
          if (fault === "error-report")
            throw new Error("Synthetic cleanup failure");
        },
        closeService() {
          calls.push("close-service");
        },
        destroyTray() {
          calls.push("destroy-tray");
        },
        quitApp() {
          calls.push("quit");
        },
        onState() {
          if (fault === "state")
            throw new Error("Synthetic state notification failure");
        },
        onCleanupError() {
          throw new Error("Synthetic error reporter failure");
        },
      },
      "window",
    );
    assert.doesNotThrow(() => controller.quit());
    assert.deepEqual(calls, ["stop", "close-service", "destroy-tray", "quit"]);
  });
}

function serviceFixture() {
  const worker = Object.assign(new EventEmitter(), {
    connected: true,
    kill: () => true,
    send: (_message: unknown, callback: (error?: Error) => void) => callback(),
  });
  const states: unknown[] = [];
  const crashes: string[] = [];
  const client = new ServiceClient(
    (state) => states.push(state),
    (message) => crashes.push(message),
    (() => worker as unknown as ChildProcess) as typeof fork,
  );
  client.start("synthetic-service-fixture");
  return { client, worker, states, crashes };
}

for (const end of ["close", "crash"] as const) {
  test(`late service state cannot revive a session after ${end}`, () => {
    const { client, worker, states, crashes } = serviceFixture();
    if (end === "close") client.close();
    else worker.emit("error", new Error("Synthetic service failure"));
    worker.emit("message", { type: "state", state: initialSnapshot() });
    assert.deepEqual(states, []);
    assert.equal(crashes.length, end === "crash" ? 1 : 0);
  });
}

test("synchronous IPC send failures do not leak queue slots or raw errors", async () => {
  const { client, worker } = serviceFixture();
  worker.send = () => {
    throw new Error("private-sensitive-fixture");
  };
  try {
    for (let count = 0; count < 65; count++) {
      await assert.rejects(
        client.request({ type: "state.get" }),
        /Unable to send service request/,
      );
    }
    assert.equal(Reflect.get(client, "pending").size, 0);
  } finally {
    client.close();
  }
});

test("service start cannot replace a running or closed worker", () => {
  const { client } = serviceFixture();
  assert.throws(
    () => client.start("replacement-fixture"),
    /already started or closed/,
  );
  client.close();
  assert.throws(
    () => client.start("replacement-fixture"),
    /already started or closed/,
  );
});
