import { Key, matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import type { MouseEvent } from "./mouse.js";
import type { DashboardCommand, DashboardCommandGroup } from "./dashboard-commands.js";
import { searchDashboardCommands } from "./dashboard-commands.js";
import { truncate } from "./layout.js";
import { createTextInput, editTextInput, isEnterKey, renderTextInput, type TextInputState } from "./text-input.js";
import { darkTheme, styleBgToken, styleToken, type SessionsTheme } from "./theme.js";

export interface CommandPaletteState {
  query: TextInputState;
  selected: number;
  selectedCommandId?: string;
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

export interface CommandPaletteRender {
  lines: string[];
  rowTargets: (CommandPaletteRowTarget | undefined)[];
  matches: DashboardCommand[];
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
  return { query: createTextInput(query), selected: 0 };
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
  return { ...normalized, selected, selectedCommandId };
}

export function handleCommandPaletteInput(state: CommandPaletteState, data: string, commands: readonly DashboardCommand[]): CommandPaletteInputResult {
  const normalized = normalizeCommandPalette(state, commands);
  const matches = searchDashboardCommands(commands, normalized.query.value);
  if (matchesKey(data, Key.escape)) return { kind: "close" };
  if (matchesKey(data, Key.down) || matchesKey(data, Key.ctrl("n"))) return update(moveCommandPaletteSelection(normalized, 1, commands), commands);
  if (matchesKey(data, Key.up) || matchesKey(data, Key.ctrl("p"))) return update(moveCommandPaletteSelection(normalized, -1, commands), commands);
  if (isEnterKey(data)) {
    if (normalized.selectedCommandId) return { kind: "execute", commandId: normalized.selectedCommandId };
    return { kind: "update", state: normalized, matches };
  }
  const edited = editTextInput(data, normalized.query);
  if (!edited) return { kind: "update", state: normalized, matches };
  return update({ query: edited, selected: 0, selectedCommandId: undefined }, commands);
}

export function handleCommandPaletteMouse(
  state: CommandPaletteState,
  event: MouseEvent,
  rowTargets: readonly (CommandPaletteRowTarget | undefined)[],
  commands: readonly DashboardCommand[],
): CommandPaletteInputResult {
  if (event.kind === "wheel") return update(moveCommandPaletteSelection(state, event.delta, commands), commands);
  const target = rowTargets[event.y - 1];
  return target ? { kind: "execute", commandId: target.commandId } : { kind: "close" };
}

export function renderCommandPalette(
  state: CommandPaletteState,
  commands: readonly DashboardCommand[],
  width: number,
  height: number,
  theme: SessionsTheme = darkTheme,
): CommandPaletteRender {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(0, height);
  const normalized = normalizeCommandPalette(state, commands);
  const matches = searchDashboardCommands(commands, normalized.query.value);
  const lines = Array.from({ length: safeHeight }, () => " ".repeat(safeWidth));
  const rowTargets = lines.map(() => undefined as CommandPaletteRowTarget | undefined);
  if (!safeHeight) return { lines, rowTargets, matches };

  const search = normalized.query.value
    ? renderTextInput(normalized.query)
    : `${renderTextInput(normalized.query)} ${styleToken(theme, "dim", "Search actions, sessions, filters")}`;
  const searchLine = pad(truncate(`${styleToken(theme, "accent", ":")} ${search}`, safeWidth), safeWidth);
  if (safeHeight < 6) {
    lines[0] = searchLine;
    if (safeHeight > 1) lines[safeHeight - 1] = pad(truncate(styleToken(theme, "dim", "resize to use command palette"), safeWidth), safeWidth);
    return { lines, rowTargets, matches };
  }

  const compactFrame = safeHeight < 7;
  const searchIndex = compactFrame ? 0 : 1;
  if (!compactFrame) lines[0] = styleToken(theme, "border", "─".repeat(safeWidth));
  lines[searchIndex] = searchLine;
  const searchRuleIndex = searchIndex + 1;
  if (safeHeight <= searchRuleIndex) return { lines, rowTargets, matches };
  lines[searchRuleIndex] = styleToken(theme, "border", "─".repeat(safeWidth));

  const helpIndex = safeHeight - 1;
  const contentStart = searchRuleIndex + 1;
  const helpRuleIndex = Math.max(contentStart, helpIndex - 1);
  lines[helpRuleIndex] = styleToken(theme, "border", "─".repeat(safeWidth));
  lines[helpIndex] = pad(truncate(styleToken(theme, "dim", safeWidth < 60 ? "↑↓/Ctrl+N/P · Enter · Esc" : "↑↓/Ctrl+N/P Navigate · Enter Run · Esc Close"), safeWidth), safeWidth);
  const capacity = Math.max(0, helpRuleIndex - contentStart);
  if (!capacity) return { lines, rowTargets, matches };
  if (!matches.length) {
    lines[contentStart] = pad(styleToken(theme, "muted", "No matching commands"), safeWidth);
    return { lines, rowTargets, matches };
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
  return { lines, rowTargets, matches };
}

function update(state: CommandPaletteState, commands: readonly DashboardCommand[]): CommandPaletteInputResult {
  const normalized = normalizeCommandPalette(state, commands);
  return { kind: "update", state: normalized, matches: searchDashboardCommands(commands, normalized.query.value) };
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
