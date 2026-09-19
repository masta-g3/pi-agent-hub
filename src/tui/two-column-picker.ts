import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { NARROW_LAYOUT_MAX_WIDTH, renderCursorValue } from "./layout.js";
import { darkTheme, styleToken, type SessionsTheme } from "./theme.js";
import type { TextInputState } from "./text-input.js";

export interface PickerItem {
  name: string;
  enabled: boolean;
}

export interface PickerState {
  title: string;
  items: PickerItem[];
  selected: number;
  /** The category shown by the compact picker. This remains meaningful when it is empty. */
  activeEnabled?: boolean;
  filter?: string;
  filterCursor?: number;
  poolDir?: string;
  poolDirExtraCount?: number;
  poolInput?: TextInputState;
  poolMessage?: string;
  poolError?: string;
  poolPending?: boolean;
  detailOffset?: number;
}

export function togglePickerItem(state: PickerState): PickerState {
  const selected = selectedIndex(state, activeCategory(state));
  if (selected === undefined) return state;
  const items = state.items.slice();
  const item = items[selected];
  if (!item) return state;
  items[selected] = { ...item, enabled: !item.enabled };
  return { ...state, selected, activeEnabled: !item.enabled, items, detailOffset: 0 };
}

export function movePickerSelection(state: PickerState, delta: number): PickerState {
  const enabled = activeCategory(state);
  const indexes = visibleColumnIndexes(state, enabled);
  if (!indexes.length) return { ...state, activeEnabled: enabled };
  const selected = selectedIndex(state, enabled);
  const current = selected ?? indexes[0] ?? 0;
  const visiblePosition = Math.max(0, indexes.indexOf(current));
  return { ...state, activeEnabled: enabled, selected: indexes[(visiblePosition + delta + indexes.length) % indexes.length] ?? current, detailOffset: 0 };
}

export function switchPickerColumn(state: PickerState): PickerState {
  const enabled = activeCategory(state);
  const source = visibleColumnIndexes(state, enabled);
  const target = visibleColumnIndexes(state, !enabled);
  const selected = selectedIndex(state, enabled);
  const row = selected === undefined ? 0 : Math.max(0, source.indexOf(selected));
  return {
    ...state,
    activeEnabled: !enabled,
    selected: target[Math.min(row, Math.max(0, target.length - 1))] ?? state.selected,
    detailOffset: 0,
  };
}

export function renderTwoColumnPicker(state: PickerState, width: number, theme?: SessionsTheme, height?: number): string[] {
  const styles = theme ? createStyles(theme) : createStyles({ ...darkTheme, accent: "", border: "", dim: "", muted: "" });
  const inner = Math.max(1, width - 2);
  const body = width <= NARROW_LAYOUT_MAX_WIDTH ? renderCompactBody(state, inner, height, styles) : renderWideBody(state, inner, height, styles);
  const lines = frame(body, inner, styles);
  return height === undefined ? lines : lines.slice(0, Math.max(0, height));
}

/** True when the compact picker can show an item plus all required controls. */
export function compactPickerCanInteract(state: PickerState, width: number, height: number | undefined): boolean {
  if (width > NARROW_LAYOUT_MAX_WIDTH || height === undefined) return true;
  const poolCount = state.poolDir !== undefined || state.poolInput ? 1 : 0;
  const messageCount = state.poolError || state.poolMessage ? 1 : 0;
  return bodyHeight(height) >= 3 + poolCount + messageCount + 1 + compactFooter(state).length;
}

export function scrollPickerDetail(state: PickerState, delta: number, width: number, height?: number): PickerState {
  const detail = compactDetailLayout(state, Math.max(1, width - 2), height);
  return { ...state, detailOffset: Math.max(0, Math.min(detail.offset + delta, detail.maxOffset)) };
}

function compactDetailLayout(state: PickerState, width: number, height: number | undefined) {
  const selected = selectedIndex(state, activeCategory(state));
  const name = selected === undefined ? undefined : state.items[selected]?.name;
  const lines = [
    ...(name ? wrapTextWithAnsi(`Selected: ${name}`, width) : []),
    ...(state.poolError ? wrapTextWithAnsi(`Pool error: ${state.poolError}`, width) : []),
    ...(!state.poolError && state.poolMessage ? wrapTextWithAnsi(`Pool: ${state.poolMessage}`, width) : []),
  ];
  const poolRows = Number(state.poolDir !== undefined || Boolean(state.poolInput)) + Number(Boolean(state.poolError || state.poolMessage));
  const availableRows = Math.max(1, bodyHeight(height) - 3 - poolRows - compactFooter(state).length);
  const capacity = lines.length && availableRows > 1 ? Math.min(4, Math.max(1, Math.floor(availableRows / 2))) : 0;
  const maxOffset = Math.max(0, lines.length - capacity);
  return { lines, capacity, maxOffset, offset: Math.max(0, Math.min(state.detailOffset ?? 0, maxOffset)), listCapacity: Math.max(1, availableRows - capacity) };
}

function renderCompactBody(state: PickerState, width: number, height: number | undefined, styles: ReturnType<typeof createStyles>): string[] {
  const bodyLimit = bodyHeight(height);
  const footer = compactFooter(state).map((line) => styles.muted(line));
  if (!compactPickerCanInteract(state, width + 2, height)) {
    const notice = [styles.accent(state.title), styles.muted("Resize taller to use this picker."), styles.muted("Actions disabled"), styles.muted("Esc Cancel")];
    return fitRows(notice, bodyLimit);
  }

  const enabled = activeCategory(state);
  const indexes = visibleColumnIndexes(state, enabled);
  const selected = selectedIndex(state, enabled);
  const pool = poolRows(state, width, styles);
  const enabledCount = visibleColumnIndexes(state, true).length;
  const availableCount = visibleColumnIndexes(state, false).length;
  const tabs = `${enabled ? "▶" : " "} Enabled (${enabledCount})   ${enabled ? " " : "▶"} Available (${availableCount})`;
  const detail = compactDetailLayout(state, width, height);
  const listCapacity = detail.listCapacity;
  const visible = windowIndexes(indexes, selected, listCapacity);
  const list = visible.length
    ? visible.map((index) => formatItem(state, index))
    : [styles.muted(emptyCategoryMessage(state, enabled))];
  const listRows = Number.isFinite(listCapacity) ? Array.from({ length: listCapacity }, (_, index) => list[index] ?? "") : list;
  const detailRows = Array.from({ length: detail.capacity }, (_, index) => detail.lines[detail.offset + index] ?? "");
  return [
    styles.accent(state.title),
    ...pool,
    `search: ${renderSearch(state, Math.max(1, width - visibleWidth("search: ")))}`,
    styles.accent(tabs),
    ...listRows,
    ...detailRows,
    ...footer,
  ];
}

function renderWideBody(state: PickerState, width: number, height: number | undefined, styles: ReturnType<typeof createStyles>): string[] {
  const enabled = visibleColumnIndexes(state, true);
  const available = visibleColumnIndexes(state, false);
  const selectedEnabled = activeCategory(state);
  const selected = selectedIndex(state, selectedEnabled);
  const pool = poolRows(state, width, styles);
  const footer = styles.muted(pickerFooter(state));
  const bodyLimit = bodyHeight(height);
  const fixed = 6 + pool.length; // title, search, blank, heading, blank, footer
  const capacity = Math.max(1, bodyLimit - fixed);
  const selectedRow = selected === undefined ? 0 : Math.max(0, (selectedEnabled ? enabled : available).indexOf(selected));
  const rowCount = Math.max(enabled.length, available.length, 1);
  const start = windowStart(rowCount, selectedRow, capacity);
  const col = Math.max(1, Math.floor((width - 3) / 2));
  const itemRows: string[] = [];
  if (!enabled.length && !available.length) itemRows.push(styles.muted("No items match the current search."));
  else for (let row = start; row < Math.min(rowCount, start + capacity); row += 1) {
    itemRows.push(`${pad(formatItem(state, enabled[row]), col)}   ${formatItem(state, available[row])}`);
  }
  const rows = [
    styles.accent(state.title),
    ...pool,
    `search: ${renderSearch(state, Math.max(1, width - visibleWidth("search: ")))}`,
    "",
    `${pad("Enabled", col)}   Available`,
    ...itemRows,
    "",
    footer,
  ];
  return fitBody(rows, bodyLimit, footer);
}

function frame(lines: string[], width: number, styles: ReturnType<typeof createStyles>): string[] {
  return [
    `${styles.border("╭")}${styles.border("─".repeat(width))}${styles.border("╮")}`,
    ...lines.map((line) => `${styles.border("│")}${pad(line, width)}${styles.border("│")}`),
    `${styles.border("╰")}${styles.border("─".repeat(width))}${styles.border("╯")}`,
  ];
}

function bodyHeight(height: number | undefined): number {
  return height === undefined ? Number.POSITIVE_INFINITY : Math.max(1, height - 2);
}

function fitBody(rows: string[], limit: number, footer: string): string[] {
  if (!Number.isFinite(limit) || rows.length <= limit) return rows;
  if (limit <= 1) return [footer];
  return [...rows.slice(0, limit - 1), footer];
}

function fitRows(rows: string[], limit: number): string[] {
  if (!Number.isFinite(limit)) return rows;
  return rows.slice(Math.max(0, rows.length - Math.max(0, limit)));
}

function poolRows(state: PickerState, width: number, styles: ReturnType<typeof createStyles>): string[] {
  const rows: string[] = [];
  if (state.poolDir !== undefined || state.poolInput) rows.push(renderPoolLine(state, width));
  if (state.poolError) rows.push(styles.error(truncateToWidth(state.poolError, width, "…")));
  else if (state.poolMessage) rows.push(styles.muted(truncateToWidth(state.poolMessage, width, "…")));
  return rows;
}

function renderSearch(state: PickerState, width: number): string {
  return renderCursorValue(state.filter ?? "", state.filterCursor, width, "start");
}

function renderPoolLine(state: PickerState, width: number): string {
  const label = "pool: ";
  if (state.poolInput) return `${label}${renderCursorValue(state.poolInput.value, state.poolInput.cursor, Math.max(1, width - visibleWidth(label)), "start")}`;
  const extra = state.poolDirExtraCount && state.poolDirExtraCount > 0 ? ` (+${state.poolDirExtraCount})` : "";
  const hint = "Alt+E edit";
  const available = Math.max(0, width - visibleWidth(label) - visibleWidth(hint) - 1);
  const path = truncateToWidth(`${state.poolDir ?? ""}${extra}`, available, "…");
  const gap = " ".repeat(Math.max(1, width - visibleWidth(label) - visibleWidth(path) - visibleWidth(hint)));
  return `${label}${path}${gap}${hint}`;
}

function compactFooter(state: PickerState): string[] {
  if (state.poolInput) return ["Type Path", "←→ Edit  Enter Save/Reload  Esc Cancel"];
  return ["↑↓ Move ←→/Tab List PgUp/PgDn Detail", "Space Toggle  Enter Apply  Esc Cancel"];
}

function pickerFooter(state: PickerState): string {
  if (state.poolInput) return "←→ edit · enter save/reload · esc cancel";
  if (state.poolDir !== undefined) return "type search · ↑↓ move · ←→/Tab column · space toggle · Alt+E edit pool · enter apply · esc cancel";
  return "type search · ↑↓ move · ←→/Tab column · space toggle · enter apply · esc cancel";
}

function formatItem(state: PickerState, index: number | undefined): string {
  if (index === undefined) return "";
  const item = state.items[index];
  if (!item) return "";
  const selected = activeCategory(state) === item.enabled && selectedIndex(state, item.enabled) === index;
  return `${selected ? ">" : " "} ${item.enabled ? "✓" : " "} ${item.name}`;
}

function createStyles(theme: SessionsTheme) {
  return {
    accent: (text: string) => styleToken(theme, "accent", text),
    border: (text: string) => styleToken(theme, "border", text),
    muted: (text: string) => styleToken(theme, "muted", text),
    error: (text: string) => styleToken(theme, "error", text),
  };
}

function activeCategory(state: PickerState): boolean {
  if (state.activeEnabled !== undefined) return state.activeEnabled;
  return state.items[state.selected]?.enabled ?? true;
}

function emptyCategoryMessage(state: PickerState, enabled: boolean): string {
  return state.filter?.trim() ? `No ${enabled ? "enabled" : "available"} items match the search.` : `No ${enabled ? "enabled" : "available"} items.`;
}

function visibleColumnIndexes(state: PickerState, enabled: boolean): number[] {
  const filter = state.filter?.trim().toLowerCase();
  return state.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.enabled === enabled && (!filter || item.name.toLowerCase().includes(filter)))
    .map(({ index }) => index);
}

function selectedIndex(state: PickerState, enabled: boolean): number | undefined {
  const indexes = visibleColumnIndexes(state, enabled);
  if (!indexes.length) return undefined;
  return indexes.includes(state.selected) ? state.selected : indexes[0];
}

function windowIndexes(indexes: number[], selected: number | undefined, capacity: number): number[] {
  const selectedRow = selected === undefined ? 0 : Math.max(0, indexes.indexOf(selected));
  return indexes.slice(windowStart(indexes.length, selectedRow, capacity), windowStart(indexes.length, selectedRow, capacity) + capacity);
}

function windowStart(length: number, selected: number, capacity: number): number {
  return Math.max(0, Math.min(selected - Math.floor(capacity / 2), Math.max(0, length - capacity)));
}

function pad(value: string, width: number): string {
  return truncateToWidth(value, width, "…", true);
}
