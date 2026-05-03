export type SessionStatus = "starting" | "running" | "waiting" | "idle" | "error" | "stopped";

export interface ManagedSession {
  id: string;
  title: string;
  cwd: string;
  group: string;
  tmuxSession: string;
  status: SessionStatus;
  sessionFile?: string;
  piSessionId?: string;
  acknowledgedAt?: number;
  createdAt: number;
  updatedAt: number;
  error?: string;
  enabledMcpServers?: string[];
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
