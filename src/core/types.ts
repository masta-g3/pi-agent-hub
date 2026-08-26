export type SessionStatus = "starting" | "running" | "waiting" | "idle" | "error" | "stopped";
export type SessionBucket = "backlog" | "archived";

export type ActiveThemeToken = "accent" | "success" | "warning" | "error" | "muted" | "dim" | "text" | "border" | "statusLineBg" | "selectedBg";

export interface ActiveThemeSnapshot {
  name?: string;
  sourcePath?: string;
  tokens?: Partial<Record<ActiveThemeToken, string | number>>;
}

export interface WorkflowStep {
  id: string;
  short: string;
  label?: string;
}

export interface WorkflowModeDisplay {
  id: string;
  short: string;
  label?: string;
  detail?: string;
}

export interface WorkflowSnapshot {
  steps: WorkflowStep[];
  activeIndex: number;
  currentStepComplete?: boolean;
  ticketId?: string;
  updatedAt: number;
}

export interface WorkflowActivityDisplay {
  id: string;
  label: string;
  pass?: number;
}

export interface WorkflowRuntimeSnapshot extends WorkflowSnapshot {
  activeMode?: WorkflowModeDisplay;
  activity?: WorkflowActivityDisplay;
  plan?: SessionPlanSummary;
}

export interface SessionPlanSummary {
  phase?: {
    title: string;
    index: number;
    count: number;
  };
  tasks?: {
    completed: number;
    total: number;
  };
  phases?: { completed: number; total: number }[];
  nextStep?: string;
}

export type SessionAttentionKind = "ready" | "question" | "blocked";

export interface SessionAttention {
  kind: SessionAttentionKind;
  text: string;
}

export interface PiAgentHubContextV1 {
  version: 1;
  updatedAt: number;
  ticket?: {
    id: string;
    subtitle?: string;
    description?: string;
  };
  attention?: SessionAttention;
}

export interface ManagedWorktree {
  path: string;
  repoRoot: string;
  branch: string;
  baseBranch: string;
  role: "primary" | "additional";
}

export interface ManagedSession {
  id: string;
  title: string;
  cwd: string;
  additionalCwds?: string[];
  workspaceCwd?: string;
  group: string;
  tmuxSession: string;
  status: SessionStatus;
  sessionFile?: string;
  piSessionId?: string;
  acknowledgedAt?: number;
  lastActivityAt?: number;
  order?: number;
  bucket?: SessionBucket;
  bucketChangedAt?: number;
  createdAt: number;
  updatedAt: number;
  error?: string;
  enabledMcpServers?: string[];
  kind?: "main" | "subagent";
  parentId?: string;
  agentName?: string;
  taskPreview?: string;
  resultPath?: string;
  resultSummary?: string;
  activeTheme?: ActiveThemeSnapshot;
  workflow?: WorkflowSnapshot;
  worktreePath?: string;
  worktreeRepoRoot?: string;
  worktreeBranch?: string;
  worktreeBaseBranch?: string;
  worktreeOwnedByHub?: boolean;
  worktrees?: ManagedWorktree[];
}

export type RuntimeStatusReason =
  | "tmux-stopped"
  | "tmux-missing"
  | "tmux-unknown"
  | "heartbeat-error"
  | "heartbeat-shutdown"
  | "heartbeat-active"
  | "fallback-active"
  | "fallback-starting"
  | "fallback-waiting"
  | "fallback-idle"
  | "heartbeat-unread"
  | "heartbeat-read";

export interface RuntimeStatusEvidence {
  observedAt: number;
  reason: RuntimeStatusReason;
  tmux: { state: "present" | "missing" | "unknown"; error?: string };
  heartbeat: {
    freshness: "fresh" | "stale" | "missing";
    state?: Heartbeat["state"];
    updatedAt?: number;
    stateSince?: number;
    message?: string;
  };
  acknowledgement: { state: "unread" | "read" | "not-applicable"; acknowledgedAt?: number };
  workflow: {
    source: "fresh" | "retained" | "absent";
    activeIndex?: number;
    stepCount?: number;
    stepLabel?: string;
  };
}

export interface RuntimeSession extends ManagedSession {
  context?: PiAgentHubContextV1;
  workflow?: WorkflowRuntimeSnapshot;
  statusEvidence?: RuntimeStatusEvidence;
}

export interface SessionsRegistry {
  version: 1;
  sessions: ManagedSession[];
}

export interface Heartbeat {
  managedSessionId: string;
  piSessionFile?: string;
  piSessionId?: string;
  cwd: string;
  state: "starting" | "running" | "waiting" | "error" | "shutdown";
  stateSince: number;
  message?: string;
  updatedAt: number;
  kind?: "main" | "subagent";
  parentId?: string;
  agentName?: string;
  taskPreview?: string;
  resultPath?: string;
  activeTheme?: ActiveThemeSnapshot;
  piSessionName?: string;
  context?: PiAgentHubContextV1;
  workflow?: WorkflowRuntimeSnapshot;
}

export interface TmuxState {
  exists: boolean;
  recentActivityMs?: number;
  error?: string;
}

export interface StatusInput {
  session: ManagedSession;
  tmux: TmuxState;
  heartbeat?: Heartbeat;
  now: number;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
}
