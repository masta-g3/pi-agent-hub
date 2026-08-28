import { clientSessionsByTty, killPane, listWindowPanes, presizeSessionWindow, realTmuxExec, resetSessionWindowSize, selectPane, setPaneSlot, setPaneTitle, splitPaneAttach, splitWindowAttach, switchClientTo, type TmuxExec, type WindowPane } from "../core/tmux.js";
import { MANAGED_SESSION_PREFIX } from "../core/names.js";

export const SIDEBAR_WIDTH = 42;
const MIN_SIDEBAR_WIDTH = 40;
const MAX_SIDEBAR_WIDTH = 60;
const MIN_CONTENT_WIDTH = 40;

export type SidePaneSlot = 1 | 2 | 3 | 4;
export type SidePaneResult =
  | { kind: "opened" | "retargeted" | "moved"; slot: SidePaneSlot }
  | { kind: "closed" }
  | { kind: "too-narrow"; panels: number };
export type CloseSidePaneResult = { kind: "closed" } | { kind: "unavailable" };
export type FocusSidePaneResult = { kind: "focused" } | { kind: "unavailable" };

interface ContentPane {
  pane: WindowPane;
  session: string;
}

export interface SidePaneStatus {
  slots: (string | undefined)[];
  paneIds: (string | undefined)[];
  activeSlot?: SidePaneSlot;
  ownWidth?: number;
  windowWidth?: number;
  ownTitle?: string;
  titles: (string | undefined)[];
}

interface SidePaneWindow {
  own?: WindowPane;
  slots: Map<SidePaneSlot, ContentPane>;
}

export interface PanelGeometry {
  width: number;
  height: number;
}

const ALL_SLOTS: readonly SidePaneSlot[] = [1, 2, 3, 4];

export function sidebarRepairWidth(ownWidth: number, windowWidth: number): number | undefined {
  const available = Math.min(MAX_SIDEBAR_WIDTH, windowWidth - MIN_CONTENT_WIDTH - 1);
  if (available < MIN_SIDEBAR_WIDTH) return undefined;
  const desired = ownWidth < MIN_SIDEBAR_WIDTH ? Math.min(SIDEBAR_WIDTH, available) : available;
  return ownWidth > desired || ownWidth < MIN_SIDEBAR_WIDTH ? desired : undefined;
}

export async function assignSidePaneSlot(options: {
  target: string;
  ownPane: string;
  slot: SidePaneSlot;
  titleFor?: (tmuxSession: string) => string | undefined;
}, exec: TmuxExec = realTmuxExec): Promise<SidePaneResult> {
  const inspected = await inspectSidePaneWindow(options.ownPane, exec);
  const existing = findSessionSlot(inspected.slots, options.target);
  const occupied = inspected.slots.get(options.slot);

  if (existing === options.slot && occupied) {
    const sessions = sessionSlots(inspected.slots);
    sessions.delete(options.slot);
    await rebuildSidePanes(options.ownPane, inspected, sessions, exec, options.titleFor);
    return { kind: "closed" };
  }

  if (existing !== undefined) {
    const sessions = sessionSlots(inspected.slots);
    if (occupied) sessions.set(existing, occupied.session);
    else sessions.delete(existing);
    sessions.set(options.slot, options.target);
    if (!occupied && !panelsFit(inspected, new Set(sessions.keys()))) return { kind: "too-narrow", panels: sessions.size };
    await rebuildSidePanes(options.ownPane, inspected, sessions, exec, options.titleFor);
    await selectPane(options.ownPane, exec);
    return { kind: "moved", slot: options.slot };
  }

  if (occupied) {
    let presized = false;
    try {
      await presizeSessionWindow({ target: options.target, width: occupied.pane.width, height: occupied.pane.height - 1 }, exec);
      presized = true;
    } catch {
      // The target can disappear between dashboard refresh and retargeting.
    }
    try {
      await switchClientTo({ clientTty: occupied.pane.tty, target: options.target }, exec);
    } finally {
      if (presized) await resetSessionWindowSize(options.target, exec).catch(() => {});
    }
    await setPaneSlot(occupied.pane.id, options.slot, exec);
    await setSidePaneTitle(occupied.pane.id, options.target, options.slot, options.titleFor, exec);
    await selectPane(options.ownPane, exec);
    return { kind: "retargeted", slot: options.slot };
  }

  const sessions = sessionSlots(inspected.slots);
  sessions.set(options.slot, options.target);
  if (!panelsFit(inspected, new Set(sessions.keys()))) return { kind: "too-narrow", panels: sessions.size };
  await rebuildSidePanes(options.ownPane, inspected, sessions, exec, options.titleFor);
  await selectPane(options.ownPane, exec);
  return { kind: "opened", slot: options.slot };
}

export async function closeSidePaneSlot(options: {
  ownPane: string;
  slot: SidePaneSlot;
  titleFor?: (tmuxSession: string) => string | undefined;
}, exec: TmuxExec = realTmuxExec): Promise<CloseSidePaneResult> {
  const inspected = await inspectSidePaneWindow(options.ownPane, exec);
  if (!inspected.slots.has(options.slot)) return { kind: "unavailable" };
  const sessions = sessionSlots(inspected.slots);
  sessions.delete(options.slot);
  await rebuildSidePanes(options.ownPane, inspected, sessions, exec, options.titleFor);
  return { kind: "closed" };
}

export async function focusSidePaneSlot(options: {
  ownPane: string;
  slot: SidePaneSlot;
}, exec: TmuxExec = realTmuxExec): Promise<FocusSidePaneResult> {
  const content = (await inspectSidePaneWindow(options.ownPane, exec)).slots.get(options.slot);
  if (!content) return { kind: "unavailable" };
  await selectPane(content.pane.id, exec);
  return { kind: "focused" };
}

export async function resetSidePane(options: {
  target: string;
  ownPane: string;
  titleFor?: (tmuxSession: string) => string | undefined;
}, exec: TmuxExec = realTmuxExec): Promise<SidePaneResult> {
  const inspected = await inspectSidePaneWindow(options.ownPane, exec);
  const only = inspected.slots.size === 1 ? [...inspected.slots.values()][0] : undefined;
  if (only?.session === options.target) {
    await killPane(only.pane.id, exec);
    return { kind: "closed" };
  }
  if (!inspected.slots.size && !panelsFit(inspected, new Set([1]))) return { kind: "too-narrow", panels: 1 };
  const kind = inspected.slots.size ? "retargeted" : "opened";
  await rebuildSidePanes(options.ownPane, inspected, new Map([[1, options.target]]), exec, options.titleFor);
  return { kind, slot: 1 };
}

export async function closeSidePaneShowing(options: {
  target: string;
  ownPane: string;
}, exec: TmuxExec = realTmuxExec): Promise<boolean> {
  const content = [...(await inspectSidePaneWindow(options.ownPane, exec)).slots.values()].find((pane) => pane.session === options.target);
  if (!content) return false;
  await killPane(content.pane.id, exec);
  return true;
}

export async function closeSidePanes(options: { ownPane: string }, exec: TmuxExec = realTmuxExec): Promise<void> {
  for (const content of (await inspectSidePaneWindow(options.ownPane, exec)).slots.values()) {
    try {
      await killPane(content.pane.id, exec);
    } catch {
      // The nested attach pane may already have closed while quitting.
    }
  }
}

export async function sidePaneStatus(options: { ownPane: string }, exec: TmuxExec = realTmuxExec): Promise<SidePaneStatus> {
  const inspected = await inspectSidePaneWindow(options.ownPane, exec);
  const slots = ALL_SLOTS.map((slot) => inspected.slots.get(slot)?.session);
  const paneIds = ALL_SLOTS.map((slot) => inspected.slots.get(slot)?.pane.id);
  const activeSlot = ALL_SLOTS.find((slot) => inspected.slots.get(slot)?.pane.active);
  return {
    slots,
    paneIds,
    titles: ALL_SLOTS.map((slot) => inspected.slots.get(slot)?.pane.title),
    ...(activeSlot ? { activeSlot } : {}),
    ownWidth: inspected.own?.width,
    windowWidth: inspected.own?.windowWidth,
    ownTitle: inspected.own?.title,
  };
}

export function quadrantGeometry(
  occupied: ReadonlySet<SidePaneSlot>,
  contentWidth: number,
  windowHeight: number,
  borderRows: number,
): Map<SidePaneSlot, PanelGeometry> {
  const availableHeight = windowHeight - borderRows;
  const bottomHeight = Math.floor((availableHeight - 1) / 2);
  const topHeight = availableHeight - 1 - bottomHeight;
  const left = occupied.has(1) || occupied.has(3);
  const right = occupied.has(2) || occupied.has(4);
  const rightWidth = left && right ? Math.floor((contentWidth - 1) / 2) : contentWidth;
  const leftWidth = left && right ? contentWidth - 1 - rightWidth : contentWidth;
  const geometry = new Map<SidePaneSlot, PanelGeometry>();
  for (const [top, bottom, width] of [[1, 3, leftWidth], [2, 4, rightWidth]] as const) {
    const hasTop = occupied.has(top);
    const hasBottom = occupied.has(bottom);
    if (hasTop) geometry.set(top, { width, height: hasBottom ? topHeight : availableHeight });
    if (hasBottom) geometry.set(bottom, { width, height: hasTop ? bottomHeight : availableHeight });
  }
  return geometry;
}

function panelsFit(inspected: SidePaneWindow, occupied: ReadonlySet<SidePaneSlot>): boolean {
  if (!inspected.own) return true;
  const sidebarWidth = inspected.slots.size && inspected.own.width >= MIN_SIDEBAR_WIDTH
    ? inspected.own.width
    : SIDEBAR_WIDTH;
  const contentWidth = inspected.own.windowWidth - sidebarWidth - 1;
  const left = occupied.has(1) || occupied.has(3);
  const right = occupied.has(2) || occupied.has(4);
  const panelWidth = left && right ? Math.floor((contentWidth - 1) / 2) : contentWidth;
  return panelWidth >= MIN_CONTENT_WIDTH;
}

async function rebuildSidePanes(
  ownPane: string,
  inspected: SidePaneWindow,
  sessions: ReadonlyMap<SidePaneSlot, string>,
  exec: TmuxExec,
  titleFor?: (tmuxSession: string) => string | undefined,
): Promise<Map<SidePaneSlot, string>> {
  const sidebarWidth = inspected.slots.size && (inspected.own?.width ?? 0) >= MIN_SIDEBAR_WIDTH
    ? inspected.own!.width
    : SIDEBAR_WIDTH;
  for (const content of inspected.slots.values()) {
    try {
      await killPane(content.pane.id, exec);
    } catch (error) {
      if (!String(error).includes("can't find pane")) throw error;
    }
  }
  if (!sessions.size) return new Map();

  const own = inspected.own;
  if (!own) throw new Error("dashboard pane geometry is unavailable");
  const contentWidth = own.windowWidth - sidebarWidth - 1;
  const occupied = new Set(sessions.keys());
  const geometry = quadrantGeometry(occupied, contentWidth, own.windowHeight, 1);
  for (const [slot, session] of sessions) {
    const panel = geometry.get(slot)!;
    try {
      await presizeSessionWindow({ target: session, width: panel.width, height: panel.height - 1 }, exec);
    } catch {
      // A dead session must not prevent the remaining panels from rebuilding.
    }
  }

  const left = ([1, 3] as SidePaneSlot[]).filter((slot) => sessions.has(slot));
  const right = ([2, 4] as SidePaneSlot[]).filter((slot) => sessions.has(slot));
  const firstColumn = left.length ? left : right;
  const panes = new Map<SidePaneSlot, string>();
  let layoutError: unknown;
  try {
    const firstSlot = firstColumn[0]!;
    const first = await splitWindowAttach({ pane: ownPane, target: sessions.get(firstSlot)!, size: contentWidth }, exec);
    await configurePane(first, firstSlot, sessions.get(firstSlot)!, titleFor, exec);
    panes.set(firstSlot, first);

    let rightFirst: string | undefined;
    if (left.length && right.length) {
      const rightSlot = right[0]!;
      rightFirst = await splitPaneAttach({ pane: first, target: sessions.get(rightSlot)!, direction: "horizontal", size: geometry.get(rightSlot)!.width }, exec);
      await configurePane(rightFirst, rightSlot, sessions.get(rightSlot)!, titleFor, exec);
      panes.set(rightSlot, rightFirst);
    }
    if (firstColumn[1]) {
      const bottomSlot = firstColumn[1];
      const bottom = await splitPaneAttach({ pane: first, target: sessions.get(bottomSlot)!, direction: "vertical", size: geometry.get(bottomSlot)!.height }, exec);
      await configurePane(bottom, bottomSlot, sessions.get(bottomSlot)!, titleFor, exec);
      panes.set(bottomSlot, bottom);
    }
    if (left.length && right[1] && rightFirst) {
      const bottomSlot = right[1];
      const bottom = await splitPaneAttach({ pane: rightFirst, target: sessions.get(bottomSlot)!, direction: "vertical", size: geometry.get(bottomSlot)!.height }, exec);
      await configurePane(bottom, bottomSlot, sessions.get(bottomSlot)!, titleFor, exec);
      panes.set(bottomSlot, bottom);
    }
  } catch (error) {
    layoutError = error;
  }

  let resetError: unknown;
  for (const session of sessions.values()) {
    try {
      await resetSessionWindowSize(session, exec);
    } catch (error) {
      if (!String(error).includes("can't find") && resetError === undefined) resetError = error;
    }
  }
  if (layoutError !== undefined) throw layoutError;
  if (resetError !== undefined) throw resetError;
  return panes;
}

async function configurePane(
  paneId: string,
  slot: SidePaneSlot,
  session: string,
  titleFor: ((tmuxSession: string) => string | undefined) | undefined,
  exec: TmuxExec,
): Promise<void> {
  await setPaneSlot(paneId, slot, exec);
  await setSidePaneTitle(paneId, session, slot, titleFor, exec);
}

async function setSidePaneTitle(
  paneId: string,
  tmuxSession: string,
  slot: SidePaneSlot,
  titleFor: ((tmuxSession: string) => string | undefined) | undefined,
  exec: TmuxExec,
): Promise<void> {
  if (titleFor) await setPaneTitle(paneId, `[${slot}] ${titleFor(tmuxSession) ?? tmuxSession}`, exec);
}

async function inspectSidePaneWindow(ownPane: string, exec: TmuxExec): Promise<SidePaneWindow> {
  const panes = await listWindowPanes(ownPane, exec);
  const own = panes.find((pane) => pane.id === ownPane);
  const candidates = panes.filter((pane) => pane.id !== ownPane);
  if (!candidates.length) return { own, slots: new Map() };
  const clients = await clientSessionsByTty(exec);
  const content = candidates.flatMap((pane) => {
    const session = clients.get(pane.tty);
    return session?.startsWith(MANAGED_SESSION_PREFIX) ? [{ pane, session }] : [];
  }).sort((a, b) => a.pane.top - b.pane.top || a.pane.left - b.pane.left);

  const slots = new Map<SidePaneSlot, ContentPane>();
  const repair: ContentPane[] = [];
  for (const item of content) {
    const slot = item.pane.slot as SidePaneSlot | undefined;
    if (slot && !slots.has(slot)) slots.set(slot, item);
    else repair.push(item);
  }
  for (const item of repair) {
    const slot = ALL_SLOTS.find((candidate) => !slots.has(candidate));
    if (!slot) break;
    slots.set(slot, item);
    await setPaneSlot(item.pane.id, slot, exec);
  }
  return { own, slots };
}

function sessionSlots(slots: ReadonlyMap<SidePaneSlot, ContentPane>): Map<SidePaneSlot, string> {
  return new Map([...slots].map(([slot, content]) => [slot, content.session]));
}

function findSessionSlot(slots: ReadonlyMap<SidePaneSlot, ContentPane>, session: string): SidePaneSlot | undefined {
  for (const [slot, content] of slots) if (content.session === session) return slot;
  return undefined;
}
