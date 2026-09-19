import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { createTextInput, type TextInputState } from "./text-input.js";
import { NARROW_LAYOUT_MAX_WIDTH, renderCursorValue, wrapWords } from "./layout.js";
import { darkTheme, styleToken, type SessionsTheme } from "./theme.js";

export interface RepoPickerItem {
  cwd: string;
  label: string;
  detail: string;
  favorite?: boolean;
}

export interface RepoPickerState {
  items: RepoPickerItem[];
  selected: number;
  filter: TextInputState;
  detailOffset?: number;
}

const MAX_VISIBLE_ROWS = 12;

export function createRepoPicker(cwds: string[]): RepoPickerState {
  const seen = new Set<string>();
  const items: RepoPickerItem[] = [];
  for (const value of cwds) {
    const cwd = resolve(value);
    if (!value.trim() || seen.has(cwd)) continue;
    seen.add(cwd);
    items.push({ cwd, label: basename(cwd) || cwd, detail: compactPath(cwd) });
  }
  return { items, selected: 0, filter: createTextInput() };
}

export function moveRepoPickerSelection(state: RepoPickerState, delta: number): RepoPickerState {
  const indexes = visibleRepoIndexes(state);
  if (!indexes.length) return state;
  const current = indexes.includes(state.selected) ? state.selected : indexes[0] ?? 0;
  const position = Math.max(0, indexes.indexOf(current));
  return { ...state, selected: indexes[(position + delta + indexes.length) % indexes.length] ?? current };
}

export function selectedRepoCwd(state: RepoPickerState): string | undefined {
  const selected = selectedIndex(state);
  return selected === undefined ? undefined : state.items[selected]?.cwd;
}

export function renderRepoPicker(state: RepoPickerState, width: number, theme?: SessionsTheme, height?: number): string[] {
  const styles = createStyles(theme ?? { ...darkTheme, accent: "", border: "", dim: "", muted: "" });
  const inner = Math.max(1, width - 2);
  const narrow = width <= NARROW_LAYOUT_MAX_WIDTH;
  const labelWidth = narrow ? Math.max(1, inner - 4) : Math.max(1, Math.min(Math.max(8, Math.floor(inner * 0.34)), inner - 6));
  const detailWidth = Math.max(0, inner - labelWidth - 5);
  const indexes = visibleRepoIndexes(state);
  const selected = selectedIndex(state);
  const pathLines = narrow && selected !== undefined
    ? wrapWords(`Path ${state.items[selected]!.detail}`, inner, inner)
    : [];
  const pathLimit = pathLines.length
    ? Math.max(1, Math.min(3, height && height > 0 ? height - 10 : 3))
    : 0;
  const pathOffset = Math.max(0, Math.min(state.detailOffset ?? 0, Math.max(0, pathLines.length - pathLimit)));
  const rowLimit = height && height > 0 ? Math.max(1, height - (narrow ? 8 + pathLimit : 7)) : MAX_VISIBLE_ROWS;
  const rows = visibleWindow(indexes, selected, rowLimit);
  const lines = [
    styles.accent("Recent repos"),
    `search: ${renderCursorValue(state.filter.value, state.filter.cursor, inner - 8, "start")}`,
    "",
  ];
  if (!indexes.length) lines.push(styles.muted("No repos match the current search."));
  else for (const index of rows) {
    const item = state.items[index]!;
    const active = index === selected;
    const marker = active ? "▶" : " ";
    const favorite = item.favorite ? "★" : " ";
    const line = narrow
      ? `${marker} ${favorite} ${truncate(item.label, labelWidth)}`
      : `${marker} ${favorite} ${pad(item.label, labelWidth)} ${styles.dim(truncate(item.detail, detailWidth))}`;
    lines.push(active ? styles.accent(line) : line);
  }
  if (narrow && height && height > 0) {
    const itemCount = Math.max(1, rows.length);
    lines.push(...Array.from({ length: Math.max(0, rowLimit - itemCount) }, () => ""));
  }
  if (pathLines.length) lines.push(...Array.from({ length: pathLimit }, (_, index) => styles.dim(pathLines[pathOffset + index] ?? "")));
  lines.push("");
  if (narrow) lines.push(
    styles.muted("Type Search · ↑↓ Move · PgUp/PgDn Path"),
    styles.muted("Enter Select · Esc Cancel"),
  );
  else lines.push(styles.muted("type search · ↑↓ move · enter select · esc cancel"));
  return [
    `${styles.border("╭")}${styles.border("─".repeat(inner))}${styles.border("╮")}`,
    ...lines.map((line) => `${styles.border("│")}${pad(line, inner)}${styles.border("│")}`),
    `${styles.border("╰")}${styles.border("─".repeat(inner))}${styles.border("╯")}`,
  ];
}

export function visibleRepoIndexes(state: RepoPickerState): number[] {
  const filter = state.filter.value.trim().toLowerCase();
  return state.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !filter || `${item.label} ${item.cwd}`.toLowerCase().includes(filter))
    .map(({ index }) => index);
}

export function moveRepoPickerDetail(state: RepoPickerState, delta: number, width: number, height?: number): RepoPickerState {
  const selected = selectedIndex(state);
  if (selected === undefined || width > NARROW_LAYOUT_MAX_WIDTH) return { ...state, detailOffset: 0 };
  const inner = Math.max(1, width - 2);
  const lines = wrapWords(`Path ${state.items[selected]!.detail}`, inner, inner);
  const limit = Math.max(1, Math.min(3, height === undefined ? 3 : height - 10));
  const maxOffset = Math.max(0, lines.length - limit);
  const detailOffset = Math.max(0, Math.min(Math.min(state.detailOffset ?? 0, maxOffset) + delta, maxOffset));
  return { ...state, detailOffset };
}

function selectedIndex(state: RepoPickerState): number | undefined {
  const indexes = visibleRepoIndexes(state);
  if (!indexes.length) return undefined;
  return indexes.includes(state.selected) ? state.selected : indexes[0];
}

function visibleWindow(indexes: number[], selected: number | undefined, rowLimit: number): number[] {
  if (indexes.length <= rowLimit) return indexes;
  const selectedPosition = Math.max(0, selected === undefined ? 0 : indexes.indexOf(selected));
  const start = Math.max(0, Math.min(selectedPosition - Math.floor(rowLimit / 2), indexes.length - rowLimit));
  return indexes.slice(start, start + rowLimit);
}

function compactPath(path: string): string {
  const home = homedir();
  return path === home ? "~" : path.startsWith(`${home}/`) ? `~/${path.slice(home.length + 1)}` : path;
}

function createStyles(theme: SessionsTheme) {
  return {
    accent: (text: string) => styleToken(theme, "accent", text),
    border: (text: string) => styleToken(theme, "border", text),
    dim: (text: string) => styleToken(theme, "dim", text),
    muted: (text: string) => styleToken(theme, "muted", text),
  };
}

function pad(value: string, width: number): string {
  const text = truncate(value, width);
  return `${text}${" ".repeat(Math.max(0, width - visibleWidth(text)))}`;
}

function truncate(value: string, width: number): string {
  if (width <= 1) return "";
  return truncateToWidth(value, width, "…");
}
