export type SessionStatus = "starting" | "running" | "waiting" | "idle" | "error" | "stopped";

export type ActiveThemeToken = "accent" | "success" | "warning" | "error" | "muted" | "dim" | "text" | "border" | "statusLineBg";

export interface ActiveThemeSnapshot {
  name?: string;
  sourcePath?: string;
  tokens?: Partial<Record<ActiveThemeToken, string | number>>;
}

export interface SessionMetadata {
  source?: string;
  goal?: string;
  status?: string;
  nextStep?: string;
  stage?: string;
  confidence?: number;
  updatedAt?: number;
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
  order?: number;
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
  worktreePath?: string;
  worktreeRepoRoot?: string;
  worktreeBranch?: string;
  worktreeBaseBranch?: string;
  worktreeOwnedByHub?: boolean;
  worktrees?: ManagedWorktree[];
}

export interface RuntimeSession extends ManagedSession {
  sessionMetadata?: SessionMetadata;
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
