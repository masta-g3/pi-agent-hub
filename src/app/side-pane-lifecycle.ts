import { stat } from "node:fs/promises";
import { isErrno } from "../core/atomic-json.js";
import type { TmuxChrome } from "../core/chrome.js";
import {
  reconcileSidebarReturnBinding,
  removeSidebarReturnBinding,
  resizePaneWidth,
  restoreSwitchReturnBinding,
  setPaneTitle,
  setSessionStatusBarVisible,
  setWindowPaneBorderStatus,
  switchClientWithReturn,
  type TmuxExec,
} from "../core/tmux.js";
import type { ManagedSession } from "../core/types.js";
import {
  assignSidePaneSlot,
  closeSidePaneShowing,
  closeSidePanes,
  closeSidePaneSlot,
  focusSidePaneSlot,
  resetSidePane,
  sidebarRepairWidth,
  sidePaneStatus,
  type CloseSidePaneResult,
  type FocusSidePaneResult,
  type SidePaneResult,
  type SidePaneSlot,
} from "./side-pane.js";

const EMPTY_SLOTS: readonly (string | undefined)[] = [undefined, undefined, undefined, undefined];

export interface SidePaneLifecycleSnapshot {
  slots: readonly (string | undefined)[];
  focusedSlot?: SidePaneSlot;
  dashboardStatusVisible: boolean;
}

export interface SidePaneLifecycleDependencies {
  dashboardSession: string;
  dashboardCwd: string;
  dashboardCommand: string;
  dashboardEnv(): Record<string, string>;
  ownPane(): string | undefined;
  insideTmux(): boolean;
  sessions(): readonly ManagedSession[];
  acknowledgeSession(sessionId: string): Promise<void>;
  configureManagedSession(session: ManagedSession, visible: boolean): Promise<void>;
  syncManagedSessionStatusBars(hiddenSessions: ReadonlySet<string>): Promise<void>;
  currentChrome(): TmuxChrome;
  render(): void;
  exec: TmuxExec;
  sidebarBindingStateDir?: string;
  switchBindingStateDir?: string;
  presenceIntervalMs?: number;
}

export interface SidePaneLifecycle {
  start(): void;
  snapshot(): SidePaneLifecycleSnapshot;
  assign(sessionId: string, slot: SidePaneSlot): Promise<SidePaneResult>;
  reset(sessionId: string): Promise<SidePaneResult>;
  close(slot: SidePaneSlot): Promise<CloseSidePaneResult>;
  focus(slot: SidePaneSlot): Promise<FocusSidePaneResult>;
  detach(tmuxSession: string): Promise<boolean>;
  handoff(tmuxSession: string): Promise<void>;
  refreshPanelChrome(): void;
  syncOpenSessionChrome(): void;
  stop(): Promise<void>;
}

export function createSidePaneLifecycle(deps: SidePaneLifecycleDependencies): SidePaneLifecycle {
  const exec = deps.exec;
  let slots = [...EMPTY_SLOTS];
  let focusedSlot: SidePaneSlot | undefined;
  let dashboardStatusVisible = true;
  let tail = Promise.resolve();
  let stopPresenceLoop: (() => Promise<void>) | undefined;
  let presenceDrain: Promise<void> | undefined;
  let stopPromise: Promise<void> | undefined;
  let started = false;
  let stopped = false;
  let bindingFingerprint: string | undefined;
  const activeIntents = new Set<Promise<unknown>>();

  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation);
    tail = result.then(() => {}, () => {});
    return result;
  };

  const trackIntent = <T>(intent: Promise<T>): Promise<T> => {
    activeIntents.add(intent);
    void intent.then(
      () => activeIntents.delete(intent),
      () => activeIntents.delete(intent),
    );
    return intent;
  };

  const drainIntents = async () => {
    while (activeIntents.size) await Promise.allSettled(activeIntents);
  };

  const sessionById = (sessionId: string) => deps.sessions().find((session) => session.id === sessionId);
  const sessionByTmux = (tmuxSession: string) => deps.sessions().find((session) => session.tmuxSession === tmuxSession);
  const titleFor = (tmuxSession: string) => sessionByTmux(tmuxSession)?.title;
  const openTargets = () => new Set(slots.filter((session): session is string => Boolean(session)));

  const setDashboardStatusVisible = async (visible: boolean, force = false) => {
    if (!deps.insideTmux() || (!force && dashboardStatusVisible === visible)) return;
    await setSessionStatusBarVisible({ name: deps.dashboardSession, visible }, exec);
    dashboardStatusVisible = visible;
  };

  const bindingStateFingerprint = async (desired: boolean, ownPane: string): Promise<string> => {
    const fileFingerprint = async (dir: string | undefined) => {
      if (!dir) return "-";
      try {
        const info = await stat(`${dir}/active.json`);
        return `${info.mtimeMs}:${info.size}`;
      } catch (error) {
        if (isErrno(error, "ENOENT")) return "-";
        throw error;
      }
    };
    return [desired ? "1" : "0", ownPane, await fileFingerprint(deps.sidebarBindingStateDir), await fileFingerprint(deps.switchBindingStateDir)].join("|");
  };

  const reconcileBinding = async (desired: boolean, ownPane: string, force = false) => {
    const fingerprint = await bindingStateFingerprint(desired, ownPane);
    if (!force && fingerprint === bindingFingerprint) return;
    await reconcileSidebarReturnBinding({
      desired,
      dashboardSession: deps.dashboardSession,
      sidebarPane: ownPane,
      stateDir: deps.sidebarBindingStateDir,
      switchStateDir: deps.switchBindingStateDir,
    }, exec);
    bindingFingerprint = await bindingStateFingerprint(desired, ownPane);
  };

  const syncFooters = async (previous: readonly string[], next: readonly string[]) => {
    for (const name of previous) {
      if (!next.includes(name)) await setSessionStatusBarVisible({ name, visible: true }, exec).catch(() => {});
    }
    for (const name of next) {
      if (!previous.includes(name)) await setSessionStatusBarVisible({ name, visible: false }, exec).catch(() => {});
    }
  };

  const refreshPresence = async () => {
    const ownPane = deps.ownPane();
    let next = [...EMPTY_SLOTS];
    let nextFocusedSlot: SidePaneSlot | undefined;
    let ownTitle: string | undefined;
    if (ownPane) {
      const status = await sidePaneStatus({ ownPane }, exec);
      next = status.slots;
      nextFocusedSlot = status.activeSlot;
      ownTitle = status.ownTitle;
      if (status.slots.some(Boolean) && status.ownWidth !== undefined && status.windowWidth !== undefined) {
        const repairWidth = sidebarRepairWidth(status.ownWidth, status.windowWidth);
        if (repairWidth !== undefined) await resizePaneWidth(ownPane, repairWidth, exec);
      }
      for (const [index, paneId] of status.paneIds.entries()) {
        const tmuxSession = status.slots[index];
        const desiredTitle = tmuxSession ? `[${index + 1}] ${titleFor(tmuxSession) ?? tmuxSession}` : undefined;
        if (desiredTitle && paneId && status.titles[index] !== desiredTitle) await setPaneTitle(paneId, desiredTitle, exec);
      }
    }
    const changed = !sameSlots(slots, next) || focusedSlot !== nextFocusedSlot;
    const hadSidePanes = slots.some(Boolean);
    const hasSidePanes = next.some(Boolean);
    if (ownPane && hadSidePanes !== hasSidePanes) {
      await setDashboardStatusVisible(!hasSidePanes);
      await setWindowPaneBorderStatus(ownPane, hasSidePanes, hasSidePanes ? deps.currentChrome() : undefined, exec);
    }
    if (ownPane && hasSidePanes && ownTitle !== undefined && ownTitle !== "") await setPaneTitle(ownPane, "", exec);
    if (ownPane) await reconcileBinding(hasSidePanes, ownPane);
    await syncFooters(
      slots.filter((session): session is string => Boolean(session)),
      next.filter((session): session is string => Boolean(session)),
    );
    slots = next;
    focusedSlot = nextFocusedSlot;
    return changed;
  };

  const refreshPresenceSerialized = () => serialize(
    () => stopped ? Promise.resolve(false) : refreshPresence(),
  );

  const pausePresence = () => {
    if (presenceDrain) return presenceDrain;
    const stopPresence = stopPresenceLoop;
    stopPresenceLoop = undefined;
    presenceDrain = Promise.resolve(stopPresence?.())
      .finally(() => { presenceDrain = undefined; });
    return presenceDrain;
  };

  const resumePresence = () => {
    if (stopped || stopPresenceLoop) return;
    stopPresenceLoop = startPresenceRefreshLoop({
      ownPane: deps.ownPane(),
      load: refreshPresenceSerialized,
      render: deps.render,
      intervalMs: deps.presenceIntervalMs,
    });
  };

  const withPausedPresence = async <T>(operation: () => Promise<T>): Promise<T> => {
    await pausePresence();
    try { return await serialize(operation); }
    finally { resumePresence(); }
  };

  const update = async (
    sessionId: string,
    mutate: (target: string, ownPane: string) => Promise<SidePaneResult>,
  ): Promise<SidePaneResult> => {
    return withPausedPresence(async () => {
        if (stopped) throw new Error("dashboard stopped");
        const session = sessionById(sessionId);
        if (!session) throw new Error("session not found");
        const ownPane = deps.ownPane();
        if (!ownPane) throw new Error("side pane needs tmux — run pi-hub");
        if (session.status === "waiting") await deps.acknowledgeSession(session.id);
        const openingFirstPanel = !slots.some(Boolean);
        if (openingFirstPanel) {
          await setDashboardStatusVisible(false);
          await setWindowPaneBorderStatus(ownPane, true, deps.currentChrome(), exec);
          await setPaneTitle(ownPane, "", exec);
        }
        let result: SidePaneResult;
        try {
          result = await mutate(session.tmuxSession, ownPane);
        } catch (error) {
          if (openingFirstPanel) {
            const status = await sidePaneStatus({ ownPane }, exec).catch(() => undefined);
            if (status?.slots.some(Boolean)) {
              slots = status.slots;
              await reconcileBinding(true, ownPane).catch(() => {});
            } else {
              await setDashboardStatusVisible(true).catch(() => {});
              await setWindowPaneBorderStatus(ownPane, false, undefined, exec).catch(() => {});
            }
          }
          throw error;
        }
        if (openingFirstPanel && result.kind === "too-narrow") {
          await setDashboardStatusVisible(true);
          await setWindowPaneBorderStatus(ownPane, false, undefined, exec);
        }
        const changed = await refreshPresence();
        if (stopped) return result;
        if (changed) deps.render();
        if (result.kind === "opened" || result.kind === "retargeted" || result.kind === "moved") {
          await deps.configureManagedSession(session, !slots.includes(session.tmuxSession));
        }
        return result;
      });
  };

  const syncOpenSessionChrome = () => {
    if (stopped) return;
    void serialize(() => deps.syncManagedSessionStatusBars(openTargets())).catch(() => {});
  };

  return {
    start() {
      if (started || stopped) return;
      started = true;
      syncOpenSessionChrome();
      resumePresence();
    },

    snapshot() {
      return {
        slots: [...slots],
        ...(focusedSlot !== undefined ? { focusedSlot } : {}),
        dashboardStatusVisible,
      };
    },

    assign(sessionId, slot) {
      return trackIntent(update(sessionId, (target, ownPane) => assignSidePaneSlot({ target, ownPane, slot, titleFor }, exec)));
    },

    reset(sessionId) {
      return trackIntent(update(sessionId, (target, ownPane) => resetSidePane({ target, ownPane, titleFor }, exec)));
    },

    close(slot) {
      if (stopped) return Promise.resolve({ kind: "unavailable" });
      return trackIntent(withPausedPresence(async () => {
            const ownPane = deps.ownPane();
            if (!ownPane) throw new Error("side pane needs tmux — run pi-hub");
            const result = await closeSidePaneSlot({ ownPane, slot, titleFor }, exec);
            if (await refreshPresence()) deps.render();
            return result;
          }));
    },

    focus(slot) {
      return trackIntent(serialize(() => {
        if (stopped) return Promise.resolve({ kind: "unavailable" as const });
        const ownPane = deps.ownPane();
        if (!ownPane) throw new Error("side pane needs tmux — run pi-hub");
        return focusSidePaneSlot({ ownPane, slot }, exec);
      }));
    },

    detach(tmuxSession) {
      if (stopped) return Promise.resolve(false);
      return trackIntent(withPausedPresence(async () => {
        const ownPane = deps.ownPane();
        if (!ownPane) return false;
        const closed = await closeSidePaneShowing({ target: tmuxSession, ownPane }, exec);
        if (closed && await refreshPresence()) deps.render();
        return closed;
      }));
    },

    handoff(tmuxSession) {
      return trackIntent(withPausedPresence(async () => {
        if (stopped) return;
        const session = sessionByTmux(tmuxSession);
        if (session) await deps.configureManagedSession(session, true);
        if (stopped) return;
        await removeSidebarReturnBinding({
          stateDir: deps.sidebarBindingStateDir,
          onlyOwnerPid: process.pid,
        }, exec);
        await switchClientWithReturn({
          targetSession: tmuxSession,
          stateDir: deps.switchBindingStateDir,
          renameKey: "M-r",
          returnSession: {
            name: deps.dashboardSession,
            cwd: deps.dashboardCwd,
            command: deps.dashboardCommand,
            env: deps.dashboardEnv(),
          },
        }, exec);
      }));
    },

    refreshPanelChrome() {
      if (stopped) return;
      void serialize(async () => {
        const ownPane = deps.ownPane();
        if (ownPane && slots.some(Boolean)) await setWindowPaneBorderStatus(ownPane, true, deps.currentChrome(), exec);
      }).catch(() => {});
    },

    syncOpenSessionChrome,

    stop() {
      if (stopPromise) return stopPromise;
      stopped = true;
      const intentsDrained = drainIntents();
      const presencePaused = pausePresence();
      const drained = tail;
      const ownPane = deps.ownPane();
      stopPromise = Promise.all([presencePaused, drained, intentsDrained])
        .then(() => restoreSwitchReturnBinding({
          stateDir: deps.switchBindingStateDir,
          onlyOwnerPid: process.pid,
        }, exec).catch(() => {}))
        .then(() => removeSidebarReturnBinding({
          stateDir: deps.sidebarBindingStateDir,
          onlyOwnerPid: process.pid,
        }, exec).catch(() => {}))
        .then(async () => {
          if (!ownPane) return;
          for (const tmuxSession of slots) {
            if (tmuxSession) await setSessionStatusBarVisible({ name: tmuxSession, visible: true }, exec).catch(() => {});
          }
          await closeSidePanes({ ownPane }, exec).catch(() => {});
        })
        .then(() => setDashboardStatusVisible(true, true).catch(() => {}))
        .then(() => ownPane ? setWindowPaneBorderStatus(ownPane, false, undefined, exec).catch(() => {}) : undefined);
      return stopPromise;
    },
  };
}

function startPresenceRefreshLoop(options: {
  ownPane: string | undefined;
  load(): Promise<boolean>;
  render(): void;
  intervalMs?: number;
}): () => Promise<void> {
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
  const timer = setInterval(run, options.intervalMs ?? 500);
  run();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await inFlight;
  };
}

function sameSlots(a: readonly (string | undefined)[], b: readonly (string | undefined)[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
