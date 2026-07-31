import { spawn } from "node:child_process";
import { ProcessTerminal, TUI } from "@earendil-works/pi-tui";
import { SessionsController } from "./controller.js";
import { startRefreshLoop, type RefreshLoopHandle } from "./refresh-loop.js";
import { SessionsView } from "../tui/sessions-view.js";
import { MOUSE_DISABLE, MOUSE_ENABLE } from "../tui/mouse.js";
import type { NewFormContext } from "../tui/new-form.js";
import { loadManagedSessionTheme, loadSessionsTheme, type SessionsTheme } from "../tui/theme.js";
import { loadProjectSkillsState, setProjectSkills } from "../skills/attach.js";
import { listSkillPool } from "../skills/catalog.js";
import { loadMcpCatalog, loadProjectMcpState, setProjectMcpServers } from "../mcp/config.js";
import { effectiveDashboardShortcuts, effectiveDashboardThemeSessionId, effectiveSkillPoolDirs, effectiveWorktreeDefault, setDashboardThemeSessionId, setSkillPoolDir } from "../core/config.js";
import { projectStateCwd } from "../core/multi-repo.js";
import { tmuxChromeFromTheme } from "../core/chrome.js";
import { sessionSection } from "../core/session-bucket.js";
import { loadRepoHistory, mergeRepoCwds, rankedRepoCwds } from "../core/repo-history.js";
import { attachSessionCommand, configureDashboardStatusBar, configureManagedSessionStatusBar, reconcileSidebarReturnBinding, removeSidebarReturnBinding, resizePaneWidth, restoreSwitchReturnBinding, sendTextToSession, setDashboardMouse, setSessionStatusBarVisible, setPaneTitle, setWindowPaneBorderStatus, switchClientWithReturn } from "../core/tmux.js";
import { assignSidePaneSlot, closeSidePaneShowing, closeSidePanes, closeSidePaneSlot as closePanel, focusSidePaneSlot as focusPanel, resetSidePane, sidebarRepairWidth, sidePaneStatus, type SidePaneResult } from "./side-pane.js";
import { DASHBOARD_SESSION, dashboardEnv } from "./dashboard.js";
import { consumeDashboardAction } from "./dashboard-action.js";
import { deleteManagedSession, deleteManagedSubagentSessions } from "./delete-session.js";
import { addManagedSession, forkManagedSession, restartManagedSession, restartManagedSessionFresh, syncManagedSessionStatusBars } from "./session-commands.js";
import { automaticRecoveryAfterTmuxRestart, automaticRecoveryMessage } from "./session-recovery.js";
import { discardWorktreeSession, finishWorktreeSession } from "./worktree-session.js";
import { primaryWorktree, sessionWorktrees } from "../core/worktree.js";
import type { ManagedSession } from "../core/types.js";

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
  const startupRecovery = await automaticRecoveryAfterTmuxRestart();
  const controller = new SessionsController();
  await controller.refresh();
  let dashboardThemeSessionId = resolveDashboardThemeSessionId(controller.snapshot().registry.sessions, await effectiveDashboardThemeSessionId(), controller.selected()?.id);
  const pinDashboardThemeSession = (session: ManagedSession) => {
    dashboardThemeSessionId = session.id;
    void setDashboardThemeSessionId(session.id).catch(() => {});
  };
  const theme = await loadDashboardTheme(cwd, controller.snapshot().registry.sessions, dashboardThemeSessionId);
  let currentTheme = theme;
  let dashboardStatusVisible = true;
  const applyDashboardStatusVisibility = async (visible: boolean, force = false) => {
    if (!process.env.TMUX || (!force && dashboardStatusVisible === visible)) return;
    await setSessionStatusBarVisible({ name: DASHBOARD_SESSION, visible });
    dashboardStatusVisible = visible;
  };
  const syncDashboardChrome = (nextTheme: SessionsTheme) => {
    if (!process.env.TMUX) return;
    void configureDashboardStatusBar({ name: DASHBOARD_SESSION, cwd, theme: nextTheme, visible: dashboardStatusVisible }).catch(() => {});
  };
  const applyManagedSessionTheme = async (session: ManagedSession, visible = !sidePaneSlots.includes(session.tmuxSession)) => {
    pinDashboardThemeSession(session);
    const sessionTheme = await loadManagedSessionTheme(session);
    currentTheme = sessionTheme;
    view.setTheme(sessionTheme);
    syncDashboardChrome(sessionTheme);
    tui.invalidate();
    tui.requestRender();
    await configureManagedSessionStatusBar({
      name: session.tmuxSession,
      title: session.title,
      cwd: session.cwd,
      theme: sessionTheme,
      visible,
    });
    const ownPane = process.env.TMUX_PANE;
    if (ownPane && sidePaneSlots.some(Boolean)) await setWindowPaneBorderStatus(ownPane, true, tmuxChromeFromTheme(currentTheme)).catch(() => {});
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
  let stopSidePanePresenceLoop: (() => Promise<void>) | undefined;
  let sidePanePresenceDrain: Promise<void> | undefined;
  let sidePaneTail = Promise.resolve();
  let sidePaneSlots: (string | undefined)[] = [undefined, undefined, undefined, undefined];
  let sidePaneFocusedSlot: number | undefined;
  let stopped = false;
  const titleForTmuxSession = (tmuxSession: string) => controller.snapshot().registry.sessions.find((session) => session.tmuxSession === tmuxSession)?.title;
  const refreshSidePanePresence = async () => {
    const ownPane = process.env.TMUX_PANE;
    let next: (string | undefined)[] = [undefined, undefined, undefined, undefined];
    let nextFocusedSlot: number | undefined;
    if (ownPane) {
      const status = await sidePaneStatus({ ownPane });
      next = status.slots;
      nextFocusedSlot = status.activeSlot;
      if (status.slots.some(Boolean) && status.ownWidth !== undefined && status.windowWidth !== undefined) {
        const repairWidth = sidebarRepairWidth(status.ownWidth, status.windowWidth);
        if (repairWidth !== undefined) await resizePaneWidth(ownPane, repairWidth);
      }
      for (const [index, paneId] of status.paneIds.entries()) {
        const tmuxSession = status.slots[index];
        if (tmuxSession && paneId) await setPaneTitle(paneId, `[${index + 1}] ${titleForTmuxSession(tmuxSession) ?? tmuxSession}`);
      }
    }
    const changed = !sameStringArrays(sidePaneSlots, next) || sidePaneFocusedSlot !== nextFocusedSlot;
    const hadSidePanes = sidePaneSlots.some(Boolean);
    const hasSidePanes = next.some(Boolean);
    if (ownPane && hadSidePanes !== hasSidePanes) {
      await applyDashboardStatusVisibility(!hasSidePanes);
      await setWindowPaneBorderStatus(ownPane, hasSidePanes, hasSidePanes ? tmuxChromeFromTheme(currentTheme) : undefined);
      if (hasSidePanes) await setPaneTitle(ownPane, "");
    }
    if (ownPane) await reconcileSidebarReturnBinding({ desired: hasSidePanes, dashboardSession: DASHBOARD_SESSION, sidebarPane: ownPane });
    await syncSidePaneSessionFooters(
      sidePaneSlots.filter((session): session is string => Boolean(session)),
      next.filter((session): session is string => Boolean(session)),
      (name, visible) => setSessionStatusBarVisible({ name, visible }),
    );
    sidePaneSlots = next;
    sidePaneFocusedSlot = nextFocusedSlot;
    return changed;
  };
  const serializeSidePaneOperation = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = sidePaneTail.then(operation);
    sidePaneTail = result.then(() => {}, () => {});
    return result;
  };
  const refreshSidePanePresenceSerialized = () => serializeSidePaneOperation(
    () => stopped ? Promise.resolve(false) : refreshSidePanePresence(),
  );
  void serializeSidePaneOperation(() => syncManagedSessionStatusBars(new Set(sidePaneSlots.filter((session): session is string => Boolean(session))))).catch(() => {});
  const shortcutTimers = new Set<NodeJS.Timeout>();
  const pauseSidePanePresenceLoop = () => {
    if (sidePanePresenceDrain) return sidePanePresenceDrain;
    const stopPresence = stopSidePanePresenceLoop;
    stopSidePanePresenceLoop = undefined;
    sidePanePresenceDrain = Promise.resolve(stopPresence?.())
      .finally(() => { sidePanePresenceDrain = undefined; });
    return sidePanePresenceDrain;
  };
  const resumeSidePanePresenceLoop = () => {
    if (stopped || stopSidePanePresenceLoop) return;
    stopSidePanePresenceLoop = startSidePanePresenceRefreshLoop({
      ownPane: process.env.TMUX_PANE,
      load: refreshSidePanePresenceSerialized,
      render: () => tui.requestRender(),
    });
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    stopThemeLoop?.();
    stopActionLoop?.();
    const presencePaused = pauseSidePanePresenceLoop();
    const sidePaneDrained = sidePaneTail;
    for (const timer of shortcutTimers) clearTimeout(timer);
    shortcutTimers.clear();
    void stopLoop?.stop();
    const ownPane = process.env.TMUX_PANE;
    const finish = () => {
      terminal.write(MOUSE_DISABLE);
      tui.stop();
    };
    const restoreBindings = () => Promise.all([presencePaused, sidePaneDrained])
      .then(() => restoreSwitchReturnBinding({ onlyOwnerPid: process.pid }).catch(() => {}))
      .then(() => removeSidebarReturnBinding({ onlyOwnerPid: process.pid }).catch(() => {}));
    if (ownPane) {
      void restoreBindings()
        .then(async () => {
          for (const tmuxSession of sidePaneSlots) if (tmuxSession) await setSessionStatusBarVisible({ name: tmuxSession, visible: true }).catch(() => {});
        })
        .then(() => closeSidePanes({ ownPane }).catch(() => {}))
        .then(() => applyDashboardStatusVisibility(true, true).catch(() => {}))
        .then(() => setWindowPaneBorderStatus(ownPane, false).catch(() => {}))
        .then(() => process.env.TMUX ? setDashboardMouse({ name: DASHBOARD_SESSION, enabled: false }).catch(() => {}) : undefined)
        .finally(finish);
    } else {
      void restoreBindings()
        .then(() => applyDashboardStatusVisibility(true, true).catch(() => {}))
        .then(() => process.env.TMUX ? setDashboardMouse({ name: DASHBOARD_SESSION, enabled: false }).catch(() => {}) : undefined)
        .finally(finish);
    }
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
  const scheduleShortcutNameSync = (sessionId: string, delayMs: number) => {
    const timer = setTimeout(() => {
      shortcutTimers.delete(timer);
      void mutateRegistry(async () => {
        await controller.syncPiName(sessionId);
      }).catch((error: unknown) => {
        if (!stopped) {
          view.setMessage(errorMessage(error));
          tui.requestRender();
        }
      });
    }, delayMs);
    shortcutTimers.add(timer);
  };
  const skillPickerItems = async (projectCwd: string) => {
    const state = await loadProjectSkillsState(projectCwd);
    const enabledSkillNames = new Set(state.attached.map((skill) => skill.name));
    return skillPool.map((skill) => ({ name: skill.name, enabled: enabledSkillNames.has(skill.name) }));
  };
  const updateSidePane = async (
    sessionId: string,
    update: (tmuxSession: string, ownPane: string) => Promise<SidePaneResult>,
  ): Promise<SidePaneResult> => {
    await pauseSidePanePresenceLoop();
    try {
      return await serializeSidePaneOperation(async () => {
        if (stopped) throw new Error("dashboard stopped");
        const session = controller.snapshot().registry.sessions.find((item) => item.id === sessionId);
        if (!session) throw new Error("session not found");
        const ownPane = process.env.TMUX_PANE;
        if (!ownPane) throw new Error("side pane needs tmux — run pi-hub");
        if (session.status === "waiting") await mutateRegistry(() => controller.acknowledgeSession(session.id));
        const openingFirstPanel = !sidePaneSlots.some(Boolean);
        if (openingFirstPanel) {
          await applyDashboardStatusVisibility(false);
          await setWindowPaneBorderStatus(ownPane, true, tmuxChromeFromTheme(currentTheme));
          await setPaneTitle(ownPane, "");
        }
        let result: SidePaneResult;
        try {
          result = await update(session.tmuxSession, ownPane);
        } catch (error) {
          if (openingFirstPanel) {
            const status = await sidePaneStatus({ ownPane }).catch(() => undefined);
            if (status?.slots.some(Boolean)) {
              sidePaneSlots = status.slots;
              await reconcileSidebarReturnBinding({ desired: true, dashboardSession: DASHBOARD_SESSION, sidebarPane: ownPane }).catch(() => {});
            } else {
              await applyDashboardStatusVisibility(true).catch(() => {});
              await setWindowPaneBorderStatus(ownPane, false).catch(() => {});
            }
          }
          throw error;
        }
        if (openingFirstPanel && result.kind === "too-narrow") {
          await applyDashboardStatusVisibility(true);
          await setWindowPaneBorderStatus(ownPane, false);
        }
        const changed = await refreshSidePanePresence();
        if (stopped) return result;
        if (changed) tui.requestRender();
        if (result.kind === "opened" || result.kind === "retargeted" || result.kind === "moved") await applyManagedSessionTheme(session);
        return result;
      });
    } finally {
      resumeSidePanePresenceLoop();
    }
  };
  const view = new SessionsView(controller, stop, {
    attachOutsideTmux(tmuxSession) {
      const session = controller.snapshot().registry.sessions.find((item) => item.tmuxSession === tmuxSession);
      if (session) pinDashboardThemeSession(session);
      stop();
      const attach = attachSessionCommand(tmuxSession);
      spawn(attach.command, attach.args, { stdio: "inherit" });
    },
    async switchInsideTmux(tmuxSession) {
      await pauseSidePanePresenceLoop();
      try {
        await serializeSidePaneOperation(async () => {
          if (stopped) return;
          const session = controller.snapshot().registry.sessions.find((item) => item.tmuxSession === tmuxSession);
          const ownPane = process.env.TMUX_PANE;
          if (session) await applyManagedSessionTheme(session, true);
          if (stopped) return;
          await removeSidebarReturnBinding({ onlyOwnerPid: process.pid });
          await switchClientWithReturn({
            targetSession: tmuxSession,
            renameKey: "M-r",
            returnSession: { name: DASHBOARD_SESSION, cwd, command: "pi-agent-hub tui", env: dashboardEnv() },
          });
          if (ownPane && await closeSidePaneShowing({ target: tmuxSession, ownPane })) await refreshSidePanePresence();
        });
      } finally {
        resumeSidePanePresenceLoop();
      }
    },
    assignSidePaneSlot(sessionId, slot) {
      return updateSidePane(sessionId, (target, ownPane) => assignSidePaneSlot({ target, ownPane, slot, titleFor: titleForTmuxSession }));
    },
    async closeSidePaneSlot(slot) {
      await pauseSidePanePresenceLoop();
      try {
        return await serializeSidePaneOperation(async () => {
          const ownPane = process.env.TMUX_PANE;
          if (!ownPane) throw new Error("side pane needs tmux — run pi-hub");
          const result = await closePanel({ ownPane, slot, titleFor: titleForTmuxSession });
          if (await refreshSidePanePresence()) tui.requestRender();
          return result;
        });
      } finally {
        resumeSidePanePresenceLoop();
      }
    },
    resetSidePane(sessionId) {
      return updateSidePane(sessionId, (target, ownPane) => resetSidePane({ target, ownPane, titleFor: titleForTmuxSession }));
    },
    focusSidePaneSlot(slot) {
      return serializeSidePaneOperation(() => {
        if (stopped) return Promise.resolve({ kind: "unavailable" as const });
        const ownPane = process.env.TMUX_PANE;
        if (!ownPane) throw new Error("side pane needs tmux — run pi-hub");
        return focusPanel({ ownPane, slot });
      });
    },
    sidePaneSessionIds() {
      return mapSidePaneSessionIds(sidePaneSlots, controller.snapshot().registry.sessions);
    },
    sidePaneFocusedSlot: () => sidePaneFocusedSlot,
    selectionChanged() {
      void controller.refreshPreview()
        .then(() => { if (!stopped) tui.requestRender(); })
        .catch(() => {});
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
      return mutateRegistry(() => controller.moveSessionToBucket(sessionId, "archived"));
    },
    backlogSession(sessionId) {
      return mutateRegistry(() => controller.moveSessionToBucket(sessionId, "backlog"));
    },
    restoreSession(sessionId) {
      return mutateRegistry(() => controller.restoreSessionBucket(sessionId));
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
    dashboardShortcuts,
    async runDashboardShortcut(sessionId, shortcut) {
      const session = controller.snapshot().registry.sessions.find((item) => item.id === sessionId);
      if (!session) throw new Error("session not found");
      await sendTextToSession(session.tmuxSession, shortcut.send);
      if (shortcut.syncPiNameAfterMs) scheduleShortcutNameSync(session.id, shortcut.syncPiNameAfterMs);
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
        worktreeDefault,
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
  const recoveryMessage = automaticRecoveryMessage(startupRecovery);
  if (recoveryMessage) view.setMessage(recoveryMessage);
  stopThemeLoop = startThemeRefreshLoop({
    initialTheme: theme,
    load: () => loadDashboardTheme(cwd, controller.snapshot().registry.sessions, dashboardThemeSessionId),
    apply(nextTheme) {
      currentTheme = nextTheme;
      view.setTheme(nextTheme);
      syncDashboardChrome(nextTheme);
      const ownPane = process.env.TMUX_PANE;
      if (ownPane && sidePaneSlots.some(Boolean)) void setWindowPaneBorderStatus(ownPane, true, tmuxChromeFromTheme(currentTheme)).catch(() => {});
      void serializeSidePaneOperation(() => syncManagedSessionStatusBars(new Set(sidePaneSlots.filter((session): session is string => Boolean(session))))).catch(() => {});
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
  resumeSidePanePresenceLoop();
  tui.addChild(view);
  tui.setFocus(view);
  terminal.write("\x1b[2J\x1b[H");
  tui.start();
  terminal.write(MOUSE_ENABLE);
  if (process.env.TMUX) void setDashboardMouse({ name: DASHBOARD_SESSION, enabled: true }).catch(() => {});
  stopLoop = startRefreshLoop(controller, tui);
}

export function resolveDashboardThemeSessionId(sessions: ManagedSession[], configuredId: string | undefined, selectedId: string | undefined): string | undefined {
  if (configuredId && sessions.some((session) => session.id === configuredId)) return configuredId;
  return selectedId;
}

export async function loadDashboardTheme(cwd: string, sessions: ManagedSession[], sessionId: string | undefined): Promise<SessionsTheme> {
  const session = sessions.find((item) => item.id === sessionId);
  if (session) return loadManagedSessionTheme(session);
  return loadSessionsTheme({ cwd });
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

export function startSidePanePresenceRefreshLoop(options: {
  ownPane: string | undefined;
  load(): Promise<boolean>;
  render(): void;
}, intervalMs = 500): () => Promise<void> {
  if (!options.ownPane) return async () => {};
  let inFlight: Promise<void> | undefined;
  let stopped = false;
  const run = () => {
    if (stopped || inFlight) return;
    inFlight = options.load()
      .then((changed) => {
        if (changed && !stopped) options.render();
      })
      .catch(() => {})
      .finally(() => { inFlight = undefined; });
  };
  const timer = setInterval(run, intervalMs);
  run();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await inFlight;
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

export async function syncSidePaneSessionFooters(
  previous: readonly string[],
  next: readonly string[],
  setVisible: (name: string, visible: boolean) => Promise<void>,
): Promise<void> {
  for (const name of previous) {
    if (!next.includes(name)) await setVisible(name, true).catch(() => {});
  }
  for (const name of next) {
    if (!previous.includes(name)) await setVisible(name, false).catch(() => {});
  }
}

function sameStringArrays(a: readonly (string | undefined)[], b: readonly (string | undefined)[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function selectedProjectCwd(selected: ManagedSession | undefined, fallback: string): string {
  return selected ? projectStateCwd(selected) : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
