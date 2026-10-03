export type DockSide = "left" | "right" | "top" | "bottom";
export type DockNode =
  | { kind: "pane"; id: string }
  | {
      kind: "split";
      id: string;
      axis: "horizontal" | "vertical";
      ratio: number;
      first: DockNode;
      second: DockNode;
    };
export type DockRect = { x: number; y: number; width: number; height: number };
export type PaneMinimum = { width: number; height: number };
export type DockDivider = DockRect & {
  id: string;
  axis: "horizontal" | "vertical";
  ratio: number;
  parent: DockRect;
  minRatio: number;
  maxRatio: number;
};
export const DOCK_GAP = 8;

export function paneIds(tree: DockNode): string[] {
  return tree.kind === "pane"
    ? [tree.id]
    : [...paneIds(tree.first), ...paneIds(tree.second)];
}

function uniqueNodeId(tree: DockNode, requested: string): string {
  const ids = new Set<string>();
  const collect = (node: DockNode) => {
    ids.add(node.id);
    if (node.kind === "split") {
      collect(node.first);
      collect(node.second);
    }
  };
  collect(tree);
  let result = requested;
  let suffix = 1;
  while (ids.has(result)) result = `${requested}-${suffix++}`;
  return result;
}

function removePane(tree: DockNode, id: string): DockNode | undefined {
  if (tree.kind === "pane") return tree.id === id ? undefined : tree;
  const first = removePane(tree.first, id);
  const second = removePane(tree.second, id);
  return first && second ? { ...tree, first, second } : first || second;
}

export function dockPane(
  tree: DockNode,
  moving: string,
  target: string,
  side: DockSide,
  splitId: string,
): DockNode {
  const ids = paneIds(tree);
  if (moving === target || !ids.includes(moving) || !ids.includes(target))
    return tree;
  const remaining = removePane(tree, moving)!;
  const nextSplitId = uniqueNodeId(tree, splitId);
  const place = (node: DockNode): DockNode => {
    if (node.kind === "split")
      return { ...node, first: place(node.first), second: place(node.second) };
    if (node.id !== target) return node;
    const movingPane: DockNode = { kind: "pane", id: moving };
    const before = side === "left" || side === "top";
    return {
      kind: "split",
      id: nextSplitId,
      axis: side === "left" || side === "right" ? "horizontal" : "vertical",
      ratio: 0.5,
      first: before ? movingPane : node,
      second: before ? node : movingPane,
    };
  };
  return place(remaining);
}

export function setSplitRatio(
  tree: DockNode,
  id: string,
  ratio: number,
): DockNode {
  if (tree.kind === "pane" || !Number.isFinite(ratio)) return tree;
  return {
    ...tree,
    ratio: tree.id === id ? Math.max(0.05, Math.min(0.95, ratio)) : tree.ratio,
    first: setSplitRatio(tree.first, id, ratio),
    second: setSplitRatio(tree.second, id, ratio),
  };
}

export function buildPaneTree(
  ids: string[],
  axis: "horizontal" | "vertical",
  prefix: string,
): DockNode {
  if (!ids.length) throw new Error("A layout needs at least one pane");
  if (new Set(ids).size !== ids.length)
    throw new Error("Pane IDs must be unique");
  const used = new Set(ids);
  const build = (remaining: string[]): DockNode => {
    if (remaining.length === 1) return { kind: "pane", id: remaining[0]! };
    const requested = `${prefix}-${remaining.length}`;
    let id = requested;
    let suffix = 1;
    while (used.has(id)) id = `${requested}-${suffix++}`;
    used.add(id);
    return {
      kind: "split",
      id,
      axis,
      ratio: 1 / remaining.length,
      first: { kind: "pane", id: remaining[0]! },
      second: build(remaining.slice(1)),
    };
  };
  return build(ids);
}

// Adding/removing a source changes only its layout leaf. Existing panes and
// their capture components remain mounted in the board's stable flat parent.
export function reconcilePanes(
  tree: DockNode,
  ids: string[],
  prefix: string,
  axis: "horizontal" | "vertical" = "vertical",
): DockNode {
  if (!ids.length) throw new Error("A layout needs at least one pane");
  let current: DockNode | undefined = tree;
  for (const id of paneIds(tree))
    if (!ids.includes(id) && current) current = removePane(current, id);
  if (!current) return buildPaneTree(ids, axis, prefix);
  for (const id of ids) {
    if (paneIds(current).includes(id)) continue;
    current = {
      kind: "split",
      id: uniqueNodeId(current, `${prefix}-${id}`),
      axis,
      ratio: 0.5,
      first: current,
      second: { kind: "pane", id },
    };
  }
  return current;
}

export function nearestDockSide(
  rect: DockRect,
  x: number,
  y: number,
): DockSide {
  const horizontal = (x - rect.x) / Math.max(1, rect.width);
  const vertical = (y - rect.y) / Math.max(1, rect.height);
  const edges: [DockSide, number][] = [
    ["left", horizontal],
    ["right", 1 - horizontal],
    ["top", vertical],
    ["bottom", 1 - vertical],
  ];
  return edges.reduce((best, edge) => (edge[1] < best[1] ? edge : best))[0];
}

export function minimumDock(
  tree: DockNode,
  minimums: Record<string, PaneMinimum> = {},
): PaneMinimum {
  if (tree.kind === "pane")
    return minimums[tree.id] || { width: 180, height: 100 };
  const a = minimumDock(tree.first, minimums);
  const b = minimumDock(tree.second, minimums);
  return tree.axis === "horizontal"
    ? {
        width: a.width + b.width + DOCK_GAP,
        height: Math.max(a.height, b.height),
      }
    : {
        width: Math.max(a.width, b.width),
        height: a.height + b.height + DOCK_GAP,
      };
}

export function measureDock(
  tree: DockNode,
  rect: DockRect,
  minimums: Record<string, PaneMinimum> = {},
): { panes: Record<string, DockRect>; dividers: DockDivider[] } {
  const panes: Record<string, DockRect> = {};
  const dividers: DockDivider[] = [];
  const visit = (node: DockNode, bounds: DockRect) => {
    if (node.kind === "pane") {
      panes[node.id] = bounds;
      return;
    }
    const horizontal = node.axis === "horizontal";
    const length = horizontal ? bounds.width : bounds.height;
    const gap = Math.min(DOCK_GAP, Math.max(0, length));
    const available = Math.max(0, length - gap);
    const a = minimumDock(node.first, minimums);
    const b = minimumDock(node.second, minimums);
    const minA = horizontal ? a.width : a.height;
    const minB = horizontal ? b.width : b.height;
    // If the window is smaller than both minima, proportionally shrink panes.
    // Each pane has its own scroller; the global Stop control stays outside.
    const enough = available >= minA + minB;
    const minRatio = enough ? minA / available : minA / (minA + minB);
    const maxRatio = enough
      ? Math.max(minRatio, 1 - minB / available)
      : minRatio;
    const ratio = Math.max(minRatio, Math.min(maxRatio, node.ratio));
    const firstLength = Math.max(
      0,
      Math.min(available, Math.round(available * ratio)),
    );
    const secondLength = available - firstLength;
    const first = { ...bounds, [horizontal ? "width" : "height"]: firstLength };
    const second = {
      ...bounds,
      [horizontal ? "x" : "y"]:
        (horizontal ? bounds.x : bounds.y) + firstLength + gap,
      [horizontal ? "width" : "height"]: secondLength,
    };
    dividers.push({
      id: node.id,
      axis: node.axis,
      ratio,
      minRatio,
      maxRatio,
      parent: bounds,
      x: horizontal ? bounds.x + firstLength : bounds.x,
      y: horizontal ? bounds.y : bounds.y + firstLength,
      width: horizontal ? gap : bounds.width,
      height: horizontal ? bounds.height : gap,
    });
    visit(node.first, first);
    visit(node.second, second);
  };
  visit(tree, rect);
  return { panes, dividers };
}

export const MAIN_DOCK_TREE: DockNode = {
  kind: "split",
  id: "main-columns",
  axis: "horizontal",
  ratio: 0.68,
  first: {
    kind: "split",
    id: "main-lower",
    axis: "vertical",
    ratio: 0.7,
    first: {
      kind: "split",
      id: "main-feeds",
      axis: "vertical",
      ratio: 0.86,
      first: { kind: "pane", id: "workspace" },
      second: { kind: "pane", id: "cameras" },
    },
    second: { kind: "pane", id: "extra" },
  },
  second: {
    kind: "split",
    id: "main-assistant",
    axis: "vertical",
    ratio: 0.75,
    first: { kind: "pane", id: "assistant" },
    second: { kind: "pane", id: "activity" },
  },
};
