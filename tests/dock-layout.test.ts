import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DOCK_GAP,
  MAIN_DOCK_TREE,
  buildPaneTree,
  dockPane,
  measureDock,
  minimumDock,
  nearestDockSide,
  paneIds,
  reconcilePanes,
  setSplitRatio,
  type DockNode,
  type DockRect,
  type DockSide,
  type PaneMinimum,
} from "../apps/desktop/renderer/dock-layout";

const sides: DockSide[] = ["left", "right", "top", "bottom"];
const mainIds = ["workspace", "cameras", "assistant", "actions", "activity"];
const mainMinimums: Record<string, PaneMinimum> = {
  workspace: { width: 320, height: 200 },
  cameras: { width: 260, height: 110 },
  assistant: { width: 300, height: 240 },
  actions: { width: 260, height: 120 },
  activity: { width: 260, height: 100 },
};

function find(tree: DockNode, id: string): DockNode | undefined {
  if (tree.id === id) return tree;
  if (tree.kind === "pane") return undefined;
  return find(tree.first, id) || find(tree.second, id);
}

function allNodes(tree: DockNode): DockNode[] {
  return tree.kind === "pane"
    ? [tree]
    : [tree, ...allNodes(tree.first), ...allNodes(tree.second)];
}

function assertIds(tree: DockNode, expected: string[]) {
  const actual = paneIds(tree);
  assert.equal(new Set(actual).size, actual.length, "Every pane appears once");
  assert.deepEqual([...actual].sort(), [...expected].sort());
}

function assertGeometry(tree: DockNode, bounds: DockRect, minimums = {}) {
  const measured = measureDock(tree, bounds, minimums);
  assert.deepEqual(Object.keys(measured.panes).sort(), paneIds(tree).sort());
  const regions = [...Object.values(measured.panes), ...measured.dividers];
  for (const region of regions) {
    for (const value of [region.x, region.y, region.width, region.height])
      assert.ok(Number.isFinite(value), "Geometry remains finite");
    assert.ok(
      region.width >= 0 && region.height >= 0,
      "Dimensions cannot become negative",
    );
    assert.ok(region.x >= bounds.x - 1e-8 && region.y >= bounds.y - 1e-8);
    assert.ok(region.x + region.width <= bounds.x + bounds.width + 1e-8);
    assert.ok(region.y + region.height <= bounds.y + bounds.height + 1e-8);
  }
  for (let i = 0; i < regions.length; i++) {
    for (const b of regions.slice(i + 1)) {
      const a = regions[i]!;
      const overlapWidth =
        Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapHeight =
        Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      assert.ok(
        overlapWidth <= 1e-8 || overlapHeight <= 1e-8,
        "Panes and dividers do not overlap",
      );
    }
  }
  for (const divider of measured.dividers) {
    assert.ok(
      divider.ratio >= divider.minRatio && divider.ratio <= divider.maxRatio,
    );
    assert.ok(divider.minRatio >= 0 && divider.maxRatio <= 1);
  }
  return measured;
}

test("main dashboard starts with all five pane identities exactly once", () => {
  assertIds(MAIN_DOCK_TREE, mainIds);
  const result = assertGeometry(
    MAIN_DOCK_TREE,
    { x: 17, y: 23, width: 1440, height: 900 },
    mainMinimums,
  );
  assert.equal(result.dividers.length, 4);
});

test("docking every dashboard pane on every side preserves identities and placement", () => {
  const original = JSON.stringify(MAIN_DOCK_TREE);
  for (const moving of mainIds) {
    for (const target of mainIds.filter((id) => id !== moving)) {
      for (const side of sides) {
        const tree = dockPane(
          MAIN_DOCK_TREE,
          moving,
          target,
          side,
          "new-divider",
        );
        assertIds(tree, mainIds);
        const inserted = find(tree, "new-divider");
        assert.ok(inserted && inserted.kind === "split");
        assert.equal(
          inserted.axis,
          side === "left" || side === "right" ? "horizontal" : "vertical",
        );
        assert.deepEqual(
          paneIds(inserted),
          side === "left" || side === "top"
            ? [moving, target]
            : [target, moving],
        );
        assertGeometry(
          tree,
          { x: 0, y: 0, width: 1440, height: 900 },
          mainMinimums,
        );
      }
    }
  }
  assert.equal(
    JSON.stringify(MAIN_DOCK_TREE),
    original,
    "Docking does not mutate the default layout",
  );
});

test("self docking and unknown panes leave the same tree untouched", () => {
  for (const side of sides) {
    assert.equal(
      dockPane(MAIN_DOCK_TREE, "workspace", "workspace", side, "unused"),
      MAIN_DOCK_TREE,
    );
    assert.equal(
      dockPane(MAIN_DOCK_TREE, "unknown", "workspace", side, "unused"),
      MAIN_DOCK_TREE,
    );
    assert.equal(
      dockPane(MAIN_DOCK_TREE, "workspace", "unknown", side, "unused"),
      MAIN_DOCK_TREE,
    );
  }
});

test("two through four feed panes can repeatedly dock without losing another feed", () => {
  for (const count of [2, 3, 4]) {
    const ids = Array.from({ length: count }, (_, i) => `feed-${i + 1}`);
    for (const axis of ["horizontal", "vertical"] as const) {
      let tree = buildPaneTree(ids, axis, "feed");
      for (const [index, side] of sides.entries()) {
        tree = dockPane(
          tree,
          ids[index % count]!,
          ids[(index + 1) % count]!,
          side,
          `moved-${index}`,
        );
        assertIds(tree, ids);
        assertGeometry(tree, { x: 11, y: 19, width: 1080, height: 800 });
      }
    }
  }
});

test("building a feed tree reserves pane IDs before allocating divider IDs", () => {
  for (const ids of [
    ["feed-1", "feed-2"],
    ["feed-3", "feed-3-1", "feed-2"],
  ]) {
    const tree = buildPaneTree(ids, "horizontal", "feed");
    const nodeIds = allNodes(tree).map((node) => node.id);
    assert.equal(new Set(nodeIds).size, nodeIds.length);
    assertIds(tree, ids);
    assertGeometry(tree, { x: 0, y: 0, width: 1440, height: 900 });
  }
  assert.throws(
    () => buildPaneTree(["duplicate", "duplicate"], "horizontal", "feeds"),
    /unique/,
  );
});

test("mixed three and four feed layouts reserve enough height for every full preview", () => {
  for (const count of [3, 4]) {
    const right = buildPaneTree(
      count === 3 ? ["b", "c"] : ["b", "c", "d"],
      "vertical",
      "stack",
    );
    const tree: DockNode = {
      kind: "split",
      id: "columns",
      axis: "horizontal",
      ratio: 0.7,
      first: { kind: "pane", id: "a" },
      second: right,
    };
    // The four-feed case specifically covers a | ((b / c) / d), whose
    // nested vertical height must be counted through the horizontal root.
    if (count === 4) {
      tree.second = {
        kind: "split",
        id: "stack-d",
        axis: "vertical",
        ratio: 0.35,
        first: buildPaneTree(["b", "c"], "vertical", "stack-bc"),
        second: { kind: "pane", id: "d" },
      };
    }
    const minimums = Object.fromEntries(
      paneIds(tree).map((id) => [id, { width: 260, height: 285 }]),
    );
    const minimum = minimumDock(tree, minimums);
    assert.deepEqual(minimum, {
      width: 260 * 2 + DOCK_GAP,
      height: 285 * (count - 1) + DOCK_GAP * (count - 2),
    });
    const { panes } = assertGeometry(
      tree,
      { x: 9, y: 17, ...minimum },
      minimums,
    );
    for (const rect of Object.values(panes)) {
      assert.ok(
        rect.height >= 285,
        "A full preview cannot become a tiny stacked row",
      );
      assert.ok(rect.width >= 260, "Every preview retains its minimum width");
    }
  }
});

test("source reconciliation retains surviving pane leaves and existing split ratios", () => {
  const original = setSplitRatio(
    buildPaneTree(["a", "b", "c"], "horizontal", "feeds"),
    "feeds-3",
    0.42,
  );
  const a = find(original, "a");
  const c = find(original, "c");
  const tree = reconcilePanes(original, ["a", "c", "d"], "feed-added");
  assertIds(tree, ["a", "c", "d"]);
  assert.equal(find(tree, "a"), a);
  assert.equal(find(tree, "c"), c);
  const retainedSplit = find(tree, "feeds-3");
  assert.ok(retainedSplit && retainedSplit.kind === "split");
  assert.equal(retainedSplit.ratio, 0.42);
  assert.equal(reconcilePanes(tree, ["a", "c", "d"], "same"), tree);
  assertIds(original, ["a", "b", "c"]);
});

test("horizontal source insertion preserves a camera columns preset and its surviving panes", () => {
  const original = setSplitRatio(
    buildPaneTree(["camera-a", "camera-b"], "horizontal", "columns"),
    "columns-2",
    0.37,
  );
  const tree = reconcilePanes(
    original,
    ["camera-a", "camera-b", "camera-c", "camera-d"],
    "added-camera",
    "horizontal",
  );
  assertIds(tree, ["camera-a", "camera-b", "camera-c", "camera-d"]);
  assert.equal(find(tree, "camera-a"), find(original, "camera-a"));
  assert.equal(find(tree, "camera-b"), find(original, "camera-b"));
  const retained = find(tree, "columns-2");
  assert.ok(retained && retained.kind === "split");
  assert.equal(retained.ratio, 0.37);
  for (const node of allNodes(tree)) {
    if (node.kind === "split") assert.equal(node.axis, "horizontal");
  }
  const { panes } = assertGeometry(tree, {
    x: 0,
    y: 0,
    width: 1440,
    height: 500,
  });
  for (const rect of Object.values(panes)) {
    assert.equal(rect.y, 0);
    assert.equal(
      rect.height,
      500,
      "Adding a camera keeps the columns layout full height",
    );
  }
  const replacement = reconcilePanes(
    tree,
    ["replacement-a", "replacement-b"],
    "replacement-camera",
    "horizontal",
  );
  assertIds(replacement, ["replacement-a", "replacement-b"]);
  assert.ok(replacement.kind === "split");
  assert.equal(
    replacement.axis,
    "horizontal",
    "Replacing every camera also retains the selected columns preset",
  );
  const defaultInsertion = reconcilePanes(
    original,
    ["camera-a", "camera-b", "camera-c"],
    "default-camera",
  );
  assert.ok(defaultInsertion.kind === "split");
  assert.equal(
    defaultInsertion.axis,
    "vertical",
    "Existing callers retain vertical insertion by default",
  );
  assertIds(original, ["camera-a", "camera-b"]);
});

test("reconciliation replaces all removed feeds and handles a single survivor", () => {
  const tree = buildPaneTree(["a", "b", "c"], "horizontal", "old");
  const survivor = reconcilePanes(tree, ["b"], "single");
  assert.equal(survivor, find(tree, "b"));
  const replacement = reconcilePanes(tree, ["x", "y"], "replacement");
  assertIds(replacement, ["x", "y"]);
  assertGeometry(replacement, { x: 0, y: 0, width: 900, height: 650 });
  assert.throws(() => reconcilePanes(tree, [], "empty"), /at least one pane/);
  assert.throws(
    () => buildPaneTree([], "horizontal", "empty"),
    /at least one pane/,
  );
});

test("moving, removing, and readding a source gives each divider a unique resize target", () => {
  let tree = buildPaneTree(["a", "b"], "horizontal", "feeds");
  tree = reconcilePanes(tree, ["a", "b", "d"], "feed-added");
  tree = dockPane(tree, "a", "d", "right", "move-1");
  tree = dockPane(tree, "d", "b", "left", "move-2");
  tree = reconcilePanes(tree, ["a", "b"], "feed-added");
  const survivingDivider = find(tree, "feed-added-d");
  assert.ok(survivingDivider && survivingDivider.kind === "split");
  tree = reconcilePanes(tree, ["a", "b", "d"], "feed-added");
  assertIds(tree, ["a", "b", "d"]);
  const ids = allNodes(tree).map((node) => node.id);
  assert.equal(
    new Set(ids).size,
    ids.length,
    "Reusing a source ID cannot duplicate a divider ID",
  );
  assert.ok(tree.kind === "split");
  assert.notEqual(tree.id, survivingDivider.id);
  const resized = setSplitRatio(tree, tree.id, 0.73);
  assert.ok(resized.kind === "split");
  assert.equal(resized.ratio, 0.73);
  const untouched = find(resized, survivingDivider.id);
  assert.ok(untouched && untouched.kind === "split");
  assert.equal(
    untouched.ratio,
    survivingDivider.ratio,
    "Resizing the new divider leaves the old divider unchanged",
  );
  const measured = assertGeometry(resized, {
    x: 0,
    y: 0,
    width: 1440,
    height: 900,
  });
  assert.equal(
    new Set(measured.dividers.map((divider) => divider.id)).size,
    measured.dividers.length,
  );
});

test("a requested dock divider ID cannot collide with an existing pane or divider", () => {
  for (const requested of ["main-assistant", "camera-unused", "cameras"]) {
    const tree = dockPane(
      MAIN_DOCK_TREE,
      "workspace",
      "actions",
      "right",
      requested,
    );
    const nodes = allNodes(tree);
    assert.equal(new Set(nodes.map((node) => node.id)).size, nodes.length);
    const inserted = nodes.find(
      (node) =>
        node.kind === "split" &&
        paneIds(node).length === 2 &&
        paneIds(node).includes("workspace") &&
        paneIds(node).includes("actions"),
    );
    assert.ok(inserted && inserted.kind === "split");
    if (requested !== "camera-unused") assert.notEqual(inserted.id, requested);
    const resized = setSplitRatio(tree, inserted.id, 0.35);
    const existing = find(resized, "main-assistant");
    assert.ok(existing && existing.kind === "split");
    assert.equal(
      existing.ratio,
      0.63,
      "Only the new divider responds to its resize target",
    );
    assertIds(resized, mainIds);
  }
});

test("split resizing changes the chosen divider and clamps extreme finite ratios", () => {
  const original = JSON.stringify(MAIN_DOCK_TREE);
  const changed = setSplitRatio(MAIN_DOCK_TREE, "main-columns", 0.4);
  const measured = measureDock(
    changed,
    { x: 0, y: 0, width: 1440, height: 900 },
    mainMinimums,
  );
  assert.equal(measured.dividers[0]!.ratio, 0.4);
  assert.equal(
    measured.panes.workspace!.width,
    Math.round((1440 - DOCK_GAP) * 0.4),
  );
  const retained = find(changed, "main-assistant");
  assert.ok(retained && retained.kind === "split");
  assert.equal(retained.ratio, 0.63);
  const lowTree = setSplitRatio(changed, "main-columns", -200);
  const lowSplit = find(lowTree, "main-columns");
  assert.ok(lowSplit && lowSplit.kind === "split");
  assert.equal(lowSplit.ratio, 0.05);
  const low = measureDock(lowTree, { x: 0, y: 0, width: 1440, height: 900 });
  assert.equal(low.dividers[0]!.ratio, low.dividers[0]!.minRatio);
  const highTree = setSplitRatio(changed, "main-columns", 200);
  const highSplit = find(highTree, "main-columns");
  assert.ok(highSplit && highSplit.kind === "split");
  assert.equal(highSplit.ratio, 0.95);
  const high = measureDock(highTree, { x: 0, y: 0, width: 1440, height: 900 });
  assert.equal(high.dividers[0]!.ratio, high.dividers[0]!.maxRatio);
  assert.equal(setSplitRatio(changed, "main-columns", Number.NaN), changed);
  assert.equal(setSplitRatio(changed, "main-columns", Infinity), changed);
  assert.equal(JSON.stringify(MAIN_DOCK_TREE), original);
});

test("minimum dimensions constrain resizing when there is enough available space", () => {
  for (const axis of ["horizontal", "vertical"] as const) {
    const tree = buildPaneTree(["a", "b"], axis, "limits");
    const minimums = {
      a: { width: 300, height: 220 },
      b: { width: 200, height: 180 },
    };
    for (const ratio of [0.001, 0.5, 0.999]) {
      const { panes } = assertGeometry(
        setSplitRatio(tree, "limits-2", ratio),
        { x: 3, y: 4, width: 1000, height: 700 },
        minimums,
      );
      assert.ok(panes.a!.width >= 300 && panes.a!.height >= 220);
      assert.ok(panes.b!.width >= 200 && panes.b!.height >= 180);
    }
  }
});

test("tiny and fractional viewports retain finite nonnegative geometry inside the container", () => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [8, 8],
    [8.99, 9.01],
    [35, 29],
    [310, 240],
  ]) {
    assertGeometry(
      MAIN_DOCK_TREE,
      { x: 2.5, y: 7.5, width: width!, height: height! },
      mainMinimums,
    );
    for (const count of [2, 3, 4]) {
      const tree = buildPaneTree(
        Array.from({ length: count }, (_, i) => `feed-${i}`),
        "vertical",
        "tiny",
      );
      assertGeometry(tree, { x: 0, y: 0, width: width!, height: height! });
    }
  }
});

test("drop edge selection uses pane geometry at each of the four sides", () => {
  const rect = { x: 40, y: 70, width: 600, height: 400 };
  assert.equal(nearestDockSide(rect, 41, 270), "left");
  assert.equal(nearestDockSide(rect, 639, 270), "right");
  assert.equal(nearestDockSide(rect, 340, 71), "top");
  assert.equal(nearestDockSide(rect, 340, 469), "bottom");
  assert.ok(
    sides.includes(nearestDockSide({ x: 0, y: 0, width: 0, height: 0 }, 0, 0)),
  );
});
