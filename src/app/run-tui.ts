import { spawn } from "node:child_process";
import { ProcessTerminal, TUI } from "@mariozechner/pi-tui";
import { SessionsController } from "./controller.js";
import { startRefreshLoop, type RefreshLoopHandle } from "./refresh-loop.js";
import { SessionsView } from "../tui/sessions-view.js";
import type { NewFormContext } from "../tui/new-form.js";
import { loadSessionsTheme, type SessionsTheme } from "../tui/theme.js";
import { loadProjectSkillsState, setProjectSkills } from "../skills/attach.js";
import { listSkillPool } from "../skills/catalog.js";
import { loadMcpCatalog, loadProjectMcpState, setProjectMcpServers } from "../mcp/config.js";
import { configureManagedSessionStatusBar, restoreSwitchReturnBinding, switchClientWithReturn } from "../core/tmux.js";
import { DASHBOARD_SESSION, dashboardEnv } from "./dashboard.js";
import { deleteManagedSession } from "./delete-session.js";
import { addManagedSession, forkManagedSession, restartManagedSession } from "./session-commands.js";
import type { ManagedSession } from "../core/types.js";

export function buildNewFormContext(input: { cwd: string; sessions: ManagedSession[]; selected?: ManagedSession }): NewFormContext {
  const knownCwds = Array.from(new Set(input.sessions.map((session) => session.cwd))).sort();
  return { cwd: input.selected?.cwd ?? input.cwd, group: input.selected?.group, knownCwds };
}

export interface ThemeRefreshLoopOptions {
  initialTheme: SessionsTheme;
  load: () => Promise<SessionsTheme>;
  apply: (theme: SessionsTheme) => void;
  intervalMs?: number;
}

export function startThemeRefreshLoop(options: ThemeRefreshLoopOptions): () => void {
  let activeThemeKey = themeKey(options.initialTheme);
  let inFlight: Promise<void> | undefined;
  let stopped = false;
  const run = () => {
    if (stopped || inFlight) return;
    inFlight = (async () => {
      try {
        const nextTheme = await options.load();
        if (stopped) return;
        const nextThemeKey = themeKey(nextTheme);
        if (nextThemeKey === activeThemeKey) return;
        activeThemeKey = nextThemeKey;
        options.apply(nextTheme);
      } catch {
        // Keep the last good theme if settings/theme files are mid-write.
      }
    })().finally(() => { inFlight = undefined; });
  };
  const timer = setInterval(run, options.intervalMs ?? 1_000);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

function themeKey(theme: SessionsTheme): string {
  return JSON.stringify(theme);
}

export async function runTui(): Promise<void> {
  const cwd = process.cwd();
  const theme = await loadSessionsTheme({ cwd });
  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal, false);
  const controller = new SessionsController();
  const skillPool = await listSkillPool();
  const skillState = await loadProjectSkillsState(cwd);
  let enabledSkillNames = new Set(skillState.attached.map((skill) => skill.name));
  const mcpCatalog = await loadMcpCatalog();
  let mcpState = await loadProjectMcpState(cwd);
  let stopLoop: RefreshLoopHandle | undefined;
  let stopThemeLoop: (() => void) | undefined;
  let stopped = false;
  const stop = () => {
    stopped = true;
    stopThemeLoop?.();
    void stopLoop?.stop();
    void restoreSwitchReturnBinding({ onlyOwnerPid: process.pid }).catch(() => {});
    tui.stop();
  };
  let mutationQueue = Promise.resolve();
  const mutateRegistry = (action: () => Promise<void>) => {
    const run = async () => {
      const loop = stopLoop;
      stopLoop = undefined;
      try {
        await loop?.stop();
        await action();
        await controller.refresh();
        tui.requestRender();
      } finally {
        if (!stopped) stopLoop = startRefreshLoop(controller, tui);
      }
    };
    const result = mutationQueue.then(run, run);
    mutationQueue = result.catch(() => {});
    return result;
  };
  const view = new SessionsView(controller, stop, {
    attachOutsideTmux(tmuxSession) {
      stop();
      spawn("tmux", ["attach-session", "-t", tmuxSession], { stdio: "inherit" });
    },
    async switchInsideTmux(tmuxSession) {
      const session = controller.snapshot().registry.sessions.find((item) => item.tmuxSession === tmuxSession);
      if (session) await configureManagedSessionStatusBar({ name: session.tmuxSession, title: session.title, cwd: session.cwd });
      return switchClientWithReturn({
        targetSession: tmuxSession,
        returnSession: { name: DASHBOARD_SESSION, cwd, command: "pi-sessions tui", env: dashboardEnv() },
      });
    },
    restart(sessionId) {
      return mutateRegistry(() => restartManagedSession(sessionId));
    },
    deleteSession(sessionId) {
      return mutateRegistry(async () => {
        const deleted = await deleteManagedSession(sessionId);
        controller.removeSession(deleted.id);
      });
    },
    createSession(input) {
      return mutateRegistry(async () => { await addManagedSession(input); });
    },
    forkSession(sourceSessionId, input) {
      return mutateRegistry(async () => { await forkManagedSession(sourceSessionId, input); });
    },
    changeGroup(sessionId, group) {
      return mutateRegistry(() => controller.moveSessionToGroup(sessionId, group));
    },
    renameSession(sessionId, title) {
      return mutateRegistry(() => controller.renameSession(sessionId, title));
    },
    renameGroup(from, to) {
      return mutateRegistry(() => controller.renameGroup(from, to));
    },
    reorderSelected(delta) {
      return mutateRegistry(() => controller.reorderSelected(delta));
    },
    acknowledge() {
      return mutateRegistry(() => controller.acknowledgeSelected());
    },
    newFormContext() {
      return buildNewFormContext({
        cwd: process.cwd(),
        sessions: controller.snapshot().registry.sessions,
        selected: controller.selected(),
      });
    },
    skills() {
      return skillPool.map((skill) => ({ name: skill.name, enabled: enabledSkillNames.has(skill.name) }));
    },
    async applySkills(items) {
      await setProjectSkills(cwd, items.flatMap((item) => {
        const skill = skillPool.find((entry) => entry.name === item.name);
        return skill ? [{ name: item.name, sourcePath: skill.path, enabled: item.enabled }] : [];
      }));
      enabledSkillNames = new Set(items.filter((item) => item.enabled).map((item) => item.name));
    },
    mcpServers() {
      const enabled = new Set(mcpState.enabledServers);
      return Object.keys(mcpCatalog.servers).sort().map((name) => ({ name, enabled: enabled.has(name) }));
    },
    async applyMcpServers(items) {
      mcpState = await setProjectMcpServers(cwd, items.filter((item) => item.enabled).map((item) => item.name));
    },
    copy(text) {
      if (process.platform !== "darwin") return;
      const child = spawn("pbcopy", [], { stdio: ["pipe", "ignore", "ignore"] });
      child.on("error", () => {});
      child.stdin.on("error", () => {});
      child.stdin.end(text);
    },
  }, theme);
  stopThemeLoop = startThemeRefreshLoop({
    initialTheme: theme,
    load: () => loadSessionsTheme({ cwd }),
    apply(nextTheme) {
      view.setTheme(nextTheme);
      tui.invalidate();
      tui.requestRender();
    },
  });
  tui.addChild(view);
  tui.setFocus(view);
  tui.start();
  stopLoop = startRefreshLoop(controller, tui);
}
