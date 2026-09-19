import { Key, matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import type { MouseEvent } from "./mouse.js";
import type { DashboardCommand, DashboardCommandGroup } from "./dashboard-commands.js";
import { searchDashboardCommands } from "./dashboard-commands.js";
import { NARROW_LAYOUT_MAX_WIDTH, renderCursorValue, truncate, wrapWords } from "./layout.js";
import { createTextInput, editTextInput, isEnterKey, type TextInputState } from "./text-input.js";
import { darkTheme, styleBgToken, styleToken, type SessionsTheme } from "./theme.js";

export interface CommandPaletteState {
  query: TextInputState;
  selected: number;
  selectedCommandId?: string;
  detailOffset?: number;
}

export interface CommandPaletteDialog {
  kind: "commandPalette";
  state: CommandPaletteState;
}

export type CommandPaletteInputResult =
  | { kind: "update"; state: CommandPaletteState; matches: DashboardCommand[] }
  | { kind: "execute"; commandId: string }
  | { kind: "close" };

export interface CommandPaletteRowTarget {
  commandId: string;
}

export interface CommandPaletteTargetIdentity {
  title: string;
  group?: string;
  repository?: string;
}

export interface CommandPaletteDetailRegion {
  /** Zero-based line indexes in the returned palette render. */
  start: number;
  end: number;
  pageSize: number;
  offset: number;
  maxOffset: number;
}

export interface CommandPaletteRender {
  lines: string[];
  rowTargets: (CommandPaletteRowTarget | undefined)[];
  matches: DashboardCommand[];
  /** The complete unwindowed selected detail, useful for outcome tests. */
  detailLines: string[];
  detailRegion?: CommandPaletteDetailRegion;
  /** Normalized state with the detail offset clamped for current geometry. */
  state: CommandPaletteState;
}

interface PaletteRow {
  kind: "heading" | "blank" | "item";
  group?: DashboardCommandGroup;
  item?: DashboardCommand;
  itemIndex?: number;
}

const groupLabels: Record<DashboardCommandGroup, string> = {
  actions: "ACTIONS",
  sessions: "SESSIONS",
  filters: "FILTERS",
  views: "VIEWS & HELP",
};

export function createCommandPalette(query = ""): CommandPaletteState {
  return { query: createTextInput(query), selected: 0, detailOffset: 0 };
}

export function normalizeCommandPalette(state: CommandPaletteState, commands: readonly DashboardCommand[]): CommandPaletteState {
  const matches = searchDashboardCommands(commands, state.query.value);
  if (state.selectedCommandId) {
    const stableIndex = matches.findIndex((command) => command.id === state.selectedCommandId);
    if (stableIndex < 0) return { ...state, selected: Math.max(0, Math.min(state.selected, Math.max(0, matches.length - 1))) };
    return { ...state, selected: stableIndex };
  }
  const selected = matches.length ? Math.max(0, Math.min(state.selected, matches.length - 1)) : 0;
  return { ...state, selected, selectedCommandId: matches[selected]?.id };
}

export function moveCommandPaletteSelection(state: CommandPaletteState, delta: number, commands: readonly DashboardCommand[]): CommandPaletteState {
  const normalized = normalizeCommandPalette(state, commands);
  const count = searchDashboardCommands(commands, normalized.query.value).length;
  if (!count) return normalized;
  const selected = (normalized.selected + delta + count) % count;
  const selectedCommandId = searchDashboardCommands(commands, normalized.query.value)[selected]?.id;
  return { ...normalized, selected, selectedCommandId, detailOffset: 0 };
}

export function handleCommandPaletteInput(
  state: CommandPaletteState,
  data: string,
  commands: readonly DashboardCommand[],
  detailPageSize = 3,
  detailMaxOffset = Number.MAX_SAFE_INTEGER,
): CommandPaletteInputResult {
  const normalized = normalizeCommandPalette(state, commands);
  const matches = searchDashboardCommands(commands, normalized.query.value);
  if (matchesKey(data, Key.escape)) return { kind: "close" };
  if (matchesKey(data, Key.pageUp)) return updateDetailOffset(normalized, -detailPageSize, detailMaxOffset, commands);
  if (matchesKey(data, Key.pageDown)) return updateDetailOffset(normalized, detailPageSize, detailMaxOffset, commands);
  if (matchesKey(data, Key.down) || matchesKey(data, Key.ctrl("n"))) return update(moveCommandPaletteSelection(normalized, 1, commands), commands);
  if (matchesKey(data, Key.up) || matchesKey(data, Key.ctrl("p"))) return update(moveCommandPaletteSelection(normalized, -1, commands), commands);
  if (isEnterKey(data)) {
    if (normalized.selectedCommandId) return { kind: "execute", commandId: normalized.selectedCommandId };
    return { kind: "update", state: normalized, matches };
  }
  const edited = editTextInput(data, normalized.query);
  if (!edited) return { kind: "update", state: normalized, matches };
  return update({ query: edited, selected: 0, selectedCommandId: undefined, detailOffset: 0 }, commands);
}

export function handleCommandPaletteMouse(
  state: CommandPaletteState,
  event: MouseEvent,
  rowTargets: readonly (CommandPaletteRowTarget | undefined)[],
  commands: readonly DashboardCommand[],
  detailRegion?: CommandPaletteDetailRegion,
): CommandPaletteInputResult {
  if (event.kind === "wheel") {
    const row = event.y === undefined ? undefined : event.y - 1;
    if (row !== undefined && detailRegion && row >= detailRegion.start && row <= detailRegion.end) {
      return updateDetailOffset(state, event.delta * 3, detailRegion.maxOffset, commands);
    }
    return update(moveCommandPaletteSelection(state, event.delta, commands), commands);
  }
  const target = rowTargets[event.y - 1];
  return target ? { kind: "execute", commandId: target.commandId } : update(state, commands);
}

export function renderCommandPalette(
  state: CommandPaletteState,
  commands: readonly DashboardCommand[],
  width: number,
  height: number,
  theme: SessionsTheme = darkTheme,
  targetIdentities?: ReadonlyMap<string, CommandPaletteTargetIdentity>,
  narrow = width <= NARROW_LAYOUT_MAX_WIDTH,
): CommandPaletteRender {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(0, height);
  let normalized = normalizeCommandPalette(state, commands);
  const matches = searchDashboardCommands(commands, normalized.query.value);
  const lines = Array.from({ length: safeHeight }, () => " ".repeat(safeWidth));
  const rowTargets = lines.map(() => undefined as CommandPaletteRowTarget | undefined);
  const selectedItem = matches.find((item) => item.id === normalized.selectedCommandId);
  const detailLines = !narrow ? [] : selectedItem
    ? selectedDetail(selectedItem, safeWidth, targetIdentities, theme)
    : normalized.selectedCommandId ? [styleToken(theme, "error", "Selection unavailable; choose a command")] : [];
  const result = (detailRegion?: CommandPaletteDetailRegion): CommandPaletteRender => ({ lines, rowTargets, matches, detailLines, detailRegion, state: normalized });
  if (!safeHeight) return result();

  const queryWidth = Math.max(1, safeWidth - 2);
  const query = renderCursorValue(normalized.query.value, normalized.query.cursor, queryWidth, "start");
  const search = normalized.query.value ? query : `${query} ${styleToken(theme, "dim", "Search actions, sessions, filters")}`;
  const searchLine = pad(truncate(`${styleToken(theme, "accent", ":")} ${search}`, safeWidth), safeWidth);
  if (safeHeight < 6) {
    lines[0] = searchLine;
    if (safeHeight > 1) lines[safeHeight - 1] = pad(truncate(styleToken(theme, "dim", "resize to use command palette"), safeWidth), safeWidth);
    return result();
  }

  const compactFrame = safeHeight < 7;
  const searchIndex = compactFrame ? 0 : 1;
  if (!compactFrame) lines[0] = styleToken(theme, "border", "─".repeat(safeWidth));
  lines[searchIndex] = searchLine;
  const searchRuleIndex = searchIndex + 1;
  if (safeHeight <= searchRuleIndex) return result();
  lines[searchRuleIndex] = styleToken(theme, "border", "─".repeat(safeWidth));

  const helpIndex = safeHeight - 1;
  const contentStart = searchRuleIndex + 1;
  const helpRuleIndex = Math.max(contentStart, helpIndex - 1);
  lines[helpRuleIndex] = styleToken(theme, "border", "─".repeat(safeWidth));
  lines[helpIndex] = pad(truncate(styleToken(theme, "dim", narrow ? "Enter Run · Esc Back · PgUp/PgDn Details" : "↑↓/Ctrl+N/P Navigate · Enter Run · Esc Close"), safeWidth), safeWidth);
  const available = Math.max(0, helpRuleIndex - contentStart);
  if (!available) return result();

  let capacity = available;
  let detailRegion: CommandPaletteDetailRegion | undefined;
  if (narrow && matches.length && available >= 5) {
    const detailPageSize = Math.min(6, Math.max(2, Math.floor((available - 1) / 2)));
    const detailStart = helpRuleIndex - detailPageSize;
    const maxOffset = Math.max(0, detailLines.length - detailPageSize);
    const offset = Math.max(0, Math.min(normalized.detailOffset ?? 0, maxOffset));
    normalized = { ...normalized, detailOffset: offset };
    lines[detailStart - 1] = styleToken(theme, "border", "─".repeat(safeWidth));
    detailLines.slice(offset, offset + detailPageSize).forEach((line, index) => {
      lines[detailStart + index] = pad(line, safeWidth);
    });
    detailRegion = { start: detailStart, end: helpRuleIndex - 1, pageSize: detailPageSize, offset, maxOffset };
    capacity = Math.max(0, detailStart - 1 - contentStart);
  }
  if (!capacity) return result(detailRegion);
  if (!matches.length) {
    lines[contentStart] = pad(styleToken(theme, "muted", "No matching commands"), safeWidth);
    return result(detailRegion);
  }

  const rows = paletteRows(matches, capacity);
  const selectedMatchIndex = matches.findIndex((item) => item.id === normalized.selectedCommandId);
  const selectedRow = rows.findIndex((row) => row.kind === "item" && row.itemIndex === (selectedMatchIndex >= 0 ? selectedMatchIndex : normalized.selected));
  const window = windowRows(rows, selectedRow, capacity);
  for (let index = 0; index < window.length; index += 1) {
    const row = window[index]!;
    const lineIndex = contentStart + index;
    if (row.kind === "heading") {
      lines[lineIndex] = pad(styleToken(theme, "dim", groupLabels[row.group!]), safeWidth);
      continue;
    }
    if (row.kind === "blank") continue;
    const item = row.item!;
    const selected = item.id === normalized.selectedCommandId;
    const rendered = renderItem(item, selected, safeWidth, theme);
    lines[lineIndex] = selected ? styleBgToken(theme, "selectedBg", pad(rendered, safeWidth)) : pad(rendered, safeWidth);
    rowTargets[lineIndex] = { commandId: item.id };
  }
  return result(detailRegion);
}

function update(state: CommandPaletteState, commands: readonly DashboardCommand[]): CommandPaletteInputResult {
  const normalized = normalizeCommandPalette(state, commands);
  return { kind: "update", state: normalized, matches: searchDashboardCommands(commands, normalized.query.value) };
}

function updateDetailOffset(
  state: CommandPaletteState,
  delta: number,
  maxOffset: number,
  commands: readonly DashboardCommand[],
): CommandPaletteInputResult {
  const detailOffset = Math.max(0, Math.min((state.detailOffset ?? 0) + delta, maxOffset));
  return update({ ...state, detailOffset }, commands);
}

function selectedDetail(
  item: DashboardCommand,
  width: number,
  targetIdentities: ReadonlyMap<string, CommandPaletteTargetIdentity> | undefined,
  theme: SessionsTheme,
): string[] {
  const rows = [
    ...wrapPlain(item.label, width).map((line) => styleToken(theme, "muted", line)),
    ...wrapPlain(item.hint, width).map((line) => styleToken(theme, "dim", line)),
    ...(!item.enabled ? wrapPlain(item.disabledReason ?? "unavailable", width).map((line) => styleToken(theme, "error", line)) : []),
  ];
  if (!item.targetSessionId || !targetIdentities) return rows;
  const identity = targetIdentities.get(item.targetSessionId);
  if (!identity) return [...rows, styleToken(theme, "error", "Target: unavailable")];
  rows.push(...detailField("Target", identity.title, width, theme));
  if (identity.group) rows.push(...detailField("Group", identity.group, width, theme));
  if (identity.repository) rows.push(...detailField("Repo", identity.repository, width, theme));
  return rows;
}

function detailField(label: string, value: string, width: number, theme: SessionsTheme): string[] {
  const prefix = `${label}: `;
  const valueWidth = Math.max(1, width - visibleWidth(prefix));
  const wrapped = wrapPlain(value, valueWidth);
  return wrapped.map((line, index) => `${index === 0 ? styleToken(theme, "dim", prefix) : " ".repeat(visibleWidth(prefix))}${styleToken(theme, "muted", line)}`);
}

function wrapPlain(value: string, width: number): string[] {
  return wrapWords(value, Math.max(1, width), Math.max(1, width));
}

function paletteRows(matches: readonly DashboardCommand[], capacity: number): PaletteRow[] {
  const groups = new Set(matches.map((item) => item.group)).size;
  const includeBlanks = capacity >= matches.length + groups + Math.max(0, groups - 1);
  const rows: PaletteRow[] = [];
  let previous: DashboardCommandGroup | undefined;
  matches.forEach((item, itemIndex) => {
    if (item.group !== previous) {
      if (previous && includeBlanks) rows.push({ kind: "blank" });
      rows.push({ kind: "heading", group: item.group });
      previous = item.group;
    }
    rows.push({ kind: "item", item, itemIndex });
  });
  return rows;
}

function windowRows(rows: readonly PaletteRow[], selectedRow: number, capacity: number): PaletteRow[] {
  if (rows.length <= capacity) return [...rows];
  let start = Math.max(0, Math.min(selectedRow - Math.floor(capacity / 2), rows.length - capacity));
  const selectedGroup = rows[selectedRow]?.item?.group;
  if (selectedGroup && !rows.slice(start, start + capacity).some((row) => row.kind === "heading" && row.group === selectedGroup)) {
    let heading = -1;
    for (let index = 0; index < selectedRow; index += 1) {
      const row = rows[index];
      if (row?.kind === "heading" && row.group === selectedGroup) heading = index;
    }
    if (heading >= 0 && capacity > 1) {
      const itemCapacity = capacity - 1;
      const itemStart = Math.max(heading + 1, Math.min(selectedRow - Math.floor(itemCapacity / 2), rows.length - itemCapacity));
      return [rows[heading]!, ...rows.slice(itemStart, itemStart + itemCapacity)];
    }
  }
  return rows.slice(start, start + capacity);
}

function renderItem(item: DashboardCommand, selected: boolean, width: number, theme: SessionsTheme): string {
  const marker = selected ? "▸" : " ";
  const keyWidth = width < 60 ? 7 : 10;
  const key = truncate(item.displayKey ?? "", keyWidth - 1);
  const gutter = `${styleToken(theme, "accent", key)}${" ".repeat(Math.max(0, keyWidth - visibleWidth(key)))}`;
  const hint = item.enabled
    ? (width > 60 ? item.hint : "")
    : width <= 60
      ? "unavailable"
      : item.disabledReason ?? "unavailable";
  const hintWidth = width > 60 ? Math.min(40, Math.max(0, Math.floor(width * 0.4))) : 0;
  const fixed = 2 + keyWidth;
  const narrowHintWidth = hintWidth ? 0 : visibleWidth(hint);
  const labelWidth = Math.max(1, width - fixed - (hintWidth ? hintWidth + 1 : narrowHintWidth + (narrowHintWidth ? 1 : 0)));
  const label = truncate(item.label, labelWidth);
  const left = `${styleToken(theme, "accent", marker)} ${gutter}${styleToken(theme, "muted", label)}`;
  if (!hintWidth) {
    const gap = hint ? " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(hint))) : "";
    return truncate(`${left}${gap}${styleToken(theme, item.enabled ? "dim" : "error", hint)}`, width);
  }
  const leftPadded = `${left}${" ".repeat(Math.max(1, width - hintWidth - visibleWidth(left)))}`;
  return truncate(`${leftPadded}${styleToken(theme, item.enabled ? "dim" : "error", truncate(hint, hintWidth))}`, width);
}

function pad(value: string, width: number): string {
  const text = truncate(value, width);
  return `${text}${" ".repeat(Math.max(0, width - visibleWidth(text)))}`;
}
