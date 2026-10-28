import { stat } from "node:fs/promises";
import { isErrno } from "../core/atomic-json.js";
import type { TmuxChrome } from "../core/chrome.js";
import {
  reconcileSidebarReturnBinding,
  removeSidebarReturnBinding,
  resizePaneWidth,
  restoreSwitchReturnBinding,
  selectPane,
  setPaneTitle,
  setSessionStatusBarVisible,
  setWindowFollowFlag,
  setWindowPaneBorderStatus,
  switchClientWithReturn,
  togglePaneZoom,
  windowFollowFlag,
  windowZoomed,
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
  relayoutSidePanes,
  resizeSidePane,
  retargetFollowPane,
  sidebarRepairWidth,
  sidePaneCapacity,
  sidePaneStatus,
  type CloseSidePaneResult,
  type FocusSidePaneResult,
  type FollowSidePaneResult,
  type PaneRectangle,
  type ResizeSidePaneResult,
  type SidePaneResult,
  type SidePaneSlot,
  type SidePaneStatus,
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
  /** Pins are alive but hidden behind a Hub-made zoom because the window is too narrow for them. */
  hidden: boolean;
  /** The single pane follows the dashboard selection instead of holding a fixed pin. */
  following: boolean;
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
  /** Exact selected session id, or undefined for synthetic dashboard selections. */
  selectedSessionId(): string | undefined;
  revealSession(sessionId: string): boolean | void;
  acknowledgeSession(sessionId: string, requestId?: string): Promise<void>;
  /** Records the user's own focus of a pin, including mouse and spatial focus observed here. */
  touchSession(sessionId: string): Promise<void>;
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
  follow(sessionId: string): Promise<FollowSidePaneResult>;
  unfollow(): Promise<CloseSidePaneResult>;
  /** Shows the selected live session in the follow pane; quietly skips stale, hidden, or non-live targets. */
  retarget(sessionId: string): Promise<void>;
  focusFollow(sessionId: string): Promise<FocusSidePaneResult>;
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
const FOLLOW_COCKPIT_TITLE = "PI HUB / FOLLOWING";
const FOCUSED_PIN_HINT = "Alt+1–4 · Ctrl+Q";
const FOLLOWED_PANE_HINT = "Ctrl+Q";

const EMPTY_SNAPSHOT: SidePaneLifecycleSnapshot = {
  pins: [], capacity: 0, constrained: false, hidden: false, following: false, splitPercent: 50, dashboardStatusVisible: true,
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
  // Phone-size windows share the desktop window; pins hide behind a zoom and are rebuilt from the last wide layout.
  let hiddenPins: { zoomedByHub: boolean } | undefined;
  // The latest automatic retarget destination; presence never treats it as a user focus.
  let retargetedSessionId: string | undefined;
  let wideLayout: { sidebarWidth: number; splitPercent: number } | undefined;
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
    const ticket = session.context?.ticket?.id ?? session.workflow?.ticketId
      ?? owner?.context?.ticket?.id ?? owner?.workflow?.ticketId;
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

  /** The follow pane keeps its last live session when the selection has no live Pi; say so in its title. */
  const followSelectionNote = (shownTmux: string) => {
    const selectedId = deps.selectedSessionId();
    const selected = selectedId ? sessionById(selectedId) : undefined;
    if (!selected || selected.tmuxSession === shownTmux || isLive(selected)) return "";
    return ` · selected ${selected.title} is ${selected.status}`;
  };
  /** Retargets only the exact live selection; callers run inside the serialized queue. */
  const retargetNow = async (ownPane: string, sessionId: string): Promise<boolean> => {
    const session = sessionById(sessionId);
    if (!session || !isLive(session) || deps.selectedSessionId() !== sessionId) return false;
    const status = await sidePaneStatus({ ownPane }, exec);
    if (status.pins.length !== 1 || pinsHidden(status) || !await windowFollowFlag(ownPane, exec)) return false;
    if (!await retargetFollowPane({ ownPane, target: session.tmuxSession }, exec)) return false;
    // retargetFollowPane already swapped both footers; presence must not toggle them again.
    openTmuxSessions = [session.tmuxSession];
    retargetedSessionId = session.id;
    return true;
  };

  const reconcileHiddenPins = async (ownPane: string, status: SidePaneStatus): Promise<boolean> => {
    const own = status.own!;
    if (status.pins.length && sidePaneCapacity(own.windowWidth) === 0) {
      if (!hiddenPins) {
        hiddenPins = { zoomedByHub: false };
        await setWindowPaneBorderStatus(ownPane, false, undefined, exec);
      }
      if (await windowZoomed(ownPane, exec)) return false;
      await togglePaneZoom(ownPane, exec);
      hiddenPins.zoomedByHub = true;
      return true;
    }
    if (!hiddenPins) {
      if (status.pins.length && !status.constrained && own.width < own.windowWidth) {
        wideLayout = { sidebarWidth: own.width, splitPercent: status.splitPercent };
      }
      return false;
    }
    const restored = hiddenPins;
    hiddenPins = undefined;
    if (restored.zoomedByHub && await windowZoomed(ownPane, exec)) await togglePaneZoom(ownPane, exec);
    if (status.pins.length) {
      await setWindowPaneBorderStatus(ownPane, true, deps.currentChrome(), exec);
      if (restored.zoomedByHub) {
        await relayoutSidePanes({ ownPane, sidebarWidth: wideLayout?.sidebarWidth, splitPercent: wideLayout?.splitPercent ?? 50, titleFor }, exec);
      }
    }
    return true;
  };

  const refreshPresence = async () => {
    const ownPane = deps.ownPane();
    let status = ownPane ? await sidePaneStatus({ ownPane }, exec) : undefined;
    const restored = Boolean(ownPane && status?.own && await reconcileHiddenPins(ownPane, status));
    if (restored) status = await sidePaneStatus({ ownPane: ownPane! }, exec);
    let following = false;
    if (ownPane && status?.pins.length === 1) following = await windowFollowFlag(ownPane, exec);
    else if (ownPane && snapshot.following) await setWindowFollowFlag(ownPane, false, exec);
    if (ownPane && status && following && restored && !hiddenPins) {
      const selected = deps.selectedSessionId();
      if (selected && await retargetNow(ownPane, selected)) status = await sidePaneStatus({ ownPane }, exec);
    }
    const nextTmux = status?.pins.map((pin) => pin.session) ?? [];
    const hadPins = openTmuxSessions.length > 0;
    const hasPins = nextTmux.length > 0;
    // A full-window dashboard pane with pins is zoomed; resizing it would cancel that zoom.
    if (ownPane && status?.own && hasPins && !hiddenPins && status.own.width < status.own.windowWidth) {
      const repairWidth = sidebarRepairWidth(status.own.width, status.own.windowWidth);
      if (repairWidth !== undefined) await resizePaneWidth(ownPane, repairWidth, exec);
    }
    if (ownPane && hadPins !== hasPins) {
      await setDashboardStatusVisible(!hasPins);
      if (!hiddenPins) await setWindowPaneBorderStatus(ownPane, hasPins, hasPins ? deps.currentChrome() : undefined, exec);
    }
    const cockpitTitle = following ? FOLLOW_COCKPIT_TITLE : COCKPIT_PANE_TITLE;
    if (ownPane && hasPins && status?.own?.title !== cockpitTitle) await setPaneTitle(ownPane, cockpitTitle, exec);
    if (ownPane && !hasPins && (status?.own?.title === COCKPIT_PANE_TITLE || status?.own?.title === FOLLOW_COCKPIT_TITLE)) await setPaneTitle(ownPane, "", exec);
    if (ownPane) await reconcileBinding(hasPins, ownPane);
    for (const pin of status?.pins ?? []) {
      const hint = pin.active ? ` · ${following ? FOLLOWED_PANE_HINT : FOCUSED_PIN_HINT}` : "";
      const prefix = following ? "LIVE · " : `LIVE ${pin.slot} · `;
      const note = following ? followSelectionNote(pin.session) : "";
      const identityWidth = Math.max(8, pin.rect.width - [...`${prefix}${note}${hint}`].length);
      const desiredTitle = `${prefix}${pinIdentity(pin.session, identityWidth)}${note}${hint}`;
      if (pin.title !== desiredTitle) await setPaneTitle(pin.paneId, desiredTitle, exec);
    }
    await syncFooters(openTmuxSessions, nextTmux);
    const pins = (status?.pins ?? []).flatMap((pin): SidePaneLifecyclePin[] => {
      const session = sessionByTmux(pin.session);
      return session ? [{ slot: pin.slot, sessionId: session.id, tmuxSession: session.tmuxSession, paneId: pin.paneId,
        title: session.title, active: pin.active, rect: pin.rect }] : [];
    });
    const activeSessionId = pins.find((pin) => pin.active)?.sessionId;
    // A pane that shows a retargeted session is not a focus, even if the user focused it mid-switch.
    const retargeted = retargetedSessionId;
    retargetedSessionId = undefined;
    if (activeSessionId && activeSessionId !== snapshot.activeSessionId && activeSessionId !== retargeted) {
      const active = sessionById(activeSessionId);
      const requestId = active ? deps.activeAttentionRequestId?.(active.id) : undefined;
      if (active && deps.revealSession(active.id) !== false) {
        await deps.touchSession(active.id);
        if (active.status === "waiting" || requestId) await deps.acknowledgeSession(active.id, requestId);
      }
    }
    const next: SidePaneLifecycleSnapshot = {
      pins,
      ...(activeSessionId ? { activeSessionId } : {}),
      capacity: status?.capacity ?? 0,
      constrained: status?.constrained ?? false,
      hidden: hiddenPins !== undefined,
      following,
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
    await deps.touchSession(session.id);
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

  // A narrow window counts as hidden before the presence loop has zoomed it.
  const pinsHidden = (status: SidePaneStatus) => hiddenPins !== undefined
    || (status.pins.length > 0 && sidePaneCapacity(status.own?.windowWidth ?? 0) === 0);

  const handoffNow = async (tmuxSession: string): Promise<boolean> => {
    if (stopped) return false;
    const ownPane = deps.ownPane();
    if (ownPane) await reconcileSidePanes({ ownPane }, exec);
    const session = sessionByTmux(tmuxSession);
    if (session && !await revealAndAcknowledge(session)) return false;
    if (session) await deps.configureManagedSession(session, true);
    if (stopped) return false;
    await removeSidebarReturnBinding({ stateDir: deps.sidebarBindingStateDir, onlyOwnerPid: process.pid }, exec);
    await switchClientWithReturn({ targetSession: tmuxSession, stateDir: deps.switchBindingStateDir, renameKey: "M-r", nextRequestKey: "M-w", statusClickReturn: true,
      returnSession: { name: deps.dashboardSession, cwd: deps.dashboardCwd, command: deps.dashboardCommand, env: deps.dashboardEnv() } }, exec);
    return true;
  };

  const sync = () => {
    if (stopped) return;
    void serialize(() => deps.syncManagedSessionStatusBars(openTargets())).catch(() => {});
  };

  const placeNow = async (sessionId: string, slot?: SidePaneSlot, follow = false) => {
    if (stopped) throw new Error("dashboard stopped");
    const session = sessionById(sessionId);
    if (!session) throw new Error("session not found");
    const ownPane = ownPaneOrThrow();
    const before = await sidePaneStatus({ ownPane }, exec);
    if (!follow && before.pins.length === 1 && await windowFollowFlag(ownPane, exec)) throw new Error("leave follow view first (o)");
    const existing = before.pins.find((pin) => pin.session === session.tmuxSession);
    if (existing && (slot === undefined || existing.slot === slot)) {
      if (pinsHidden(before)) {
        return await handoffNow(session.tmuxSession)
          ? { kind: "focused", session: session.tmuxSession, slot: existing.slot } as const
          : { kind: "capacity", capacity: before.capacity, pins: before.pins.length } as const;
      }
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
        await setWindowFollowFlag(ownPane, follow, exec);
        await setDashboardStatusVisible(false);
        await setWindowPaneBorderStatus(ownPane, true, deps.currentChrome(), exec);
        await setPaneTitle(ownPane, COCKPIT_PANE_TITLE, exec);
      }
      const result = slot === undefined
        ? await pinSidePane({ target: session.tmuxSession, ownPane, titleFor }, exec)
        : await assignSidePaneSlot({ target: session.tmuxSession, ownPane, slot, titleFor }, exec);
      if (openingFirst && (result.kind === "capacity" || result.kind === "occupied")) {
        if (follow) await setWindowFollowFlag(ownPane, false, exec);
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
        if (follow) await setWindowFollowFlag(ownPane, false, exec).catch(() => {});
        await setDashboardStatusVisible(true).catch(() => {});
        await setPaneTitle(ownPane, "", exec).catch(() => {});
        await setWindowPaneBorderStatus(ownPane, false, undefined, exec).catch(() => {});
      }
      throw error;
    }
  };
  const place = (sessionId: string, slot?: SidePaneSlot) => trackIntent(withPausedPresence(() => placeNow(sessionId, slot)));
  const followStatus = async (ownPane: string) => {
    const status = await sidePaneStatus({ ownPane }, exec);
    const following = status.pins.length === 1 && await windowFollowFlag(ownPane, exec);
    return { status, following };
  };

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
        if (pinsHidden(status)) return { kind: await handoffNow(pin.session) ? "focused" as const : "unavailable" as const };
        const session = sessionByTmux(pin.session);
        if (session && !await revealAndAcknowledge(session)) return { kind: "unavailable" as const };
        const result = await focusSidePaneSlot({ slot, ownPane }, exec);
        if (result.kind === "focused") await afterMutation(undefined);
        return result;
      }));
    },
    focusPinnedSession(sessionId) {
      // Hidden pins fall back to the caller's normal full-screen attach.
      if (stopped || !deps.insideTmux()) return Promise.resolve({ kind: "unavailable" });
      return trackIntent(withPausedPresence(async () => {
        const session = sessionById(sessionId);
        if (!session) return { kind: "unavailable" as const };
        const ownPane = ownPaneOrThrow();
        const status = await sidePaneStatus({ ownPane }, exec);
        if (pinsHidden(status)) return { kind: "unavailable" as const };
        if (!status.pins.some((pin) => pin.session === session.tmuxSession)) return { kind: "unavailable" as const };
        if (!await revealAndAcknowledge(session)) return { kind: "unavailable" as const };
        const result = await focusSidePane({ target: session.tmuxSession, ownPane }, exec);
        if (result.kind === "focused") await afterMutation(undefined);
        return result;
      }));
    },
    follow(sessionId) {
      if (stopped) return Promise.resolve({ kind: "refused", reason: "dashboard stopped" });
      return trackIntent(withPausedPresence(async (): Promise<FollowSidePaneResult> => {
        const session = sessionById(sessionId);
        if (!session || !isLive(session)) return { kind: "refused", reason: "session is not live" };
        const ownPane = ownPaneOrThrow();
        const status = await sidePaneStatus({ ownPane }, exec);
        if (status.pins.length) return { kind: "refused", reason: "close pins first" };
        if (status.capacity === 0) return { kind: "refused", reason: "follow view needs 100 columns" };
        const result = await placeNow(sessionId, 1, true);
        return result.kind === "pinned" ? { kind: "following" } : { kind: "refused", reason: "follow view needs 100 columns" };
      }));
    },
    unfollow() {
      if (stopped) return Promise.resolve({ kind: "unavailable" });
      return trackIntent(withPausedPresence(async (): Promise<CloseSidePaneResult> => {
        const ownPane = ownPaneOrThrow();
        const { status, following } = await followStatus(ownPane);
        if (!following) return { kind: "unavailable" };
        const target = status.pins[0]!.session;
        // A rebuild at phone width would split the zoomed window; kill only the follow pane.
        const result = pinsHidden(status)
          ? (await closeSidePaneShowing({ target, ownPane }, exec) ? { kind: "closed" } as const : { kind: "unavailable" } as const)
          : await closeSidePane({ target, ownPane, titleFor }, exec);
        await setWindowFollowFlag(ownPane, false, exec);
        return afterMutation(result);
      }));
    },
    retarget(sessionId) {
      if (stopped) return Promise.resolve();
      return trackIntent(serialize(async () => {
        const ownPane = deps.ownPane();
        if (ownPane && !stopped && await retargetNow(ownPane, sessionId)) await afterMutation(undefined);
      }));
    },
    focusFollow(sessionId) {
      if (stopped || !deps.insideTmux()) return Promise.resolve({ kind: "unavailable" });
      return trackIntent(withPausedPresence(async (): Promise<FocusSidePaneResult> => {
        const session = sessionById(sessionId);
        if (!session || !isLive(session)) return { kind: "unavailable" };
        const ownPane = ownPaneOrThrow();
        const { status, following } = await followStatus(ownPane);
        if (!following || pinsHidden(status)) return { kind: "unavailable" };
        if (status.pins[0]!.session !== session.tmuxSession) await retargetNow(ownPane, sessionId);
        if (!await revealAndAcknowledge(session)) return { kind: "unavailable" };
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
        const ownPane = ownPaneOrThrow();
        // A rebuild at phone width would split the zoomed window; the wide relayout repairs geometry later.
        if (pinsHidden(await sidePaneStatus({ ownPane }, exec))) {
          const closed = await closeSidePaneShowing({ target: session.tmuxSession, ownPane }, exec);
          return afterMutation(closed ? { kind: "closed" } as const : { kind: "unavailable" } as const);
        }
        const result = await closeSidePane({ target: session.tmuxSession, ownPane, titleFor }, exec);
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
        if (!status.own || pinsHidden(status)) return { kind: "unavailable" as const };
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
      return trackIntent(withPausedPresence(() => handoffNow(tmuxSession)));
    },
    refreshPanelChrome() {
      if (stopped) return;
      void serialize(async () => {
        const ownPane = deps.ownPane();
        if (ownPane && openTmuxSessions.length && !hiddenPins) await setWindowPaneBorderStatus(ownPane, true, deps.currentChrome(), exec);
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

function isLive(session: RuntimeSession): boolean {
  return session.status !== "stopped" && session.status !== "error";
}
