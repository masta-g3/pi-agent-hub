import { spawn } from "node:child_process";
import { ProcessTerminal, TUI } from "@earendil-works/pi-tui";
import { SessionsController } from "./controller.js";
import { startRefreshLoop, type RefreshLoopHandle } from "./refresh-loop.js";
import { SessionsView } from "../tui/sessions-view.js";
import type { NewFormContext } from "../tui/new-form.js";
import { loadActiveTheme, loadSessionsTheme, type SessionsTheme } from "../tui/theme.js";
import { loadProjectSkillsState, setProjectSkills } from "../skills/attach.js";
import { listSkillPool } from "../skills/catalog.js";
import { loadMcpCatalog, loadProjectMcpState, setProjectMcpServers } from "../mcp/config.js";
import { effectiveDashboardThemeSessionId, effectiveSkillPoolDirs, setDashboardThemeSessionId, setSkillPoolDir } from "../core/config.js";
import { projectStateCwd } from "../core/multi-repo.js";
import { loadRepoHistory, mergeRepoCwds, rankedRepoCwds } from "../core/repo-history.js";
import { configureDashboardStatusBar, configureManagedSessionStatusBar, restoreSwitchReturnBinding, sendTextToSession, switchClientWithReturn } from "../core/tmux.js";
import { DASHBOARD_SESSION, dashboardEnv } from "./dashboard.js";
import { consumeDashboardAction } from "./dashboard-action.js";
import { deleteManagedSession, deleteManagedSubagentSessions } from "./delete-session.js";
import { addManagedSession, forkManagedSession, restartManagedSession, syncManagedSessionStatusBars } from "./session-commands.js";
import type { ManagedSession } from "../core/types.js";

export function buildNewFormContext(input: { cwd: string; sessions: ManagedSession[]; selected?: ManagedSession; historyCwds?: string[] }): NewFormContext {
  const selectedExtraCwds = input.selected?.additionalCwds ?? [];
  const registryCwds = input.sessions.flatMap((session) => [session.cwd, ...(session.additionalCwds ?? [])]);
  const knownCwds = mergeRepoCwds(
    input.selected ? [input.selected.cwd] : [],
    [input.cwd],
    selectedExtraCwds,
    registryCwds,
    input.historyCwds ?? [],
  );
  return {
    cwd: input.selected?.cwd ?? input.cwd,
    group: input.selected?.group,
    knownCwds,
    ...(selectedExtraCwds.length ? { additionalCwds: selectedExtraCwds } : {}),
  };
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
  const controller = new SessionsController();
  await controller.refresh();
  let dashboardThemeSessionId = resolveDashboardThemeSessionId(controller.snapshot().registry.sessions, await effectiveDashboardThemeSessionId(), controller.selected()?.id);
  const pinDashboardThemeSession = (session: ManagedSession) => {
    dashboardThemeSessionId = session.id;
    void setDashboardThemeSessionId(session.id).catch(() => {});
  };
  const theme = await loadDashboardTheme(cwd, controller.snapshot().registry.sessions, dashboardThemeSessionId);
  const syncDashboardChrome = (nextTheme: SessionsTheme) => {
    if (!process.env.TMUX) return;
    void configureDashboardStatusBar({ name: DASHBOARD_SESSION, cwd, theme: nextTheme }).catch(() => {});
  };
  syncDashboardChrome(theme);
  void syncManagedSessionStatusBars().catch(() => {});
  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal, false);
  let skillPoolDirs = await effectiveSkillPoolDirs();
  let skillPool = await listSkillPool();
  const mcpCatalog = await loadMcpCatalog();
  let historyCwds = rankedRepoCwds((await loadRepoHistory()).repos);
  const skillCountCache = new Map<string, number>();
  const skillCountLoads = new Set<string>();
  const skillCount = (projectCwd: string): number | undefined => {
    const cached = skillCountCache.get(projectCwd);
    if (cached !== undefined) return cached;
    if (!skillCountLoads.has(projectCwd)) {
      skillCountLoads.add(projectCwd);
      void loadProjectSkillsState(projectCwd).then((state) => {
        skillCountCache.set(projectCwd, state.attached.length);
        skillCountLoads.delete(projectCwd);
        tui.requestRender();
      }).catch(() => { skillCountLoads.delete(projectCwd); });
    }
    return undefined;
  };
  let stopLoop: RefreshLoopHandle | undefined;
  let stopThemeLoop: (() => void) | undefined;
  let stopActionLoop: (() => void) | undefined;
  let stopped = false;
  const stop = () => {
    stopped = true;
    stopThemeLoop?.();
    stopActionLoop?.();
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
  const skillPickerItems = async (projectCwd: string) => {
    const state = await loadProjectSkillsState(projectCwd);
    const enabledSkillNames = new Set(state.attached.map((skill) => skill.name));
    return skillPool.map((skill) => ({ name: skill.name, enabled: enabledSkillNames.has(skill.name) }));
  };
  const view = new SessionsView(controller, stop, {
    attachOutsideTmux(tmuxSession) {
      const session = controller.snapshot().registry.sessions.find((item) => item.tmuxSession === tmuxSession);
      if (session) pinDashboardThemeSession(session);
      stop();
      spawn("tmux", ["attach-session", "-t", tmuxSession], { stdio: "inherit" });
    },
    async switchInsideTmux(tmuxSession) {
      const session = controller.snapshot().registry.sessions.find((item) => item.tmuxSession === tmuxSession);
      if (session) {
        pinDashboardThemeSession(session);
        const sessionTheme = await loadManagedTheme(session);
        view.setTheme(sessionTheme);
        syncDashboardChrome(sessionTheme);
        tui.invalidate();
        tui.requestRender();
        await configureManagedSessionStatusBar({ name: session.tmuxSession, title: session.title, cwd: session.cwd, theme: sessionTheme });
      }
      return switchClientWithReturn({
        targetSession: tmuxSession,
        renameKey: "M-r",
        returnSession: { name: DASHBOARD_SESSION, cwd, command: "pi-agent-hub tui", env: dashboardEnv() },
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
    closeSubagents(sessionId) {
      return mutateRegistry(async () => { await deleteManagedSubagentSessions(sessionId); });
    },
    createSession(input) {
      return mutateRegistry(async () => {
        const created = await addManagedSession(input);
        historyCwds = mergeRepoCwds([created.cwd, ...(created.additionalCwds ?? [])], historyCwds);
      });
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
    syncPiName(sessionId) {
      let result: Awaited<ReturnType<SessionsController["syncPiName"]>> | undefined;
      return mutateRegistry(async () => { result = await controller.syncPiName(sessionId); }).then(() => result ?? { status: "unavailable" });
    },
    renameGroup(from, to) {
      return mutateRegistry(() => controller.renameGroup(from, to));
    },
    reorderSelected(delta) {
      return mutateRegistry(() => controller.reorderSelected(delta));
    },
    sendMessage(tmuxSession, message) {
      return sendTextToSession(tmuxSession, message);
    },
    acknowledge() {
      return mutateRegistry(() => controller.acknowledgeSelected());
    },
    newFormContext() {
      return buildNewFormContext({
        cwd: process.cwd(),
        sessions: controller.snapshot().registry.sessions,
        selected: controller.selected(),
        historyCwds,
      });
    },
    async skills() {
      return skillPickerItems(selectedProjectCwd(controller.selected(), cwd));
    },
    skillPoolDir() {
      return skillPoolDirs[0];
    },
    skillPoolDirExtraCount() {
      return Math.max(0, skillPoolDirs.length - 1);
    },
    async saveSkillPoolDir(dir) {
      await setSkillPoolDir(dir);
      skillPoolDirs = await effectiveSkillPoolDirs();
      skillPool = await listSkillPool();
      return skillPickerItems(selectedProjectCwd(controller.selected(), cwd));
    },
    async applySkills(items) {
      const projectCwd = selectedProjectCwd(controller.selected(), cwd);
      const state = await setProjectSkills(projectCwd, items.flatMap((item) => {
        const skill = skillPool.find((entry) => entry.name === item.name);
        return skill ? [{ name: item.name, sourcePath: skill.path, enabled: item.enabled }] : [];
      }));
      skillCountCache.set(projectCwd, state.attached.length);
    },
    async mcpServers() {
      const state = await loadProjectMcpState(selectedProjectCwd(controller.selected(), cwd));
      const enabled = new Set(state.enabledServers);
      return Object.keys(mcpCatalog.servers).sort().map((name) => ({ name, enabled: enabled.has(name) }));
    },
    async applyMcpServers(items) {
      await setProjectMcpServers(selectedProjectCwd(controller.selected(), cwd), items.filter((item) => item.enabled).map((item) => item.name));
    },
    copy(text) {
      if (process.platform !== "darwin") return;
      const child = spawn("pbcopy", [], { stdio: ["pipe", "ignore", "ignore"] });
      child.on("error", () => {});
      child.stdin.on("error", () => {});
      child.stdin.end(text);
    },
    skillCount,
    terminalRows: () => terminal.rows,
  }, theme);
  stopThemeLoop = startThemeRefreshLoop({
    initialTheme: theme,
    load: () => loadDashboardTheme(cwd, controller.snapshot().registry.sessions, dashboardThemeSessionId),
    apply(nextTheme) {
      view.setTheme(nextTheme);
      syncDashboardChrome(nextTheme);
      void syncManagedSessionStatusBars().catch(() => {});
      tui.invalidate();
      tui.requestRender();
    },
  });
  stopActionLoop = startDashboardActionLoop(async () => {
    const action = await consumeDashboardAction();
    if (!action) return;
    await controller.refresh();
    if (action.action === "rename") view.openRenameForTmuxSession(action.tmuxSession);
    tui.requestRender();
  });
  tui.addChild(view);
  tui.setFocus(view);
  tui.start();
  stopLoop = startRefreshLoop(controller, tui);
}

export function resolveDashboardThemeSessionId(sessions: ManagedSession[], configuredId: string | undefined, selectedId: string | undefined): string | undefined {
  if (configuredId && sessions.some((session) => session.id === configuredId)) return configuredId;
  return selectedId;
}

export async function loadDashboardTheme(cwd: string, sessions: ManagedSession[], sessionId: string | undefined): Promise<SessionsTheme> {
  const session = sessions.find((item) => item.id === sessionId);
  if (session) return loadManagedTheme(session);
  return loadSessionsTheme({ cwd });
}

async function loadManagedTheme(session: ManagedSession): Promise<SessionsTheme> {
  return (await loadActiveTheme(session.activeTheme, { cwd: session.cwd })) ?? loadSessionsTheme({ cwd: session.cwd });
}

function startDashboardActionLoop(processAction: () => Promise<void>, intervalMs = 250): () => void {
  let inFlight: Promise<void> | undefined;
  let stopped = false;
  const run = () => {
    if (stopped || inFlight) return;
    inFlight = processAction().catch(() => {}).finally(() => { inFlight = undefined; });
  };
  const timer = setInterval(run, intervalMs);
  run();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

function selectedProjectCwd(selected: ManagedSession | undefined, fallback: string): string {
  return selected ? projectStateCwd(selected) : fallback;
}
