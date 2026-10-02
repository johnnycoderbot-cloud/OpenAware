import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  ActionBroker,
  automationPlanSchema,
  normalizedPoint,
  planDigest,
  type ActionDependencies,
  type Inspection,
} from "../packages/actions/src/index";
import type {
  AutomationPlan,
  AutomationStep,
} from "../packages/contracts/src/index";
import { DisplayCaptureGrant } from "../apps/desktop/main/capture-grant";

const timestamp = 1_800_000_000_000;
const click: AutomationStep = {
  type: "click",
  x: 0.5,
  y: 0.5,
  description: "Focus the text editor",
};
function plan(steps: AutomationStep[] = [click]): AutomationPlan {
  return {
    id: randomUUID(),
    sourceId: randomUUID(),
    sourceRevision: 1,
    capturedAt: timestamp - 100,
    createdAt: timestamp,
    expiresAt: timestamp + 30_000,
    goal: "Write a note",
    modelId: "vision-local",
    steps,
  };
}
function fixture(input: AutomationPlan) {
  let now = timestamp;
  let monotonic = 0;
  let effects = 0;
  let inspections = 0;
  const inspection = (): Inspection => ({
    acquiredAt: now,
    sourceId: input.sourceId,
    sourceRevision: input.sourceRevision,
    planDigest: planDigest(input),
    modelId: input.modelId,
    epoch: 1,
    displayId: "1",
    geometry: "1920x1080:100%",
    contentDigest: "unchanged",
    targetWindow: "123",
    targetTitle: "Editor",
    point: { x: 500, y: 500 },
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  });
  const dependencies: ActionDependencies = {
    now: () => now,
    monotonicNow: () => monotonic,
    inspect: async () => {
      inspections++;
      return inspection();
    },
    approve: async () => true,
    effect: async () => {
      effects++;
    },
  };
  return {
    dependencies,
    inspection,
    setNow: (value: number) => {
      now = value;
    },
    setMonotonic: (value: number) => {
      monotonic = value;
    },
    effects: () => effects,
    inspections: () => inspections,
  };
}

test("native approval grants one exact operation and plan cannot replay", async () => {
  const input = plan();
  const fake = fixture(input);
  const broker = new ActionBroker(fake.dependencies);
  assert.equal((await broker.execute(input))[0].status, "succeeded");
  assert.equal(fake.effects(), 1);
  assert.equal(fake.inspections(), 2);
  await assert.rejects(() => broker.execute(input), /already been reviewed/);
  assert.equal(fake.effects(), 1);
});
test("declining native review cancels remaining steps without an effect", async () => {
  const input = plan([
    click,
    { type: "type", text: "Hello", description: "Write greeting" },
  ]);
  const fake = fixture(input);
  fake.dependencies.approve = async () => false;
  assert.equal(
    (await new ActionBroker(fake.dependencies).execute(input))[0].status,
    "cancelled",
  );
  assert.equal(fake.effects(), 0);
});
test("stop during native approval revokes even a positive answer", async () => {
  const input = plan();
  const fake = fixture(input);
  const broker = new ActionBroker(fake.dependencies);
  fake.dependencies.approve = async () => {
    broker.revoke();
    return true;
  };
  assert.match((await broker.execute(input))[0].message, /revoked/);
  assert.equal(fake.effects(), 0);
});
test("plan expiry during review denies input", async () => {
  const input = plan();
  const fake = fixture(input);
  fake.dependencies.approve = async () => {
    fake.setNow(input.expiresAt);
    return true;
  };
  assert.match(
    (await new ActionBroker(fake.dependencies).execute(input))[0].message,
    /expired/,
  );
  assert.equal(fake.effects(), 0);
});
test("wall clock rollback cannot extend monotonic plan lifetime", async () => {
  const input = plan();
  const fake = fixture(input);
  fake.dependencies.approve = async () => {
    fake.setNow(timestamp + 100);
    fake.setMonotonic(30_001);
    return true;
  };
  assert.match(
    (await new ActionBroker(fake.dependencies).execute(input))[0].message,
    /elapsed lifetime expired/,
  );
  assert.equal(fake.effects(), 0);
});
for (const field of [
  "sourceId",
  "sourceRevision",
  "planDigest",
  "modelId",
  "epoch",
  "displayId",
  "geometry",
  "contentDigest",
  "targetWindow",
  "targetTitle",
] as const) {
  test(`changed ${field} after native approval refuses the action`, async () => {
    const input = plan();
    const fake = fixture(input);
    let count = 0;
    fake.dependencies.inspect = async () => {
      const value = fake.inspection();
      if (++count === 2)
        (value as unknown as Record<string, unknown>)[field] =
          typeof value[field] === "number"
            ? Number(value[field]) + 1
            : "changed";
      return value;
    };
    assert.equal(
      (await new ActionBroker(fake.dependencies).execute(input))[0].status,
      "failed",
    );
    assert.equal(fake.effects(), 0);
  });
}
test("stale inspection cannot reach native input", async () => {
  const input = plan();
  const fake = fixture(input);
  fake.dependencies.inspect = async () => ({
    ...fake.inspection(),
    acquiredAt: timestamp - 2001,
  });
  assert.match(
    (await new ActionBroker(fake.dependencies).execute(input))[0].message,
    /stale/,
  );
  assert.equal(fake.effects(), 0);
});
test("second native inspection cannot outlive its single-use approval", async () => {
  const input = plan();
  const fake = fixture(input);
  let count = 0;
  fake.dependencies.inspect = async () => {
    if (++count === 2) fake.setNow(timestamp + 2001);
    return fake.inspection();
  };
  assert.match(
    (await new ActionBroker(fake.dependencies).execute(input))[0].message,
    /Approval expired/,
  );
  assert.equal(fake.effects(), 0);
});
test("native worker errors are unknown and are never automatically retried", async () => {
  const input = plan([click, click]);
  const fake = fixture(input);
  let calls = 0;
  fake.dependencies.effect = async () => {
    calls++;
    throw new Error("Input may have been sent");
  };
  const results = await new ActionBroker(fake.dependencies).execute(input);
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "unknown");
  assert.equal(calls, 1);
});
test("strict typed actions reject shell, control text, unbounded plans and coordinates", () => {
  for (const step of [
    { type: "shell", text: "calc.exe", description: "Open calculator" },
    { ...click, x: 1.1 },
    { type: "type", text: "hello\ncommand", description: "Type" },
    { type: "key", key: "ALT+F4", description: "Close" },
    { type: "type", text: "x".repeat(1001), description: "Type" },
    { ...click, command: "cmd.exe" },
  ])
    assert.equal(
      automationPlanSchema.safeParse({ ...plan(), steps: [step] }).success,
      false,
    );
  assert.equal(
    automationPlanSchema.safeParse(plan(Array(9).fill(click))).success,
    false,
  );
});
test("monitor-relative click uses display origin and Electron physical coordinate conversion", () => {
  const seen: { x: number; y: number }[] = [];
  assert.deepEqual(
    normalizedPoint(
      { ...click, x: 0, y: 1 },
      { x: -1920, y: 100, width: 1920, height: 1080 },
      (point) => {
        seen.push(point);
        return {
          x: -2880 + Math.round((point.x + 1920) * 1.5),
          y: Math.round(point.y * 1.5),
        };
      },
    ),
    { x: -2880, y: 1769 },
  );
  assert.deepEqual(seen, [{ x: -1920, y: 1179 }]);
  assert.throws(
    () =>
      normalizedPoint(
        click,
        { x: 0, y: 0, width: 0, height: 10 },
        (point) => point,
      ),
    /bounds/,
  );
});

test("display permission can precede the exact one-use source selector", () => {
  let clock = 0;
  const grant = new DisplayCaptureGrant(true, () => clock);
  assert.equal(grant.check("main"), false);
  grant.select("screen:123", "main");
  assert.equal(grant.check("main"), true);
  assert.equal(grant.request("main"), true);
  const ticket = grant.begin("main");
  assert.ok(ticket);
  assert.equal(ticket.id, "screen:123");
  assert.equal(grant.begin("main"), undefined); // Even parallel calls cannot select a second stream.
  assert.equal(grant.complete(ticket, true), true);
  assert.equal(grant.request("main"), false);
  clock = 2000;
  assert.equal(grant.check("main"), false);
});
test("late display permission after selector completion keeps exact frame scope without replay", () => {
  const grant = new DisplayCaptureGrant(true, () => 0);
  grant.select("window:456", "main");
  const ticket = grant.begin("main");
  assert.ok(ticket);
  assert.equal(grant.complete(ticket, true), true);
  assert.equal(grant.check("main"), true);
  assert.equal(grant.request("main"), true);
  assert.equal(grant.check("iframe"), false);
  assert.equal(grant.request("iframe"), false);
  assert.equal(grant.request("main"), false);
  assert.equal(grant.begin("main"), undefined);
});
test("Stop and source replacement revoke in-flight display selections", () => {
  const grant = new DisplayCaptureGrant(true, () => 0);
  grant.select("screen:1", "main");
  const old = grant.begin("main");
  assert.ok(old);
  grant.revoke();
  assert.equal(grant.check("main"), false);
  assert.equal(grant.complete(old, true), false);
  grant.select("screen:2", "main");
  const replaced = grant.begin("main");
  assert.ok(replaced);
  grant.select("screen:3", "main");
  assert.equal(grant.complete(replaced, true), false);
  assert.equal(grant.begin("main")?.id, "screen:3");
});
test("display leases expire and never grant other frames or test-mode capture", () => {
  let clock = 0;
  const grant = new DisplayCaptureGrant(true, () => clock);
  grant.select("screen:1", "main");
  assert.equal(grant.begin("iframe"), undefined);
  assert.equal(grant.request("iframe"), false);
  clock = 15_000;
  assert.equal(grant.request("main"), false);
  assert.equal(grant.begin("main"), undefined);
  const disabled = new DisplayCaptureGrant(false, () => 0);
  assert.throws(
    () => disabled.select("screen:1", "main"),
    /disabled in test mode/,
  );
  assert.equal(disabled.check("main"), false);
  assert.equal(disabled.request("main"), false);
  assert.equal(disabled.begin("main"), undefined);
});
