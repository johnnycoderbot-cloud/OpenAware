import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DOCK_GAP,
  MAIN_DOCK_TREE,
  measureDock,
  minimumDock,
  paneIds,
  type DockNode,
} from "../apps/desktop/renderer/dock-layout";
import { buildWorkspaceLayout } from "../apps/desktop/renderer/workspace-layout";

const tools = ["assistant", "actions", "activity"];
const source = (id: string, kind = "monitor") => ({ id, kind });
const nodes = (tree: DockNode): DockNode[] =>
  tree.kind === "pane"
    ? [tree]
    : [tree, ...nodes(tree.first), ...nodes(tree.second)];

function columns(tree: DockNode) {
  assert.equal(tree.kind, "split");
  assert.ok(tree.kind === "split");
  assert.equal(tree.id, "main-columns");
  assert.equal(tree.axis, "horizontal");
  assert.equal(tree.ratio, 0.68);
  return tree;
}

test("an empty workspace has one placeholder and the existing tool sidebar", () => {
  const tree = columns(buildWorkspaceLayout([]));
  assert.deepEqual(tree.first, { kind: "pane", id: "workspace" });
  assert.ok(MAIN_DOCK_TREE.kind === "split");
  assert.deepEqual(tree.second, MAIN_DOCK_TREE.second);
  assert.deepEqual(paneIds(tree), ["workspace", ...tools]);
});

test("one monitor directly replaces the workspace placeholder", () => {
  const tree = columns(buildWorkspaceLayout([source("monitor-a")]));
  assert.deepEqual(tree.first, { kind: "pane", id: "monitor-a" });
  assert.deepEqual(paneIds(tree), ["monitor-a", ...tools]);
});

test("two monitors start side by side in equally sized direct dashboard panes", () => {
  const tree = columns(
    buildWorkspaceLayout([source("monitor-a"), source("monitor-b")]),
  );
  assert.ok(tree.first.kind === "split");
  assert.equal(tree.first.axis, "horizontal");
  assert.equal(tree.first.ratio, 0.5);
  assert.deepEqual(paneIds(tree.first), ["monitor-a", "monitor-b"]);
  const { panes } = measureDock(tree, {
    x: 0,
    y: 0,
    width: 1440,
    height: 900,
  });
  assert.equal(panes["monitor-a"]!.y, panes["monitor-b"]!.y);
  assert.equal(panes["monitor-a"]!.height, panes["monitor-b"]!.height);
  assert.ok(
    Math.abs(panes["monitor-a"]!.width - panes["monitor-b"]!.width) <= 1,
  );
  assert.equal(
    panes["monitor-b"]!.x,
    panes["monitor-a"]!.x + panes["monitor-a"]!.width + DOCK_GAP,
  );
});

for (const count of [3, 4]) {
  test(`${count} desktop sources default to at most two readable columns`, () => {
    const sources = Array.from({ length: count }, (_, index) =>
      source(`monitor-${index + 1}`),
    );
    const tree = columns(buildWorkspaceLayout(sources));
    assert.ok(tree.first.kind === "split");
    assert.equal(tree.first.axis, "vertical");
    assert.equal(tree.first.ratio, 0.5);
    assert.deepEqual(paneIds(tree.first.first), ["monitor-1", "monitor-2"]);
    assert.deepEqual(
      paneIds(tree.first.second),
      sources.slice(2).map((item) => item.id),
    );
    const minimums = Object.fromEntries([
      ...sources.map((item) => [item.id, { width: 260, height: 285 }]),
      ["assistant", { width: 300, height: 240 }],
      ["actions", { width: 260, height: 88 }],
      ["activity", { width: 260, height: 100 }],
    ]);
    assert.deepEqual(minimumDock(tree, minimums), {
      width: 260 * 2 + DOCK_GAP + 300 + DOCK_GAP,
      height: 285 * 2 + DOCK_GAP,
    });
    const { panes } = measureDock(
      tree,
      { x: 0, y: 0, width: 1004, height: 680 },
      minimums,
    );
    assert.equal(panes["monitor-1"]!.y, panes["monitor-2"]!.y);
    assert.ok(panes["monitor-2"]!.x > panes["monitor-1"]!.x);
    for (const item of sources) {
      assert.ok(panes[item.id]!.width >= 260);
      assert.ok(panes[item.id]!.height >= 285);
    }
    assert.equal(panes["monitor-3"]!.x, panes["monitor-1"]!.x);
    assert.ok(
      panes["monitor-3"]!.y >=
        panes["monitor-1"]!.y + panes["monitor-1"]!.height + DOCK_GAP,
    );
    if (count === 4) {
      assert.equal(panes["monitor-3"]!.y, panes["monitor-4"]!.y);
      assert.ok(panes["monitor-4"]!.x > panes["monitor-3"]!.x);
      assert.equal(panes["monitor-1"]!.width, panes["monitor-3"]!.width);
      assert.equal(panes["monitor-2"]!.width, panes["monitor-4"]!.width);
    } else {
      assert.equal(
        panes["monitor-3"]!.width,
        panes["monitor-1"]!.width + DOCK_GAP + panes["monitor-2"]!.width,
      );
    }
  });
}

test("camera and OBS panes form a lower row beneath desktop panes", () => {
  const tree = columns(
    buildWorkspaceLayout([
      source("camera-a", "camera"),
      source("monitor-a"),
      source("camera-b", "virtual_camera"),
      source("window-a", "window"),
    ]),
  );
  assert.ok(tree.first.kind === "split");
  assert.equal(tree.first.axis, "vertical");
  assert.deepEqual(paneIds(tree.first.first), ["monitor-a", "window-a"]);
  assert.deepEqual(paneIds(tree.first.second), ["camera-a", "camera-b"]);
  for (const row of [tree.first.first, tree.first.second]) {
    assert.ok(row.kind === "split");
    assert.equal(row.axis, "horizontal");
  }
  const { panes } = measureDock(tree, {
    x: 0,
    y: 0,
    width: 1440,
    height: 900,
  });
  for (const desktop of ["monitor-a", "window-a"])
    for (const camera of ["camera-a", "camera-b"])
      assert.ok(
        panes[camera]!.y >=
          panes[desktop]!.y + panes[desktop]!.height + DOCK_GAP,
      );
});

test("camera-only workspaces need no desktop placeholder or empty camera pane", () => {
  for (const sources of [
    [source("camera-a", "camera")],
    [source("camera-a", "camera"), source("camera-b", "virtual_camera")],
  ]) {
    const tree = columns(buildWorkspaceLayout(sources));
    assert.deepEqual(paneIds(tree), [
      ...sources.map((item) => item.id),
      ...tools,
    ]);
    if (sources.length === 1) assert.equal(tree.first.kind, "pane");
    else {
      assert.ok(tree.first.kind === "split");
      assert.equal(tree.first.axis, "horizontal");
    }
  }
});

test("demo, monitor and window sources retain order and never add a camera leaf", () => {
  const sources = [
    source("demo-a", "demo"),
    source("monitor-a"),
    source("window-a", "window"),
  ];
  const tree = columns(buildWorkspaceLayout(sources));
  assert.deepEqual(paneIds(tree), [
    ...sources.map((item) => item.id),
    ...tools,
  ]);
  assert.ok(tree.first.kind === "split");
  assert.equal(tree.first.axis, "vertical");
  assert.deepEqual(paneIds(tree.first.first), ["demo-a", "monitor-a"]);
  assert.deepEqual(tree.first.second, { kind: "pane", id: "window-a" });
});

test("three camera sources also use two columns below their selected desktop", () => {
  const sources = [
    source("camera-a", "camera"),
    source("monitor-a"),
    source("camera-b", "virtual_camera"),
    source("camera-c", "camera"),
  ];
  const tree = columns(buildWorkspaceLayout(sources));
  assert.ok(tree.first.kind === "split");
  assert.equal(tree.first.axis, "vertical");
  assert.deepEqual(tree.first.first, { kind: "pane", id: "monitor-a" });
  const cameraGroup = tree.first.second;
  assert.ok(cameraGroup.kind === "split");
  assert.equal(cameraGroup.axis, "vertical");
  assert.deepEqual(paneIds(cameraGroup.first), ["camera-a", "camera-b"]);
  assert.deepEqual(cameraGroup.second, { kind: "pane", id: "camera-c" });
  const { panes } = measureDock(tree, {
    x: 0,
    y: 0,
    width: 1440,
    height: 1200,
  });
  for (const id of ["camera-a", "camera-b", "camera-c"])
    assert.ok(
      panes[id]!.y >=
        panes["monitor-a"]!.y + panes["monitor-a"]!.height + DOCK_GAP,
    );
  assert.equal(panes["camera-a"]!.y, panes["camera-b"]!.y);
  assert.ok(panes["camera-c"]!.y > panes["camera-a"]!.y);
});

test("split IDs are globally unique even when sources resemble divider IDs", () => {
  const sources = [
    source("workspace-desktops-2"),
    source("main-assistant"),
    source("workspace-cameras-2", "camera"),
    source("main-feeds", "virtual_camera"),
  ];
  const tree = buildWorkspaceLayout(sources);
  const ids = nodes(tree).map((node) => node.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(paneIds(tree), [
    ...sources.map((item) => item.id),
    ...tools,
  ]);
  assert.equal(new Set(paneIds(tree)).size, sources.length + tools.length);
  const grid = buildWorkspaceLayout([
    source("workspace-desktops-row-1-2"),
    source("main-assistant"),
    source("workspace-desktops-rows-2"),
    source("main-activity"),
  ]);
  const gridIds = nodes(grid).map((node) => node.id);
  assert.equal(new Set(gridIds).size, gridIds.length);
});

test("source additions keep surviving source leaf IDs without mutating inputs", () => {
  const sources = [source("monitor-a"), source("camera-a", "camera")];
  const before = structuredClone(sources);
  const first = buildWorkspaceLayout(sources);
  const added = buildWorkspaceLayout([...sources, source("monitor-b")]);
  const removed = buildWorkspaceLayout([sources[1]!]);
  assert.deepEqual(sources, before);
  assert.deepEqual(paneIds(first), ["monitor-a", "camera-a", ...tools]);
  assert.deepEqual(paneIds(added), [
    "monitor-a",
    "monitor-b",
    "camera-a",
    ...tools,
  ]);
  assert.deepEqual(paneIds(removed), ["camera-a", ...tools]);
});

test("mixed workspace geometry respects full source and sidebar minima", () => {
  const sources = [
    source("monitor-a"),
    source("monitor-b"),
    source("camera-a", "camera"),
    source("camera-b", "virtual_camera"),
  ];
  const tree = buildWorkspaceLayout(sources);
  const minimums = {
    "monitor-a": { width: 260, height: 285 },
    "monitor-b": { width: 260, height: 285 },
    "camera-a": { width: 260, height: 220 },
    "camera-b": { width: 260, height: 220 },
    assistant: { width: 300, height: 240 },
    actions: { width: 260, height: 88 },
    activity: { width: 260, height: 100 },
  };
  const minimum = minimumDock(tree, minimums);
  assert.deepEqual(minimum, {
    width: 260 * 2 + DOCK_GAP + 300 + DOCK_GAP,
    height: 285 + DOCK_GAP + 220,
  });
  const { panes, dividers } = measureDock(
    tree,
    { x: 3, y: 7, ...minimum },
    minimums,
  );
  for (const [id, size] of Object.entries(minimums)) {
    assert.ok(
      panes[id]!.width >= size.width,
      `${id} retains its minimum width`,
    );
    assert.ok(
      panes[id]!.height >= size.height,
      `${id} retains its minimum height`,
    );
  }
  assert.equal(dividers.length, sources.length + tools.length - 1);
});

test("duplicate and reserved source IDs fail before producing ambiguous panes", () => {
  assert.throws(
    () => buildWorkspaceLayout([source("same"), source("same", "camera")]),
    /unique/,
  );
  for (const id of ["", "workspace", ...tools, "main-columns"])
    assert.throws(() => buildWorkspaceLayout([source(id)]), /reserved/);
});
