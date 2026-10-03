import {
  DOCK_GAP,
  MAIN_DOCK_TREE,
  buildPaneTree,
  measureDock,
  minimumDock,
  type DockNode,
  type DockRect,
  type PaneMinimum,
} from "./dock-layout";

type WorkspaceSource = {
  id: string;
  kind: string;
  width?: number;
  height?: number;
};

const DEFAULT_SOURCE_ASPECT = 16 / 9;
const SOURCE_CHROME_HEIGHT = 74;

export function sourceAspectRatio(source: {
  width?: number;
  height?: number;
}): number {
  const { width, height } = source;
  if (
    width === undefined ||
    height === undefined ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    return DEFAULT_SOURCE_ASPECT;
  const ratio = width / height;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : DEFAULT_SOURCE_ASPECT;
}

/** Every source and tool is a leaf in the same dashboard, with no feed boards. */
export function buildWorkspaceLayout(
  sources: { id: string; kind: string }[],
): DockNode {
  const staticIds = ["workspace", "extra", "assistant", "activity"];
  const sourceIds = sources.map((source) => source.id);
  if (new Set(sourceIds).size !== sourceIds.length)
    throw new Error("Workspace source IDs must be unique");
  if (
    sourceIds.some(
      (id) => !id || staticIds.includes(id) || id === "main-columns",
    )
  )
    throw new Error("Workspace source IDs cannot use reserved pane IDs");

  // Reserve all leaves before allocating splits, including leaves in the other
  // source row and the sidebar. A divider can never share a pane's identity.
  const used = new Set([...staticIds, ...sourceIds, "main-columns"]);
  const uniqueSplitId = (requested: string): string => {
    let id = requested;
    let suffix = 1;
    while (used.has(id)) id = `${requested}-${suffix++}`;
    used.add(id);
    return id;
  };
  const reserveSplits = (node: DockNode): DockNode =>
    node.kind === "pane"
      ? node
      : {
          ...node,
          id: uniqueSplitId(node.id),
          first: reserveSplits(node.first),
          second: reserveSplits(node.second),
        };
  const row = (ids: string[], prefix: string): DockNode =>
    reserveSplits(buildPaneTree(ids, "horizontal", prefix));
  const group = (ids: string[], prefix: string): DockNode => {
    if (ids.length <= 2) return row(ids, prefix);
    const rows: DockNode[] = [];
    for (let index = 0; index < ids.length; index += 2)
      rows.push(
        row(ids.slice(index, index + 2), `${prefix}-row-${index / 2 + 1}`),
      );
    const stack = (remaining: DockNode[]): DockNode =>
      remaining.length === 1
        ? remaining[0]!
        : {
            kind: "split",
            id: uniqueSplitId(`${prefix}-rows-${remaining.length}`),
            axis: "vertical",
            ratio: 1 / remaining.length,
            first: remaining[0]!,
            second: stack(remaining.slice(1)),
          };
    return stack(rows);
  };

  const isCamera = (source: { kind: string }) =>
    source.kind === "camera" || source.kind === "virtual_camera";
  const desktops = sources.filter((source) => !isCamera(source));
  const cameras = sources.filter(isCamera);
  const desktopRow = desktops.length
    ? group(
        desktops.map((source) => source.id),
        "workspace-desktops",
      )
    : undefined;
  const cameraRow = cameras.length
    ? group(
        cameras.map((source) => source.id),
        "workspace-cameras",
      )
    : undefined;
  const workspace: DockNode =
    desktopRow && cameraRow
      ? {
          kind: "split",
          id: uniqueSplitId("main-feeds"),
          axis: "vertical",
          ratio: 0.7,
          first: desktopRow,
          second: cameraRow,
        }
      : desktopRow || cameraRow || { kind: "pane", id: "workspace" };

  if (MAIN_DOCK_TREE.kind !== "split")
    throw new Error("The dashboard default must include its tool sidebar");
  return {
    kind: "split",
    id: "main-columns",
    axis: "horizontal",
    ratio: 0.68,
    first: {
      kind: "split",
      id: uniqueSplitId("main-lower"),
      axis: "vertical",
      ratio: 0.7,
      first: workspace,
      second: { kind: "pane", id: "extra" },
    },
    second: reserveSplits(MAIN_DOCK_TREE.second),
  };
}

function preferredSourceHeights(
  tree: DockNode,
  sources: WorkspaceSource[],
  size: { width: number; height: number },
  minimums: Record<string, PaneMinimum>,
): (node: DockNode) => number | undefined {
  const bounds: DockRect = { x: 0, y: 0, ...size };
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  const measured = measureDock(tree, bounds, minimums);
  const preferredHeight = (node: DockNode): number | undefined => {
    if (node.kind === "pane") {
      const source = sourceMap.get(node.id);
      const rect = measured.panes[node.id];
      if (!source || !rect) return undefined;
      const videoWidth = Math.max(0, rect.width - 2);
      const preferred =
        videoWidth / sourceAspectRatio(source) + SOURCE_CHROME_HEIGHT;
      return Math.max(
        minimumDock(node, minimums).height,
        Number.isFinite(preferred)
          ? preferred
          : videoWidth / DEFAULT_SOURCE_ASPECT + SOURCE_CHROME_HEIGHT,
      );
    }
    const first = preferredHeight(node.first);
    const second = preferredHeight(node.second);
    if (first === undefined || second === undefined) return undefined;
    return node.axis === "horizontal"
      ? Math.max(first, second)
      : first + second + DOCK_GAP;
  };
  return preferredHeight;
}

/** Height needed by fitted source rows and tools at the existing board width. */
export function minimumWorkspaceHeight(
  tree: DockNode,
  sources: WorkspaceSource[],
  size: { width: number; height: number },
  minimums: Record<string, PaneMinimum> = {},
): number {
  const minimum = minimumDock(tree, minimums);
  if (!Number.isFinite(size.width) || size.width <= 0) return minimum.height;
  const preferredHeight = preferredSourceHeights(
    tree,
    sources,
    {
      width: size.width,
      height: Math.max(
        minimum.height,
        Number.isFinite(size.height) ? size.height : 0,
      ),
    },
    minimums,
  );
  const height = (node: DockNode): number => {
    const preferred = preferredHeight(node);
    if (preferred !== undefined) return preferred;
    if (node.kind === "pane") return minimumDock(node, minimums).height;
    const first = height(node.first);
    const second = height(node.second);
    if (node.axis === "horizontal") return Math.max(first, second);
    if (node.second.kind === "pane" && node.second.id === "extra")
      return first + second + DOCK_GAP;
    // Tool-only splits keep their existing ratios, including the 75/25 sidebar.
    if (Number.isFinite(node.ratio) && node.ratio > 0 && node.ratio < 1)
      return Math.max(first / node.ratio, second / (1 - node.ratio)) + DOCK_GAP;
    return first + second + DOCK_GAP;
  };
  return Math.ceil(Math.max(minimum.height, height(tree)));
}

/** Fit only an untouched default; docking remains the caller's authority. */
export function fitWorkspaceLayout(
  tree: DockNode,
  sources: WorkspaceSource[],
  size: { width: number; height: number },
  minimums: Record<string, PaneMinimum> = {},
): DockNode {
  if (
    !Number.isFinite(size.width) ||
    !Number.isFinite(size.height) ||
    size.width <= 0 ||
    size.height <= 0
  )
    return tree;

  const bounds: DockRect = { x: 0, y: 0, ...size };
  const preferredHeight = preferredSourceHeights(tree, sources, size, minimums);

  const fit = (node: DockNode, rect: DockRect): DockNode => {
    if (node.kind === "pane") return node;
    let next = node;
    if (node.axis === "vertical") {
      const first = preferredHeight(node.first);
      const second = preferredHeight(node.second);
      const lowerPane =
        node.second.kind === "pane" && node.second.id === "extra";
      const available = Math.max(
        0,
        rect.height - Math.min(DOCK_GAP, rect.height),
      );
      if (
        first !== undefined &&
        available > 0 &&
        (lowerPane || second !== undefined)
      ) {
        const minFirst = minimumDock(node.first, minimums).height;
        const minSecond = minimumDock(node.second, minimums).height;
        const enough = available >= minFirst + minSecond;
        const minRatio = enough
          ? minFirst / available
          : minFirst / (minFirst + minSecond);
        const maxRatio = enough
          ? Math.max(minRatio, 1 - minSecond / available)
          : minRatio;
        const desiredRatio = lowerPane
          ? first / available
          : first / (first + second!);
        const ratio = Math.max(minRatio, Math.min(maxRatio, desiredRatio));
        if (ratio !== node.ratio) next = { ...node, ratio };
      }
    }
    const divider = measureDock(next, rect, minimums).dividers[0]!;
    const horizontal = next.axis === "horizontal";
    const firstLength = horizontal ? divider.x - rect.x : divider.y - rect.y;
    const gap = horizontal ? divider.width : divider.height;
    const firstRect = {
      ...rect,
      [horizontal ? "width" : "height"]: firstLength,
    };
    const secondRect = {
      ...rect,
      [horizontal ? "x" : "y"]:
        (horizontal ? rect.x : rect.y) + firstLength + gap,
      [horizontal ? "width" : "height"]:
        (horizontal ? rect.width : rect.height) - firstLength - gap,
    };
    const first = fit(next.first, firstRect);
    const second = fit(next.second, secondRect);
    return first === next.first && second === next.second
      ? next
      : { ...next, first, second };
  };
  return fit(tree, bounds);
}
