import { visibleWidth } from "@earendil-works/pi-tui";
import { glyphs } from "./glyphs.js";
import { stripAnsi } from "./theme.js";
import type { DialogContext, SessionDialog } from "./dialog.js";

/**
 * A click on a dialog first applies `select` (focus or highlight), then replays `key` through the
 * dialog's own key handler, so every keyboard guard still applies. A double-click replays `confirm`.
 */
export interface DialogAction {
  id: string;
  select?: (ctx: DialogContext) => SessionDialog | undefined;
  key?: string;
  confirm?: string;
}

/** `row` is the 0-based rendered line; `x`/`width` are 1-based columns, omitted for whole-row hits. */
export interface DialogHit extends DialogAction {
  row: number;
  x?: number;
  width?: number;
}

/** Collects hits from a renderer that does not know which dialog owns it. */
export interface DialogHitSink<T> {
  out: DialogHit[];
  target(value: T): DialogAction | undefined;
}

/** Dialog content starts after the left border column. */
export const DIALOG_CONTENT_X = 2;

export const ENTER = "\r";
export const ESCAPE = "\u001b";
export const UP = "\u001b[A";
export const DOWN = "\u001b[B";
export const RIGHT = "\u001b[C";
export const PAGE_UP = "\u001b[5~";
export const PAGE_DOWN = "\u001b[6~";

/** Maps footer hints such as `Enter Apply`, `Ctrl+Y Create` or `Esc Cancel` to tappable key ranges. */
export function footerHits(row: number, footer: string, x = DIALOG_CONTENT_X, maxWidth = Number.POSITIVE_INFINITY): DialogHit[] {
  const plain = stripAnsi(footer).split(` ${glyphs.pendingStep} `).join("   ");
  const hits: DialogHit[] = [];
  for (const match of plain.matchAll(/\S+(?: \S+)*/g)) {
    const key = footerKey(match[0].split(" ")[0] ?? "");
    const start = visibleWidth(plain.slice(0, match.index));
    if (!key || start >= maxWidth) continue;
    hits.push({ id: `key:${key}`, key, row, x: x + start, width: Math.min(visibleWidth(match[0]), maxWidth - start) });
  }
  return hits;
}

export function hitAt(hits: readonly DialogHit[], row: number, x: number): DialogHit | undefined {
  return hits.find((hit) => hit.row === row && (hit.x === undefined || (x >= hit.x && x < hit.x + (hit.width ?? 0))));
}

function footerKey(label: string): string | undefined {
  if (label === "Enter") return ENTER;
  if (label === "Esc") return ESCAPE;
  if (label === "Space") return " ";
  if (label === "Tab") return "\t";
  const ctrl = /^Ctrl\+([A-Z])$/.exec(label);
  if (ctrl) return String.fromCharCode(ctrl[1]!.charCodeAt(0) - 64);
  const alt = /^Alt\+([a-z])$/.exec(label);
  if (alt) return `\u001b${alt[1]}`;
  return /^[a-zA-Z]$/.test(label) ? label : undefined;
}
