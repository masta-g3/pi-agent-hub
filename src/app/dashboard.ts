import { spawn } from "node:child_process";
import { DASHBOARD_SESSION_NAME, STATE_ENV } from "../core/names.js";
import { attachSessionCommand, configureDashboardStatusBar, newSession, sessionExists, switchClient, type TmuxExec, realTmuxExec } from "../core/tmux.js";
import { effectiveDashboardThemePreference } from "../core/config.js";
import { detectTerminalAppearance, effectiveDashboardTheme, loadGlobalThemeCatalog } from "../tui/theme.js";

export const DASHBOARD_SESSION = DASHBOARD_SESSION_NAME;

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
  const env = { ...process.env, ...options.env };
  const catalog = await loadGlobalThemeCatalog(env);
  const preference = await effectiveDashboardThemePreference(env);
  const theme = (await effectiveDashboardTheme(catalog, preference, detectTerminalAppearance(env), env)).theme;
  await configureDashboardStatusBar({ name: DASHBOARD_SESSION, cwd: options.cwd, theme }, exec);

  if (options.insideTmux) {
    await switchClient(DASHBOARD_SESSION, exec);
    return;
  }

  const attach = attachSessionCommand(DASHBOARD_SESSION);
  await runner.run(attach.command, attach.args);
}

export function dashboardEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return compactEnv({
    PI_CODING_AGENT_DIR: env.PI_CODING_AGENT_DIR,
    PI_AGENT_HUB_GLYPHS: env.PI_AGENT_HUB_GLYPHS,
    NO_COLOR: env.NO_COLOR,
    [STATE_ENV]: env[STATE_ENV],
  });
}

function compactEnv(env: Record<string, string | undefined> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(env ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}
