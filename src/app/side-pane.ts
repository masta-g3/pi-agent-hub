import {
  clientSessionsByTty,
  killPane,
  listWindowPanes,
  presizeSessionWindow,
  realTmuxExec,
  resetSessionWindowSize,
  selectPane,
  setPaneSlot,
  setPaneTitle,
  splitPaneAttach,
  splitWindowAttach,
  type TmuxExec,
  type WindowPane,
} from "../core/tmux.js";
import { MANAGED_SESSION_PREFIX } from "../core/names.js";

export const SIDEBAR_WIDTH = 42;
const MIN_SIDEBAR_WIDTH = 40;
const MAX_SIDEBAR_WIDTH = 60;
const MIN_PIN_WIDTH = 38;

export type SidePaneSlot = 1 | 2 | 3 | 4;
const ALL_SLOTS: readonly SidePaneSlot[] = [1, 2, 3, 4];

export interface PaneRectangle {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Pin {
  slot: SidePaneSlot;
  session: string;
  paneId: string;
  tty: string;
  title: string | undefined;
  active: boolean;
  rect: PaneRectangle;
}

export interface PinLayout extends PaneRectangle {}

export interface SidePaneStatus {
  pins: Pin[];
  duplicatePaneIds: string[];
  activeSessionId?: string;
  own?: WindowPane;
  windowWidth?: number;
  windowHeight?: number;
  capacity: 0 | 2 | 4;
  constrained: boolean;
  splitPercent: number;
}

export type SidePaneResult =
  | { kind: "pinned" | "focused"; session: string; slot: SidePaneSlot }
  | { kind: "occupied"; slot: SidePaneSlot; session: string }
  | { kind: "capacity"; capacity: 0 | 2 | 4; pins: number };
export type CloseSidePaneResult = { kind: "closed" } | { kind: "unavailable" };
export type FocusSidePaneResult = { kind: "focused" } | { kind: "unavailable" };
export type ResizeSidePaneResult = { kind: "resized"; splitPercent: number } | { kind: "unavailable" };
export type SpatialDirection = "left" | "right" | "up" | "down";

interface InspectedWindow {
  own?: WindowPane;
  pins: Pin[];
  duplicatePaneIds: string[];
}

export function sidePaneCapacity(windowWidth: number): 0 | 2 | 4 {
  return windowWidth < 100 ? 0 : windowWidth < 160 ? 2 : 4;
}

export function sidebarRepairWidth(ownWidth: number, windowWidth: number): number | undefined {
  const requiredContent = windowWidth >= 120 ? MIN_PIN_WIDTH * 2 + 1 : MIN_PIN_WIDTH;
  const available = Math.min(MAX_SIDEBAR_WIDTH, windowWidth - requiredContent - 1);
  if (available < MIN_SIDEBAR_WIDTH) return undefined;
  const desired = ownWidth < MIN_SIDEBAR_WIDTH ? Math.min(SIDEBAR_WIDTH, available) : available;
  return ownWidth > desired || ownWidth < MIN_SIDEBAR_WIDTH ? desired : undefined;
}

export function pinLayout(options: {
  count: number;
  contentWidth: number;
  windowHeight: number;
  windowWidth: number;
  borderRows?: number;
  splitPercent?: number;
}): PinLayout[] {
  const slots = new Set(ALL_SLOTS.slice(0, Math.max(0, Math.min(4, Math.trunc(options.count)))));
  return [...slotLayout(slots, options).values()];
}

export function slotLayout(
  occupied: ReadonlySet<SidePaneSlot>,
  options: { contentWidth: number; windowHeight: number; windowWidth: number; borderRows?: number; splitPercent?: number },
): Map<SidePaneSlot, PinLayout> {
  const slots = ALL_SLOTS.filter((slot) => occupied.has(slot));
  if (!slots.length) return new Map();
  const borderRows = options.borderRows ?? 1;
  const height = options.windowHeight - borderRows;
  const split = clampSplit(options.splitPercent ?? 50);
  if (!usesWideSlots(slots)) {
    const layouts = compactLayout(slots.length, options.contentWidth, height, options.windowWidth, split);
    return new Map(slots.map((slot, index) => [slot, layouts[index]!]));
  }

  const leftSlots = ([1, 3] as SidePaneSlot[]).filter((slot) => occupied.has(slot));
  const rightSlots = ([2, 4] as SidePaneSlot[]).filter((slot) => occupied.has(slot));
  const bothColumns = leftSlots.length > 0 && rightSlots.length > 0;
  const leftWidth = bothColumns ? splitSize(options.contentWidth, split) : options.contentWidth;
  const rightWidth = bothColumns ? options.contentWidth - leftWidth - 1 : options.contentWidth;
  const result = new Map<SidePaneSlot, PinLayout>();
  const addColumn = (column: SidePaneSlot[], left: number, width: number) => {
    if (!column.length) return;
    if (column.length === 1) {
      result.set(column[0]!, { left, top: 0, width, height });
      return;
    }
    const topHeight = splitSize(height, bothColumns ? 50 : split);
    result.set(column[0]!, { left, top: 0, width, height: topHeight });
    result.set(column[1]!, { left, top: topHeight + 1, width, height: height - topHeight - 1 });
  };
  addColumn(leftSlots, 0, leftWidth);
  addColumn(rightSlots, bothColumns ? leftWidth + 1 : 0, rightWidth);
  return new Map(ALL_SLOTS.flatMap((slot) => result.has(slot) ? [[slot, result.get(slot)!] as const] : []));
}

function compactLayout(count: number, contentWidth: number, height: number, windowWidth: number, split: number): PinLayout[] {
  if (count === 1) return [{ left: 0, top: 0, width: contentWidth, height }];
  if (windowWidth < 120) {
    const topHeight = splitSize(height, split);
    return [
      { left: 0, top: 0, width: contentWidth, height: topHeight },
      { left: 0, top: topHeight + 1, width: contentWidth, height: height - topHeight - 1 },
    ];
  }
  const leftWidth = splitSize(contentWidth, split);
  return [
    { left: 0, top: 0, width: leftWidth, height },
    { left: leftWidth + 1, top: 0, width: contentWidth - leftWidth - 1, height },
  ];
}

export function rectangleNeighbor<T extends { paneId: string; rect: PaneRectangle }>(
  source: PaneRectangle,
  candidates: readonly T[],
  direction: SpatialDirection,
): T | undefined {
  const sourceRight = source.left + source.width;
  const sourceBottom = source.top + source.height;
  const sourceCenterX = source.left + source.width / 2;
  const sourceCenterY = source.top + source.height / 2;
  const ranked = candidates.flatMap((candidate) => {
    const rect = candidate.rect;
    const right = rect.left + rect.width;
    const bottom = rect.top + rect.height;
    const horizontalOverlap = rect.left < sourceRight && right > source.left;
    const verticalOverlap = rect.top < sourceBottom && bottom > source.top;
    let gap: number;
    let orthogonalDistance: number;
    if (direction === "left" && right <= source.left && verticalOverlap) {
      gap = source.left - right;
      orthogonalDistance = Math.abs(rect.top + rect.height / 2 - sourceCenterY);
    } else if (direction === "right" && rect.left >= sourceRight && verticalOverlap) {
      gap = rect.left - sourceRight;
      orthogonalDistance = Math.abs(rect.top + rect.height / 2 - sourceCenterY);
    } else if (direction === "up" && bottom <= source.top && horizontalOverlap) {
      gap = source.top - bottom;
      orthogonalDistance = Math.abs(rect.left + rect.width / 2 - sourceCenterX);
    } else if (direction === "down" && rect.top >= sourceBottom && horizontalOverlap) {
      gap = rect.top - sourceBottom;
      orthogonalDistance = Math.abs(rect.left + rect.width / 2 - sourceCenterX);
    } else return [];
    return [{ candidate, gap, orthogonalDistance }];
  });
  ranked.sort((a, b) => a.gap - b.gap
    || a.orthogonalDistance - b.orthogonalDistance
    || a.candidate.rect.top - b.candidate.rect.top
    || a.candidate.rect.left - b.candidate.rect.left
    || a.candidate.paneId.localeCompare(b.candidate.paneId));
  return ranked[0]?.candidate;
}

export async function sidePaneStatus(options: { ownPane: string }, exec: TmuxExec = realTmuxExec): Promise<SidePaneStatus> {
  const inspected = await inspectSidePaneWindow(options.ownPane, exec);
  const own = inspected.own;
  const capacity = sidePaneCapacity(own?.windowWidth ?? 0);
  const active = inspected.pins.find((pin) => pin.active);
  return {
    pins: inspected.pins,
    duplicatePaneIds: inspected.duplicatePaneIds,
    ...(active ? { activeSessionId: active.session } : {}),
    ...(own ? { own, windowWidth: own.windowWidth, windowHeight: own.windowHeight } : {}),
    capacity,
    constrained: inspected.pins.some((pin) => pin.slot > capacity) || !pinsFit(inspected.pins.length, own),
    splitPercent: deriveSplitPercent(inspected.pins, own),
  };
}

export async function pinSidePane(options: {
  target: string;
  ownPane: string;
  titleFor?: (tmuxSession: string) => string | undefined;
}, exec: TmuxExec = realTmuxExec): Promise<SidePaneResult> {
  const inspected = await inspectSidePaneWindow(options.ownPane, exec);
  const existing = inspected.pins.find((pin) => pin.session === options.target);
  await removeDuplicates(inspected, exec);
  if (existing) {
    await selectPane(existing.paneId, exec);
    return { kind: "focused", session: options.target, slot: existing.slot };
  }
  const capacity = sidePaneCapacity(inspected.own?.windowWidth ?? 0);
  const slot = ALL_SLOTS.slice(0, capacity).find((candidate) => !inspected.pins.some((pin) => pin.slot === candidate));
  if (!slot || inspected.pins.some((pin) => pin.slot > capacity) || !pinsFit(inspected.pins.length + 1, inspected.own)) {
    return { kind: "capacity", capacity, pins: inspected.pins.length };
  }
  return assignInspected(options, slot, inspected, exec);
}

export async function assignSidePaneSlot(options: {
  target: string;
  ownPane: string;
  slot: SidePaneSlot;
  titleFor?: (tmuxSession: string) => string | undefined;
}, exec: TmuxExec = realTmuxExec): Promise<SidePaneResult> {
  const inspected = await inspectSidePaneWindow(options.ownPane, exec);
  await removeDuplicates(inspected, exec);
  const existing = inspected.pins.find((pin) => pin.session === options.target);
  if (existing?.slot === options.slot) {
    await selectPane(existing.paneId, exec);
    return { kind: "focused", session: options.target, slot: options.slot };
  }
  const occupied = inspected.pins.find((pin) => pin.slot === options.slot);
  if (occupied) return { kind: "occupied", slot: options.slot, session: occupied.session };
  const capacity = sidePaneCapacity(inspected.own?.windowWidth ?? 0);
  if (options.slot > capacity || inspected.pins.some((pin) => pin.slot > capacity) || !pinsFit(existing ? inspected.pins.length : inspected.pins.length + 1, inspected.own)) {
    return { kind: "capacity", capacity, pins: inspected.pins.length };
  }
  return assignInspected(options, options.slot, inspected, exec);
}

async function assignInspected(
  options: { target: string; ownPane: string; titleFor?: (tmuxSession: string) => string | undefined },
  slot: SidePaneSlot,
  inspected: InspectedWindow,
  exec: TmuxExec,
): Promise<SidePaneResult> {
  const sessions = pinSessions(inspected.pins);
  for (const [candidate, session] of sessions) if (session === options.target) sessions.delete(candidate);
  sessions.set(slot, options.target);
  await rebuildSidePanes(options.ownPane, inspected, sessions, deriveSplitPercent(inspected.pins, inspected.own), exec, options.titleFor);
  await selectPane(options.ownPane, exec);
  return { kind: "pinned", session: options.target, slot };
}

export async function focusSidePane(options: { target: string; ownPane: string }, exec: TmuxExec = realTmuxExec): Promise<FocusSidePaneResult> {
  const inspected = await inspectSidePaneWindow(options.ownPane, exec);
  const pin = inspected.pins.find((item) => item.session === options.target);
  await removeDuplicates(inspected, exec);
  if (!pin) return { kind: "unavailable" };
  await selectPane(pin.paneId, exec);
  return { kind: "focused" };
}

export async function focusSidePaneSlot(options: { slot: SidePaneSlot; ownPane: string }, exec: TmuxExec = realTmuxExec): Promise<FocusSidePaneResult> {
  const inspected = await inspectSidePaneWindow(options.ownPane, exec);
  const pin = inspected.pins.find((item) => item.slot === options.slot);
  await removeDuplicates(inspected, exec);
  if (!pin) return { kind: "unavailable" };
  await selectPane(pin.paneId, exec);
  return { kind: "focused" };
}

export async function closeSidePane(options: {
  target: string;
  ownPane: string;
  titleFor?: (tmuxSession: string) => string | undefined;
}, exec: TmuxExec = realTmuxExec): Promise<CloseSidePaneResult> {
  const inspected = await inspectSidePaneWindow(options.ownPane, exec);
  if (!inspected.pins.some((pin) => pin.session === options.target)) {
    await removeDuplicates(inspected, exec);
    return { kind: "unavailable" };
  }
  const sessions = new Map([...pinSessions(inspected.pins)].filter(([, session]) => session !== options.target));
  await rebuildSidePanes(options.ownPane, inspected, sessions, deriveSplitPercent(inspected.pins, inspected.own), exec, options.titleFor);
  await selectPane(options.ownPane, exec);
  return { kind: "closed" };
}

export async function resizeSidePane(options: {
  ownPane: string;
  delta: number;
  titleFor?: (tmuxSession: string) => string | undefined;
}, exec: TmuxExec = realTmuxExec): Promise<ResizeSidePaneResult> {
  let inspected = await inspectSidePaneWindow(options.ownPane, exec);
  await removeDuplicates(inspected, exec);
  if (inspected.duplicatePaneIds.length) inspected = await inspectSidePaneWindow(options.ownPane, exec);
  const capacity = sidePaneCapacity(inspected.own?.windowWidth ?? 0);
  if (inspected.pins.length < 2 || !inspected.own || inspected.pins.some((pin) => pin.slot > capacity) || !pinsFit(inspected.pins.length, inspected.own)) {
    return { kind: "unavailable" };
  }
  const splitPercent = clampSplit(deriveSplitPercent(inspected.pins, inspected.own) + (options.delta < 0 ? -10 : 10));
  await rebuildSidePanes(options.ownPane, inspected, pinSessions(inspected.pins), splitPercent, exec, options.titleFor);
  await selectPane(options.ownPane, exec);
  return { kind: "resized", splitPercent };
}

export async function closeSidePaneShowing(options: { target: string; ownPane: string }, exec: TmuxExec = realTmuxExec): Promise<boolean> {
  const inspected = await inspectSidePaneWindow(options.ownPane, exec);
  const matching = inspected.pins.filter((pin) => pin.session === options.target);
  for (const pin of matching) await killPane(pin.paneId, exec);
  await removeDuplicates(inspected, exec);
  return matching.length > 0;
}

export async function closeSidePanes(options: { ownPane: string }, exec: TmuxExec = realTmuxExec): Promise<void> {
  const inspected = await inspectSidePaneWindow(options.ownPane, exec);
  for (const paneId of [...inspected.pins.map((pin) => pin.paneId), ...inspected.duplicatePaneIds]) await killPane(paneId, exec).catch(() => {});
}

function pinsFit(count: number, own?: WindowPane): boolean {
  if (!own || count <= 1) return true;
  const sidebarWidth = own.width >= MIN_SIDEBAR_WIDTH && own.width <= MAX_SIDEBAR_WIDTH ? own.width : SIDEBAR_WIDTH;
  const contentWidth = own.windowWidth - sidebarWidth - 1;
  return own.windowWidth < 120 || Math.floor((contentWidth - 1) / 2) >= MIN_PIN_WIDTH;
}

function splitSize(total: number, percent: number): number {
  return Math.round((total - 1) * percent / 100);
}

function clampSplit(value: number): number {
  return Math.max(30, Math.min(70, Math.round(value / 10) * 10));
}

function deriveSplitPercent(pins: readonly Pin[], own?: WindowPane): number {
  if (!own || pins.length < 2) return 50;
  const wide = usesWideSlots(pins.map((pin) => pin.slot));
  const vertical = splitAxis(pins.map((pin) => pin.slot), own.windowWidth) === "vertical";
  const first = !wide
    ? pins.find((pin) => pin.slot === 1) ?? pins[0]!
    : vertical
      ? pins.find((pin) => pin.slot === 1 || pin.slot === 2)
      : pins.find((pin) => pin.slot === 1 || pin.slot === 3);
  if (!first) return 50;
  const total = vertical
    ? pins.reduce((max, pin) => Math.max(max, pin.rect.top + pin.rect.height), 0)
    : pins.reduce((max, pin) => Math.max(max, pin.rect.left + pin.rect.width), 0) - own.width - 1;
  const size = vertical ? first.rect.height : first.rect.width;
  return total > 1 ? clampSplit(size * 100 / (total - 1)) : 50;
}

async function inspectSidePaneWindow(ownPane: string, exec: TmuxExec): Promise<InspectedWindow> {
  const panes = await listWindowPanes(ownPane, exec);
  const own = panes.find((pane) => pane.id === ownPane);
  const candidates = panes.filter((pane) => pane.id !== ownPane);
  if (!candidates.length) return { own, pins: [], duplicatePaneIds: [] };
  const clients = await clientSessionsByTty(exec);
  const managed = candidates.flatMap((pane) => {
    const session = clients.get(pane.tty);
    return session?.startsWith(MANAGED_SESSION_PREFIX) ? [{ pane, session }] : [];
  }).sort((a, b) => a.pane.top - b.pane.top || a.pane.left - b.pane.left || a.pane.id.localeCompare(b.pane.id));
  const sessions = new Set<string>();
  const slots = new Set<SidePaneSlot>();
  const accepted: { pane: WindowPane; session: string; slot?: SidePaneSlot }[] = [];
  const duplicatePaneIds: string[] = [];
  for (const item of managed) {
    if (sessions.has(item.session)) {
      duplicatePaneIds.push(item.pane.id);
      continue;
    }
    sessions.add(item.session);
    const slot = validSlot(item.pane.slot);
    if (slot && !slots.has(slot)) {
      slots.add(slot);
      accepted.push({ ...item, slot });
    } else accepted.push(item);
  }
  for (const item of accepted) {
    if (item.slot) continue;
    const slot = ALL_SLOTS.find((candidate) => !slots.has(candidate));
    if (!slot) {
      duplicatePaneIds.push(item.pane.id);
      continue;
    }
    item.slot = slot;
    slots.add(slot);
    await setPaneSlot(item.pane.id, slot, exec);
  }
  const pins = accepted.flatMap((item): Pin[] => item.slot && !duplicatePaneIds.includes(item.pane.id) ? [{
    slot: item.slot,
    session: item.session,
    paneId: item.pane.id,
    tty: item.pane.tty,
    title: item.pane.title,
    active: item.pane.active,
    rect: { left: item.pane.left, top: item.pane.top, width: item.pane.width, height: item.pane.height },
  }] : []).sort((a, b) => a.slot - b.slot);
  return { own, pins, duplicatePaneIds };
}

function usesWideSlots(slots: Iterable<SidePaneSlot>): boolean {
  const values = [...slots];
  return values.length > 2 || values.some((slot) => slot > 2);
}

function splitAxis(slots: Iterable<SidePaneSlot>, windowWidth: number): "horizontal" | "vertical" {
  const values = [...slots];
  if (!usesWideSlots(values)) return windowWidth < 120 ? "vertical" : "horizontal";
  const hasLeft = values.some((slot) => slot === 1 || slot === 3);
  const hasRight = values.some((slot) => slot === 2 || slot === 4);
  return hasLeft !== hasRight && values.length > 1 ? "vertical" : "horizontal";
}

function validSlot(value: number | undefined): SidePaneSlot | undefined {
  return value === 1 || value === 2 || value === 3 || value === 4 ? value : undefined;
}

function pinSessions(pins: readonly Pin[]): Map<SidePaneSlot, string> {
  return new Map(pins.map((pin) => [pin.slot, pin.session]));
}

export async function reconcileSidePanes(options: { ownPane: string }, exec: TmuxExec = realTmuxExec): Promise<void> {
  await removeDuplicates(await inspectSidePaneWindow(options.ownPane, exec), exec);
}

async function removeDuplicates(inspected: InspectedWindow, exec: TmuxExec): Promise<void> {
  for (const paneId of inspected.duplicatePaneIds) {
    try { await killPane(paneId, exec); }
    catch (error) { if (!paneMissing(error)) throw error; }
  }
}

async function rebuildSidePanes(
  ownPane: string,
  inspected: InspectedWindow,
  sessions: ReadonlyMap<SidePaneSlot, string>,
  splitPercent: number,
  exec: TmuxExec,
  titleFor?: (tmuxSession: string) => string | undefined,
  restoreOnFailure = true,
): Promise<void> {
  for (const paneId of [...inspected.pins.map((pin) => pin.paneId), ...inspected.duplicatePaneIds]) {
    try { await killPane(paneId, exec); }
    catch (error) { if (!String(error).includes("can't find pane")) throw error; }
  }
  if (!sessions.size) return;
  const own = inspected.own;
  if (!own) throw new Error("dashboard pane geometry is unavailable");
  const sidebarWidth = inspected.pins.length && own.width >= MIN_SIDEBAR_WIDTH ? Math.min(own.width, MAX_SIDEBAR_WIDTH) : SIDEBAR_WIDTH;
  const contentWidth = own.windowWidth - sidebarWidth - 1;
  const geometry = slotLayout(new Set(sessions.keys()), { contentWidth, windowHeight: own.windowHeight, windowWidth: own.windowWidth, splitPercent });
  let layoutError: unknown;
  try {
    for (const [slot, session] of sessions) {
      const rect = geometry.get(slot)!;
      try { await presizeSessionWindow({ target: session, width: rect.width, height: rect.height - 1 }, exec); }
      catch (error) { if (!targetMissing(error)) throw error; }
    }
    if (usesWideSlots(sessions.keys())) await buildWideSlots(ownPane, sessions, geometry, contentWidth, titleFor, exec);
    else await buildCompactSlots(ownPane, sessions, geometry, contentWidth, titleFor, exec);
  } catch (error) { layoutError = error; }
  let resetError: unknown;
  for (const session of sessions.values()) {
    try { await resetSessionWindowSize(session, exec); }
    catch (error) { if (!String(error).includes("can't find") && resetError === undefined) resetError = error; }
  }
  if (layoutError !== undefined) {
    try {
      const partial = await inspectSidePaneWindow(ownPane, exec);
      if (restoreOnFailure && inspected.pins.length) {
        await rebuildSidePanes(ownPane, partial, pinSessions(inspected.pins), deriveSplitPercent(inspected.pins, inspected.own), exec, titleFor, false);
      } else {
        for (const paneId of [...partial.pins.map((pin) => pin.paneId), ...partial.duplicatePaneIds]) await killPane(paneId, exec).catch(() => {});
      }
      await selectPane(ownPane, exec);
    } catch (restoreError) {
      throw new Error(`${errorText(layoutError)}; pin restore failed: ${errorText(restoreError)}`);
    }
    throw layoutError;
  }
  if (resetError !== undefined) throw resetError;
}

async function buildCompactSlots(
  ownPane: string,
  sessions: ReadonlyMap<SidePaneSlot, string>,
  geometry: ReadonlyMap<SidePaneSlot, PinLayout>,
  contentWidth: number,
  titleFor: ((tmuxSession: string) => string | undefined) | undefined,
  exec: TmuxExec,
): Promise<void> {
  const slots = [...sessions.keys()].sort();
  const firstSlot = slots[0]!;
  const first = await splitWindowAttach({ pane: ownPane, target: sessions.get(firstSlot)!, size: contentWidth }, exec);
  await configurePane(first, firstSlot, sessions.get(firstSlot)!, titleFor, exec);
  if (slots.length < 2) return;
  const secondSlot = slots[1]!;
  const rect = geometry.get(secondSlot)!;
  const second = await splitPaneAttach({ pane: first, target: sessions.get(secondSlot)!, direction: rect.left > 0 ? "horizontal" : "vertical", size: rect.left > 0 ? rect.width : rect.height }, exec);
  await configurePane(second, secondSlot, sessions.get(secondSlot)!, titleFor, exec);
}

async function buildWideSlots(
  ownPane: string,
  sessions: ReadonlyMap<SidePaneSlot, string>,
  geometry: ReadonlyMap<SidePaneSlot, PinLayout>,
  contentWidth: number,
  titleFor: ((tmuxSession: string) => string | undefined) | undefined,
  exec: TmuxExec,
): Promise<void> {
  const left = ([1, 3] as SidePaneSlot[]).filter((slot) => sessions.has(slot));
  const right = ([2, 4] as SidePaneSlot[]).filter((slot) => sessions.has(slot));
  const firstColumn = left.length ? left : right;
  const firstSlot = firstColumn[0]!;
  const first = await splitWindowAttach({ pane: ownPane, target: sessions.get(firstSlot)!, size: contentWidth }, exec);
  await configurePane(first, firstSlot, sessions.get(firstSlot)!, titleFor, exec);
  let rightFirst: string | undefined;
  if (left.length && right.length) {
    const slot = right[0]!;
    rightFirst = await splitPaneAttach({ pane: first, target: sessions.get(slot)!, direction: "horizontal", size: geometry.get(slot)!.width }, exec);
    await configurePane(rightFirst, slot, sessions.get(slot)!, titleFor, exec);
  }
  if (firstColumn[1]) {
    const slot = firstColumn[1];
    const pane = await splitPaneAttach({ pane: first, target: sessions.get(slot)!, direction: "vertical", size: geometry.get(slot)!.height }, exec);
    await configurePane(pane, slot, sessions.get(slot)!, titleFor, exec);
  }
  if (left.length && right[1] && rightFirst) {
    const slot = right[1];
    const pane = await splitPaneAttach({ pane: rightFirst, target: sessions.get(slot)!, direction: "vertical", size: geometry.get(slot)!.height }, exec);
    await configurePane(pane, slot, sessions.get(slot)!, titleFor, exec);
  }
}

async function configurePane(
  paneId: string,
  slot: SidePaneSlot,
  session: string,
  titleFor: ((session: string) => string | undefined) | undefined,
  exec: TmuxExec,
): Promise<void> {
  await setPaneSlot(paneId, slot, exec);
  if (titleFor) await setPaneTitle(paneId, `LIVE ${slot} · ${titleFor(session) ?? session}`, exec);
}

function paneMissing(error: unknown): boolean {
  return errorText(error).includes("can't find pane");
}

function targetMissing(error: unknown): boolean {
  const message = errorText(error);
  return message.includes("can't find") || message.includes("no such session");
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
