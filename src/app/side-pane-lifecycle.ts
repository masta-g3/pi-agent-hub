import { stat } from "node:fs/promises";
import { isErrno } from "../core/atomic-json.js";
import { ticketIdentity } from "../core/ticket-identity.js";
import type { TmuxChrome } from "../core/chrome.js";
import {
  reconcileSidebarReturnBinding,
  removeSidebarReturnBinding,
  resizePaneWidth,
  restoreSwitchReturnBinding,
  selectPane,
  setPaneTitle,
  setSessionStatusBarVisible,
  setWindowPaneBorderStatus,
  switchClientWithReturn,
  type TmuxExec,
} from "../core/tmux.js";
import type { ManagedSession, RuntimeSession } from "../core/types.js";
import {
  assignSidePaneSlot,
  closeSidePane,
  closeSidePaneShowing,
  closeSidePanes,
  focusSidePane,
  focusSidePaneSlot,
  pinSidePane,
  reconcileSidePanes,
  rectangleNeighbor,
  resizeSidePane,
  sidebarRepairWidth,
  sidePaneStatus,
  type CloseSidePaneResult,
  type FocusSidePaneResult,
  type PaneRectangle,
  type ResizeSidePaneResult,
  type SidePaneResult,
  type SidePaneSlot,
  type SpatialDirection,
} from "./side-pane.js";

export interface SidePaneLifecyclePin {
  slot: SidePaneSlot;
  sessionId: string;
  tmuxSession: string;
  paneId: string;
  title: string;
  active: boolean;
  rect: PaneRectangle;
}

export interface SidePaneLifecycleSnapshot {
  pins: readonly SidePaneLifecyclePin[];
  activeSessionId?: string;
  capacity: 0 | 2 | 4;
  constrained: boolean;
  splitPercent: number;
  dashboardStatusVisible: boolean;
}

export interface SidePaneLifecycleDependencies {
  dashboardSession: string;
  dashboardCwd: string;
  dashboardCommand: string;
  dashboardEnv(): Record<string, string>;
  ownPane(): string | undefined;
  insideTmux(): boolean;
  sessions(): readonly RuntimeSession[];
  revealSession(sessionId: string): boolean | void;
  acknowledgeSession(sessionId: string, requestId?: string): Promise<void>;
  activeAttentionRequestId?(sessionId: string): string | undefined;
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
  pin(sessionId: string): Promise<SidePaneResult>;
  assign(sessionId: string, slot: SidePaneSlot): Promise<SidePaneResult>;
  focus(slot: SidePaneSlot): Promise<FocusSidePaneResult>;
  focusPinnedSession(sessionId: string): Promise<FocusSidePaneResult>;
  close(sessionId: string): Promise<CloseSidePaneResult>;
  resize(delta: -1 | 1): Promise<ResizeSidePaneResult>;
  focusDirection(direction: SpatialDirection): Promise<FocusSidePaneResult>;
  returnToCockpit(): Promise<FocusSidePaneResult>;
  detach(tmuxSession: string): Promise<boolean>;
  handoff(tmuxSession: string): Promise<boolean>;
  refreshPanelChrome(): void;
  sync(): void;
  stop(): Promise<void>;
}

const COCKPIT_PANE_TITLE = "PI HUB / PINNED FLEET";
const FOCUSED_PIN_HINT = "Alt+1–4 · Ctrl+Q";

const EMPTY_SNAPSHOT: SidePaneLifecycleSnapshot = {
  pins: [], capacity: 0, constrained: false, splitPercent: 50, dashboardStatusVisible: true,
};

export function createSidePaneLifecycle(deps: SidePaneLifecycleDependencies): SidePaneLifecycle {
  const exec = deps.exec;
  let snapshot: SidePaneLifecycleSnapshot = { ...EMPTY_SNAPSHOT };
  let openTmuxSessions: string[] = [];
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
    void intent.finally(() => activeIntents.delete(intent)).catch(() => {});
    return intent;
  };
  const drainIntents = async () => {
    while (activeIntents.size) await Promise.allSettled(activeIntents);
  };

  const sessionById = (id: string) => deps.sessions().find((session) => session.id === id);
  const sessionByTmux = (tmuxSession: string) => deps.sessions().find((session) => session.tmuxSession === tmuxSession);
  const pinIdentity = (tmuxSession: string, maxWidth = 60) => {
    const session = sessionByTmux(tmuxSession);
    if (!session) return tmuxSession;
    let owner: RuntimeSession | undefined;
    if (session.kind === "subagent") {
      const seen = new Set<string>([session.id]);
      let current: RuntimeSession | undefined = session;
      while (current?.parentId && !seen.has(current.parentId)) {
        seen.add(current.parentId);
        const parent = sessionById(current.parentId);
        if (!parent) break;
        owner = parent;
        current = parent;
      }
    }
    const ticket = ticketIdentity(session)?.id ?? (owner ? ticketIdentity(owner)?.id : undefined);
    const optional = [owner ? `← ${owner.title}` : undefined, ticket ? `#${ticket}` : undefined].filter((part): part is string => Boolean(part));
    let value = session.title;
    for (const part of optional) {
      const candidate = `${value} ${part}`;
      if ([...candidate].length <= maxWidth) value = candidate;
    }
    if ([...value].length <= maxWidth) return value;
    return `${[...value].slice(0, Math.max(1, maxWidth - 1)).join("")}…`;
  };
  const titleFor = (tmuxSession: string) => pinIdentity(tmuxSession);
  const openTargets = () => new Set(openTmuxSessions);

  const setDashboardStatusVisible = async (visible: boolean, force = false) => {
    if (!deps.insideTmux() || (!force && snapshot.dashboardStatusVisible === visible)) return;
    await setSessionStatusBarVisible({ name: deps.dashboardSession, visible }, exec);
    snapshot = { ...snapshot, dashboardStatusVisible: visible };
  };
  const bindingStateFingerprint = async (desired: boolean, ownPane: string) => {
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
    await reconcileSidebarReturnBinding({ desired, dashboardSession: deps.dashboardSession, sidebarPane: ownPane,
      stateDir: deps.sidebarBindingStateDir, switchStateDir: deps.switchBindingStateDir }, exec);
    bindingFingerprint = await bindingStateFingerprint(desired, ownPane);
  };
  const syncFooters = async (previous: readonly string[], next: readonly string[]) => {
    for (const name of previous) if (!next.includes(name)) {
      await setSessionStatusBarVisible({ name, visible: true }, exec).catch(() => {});
    }
    for (const name of next) if (!previous.includes(name)) {
      await setSessionStatusBarVisible({ name, visible: false }, exec).catch(() => {});
    }
  };

  const refreshPresence = async () => {
    const ownPane = deps.ownPane();
    const status = ownPane ? await sidePaneStatus({ ownPane }, exec) : undefined;
    const nextTmux = status?.pins.map((pin) => pin.session) ?? [];
    const hadPins = openTmuxSessions.length > 0;
    const hasPins = nextTmux.length > 0;
    if (ownPane && status?.own && hasPins) {
      const repairWidth = sidebarRepairWidth(status.own.width, status.own.windowWidth);
      if (repairWidth !== undefined) await resizePaneWidth(ownPane, repairWidth, exec);
    }
    if (ownPane && hadPins !== hasPins) {
      await setDashboardStatusVisible(!hasPins);
      await setWindowPaneBorderStatus(ownPane, hasPins, hasPins ? deps.currentChrome() : undefined, exec);
    }
    if (ownPane && hasPins && status?.own?.title !== COCKPIT_PANE_TITLE) await setPaneTitle(ownPane, COCKPIT_PANE_TITLE, exec);
    if (ownPane && !hasPins && status?.own?.title === COCKPIT_PANE_TITLE) await setPaneTitle(ownPane, "", exec);
    if (ownPane) await reconcileBinding(hasPins, ownPane);
    for (const pin of status?.pins ?? []) {
      const hint = pin.active ? ` · ${FOCUSED_PIN_HINT}` : "";
      const prefix = `LIVE ${pin.slot} · `;
      const identityWidth = Math.max(8, pin.rect.width - [...`${prefix}${hint}`].length);
      const desiredTitle = `${prefix}${pinIdentity(pin.session, identityWidth)}${hint}`;
      if (pin.title !== desiredTitle) await setPaneTitle(pin.paneId, desiredTitle, exec);
    }
    await syncFooters(openTmuxSessions, nextTmux);
    const pins = (status?.pins ?? []).flatMap((pin): SidePaneLifecyclePin[] => {
      const session = sessionByTmux(pin.session);
      return session ? [{ slot: pin.slot, sessionId: session.id, tmuxSession: session.tmuxSession, paneId: pin.paneId,
        title: session.title, active: pin.active, rect: pin.rect }] : [];
    });
    const activeSessionId = pins.find((pin) => pin.active)?.sessionId;
    if (activeSessionId && activeSessionId !== snapshot.activeSessionId) {
      const active = sessionById(activeSessionId);
      const requestId = active ? deps.activeAttentionRequestId?.(active.id) : undefined;
      if (active && deps.revealSession(active.id) !== false && (active.status === "waiting" || requestId)) {
        await deps.acknowledgeSession(active.id, requestId);
      }
    }
    const next: SidePaneLifecycleSnapshot = {
      pins,
      ...(activeSessionId ? { activeSessionId } : {}),
      capacity: status?.capacity ?? 0,
      constrained: status?.constrained ?? false,
      splitPercent: status?.splitPercent ?? 50,
      dashboardStatusVisible: snapshot.dashboardStatusVisible,
    };
    const changed = JSON.stringify(snapshot) !== JSON.stringify(next);
    snapshot = next;
    openTmuxSessions = nextTmux;
    return changed;
  };
  const refreshPresenceSerialized = () => serialize(() => stopped ? Promise.resolve(false) : refreshPresence());
  const pausePresence = () => {
    if (presenceDrain) return presenceDrain;
    const stopPresence = stopPresenceLoop;
    stopPresenceLoop = undefined;
    presenceDrain = Promise.resolve(stopPresence?.()).finally(() => { presenceDrain = undefined; });
    return presenceDrain;
  };
  const resumePresence = () => {
    if (stopped || stopPresenceLoop) return;
    stopPresenceLoop = startPresenceRefreshLoop({ ownPane: deps.ownPane(), load: refreshPresenceSerialized,
      render: deps.render, intervalMs: deps.presenceIntervalMs });
  };
  const withPausedPresence = async <T>(operation: () => Promise<T>): Promise<T> => {
    await pausePresence();
    try { return await serialize(operation); }
    finally { resumePresence(); }
  };
  const ownPaneOrThrow = () => {
    const ownPane = deps.ownPane();
    if (!ownPane) throw new Error("side pane needs tmux — run pi-hub");
    return ownPane;
  };
  const revealAndAcknowledge = async (session: ManagedSession): Promise<boolean> => {
    if (deps.revealSession(session.id) === false) return false;
    const requestId = deps.activeAttentionRequestId?.(session.id);
    if (session.status === "waiting" || requestId) await deps.acknowledgeSession(session.id, requestId);
    return true;
  };
  const afterMutation = async <T>(result: T, configured?: ManagedSession): Promise<T> => {
    const changed = await refreshPresence();
    if (changed && !stopped) deps.render();
    if (configured) await deps.configureManagedSession(configured, !openTmuxSessions.includes(configured.tmuxSession));
    return result;
  };

  const sync = () => {
    if (stopped) return;
    void serialize(() => deps.syncManagedSessionStatusBars(openTargets())).catch(() => {});
  };

  const place = (sessionId: string, slot?: SidePaneSlot) => trackIntent(withPausedPresence(async () => {
    if (stopped) throw new Error("dashboard stopped");
    const session = sessionById(sessionId);
    if (!session) throw new Error("session not found");
    const ownPane = ownPaneOrThrow();
    const before = await sidePaneStatus({ ownPane }, exec);
    const existing = before.pins.find((pin) => pin.session === session.tmuxSession);
    if (existing && (slot === undefined || existing.slot === slot)) {
      if (!await revealAndAcknowledge(session)) return { kind: "capacity", capacity: before.capacity, pins: before.pins.length } as const;
      const result = slot === undefined
        ? await focusSidePane({ target: session.tmuxSession, ownPane }, exec)
        : await focusSidePaneSlot({ slot, ownPane }, exec);
      if (result.kind === "focused") return afterMutation({ kind: "focused", session: session.tmuxSession, slot: existing.slot } as const);
      const current = await sidePaneStatus({ ownPane }, exec);
      return afterMutation({ kind: "capacity", capacity: current.capacity, pins: current.pins.length } as const);
    }
    const openingFirst = before.pins.length === 0;
    try {
      if (openingFirst) {
        await setDashboardStatusVisible(false);
        await setWindowPaneBorderStatus(ownPane, true, deps.currentChrome(), exec);
        await setPaneTitle(ownPane, COCKPIT_PANE_TITLE, exec);
      }
      const result = slot === undefined
        ? await pinSidePane({ target: session.tmuxSession, ownPane, titleFor }, exec)
        : await assignSidePaneSlot({ target: session.tmuxSession, ownPane, slot, titleFor }, exec);
      if (openingFirst && (result.kind === "capacity" || result.kind === "occupied")) {
        await setDashboardStatusVisible(true);
        await setPaneTitle(ownPane, "", exec);
        await setWindowPaneBorderStatus(ownPane, false, undefined, exec);
      }
      return afterMutation(result, result.kind === "pinned" ? session : undefined);
    } catch (error) {
      const live = await sidePaneStatus({ ownPane }, exec).catch(() => undefined);
      if (live?.pins.length) {
        await refreshPresence().catch(() => {});
        await reconcileBinding(true, ownPane).catch(() => {});
      } else if (openingFirst) {
        await setDashboardStatusVisible(true).catch(() => {});
        await setPaneTitle(ownPane, "", exec).catch(() => {});
        await setWindowPaneBorderStatus(ownPane, false, undefined, exec).catch(() => {});
      }
      throw error;
    }
  }));

  return {
    start() {
      if (started || stopped) return;
      started = true;
      sync();
      resumePresence();
    },
    snapshot: () => ({ ...snapshot, pins: snapshot.pins.map((pin) => ({ ...pin, rect: { ...pin.rect } })) }),
    pin: (sessionId) => place(sessionId),
    assign: (sessionId, slot) => place(sessionId, slot),
    focus(slot) {
      if (stopped) return Promise.resolve({ kind: "unavailable" });
      return trackIntent(withPausedPresence(async () => {
        const ownPane = ownPaneOrThrow();
        const status = await sidePaneStatus({ ownPane }, exec);
        const pin = status.pins.find((candidate) => candidate.slot === slot);
        if (!pin) return { kind: "unavailable" as const };
        const session = sessionByTmux(pin.session);
        if (session && !await revealAndAcknowledge(session)) return { kind: "unavailable" as const };
        const result = await focusSidePaneSlot({ slot, ownPane }, exec);
        if (result.kind === "focused") await afterMutation(undefined);
        return result;
      }));
    },
    focusPinnedSession(sessionId) {
      if (stopped || !deps.insideTmux()) return Promise.resolve({ kind: "unavailable" });
      return trackIntent(withPausedPresence(async () => {
        const session = sessionById(sessionId);
        if (!session) return { kind: "unavailable" as const };
        const ownPane = ownPaneOrThrow();
        const status = await sidePaneStatus({ ownPane }, exec);
        if (!status.pins.some((pin) => pin.session === session.tmuxSession)) return { kind: "unavailable" as const };
        if (!await revealAndAcknowledge(session)) return { kind: "unavailable" as const };
        const result = await focusSidePane({ target: session.tmuxSession, ownPane }, exec);
        if (result.kind === "focused") await afterMutation(undefined);
        return result;
      }));
    },
    close(sessionId) {
      if (stopped) return Promise.resolve({ kind: "unavailable" });
      return trackIntent(withPausedPresence(async () => {
        const session = sessionById(sessionId);
        if (!session) return { kind: "unavailable" as const };
        const result = await closeSidePane({ target: session.tmuxSession, ownPane: ownPaneOrThrow(), titleFor }, exec);
        return afterMutation(result);
      }));
    },
    resize(delta) {
      if (stopped) return Promise.resolve({ kind: "unavailable" });
      return trackIntent(withPausedPresence(async () => afterMutation(await resizeSidePane({ ownPane: ownPaneOrThrow(), delta, titleFor }, exec))));
    },
    focusDirection(direction) {
      if (stopped) return Promise.resolve({ kind: "unavailable" });
      return trackIntent(withPausedPresence(async () => {
        const ownPane = ownPaneOrThrow();
        await reconcileSidePanes({ ownPane }, exec);
        const status = await sidePaneStatus({ ownPane }, exec);
        if (!status.own) return { kind: "unavailable" as const };
        const cockpit = { paneId: ownPane, rect: { left: status.own.left, top: status.own.top, width: status.own.width, height: status.own.height } };
        const active = status.pins.find((pin) => pin.active);
        const source = active?.rect ?? cockpit.rect;
        const destination = rectangleNeighbor(source, [...status.pins, cockpit], direction);
        if (!destination) return { kind: "unavailable" as const };
        const pin = status.pins.find((item) => item.paneId === destination.paneId);
        const session = pin ? sessionByTmux(pin.session) : active ? sessionByTmux(active.session) : undefined;
        if (session && !await revealAndAcknowledge(session)) return { kind: "unavailable" as const };
        await selectPane(destination.paneId, exec);
        await afterMutation(undefined);
        return { kind: "focused" as const };
      }));
    },
    returnToCockpit() {
      if (stopped) return Promise.resolve({ kind: "unavailable" });
      return trackIntent(withPausedPresence(async () => {
        const ownPane = ownPaneOrThrow();
        await reconcileSidePanes({ ownPane }, exec);
        const status = await sidePaneStatus({ ownPane }, exec);
        const active = status.pins.find((pin) => pin.active);
        const session = active ? sessionByTmux(active.session) : undefined;
        if (session && !await revealAndAcknowledge(session)) return { kind: "unavailable" as const };
        await selectPane(ownPane, exec);
        await afterMutation(undefined);
        return { kind: "focused" as const };
      }));
    },
    detach(tmuxSession) {
      if (stopped) return Promise.resolve(false);
      return trackIntent(withPausedPresence(async () => {
        const ownPane = deps.ownPane();
        if (!ownPane) return false;
        const closed = await closeSidePaneShowing({ target: tmuxSession, ownPane }, exec);
        if (closed) await afterMutation(undefined);
        return closed;
      }));
    },
    handoff(tmuxSession) {
      return trackIntent(withPausedPresence(async () => {
        if (stopped) return false;
        const ownPane = deps.ownPane();
        if (ownPane) await reconcileSidePanes({ ownPane }, exec);
        const session = sessionByTmux(tmuxSession);
        if (session && !await revealAndAcknowledge(session)) return false;
        if (session) await deps.configureManagedSession(session, true);
        if (stopped) return false;
        await removeSidebarReturnBinding({ stateDir: deps.sidebarBindingStateDir, onlyOwnerPid: process.pid }, exec);
        await switchClientWithReturn({ targetSession: tmuxSession, stateDir: deps.switchBindingStateDir, renameKey: "M-r",
          returnSession: { name: deps.dashboardSession, cwd: deps.dashboardCwd, command: deps.dashboardCommand, env: deps.dashboardEnv() } }, exec);
        return true;
      }));
    },
    refreshPanelChrome() {
      if (stopped) return;
      void serialize(async () => {
        const ownPane = deps.ownPane();
        if (ownPane && openTmuxSessions.length) await setWindowPaneBorderStatus(ownPane, true, deps.currentChrome(), exec);
      }).catch(() => {});
    },
    sync,
    stop() {
      if (stopPromise) return stopPromise;
      stopped = true;
      const intentsDrained = drainIntents();
      const presencePaused = pausePresence();
      const drained = tail;
      const ownPane = deps.ownPane();
      stopPromise = Promise.all([presencePaused, drained, intentsDrained])
        .then(() => restoreSwitchReturnBinding({ stateDir: deps.switchBindingStateDir, onlyOwnerPid: process.pid }, exec).catch(() => {}))
        .then(() => removeSidebarReturnBinding({ stateDir: deps.sidebarBindingStateDir, onlyOwnerPid: process.pid }, exec).catch(() => {}))
        .then(async () => {
          if (!ownPane) return;
          for (const tmuxSession of openTmuxSessions) await setSessionStatusBarVisible({ name: tmuxSession, visible: true }, exec).catch(() => {});
          await closeSidePanes({ ownPane }, exec).catch(() => {});
        })
        .then(() => setDashboardStatusVisible(true, true).catch(() => {}))
        .then(() => ownPane ? setPaneTitle(ownPane, "", exec).catch(() => {}) : undefined)
        .then(() => ownPane ? setWindowPaneBorderStatus(ownPane, false, undefined, exec).catch(() => {}) : undefined);
      return stopPromise;
    },
  };
}

function startPresenceRefreshLoop(options: { ownPane: string | undefined; load(): Promise<boolean>; render(): void; intervalMs?: number }): () => Promise<void> {
  if (!options.ownPane) return async () => {};
  let inFlight: Promise<void> | undefined;
  let stopped = false;
  const run = () => {
    if (stopped || inFlight) return;
    inFlight = options.load().then((changed) => { if (changed && !stopped) options.render(); }).catch(() => {}).finally(() => { inFlight = undefined; });
  };
  const timer = setInterval(run, options.intervalMs ?? 500);
  run();
  return async () => { stopped = true; clearInterval(timer); await inFlight; };
}
