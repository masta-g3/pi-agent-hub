import { darkTheme, stripAnsi, styleToken, type SessionsTheme } from "./theme.js";

export interface PickerItem {
  name: string;
  enabled: boolean;
}

export interface PickerState {
  title: string;
  items: PickerItem[];
  selected: number;
  filter?: string;
  filterCursor?: number;
}

export function togglePickerItem(state: PickerState): PickerState {
  const selected = selectedIndex(state);
  if (selected === undefined) return state;
  const items = state.items.slice();
  const item = items[selected];
  if (item) items[selected] = { ...item, enabled: !item.enabled };
  return { ...state, selected, items };
}

export function movePickerSelection(state: PickerState, delta: number): PickerState {
  const indexes = visibleIndexes(state);
  if (!indexes.length) return state;
  const current = selectedIndex(state) ?? indexes[0] ?? 0;
  const visiblePosition = Math.max(0, indexes.indexOf(current));
  return { ...state, selected: indexes[(visiblePosition + delta + indexes.length) % indexes.length] ?? current };
}

export function renderTwoColumnPicker(state: PickerState, width: number, theme?: SessionsTheme): string[] {
  const styles = theme ? createStyles(theme) : createStyles({ ...darkTheme, accent: "", border: "", dim: "", muted: "" });
  const inner = Math.max(20, width - 2);
  const visible = visibleItems(state);
  const enabled = visible.filter((item) => item.enabled);
  const available = visible.filter((item) => !item.enabled);
  const rows = Math.max(enabled.length, available.length, 1);
  const col = Math.floor((inner - 3) / 2);
  const lines = [
    styles.accent(state.title),
    `search: ${renderSearch(state)}`,
    "",
    `${pad("Enabled", col)}   Available`,
  ];
  if (!visible.length) lines.push(styles.muted("No items match the current search."));
  else for (let i = 0; i < rows; i += 1) {
    lines.push(`${pad(formatItem(state, enabled[i]), col)}   ${formatItem(state, available[i])}`);
  }
  lines.push("", styles.muted("type search • ←→ edit • space toggle • enter apply/restart • esc cancel"));
  return [
    `${styles.border("┌")}${styles.border("─".repeat(inner))}${styles.border("┐")}`,
    ...lines.map((line) => `${styles.border("│")}${pad(line, inner)}${styles.border("│")}`),
    `${styles.border("└")}${styles.border("─".repeat(inner))}${styles.border("┘")}`,
  ];
}

function renderSearch(state: PickerState): string {
  const value = state.filter ?? "";
  const chars = [...value];
  const cursor = Math.max(0, Math.min(state.filterCursor ?? chars.length, chars.length));
  return `${chars.slice(0, cursor).join("")}█${chars.slice(cursor).join("")}`;
}

function formatItem(state: PickerState, item: PickerItem | undefined): string {
  if (!item) return "";
  const selected = state.items[selectedIndex(state) ?? -1]?.name === item.name;
  return `${selected ? ">" : " "} ${item.enabled ? "✓" : " "} ${item.name}`;
}

function createStyles(theme: SessionsTheme) {
  return {
    accent: (text: string) => styleToken(theme, "accent", text),
    border: (text: string) => styleToken(theme, "border", text),
    muted: (text: string) => styleToken(theme, "muted", text),
  };
}

function visibleItems(state: PickerState): PickerItem[] {
  const filter = state.filter?.trim().toLowerCase();
  return filter ? state.items.filter((item) => item.name.toLowerCase().includes(filter)) : state.items;
}

function visibleIndexes(state: PickerState): number[] {
  const filter = state.filter?.trim().toLowerCase();
  return state.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !filter || item.name.toLowerCase().includes(filter))
    .map(({ index }) => index);
}

function selectedIndex(state: PickerState): number | undefined {
  const indexes = visibleIndexes(state);
  if (!indexes.length) return undefined;
  return indexes.includes(state.selected) ? state.selected : indexes[0];
}

function pad(value: string, width: number): string {
  const text = truncate(value, width);
  const visible = [...stripAnsi(text)].length;
  return `${text}${" ".repeat(Math.max(0, width - visible))}`;
}

function truncate(value: string, width: number): string {
  if (stripAnsi(value).length <= width) return value;
  if (width <= 1) return "";
  let visible = 0;
  let out = "";
  for (let i = 0; i < value.length && visible < width - 1;) {
    if (value[i] === "\u001b") {
      const match = /^\u001b\[[0-9;]*m/.exec(value.slice(i));
      if (match) {
        out += match[0];
        i += match[0].length;
        continue;
      }
    }
    out += value[i];
    visible += 1;
    i += 1;
  }
  return value.includes("\u001b[") ? `${out}…\u001b[0m` : `${out}…`;
}
