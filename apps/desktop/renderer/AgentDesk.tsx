import { useId } from "react";
import { Pause, Play, Settings2 } from "lucide-react";
import "./agent-desk.css";

export type AgentDeskState =
  | "unconfigured"
  | "selected"
  | "probing"
  | "ready"
  | "watching"
  | "paused"
  | "error"
  | "failed"
  | "disconnected";

export interface AgentDeskSeat {
  id: string;
  label: string;
  roleLabel?: string;
  selected?: boolean;
  assignmentCount?: number;
  monitoring?: boolean;
  canStart?: boolean;
  /** Real connection readiness, supplied by the parent; selection is insufficient. */
  connected: boolean;
  state: AgentDeskState;
  modelName?: string;
  assignments?: readonly string[];
  detail?: string;
  actionLabel?: string;
  disabled?: boolean;
  onConfigure?: () => void;
}

export interface AgentDeskProps {
  /** The parent supplies up to four independent seats and owns connection behavior. */
  seats: readonly AgentDeskSeat[];
  onConfigure?: (seatId: string) => void;
  onSelect?: (seatId: string) => void;
  onEdit?: (seatId: string) => void;
  onToggleWatching?: (seatId: string, monitoring: boolean) => void;
  className?: string;
}

const stateLabels: Record<AgentDeskState, string> = {
  unconfigured: "No connection",
  selected: "Selected",
  probing: "Checking",
  ready: "Ready",
  watching: "Watching",
  paused: "Paused",
  error: "Error",
  failed: "Error",
  disconnected: "Disconnected",
};
const connectedStates = new Set<AgentDeskState>([
  "ready",
  "watching",
  "paused",
  "error",
]);

function Chair({ occupied }: { occupied: boolean }) {
  return (
    <svg
      className="agent-desk-chair"
      viewBox="0 0 200 180"
      aria-hidden="true"
      focusable="false"
    >
      <ellipse cx="100" cy="174" rx="53" ry="5" fill="#070e18" opacity=".48" />
      <g className="agent-desk-keyboard" stroke="#37516a" strokeWidth="1">
        <path d="M57 36h86l7 15H50z" fill="#0d1a2a" />
        <path
          d="M59 41h82M55 46h91M69 37l-3 10m17-10-1 10m18-10v10m17-10 1 10m16-10 3 10"
          opacity=".65"
        />
        <path d="M155 42c0-3 3-5 6-5s6 2 6 5v8h-12z" fill="#14253a" />
      </g>
      {occupied ? (
        <g className="agent-desk-occupant" data-testid="agent-desk-agent">
          <path
            d="M79 91 62 66l-10-11M121 91l17-25 10-11"
            stroke="#6697be"
            strokeWidth="11"
            strokeLinecap="round"
            fill="none"
          />
          <path
            d="M76 95c0-17 10-25 24-25s24 8 24 25l5 40H71z"
            fill="#294967"
            stroke="#749dbc"
            strokeWidth="1.4"
          />
          <path d="M91 89h18v19H91z" fill="#355b7b" />
          <rect
            x="84"
            y="53"
            width="32"
            height="32"
            rx="12"
            fill="#8ac2df"
            stroke="#c0e5f3"
            strokeWidth="1.3"
          />
          <path
            d="M88 66h24M94 58v10m12-10v10"
            stroke="#416f91"
            strokeWidth="2"
            fill="none"
          />
          <path d="M89 83h22" stroke="#62adce" strokeWidth="3" />
        </g>
      ) : (
        <g
          className="agent-desk-outline"
          data-testid="agent-desk-outline"
          fill="none"
          stroke="#72d2fa"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="85" y="53" width="30" height="32" rx="12" />
          <path d="M91 85v5m18-5v5M77 101c0-17 9-26 23-26s23 9 23 26l4 33H73zM78 96 62 67l-10-11M122 96l16-29 10-11" />
        </g>
      )}
      <g className="agent-desk-office-chair">
        <path
          d="M69 128H55v18m76-18h14v18"
          stroke="#506479"
          strokeWidth="4"
          strokeLinecap="round"
          fill="none"
        />
        <rect
          x="61"
          y="136"
          width="78"
          height="18"
          rx="8"
          fill="#263c51"
          stroke="#526b83"
          strokeWidth="1.3"
        />
        <rect
          x="66"
          y="106"
          width="68"
          height="39"
          rx="11"
          fill="#172d42"
          stroke="#4a657f"
          strokeWidth="1.5"
        />
        <path
          d="M74 114c9-3 43-3 52 0M75 134h50"
          stroke="#304d68"
          strokeWidth="1.2"
          fill="none"
        />
        <path
          d="M100 153v14m0-1-31 8m31-8 31 8m-31-8v10"
          stroke="#5c7187"
          strokeWidth="4"
          strokeLinecap="round"
          fill="none"
        />
        <g fill="#0b1725" stroke="#4b6075" strokeWidth="1">
          <circle cx="67" cy="174" r="3" />
          <circle cx="133" cy="174" r="3" />
          <circle cx="100" cy="176" r="3" />
        </g>
      </g>
    </svg>
  );
}

/** UI geometry only: the parent owns model verification, assignments and monitoring. */
export function AgentDesk({
  seats,
  onConfigure,
  onSelect,
  onEdit,
  onToggleWatching,
  className = "",
}: AgentDeskProps) {
  const materialId = useId();
  return (
    <div
      className={`agent-desk ${className}`.trim()}
      data-testid="agent-desk"
      data-seats={seats.length}
    >
      <svg
        className="agent-desk-worktop"
        viewBox="0 0 800 240"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id={`${materialId}-top`} x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#243d55" />
            <stop offset="1" stopColor="#172d44" />
          </linearGradient>
          <linearGradient id={`${materialId}-edge`} x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#284b69" />
            <stop offset="1" stopColor="#0b192a" />
          </linearGradient>
        </defs>
        <path
          d="M55 159v57l15 5 9-62M721 159l9 62 15-5v-57"
          fill="#172a3c"
          stroke="#2d455b"
          strokeWidth="1"
        />
        <path
          d="M29 23h742l27 123H2z"
          fill={`url(#${materialId}-top)`}
          stroke="#3a5975"
          strokeWidth="1.2"
        />
        <path
          d="M2 146h796v16l-10 9H12L2 162z"
          fill={`url(#${materialId}-edge)`}
        />
        <path
          d="M30 23h740M10 146h780"
          stroke="#5684a6"
          strokeWidth="1.2"
          opacity=".7"
        />
        <path d="M48 33h704" stroke="#82b2cc" strokeWidth="1" opacity=".16" />
      </svg>
      <div
        className="agent-desk-seats"
        style={{
          gridTemplateColumns: `repeat(${Math.max(1, seats.length)}, minmax(0, 1fr))`,
        }}
      >
        {seats.map((seat) => {
          const occupied = seat.connected && connectedStates.has(seat.state);
          const configure =
            seat.onConfigure ??
            (onConfigure ? () => onConfigure(seat.id) : undefined);
          const assignments = seat.assignments?.join(" · ");
          const showState =
            occupied ||
            ["selected", "probing", "error", "failed"].includes(seat.state);
          return (
            <div
              key={seat.id}
              className="agent-desk-seat"
              data-agent-seat={seat.id}
              data-state={seat.state}
              data-connected={occupied}
              data-selected={!!seat.selected}
              role="group"
              aria-label={`${seat.label}, ${stateLabels[seat.state]}`}
            >
              <div className="agent-desk-seat-info">
                <div className="agent-desk-seat-heading">
                  {onSelect ? (
                    <button
                      className="agent-desk-select agent-desk-role"
                      aria-label={`Select ${seat.label}`}
                      aria-pressed={!!seat.selected}
                      title={`${seat.label} · ${seat.roleLabel || "Agent"}`}
                      onClick={() => onSelect(seat.id)}
                    >
                      {seat.label}
                    </button>
                  ) : (
                    <span className="agent-desk-role" title={seat.label}>
                      {seat.label}
                    </span>
                  )}
                  {showState && (
                    <span
                      className="agent-desk-state"
                      title={seat.detail}
                      aria-live="polite"
                    >
                      <i />
                      {stateLabels[seat.state]}
                    </span>
                  )}
                </div>
                <div className="agent-desk-seat-tools">
                  {seat.roleLabel && (
                    <span className="agent-desk-role-label">
                      {seat.roleLabel}
                    </span>
                  )}
                  {onEdit && (
                    <button
                      type="button"
                      className="text-button"
                      aria-label={`Edit ${seat.label} and assigned feeds`}
                      title="Name, role and assigned feeds"
                      disabled={seat.disabled}
                      onClick={() => onEdit(seat.id)}
                    >
                      Feeds {seat.assignmentCount || 0}/4{" "}
                      <Settings2 size={12} />
                    </button>
                  )}
                </div>
                {onToggleWatching && (
                  <button
                    type="button"
                    className="agent-desk-watch text-button"
                    aria-label={`${seat.monitoring ? "Pause" : "Start watching"} ${seat.label}`}
                    disabled={
                      seat.disabled || (!seat.monitoring && !seat.canStart)
                    }
                    onClick={() => onToggleWatching(seat.id, !!seat.monitoring)}
                  >
                    {seat.monitoring ? <Pause size={11} /> : <Play size={11} />}
                    {seat.monitoring ? "Pause" : "Start"}
                  </button>
                )}
                {occupied && seat.modelName && (
                  <span className="agent-desk-model" title={seat.modelName}>
                    {seat.modelName}
                  </span>
                )}
                {occupied && assignments && (
                  <span className="agent-desk-assignments" title={assignments}>
                    {assignments}
                  </span>
                )}
              </div>
              <Chair occupied={occupied} />
              {occupied && configure && (
                <button
                  type="button"
                  className="agent-desk-configure"
                  disabled={seat.disabled}
                  onClick={configure}
                  aria-label={`Configure model for ${seat.label}`}
                  title={seat.actionLabel || `Configure ${seat.label}`}
                >
                  <Settings2 size={14} />
                  <span>Configure</span>
                </button>
              )}
              {!occupied &&
                (configure ? (
                  <button
                    type="button"
                    className="agent-desk-needs"
                    onClick={configure}
                    disabled={seat.disabled}
                    aria-label={`Needs agent: configure ${seat.label}`}
                    title={seat.actionLabel || `Connect ${seat.label}`}
                  >
                    <span />
                    Needs agent
                  </button>
                ) : (
                  <span className="agent-desk-needs">
                    <span />
                    Needs agent
                  </span>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
