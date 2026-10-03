import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DOCK_GAP,
  MAIN_DOCK_TREE,
  measureDock,
  minimumDock,
  paneIds,
  type DockNode,
  type PaneMinimum,
} from "../apps/desktop/renderer/dock-layout";
import {
  buildWorkspaceLayout,
  fitWorkspaceLayout,
  sourceAspectRatio,
} from "../apps/desktop/renderer/workspace-layout";

const tools = ["extra", "assistant", "activity"];
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
  assert.ok(tree.first.kind === "split");
  assert.equal(tree.first.axis, "vertical");
  assert.deepEqual(tree.first.second, { kind: "pane", id: "extra" });
  return { ...tree, feeds: tree.first.first };
}

test("an empty workspace has one placeholder and the existing tool sidebar", () => {
  const tree = columns(buildWorkspaceLayout([]));
  assert.deepEqual(tree.feeds, { kind: "pane", id: "workspace" });
  assert.ok(MAIN_DOCK_TREE.kind === "split");
  assert.deepEqual(tree.second, MAIN_DOCK_TREE.second);
  assert.deepEqual(paneIds(tree), ["workspace", ...tools]);
  assert.ok(tree.second.kind === "split");
  assert.equal(tree.second.ratio, 0.75);
  assert.deepEqual(tree.second.first, { kind: "pane", id: "assistant" });
  assert.deepEqual(tree.second.second, { kind: "pane", id: "activity" });
});

test("one monitor directly replaces the workspace placeholder", () => {
  const tree = columns(buildWorkspaceLayout([source("monitor-a")]));
  assert.deepEqual(tree.feeds, { kind: "pane", id: "monitor-a" });
  assert.deepEqual(paneIds(tree), ["monitor-a", ...tools]);
});

test("two monitors start side by side in equally sized direct dashboard panes", () => {
  const tree = columns(
    buildWorkspaceLayout([source("monitor-a"), source("monitor-b")]),
  );
  assert.ok(tree.feeds.kind === "split");
  assert.equal(tree.feeds.axis, "horizontal");
  assert.equal(tree.feeds.ratio, 0.5);
  assert.deepEqual(paneIds(tree.feeds), ["monitor-a", "monitor-b"]);
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
    assert.ok(tree.feeds.kind === "split");
    assert.equal(tree.feeds.axis, "vertical");
    assert.equal(tree.feeds.ratio, 0.5);
    assert.deepEqual(paneIds(tree.feeds.first), ["monitor-1", "monitor-2"]);
    assert.deepEqual(
      paneIds(tree.feeds.second),
      sources.slice(2).map((item) => item.id),
    );
    const minimums = Object.fromEntries([
      ...sources.map((item) => [item.id, { width: 260, height: 285 }]),
      ["assistant", { width: 300, height: 240 }],
      ["activity", { width: 260, height: 100 }],
      ["extra", { width: 260, height: 100 }],
    ]);
    assert.deepEqual(minimumDock(tree, minimums), {
      width: 260 * 2 + DOCK_GAP + 300 + DOCK_GAP,
      height: 285 * 2 + DOCK_GAP * 2 + 100,
    });
    const { panes } = measureDock(
      tree,
      { x: 0, y: 0, width: 1004, height: 720 },
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
  assert.ok(tree.feeds.kind === "split");
  assert.equal(tree.feeds.axis, "vertical");
  assert.deepEqual(paneIds(tree.feeds.first), ["monitor-a", "window-a"]);
  assert.deepEqual(paneIds(tree.feeds.second), ["camera-a", "camera-b"]);
  for (const row of [tree.feeds.first, tree.feeds.second]) {
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
    if (sources.length === 1) assert.equal(tree.feeds.kind, "pane");
    else {
      assert.ok(tree.feeds.kind === "split");
      assert.equal(tree.feeds.axis, "horizontal");
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
  assert.ok(tree.feeds.kind === "split");
  assert.equal(tree.feeds.axis, "vertical");
  assert.deepEqual(paneIds(tree.feeds.first), ["demo-a", "monitor-a"]);
  assert.deepEqual(tree.feeds.second, { kind: "pane", id: "window-a" });
});

test("three camera sources also use two columns below their selected desktop", () => {
  const sources = [
    source("camera-a", "camera"),
    source("monitor-a"),
    source("camera-b", "virtual_camera"),
    source("camera-c", "camera"),
  ];
  const tree = columns(buildWorkspaceLayout(sources));
  assert.ok(tree.feeds.kind === "split");
  assert.equal(tree.feeds.axis, "vertical");
  assert.deepEqual(tree.feeds.first, { kind: "pane", id: "monitor-a" });
  const cameraGroup = tree.feeds.second;
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
    activity: { width: 260, height: 100 },
    extra: { width: 260, height: 100 },
  };
  const minimum = minimumDock(tree, minimums);
  assert.deepEqual(minimum, {
    width: 260 * 2 + DOCK_GAP + 300 + DOCK_GAP,
    height: 285 + DOCK_GAP * 2 + 220 + 100,
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
  assert.deepEqual(paneIds(buildWorkspaceLayout([source("actions")])), [
    "actions",
    ...tools,
  ]);
});

function fitMinimums(sources: { id: string }[]): Record<string, PaneMinimum> {
  return Object.fromEntries([
    ...sources.map((item) => [item.id, { width: 260, height: 200 }]),
    ["extra", { width: 260, height: 100 }],
    ["assistant", { width: 300, height: 240 }],
    ["activity", { width: 260, height: 100 }],
  ]);
}

test("source aspect ratios accept landscape, portrait and ultrawide dimensions and reject invalid dimensions", () => {
  for (const dimensions of [
    { width: 1920, height: 1080 },
    { width: 1080, height: 1920 },
    { width: 5120, height: 1440 },
  ])
    assert.equal(
      sourceAspectRatio(dimensions),
      dimensions.width / dimensions.height,
    );
  for (const dimensions of [
    {},
    { width: 1920 },
    { height: 1080 },
    { width: 0, height: 1080 },
    { width: 1920, height: -1 },
    { width: NaN, height: 1080 },
    { width: 1920, height: Infinity },
    { width: Number.MAX_VALUE, height: Number.MIN_VALUE },
    { width: Number.MIN_VALUE, height: Number.MAX_VALUE },
  ])
    assert.equal(sourceAspectRatio(dimensions), 16 / 9);
});

test("one or two monitors fit their video aspect and leave the lower pane the remaining height", () => {
  for (const count of [1, 2]) {
    const sources = Array.from({ length: count }, (_, index) =>
      source(`monitor-${index}`),
    );
    const minimums = fitMinimums(sources);
    const tree = buildWorkspaceLayout(sources);
    const size = { width: 1440, height: 900 };
    const fitted = fitWorkspaceLayout(tree, sources, size, minimums);
    const { panes } = measureDock(fitted, { x: 0, y: 0, ...size }, minimums);
    for (const item of sources) {
      const pane = panes[item.id]!;
      const expected = (pane.width - 2) / (16 / 9) + 74;
      assert.ok(Math.abs(pane.height - expected) <= 1);
      assert.equal(panes.extra!.y, pane.height + DOCK_GAP);
      assert.equal(panes.extra!.height, size.height - pane.height - DOCK_GAP);
    }
    assert.equal(
      panes.assistant!.height,
      Math.round((size.height - DOCK_GAP) * 0.75),
    );
    assert.deepEqual(paneIds(fitted), paneIds(tree));
    assert.equal(fitWorkspaceLayout(fitted, sources, size, minimums), fitted);
  }
});

test("a mixed-aspect monitor row fits its tallest video without changing column widths", () => {
  const sources = [
    { ...source("portrait", "window"), width: 900, height: 1200 },
    { ...source("ultrawide"), width: 3440, height: 1440 },
  ];
  const minimums = fitMinimums(sources);
  const tree = buildWorkspaceLayout(sources);
  const size = { width: 1440, height: 900 };
  const before = measureDock(tree, { x: 0, y: 0, ...size }, minimums);
  const fitted = fitWorkspaceLayout(tree, sources, size, minimums);
  const { panes } = measureDock(fitted, { x: 0, y: 0, ...size }, minimums);
  const preferred = Math.max(
    ...sources.map(
      (item) => (panes[item.id]!.width - 2) / sourceAspectRatio(item) + 74,
    ),
  );
  for (const item of sources) {
    assert.ok(Math.abs(panes[item.id]!.height - preferred) <= 1);
    assert.equal(panes[item.id]!.width, before.panes[item.id]!.width);
  }
  assert.ok(panes.extra!.height >= 100);
});

test("three and four desktop feeds fit each row independently above the empty pane", () => {
  for (const count of [3, 4]) {
    const sources = Array.from({ length: count }, (_, index) =>
      source(`monitor-${index}`),
    );
    const minimums = fitMinimums(sources);
    const size = { width: 1440, height: 1200 };
    const fitted = fitWorkspaceLayout(
      buildWorkspaceLayout(sources),
      sources,
      size,
      minimums,
    );
    const { panes } = measureDock(fitted, { x: 0, y: 0, ...size }, minimums);
    for (const item of sources) {
      const pane = panes[item.id]!;
      assert.ok(
        Math.abs(pane.height - ((pane.width - 2) / (16 / 9) + 74)) <= 1,
      );
      assert.ok(panes.extra!.y >= pane.y + pane.height + DOCK_GAP);
    }
    assert.equal(panes["monitor-0"]!.y, panes["monitor-1"]!.y);
    if (count === 4) assert.equal(panes["monitor-2"]!.y, panes["monitor-3"]!.y);
  }
});

test("adding a third and fourth monitor uses the former lower space without stretching feeds", () => {
  const size = { width: 1440, height: 1200 };
  const layouts = [2, 3, 4].map((count) => {
    const sources = Array.from({ length: count }, (_, index) =>
      source(`monitor-${index}`),
    );
    const minimums = fitMinimums(sources);
    const fitted = fitWorkspaceLayout(
      buildWorkspaceLayout(sources),
      sources,
      size,
      minimums,
    );
    return {
      sources,
      panes: measureDock(fitted, { x: 0, y: 0, ...size }, minimums).panes,
    };
  });
  const original = layouts[0]!;
  for (const added of layouts.slice(1)) {
    assert.ok(added.panes.extra!.height < original.panes.extra!.height);
    assert.ok(added.panes.extra!.y > original.panes.extra!.y);
    assert.ok(
      Math.abs(
        added.panes["monitor-0"]!.height - original.panes["monitor-0"]!.height,
      ) <= 1,
    );
    assert.ok(
      Math.abs(added.panes["monitor-2"]!.y - original.panes.extra!.y) <= 1,
    );
    for (const item of added.sources) {
      const pane = added.panes[item.id]!;
      assert.ok(
        Math.abs(pane.height - ((pane.width - 2) / (16 / 9) + 74)) <= 1,
      );
    }
  }
  const four = layouts[2]!.panes;
  assert.equal(four["monitor-2"]!.y, four["monitor-3"]!.y);
  assert.equal(four["monitor-2"]!.width, four["monitor-0"]!.width);
  assert.equal(four["monitor-3"]!.width, four["monitor-1"]!.width);
});

test("mixed camera rows fit their largest aspect height below desktops and above the lower pane", () => {
  const sources = [
    { ...source("monitor-a"), width: 1920, height: 1080 },
    { ...source("monitor-b"), width: 1920, height: 1080 },
    { ...source("camera-a", "camera"), width: 1600, height: 1200 },
    { ...source("camera-b", "virtual_camera"), width: 1080, height: 1080 },
  ];
  const minimums = fitMinimums(sources);
  const size = { width: 1440, height: 1200 };
  const fitted = fitWorkspaceLayout(
    buildWorkspaceLayout(sources),
    sources,
    size,
    minimums,
  );
  const { panes } = measureDock(fitted, { x: 0, y: 0, ...size }, minimums);
  const monitor = panes["monitor-a"]!;
  const camera = panes["camera-b"]!;
  assert.ok(
    Math.abs(monitor.height - ((monitor.width - 2) / (16 / 9) + 74)) <= 1,
  );
  assert.ok(Math.abs(camera.height - (camera.width - 2 + 74)) <= 1);
  assert.equal(panes["camera-a"]!.height, camera.height);
  assert.equal(camera.y, monitor.height + DOCK_GAP);
  assert.equal(panes.extra!.y, camera.y + camera.height + DOCK_GAP);
});

test("fitting camera-only and three-camera groups keeps nested rows and all pane identities", () => {
  for (const sources of [
    [
      source("camera-a", "camera"),
      source("camera-b", "virtual_camera"),
      source("camera-c", "camera"),
    ],
    [
      source("monitor-a"),
      source("camera-a", "camera"),
      source("camera-b", "virtual_camera"),
      source("camera-c", "camera"),
    ],
  ]) {
    const minimums = fitMinimums(sources);
    const size = { width: 1440, height: 2200 };
    const tree = buildWorkspaceLayout(sources);
    const fitted = fitWorkspaceLayout(tree, sources, size, minimums);
    const { panes } = measureDock(fitted, { x: 0, y: 0, ...size }, minimums);
    for (const item of sources) {
      const pane = panes[item.id]!;
      assert.ok(
        Math.abs(pane.height - ((pane.width - 2) / (16 / 9) + 74)) <= 1,
      );
      assert.ok(panes.extra!.y >= pane.y + pane.height + DOCK_GAP);
    }
    assert.deepEqual(paneIds(fitted), paneIds(tree));
    assert.equal(panes["camera-a"]!.y, panes["camera-b"]!.y);
    assert.ok(panes["camera-c"]!.y > panes["camera-a"]!.y);
  }
});

test("limited height clamps aspect fitting to every source and lower pane minimum", () => {
  const sources = Array.from({ length: 4 }, (_, index) => ({
    ...source(`monitor-${index}`),
    width: 1080,
    height: 1920,
  }));
  const tree = buildWorkspaceLayout(sources);
  const minimums = fitMinimums(sources);
  const size = { width: 1004, height: minimumDock(tree, minimums).height };
  const fitted = fitWorkspaceLayout(tree, sources, size, minimums);
  const { panes, dividers } = measureDock(
    fitted,
    { x: 0, y: 0, ...size },
    minimums,
  );
  for (const [id, minimum] of Object.entries(minimums)) {
    assert.ok(panes[id]!.width >= minimum.width);
    assert.ok(panes[id]!.height >= minimum.height);
  }
  assert.equal(panes.extra!.height, 100);
  for (const divider of dividers)
    assert.ok(
      divider.ratio >= divider.minRatio && divider.ratio <= divider.maxRatio,
    );
});

test("empty workspaces and invalid board sizes retain their tree", () => {
  const empty = buildWorkspaceLayout([]);
  assert.equal(
    fitWorkspaceLayout(empty, [], { width: 1440, height: 900 }),
    empty,
  );
  assert.ok(paneIds(empty).includes("extra"));
  const sources = [source("monitor-a")];
  const tree = buildWorkspaceLayout(sources);
  for (const size of [
    { width: 0, height: 900 },
    { width: 1440, height: -1 },
    { width: NaN, height: 900 },
    { width: 1440, height: Infinity },
  ])
    assert.equal(fitWorkspaceLayout(tree, sources, size), tree);
});

test("aspect fitting is immutable and collision-proof when source IDs resemble lower and sidebar splits", () => {
  const sources = [
    source("main-lower"),
    source("main-assistant"),
    source("main-feeds", "camera"),
    source("workspace-cameras-2", "virtual_camera"),
  ];
  const tree = buildWorkspaceLayout(sources);
  const original = JSON.stringify(tree);
  const sourceCopy = structuredClone(sources);
  const fitted = fitWorkspaceLayout(
    tree,
    sources,
    { width: 1440, height: 1200 },
    fitMinimums(sources),
  );
  assert.equal(JSON.stringify(tree), original);
  assert.deepEqual(sources, sourceCopy);
  assert.deepEqual(
    nodes(fitted).map((node) => node.id),
    nodes(tree).map((node) => node.id),
  );
  const ids = nodes(fitted).map((node) => node.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const pane of nodes(tree).filter((node) => node.kind === "pane"))
    assert.equal(
      nodes(fitted).find((node) => node.id === pane.id),
      pane,
    );
});
