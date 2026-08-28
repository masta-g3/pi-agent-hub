import { spawn } from "node:child_process";
import { ProcessTerminal, TUI } from "@earendil-works/pi-tui";
import { readJsonOr, writeJsonAtomic } from "../core/atomic-json.js";
import { uiStatePath } from "../core/paths.js";
import { SessionsController } from "./controller.js";
import { startRefreshLoop, type RefreshLoopHandle } from "./refresh-loop.js";
import { SessionsView } from "../tui/sessions-view.js";
import { MOUSE_DISABLE, MOUSE_ENABLE } from "../tui/mouse.js";
import type { NewFormContext } from "../tui/new-form.js";
import { dashboardThemeForSetting, detectTerminalAppearance, effectiveDashboardTheme, loadGlobalThemeCatalog, loadManagedSessionTheme, saveGlobalPiTheme, type SessionsTheme } from "../tui/theme.js";
import { loadProjectSkillsState, setProjectSkills } from "../skills/attach.js";
import { listSkillPool } from "../skills/catalog.js";
import { loadMcpCatalog, loadProjectMcpState, setProjectMcpServers } from "../mcp/config.js";
import { effectiveDashboardShortcuts, effectiveDashboardThemePreference, effectiveSkillPoolDirs, effectiveWorktreeDefault, setDashboardThemePreference, setSkillPoolDirs } from "../core/config.js";
import { publishThemeCommand } from "../core/theme-command.js";
import { projectStateCwd } from "../core/multi-repo.js";
import { tmuxChromeFromTheme } from "../core/chrome.js";
import { sessionSection } from "../core/session-bucket.js";
import { loadRepoHistory, mergeRepoCwds, rankedRepoCwds } from "../core/repo-history.js";
import { attachSessionCommand, configureDashboardStatusBar, configureManagedSessionStatusBar, realTmuxExec, sendTextToSession, setDashboardMouse } from "../core/tmux.js";
import { createSidePaneLifecycle, type SidePaneLifecycle } from "./side-pane-lifecycle.js";
import { DASHBOARD_SESSION, dashboardEnv } from "./dashboard.js";
import { consumeDashboardAction } from "./dashboard-action.js";
import { deleteManagedSession, deleteManagedSubagentSessions } from "./delete-session.js";
import { addManagedSession, forkManagedSession, restartManagedSession, restartManagedSessionFresh } from "./session-lifecycle.js";
import { renameManagedSession, syncManagedSessionStatusBars } from "./session-commands.js";
import { discardWorktreeSession, finishWorktreeSession } from "./worktree-session.js";
import { cleanupRetiredSessionMetadata } from "./state-migration.js";
import { primaryWorktree, sessionWorktrees } from "../core/worktree.js";
import type { ManagedSession } from "../core/types.js";
import type { ProjectPickerTarget, SessionsViewState } from "../tui/dialog.js";

export function buildNewFormContext(input: { cwd: string; sessions: ManagedSession[]; selected?: ManagedSession; historyCwds?: string[]; worktreeDefault?: boolean }): NewFormContext {
  const selectedCwd = input.selected ? newSessionCwd(input.selected) : input.cwd;
  const selectedExtraCwds = input.selected ? newSessionAdditionalCwds(input.selected) : [];
  const worktreePaths = new Set(input.sessions.flatMap((session) => sessionWorktrees(session).map((worktree) => worktree.path)));
  const registryCwds = input.sessions.flatMap((session) => [newSessionCwd(session), ...newSessionAdditionalCwds(session)]);
  const historyCwds = (input.historyCwds ?? []).filter((cwd) => !worktreePaths.has(cwd));
  const knownCwds = mergeRepoCwds(
    [selectedCwd],
    [input.cwd],
    selectedExtraCwds,
    registryCwds,
    historyCwds,
  );
  return {
    cwd: selectedCwd,
    group: input.selected?.group,
    ...(input.worktreeDefault !== undefined ? { worktreeDefault: input.worktreeDefault } : {}),
    knownCwds,
    ...(selectedExtraCwds.length ? { additionalCwds: selectedExtraCwds } : {}),
  };
}

function newSessionCwd(session: ManagedSession): string {
  return isHubWorktree(session) ? primaryWorktree(session)?.repoRoot ?? session.worktreeRepoRoot ?? session.cwd : session.cwd;
}

function newSessionAdditionalCwds(session: ManagedSession): string[] {
  if (!isHubWorktree(session)) return session.additionalCwds ?? [];
  return sessionWorktrees(session).filter((worktree) => worktree.role !== "primary").map((worktree) => worktree.repoRoot);
}

function isHubWorktree(session: ManagedSession): boolean {
  return session.worktreeOwnedByHub === true && sessionWorktrees(session).length > 0;
}

export function restartAllTargets(sessions: ManagedSession[]): ManagedSession[] {
  return sessions.filter((session) => session.kind !== "subagent" && sessionSection(session) === "active");
}

export interface ThemeRefreshLoopOptions {
  initialTheme: SessionsTheme;
  load: () => Promise<SessionsTheme>;
  apply: (theme: SessionsTheme) => void;
  suspended?: () => boolean;
  intervalMs?: number;
}

export function startThemeRefreshLoop(options: ThemeRefreshLoopOptions): () => void {
  let activeThemeKey = themeKey(options.initialTheme);
  let inFlight: Promise<void> | undefined;
  let stopped = false;
  const run = () => {
    if (stopped || inFlight || options.suspended?.()) return;
    inFlight = (async () => {
      try {
        const nextTheme = await options.load();
        if (stopped || options.suspended?.()) return;
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

export interface PersistDashboardThemeDeps {
  savePi(setting: string): Promise<void>;
  savePreference(preference: { syncPi: boolean; theme?: string }): Promise<void>;
  publish(setting: string): Promise<void>;
}

export async function persistDashboardThemeSelection(setting: string, syncPi: boolean, deps: PersistDashboardThemeDeps): Promise<void> {
  if (syncPi) await deps.savePi(setting);
  try {
    await deps.savePreference({ syncPi, ...(syncPi ? {} : { theme: setting }) });
  } catch (error) {
    if (syncPi) throw new Error(`Pi default changed; Hub preference not saved: ${errorMessage(error)}`);
    throw error;
  }
  if (syncPi) await deps.publish(setting);
}

export interface RegistryMutatorDeps {
  pause(): Promise<void>;
  resume(): void;
  refresh(): Promise<void>;
  render(): void;
}

export function createRegistryMutator(deps: RegistryMutatorDeps): (action: () => Promise<void>) => Promise<void> {
  let queue = Promise.resolve();
  return (action) => {
    const run = async () => {
      try {
        await deps.pause();
        await action();
        await deps.refresh();
        deps.render();
      } finally {
        deps.resume();
      }
    };
    const result = queue.then(run, run);
    queue = result.catch(() => {});
    return result;
  };
}

export async function runTui(): Promise<void> {
  const cwd = process.cwd();
  await cleanupRetiredSessionMetadata();
  const controller = new SessionsController();
  await controller.refresh();
  const terminalAppearance = detectTerminalAppearance();
  const themeCatalog = await loadGlobalThemeCatalog();
  let themePreference = await effectiveDashboardThemePreference();
  let dashboardTheme = await effectiveDashboardTheme(themeCatalog, themePreference, terminalAppearance);
  const theme = dashboardTheme.theme;
  let currentTheme = theme;
  let themePreviewActive = false;
  let sidePanes: SidePaneLifecycle | undefined;
  const syncDashboardChrome = (nextTheme: SessionsTheme) => {
    if (!process.env.TMUX) return;
    void configureDashboardStatusBar({
      name: DASHBOARD_SESSION,
      cwd,
      theme: nextTheme,
      visible: sidePanes?.snapshot().dashboardStatusVisible ?? true,
    }).catch(() => {});
  };
  const applyManagedSessionTheme = async (session: ManagedSession, visible: boolean) => {
    const sessionTheme = await loadManagedSessionTheme(session);
    await configureManagedSessionStatusBar({
      name: session.tmuxSession,
      title: session.title,
      cwd: session.cwd,
      theme: sessionTheme,
      visible,
    });
  };
  syncDashboardChrome(theme);
  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal, false);
  const dashboardShortcuts = await effectiveDashboardShortcuts();
  const worktreeDefault = await effectiveWorktreeDefault();
  let skillPoolDirs = await effectiveSkillPoolDirs();
  let skillPool = await listSkillPool();
  const mcpCatalog = await loadMcpCatalog();
  let historyCwds = rankedRepoCwds((await loadRepoHistory()).repos);
  const savedViewState = await readJsonOr<unknown>(uiStatePath(), {});
  const saved = savedViewState && typeof savedViewState === "object" ? savedViewState as Partial<SessionsViewState> : {};
  const collapsedSections = Array.isArray(saved.collapsedSections)
    ? [...new Set(saved.collapsedSections.filter((section): section is "backlog" | "archived" => section === "backlog" || section === "archived"))]
    : [];
  const initialViewState: SessionsViewState = {
    grouping: saved.grouping === "stage" ? "stage" : "project",
    density: saved.density === "all-cards" ? "all-cards" : "compact",
    collapsedSections,
  };
  let stopLoop: RefreshLoopHandle | undefined;
  let stopThemeLoop: (() => void) | undefined;
  let stopActionLoop: (() => void) | undefined;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    stopThemeLoop?.();
    stopActionLoop?.();
    void stopLoop?.stop();
    const finish = () => {
      terminal.write(MOUSE_DISABLE);
      tui.stop();
    };
    void (sidePanes?.stop() ?? Promise.resolve())
      .then(() => process.env.TMUX ? setDashboardMouse({ name: DASHBOARD_SESSION, enabled: false }).catch(() => {}) : undefined)
      .finally(finish);
  };
  const mutateRegistry = createRegistryMutator({
    async pause() {
      const loop = stopLoop;
      stopLoop = undefined;
      await loop?.stop();
    },
    resume() {
      if (!stopped) stopLoop = startRefreshLoop(controller, tui);
    },
    refresh: () => controller.refresh(),
    render: () => tui.requestRender(),
  });
  sidePanes = createSidePaneLifecycle({
    dashboardSession: DASHBOARD_SESSION,
    dashboardCwd: cwd,
    dashboardCommand: "pi-agent-hub tui",
    dashboardEnv,
    ownPane: () => process.env.TMUX_PANE,
    insideTmux: () => Boolean(process.env.TMUX),
    sessions: () => controller.snapshot().registry.sessions,
    acknowledgeSession: (sessionId) => mutateRegistry(() => controller.acknowledgeSession(sessionId)),
    configureManagedSession: applyManagedSessionTheme,
    syncManagedSessionStatusBars,
    currentChrome: () => tmuxChromeFromTheme(currentTheme),
    render: () => tui.requestRender(),
    exec: realTmuxExec,
  });
  const skillPickerItems = async (projectCwd: string) => {
    const state = await loadProjectSkillsState(projectCwd);
    const enabledSkillNames = new Set(state.attached.map((skill) => skill.name));
    return skillPool.map((skill) => ({ name: skill.name, enabled: enabledSkillNames.has(skill.name) }));
  };
  const applyDashboardThemeLocal = (nextTheme: SessionsTheme) => {
    currentTheme = nextTheme;
    view.setTheme(nextTheme);
    syncDashboardChrome(nextTheme);
    sidePanes?.refreshPanelChrome();
    tui.invalidate();
    tui.requestRender();
  };
  const applyThemeToLiveManagedChrome = async (nextTheme: SessionsTheme) => {
    const paneledSessions = new Set(sidePanes?.snapshot().slots.filter((session): session is string => Boolean(session)) ?? []);
    for (const session of controller.snapshot().registry.sessions) {
      if (session.kind === "subagent" || session.status === "stopped" || session.status === "error") continue;
      await configureManagedSessionStatusBar({
        name: session.tmuxSession,
        title: session.title,
        cwd: session.cwd,
        theme: nextTheme,
        visible: !paneledSessions.has(session.tmuxSession),
      }).catch(() => {});
    }
  };
  const view = new SessionsView(controller, stop, {
    initialViewState,
    saveViewState(state) { void writeJsonAtomic(uiStatePath(), state); },
    attachOutsideTmux(tmuxSession) {
      stop();
      const attach = attachSessionCommand(tmuxSession);
      spawn(attach.command, attach.args, { stdio: "inherit" });
    },
    switchInsideTmux: (tmuxSession) => sidePanes!.handoff(tmuxSession),
    assignSidePaneSlot: (sessionId, slot) => sidePanes!.assign(sessionId, slot),
    closeSidePaneSlot: (slot) => sidePanes!.close(slot),
    resetSidePane: (sessionId) => sidePanes!.reset(sessionId),
    focusSidePaneSlot: (slot) => sidePanes!.focus(slot),
    sidePaneSessionIds() {
      return mapSidePaneSessionIds(sidePanes!.snapshot().slots, controller.snapshot().registry.sessions);
    },
    sidePaneFocusedSlot: () => sidePanes!.snapshot().focusedSlot,
    refreshStatusEvidence() {
      return stopLoop?.refresh() ?? controller.refresh();
    },
    restart(sessionId) {
      return mutateRegistry(() => restartManagedSession(sessionId));
    },
    restartNew(sessionId) {
      return mutateRegistry(() => restartManagedSessionFresh(sessionId));
    },
    restartAll() {
      return mutateRegistry(async () => {
        const sessions = restartAllTargets(controller.snapshot().registry.sessions);
        for (const session of sessions) await restartManagedSession(session.id);
      });
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
    discardWorktree(sessionId) {
      return mutateRegistry(async () => {
        const discarded = await discardWorktreeSession(sessionId);
        controller.removeSession(discarded.id);
      });
    },
    createSession(input) {
      return mutateRegistry(async () => {
        const created = await addManagedSession(input);
        const createdHistory = input.worktree ? [input.cwd, ...(input.additionalCwds ?? [])] : [created.cwd, ...(created.additionalCwds ?? [])];
        historyCwds = mergeRepoCwds(createdHistory, historyCwds);
      });
    },
    finishWorktree(sessionId) {
      return mutateRegistry(async () => {
        const finished = await finishWorktreeSession(sessionId);
        controller.removeSession(finished.id);
      });
    },
    forkSession(sourceSessionId, input) {
      return mutateRegistry(async () => { await forkManagedSession(sourceSessionId, input); });
    },
    changeGroup(sessionId, group) {
      return mutateRegistry(() => controller.moveSessionToGroup(sessionId, group));
    },
    archiveSession(sessionId) {
      return mutateRegistry(async () => {
        const session = controller.snapshot().registry.sessions.find((item) => item.id === sessionId);
        if (session) await sidePanes!.detach(session.tmuxSession);
        await controller.moveSessionToBucket(sessionId, "archived");
      });
    },
    backlogSession(sessionId) {
      return mutateRegistry(() => controller.moveSessionToBucket(sessionId, "backlog"));
    },
    restoreSession(sessionId) {
      return mutateRegistry(() => controller.restoreSessionBucket(sessionId));
    },
    renameSession(sessionId, title) {
      return renameManagedSession(sessionId, title);
    },
    syncPiName(sessionId) {
      let result: Awaited<ReturnType<SessionsController["syncPiName"]>> | undefined;
      return mutateRegistry(async () => { result = await controller.syncPiName(sessionId); }).then(() => result ?? { status: "unavailable" });
    },
    renameGroup(from, to) {
      return mutateRegistry(() => controller.renameGroup(from, to));
    },
    reorderSession(sessionId, delta) {
      return mutateRegistry(() => controller.reorderSession(sessionId, delta));
    },
    sendMessage(tmuxSession, message) {
      return sendTextToSession(tmuxSession, message);
    },
    dashboardShortcuts,
    async runDashboardShortcut(sessionId, shortcut) {
      const session = controller.snapshot().registry.sessions.find((item) => item.id === sessionId);
      if (!session) throw new Error("session not found");
      await sendTextToSession(session.tmuxSession, shortcut.send);
    },
    acknowledgeSession(sessionId) {
      return mutateRegistry(() => controller.acknowledgeSession(sessionId));
    },
    newFormContext() {
      return buildNewFormContext({
        cwd: process.cwd(),
        sessions: controller.snapshot().registry.sessions,
        selected: controller.selected(),
        historyCwds,
        worktreeDefault,
      });
    },
    async skills(target) {
      return skillPickerItems(resolveProjectPickerTarget(target, controller.snapshot().registry.sessions));
    },
    pickerTarget() {
      const selected = controller.selected();
      return selected
        ? { sessionId: selected.id, projectCwd: projectStateCwd(selected) }
        : { projectCwd: cwd };
    },
    skillPoolDir() {
      return skillPoolDirs[0];
    },
    skillPoolDirExtraCount() {
      return Math.max(0, skillPoolDirs.length - 1);
    },
    async saveSkillPoolDir(dir, target) {
      const projectCwd = resolveProjectPickerTarget(target, controller.snapshot().registry.sessions);
      await setSkillPoolDirs([dir]);
      skillPoolDirs = await effectiveSkillPoolDirs();
      skillPool = await listSkillPool();
      return skillPickerItems(projectCwd);
    },
    async applySkills(items, target) {
      const projectCwd = resolveProjectPickerTarget(target, controller.snapshot().registry.sessions);
      await setProjectSkills(projectCwd, items.flatMap((item) => {
        const skill = skillPool.find((entry) => entry.name === item.name);
        return skill ? [{ name: item.name, sourcePath: skill.path, enabled: item.enabled }] : [];
      }));
    },
    async mcpServers(target) {
      const state = await loadProjectMcpState(resolveProjectPickerTarget(target, controller.snapshot().registry.sessions));
      const enabled = new Set(state.enabledServers);
      return Object.keys(mcpCatalog.servers).sort().map((name) => ({ name, enabled: enabled.has(name) }));
    },
    async applyMcpServers(items, target) {
      const projectCwd = resolveProjectPickerTarget(target, controller.snapshot().registry.sessions);
      await setProjectMcpServers(projectCwd, items.filter((item) => item.enabled).map((item) => item.name));
    },
    async themeSettings() {
      themePreference = await effectiveDashboardThemePreference();
      dashboardTheme = await effectiveDashboardTheme(themeCatalog, themePreference, terminalAppearance);
      return {
        names: themeCatalog.options.map((option) => option.name),
        setting: dashboardTheme.setting,
        syncPi: themePreference.syncPi,
      };
    },
    previewDashboardTheme(setting) {
      themePreviewActive = true;
      applyDashboardThemeLocal(dashboardThemeForSetting(themeCatalog, setting, terminalAppearance).theme);
    },
    cancelDashboardTheme(setting) {
      applyDashboardThemeLocal(dashboardThemeForSetting(themeCatalog, setting, terminalAppearance).theme);
      themePreviewActive = false;
    },
    async applyDashboardTheme(setting, syncPi) {
      const next = dashboardThemeForSetting(themeCatalog, setting, terminalAppearance);
      await persistDashboardThemeSelection(setting, syncPi, {
        savePi: (value) => saveGlobalPiTheme(value),
        savePreference: (preference) => setDashboardThemePreference(preference),
        publish: (value) => publishThemeCommand(value, next.name).then(() => {}),
      });
      themePreference = { syncPi, ...(syncPi ? {} : { theme: setting }) };
      dashboardTheme = next;
      applyDashboardThemeLocal(next.theme);
      if (syncPi) await applyThemeToLiveManagedChrome(next.theme);
      themePreviewActive = false;
    },
    copy(text) {
      if (process.platform !== "darwin") return;
      const child = spawn("pbcopy", [], { stdio: ["pipe", "ignore", "ignore"] });
      child.on("error", () => {});
      child.stdin.on("error", () => {});
      child.stdin.end(text);
    },
    terminalRows: () => terminal.rows,
  }, theme);
  stopThemeLoop = startThemeRefreshLoop({
    initialTheme: theme,
    suspended: () => themePreviewActive,
    async load() {
      themePreference = await effectiveDashboardThemePreference();
      dashboardTheme = await effectiveDashboardTheme(themeCatalog, themePreference, terminalAppearance);
      return dashboardTheme.theme;
    },
    apply(nextTheme) {
      applyDashboardThemeLocal(nextTheme);
      sidePanes?.syncOpenSessionChrome();
    },
  });
  stopActionLoop = startDashboardActionLoop(async () => {
    const action = await consumeDashboardAction();
    if (!action) return;
    await controller.refresh();
    if (action.action === "rename") view.openRenameForTmuxSession(action.tmuxSession);
    tui.requestRender();
  });
  sidePanes.start();
  tui.addChild(view);
  tui.setFocus(view);
  terminal.write("\x1b[2J\x1b[H");
  tui.start();
  terminal.write(MOUSE_ENABLE);
  if (process.env.TMUX) void setDashboardMouse({ name: DASHBOARD_SESSION, enabled: true }).catch(() => {});
  stopLoop = startRefreshLoop(controller, tui);
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

export function mapSidePaneSessionIds(slots: readonly (string | undefined)[], sessions: readonly ManagedSession[]): Map<string, number> {
  const ids = new Map<string, number>();
  for (const [index, tmuxSession] of slots.entries()) {
    const session = tmuxSession ? sessions.find((item) => item.tmuxSession === tmuxSession) : undefined;
    if (session) ids.set(session.id, index + 1);
  }
  return ids;
}

export function resolveProjectPickerTarget(target: ProjectPickerTarget, sessions: readonly ManagedSession[]): string {
  if (!target.sessionId) return target.projectCwd;
  const session = sessions.find((item) => item.id === target.sessionId);
  if (!session || projectStateCwd(session) !== target.projectCwd) throw new Error("picker target is no longer available");
  return target.projectCwd;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
