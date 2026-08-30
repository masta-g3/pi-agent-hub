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
import { effectiveDashboardAttentionBell, effectiveDashboardShortcuts, effectiveDashboardThemePreference, effectiveSkillPoolDirs, effectiveWorktreeDefault, setDashboardAttentionBell, setDashboardThemePreference, setSkillPoolDirs } from "../core/config.js";
import { publishThemeCommand } from "../core/theme-command.js";
import { projectStateCwd } from "../core/multi-repo.js";
import { tmuxChromeFromTheme } from "../core/chrome.js";
import { sessionSection } from "../core/session-bucket.js";
import { loadRepoHistory, mergeRepoCwds, rankedRepoCwds } from "../core/repo-history.js";
import { attachSessionCommand, configureDashboardStatusBar, configureManagedSessionStatusBar, currentTmuxSession, displayClientMessage, listTmuxClients, realTmuxExec, sendTextToSession, setDashboardMouse, type TmuxClient } from "../core/tmux.js";
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
import { activeAttentionRequest, createAttentionDeliveryState, observeAttentionDelivery, routeAttentionDeliveries, type AttentionDeliveryEntry } from "./attention-delivery.js";

export interface AttentionDeliveryEffects {
  dashboardSession: string;
  dashboardPaneId?: string;
  pins: readonly { sessionId: string; paneId: string }[];
  bellEnabled: boolean;
  listClients(): Promise<TmuxClient[]>;
  display(client: string, message: string): Promise<void>;
  ring(): void;
}

export async function dashboardOwnsTmuxSession(
  tmuxEnvironment: string | undefined,
  currentSession: () => Promise<string>,
): Promise<boolean> {
  if (!tmuxEnvironment) return false;
  return currentSession().then((session) => session === DASHBOARD_SESSION).catch(() => false);
}

export function attentionExternalMessage(entries: readonly AttentionDeliveryEntry[]): string {
  const newest = entries[0];
  if (!newest) return "";
  const glyph = newest.kind === "blocked" ? "!" : newest.kind === "ready" ? "✓" : "?";
  const kind = entries.length > 1 ? `${glyph} ${entries.length} NEW` : `${glyph} ${newest.kind.toUpperCase()}`;
  const identity = newest.ownerTitle ? `${newest.title} → ${newest.ownerTitle}` : newest.title;
  return [kind, identity, newest.text, entries.length > 1 ? `+${entries.length - 1} more` : undefined].filter(Boolean).join(" · ");
}

export async function deliverAttentionBatch(entries: readonly AttentionDeliveryEntry[], effects: AttentionDeliveryEffects): Promise<void> {
  if (!entries.length) return;
  let clients: TmuxClient[];
  try {
    clients = await effects.listClients();
  } catch {
    return;
  }
  const routed = routeAttentionDeliveries(entries, clients, effects);
  const results = await Promise.allSettled(routed.deliveries.map((delivery) =>
    effects.display(delivery.client.name, attentionExternalMessage(delivery.entries))));
  const delivered = results.some((result) => result.status === "fulfilled");
  if (effects.bellEnabled && routed.bellEligible && delivered) {
    try {
      effects.ring();
    } catch {
      // The optional terminal bell must not affect request delivery or refresh health.
    }
  }
}

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

export function normalizeSessionsViewState(value: unknown): SessionsViewState {
  const saved = value && typeof value === "object" ? value as Partial<SessionsViewState> : {};
  const collapsedSections = Array.isArray(saved.collapsedSections)
    ? [...new Set(saved.collapsedSections.filter((section): section is "archived" => section === "archived"))]
    : [];
  return {
    grouping: saved.grouping === "stage" ? "stage" : "project",
    ...(collapsedSections.length ? { collapsedSections } : {}),
  };
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
  let attentionBellEnabled = await effectiveDashboardAttentionBell();
  const worktreeDefault = await effectiveWorktreeDefault();
  let skillPoolDirs = await effectiveSkillPoolDirs();
  let skillPool = await listSkillPool();
  const mcpCatalog = await loadMcpCatalog();
  let historyCwds = rankedRepoCwds((await loadRepoHistory()).repos);
  const savedViewState = await readJsonOr<unknown>(uiStatePath(), {});
  const initialViewState = normalizeSessionsViewState(savedViewState);
  let stopLoop: RefreshLoopHandle | undefined;
  let stopThemeLoop: (() => void) | undefined;
  let stopActionLoop: (() => void) | undefined;
  let stopped = false;
  let view!: SessionsView;
  const ownsDashboardTmux = await dashboardOwnsTmuxSession(
    process.env.TMUX,
    () => currentTmuxSession(realTmuxExec),
  );
  let attentionState = createAttentionDeliveryState(controller.snapshot().sessions);
  const currentAttentionRequestId = (sessionId: string) => {
    const entry = activeAttentionRequest(attentionState, sessionId);
    return entry && Date.now() < entry.expiresAt ? entry.requestId : undefined;
  };
  const observeAttention = async () => {
    const observation = observeAttentionDelivery(attentionState, controller.snapshot().sessions);
    attentionState = observation.state;
    view.setAttentionAnnouncements(observation.active);
    if (!observation.fresh.length || !ownsDashboardTmux) return;
    await deliverAttentionBatch(observation.fresh, {
      dashboardSession: DASHBOARD_SESSION,
      dashboardPaneId: process.env.TMUX_PANE,
      pins: sidePanes?.snapshot().pins ?? [],
      bellEnabled: attentionBellEnabled,
      listClients: () => listTmuxClients(realTmuxExec),
      display: (client, message) => displayClientMessage(client, message, realTmuxExec),
      ring: () => terminal.write("\x07"),
    });
  };
  const refreshDashboard = async () => {
    await controller.refresh();
    await observeAttention();
  };
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
      if (!stopped) stopLoop = startRefreshLoop(controller, tui, observeAttention);
    },
    refresh: refreshDashboard,
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
    revealSession: (sessionId) => view.revealSession(sessionId),
    acknowledgeSession: (sessionId, requestId) => mutateRegistry(() => controller.acknowledgeSession(sessionId, Date.now(), requestId)),
    activeAttentionRequestId: currentAttentionRequestId,
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
    const paneledSessions = new Set(sidePanes?.snapshot().pins.map((pin) => pin.tmuxSession) ?? []);
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
  view = new SessionsView(controller, stop, {
    initialViewState,
    saveViewState(state) { void writeJsonAtomic(uiStatePath(), state); },
    attachOutsideTmux(tmuxSession) {
      stop();
      const attach = attachSessionCommand(tmuxSession);
      spawn(attach.command, attach.args, { stdio: "inherit" });
    },
    switchInsideTmux: (tmuxSession) => sidePanes!.handoff(tmuxSession),
    pinSidePane: (sessionId) => sidePanes!.pin(sessionId),
    assignSidePaneSlot: (sessionId, slot) => sidePanes!.assign(sessionId, slot),
    focusSidePaneSlot: (slot) => sidePanes!.focus(slot),
    focusPinnedSession: (sessionId) => sidePanes!.focusPinnedSession(sessionId),
    closeSidePane: (sessionId) => sidePanes!.close(sessionId),
    resizeSidePane: (delta) => sidePanes!.resize(delta),
    focusSidePaneDirection: (direction) => sidePanes!.focusDirection(direction),
    returnToCockpit: () => sidePanes!.returnToCockpit(),
    sidePaneState() {
      const state = sidePanes!.snapshot();
      return {
        slots: [1, 2, 3, 4].map((slot) => state.pins.find((pin) => pin.slot === slot)?.sessionId),
        ...(state.activeSessionId ? { activeSessionId: state.activeSessionId } : {}),
        capacity: state.capacity,
        constrained: state.constrained,
        splitPercent: state.splitPercent,
      };
    },
    refreshStatusEvidence() {
      return stopLoop?.refresh() ?? refreshDashboard();
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
    acknowledgeSession(sessionId, requestId) {
      return mutateRegistry(() => controller.acknowledgeSession(sessionId, Date.now(), requestId));
    },
    attentionDelivery: {
      attentionBellEnabled: () => attentionBellEnabled,
      async setAttentionBell(enabled) {
        await setDashboardAttentionBell(enabled);
        attentionBellEnabled = enabled;
      },
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
      sidePanes?.sync();
    },
  });
  stopActionLoop = startDashboardActionLoop(async () => {
    const action = await consumeDashboardAction();
    if (!action) return;
    await refreshDashboard();
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
  stopLoop = startRefreshLoop(controller, tui, observeAttention);
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

export function resolveProjectPickerTarget(target: ProjectPickerTarget, sessions: readonly ManagedSession[]): string {
  if (!target.sessionId) return target.projectCwd;
  const session = sessions.find((item) => item.id === target.sessionId);
  if (!session || projectStateCwd(session) !== target.projectCwd) throw new Error("picker target is no longer available");
  return target.projectCwd;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
