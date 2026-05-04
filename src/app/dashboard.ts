import { spawn } from "node:child_process";
import { configureDashboardStatusBar, newSession, sessionExists, type TmuxExec, realTmuxExec } from "../core/tmux.js";

export const DASHBOARD_SESSION = "pi-sessions-dashboard";

export interface DashboardRunner {
  run(command: string, args: string[]): Promise<void>;
}

export const realDashboardRunner: DashboardRunner = {
  run(command, args) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: "inherit" });
      child.on("error", reject);
      child.on("exit", (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(`${command} ${args.join(" ")} exited with ${signal ?? code}`));
      });
    });
  },
};

export async function openDashboard(
  options: {
    cwd: string;
    command: string;
    insideTmux: boolean;
    env?: Record<string, string | undefined>;
  },
  exec: TmuxExec = realTmuxExec,
  runner: DashboardRunner = realDashboardRunner,
): Promise<void> {
  const exists = await sessionExists(DASHBOARD_SESSION, exec);

  if (!exists) {
    await newSession({
      name: DASHBOARD_SESSION,
      cwd: options.cwd,
      command: options.command,
      env: compactEnv(options.env),
    }, exec);
  }
  await configureDashboardStatusBar({ name: DASHBOARD_SESSION, cwd: options.cwd }, exec);

  if (options.insideTmux) {
    await exec.exec("tmux", ["switch-client", "-t", DASHBOARD_SESSION]);
    return;
  }

  await runner.run("tmux", ["attach-session", "-t", DASHBOARD_SESSION]);
}

export function dashboardEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return compactEnv({
    PI_CODING_AGENT_DIR: env.PI_CODING_AGENT_DIR,
    PI_SESSIONS_DIR: env.PI_SESSIONS_DIR,
  });
}

function compactEnv(env: Record<string, string | undefined> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(env ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}
