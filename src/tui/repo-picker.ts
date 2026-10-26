import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { isErrno } from "../core/atomic-json.js";
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
  mode: "recent" | "browse";
  recent: RepoPickerItem[];
  dir?: string;
  error?: string;
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
  return { items, selected: 0, filter: createTextInput(), mode: "recent", recent: items };
}

/** Switches between recent repos and folder browsing; browsing starts at `start` when it is a folder. */
export function toggleRepoPickerMode(state: RepoPickerState, start: string): RepoPickerState {
  if (state.mode === "browse") return { ...state, mode: "recent", items: state.recent, selected: 0, filter: createTextInput(), detailOffset: 0, dir: undefined, error: undefined };
  const path = expandHome(start.trim());
  return browseRepoPicker(state, path && existsSync(path) && statSync(path).isDirectory() ? path : homedir());
}

export function openRepoPickerDir(state: RepoPickerState): RepoPickerState {
  const cwd = selectedRepoCwd(state);
  return cwd && existsSync(cwd) ? browseRepoPicker(state, cwd) : state;
}

export function repoPickerParent(state: RepoPickerState): RepoPickerState {
  if (state.mode !== "browse" || !state.dir || dirname(state.dir) === state.dir) return state;
  const parent = browseRepoPicker(state, dirname(state.dir));
  return { ...parent, selected: Math.max(0, parent.items.findIndex((item) => item.cwd === state.dir)) };
}

function browseRepoPicker(state: RepoPickerState, dir: string): RepoPickerState {
  const items: RepoPickerItem[] = dirname(dir) === dir ? [] : [{ cwd: dirname(dir), label: "../", detail: compactPath(dirname(dir)) }];
  let error: string | undefined;
  try {
    const names = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
    items.push(...names.map((name) => ({ cwd: join(dir, name), label: `${name}/`, detail: compactPath(join(dir, name)) })));
  } catch (caught) {
    if (!["EACCES", "EPERM", "ENOENT", "ENOTDIR"].some((code) => isErrno(caught, code))) throw caught;
    error = `Cannot read ${compactPath(dir)}`;
  }
  return { ...state, mode: "browse", dir, items, selected: 0, filter: createTextInput(), detailOffset: 0, error };
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
    styles.accent(state.mode === "browse" ? truncate(`Browse ${compactPath(state.dir ?? "")}`, inner) : "Recent repos"),
    `search: ${renderCursorValue(state.filter.value, state.filter.cursor, inner - 8, "start")}`,
    "",
  ];
  if (!indexes.length) lines.push(styles.muted(state.mode === "browse" ? "No folders match the current search." : "No repos match the current search."));
  if (state.error) lines.push(styles.muted(state.error));
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
  const browse = state.mode === "browse";
  if (narrow) lines.push(
    styles.muted(browse ? "Type Search · → Open · ← Up · ↑↓ Move" : "Type Search · ↑↓ Move · PgUp/PgDn Path"),
    styles.muted(browse ? "Enter Select · Tab Recent · Esc Cancel" : "Enter Select · → Browse · Tab Browse · Esc Cancel"),
  );
  else lines.push(styles.muted(browse
    ? "type search · → open · ← up · enter select · tab recent · esc cancel"
    : "type search · ↑↓ move · → browse into · enter select · tab browse · esc cancel"));
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

function expandHome(path: string): string {
  return path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path && resolve(path);
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
