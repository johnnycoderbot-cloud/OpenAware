import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  Activity,
  Aperture,
  ArrowUpRight,
  Bot,
  Camera,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Cpu,
  Eye,
  Layers3,
  LockKeyhole,
  Monitor,
  Minimize2,
  MousePointer2,
  Pause,
  Play,
  Plus,
  Power,
  Radio,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Square,
  Terminal,
  Trash2,
  Video,
  X,
} from "lucide-react";
import {
  initialSnapshot,
  MAX_SOURCES,
  MAX_AGENTS,
  MAX_AGENT_SOURCES,
  type AgentSnapshot,
  type CaptureChoice,
  type CaptionSearchResult,
  type Command,
  type DesktopState,
  type Frame,
  type Mask,
  type OpenAwareBridge,
  type Observation,
  type ProviderKind,
  type Snapshot,
  type Source,
  type SourceKind,
} from "@openaware/contracts";
import { CaptureManager, createProbe } from "./capture";
import { DockLayout, DockPane } from "./DockLayout";
import { AgentDesk } from "./AgentDesk";
import { buildAgentDeskSeats } from "./agent-desk-state";
import {
  buildWorkspaceLayout,
  fitWorkspaceLayout,
  minimumWorkspaceHeight,
  sourceAspectRatio,
} from "./workspace-layout";

declare global {
  interface Window {
    openAware?: OpenAwareBridge;
  }
}
type Tab = "Overview" | "Operator" | "Connections" | "Event log";
const tabs = [
  { name: "Overview" as Tab, icon: Layers3 },
  { name: "Operator" as Tab, icon: MousePointer2 },
  { name: "Connections" as Tab, icon: Cpu },
  { name: "Event log" as Tab, icon: Terminal },
];
const providerLabels: Record<ProviderKind, string> = {
  lmstudio: "LM Studio",
  ollama: "Ollama",
  llamacpp: "llama.cpp",
};
const providerEndpoints: Record<ProviderKind, string> = {
  lmstudio: "http://127.0.0.1:1234",
  ollama: "http://127.0.0.1:11434",
  llamacpp: "http://127.0.0.1:8080",
};
const time = (at: number) =>
  new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
const age = (at?: number) =>
  !at
    ? "No sample"
    : `${Math.max(0, Math.round((Date.now() - at) / 1000))}s ago`;
const analyzedWindow = (observation: Observation) => {
  const start = observation.captureStartAt ?? observation.capturedAt;
  const frames = observation.frameCount ?? 1;
  return `${time(start)}${start !== observation.capturedAt ? `–${time(observation.capturedAt)}` : ""} · ${frames} frame${frames === 1 ? "" : "s"}`;
};

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>(initialSnapshot);
  const snapshotRef = useRef(snapshot);
  const [tab, setTab] = useState<Tab>("Overview");
  const [addOpen, setAddOpen] = useState(false);
  const [maskSource, setMaskSource] = useState<Source>();
  const [focusedSourceId, setFocusedSourceId] = useState<string>();
  const [layoutResetRevision, setLayoutResetRevision] = useState(0);
  const [lowerPanel, setLowerPanel] = useState<"desk" | "memory">("desk");
  const [agentDialog, setAgentDialog] = useState<"new" | string>();
  const [desktopState, setDesktopState] = useState<DesktopState>();
  const [notice, setNotice] = useState<string>();
  const [allPending, setPending] = useState<string[]>([]);
  const [questionDrafts, setQuestionDrafts] = useState<Record<string, string>>(
    {},
  );
  const [questionExclusions, setQuestionExclusions] = useState<
    Record<string, string[]>
  >({});
  const activeAgent = snapshot.agents.find(
    (agent) => agent.id === snapshot.activeAgentId,
  );
  const pending = allPending
    .filter(
      (label) =>
        !label.startsWith("agent:") ||
        label.startsWith(`agent:${snapshot.activeAgentId}:`),
    )
    .map((label) => label.replace(`agent:${snapshot.activeAgentId}:`, ""));
  const questionDraft = questionDrafts[snapshot.activeAgentId] || "";
  const excludedQuestionSources =
    questionExclusions[snapshot.activeAgentId] || [];
  const setQuestionDraft: React.Dispatch<React.SetStateAction<string>> = (
    value,
  ) => {
    const agentId = snapshot.activeAgentId;
    setQuestionDrafts((drafts) => ({
      ...drafts,
      [agentId]:
        typeof value === "function" ? value(drafts[agentId] || "") : value,
    }));
  };
  const setExcludedQuestionSources: React.Dispatch<
    React.SetStateAction<string[]>
  > = (value) => {
    const agentId = snapshot.activeAgentId;
    setQuestionExclusions((exclusions) => ({
      ...exclusions,
      [agentId]:
        typeof value === "function" ? value(exclusions[agentId] || []) : value,
    }));
  };
  const [, redraw] = useState(0);
  const managerRef = useRef<CaptureManager | undefined>(undefined);
  const bridge = window.openAware;
  const apply = useCallback((state: Snapshot) => {
    snapshotRef.current = state;
    setSnapshot(state);
  }, []);
  const report = useCallback((message: string) => setNotice(message), []);
  const update = useCallback(() => redraw((x) => x + 1), []);
  if (!managerRef.current && bridge)
    managerRef.current = new CaptureManager(
      bridge,
      (id) => snapshotRef.current.sources.find((s) => s.id === id),
      update,
      report,
    );
  const manager = managerRef.current;

  useEffect(() => {
    if (!bridge) return;
    const unsubscribe = bridge.onState(apply);
    void bridge
      .invoke({ type: "state.get" })
      .then(apply)
      .catch((e) => report(String(e)));
    const timer = setInterval(update, 1000);
    const stop = () => {
      manager?.stopAll();
      void bridge.stopAll();
    };
    window.addEventListener("beforeunload", stop);
    return () => {
      unsubscribe();
      clearInterval(timer);
      window.removeEventListener("beforeunload", stop);
      manager?.stopAll();
    };
  }, [bridge, apply, manager, report, update]);
  const sourceStatuses = useRef(new Map<string, Source["status"]>());
  useEffect(() => {
    const previous = sourceStatuses.current;
    for (const source of snapshot.sources)
      if (source.status !== "live" && previous.get(source.id) === "live")
        manager?.stop(source.id);
    for (const id of previous.keys())
      if (!snapshot.sources.some((source) => source.id === id))
        manager?.stop(id);
    sourceStatuses.current = new Map(
      snapshot.sources.map((source) => [source.id, source.status]),
    );
  }, [snapshot.sources, manager]);
  useEffect(() => {
    setExcludedQuestionSources((ids) => {
      const next = ids.filter((id) =>
        snapshot.sources.some((source) => source.id === id),
      );
      return next.length === ids.length ? ids : next;
    });
  }, [snapshot.sources]);
  useEffect(() => {
    if (!bridge) return;
    const unsubscribe = bridge.onDesktopState(setDesktopState);
    void bridge
      .getDesktopState()
      .then(setDesktopState)
      .catch((error) => report(String(error)));
    return unsubscribe;
  }, [bridge, report]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 8000);
    return () => clearTimeout(timer);
  }, [notice]);

  async function run(
    command: Command,
    label: string = command.type,
  ): Promise<Snapshot | undefined> {
    if (!bridge) {
      report(
        "OpenAware desktop bridge is unavailable. Launch the Electron app to connect sources and models.",
      );
      return;
    }
    const scoped =
      /^(provider\.|monitor\.|conversation\.|automation\.|pipeline\.|rule\.|history\.|events\.)/.test(
        command.type,
      );
    const target = scoped
      ? "agentId" in command && command.agentId
        ? command.agentId
        : snapshot.activeAgentId
      : undefined;
    const pinned = target
      ? ({ ...command, agentId: target } as Command)
      : command;
    const pendingLabel = target ? `agent:${target}:${label}` : label;
    setPending((p) => [...p, pendingLabel]);
    try {
      const state = await bridge.invoke(pinned);
      if (state && Array.isArray(state.sources)) apply(state);
      return state;
    } catch (error) {
      report(error instanceof Error ? error.message : String(error));
      return;
    } finally {
      setPending((p) => p.filter((item) => item !== pendingLabel));
    }
  }
  async function stopAll() {
    manager?.stopAll();
    if (!bridge) return;
    setPending((p) => [...p, "stop"]);
    try {
      await bridge.stopAll();
    } catch (e) {
      report(String(e));
    } finally {
      setPending((p) => p.filter((item) => item !== "stop"));
    }
  }
  function focusSource(sourceId: string) {
    setFocusedSourceId(sourceId);
    requestAnimationFrame(() => {
      const pane = Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid="source-tile"]'),
      ).find((node) => node.dataset.sourceId === sourceId);
      pane?.scrollIntoView({ block: "nearest", inline: "nearest" });
      pane?.focus({ preventScroll: true });
    });
  }
  async function addSource(name: string, kind: SourceKind, deviceId: string) {
    const id = crypto.randomUUID();
    const result = await run({
      type: "source.add",
      source: { id, name, kind, deviceId },
    });
    const source = result?.sources.find((s) => s.id === id);
    if (!source || !manager) return;
    if (kind !== "camera" && kind !== "virtual_camera") focusSource(id);
    setAddOpen(false);
    setPending((p) => [...p, id]);
    try {
      await manager.start(source);
    } catch (e) {
      report(e instanceof Error ? e.message : String(e));
    } finally {
      setPending((p) => p.filter((item) => item !== id));
    }
  }
  async function connect(source: Source) {
    if (!manager) return;
    setPending((p) => [...p, source.id]);
    try {
      await manager.start(source);
    } catch (e) {
      report(e instanceof Error ? e.message : String(e));
    } finally {
      setPending((p) => p.filter((item) => item !== source.id));
    }
  }
  async function disconnect(source: Source) {
    manager?.stop(source.id);
    await run({
      type: "source.update",
      sourceId: source.id,
      patch: { status: "stopped" },
    });
  }
  async function remove(source: Source) {
    manager?.stop(source.id);
    await run({ type: "source.remove", sourceId: source.id });
  }
  const live = snapshot.sources.filter((source) => source.status === "live");
  const assignedSources = snapshot.sources.filter((source) =>
    activeAgent?.sourceIds.includes(source.id),
  );
  const assignedLive = assignedSources.filter(
    (source) => source.status === "live",
  );
  const agentSnapshot = { ...snapshot, sources: assignedSources };
  const sessionActive = snapshot.session === "monitoring";
  const screenSources = snapshot.sources.filter(
    (source) => source.kind !== "camera" && source.kind !== "virtual_camera",
  );
  const primarySource =
    screenSources.find((source) => source.id === focusedSourceId) ||
    screenSources[0];
  const sourceMembership = snapshot.sources
    .map((source) => `${source.id}/${source.kind}`)
    .join("|");
  const workspaceTree = useMemo(
    () => buildWorkspaceLayout(snapshot.sources),
    [sourceMembership],
  );
  const canStart =
    assignedLive.some((s) => s.motionEnabled || s.analysisEnabled) &&
    (!assignedLive.some((s) => s.analysisEnabled) ||
      snapshot.binding.status === "verified");
  const sourceHeaderId = screenSources[0]?.id || snapshot.sources[0]?.id;
  const addSourceControl = (
    <button
      data-testid="add-source"
      className="button secondary source-add-button"
      title={
        snapshot.sources.length >= MAX_SOURCES
          ? `${MAX_SOURCES}-source limit reached`
          : "Add a screen, camera or video"
      }
      disabled={!bridge || snapshot.sources.length >= MAX_SOURCES}
      onClick={() => setAddOpen(true)}
    >
      <Plus size={14} />
      <span>Add source</span>
    </button>
  );
  const subtitle: Record<Tab, string> = {
    Overview: "Your workspace, in view.",
    Operator: "A goal. A plan. You stay in control.",
    Connections: "Choose the intelligence behind your workspace.",
    "Event log": "A clear record of what happened.",
  };

  const renderSource = (
    source: Source,
    presentation: "primary" | "secondary" | "camera",
  ) => (
    <SourceTile
      key={source.id}
      source={source}
      embedded
      presentation={presentation}
      onFocus={
        presentation === "secondary" ? () => focusSource(source.id) : undefined
      }
      info={manager?.info(source.id)}
      pending={pending.includes(source.id)}
      observation={snapshot.observations
        .filter((o) => o.sourceIds.includes(source.id))
        .at(-1)}
      onConnect={() => void connect(source)}
      onDisconnect={() => void disconnect(source)}
      onRemove={() => void remove(source)}
      onMasks={() => setMaskSource(source)}
      onOpenPlayer={
        ["video_file", "video_url", "web_video"].includes(source.kind)
          ? () =>
              void bridge
                ?.openVideoSource(source.id)
                .catch((error) => report(String(error)))
          : undefined
      }
      onToggle={(key, value) =>
        void run({
          type: "source.update",
          sourceId: source.id,
          patch: { [key]: value },
        })
      }
    />
  );

  return (
    <div className={`app-shell ${tab === "Overview" ? "overview-shell" : ""}`}>
      <header className="app-navigation">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setTab("Overview");
          }}
          aria-label="OpenAware overview"
        >
          <span className="brand-symbol">
            <Aperture size={25} />
          </span>
          <span>OpenAware</span>
        </a>
        <span className="opensource-badge">Open source</span>
        <nav aria-label="Main navigation">
          {tabs.map((item) => (
            <button
              key={item.name}
              className={`nav-item ${tab === item.name ? "active" : ""}`}
              data-testid={
                item.name === "Connections" ? "connections" : undefined
              }
              onClick={() => setTab(item.name)}
              aria-label={item.name}
              title={item.name}
              aria-current={tab === item.name ? "page" : undefined}
            >
              <item.icon size={18} />
              <span>{item.name}</span>
              {item.name === "Event log" &&
                snapshot.events.filter((e) => !e.acknowledged).length > 0 && (
                  <span className="nav-count">
                    {snapshot.events.filter((e) => !e.acknowledged).length}
                  </span>
                )}
            </button>
          ))}
        </nav>
        <select
          className="active-agent-select"
          aria-label="Active agent"
          value={snapshot.activeAgentId}
          disabled={!bridge || !snapshot.agents.length}
          onChange={(event) =>
            void run({ type: "agent.select", agentId: event.target.value })
          }
        >
          {snapshot.agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
        {tab === "Overview" && (
          <div className="workspace-controls">
            {screenSources.length > 0 && (
              <select
                className="workspace-source-select"
                aria-label="Focused desktop source"
                value={primarySource?.id || ""}
                onChange={(e) => focusSource(e.target.value)}
              >
                {screenSources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name}
                  </option>
                ))}
              </select>
            )}
            <button
              className="icon-button"
              aria-label={
                sessionActive
                  ? "Pause AI"
                  : snapshot.session === "paused"
                    ? "Resume watching"
                    : "Start watching"
              }
              title={sessionActive ? "Pause AI" : "Start AI watching"}
              disabled={
                !bridge ||
                (!sessionActive && !canStart) ||
                pending.includes("monitor.start")
              }
              onClick={() =>
                void run({
                  type: sessionActive ? "monitor.pause" : "monitor.start",
                })
              }
            >
              {sessionActive ? <Pause size={15} /> : <Play size={15} />}
            </button>
          </div>
        )}
        <div className="topbar-right">
          <span
            className={`status-pill ${sessionActive || live.length ? "good" : "warning"}`}
            title={sessionActive ? "AI watching" : "AI is idle"}
          >
            <span className="dot" />
            {sessionActive
              ? "Watching"
              : snapshot.session === "paused"
                ? "AI paused"
                : live.length
                  ? `${live.length} live`
                  : "Standby"}
          </span>
          <span className="memory-badge">
            <LockKeyhole size={14} /> Local · Memory only
          </span>
          {tab === "Overview" && (
            <button
              className="icon-button"
              aria-label="Reset dashboard layout"
              title="Reset workspace layout"
              onClick={() => setLayoutResetRevision((value) => value + 1)}
            >
              <RefreshCw size={15} />
            </button>
          )}
          <button
            className="button secondary background-button"
            disabled={
              !bridge || !desktopState || pending.includes("background")
            }
            title={
              desktopState?.backgroundMode
                ? "Leave background mode. Closing the window will quit OpenAware."
                : "Hide the dashboard and keep this session running in the system tray. Tray controls can show, stop, or quit it."
            }
            onClick={async () => {
              if (!bridge || !desktopState) return;
              setPending((items) => [...items, "background"]);
              try {
                setDesktopState(
                  await bridge.setBackgroundMode(!desktopState.backgroundMode),
                );
              } catch (error) {
                report(error instanceof Error ? error.message : String(error));
              } finally {
                setPending((items) =>
                  items.filter((item) => item !== "background"),
                );
              }
            }}
          >
            <Minimize2 size={15} />
            {desktopState?.backgroundMode ? "Window mode" : "Background"}
          </button>
          <button
            data-testid="stop-all"
            className="button stop"
            disabled={
              !bridge ||
              (live.length === 0 &&
                !snapshot.agents.some(
                  (agent) => agent.session === "monitoring" || agent.busy,
                ) &&
                !snapshot.sources.some((s) => manager?.has(s.id))) ||
              pending.includes("stop")
            }
            onClick={() => void stopAll()}
          >
            <Square size={13} />
            Stop all
          </button>
          <button
            className="icon-button quit-button"
            aria-label="Quit OpenAware"
            title="Stop the session and quit OpenAware"
            disabled={!bridge}
            onClick={() =>
              void bridge?.quit().catch((error) => report(String(error)))
            }
          >
            <Power size={19} />
          </button>
        </div>
      </header>
      <div className="workspace">
        <main className={tab === "Overview" ? "overview-main" : ""}>
          {tab !== "Overview" && (
            <div className="page-heading">
              <div>
                <span className="eyebrow">OPENAWARE / {tab.toUpperCase()}</span>
                <h1>{tab}</h1>
                <p>{subtitle[tab]}</p>
              </div>
            </div>
          )}
          {!bridge && (
            <div className="inline-notice">
              <Monitor size={18} />
              <span>
                Open the desktop app to connect. This preview does not capture
                sources or contact a model.
              </span>
            </div>
          )}
          {snapshot.lastError && (
            <div className="inline-notice error">
              <Activity size={18} />
              <span>{snapshot.lastError}</span>
            </div>
          )}
          {tab === "Overview" && (
            <>
              <DockLayout
                name="dashboard"
                className="dashboard-dock-layout"
                defaultTree={workspaceTree}
                fitDefaultTree={(tree, size, minimums) =>
                  fitWorkspaceLayout(tree, snapshot.sources, size, minimums)
                }
                minimumDefaultHeight={(tree, size, minimums) =>
                  minimumWorkspaceHeight(tree, snapshot.sources, size, minimums)
                }
                resetKey={`${layoutResetRevision}/${sourceMembership}`}
                minimums={{
                  workspace: { width: 320, height: 200 },
                  assistant: { width: 300, height: 240 },
                  activity: { width: 260, height: 100 },
                  extra: { width: 260, height: 210 },
                  ...Object.fromEntries(
                    snapshot.sources.map((source) => [
                      source.id,
                      { width: 260, height: 200 },
                    ]),
                  ),
                }}
              >
                {snapshot.sources.length === 0 && (
                  <DockPane
                    id="workspace"
                    title="Live workspace"
                    icon={<Monitor size={17} />}
                    actions={addSourceControl}
                  >
                    <button
                      className="desktop-empty source-empty-trigger"
                      disabled={!bridge}
                      onClick={() => setAddOpen(true)}
                    >
                      <Monitor size={28} />
                      <span>Add a screen, camera or video</span>
                    </button>
                  </DockPane>
                )}
                {snapshot.sources.map((source) => {
                  const camera =
                    source.kind === "camera" ||
                    source.kind === "virtual_camera";
                  const presentation = camera
                    ? "camera"
                    : source.id === primarySource?.id
                      ? "primary"
                      : "secondary";
                  return (
                    <DockPane
                      key={source.id}
                      id={source.id}
                      title={source.name}
                      className={`source-pane ${source.id === sourceHeaderId ? "has-add-source" : ""}`}
                      testId="source-tile"
                      sourceId={source.id}
                      presentation={presentation}
                      icon={
                        camera ? <Camera size={17} /> : <Monitor size={17} />
                      }
                      actions={
                        <>
                          {source.id === sourceHeaderId && addSourceControl}
                          <span
                            className={`source-status ${source.status === "live" ? "good" : ""}`}
                            title={`${source.name}: ${source.status}`}
                          >
                            <span className="dot" />
                            {source.status === "live"
                              ? "LIVE"
                              : source.status === "unavailable"
                                ? "UNAVAILABLE"
                                : "STOPPED"}
                          </span>
                          {!camera && source.id !== primarySource?.id && (
                            <button
                              className="icon-button focus-source"
                              aria-label={`Focus ${source.name}`}
                              title="Focus this feed"
                              onClick={() => focusSource(source.id)}
                            >
                              <ArrowUpRight size={15} />
                            </button>
                          )}
                        </>
                      }
                    >
                      {renderSource(source, presentation)}
                    </DockPane>
                  );
                })}
                <DockPane
                  id="extra"
                  title={lowerPanel === "desk" ? "Agent desk" : "Video memory"}
                  icon={
                    lowerPanel === "desk" ? (
                      <Bot size={17} />
                    ) : (
                      <Clock3 size={17} />
                    )
                  }
                  className="agent-desk-pane"
                  actions={
                    <>
                      <button
                        className="text-button"
                        data-testid="add-agent"
                        aria-label="Add agent"
                        disabled={
                          !bridge || snapshot.agents.length >= MAX_AGENTS
                        }
                        title={`${snapshot.agents.length}/${MAX_AGENTS} agents`}
                        onClick={() => setAgentDialog("new")}
                      >
                        <Plus size={13} />
                        <span className="desk-action-full">Add agent</span>
                        <span className="desk-action-short" aria-hidden="true">
                          Add
                        </span>
                      </button>
                      <button
                        className="text-button"
                        data-testid="switch-lower-panel"
                        aria-label={
                          lowerPanel === "desk" ? "Video memory" : "Agent desk"
                        }
                        title={
                          lowerPanel === "desk"
                            ? "Show video memory"
                            : "Show agent desk"
                        }
                        onClick={() =>
                          setLowerPanel((value) =>
                            value === "desk" ? "memory" : "desk",
                          )
                        }
                      >
                        {lowerPanel === "desk" ? (
                          <Clock3 size={13} />
                        ) : (
                          <Bot size={13} />
                        )}
                        <span className="desk-action-full">
                          {lowerPanel === "desk"
                            ? "Video memory"
                            : "Agent desk"}
                        </span>
                        <span className="desk-action-short" aria-hidden="true">
                          {lowerPanel === "desk" ? "Memory" : "Desk"}
                        </span>
                      </button>
                    </>
                  }
                >
                  <div
                    className="lower-pane-view desk-view"
                    hidden={lowerPanel !== "desk"}
                  >
                    <AgentDesk
                      seats={buildAgentDeskSeats(snapshot, !!bridge)}
                      onSelect={(id) =>
                        void run({ type: "agent.select", agentId: id })
                      }
                      onEdit={setAgentDialog}
                      onToggleWatching={(id, monitoring) =>
                        void run({
                          type: monitoring ? "monitor.pause" : "monitor.start",
                          agentId: id,
                        })
                      }
                      onConfigure={(id) =>
                        void run({ type: "agent.select", agentId: id }).then(
                          (state) => {
                            if (state) setTab("Connections");
                          },
                        )
                      }
                    />
                  </div>
                  <div
                    className="lower-pane-view"
                    hidden={lowerPanel !== "memory"}
                  >
                    <VideoMemory
                      key={snapshot.activeAgentId}
                      snapshot={agentSnapshot}
                      run={run}
                      pending={pending}
                      report={report}
                    />
                  </div>
                </DockPane>
                <DockPane
                  id="assistant"
                  title={activeAgent?.name || "Workspace assistant"}
                  icon={<Bot size={17} />}
                  actions={
                    <button
                      className="session-model"
                      onClick={() => setTab("Connections")}
                      title={`${snapshot.binding.modelId || "Connect a local vision model"} · ${snapshot.binding.status === "verified" ? "Verified" : "Not verified"}`}
                    >
                      <Cpu size={13} />
                      <span>{snapshot.binding.modelId || "Connect model"}</span>
                      <ChevronRight size={12} />
                    </button>
                  }
                >
                  <Conversation
                    key={snapshot.activeAgentId}
                    snapshot={agentSnapshot}
                    run={run}
                    pending={pending}
                    text={questionDraft}
                    setText={setQuestionDraft}
                    excluded={excludedQuestionSources}
                    setExcluded={setExcludedQuestionSources}
                  />
                </DockPane>
                <DockPane
                  id="activity"
                  title="Recent activity"
                  icon={<Activity size={17} />}
                  actions={
                    <button
                      className="icon-button"
                      aria-label="View all"
                      title="View event log"
                      onClick={() => setTab("Event log")}
                    >
                      <ArrowUpRight size={15} />
                    </button>
                  }
                >
                  <section
                    className="panel overview-activity"
                    aria-label="Recent activity"
                  >
                    <div className="activity-list">
                      {snapshot.events.length === 0 ? (
                        <div className="empty-activity">
                          <Radio size={18} />
                          <span>No events</span>
                        </div>
                      ) : (
                        snapshot.events
                          .slice(-4)
                          .reverse()
                          .map((event) => (
                            <div className="activity-row" key={event.id}>
                              <span className={`event-icon ${event.type}`}>
                                <Activity size={15} />
                              </span>
                              <div>
                                <p>{event.message}</p>
                                <span>
                                  {event.type} · {time(event.occurredAt)}
                                </span>
                              </div>
                              {!event.acknowledged && (
                                <button
                                  className="icon-button"
                                  aria-label="Acknowledge event"
                                  onClick={() =>
                                    void run({
                                      type: "events.ack",
                                      eventId: event.id,
                                    })
                                  }
                                >
                                  <Check size={15} />
                                </button>
                              )}
                            </div>
                          ))
                      )}
                    </div>
                  </section>
                </DockPane>
              </DockLayout>
            </>
          )}
          {tab === "Connections" && (
            <Connections
              key={snapshot.activeAgentId}
              snapshot={snapshot}
              run={run}
              pending={pending}
              report={report}
              apply={apply}
            />
          )}
          {tab === "Operator" && (
            <Operator
              key={snapshot.activeAgentId}
              snapshot={agentSnapshot}
              bridge={bridge}
              run={run}
              pending={pending}
              report={report}
            />
          )}
          {tab === "Event log" && (
            <div className="panel events-panel">
              <div className="panel-heading">
                <div>
                  <h2>Session events</h2>
                  <p>
                    {snapshot.events.length} events · bounded, in-memory history
                  </p>
                </div>
                <button
                  className="button secondary"
                  disabled={!bridge || !snapshot.events.length}
                  onClick={() => void run({ type: "history.clear" })}
                >
                  <Trash2 size={15} />
                  Clear history
                </button>
              </div>
              {snapshot.events.length ? (
                <div
                  className="event-table"
                  role="table"
                  aria-label="Session events"
                >
                  <div className="event-table-heading" role="row">
                    <span>TIME</span>
                    <span>TYPE</span>
                    <span>DETAIL</span>
                    <span>REVIEW</span>
                  </div>
                  {[...snapshot.events].reverse().map((event) => (
                    <div className="event-table-row" role="row" key={event.id}>
                      <time>{time(event.occurredAt)}</time>
                      <span className={`event-type ${event.type}`}>
                        {event.type}
                      </span>
                      <p>{event.message}</p>
                      <button
                        className={`button tiny ${event.acknowledged ? "quiet" : "secondary"}`}
                        disabled={event.acknowledged}
                        onClick={() =>
                          void run({ type: "events.ack", eventId: event.id })
                        }
                      >
                        {event.acknowledged ? "Reviewed" : "Acknowledge"}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="large-empty">
                  <Terminal size={32} />
                  <h3>A fresh session</h3>
                  <p>
                    Source changes, observations, motion and semantic alerts,
                    and action results appear here.
                  </p>
                </div>
              )}
            </div>
          )}
          <footer className="workspace-footer">
            <span>
              <span className={`tiny-dot ${sessionActive ? "live" : ""}`} />{" "}
              {snapshot.busy
                ? "Model is processing"
                : sessionActive
                  ? "Watching selected sources"
                  : "Ready when you are"}
              {snapshot.queueSize > 0 && ` · ${snapshot.queueSize} waiting`}
            </span>
            <span>Open source. Yours to control.</span>
          </footer>
        </main>
      </div>
      {addOpen && (
        <AddSourceDialog
          bridge={bridge}
          onClose={() => setAddOpen(false)}
          onAdd={addSource}
        />
      )}
      {agentDialog && (
        <AgentDialog
          key={agentDialog}
          agent={snapshot.agents.find((agent) => agent.id === agentDialog)}
          sources={snapshot.sources}
          count={snapshot.agents.length}
          run={run}
          onClose={() => setAgentDialog(undefined)}
        />
      )}
      {maskSource && (
        <MaskDialog
          source={
            snapshot.sources.find((s) => s.id === maskSource.id) || maskSource
          }
          blocked={manager?.info(maskSource.id)?.blocked || false}
          onClose={() => setMaskSource(undefined)}
          onSave={async (masks) => {
            const result = await run({
              type: "source.update",
              sourceId: maskSource.id,
              patch: { masks, error: "" },
            });
            if (result) {
              manager?.reviewMasks(maskSource.id);
              setMaskSource(undefined);
            }
          }}
        />
      )}
      {notice && (
        <div className="toast" role="alert">
          <Activity size={18} />
          <span>{notice}</span>
          <button
            className="icon-button"
            onClick={() => setNotice(undefined)}
            aria-label="Dismiss notification"
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-label">
        {icon}
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      <p title={detail}>{detail}</p>
    </div>
  );
}

function SourceTile({
  source,
  embedded = false,
  presentation,
  onFocus,
  info,
  observation,
  pending,
  onConnect,
  onDisconnect,
  onRemove,
  onMasks,
  onOpenPlayer,
  onToggle,
}: {
  source: Source;
  embedded?: boolean;
  presentation: "primary" | "secondary" | "camera";
  onFocus?: () => void;
  info: ReturnType<CaptureManager["info"]>;
  observation?: Snapshot["observations"][number];
  pending: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onRemove: () => void;
  onMasks: () => void;
  onOpenPlayer?: () => void;
  onToggle: (key: "analysisEnabled" | "motionEnabled", value: boolean) => void;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const articleRef = useRef<HTMLElement>(null);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!settingsOpen) return;
    const outside = (event: PointerEvent) => {
      if (!articleRef.current?.contains(event.target as Node))
        setSettingsOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSettingsOpen(false);
        settingsTrigger.current?.focus();
      }
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", escape);
    };
  }, [settingsOpen]);
  useEffect(() => {
    const video = videoRef.current;
    if (video && info?.stream) {
      video.srcObject = info.stream;
      void video.play().catch(() => {});
    }
    return () => {
      if (video) video.srcObject = null;
    };
  }, [info?.stream]);
  useEffect(() => {
    if (!info?.canvas) return;
    let animation: number;
    const draw = () => {
      const canvas = canvasRef.current;
      if (canvas && info.canvas) {
        if (
          canvas.width !== info.canvas.width ||
          canvas.height !== info.canvas.height
        ) {
          canvas.width = info.canvas.width;
          canvas.height = info.canvas.height;
        }
        canvas.getContext("2d")?.drawImage(info.canvas, 0, 0);
      }
      animation = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(animation);
  }, [info?.canvas]);
  const icon =
    source.kind === "camera" || source.kind === "virtual_camera" ? (
      <Camera size={17} />
    ) : source.kind === "demo" ? (
      <Aperture size={17} />
    ) : (
      <Monitor size={17} />
    );
  return (
    <article
      ref={articleRef}
      data-testid={embedded ? undefined : "source-tile"}
      data-source-id={source.id}
      data-presentation={presentation}
      className={`source-tile ${presentation} ${presentation !== "camera" ? "desktop-feed" : ""}`}
      style={{ "--source-aspect": sourceAspectRatio(source) } as CSSProperties}
    >
      {!embedded && (
        <div className="source-title">
          <div>
            {icon}
            <h3>{source.name}</h3>
          </div>
          <span
            className={`source-status ${source.status === "live" ? "good" : ""}`}
          >
            <span className="dot" />
            {source.status === "live"
              ? "LIVE"
              : source.status === "unavailable"
                ? "UNAVAILABLE"
                : "STOPPED"}
          </span>
          {onFocus && (
            <button
              className="icon-button focus-source"
              onClick={onFocus}
              aria-label={`Focus ${source.name}`}
              title="Focus this feed"
            >
              <ArrowUpRight size={17} />
            </button>
          )}
        </div>
      )}
      <div className="source-preview">
        {info?.stream ? (
          <video
            ref={videoRef}
            muted
            playsInline
            aria-label={`${source.name} live preview`}
          />
        ) : info?.canvas ? (
          <canvas
            ref={canvasRef}
            aria-label={
              source.kind === "demo"
                ? "Animated synthetic demo preview"
                : `${source.name} live preview`
            }
          />
        ) : (
          <div className="preview-off">
            {icon}
            <span>{source.error || "Source is disconnected"}</span>
          </div>
        )}
        <div className="preview-top">
          {source.kind === "demo" && (
            <span className="preview-label">SYNTHETIC DEMO</span>
          )}
          {source.masks.length > 0 && (
            <span className="preview-label">
              <ShieldCheck size={11} />
              {source.masks.length} MASK{source.masks.length > 1 ? "S" : ""}
            </span>
          )}
        </div>
        {source.width && (
          <div className="preview-bottom">
            <span>
              {source.width} × {source.height}
              {source.fps ? ` · ${Math.round(source.fps)} fps` : ""}
            </span>
            <span>Preview {age(info?.previewAt)}</span>
          </div>
        )}
      </div>
      {info?.blocked && (
        <div className="mask-warning">Review masks after size change.</div>
      )}
      {settingsOpen && (
        <div
          className="source-settings"
          role="group"
          aria-label={`Source settings for ${source.name}`}
          id={`settings-${source.id}`}
        >
          <label
            className="toggle-label"
            title="Shared source policy: applies to every assigned agent"
          >
            <input
              type="checkbox"
              checked={source.analysisEnabled}
              disabled={info?.blocked}
              onChange={(e) => onToggle("analysisEnabled", e.target.checked)}
            />
            <span className="toggle" /> AI analysis
          </label>
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={source.motionEnabled}
              disabled={info?.blocked}
              onChange={(e) => onToggle("motionEnabled", e.target.checked)}
            />
            <span className="toggle" /> Motion alerts
          </label>
          <button
            className="text-button"
            aria-label={`Privacy masks for ${source.name}`}
            title="Privacy masks"
            onClick={() => {
              setSettingsOpen(false);
              onMasks();
            }}
          >
            <ShieldCheck size={16} />
            Privacy masks
          </button>
        </div>
      )}
      <div className="source-bottom">
        <span
          className="source-evidence"
          title={
            observation
              ? `Analyzed ${analyzedWindow(observation)} · ${age(observation.capturedAt)} · ${observation.status}`
              : "AI not sampled"
          }
        >
          <Eye size={13} />
          {observation
            ? `${observation.frameCount ?? 1}f · ${Math.max(0, (observation.capturedAt - (observation.captureStartAt ?? observation.capturedAt)) / 1000).toFixed(1)}s · ${age(observation.capturedAt)}`
            : "—"}
        </span>
        <div>
          {onOpenPlayer && (
            <button
              className="text-button"
              title={
                source.kind === "web_video"
                  ? "Play or sign in in the isolated video page"
                  : "Open playback controls"
              }
              onClick={onOpenPlayer}
            >
              Open player
            </button>
          )}
          <button
            ref={settingsTrigger}
            className="icon-button"
            aria-label={`Settings for ${source.name}`}
            aria-expanded={settingsOpen}
            aria-controls={`settings-${source.id}`}
            title="Source settings"
            onClick={() => setSettingsOpen((open) => !open)}
          >
            <Settings2 size={15} />
          </button>
          <button
            className="text-button"
            disabled={pending}
            onClick={source.status === "live" ? onDisconnect : onConnect}
          >
            {pending
              ? "Connecting…"
              : source.status === "live"
                ? "Disconnect"
                : "Connect"}
          </button>
          <button
            className="icon-button"
            aria-label={`Remove ${source.name}`}
            onClick={onRemove}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </article>
  );
}

function Conversation({
  snapshot,
  run,
  pending,
  text,
  setText,
  excluded,
  setExcluded,
}: {
  snapshot: Snapshot;
  run: (command: Command, label?: string) => Promise<Snapshot | undefined>;
  pending: string[];
  text: string;
  setText: React.Dispatch<React.SetStateAction<string>>;
  excluded: string[];
  setExcluded: React.Dispatch<React.SetStateAction<string[]>>;
}) {
  const selected = snapshot.sources
    .filter(
      (source) => source.status === "live" && !excluded.includes(source.id),
    )
    .map((source) => source.id);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [sourceMenuHeight, setSourceMenuHeight] = useState(155);
  const composeRef = useRef<HTMLFormElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const sourcesTrigger = useRef<HTMLButtonElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const history = historyRef.current;
    if (!history) return;
    const resize = () =>
      setSourceMenuHeight(
        Math.max(28, Math.min(155, history.clientHeight + 5)),
      );
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(history);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!sourcesOpen) return;
    const outside = (event: PointerEvent) => {
      if (!composeRef.current?.contains(event.target as Node))
        setSourcesOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSourcesOpen(false);
        sourcesTrigger.current?.focus();
      }
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", escape);
    };
  }, [sourcesOpen]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [snapshot.chat.length]);
  const asking = pending.includes("conversation.ask");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (
      !text.trim() ||
      asking ||
      !selected.length ||
      snapshot.binding.status !== "verified"
    )
      return;
    const submittedText = text;
    const result = await run({
      type: "conversation.ask",
      text: submittedText,
      sourceIds: selected,
    });
    if (result) setText((draft) => (draft === submittedText ? "" : draft));
  }
  return (
    <section
      className="panel conversation-panel"
      aria-label="Ask your workspace"
    >
      <div className="chat-body" ref={historyRef}>
        {snapshot.chat.map((message) => (
          <div className={`chat-message ${message.role}`} key={message.id}>
            <div className="message-heading">
              <strong>{message.role === "user" ? "You" : "OpenAware"}</strong>
              <time>{time(message.at)}</time>
            </div>
            <p>{message.text}</p>
            {message.observation && (
              <span className="evidence-caption">
                Analyzed {analyzedWindow(message.observation)} ·{" "}
                {age(message.observation.capturedAt)} ·{" "}
                {message.observation.status}
              </span>
            )}
          </div>
        ))}
        {asking && (
          <div className="chat-waiting">
            <span className="pulse-dot" /> Looking at selected sources…
            <button
              className="text-button"
              onClick={() => void run({ type: "conversation.cancel" })}
            >
              Cancel
            </button>
          </div>
        )}
        <div ref={bottom} />
      </div>
      <form
        ref={composeRef}
        className="chat-compose"
        onSubmit={(e) => void submit(e)}
      >
        <div className="chat-compose-tools">
          <button
            ref={sourcesTrigger}
            type="button"
            className="text-button question-sources-button"
            aria-label="Choose question sources"
            aria-expanded={sourcesOpen}
            aria-controls="question-sources-menu"
            onClick={() => setSourcesOpen((open) => !open)}
          >
            <Layers3 size={13} /> Sources ({selected.length})
          </button>
        </div>
        {sourcesOpen && (
          <div
            className="question-sources-menu"
            style={{ maxHeight: sourceMenuHeight }}
            id="question-sources-menu"
            role="group"
            aria-label="Question sources"
          >
            {snapshot.sources
              .filter((s) => s.status === "live")
              .map((s) => (
                <label key={s.id} className="question-source-option">
                  <input
                    type="checkbox"
                    checked={selected.includes(s.id)}
                    onChange={(event) =>
                      setExcluded((ids) =>
                        event.target.checked
                          ? ids.filter((id) => id !== s.id)
                          : [...new Set([...ids, s.id])],
                      )
                    }
                  />
                  {s.name}
                </label>
              ))}
            {!snapshot.sources.some((s) => s.status === "live") && (
              <span className="muted small">No live sources</span>
            )}
          </div>
        )}
        <div className="input-composer">
          <textarea
            aria-label="Ask about your workspace"
            placeholder="Ask about your workspace…"
            maxLength={4000}
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing &&
                e.keyCode !== 229
              ) {
                e.preventDefault();
                void submit(e);
              }
            }}
          />
          <button
            type="submit"
            className="send-button"
            aria-label="Send question"
            disabled={
              asking ||
              !selected.length ||
              !text.trim() ||
              snapshot.binding.status !== "verified"
            }
          >
            <Send size={17} />
          </button>
        </div>
      </form>
    </section>
  );
}

function VideoMemory({
  snapshot,
  run,
  pending,
  report,
}: {
  snapshot: Snapshot;
  run: (command: Command, label?: string) => Promise<Snapshot | undefined>;
  pending: string[];
  report: (message: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [range, setRange] = useState("session");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [results, setResults] = useState<CaptionSearchResult>();
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string>();
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current += 1;
    },
    [],
  );
  useEffect(() => {
    if (
      sourceId &&
      !snapshot.sources.some((source) => source.id === sourceId)
    ) {
      setSourceId("");
      request.current += 1;
      setResults(undefined);
      setSearching(false);
    }
  }, [sourceId, snapshot.sources]);
  const resetSearch = () => {
    request.current += 1;
    setResults(undefined);
    setSearching(false);
    setError(undefined);
  };
  const scope = () => {
    const start =
      range === "custom" && from
        ? new Date(from).getTime()
        : range === "5" || range === "15"
          ? Date.now() - Number(range) * 60_000
          : undefined;
    const end = range === "custom" && to ? new Date(to).getTime() : undefined;
    if (
      (start !== undefined && (!Number.isFinite(start) || start < 0)) ||
      (end !== undefined && (!Number.isFinite(end) || end < 0)) ||
      (start !== undefined && end !== undefined && start > end)
    )
      throw new Error("Choose a valid historical time range.");
    return {
      ...(sourceId ? { sourceIds: [sourceId] } : {}),
      ...(start !== undefined ? { from: start } : {}),
      ...(end !== undefined ? { to: end } : {}),
    };
  };
  let filters: ReturnType<typeof scope> | undefined;
  try {
    filters = scope();
  } catch {
    /* Invalid custom scope has no displayed matches. */
  }
  const matchesScope = (
    observation: Pick<
      Observation,
      "sourceIds" | "capturedAt" | "captureStartAt"
    >,
  ) =>
    !!filters &&
    (!sourceId || observation.sourceIds.every((id) => id === sourceId)) &&
    (filters.from === undefined || observation.capturedAt >= filters.from) &&
    (filters.to === undefined ||
      (observation.captureStartAt ?? observation.capturedAt) <= filters.to);
  const retained = new Set(
    snapshot.observations.map((observation) => observation.id),
  );
  const captions = (
    results
      ? results.matches
          .map((match) => match.observation)
          .filter((observation) => retained.has(observation.id))
      : snapshot.observations
  )
    .filter(matchesScope)
    .sort((a, b) => b.capturedAt - a.capturedAt)
    .slice(0, 50);
  const available = snapshot.observations.filter(matchesScope).length;
  const summary = snapshot.historySummary;
  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (!window.openAware || !query.trim()) return;
    const revision = ++request.current;
    setSearching(true);
    setError(undefined);
    try {
      const found = await window.openAware.invoke<CaptionSearchResult>({
        type: "history.search",
        agentId: snapshot.activeAgentId,
        query: query.trim(),
        ...scope(),
        limit: 50,
      });
      if (revision === request.current) setResults(found);
    } catch (failure) {
      if (revision === request.current)
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (revision === request.current) setSearching(false);
    }
  }
  async function summarize() {
    try {
      await run({ type: "history.summarize", ...scope() });
    } catch (failure) {
      report(failure instanceof Error ? failure.message : String(failure));
    }
  }
  return (
    <section className="video-memory" aria-label="Video memory">
      <form className="memory-toolbar" onSubmit={(event) => void search(event)}>
        <input
          type="search"
          aria-label="Search captions"
          placeholder="Search captions…"
          maxLength={512}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            resetSearch();
          }}
        />
        <button
          className="icon-button"
          aria-label="Search captions"
          title="Search captions"
          disabled={!window.openAware || !query.trim() || searching}
        >
          <Search size={15} />
        </button>
      </form>
      <div className="memory-scope">
        <select
          aria-label="Memory source"
          value={sourceId}
          onChange={(event) => {
            setSourceId(event.target.value);
            resetSearch();
          }}
        >
          <option value="">All sources</option>
          {snapshot.sources.map((source) => (
            <option key={source.id} value={source.id}>
              {source.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Memory time range"
          value={range}
          onChange={(event) => {
            setRange(event.target.value);
            resetSearch();
          }}
        >
          <option value="session">This session</option>
          <option value="5">Last 5 minutes</option>
          <option value="15">Last 15 minutes</option>
          <option value="custom">Custom range</option>
        </select>
        <button
          className="text-button"
          title="Summarize the selected historical source and time scope"
          disabled={
            !window.openAware ||
            !available ||
            !filters ||
            snapshot.session === "stopped" ||
            snapshot.binding.status !== "verified" ||
            pending.includes("history.summarize") ||
            summary?.status === "queued" ||
            summary?.status === "running"
          }
          onClick={() => void summarize()}
        >
          Summarize history
        </button>
      </div>
      {range === "custom" && (
        <div className="memory-time-inputs">
          <input
            type="datetime-local"
            step="1"
            aria-label="Memory from"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              resetSearch();
            }}
          />
          <input
            type="datetime-local"
            step="1"
            aria-label="Memory to"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
              resetSearch();
            }}
          />
        </div>
      )}
      {error && (
        <p className="memory-error" role="alert">
          {error}
        </p>
      )}
      <div className="memory-results">
        {summary && matchesScope(summary) && (
          <section
            className="memory-summary"
            aria-label="Historical summary"
            aria-live="polite"
          >
            <div className="memory-record-meta">
              <strong>Historical summary</strong>
              <span>{summary.status}</span>
            </div>
            <p>
              {summary.summary ||
                summary.error ||
                (summary.status === "queued" || summary.status === "running"
                  ? "Summarizing captions…"
                  : summary.status === "failed"
                    ? "Summary failed"
                    : summary.status === "completed"
                      ? "No summary text"
                      : "Summary cancelled")}
            </p>
            <span className="memory-record-meta">
              {summary.sourceNames.join(", ")} · {time(summary.captureStartAt)}–
              {time(summary.capturedAt)} · {summary.observationIds.length}{" "}
              captions · {summary.modelId}
            </span>
          </section>
        )}
        {captions.length ? (
          <ol className="memory-caption-list" aria-label="Historical captions">
            {captions.map((observation) => (
              <li
                className="memory-caption-row"
                key={observation.id}
                data-observation-id={observation.id}
              >
                <div className="memory-record-meta">
                  <strong>{observation.sourceNames.join(", ")}</strong>
                  <span>
                    {analyzedWindow(observation)} ·{" "}
                    {age(observation.capturedAt)}
                  </span>
                </div>
                <p>{observation.summary}</p>
                <span className="memory-record-meta">
                  {providerLabels[observation.provider]} · {observation.modelId}
                  {observation.ruleEvidence
                    ?.map(
                      (evidence) =>
                        ` · ${snapshot.pipeline.rules.find((rule) => rule.id === evidence.ruleId && rule.revision === evidence.ruleRevision)?.name || "Rule"} r${evidence.ruleRevision}: ${evidence.verdict}`,
                    )
                    .join("")}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="memory-empty">
            {searching ? "Searching captions…" : "No captions in this scope"}
          </p>
        )}
      </div>
    </section>
  );
}

function PipelineSettings({
  snapshot,
  run,
  pending,
}: {
  snapshot: Snapshot;
  run: (command: Command, label?: string) => Promise<Snapshot | undefined>;
  pending: string[];
}) {
  const [editing, setEditing] = useState<string>();
  const [name, setName] = useState("");
  const [condition, setCondition] = useState("");
  const [sources, setSources] = useState<string[]>([]);
  const saving = pending.includes("rule.save");
  const reset = () => {
    setEditing(undefined);
    setName("");
    setCondition("");
    setSources([]);
  };
  useEffect(() => {
    setSources((selected) =>
      selected.every((id) =>
        snapshot.sources.some((source) => source.id === id),
      )
        ? selected
        : selected.filter((id) =>
            snapshot.sources.some((source) => source.id === id),
          ),
    );
  }, [snapshot.sources]);
  useEffect(() => {
    if (editing && !snapshot.pipeline.rules.some((rule) => rule.id === editing))
      reset();
  }, [editing, snapshot.pipeline.rules]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    const result = await run(
      editing
        ? {
            type: "rule.update",
            ruleId: editing,
            patch: {
              name: name.trim(),
              condition: condition.trim(),
              sourceIds: sources,
            },
          }
        : {
            type: "rule.add",
            name: name.trim(),
            condition: condition.trim(),
            sourceIds: sources,
          },
      "rule.save",
    );
    if (result) reset();
  }
  return (
    <section className="panel pipeline-panel" aria-label="Monitoring pipeline">
      <div className="pipeline-heading">
        <h2>Monitoring</h2>
        <span className="muted small">Local</span>
      </div>
      <label className="temporal-setting">
        <input
          type="checkbox"
          checked={snapshot.pipeline.temporalEnabled}
          disabled={!window.openAware || pending.includes("pipeline.configure")}
          onChange={(event) =>
            void run({
              type: "pipeline.configure",
              temporalEnabled: event.target.checked,
            })
          }
        />{" "}
        Temporal monitoring
      </label>
      <span className="pipeline-note">
        {snapshot.pipeline.temporalEnabled
          ? "Up to 3 frames / 4 seconds per source"
          : "One frame per observation"}
      </span>
      <div className="pipeline-heading">
        <h3>Semantic rules</h3>
        <span className="muted small">{snapshot.pipeline.rules.length}/8</span>
      </div>
      {snapshot.pipeline.rules.length > 0 && (
        <ul className="semantic-rule-list">
          {snapshot.pipeline.rules.map((rule) => (
            <li key={rule.id} className="semantic-rule-row">
              <div>
                <strong>{rule.name}</strong>
                <span className={`rule-status ${rule.status}`}>
                  {rule.enabled ? rule.status : "disabled"}
                </span>
                <p>{rule.condition}</p>
                <span className="memory-record-meta">
                  {rule.sourceIds
                    .map(
                      (id) =>
                        snapshot.sources.find((source) => source.id === id)
                          ?.name || "Removed source",
                    )
                    .join(", ")}{" "}
                  ·{" "}
                  {rule.lastEvaluatedAt
                    ? age(rule.lastEvaluatedAt)
                    : "Not evaluated"}
                </span>
              </div>
              <div className="semantic-rule-actions">
                <input
                  type="checkbox"
                  aria-label={`Enable ${rule.name}`}
                  checked={rule.enabled}
                  disabled={
                    !window.openAware ||
                    pending.includes(`rule.toggle/${rule.id}`)
                  }
                  onChange={(event) =>
                    void run(
                      {
                        type: "rule.update",
                        ruleId: rule.id,
                        patch: { enabled: event.target.checked },
                      },
                      `rule.toggle/${rule.id}`,
                    )
                  }
                />
                <button
                  className="text-button"
                  aria-label={`Edit ${rule.name}`}
                  disabled={saving}
                  onClick={() => {
                    setEditing(rule.id);
                    setName(rule.name);
                    setCondition(rule.condition);
                    setSources(
                      rule.sourceIds.filter((id) =>
                        snapshot.sources.some((source) => source.id === id),
                      ),
                    );
                  }}
                >
                  Edit
                </button>
                <button
                  className="icon-button"
                  aria-label={`Remove rule ${rule.name}`}
                  disabled={
                    !window.openAware ||
                    pending.includes(`rule.remove/${rule.id}`)
                  }
                  onClick={() =>
                    void run(
                      { type: "rule.remove", ruleId: rule.id },
                      `rule.remove/${rule.id}`,
                    )
                  }
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form
        className="semantic-rule-form"
        onSubmit={(event) => void save(event)}
      >
        <input
          aria-label="Rule name"
          placeholder="Rule name"
          maxLength={80}
          required
          disabled={saving}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <textarea
          aria-label="Rule condition"
          placeholder="Describe the condition to watch…"
          maxLength={512}
          rows={2}
          required
          disabled={saving}
          value={condition}
          onChange={(event) => setCondition(event.target.value)}
        />
        <div
          className="rule-source-options"
          role="group"
          aria-label="Rule sources"
        >
          {snapshot.sources.map((source) => (
            <label key={source.id}>
              <input
                type="checkbox"
                checked={sources.includes(source.id)}
                disabled={saving}
                onChange={(event) =>
                  setSources((selected) =>
                    event.target.checked
                      ? [...selected, source.id]
                      : selected.filter((id) => id !== source.id),
                  )
                }
              />
              {source.name}
            </label>
          ))}
          {!snapshot.sources.length && (
            <span className="muted small">Add a source to create a rule</span>
          )}
        </div>
        <div className="semantic-rule-save">
          <button
            className="button secondary"
            disabled={
              !window.openAware ||
              !name.trim() ||
              !condition.trim() ||
              !sources.length ||
              saving ||
              (!editing && snapshot.pipeline.rules.length >= 8)
            }
          >
            {editing ? "Save rule" : "Add rule"}
          </button>
          {editing && (
            <button
              type="button"
              className="text-button"
              disabled={saving}
              onClick={reset}
            >
              Cancel edit
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

function Connections({
  snapshot,
  run,
  pending,
  report,
  apply,
}: {
  snapshot: Snapshot;
  run: (command: Command, label?: string) => Promise<Snapshot | undefined>;
  pending: string[];
  report: (message: string) => void;
  apply: (state: Snapshot) => void;
}) {
  const [provider, setProvider] = useState<ProviderKind>(
    snapshot.binding.provider,
  );
  const [endpoint, setEndpoint] = useState(snapshot.binding.endpoint);
  const [token, setToken] = useState("");
  const [probing, setProbing] = useState(false);
  const [showProbe, setShowProbe] = useState(false);
  async function probe() {
    const bridge = window.openAware;
    if (!bridge) return;
    setProbing(true);
    try {
      const source: Source = {
        id: crypto.randomUUID(),
        name: "Synthetic vision test",
        kind: "demo",
        deviceId: "synthetic-probe",
        revision: 1,
        status: "stopped",
        analysisEnabled: false,
        motionEnabled: false,
        masks: [],
      };
      const frame = createProbe(source);
      apply(
        await bridge.invoke({
          type: "provider.probe",
          agentId: snapshot.activeAgentId,
          frame,
        }),
      );
    } catch (error) {
      report(error instanceof Error ? error.message : String(error));
    } finally {
      setProbing(false);
    }
  }
  return (
    <div className="connections-layout">
      <section className="panel connection-panel">
        <div className="panel-heading">
          <div>
            <h2>Model connection</h2>
            <p>Local inference, with a model you choose.</p>
          </div>
          <span className="small-badge">LOCAL</span>
        </div>
        <div className="provider-options">
          <button
            className={`provider-option ${provider === "lmstudio" ? "selected" : ""}`}
            aria-label="LM Studio"
            aria-pressed={provider === "lmstudio"}
            onClick={() => {
              setProvider("lmstudio");
              setEndpoint(providerEndpoints.lmstudio);
            }}
          >
            <span className="provider-icon">
              <Cpu size={25} />
            </span>
            <strong>LM Studio</strong>
            <span>Local model server</span>
            {provider === "lmstudio" && <CheckCircle2 size={17} />}
          </button>
          <button
            className={`provider-option ${provider === "ollama" ? "selected" : ""}`}
            aria-label="Ollama"
            aria-pressed={provider === "ollama"}
            onClick={() => {
              setProvider("ollama");
              setEndpoint(providerEndpoints.ollama);
            }}
          >
            <span className="provider-icon">
              <Bot size={25} />
            </span>
            <strong>Ollama</strong>
            <span>Local model runtime</span>
            {provider === "ollama" && <CheckCircle2 size={17} />}
          </button>
          <button
            className={`provider-option ${provider === "llamacpp" ? "selected" : ""}`}
            aria-label="llama.cpp"
            aria-pressed={provider === "llamacpp"}
            onClick={() => {
              setProvider("llamacpp");
              setEndpoint(providerEndpoints.llamacpp);
            }}
          >
            <span className="provider-icon">
              <Terminal size={25} />
            </span>
            <strong>llama.cpp</strong>
            <span>Local inference server</span>
            {provider === "llamacpp" && <CheckCircle2 size={17} />}
          </button>
        </div>
        <form
          className="connection-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run({
              type: "provider.discover",
              provider,
              endpoint,
              ...(token ? { token } : {}),
            });
          }}
        >
          <label>
            Server endpoint
            <input
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder={providerEndpoints[provider]}
              required
            />
          </label>
          <label>
            API token <span className="muted">optional · kept in memory</span>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Only if your local server requires one"
              autoComplete="off"
            />
          </label>
          <div className="connection-action">
            <span>
              <ShieldCheck size={15} />
              Only loopback endpoints are allowed in this build
            </span>
            <button
              className="button primary"
              disabled={
                !window.openAware || pending.includes("provider.discover")
              }
            >
              <RefreshCw size={15} />
              {pending.includes("provider.discover")
                ? "Discovering…"
                : "Discover models"}
            </button>
          </div>
        </form>
        <div className="models-area">
          <div className="section-heading">
            <h3>Available models</h3>
            <span className="muted small">{snapshot.models.length} found</span>
          </div>
          {snapshot.models.length ? (
            <div className="model-list">
              {snapshot.models.map((model) => (
                <button
                  className={`model-row ${snapshot.binding.modelId === model.id ? "selected" : ""}`}
                  key={model.id}
                  onClick={() =>
                    void run({ type: "provider.select", modelId: model.id })
                  }
                  disabled={model.vision === "unsupported" || probing}
                >
                  <span className="model-symbol">
                    <Cpu size={18} />
                  </span>
                  <span>
                    <strong>{model.name}</strong>
                    <span>{model.id}</span>
                  </span>
                  <span
                    className={`vision-label ${model.vision === "unsupported" ? "muted" : ""}`}
                  >
                    {model.vision === "declared"
                      ? "Vision declared"
                      : model.vision === "unknown"
                        ? "Test vision"
                        : "Text only"}
                  </span>
                  {snapshot.binding.modelId === model.id && (
                    <CheckCircle2 size={17} />
                  )}
                </button>
              ))}
            </div>
          ) : (
            <div className="model-empty">
              <Cpu size={24} />
              <p>Start your local server, then discover models.</p>
            </div>
          )}
        </div>
        <div className="vision-test">
          <div>
            <h3>Verify vision</h3>
            <p>
              The test sends a synthetic image: a red square, blue circle, and
              “OPENAWARE 42”. No private source is used.
            </p>
            <button
              className="text-button"
              onClick={() => setShowProbe((v) => !v)}
            >
              {showProbe ? "Hide test image" : "View test image"}
              <ChevronRight size={14} />
            </button>
          </div>
          <button
            className="button secondary"
            disabled={!window.openAware || !snapshot.binding.modelId || probing}
            onClick={() => void probe()}
          >
            <Eye size={16} />
            {probing ? "Testing vision…" : "Run vision test"}
          </button>
        </div>
        {showProbe && <ProbePreview />}
        <div
          className={`binding-status ${snapshot.binding.status === "verified" ? "verified" : ""}`}
        >
          <ShieldCheck size={17} />
          <span>
            {snapshot.binding.status === "verified"
              ? "Image response verified. Return to Overview and explicitly start watching."
              : snapshot.binding.error ||
                "Select a model and verify vision before AI analysis."}
          </span>
        </div>
      </section>
      <PipelineSettings
        snapshot={{
          ...snapshot,
          sources: snapshot.sources.filter((source) =>
            snapshot.agents
              .find((agent) => agent.id === snapshot.activeAgentId)
              ?.sourceIds.includes(source.id),
          ),
        }}
        run={run}
        pending={pending}
      />
    </div>
  );
}

function ProbePreview() {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (ref.current)
      ref.current.src = createProbe({
        id: crypto.randomUUID(),
        revision: 1,
      } as Source).dataUrl;
  }, []);
  return (
    <img
      className="probe-image"
      ref={ref}
      alt="Synthetic vision test showing a red square, blue circle, and OPENAWARE 42 text"
    />
  );
}

function Operator({
  snapshot,
  bridge,
  run,
  pending,
  report,
}: {
  snapshot: Snapshot;
  bridge?: OpenAwareBridge;
  run: (command: Command, label?: string) => Promise<Snapshot | undefined>;
  pending: string[];
  report: (message: string) => void;
}) {
  const [goal, setGoal] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [executing, setExecuting] = useState(false);
  const [results, setResults] =
    useState<Awaited<ReturnType<OpenAwareBridge["executePlan"]>>>();
  const sources = snapshot.sources.filter(
    (s) => s.status === "live" && s.kind === "monitor" && s.masks.length === 0,
  );
  const isOperator =
    snapshot.agents.find((agent) => agent.id === snapshot.activeAgentId)
      ?.role === "operator";
  const plan = snapshot.pendingPlan;
  async function execute() {
    if (!bridge || !plan) return;
    setExecuting(true);
    setResults(undefined);
    try {
      setResults(await bridge.executePlan(plan.id));
    } catch (e) {
      report(e instanceof Error ? e.message : String(e));
    } finally {
      setExecuting(false);
    }
  }
  return (
    <div className="operator-layout">
      <section className="panel operator-panel">
        <div className="panel-heading">
          <div>
            <h2>Computer operator</h2>
            <p>Give your local vision model a specific task.</p>
          </div>
          <span className="small-badge">EXPLICIT APPROVAL</span>
        </div>
        <div className="operator-intro">
          <span className="operator-symbol">
            <MousePointer2 size={30} />
          </span>
          <div>
            <h3>From awareness to action.</h3>
            <p>
              Keep the target app visible on the selected monitor and move
              OpenAware out of the way before planning. Inspect every step and
              approve actions through the desktop confirmation.
            </p>
          </div>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setResults(undefined);
            void run({ type: "automation.plan", sourceId, goal });
          }}
        >
          <label>
            Target monitor
            <select
              aria-label="Target monitor"
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              required
            >
              <option value="">Select a live monitor</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            What would you like to do?
            <textarea
              rows={4}
              placeholder="For example: click the search field and type a phrase."
              maxLength={2000}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              required
            />
          </label>
          <div className="operator-form-foot">
            <span>
              <ShieldCheck size={15} />
              Click, type, and keys only
            </span>
            <button
              className="button primary"
              disabled={
                !bridge ||
                !isOperator ||
                !sourceId ||
                !sources.some((s) => s.id === sourceId) ||
                !goal.trim() ||
                snapshot.binding.status !== "verified" ||
                pending.includes("automation.plan") ||
                executing
              }
            >
              <Bot size={16} />
              {pending.includes("automation.plan")
                ? "Planning…"
                : "Create action plan"}
            </button>
          </div>
        </form>
        {!isOperator && (
          <p className="muted small">
            Select an Operator agent to propose computer actions.
          </p>
        )}
        {sources.length === 0 && (
          <div className="inline-notice">
            <Monitor size={17} />
            <span>
              Connect an actual, unmasked monitor from Overview to enable
              computer actions. Demo, camera, window, and masked sources cannot
              control the desktop.
            </span>
          </div>
        )}
        {plan && (
          <div className="action-plan">
            <div className="section-heading">
              <h3>Review proposed steps</h3>
              <span className="muted small">
                Expires {time(plan.expiresAt)}
              </span>
            </div>
            <p className="plan-goal">{plan.goal}</p>
            <ol>
              {plan.steps.map((step, i) => (
                <li key={i}>
                  <span className="step-number">{i + 1}</span>
                  <div>
                    <strong>{step.description}</strong>
                    <code>
                      {step.type === "click"
                        ? `Click (${step.x}, ${step.y})`
                        : step.type === "type"
                          ? `Type: ${step.text}`
                          : `Key: ${step.key}`}
                    </code>
                  </div>
                  <span className="small-badge">{step.type.toUpperCase()}</span>
                </li>
              ))}
            </ol>
            <div className="plan-actions">
              <button
                className="button secondary"
                disabled={executing}
                onClick={() => void run({ type: "automation.cancel" })}
              >
                Discard plan
              </button>
              <button
                className="button primary"
                disabled={
                  executing ||
                  plan.expiresAt < Date.now() ||
                  !snapshot.sources.some(
                    (s) =>
                      s.id === plan.sourceId &&
                      s.status === "live" &&
                      s.revision === plan.sourceRevision,
                  )
                }
                onClick={() => void execute()}
              >
                <MousePointer2 size={16} />
                {executing
                  ? "Awaiting approval / executing…"
                  : "Review & execute"}
              </button>
            </div>
          </div>
        )}
        {results && (
          <div className="action-results" role="status">
            <h3>Execution results</h3>
            {results.map((result) => (
              <p key={result.step} className={result.status}>
                <strong>
                  Step {result.step + 1}: {result.status}
                </strong>
                <span>{result.message}</span>
              </p>
            ))}
          </div>
        )}
      </section>
      <aside className="panel operator-guide">
        <ShieldCheck size={28} />
        <h2>
          Approval is part
          <br />
          of the workflow.
        </h2>
        <p>
          Watching and acting are separate roles. Observations and alerts never
          execute actions.
        </p>
        <div className="boundary">
          <CheckCircle2 size={18} />
          <div>
            <strong>Every action is reviewed</strong>
            <p>The desktop displays an approval for each proposed step.</p>
          </div>
        </div>
        <div className="boundary">
          <Monitor size={18} />
          <div>
            <strong>A specific target</strong>
            <p>
              Plans are bound to the selected live monitor and source revision.
            </p>
          </div>
        </div>
        <div className="boundary">
          <Square size={18} />
          <div>
            <strong>Stop stays available</strong>
            <p>Stop all releases capture and blocks new actions immediately.</p>
          </div>
        </div>
        <div className="guide-note">
          <p>
            Keep sensitive account operations, live orders, and destructive
            tasks under your direct supervision. Broker execution is not
            included in this build.
          </p>
        </div>
      </aside>
    </div>
  );
}

function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const dialog = ref.current;
    dialog?.querySelector<HTMLElement>("button,input,select")?.focus();
    const keyboard = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab" && dialog) {
        const elements = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
          ),
        );
        const first = elements[0];
        const last = elements.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("keydown", keyboard);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <div className="modal-heading">
          <h2 id="dialog-title">{title}</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function AgentDialog({
  agent,
  sources,
  count,
  run,
  onClose,
}: {
  agent?: AgentSnapshot;
  sources: Source[];
  count: number;
  run: (command: Command, label?: string) => Promise<Snapshot | undefined>;
  onClose: () => void;
}) {
  const [name, setName] = useState(agent?.name || `Agent ${count + 1}`);
  const [role, setRole] = useState<"observer" | "operator">(
    agent?.role || "observer",
  );
  const [sourceIds, setSourceIds] = useState(agent?.sourceIds || []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const createdId = useRef<string | undefined>(agent?.id);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!window.openAware || saving) return;
    setSaving(true);
    setError("");
    try {
      let id = createdId.current;
      if (!id)
        id = (
          await window.openAware.invoke<AgentSnapshot>({
            type: "agent.add",
            name: name.trim(),
            role,
          })
        ).id;
      createdId.current = id;
      const updated = await run({
        type: "agent.update",
        agentId: id,
        patch: { name: name.trim(), role, sourceIds },
      });
      if (!updated) return;
      const selected = await run({ type: "agent.select", agentId: id });
      if (selected) onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      title={agent ? `Edit ${agent.name}` : "Add an agent"}
      onClose={onClose}
    >
      <form onSubmit={(event) => void save(event)}>
        <div className="agent-identity-fields">
          <label>
            Agent name
            <input
              aria-label="Agent name"
              required
              maxLength={80}
              value={name}
              disabled={saving}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Role
            <select
              aria-label="Agent role"
              value={role}
              disabled={saving}
              onChange={(event) => setRole(event.target.value as typeof role)}
            >
              <option value="observer">Observer</option>
              <option value="operator">Operator</option>
            </select>
          </label>
        </div>
        <div className="agent-assignment-heading">
          <strong>Assigned feeds</strong>
          <span>
            {sourceIds.length}/{MAX_AGENT_SOURCES}
          </span>
        </div>
        <div
          className="agent-assignment-options"
          role="group"
          aria-label="Assigned feeds"
        >
          {sources.map((source) => (
            <label
              key={source.id}
              className={sourceIds.includes(source.id) ? "selected" : ""}
            >
              <input
                type="checkbox"
                checked={sourceIds.includes(source.id)}
                disabled={
                  saving ||
                  (!sourceIds.includes(source.id) &&
                    sourceIds.length >= MAX_AGENT_SOURCES)
                }
                onChange={(event) =>
                  setSourceIds((ids) =>
                    event.target.checked
                      ? [...ids, source.id]
                      : ids.filter((id) => id !== source.id),
                  )
                }
              />
              {source.name}
            </label>
          ))}
          {!sources.length && (
            <span className="muted small">Add sources to assign feeds.</span>
          )}
        </div>
        {error && (
          <p className="inline-notice error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          {agent && (
            <button
              type="button"
              className="text-button agent-remove"
              disabled={saving || count <= 1}
              onClick={async () => {
                setSaving(true);
                const result = await run({
                  type: "agent.remove",
                  agentId: agent.id,
                });
                setSaving(false);
                if (result) onClose();
              }}
            >
              <Trash2 size={14} />
              Remove agent
            </button>
          )}
          <button
            type="button"
            className="button secondary"
            disabled={saving}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="button primary" disabled={saving || !name.trim()}>
            {saving ? "Saving…" : agent ? "Save agent" : "Add agent"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function AddSourceDialog({
  bridge,
  onClose,
  onAdd,
}: {
  bridge?: OpenAwareBridge;
  onClose: () => void;
  onAdd: (name: string, kind: SourceKind, deviceId: string) => Promise<void>;
}) {
  const [kind, setKind] = useState<SourceKind>("demo");
  const [name, setName] = useState("Synthetic demo");
  const [deviceId, setDeviceId] = useState("synthetic-demo");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [desktops, setDesktops] = useState<CaptureChoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [videoMode, setVideoMode] = useState<"direct" | "page">("page");
  useEffect(() => {
    let cancelled = false;
    setError("");
    setLoading(true);
    if (kind === "demo") {
      setDeviceId("synthetic-demo");
      setName("Synthetic demo");
      setLoading(false);
      return;
    }
    setDeviceId("");
    if (kind === "video_file" || kind === "video_url") {
      setName(kind === "video_file" ? "My video" : "Video page");
      setLoading(false);
      return;
    }
    setName(
      kind === "monitor"
        ? "My monitor"
        : kind === "window"
          ? "My window"
          : kind === "virtual_camera"
            ? "OBS virtual camera"
            : "My camera",
    );
    const load = async () => {
      try {
        if (kind === "camera" || kind === "virtual_camera") {
          const result = await navigator.mediaDevices.enumerateDevices();
          if (!cancelled)
            setDevices(result.filter((d) => d.kind === "videoinput"));
        } else {
          const result = await bridge?.listDesktopSources();
          if (!cancelled)
            setDesktops((result || []).filter((d) => d.kind === kind));
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [kind, bridge]);
  async function enableDeviceLabels() {
    setLoading(true);
    setError("");
    let permissionStream: MediaStream | undefined;
    try {
      permissionStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      permissionStream.getTracks().forEach((track) => track.stop());
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list.filter((device) => device.kind === "videoinput"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      permissionStream?.getTracks().forEach((track) => track.stop());
      setLoading(false);
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setConnecting(true);
    try {
      if (kind === "video_url") {
        if (!bridge) return;
        const selection = await bridge.prepareVideoUrl(
          videoUrl.trim(),
          videoMode,
        );
        await onAdd(
          name.trim() || selection.name,
          selection.kind,
          selection.deviceId,
        );
      } else await onAdd(name, kind, deviceId);
    } catch (e) {
      setError(String(e));
    } finally {
      setConnecting(false);
    }
  }
  return (
    <Dialog title="Add a source" onClose={onClose}>
      <p className="modal-intro">
        Choose exactly what OpenAware can see. Capture starts when you connect.
      </p>
      <div className="source-kind-options">
        {[
          { id: "demo" as SourceKind, label: "Demo", icon: Aperture },
          { id: "monitor" as SourceKind, label: "Monitor", icon: Monitor },
          { id: "window" as SourceKind, label: "Window", icon: Layers3 },
          { id: "camera" as SourceKind, label: "Camera", icon: Camera },
          { id: "virtual_camera" as SourceKind, label: "OBS", icon: Video },
          { id: "video_file" as SourceKind, label: "Video file", icon: Video },
          { id: "video_url" as SourceKind, label: "Video link", icon: Radio },
        ].map((item) => (
          <button
            data-testid={item.id === "demo" ? "add-demo" : undefined}
            className={kind === item.id ? "selected" : ""}
            key={item.id}
            onClick={() => setKind(item.id)}
            aria-pressed={kind === item.id}
          >
            <item.icon size={20} />
            <span>{item.label}</span>
          </button>
        ))}
      </div>
      <form onSubmit={(e) => void submit(e)}>
        <label>
          Source name
          <input
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {kind === "demo" ? (
          <div className="demo-notice">
            <Aperture size={23} />
            <div>
              <strong>Synthetic, animated, and local</strong>
              <p>
                A generated scene for testing previews and motion. No desktop or
                camera permission is requested.
              </p>
            </div>
          </div>
        ) : kind === "video_file" ? (
          <div className="video-file-choice">
            <button
              type="button"
              className="button secondary"
              disabled={!bridge || loading || connecting}
              onClick={async () => {
                if (!bridge) return;
                setLoading(true);
                setError("");
                try {
                  const selected = await bridge.chooseVideoFile();
                  if (selected) {
                    setDeviceId(selected.deviceId);
                    setName(selected.name.slice(0, 80));
                  }
                } catch (failure) {
                  setError(
                    failure instanceof Error
                      ? failure.message
                      : String(failure),
                  );
                } finally {
                  setLoading(false);
                }
              }}
            >
              <Video size={15} />
              {loading ? "Choosing…" : "Choose video file"}
            </button>
            {deviceId && <span className="muted small">{name}</span>}
          </div>
        ) : kind === "video_url" ? (
          <div className="video-link-fields">
            <label>
              Video link
              <input
                aria-label="Video link"
                type="url"
                required
                maxLength={2048}
                placeholder="https://…"
                value={videoUrl}
                onChange={(event) => setVideoUrl(event.target.value)}
              />
            </label>
            <label>
              Link type
              <select
                aria-label="Video link type"
                value={videoMode}
                onChange={(event) =>
                  setVideoMode(event.target.value as typeof videoMode)
                }
              >
                <option value="page">
                  Web page (YouTube, Facebook, TikTok, Instagram, X)
                </option>
                <option value="direct">Direct video stream</option>
              </select>
            </label>
            <span className="field-note">
              {videoMode === "page"
                ? "Use Open player to press Play or sign in. The AI sees visible page pixels."
                : "HTTP(S) media only. Use Open player for playback controls."}
            </span>
          </div>
        ) : kind === "camera" || kind === "virtual_camera" ? (
          <label>
            {kind === "virtual_camera"
              ? "Virtual camera device"
              : "Camera device"}
            <select
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              required
            >
              <option value="">
                {loading ? "Finding devices…" : "Choose a device"}
              </option>
              {devices.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label ||
                    `Camera ${index + 1} (device label requires permission)`}
                </option>
              ))}
            </select>
            <span className="field-note">
              {kind === "virtual_camera"
                ? "Start the OBS Virtual Camera first. Choose its actual device from this list."
                : "Your operating system may ask for camera permission when connecting."}
            </span>
            <button
              type="button"
              className="text-button"
              disabled={loading}
              onClick={() => void enableDeviceLabels()}
            >
              <Camera size={14} />
              Enable device names (brief permission check)
            </button>
          </label>
        ) : (
          <div
            className="desktop-choices"
            aria-label="Available desktop sources"
          >
            {loading ? (
              <p className="muted">Finding sources…</p>
            ) : (
              desktops.map((choice) => (
                <button
                  type="button"
                  className={`desktop-choice ${choice.id === deviceId ? "selected" : ""}`}
                  key={choice.id}
                  onClick={() => {
                    setDeviceId(choice.id);
                    setName(choice.name.slice(0, 80));
                  }}
                >
                  <img src={choice.thumbnail} alt="" />
                  <span>{choice.name}</span>
                  {choice.id === deviceId && <CheckCircle2 size={16} />}
                </button>
              ))
            )}
            {!loading && !desktops.length && (
              <p className="muted">No available {kind}s were found.</p>
            )}
          </div>
        )}
        {error && <div className="inline-notice error">{error}</div>}
        <div className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={
              !bridge ||
              !name.trim() ||
              (kind === "video_url" ? !videoUrl.trim() : !deviceId) ||
              connecting
            }
          >
            <Plus size={16} />
            {connecting ? "Connecting…" : "Connect source"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function MaskDialog({
  source,
  blocked,
  onClose,
  onSave,
}: {
  source: Source;
  blocked: boolean;
  onClose: () => void;
  onSave: (masks: Mask[]) => Promise<void>;
}) {
  const [masks, setMasks] = useState<Mask[]>(source.masks);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (
      masks.some(
        (m) =>
          m.x < 0 ||
          m.y < 0 ||
          m.width <= 0 ||
          m.height <= 0 ||
          m.x + m.width > 1.00000001 ||
          m.y + m.height > 1.00000001,
      )
    ) {
      setError(
        "Every mask must fit within the source, with positive width and height.",
      );
      return;
    }
    setSaving(true);
    try {
      await onSave(masks);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog title={`Privacy masks · ${source.name}`} onClose={onClose}>
      <p className="modal-intro">
        Masks black out analysis frames and motion metrics before export. Your
        local preview remains visible.
      </p>
      {blocked && (
        <div className="inline-notice warning">
          The source dimensions changed. Check all masks before saving.
          Re-enable AI and motion separately after review.
        </div>
      )}
      <form onSubmit={(e) => void save(e)}>
        <div className="mask-map" aria-label="Mask position preview">
          {masks.map((mask, index) => (
            <div
              className="mask-rect"
              key={index}
              style={{
                left: `${mask.x * 100}%`,
                top: `${mask.y * 100}%`,
                width: `${mask.width * 100}%`,
                height: `${mask.height * 100}%`,
              }}
            >
              {index + 1}
            </div>
          ))}
          {masks.length === 0 && <span>No masked regions</span>}
        </div>
        <div className="mask-fields">
          {masks.map((mask, index) => (
            <fieldset className="mask-row" key={index}>
              <legend>Mask {index + 1}</legend>
              {(["x", "y", "width", "height"] as const).map((key) => (
                <label key={key}>
                  {key}
                  <input
                    type="number"
                    min={key === "width" || key === "height" ? 1 : 0}
                    max={100}
                    step={1}
                    value={Math.round(mask[key] * 100)}
                    onChange={(e) =>
                      setMasks((items) =>
                        items.map((item, i) =>
                          i === index
                            ? { ...item, [key]: Number(e.target.value) / 100 }
                            : item,
                        ),
                      )
                    }
                  />
                  <span>%</span>
                </label>
              ))}
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove mask ${index + 1}`}
                onClick={() =>
                  setMasks((items) => items.filter((_, i) => i !== index))
                }
              >
                <Trash2 size={16} />
              </button>
            </fieldset>
          ))}
        </div>
        <button
          type="button"
          className="text-button"
          disabled={masks.length >= 8}
          onClick={() =>
            setMasks((items) => [
              ...items,
              { x: 0.1, y: 0.1, width: 0.25, height: 0.25 },
            ])
          }
        >
          <Plus size={15} />
          Add mask
        </button>
        {error && <div className="inline-notice error">{error}</div>}
        <div className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={saving}>
            <ShieldCheck size={16} />
            {saving ? "Saving…" : "Save reviewed masks"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
