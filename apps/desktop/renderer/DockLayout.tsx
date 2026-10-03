import {
  Children,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import { Columns2, GripVertical, RotateCcw, Rows2 } from "lucide-react";
import {
  buildPaneTree,
  dockPane,
  measureDock,
  minimumDock,
  nearestDockSide,
  paneIds,
  reconcilePanes,
  setSplitRatio,
  type DockDivider,
  type DockNode,
  type DockSide,
  type PaneMinimum,
} from "./dock-layout";

type DockPaneProps = {
  id: string;
  title: string;
  children: ReactNode;
  hideTitle?: boolean;
};
export function DockPane({ children }: DockPaneProps) {
  return <>{children}</>;
}

type LayoutProps = {
  children: ReactNode;
  defaultTree: DockNode;
  name: string;
  minimums?: Record<string, PaneMinimum>;
  resetKey?: number;
  toolbar?: ReactNode;
  onDock?: (tree: DockNode) => void;
  onReset?: () => void;
  onLayoutChange?: (tree: DockNode) => void;
  className?: string;
};

export function DockLayout({
  children,
  defaultTree,
  name,
  minimums,
  resetKey = 0,
  toolbar,
  onDock,
  onReset,
  onLayoutChange,
  className = "",
}: LayoutProps) {
  const panes = Children.toArray(children) as ReactElement<DockPaneProps>[];
  const ids = panes.map((pane) => pane.props.id);
  const idKey = ids.join("\u0000");
  const boardRef = useRef<HTMLDivElement>(null);
  const [tree, setTree] = useState(defaultTree);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [dragging, setDragging] = useState<string>();
  const [target, setTarget] = useState<{ id: string; side: DockSide }>();
  const resizing = useRef<
    { divider: DockDivider; pointerId: number } | undefined
  >(undefined);
  const [announcement, setAnnouncement] = useState("");
  const [compactWindow, setCompactWindow] = useState(
    () => matchMedia("(max-width: 900px)").matches,
  );
  const compactMain = name === "dashboard" && compactWindow;
  const resetRef = useRef(resetKey);
  const layoutChangeRef = useRef(onLayoutChange);
  layoutChangeRef.current = onLayoutChange;
  useEffect(() => {
    const query = matchMedia("(max-width: 900px)");
    const update = () => setCompactWindow(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    setTree((previous) =>
      reconcilePanes(
        previous,
        ids,
        `${name}-added`,
        defaultTree.kind === "split" ? defaultTree.axis : "vertical",
      ),
    );
  }, [idKey, name]);
  useEffect(() => {
    if (resetKey === resetRef.current) return;
    resetRef.current = resetKey;
    setTree(defaultTree);
  }, [resetKey, defaultTree]);
  useEffect(() => {
    layoutChangeRef.current?.(tree);
  }, [tree]);
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry)
        setSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
    });
    observer.observe(board);
    return () => observer.disconnect();
  }, []);
  const geometry = useMemo(
    () => measureDock(tree, { x: 0, y: 0, ...size }, minimums),
    [tree, size, minimums],
  );
  const clearDrag = () => {
    setDragging(undefined);
    setTarget(undefined);
  };
  const move = (moving: string, destination: string, side: DockSide) => {
    const next = dockPane(tree, moving, destination, side, crypto.randomUUID());
    setTree(next);
    onDock?.(next);
    setAnnouncement(
      `Pane moved to the ${side} of ${panes.find((pane) => pane.props.id === destination)?.props.title || "another pane"}`,
    );
    clearDrag();
  };
  const order = paneIds(tree);
  return (
    <div className={`dock-layout ${className}`} data-layout-name={name}>
      <div className="dock-layout-tools">
        {toolbar || (
          <span
            title={
              compactMain
                ? "Drag or use Move to change pane order. Widen the window to resize."
                : "Drag panes to another edge or use Move. Pull dividers to resize."
            }
          >
            {compactMain ? "Stacked layout" : "Layout"}
          </span>
        )}
        <button
          className="text-button reset-layout"
          onClick={() => {
            setTree(defaultTree);
            clearDrag();
            onReset?.();
            setAnnouncement("Layout reset");
          }}
          aria-label={`Reset ${name} layout`}
        >
          <RotateCcw size={13} /> Reset layout
        </button>
      </div>
      <div
        ref={boardRef}
        className="dock-board"
        data-testid={`${name}-dock-board`}
      >
        {panes.map(({ props }) => {
          const rect = geometry.panes[props.id];
          const style: CSSProperties = rect
            ? {
                left: rect.x,
                top: rect.y,
                width: rect.width,
                height: rect.height,
                order: order.indexOf(props.id),
              }
            : { visibility: "hidden" };
          return (
            <div
              key={props.id}
              className={`dock-pane ${dragging === props.id ? "is-dragging" : ""}`}
              data-pane-id={props.id}
              style={style}
              onDragOver={(event) => {
                if (!dragging || dragging === props.id) return;
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = "move";
                const bounds = event.currentTarget.getBoundingClientRect();
                setTarget({
                  id: props.id,
                  side: nearestDockSide(
                    {
                      x: bounds.x,
                      y: bounds.y,
                      width: bounds.width,
                      height: bounds.height,
                    },
                    event.clientX,
                    event.clientY,
                  ),
                });
              }}
              onDrop={(event) => {
                if (!dragging || dragging === props.id) return;
                event.preventDefault();
                event.stopPropagation();
                const bounds = event.currentTarget.getBoundingClientRect();
                const side = nearestDockSide(
                  {
                    x: bounds.x,
                    y: bounds.y,
                    width: bounds.width,
                    height: bounds.height,
                  },
                  event.clientX,
                  event.clientY,
                );
                move(dragging, props.id, side);
              }}
            >
              <div className="dock-pane-handle">
                <button
                  className="pane-drag-button"
                  draggable
                  aria-label={`Move ${props.title}`}
                  title="Drag to the left, right, top, or bottom edge of another pane"
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData(
                      "application/x-openaware-pane",
                      props.id,
                    );
                    setDragging(props.id);
                  }}
                  onDragEnd={clearDrag}
                >
                  <GripVertical size={14} />
                </button>
                {!props.hideTitle && (
                  <h2 className="dock-pane-caption">{props.title}</h2>
                )}
                <select
                  className="pane-arrange-select"
                  aria-label={`Arrange ${props.title}`}
                  value=""
                  title="Move this pane with the keyboard or choose a position"
                  onChange={(event) => {
                    const choices = panes
                      .filter((pane) => pane.props.id !== props.id)
                      .flatMap((pane) =>
                        (["left", "right", "top", "bottom"] as DockSide[]).map(
                          (side) => ({
                            value: `${pane.props.id}/${side}`,
                            id: pane.props.id,
                            side,
                          }),
                        ),
                      );
                    const choice = choices.find(
                      (item) => item.value === event.target.value,
                    );
                    if (choice) move(props.id, choice.id, choice.side);
                  }}
                >
                  <option value="">Move…</option>
                  {panes
                    .filter((pane) => pane.props.id !== props.id)
                    .flatMap((pane) =>
                      (["left", "right", "top", "bottom"] as DockSide[]).map(
                        (side) => (
                          <option
                            key={`${pane.props.id}/${side}`}
                            value={`${pane.props.id}/${side}`}
                          >
                            {side === "top"
                              ? "Above"
                              : side === "bottom"
                                ? "Below"
                                : side === "left"
                                  ? "Left of"
                                  : "Right of"}{" "}
                            {pane.props.title}
                          </option>
                        ),
                      ),
                    )}
                </select>
              </div>
              <div className="dock-pane-content">{props.children}</div>
              {target?.id === props.id && (
                <div
                  className={`dock-drop-hint ${target.side}`}
                  aria-hidden="true"
                >
                  Place{" "}
                  {target.side === "top"
                    ? "above"
                    : target.side === "bottom"
                      ? "below"
                      : target.side}
                </div>
              )}
            </div>
          );
        })}
        {geometry.dividers.map((divider) => (
          <div
            key={divider.id}
            className={`dock-divider ${divider.axis}`}
            data-divider-id={divider.id}
            role="separator"
            tabIndex={compactMain ? -1 : 0}
            aria-disabled={compactMain || undefined}
            aria-label={`Resize ${name} ${divider.axis} split`}
            aria-orientation={
              divider.axis === "horizontal" ? "vertical" : "horizontal"
            }
            aria-valuemin={Math.round(divider.minRatio * 100)}
            aria-valuemax={Math.round(divider.maxRatio * 100)}
            aria-valuenow={Math.round(divider.ratio * 100)}
            style={{
              left: divider.x,
              top: divider.y,
              width: divider.width,
              height: divider.height,
            }}
            onPointerDown={(event) => {
              if (compactMain || event.button !== 0) return;
              event.preventDefault();
              resizing.current = { divider, pointerId: event.pointerId };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const active = resizing.current;
              const board = boardRef.current;
              if (
                !active ||
                active.pointerId !== event.pointerId ||
                active.divider.id !== divider.id ||
                !board
              )
                return;
              const bounds = board.getBoundingClientRect();
              const current = active.divider;
              const horizontal = current.axis === "horizontal";
              const offset = horizontal
                ? event.clientX - bounds.x - current.parent.x
                : event.clientY - bounds.y - current.parent.y;
              const available =
                (horizontal ? current.parent.width : current.parent.height) - 8;
              const ratio = Math.max(
                current.minRatio,
                Math.min(current.maxRatio, offset / Math.max(1, available)),
              );
              setTree((previous) => setSplitRatio(previous, current.id, ratio));
            }}
            onPointerUp={(event) => {
              resizing.current = undefined;
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onLostPointerCapture={() => {
              resizing.current = undefined;
            }}
            onKeyDown={(event) => {
              if (compactMain) return;
              const backwards =
                divider.axis === "horizontal" ? "ArrowLeft" : "ArrowUp";
              const forwards =
                divider.axis === "horizontal" ? "ArrowRight" : "ArrowDown";
              let ratio = divider.ratio;
              if (event.key === backwards) ratio -= event.shiftKey ? 0.1 : 0.02;
              else if (event.key === forwards)
                ratio += event.shiftKey ? 0.1 : 0.02;
              else if (event.key === "Home") ratio = divider.minRatio;
              else if (event.key === "End") ratio = divider.maxRatio;
              else return;
              event.preventDefault();
              setTree((previous) =>
                setSplitRatio(
                  previous,
                  divider.id,
                  Math.max(divider.minRatio, Math.min(divider.maxRatio, ratio)),
                ),
              );
            }}
          />
        ))}
      </div>
      <span className="visually-hidden" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}

export function FeedLayout({
  sources,
  children,
  resetRevision = 0,
  name = "feed",
  category = "desktop",
}: {
  sources: { id: string }[];
  children: ReactNode;
  resetRevision?: number;
  name?: string;
  category?: "desktop" | "camera";
}) {
  const ids = sources.map((source) => source.id);
  const initialLayout = category === "camera" ? "columns" : "stack";
  const [layout, setLayout] = useState<"stack" | "columns">(initialLayout);
  const [resetKey, setResetKey] = useState(0);
  const minimums = useMemo(
    () =>
      Object.fromEntries(ids.map((id) => [id, { width: 260, height: 285 }])),
    [ids.join("\u0000")],
  );
  const heightFor = (tree: DockNode) =>
    Math.max(340, minimumDock(tree, minimums).height + 48);
  const widthFor = (tree: DockNode) => minimumDock(tree, minimums).width + 20;
  const treeFor = (next: "stack" | "columns") =>
    buildPaneTree(ids, next === "columns" ? "horizontal" : "vertical", name);
  const [height, setHeight] = useState(() => heightFor(treeFor(initialLayout)));
  const [minimumHeight, setMinimumHeight] = useState(() =>
    heightFor(treeFor(initialLayout)),
  );
  const [minimumWidth, setMinimumWidth] = useState(() =>
    widthFor(treeFor(initialLayout)),
  );
  const resize = useRef<
    { y: number; height: number; pointerId: number } | undefined
  >(undefined);
  const previousCount = useRef(ids.length);
  const previousReset = useRef(resetRevision);
  useEffect(() => {
    if (previousReset.current === resetRevision) return;
    previousReset.current = resetRevision;
    setLayout(initialLayout);
    setHeight(heightFor(treeFor(initialLayout)));
    setMinimumWidth(widthFor(treeFor(initialLayout)));
    setResetKey((value) => value + 1);
  }, [resetRevision, ids.length, initialLayout]);
  useEffect(() => {
    if (ids.length === previousCount.current) return;
    previousCount.current = ids.length;
    setHeight(heightFor(treeFor(layout)));
    setMinimumWidth(widthFor(treeFor(layout)));
  }, [ids.length, layout]);
  const defaultTree = useMemo(
    () =>
      buildPaneTree(
        ids,
        layout === "columns" ? "horizontal" : "vertical",
        name,
      ),
    [ids.join("\u0000"), layout, name],
  );
  const choose = (next: "stack" | "columns") => {
    setLayout(next);
    setHeight(heightFor(treeFor(next)));
    setMinimumWidth(widthFor(treeFor(next)));
    setResetKey((value) => value + 1);
  };
  return (
    <div
      className={`feed-layout ${category === "camera" ? "camera-feed-layout" : ""}`}
      style={{ height, minWidth: minimumWidth }}
    >
      <DockLayout
        name={name}
        className="feed-dock-layout"
        defaultTree={defaultTree}
        resetKey={resetKey}
        minimums={minimums}
        onLayoutChange={(next) => {
          const minimum = heightFor(next);
          setMinimumHeight(minimum);
          setMinimumWidth(widthFor(next));
          setHeight((previous) => Math.max(minimum, previous));
        }}
        toolbar={
          <div className="feed-layout-buttons">
            <button
              className="text-button"
              aria-label={`Stack ${category} feeds`}
              aria-pressed={layout === "stack"}
              onClick={() => choose("stack")}
            >
              <Rows2 size={13} /> Stack
            </button>
            <button
              className="text-button"
              aria-label={`Place ${category} feeds side by side`}
              aria-pressed={layout === "columns"}
              onClick={() => choose("columns")}
            >
              <Columns2 size={13} /> Side by side
            </button>
          </div>
        }
        onDock={(next) => {
          const nextLayout =
            next.kind === "split" && next.axis === "horizontal"
              ? "columns"
              : "stack";
          setLayout(nextLayout);
          setHeight(heightFor(next));
          setMinimumWidth(widthFor(next));
        }}
        onReset={() => {
          setLayout(initialLayout);
          setHeight(heightFor(treeFor(initialLayout)));
          setMinimumWidth(widthFor(treeFor(initialLayout)));
          setResetKey((value) => value + 1);
        }}
      >
        {children}
      </DockLayout>
      <div
        className="feed-height-resizer"
        role="separator"
        tabIndex={0}
        aria-label={`Resize ${category} feeds height`}
        aria-orientation="horizontal"
        aria-valuemin={minimumHeight}
        aria-valuemax={1400}
        aria-valuenow={height}
        title={`Drag to resize the ${category} preview area`}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          resize.current = {
            y: event.clientY,
            height,
            pointerId: event.pointerId,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const active = resize.current;
          if (!active || active.pointerId !== event.pointerId) return;
          setHeight(
            Math.max(
              minimumHeight,
              Math.min(1400, active.height + event.clientY - active.y),
            ),
          );
        }}
        onPointerUp={() => {
          resize.current = undefined;
        }}
        onLostPointerCapture={() => {
          resize.current = undefined;
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          setHeight((previous) =>
            Math.max(
              minimumHeight,
              Math.min(1400, previous + (event.key === "ArrowUp" ? -20 : 20)),
            ),
          );
        }}
      />
    </div>
  );
}
