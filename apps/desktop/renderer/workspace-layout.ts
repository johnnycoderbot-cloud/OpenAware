import { MAIN_DOCK_TREE, buildPaneTree, type DockNode } from "./dock-layout";

/** Every source and tool is a leaf in the same dashboard, with no feed boards. */
export function buildWorkspaceLayout(
  sources: { id: string; kind: string }[],
): DockNode {
  const staticIds = ["workspace", "assistant", "actions", "activity"];
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
    first: workspace,
    second: reserveSplits(MAIN_DOCK_TREE.second),
  };
}
