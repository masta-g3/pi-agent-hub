import type { ManagedSession } from "../core/types.js";

export type AttachPlan =
  | { type: "attach"; command: "tmux"; args: ["attach-session", "-t", string] }
  | { type: "inside-tmux"; command: string; message: string };

export function attachPlan(session: ManagedSession, env: NodeJS.ProcessEnv = process.env): AttachPlan {
  if (env.TMUX) {
    const command = `tmux switch-client -t ${session.tmuxSession}`;
    return { type: "inside-tmux", command, message: `inside tmux: ${command}` };
  }
  return { type: "attach", command: "tmux", args: ["attach-session", "-t", session.tmuxSession] };
}

export function restartConfirmMessage(title: string): string {
  return `press R again to restart ${title}`;
}
