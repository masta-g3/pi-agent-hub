import { glyphs } from "./glyphs.js";
import { quotaSegment } from "./usage-view.js";
import { sliceByColumn, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { plainTerminalText } from "../core/terminal-text.js";
import type { SessionAction, WorkflowLens, WorkflowModeDisplay, WorkflowRuntimeSnapshot } from "../core/types.js";
import { alwaysExpanded, type CockpitTier, type RenderModel, type RenderSession, type RenderWorkspace } from "./render-model.js";
import { ageLabel } from "./age.js";
import { renderMarkdown } from "./conversation.js";
import { formatKey } from "./dashboard-shortcuts.js";
import { createTextInput, renderTextInput } from "./text-input.js";
import { hasUsefulStatusResult, statusEvidenceFields, type StatusEvidenceField } from "./status-evidence.js";
import { darkTheme, noColor, panelTheme, selectionMarker, stripAnsi, styleBg, styleBgToken, styleFg, styleToken, surfaceTokens, type SessionsTheme } from "./theme.js";
import { DIALOG_CONTENT_X, footerHits, type DialogHitSink } from "./dialog-mouse.js";

export const NARROW_LAYOUT_MAX_WIDTH = 60;
export const MIN_LAYOUT_WIDTH = 30;
/** Unselected fleet rows collapse below this height; the selected card keeps its content. */
const SHORT_FLEET_HEIGHT = 20;
/** From this width the selected session's card sits beside the roster instead of below it. */
const SIDE_PANE_MIN_WIDTH = 100;
const PANE_MAX_WIDTH = 104;

export type SessionListTarget =
  | { kind: "session"; id: string }
  | { kind: "session-continuation"; id: string }
  | { kind: "archive-disclosure" }
  | { kind: "release-cue" }
  | { kind: "repo-header"; repoKey: string }
  | { kind: "section-header"; section: "health" | "active" | "quiet" | "archived" };

/** A tier chip's 1-based terminal column range on the summary row. */
export interface TierChip {
  tier: CockpitTier;
  x: number;
  width: number;
}

/** A tappable footer control; `x` is the 1-based terminal column where its keycap starts. */
export interface FooterItem {
  key: string;
  x: number;
  width: number;
}

export interface CardCommandHit { row: number; x: number; width: number; commandId: string }

export interface PanelViewport { pageSize: number; maxOffset: number; fallback?: boolean }

export interface SessionsLayout {
  usageHit?: { row: number; x: number; width: number };
  panelViewport?: PanelViewport;
  cardCommandHits: CardCommandHit[];
  lines: string[];
  rowTargets: (SessionListTarget | undefined)[];
  tierChipRow?: number;
  tierChips: TierChip[];
  workspaceRowTargets: (string | undefined)[];
  announcementRowTargets: (string | undefined)[];
  listStartX: number;
  workspaceStartX?: number;
  listWidth: number;
  listScrollTop: number;
  /** The side pane beside the roster: its 1-based start column and, per screen row, the session its card row belongs to. */
  pane?: { x: number; targets: (SessionListTarget | undefined)[] };
  footerRow?: number;
  footerItems: FooterItem[];
}

function wrapShell(width: number, body: string[], height: number | undefined): string[] {
  return fitBody(body, height).map((line) => pad(line, width));
}

function footerLines(width: number, footer: string, styles: LayoutStyles): string[] {
  return [footerLayout(footer, width, styles).line];
}

interface FooterLayout { line: string; items: FooterItem[] }

/**
 * Footer items render as keycaps on the band. Whole trailing items drop instead of cutting a label mid-word;
 * item `x` values are 1-based columns relative to `x`.
 */
function footerLayout(footer: string, width: number, styles: LayoutStyles, x = 1): FooterLayout {
  const gap = "   ";
  const parts = footer.split(` ${glyphs.pendingStep} `).map((part) => {
    const match = /^(\S+)((?: .*)?)$/u.exec(part);
    const key = match?.[1] ?? part;
    const label = match?.[2] ?? "";
    return { key, text: keyItemText(key, label.replace(/^ /u, ""), styles) };
  });
  const lineOf = (items: typeof parts) => ` ${items.map((item) => item.text).join(gap)}`;
  while (parts.length > 1 && displayWidth(lineOf(parts)) > width) parts.pop();
  const items: FooterItem[] = [];
  let offset = 1;
  for (const part of parts) {
    if (part.key === "Enter" || part.key === "Esc" || [...part.key].length === 1) items.push({ key: part.key, x: x + offset, width: displayWidth(part.text) });
    offset += displayWidth(part.text) + gap.length;
  }
  return { line: styles.band(pad(lineOf(parts), width)), items: items.filter((item) => item.x - x + item.width <= width) };
}

function headerBand(line: string, width: number, styles: LayoutStyles): string {
  return styles.band(pad(line, width));
}

export function renderSessions(model: RenderModel, theme?: SessionsTheme): SessionsLayout {
  // The no-pin fleet is an instrument panel; board and pin views keep the full palette.
  const panel = model.grouping !== "stage" && !model.pinMode;
  const styles = theme ? { ...createStyles(panel ? panelTheme(theme) : theme, theme.success, panel), usageTheme: theme } : plainStyles(panel);
  const width = Math.max(MIN_LAYOUT_WIDTH, model.width);
  const emptyLayout = (lines: string[]): SessionsLayout => ({
    lines,
    rowTargets: lines.map(() => undefined),
    tierChips: [],
    workspaceRowTargets: lines.map(() => undefined),
    announcementRowTargets: lines.map(() => undefined),
    listStartX: 1,
    listWidth: 0,
    listScrollTop: 0,
    footerItems: [],
    cardCommandHits: [],
  });
  if (model.workspace?.panel && model.height && model.height <= (model.pinMode ? 2 : 1)) {
    const focused = renderFocusedPanel(model.workspace.session.title, [], model.workspace.panel, width, 1, styles);
    const layout = emptyLayout(wrapShell(width, focused.lines, model.height));
    layout.workspaceStartX = 1;
    layout.workspaceRowTargets[0] = `action:${model.workspace.session.id}:open`;
    layout.panelViewport = focused.panelViewport;
    return layout;
  }
  const filterBar = renderFilterBar(model, width, styles);
  const filterLines = filterBar ? [filterBar] : [];
  if (filterBar && model.height === 3 && !(model.showWorkspace && model.workspace?.fullScreen)) {
    return emptyLayout(wrapShell(width, [filterBar], model.height));
  }
  if (model.empty && !model.guidance.coach && !model.guidance.releaseCue) {
    const summary = renderTopSummary(model, width, styles);
    const showSummary = filterBar || model.usage?.accounts.length;
    const body = showSummary ? [summary.line, ...filterLines, ...emptyLines(width, styles)] : emptyLines(width, styles);
    const layout = emptyLayout(wrapShell(width, body, model.height));
    if (showSummary && summary.quota && layout.lines.length > 0) layout.usageHit = { row: 0, x: 1 + summary.quota.x, width: summary.quota.width };
    return layout;
  }
  if (model.noBoardSessions) {
    const announcement = renderAttentionAnnouncement(model, width, styles, !model.height || model.height >= 10);
    const summary = renderTopSummary(model, width, styles);
    const body = [summary.line, ...filterLines, ...announcement.lines, ...noBoardLines(width, model, styles), ...(model.footer ? footerLines(width, model.footer, styles) : [])];
    const layout = emptyLayout(wrapShell(width, body, model.height));
    for (let i = 0; i < announcement.targets.length; i += 1) layout.announcementRowTargets[1 + filterLines.length + i] = announcement.targets[i];
    if (summary.quota && layout.lines.length > 0) layout.usageHit = { row: 0, x: 1 + summary.quota.x, width: summary.quota.width };
    return layout;
  }
  if (model.grouping === "stage" && model.showWorkspace && model.workspace?.fullScreen) {
    return renderWorkspaceScreen(model.workspace, width, model.height, model.now, styles);
  }

  const syntheticSelection = model.sections.some((section) => section.selected || section.archiveDisclosure?.selected);
  const workspaceWidth = model.grouping === "stage" && (model.showWorkspace || (!model.pinMode && syntheticSelection && width >= 120))
    ? (width >= 160 ? 44 : 34)
    : 0;
  // The no-pin fleet shows the selected session's card beside the roster at 100+ columns, below it otherwise;
  // either way rows keep their height whatever is selected.
  const dock = model.grouping !== "stage" && !model.pinMode && !model.noMatches && !model.empty;
  // An open conversation owns the screen's lower part; the card returns below the short roster.
  const side = dock && width >= SIDE_PANE_MIN_WIDTH && !model.compactRows;
  // The roster takes about two fifths; past 160 columns it also takes what the pane's reading width does not need.
  const paneWidth = side ? Math.min(PANE_MAX_WIDTH, width - Math.max(38, Math.round(width * 0.38)) - 1) : 0;
  const listWidth = width - workspaceWidth - (workspaceWidth ? 1 : 0) - (side ? paneWidth + 1 : 0);
  const listStartX = 1;
  const decisionRows = model.pinMode && model.workspace?.panel && model.height
    ? Math.max(1, model.height - 1 - filterLines.length - 1)
    : pinnedDecisionRows(model.height);
  const decision: WorkspaceRendered = model.pinMode && model.workspace
    ? renderPinnedDecisionStrip(model.workspace, width, decisionRows, model.now, styles, width <= NARROW_LAYOUT_MAX_WIDTH)
    : model.pinMode && syntheticSelection
      ? { lines: Array.from({ length: decisionRows }, () => ""), targets: Array.from({ length: decisionRows }, () => undefined as string | undefined) }
      : { lines: [] as string[], targets: [] as (string | undefined)[] };
  const minimumRows = 4 + filterLines.length + decision.lines.length;
  const footerVisible = Boolean(model.footer) && !model.workspace?.panel && (!filterBar || !model.height || model.height >= minimumRows + 2);
  const baseStripLines = filterLines.length + decision.lines.length;
  const announcement = renderAttentionAnnouncement(model, width, styles,
    !model.height || model.height - 5 - baseStripLines - (model.pinMode ? 1 : 2) >= 4);
  const stripLines = announcement.lines.length + baseStripLines;
  const targetRows = bodyRowsFromHeight(model.height, stripLines, footerVisible ? 1 : 0);
  const expanded = Boolean(model.workspace?.panel || model.workspace?.evidenceVisible || model.workspace?.session.messageExpanded);
  // A focused panel or Details grow the dock only as far as their content needs, so neighbors stay when they fit.
  const cardRows = !dock || side ? 0 : expanded
    ? Math.min(dockRows(targetRows, true), dockedCard(model, listWidth, styles, undefined)?.lines.length ?? 0)
    : dockRows(targetRows, false);
  // A rule separates list and dock when rows allow; a focused panel may take the whole body on a tiny window.
  const dockRule = dock && !side && (targetRows === undefined || (cardRows > 0 && targetRows >= 8));
  const listRows = targetRows === undefined ? undefined : cardRows >= targetRows ? 0 : Math.max(1, targetRows - cardRows - (dockRule ? 1 : 0));
  // Card spacers are a luxury: drop them all once the fleet needs windowing.
  const spaced = renderSessionList(model, listWidth, styles, true, false, dock);
  let left = listRows !== undefined && spaced.lines.length > listRows
    ? renderSessionList(model, listWidth, styles, false, false, dock)
    : spaced;
  if (model.grouping !== "stage" && model.width > NARROW_LAYOUT_MAX_WIDTH && listRows !== undefined) {
    const twoLineHeight = left.lines.reduce((count, _line, index) => {
      const optional = (left.continuationPriorities.get(index) ?? -1) >= 0;
      const selectedOwner = !dock && left.selectedOwnerId !== undefined && left.lineMeta[index]?.ownerId === left.selectedOwnerId;
      return count + (optional && !selectedOwner ? 0 : 1);
    }, 0);
    if (twoLineHeight > listRows) left = renderSessionList(model, listWidth, styles, false, true, dock);
  }
  const card = side ? dockedCard(model, paneWidth, styles, targetRows)
    : dock ? dockedCard(model, listWidth, styles, targetRows === undefined ? undefined : cardRows) : undefined;
  const workspace: WorkspaceRendered = workspaceWidth && model.workspace
    ? renderActionWorkspace(model.workspace, workspaceWidth, targetRows, model.now, styles)
    : { lines: [] as string[], targets: [] as (string | undefined)[] };
  const rows = listRows ?? Math.max(left.lines.length, workspace.lines.length, side ? card?.lines.length ?? 0 : 0, 8);
  const windowedLeft = windowList(left, rows, model.listScrollTop ?? 0, styles);
  // The pane's keys stay on its last rows, so they do not move as the content above them changes.
  const pane: ({ line: string; commands?: NonNullable<SessionLineMeta["commands"]> } | undefined)[] = [];
  if (side && card) {
    const cells = card.lines.map((line, index) => ({ line, commands: card.lineMeta[index]?.commands }));
    const firstKey = model.workspace?.panel ? -1 : cells.findIndex((cell) => cell.commands?.length);
    const keys = firstKey < 0 ? [] : cells.slice(firstKey);
    const content = firstKey < 0 ? cells : cells.slice(0, firstKey);
    pane.push(...content, ...Array.from({ length: Math.max(0, rows - content.length - keys.length) }, () => undefined), ...keys);
  }
  const summary = renderHeaderSummary(model, width, styles);
  const body: string[] = [summary.line, ...filterLines, ...announcement.lines];
  const visibleLinesByOwner = new Map<string, number>();
  for (const meta of windowedLeft.lineMeta) {
    if (meta?.ownerId && meta.richTree) visibleLinesByOwner.set(meta.ownerId, (visibleLinesByOwner.get(meta.ownerId) ?? 0) + 1);
  }
  for (let i = 0; i < rows; i += 1) {
    const meta = windowedLeft.lineMeta[i];
    const gutterMeta = meta?.ownerId && (visibleLinesByOwner.get(meta.ownerId) ?? 0) > 1 ? meta : undefined;
    const decorated = decorateTreeGutter(windowedLeft.lines[i] ?? "", gutterMeta, styles);
    const padded = pad(decorated, listWidth);
    const selected = Boolean(left.selectedOwnerId && meta?.ownerId === left.selectedOwnerId)
      || (!left.selectedOwnerId && i >= windowedLeft.selectedIndex && i <= windowedLeft.selectedEndIndex);
    // Only the selected owner tree sits on a plate; every other module reads off the base background.
    const leftLine = selected ? styles.selected(padded) : padded;
    const workspaceLine = workspaceWidth ? `${styles.border(glyphs.vertical)}${pad(workspace.lines[i] ?? "", workspaceWidth)}` : "";
    // The side pane reads off the base background: the roster row carries the selection, so the card drops its stripe.
    const paneLine = side ? `${styles.dim(glyphs.vertical)}${pane[i] === undefined ? "" : ` ${withoutStripeTone(sliceByColumn(pane[i]!.line, 1, paneWidth))}`}` : "";
    body.push(`${leftLine}${workspaceLine}${paneLine}`);
  }
  const cardStart = 1 + filterLines.length + announcement.lines.length + rows + (rows && dockRule ? 1 : 0);
  // The dock keeps its rows even with nothing to show, so the footer never moves with the selection.
  const cardHeight = side ? 0 : targetRows === undefined ? card?.lines.length ?? 0 : cardRows;
  if (cardHeight) {
    if (rows && dockRule) body.push(styles.border(glyphs.horizontal.repeat(width)));
    for (let i = 0; i < cardHeight; i += 1) {
      const line = card?.lines[i];
      body.push(line === undefined ? "" : styles.selected(pad(line, width)));
    }
  }
  body.push(...decision.lines);
  if (footerVisible) body.push(...footerLines(width, model.footer, styles));
  const lines = wrapShell(width, body, model.height);
  const rowTargets = lines.map(() => undefined as SessionListTarget | undefined);
  const workspaceRowTargets = lines.map(() => undefined as string | undefined);
  const announcementRowTargets = lines.map(() => undefined as string | undefined);
  for (let i = 0; i < announcement.targets.length; i += 1) announcementRowTargets[1 + filterLines.length + i] = announcement.targets[i];
  const listStart = 1 + filterLines.length + announcement.lines.length;
  const decisionStart = listStart + rows;
  if (card) for (let i = 0; i < cardHeight && cardStart + i < lines.length; i += 1) rowTargets[cardStart + i] = card.targets[i];
  const contentEnd = lines.length;
  for (let i = 0; i < decision.targets.length && decisionStart + i < contentEnd; i += 1) workspaceRowTargets[decisionStart + i] = decision.targets[i];
  const footerRow = footerVisible && body.length <= lines.length ? body.length - 1 : undefined;
  for (let i = 0; i < rows; i += 1) {
    const lineIndex = listStart + i;
    if (lineIndex >= contentEnd) break;
    rowTargets[lineIndex] = windowedLeft.targets[i];
    workspaceRowTargets[lineIndex] = workspace.targets[i];
  }
  return {
    lines,
    rowTargets,
    panelViewport: card?.panelViewport ?? windowedLeft.panelViewport ?? workspace.panelViewport ?? decision.panelViewport,
    cardCommandHits: [
      ...windowedLeft.lineMeta.flatMap((meta, index) => (meta?.commands ?? []).map(hit => ({ ...hit, row: listStart + index, x: listStartX + hit.x }))),
      ...pane.slice(0, rows).flatMap((cell, index) => (cell?.commands ?? []).map(hit => ({ ...hit, row: listStart + index, x: listStartX + listWidth + 1 + hit.x }))),
      ...(card && !side ? card.lineMeta.slice(0, cardHeight).flatMap((meta, index) => (meta?.commands ?? []).map(hit => ({ ...hit, row: cardStart + index, x: listStartX + hit.x }))) : []),
    ],
    ...(summary.quota && lines.length > 0 ? { usageHit: { row: 0, x: 1 + summary.quota.x, width: summary.quota.width } } : {}),
    ...(summary.chips.length && lines.length > 0 ? { tierChipRow: 0 } : {}),
    tierChips: lines.length > 0 ? summary.chips.map((chip) => ({ ...chip, x: chip.x + 1 })) : [],
    workspaceRowTargets,
    announcementRowTargets,
    listStartX,
    ...(workspaceWidth ? { workspaceStartX: listStartX + listWidth + 1 } : decision.lines.length ? { workspaceStartX: 1 } : {}),
    listWidth,
    listScrollTop: windowedLeft.top,
    ...(side && card ? { pane: { x: listStartX + listWidth + 1, targets: lines.map((_, row) => pane[row - listStart] ? card.targets.find(Boolean) : undefined) } } : {}),
    ...(footerRow !== undefined ? { footerRow } : {}),
    footerItems: footerRow !== undefined ? footerLayout(model.footer, width, styles, 1).items : [],
  };
}

/**
 * Rows for the docked card: a fixed height per window size, so selection never resizes the list.
 */
function dockRows(bodyRows: number | undefined, expanded: boolean): number {
  if (bodyRows === undefined) return 0;
  // A focused panel or requested Details take all but one list row, or the whole body when that is all there is.
  if (expanded) return bodyRows >= 8 ? bodyRows - 2 : bodyRows;
  if (bodyRows >= 40) return 10;
  if (bodyRows >= 28) return 8;
  if (bodyRows >= 20) return 7;
  // Below that the card still needs its identity, one body row and its keys.
  if (bodyRows >= 12) return 6;
  if (bodyRows >= 8) return 5;
  // Short windows keep only the selected list row and drop the rule.
  return bodyRows >= 3 ? bodyRows - 1 : 0;
}

/**
 * The selected session's full card, windowed into the dock; none for synthetic header selections. The list
 * keeps the session's only title target, so every dock row is a mouse-only continuation of it.
 */
function dockedCard(model: RenderModel, width: number, styles: LayoutStyles, rows: number | undefined): ListWindow | undefined {
  if (rows === 0) return undefined;
  const inline = renderSessionList(model, width, styles, false);
  const title = inline.targets[inline.selectedIndex];
  if (title?.kind !== "session") return undefined;
  const span = Array.from({ length: inline.selectedEndIndex - inline.selectedIndex + 1 }, (_, offset) => inline.selectedIndex + offset);
  const window = inline.panel ? windowPanel(inline, rows, styles)
    : rows === undefined
      ? { lines: span.map((index) => inline.lines[index]!), targets: span.map((index) => inline.targets[index]), lineMeta: span.map((index) => inline.lineMeta[index]), selectedIndex: 0, selectedEndIndex: span.length - 1, top: inline.selectedIndex }
      : windowSelectedCard(inline, rows, styles);
  return { ...window, targets: window.targets.map((target) => target ? { kind: "session-continuation" as const, id: title.id } : target) };
}

function renderAttentionAnnouncement(
  model: RenderModel,
  width: number,
  styles: LayoutStyles,
  visible: boolean,
): { lines: string[]; targets: (string | undefined)[] } {
  const active = model.attentionAnnouncements.filter((announcement) => model.now < announcement.expiresAt);
  const newest = active[0];
  if (!visible || !newest) return { lines: [], targets: [] };
  const tone = styles.panel ? styles.warning : newest.kind === "blocked" ? styles.error : newest.kind === "ready" ? styles.success : styles.warning;
  const glyph = newest.kind === "blocked" ? "!" : newest.kind === "ready" ? glyphs.ready : "?";
  const label = active.length > 1 ? `${glyph} ${active.length} NEW` : `${glyph} ${newest.kind.toUpperCase()}`;
  const identity = plainAttentionText(newest.ownerTitle ? `${newest.title} ${glyphs.right} ${newest.ownerTitle}` : newest.title);
  const workspaceDuplicatesRequest = model.workspace?.session.id === newest.sessionId;
  const more = model.width >= 100 && active.length > 1 ? styles.muted(`+${active.length - 1} more`) : undefined;
  const leftPrefix = [tone(glyphs.attentionBar), tone(label)].join("  ");
  const left = `${leftPrefix}  ${identity}`;
  const locate = `${styles.accent(":")} ${styles.muted("locate")}`;
  const fixedTail = [more, locate, model.width >= 160 ? styles.muted("6s") : undefined]
    .filter((part): part is string => Boolean(part)).join("  ");
  const request = model.width >= 100 && !model.pinMode && !workspaceDuplicatesRequest
    ? `${glyphs.quoteLeft}${plainAttentionText(newest.text)}${glyphs.quoteRight}`
    : undefined;
  const requestBudget = request
    ? Math.max(0, width - displayWidth(leftPrefix) - Math.min(16, displayWidth(identity)) - displayWidth(fixedTail) - 3)
    : 0;
  const detail = request && requestBudget > 1 ? styles.muted(truncate(request, requestBudget)) : undefined;
  const tail = [detail, fixedTail].filter(Boolean).join("  ");
  const commandId = `view:locate-attention:${encodeURIComponent(newest.sessionId)}:${encodeURIComponent(newest.requestId)}`;
  const content = pad(twoColumn(left, tail, width), width);
  if (model.pinMode) return { lines: [content], targets: [commandId] };
  return { lines: [content, styles.border(glyphs.horizontal.repeat(width))], targets: [commandId, undefined] };
}

function plainAttentionText(value: string): string {
  return plainTerminalText(stripAnsi(value));
}

function renderWorkspaceScreen(workspace: RenderWorkspace, width: number, height: number | undefined, now: number, styles: LayoutStyles): SessionsLayout {
  const footerRows = workspace.panel ? 0 : 1;
  const bodyRows = height && height > 0 ? Math.max(footerRows, height) : undefined;
  const contentRows = bodyRows === undefined ? undefined : Math.max(0, bodyRows - footerRows);
  const rendered = renderActionWorkspace(workspace, width, contentRows, now, styles);
  const footer = workspaceFooter(workspace);
  const content = contentRows === undefined
    ? rendered.lines
    : [...rendered.lines.slice(0, contentRows), ...Array.from({ length: Math.max(0, contentRows - rendered.lines.length) }, () => "")];
  const lines = wrapShell(width, [...content, ...(workspace.panel ? [] : footerLines(width, footer, styles))], undefined);
  const workspaceRowTargets = lines.map(() => undefined as string | undefined);
  for (let i = 0; i < content.length; i += 1) workspaceRowTargets[i] = rendered.targets[i];
  return {
    lines,
    rowTargets: lines.map(() => undefined),
    cardCommandHits: [],
    tierChips: [],
    workspaceRowTargets,
    announcementRowTargets: lines.map(() => undefined),
    listStartX: 1,
    workspaceStartX: 1,
    panelViewport: rendered.panelViewport,
    listWidth: 0,
    listScrollTop: 0,
    ...(workspace.panel ? {} : { footerRow: lines.length - 1 }),
    footerItems: workspace.panel ? [] : footerLayout(footer, width, styles, 1).items,
  };
}

function bodyRowsFromHeight(height: number | undefined, stripLines: number, footerRows: number): number | undefined {
  if (!height || height <= 0) return undefined;
  return Math.max(1, height - 1 - footerRows - stripLines);
}

function fitBody(lines: string[], height: number | undefined): string[] {
  if (!height || height <= 0) return lines;
  const target = height;
  if (lines.length >= target) return lines.slice(0, target);
  return [...lines, ...Array.from({ length: target - lines.length }, () => "")];
}

interface LayoutStyles {
  theme: SessionsTheme;
  /** Account quota bars keep the theme's own success, warning and error colors in every palette. */
  usageTheme: SessionsTheme;
  accent(text: string): string;
  border(text: string): string;
  dim(text: string): string;
  error(text: string): string;
  success(text: string): string;
  muted(text: string): string;
  text(text: string): string;
  /** Bold primary text; the only emphasis that does not borrow a semantic color. */
  strong(text: string): string;
  warning(text: string): string;
  selected(text: string): string;
  /** Live work: running glyphs and running-subagent counts, which keep `success` in the panel palette. */
  live(text: string): string;
  /** The no-pin fleet's instrument-panel palette: every request kind reads as the one signal color. */
  panel: boolean;
  /** Header and footer band. */
  band(text: string): string;
  /** A key drawn as a key; bold accent text when surfaces cannot be derived. Panel keys read in accent. */
  keycap(key: string): string;
  /** Whether bands, plates and keycaps carry backgrounds. */
  painted: boolean;
  /**
   * Whether keycaps keep their one-cell padding. Geometry depends only on NO_COLOR, so a quiet
   * (unfocused) or unpainted theme never moves text or hit targets.
   */
  padded: boolean;
  option(text: string): string;
  status(status: RenderSession["displayStatus"], text: string): string;
}

function createStyles(theme: SessionsTheme, live: string | number = theme.success, panel = false): LayoutStyles {
  const surfaces = surfaceTokens(theme);
  const padded = !noColor();
  const painted = padded && surfaces.keycapBg !== "";
  const bold = (text: string) => `\u001b[1m${text}\u001b[22m`;
  return {
    theme,
    usageTheme: theme,
    painted,
    padded,
    panel,
    live: (text) => styleFg(live, text),
    accent: (text) => styleToken(theme, "accent", text),
    border: (text) => styleToken(theme, "border", text),
    dim: (text) => styleToken(theme, "dim", text),
    error: (text) => styleToken(theme, "error", text),
    success: (text) => styleToken(theme, "success", text),
    muted: (text) => styleToken(theme, "muted", text),
    text: (text) => styleToken(theme, "text", text),
    strong: (text) => text ? `\u001b[1m${styleToken(theme, "text", text)}\u001b[22m` : text,
    warning: (text) => styleToken(theme, "warning", text),
    selected: (text) => styleBgToken(theme, "selectedBg", text),
    band: (text) => styleBg(surfaces.bandBg, text),
    keycap: (key) => {
      const label = padded ? ` ${key} ` : key;
      const ink = panel ? "accent" : "text";
      return painted ? styleBg(surfaces.keycapBg, bold(styleToken(theme, ink, label))) : bold(styleToken(theme, "accent", label));
    },
    option: (text) => styleBgToken(theme, "statusLineBg", text.replace(/\x1b\[0m/gu, "\x1b[39m")),
    status: (status, text) => status === "running" ? styleFg(live, text) : styleToken(theme, status === "error" ? "error" : status === "waiting" ? "warning" : "muted", text),
  };
}

function plainStyles(panel = false): LayoutStyles {
  return createStyles({ ...darkTheme, accent: "", border: "", dim: "", error: "", muted: "", success: "", warning: "", selectedBg: "", statusLineBg: "" }, "", panel);
}

function emptyLines(inner: number, styles: LayoutStyles): string[] {
  return [
    "",
    styles.accent("No managed Pi sessions yet."),
    "",
    `${styles.accent(glyphs.primary)} ${styles.accent("n")}  create a session here`,
    `  ${styles.accent("?")}  ${styles.muted("show help")}`,
    `  ${styles.accent("q")}  ${styles.muted("quit")}`,
    "",
  ].map((line) => truncate(line, inner));
}

function noBoardLines(inner: number, model: RenderModel, styles: LayoutStyles): string[] {
  return [
    "",
    styles.accent("No Active sessions."),
    "",
    `${styles.accent(glyphs.primary)} ${styles.accent("S")}  return to project view`,
    boardHiddenSummary(model, inner, styles),
    "",
  ].map((line) => truncate(line, inner));
}

function renderFilterBar(model: RenderModel, width: number, styles: LayoutStyles): string | undefined {
  const editor = model.filterEditing;
  if (!editor && model.filter === undefined) return undefined;
  const board = model.grouping === "stage";
  const total = board ? model.boardTotalCardCount : model.summary.ownerTotal;
  const matching = board ? model.boardCardCount : model.summary.visibleOwnerTotal;
  const hidden = total - matching;
  const label = `${glyphs.filter} ${editor ? "FILTERING" : "FILTERED"} `;
  const tone = model.noMatches ? styles.warning : styles.accent;
  const hiddenLabel = `${hidden} hidden`;
  const hints = editor
    ? [`Enter Apply ${glyphs.pendingStep} Esc Cancel`, `Enter ${glyphs.pendingStep} Esc Cancel`, "Esc Cancel"]
    : model.empty
      ? [`${hiddenLabel} ${glyphs.pendingStep} Esc Clear`, "Esc Clear"]
      : [`${hiddenLabel} ${glyphs.pendingStep} / Edit ${glyphs.pendingStep} Esc Clear`, `${hiddenLabel} ${glyphs.pendingStep} Esc Clear`, "Esc Clear"];
  const hint = hints.find((candidate) => displayWidth(label) + displayWidth(candidate) + 6 <= width) ?? hints[hints.length - 1]!;
  const fieldWidth = Math.max(1, width - displayWidth(label) - displayWidth(hint) - 2);
  const query = editor
    ? styles.selected(renderCursorValue(editor.value, editor.cursor, fieldWidth, "start", inputCursor(model.now)))
    : truncate(model.filter ?? "", fieldWidth);
  return twoColumn(`${tone(label)}${query}`, styles.muted(hint), width);
}

function sessionCountLabel(model: RenderModel): string {
  const board = model.grouping === "stage";
  const visible = board ? model.boardCardCount : model.summary.visibleOwnerTotal;
  const total = board ? model.boardTotalCardCount : model.summary.ownerTotal;
  return model.filter !== undefined
    ? `${visible}/${total}${board ? " active" : ""} sessions`
    : `${visible}${board ? " active" : ""} ${visible === 1 ? "session" : "sessions"}`;
}

/** Follow view is one pane, so only its hidden state is worth a header signal. */
function pinSummaryLabel(model: RenderModel): string {
  const summary = model.pinSummary;
  if (!summary?.count) return "";
  if (summary.following) return summary.hidden ? "follow view hidden" : "";
  return summary.hidden ? `${summary.count} ${summary.count === 1 ? "pin" : "pins"} hidden` : `${summary.count} pinned`;
}

interface HeaderSummary { line: string; chips: TierChip[]; quota?: { x: number; width: number } }

const BRAND = "pi hub";

/** The brand is the header's lowest priority: it shows only when mode, signals and quota leave room. */
function headerWithQuota(mode: string, right: string, model: RenderModel, width: number, styles: LayoutStyles): HeaderSummary {
  const brandWidth = displayWidth(BRAND) + 2;
  const room = width - displayWidth(mode) - displayWidth(right) - 5;
  const quota = quotaSegment(model.usage, room, model.now, styles.usageTheme);
  const brand = room - (quota ? displayWidth(quota) + 3 : 0) >= brandWidth ? `${styles.strong(BRAND)}  ` : "";
  const modeX = displayWidth(brand);
  const left = brand + styles.accent(mode) + (quota ? `   ${quota}` : "");
  return { line: headerBand(twoColumn(left, right, width), width, styles), chips: [], ...(quota ? { quota: { x: modeX + displayWidth(mode) + 3, width: displayWidth(quota) } } : {}) };
}

/** Fleet meter cells: a distinct shape per tier, so the tiers read without color. */
const METER_CELLS: Record<CockpitTier, { glyph: keyof typeof glyphs; tone: "warning" | "error" | "text" | "dim" }> = {
  "needs-you": { glyph: "running", tone: "warning" },
  health: { glyph: "error", tone: "error" },
  new: { glyph: "activeStep", tone: "text" },
  active: { glyph: "waiting", tone: "text" },
  quiet: { glyph: "pendingStep", tone: "dim" },
  archived: { glyph: "pendingStep", tone: "dim" },
};
/** A tier with more owners than this shows its glyph and count instead of one cell per owner. */
const METER_GROUP_CELLS = 10;

/**
 * The Status header's fleet meter: one cell per owner tree, grouped in tier order. Width fitting shortens
 * large groups to `glyph N`, then every group, then plain counts, then drops QUIET, ARCHIVED, ACTIVE and NEW
 * before HEALTH or NEEDS YOU. Each group's columns are its tier chip.
 */
function renderHeaderSummary(model: RenderModel, width: number, styles: LayoutStyles): HeaderSummary {
  if (model.grouping !== "project" || model.fleetGrouping !== "status" || model.pinMode) {
    return renderTopSummary(model, width, styles);
  }
  let entries = model.cockpitNavigation.filter((entry) => entry.ownerCount > 0);
  const pinLabel = pinSummaryLabel(model);
  const signals = [
    styles.muted(sessionCountLabel(model)),
    ...(pinLabel ? [styles.muted(pinLabel)] : []),
    ...(model.pinSummary?.constrained ? [styles.warning("constrained")] : []),
  ];
  const separator = styles.border(` ${glyphs.pendingStep} `);
  const shapes = [
    (count: number) => count > METER_GROUP_CELLS ? "short" : "cells",
    () => "short",
    () => "count",
  ] as const;
  let shape: (typeof shapes)[number] = shapes[0];
  const group = (entry: (typeof entries)[number]) => {
    const cell = METER_CELLS[entry.tier];
    const glyph = glyphs[cell.glyph];
    const form = shape(entry.ownerCount);
    const text = form === "cells" ? glyph.repeat(entry.ownerCount) : form === "short" ? `${glyph}${entry.ownerCount}` : `${entry.ownerCount}`;
    return styles[cell.tone](text);
  };
  const meter = () => entries.map(group).join(" ");
  const right = () => [meter(), signals.join(separator)].filter(Boolean).join(entries.length ? "  " : "");
  const fits = () => displayWidth("FLEET") + 1 + displayWidth(right()) <= width;
  for (const candidate of shapes) {
    shape = candidate;
    if (fits()) break;
  }
  for (const tier of ["quiet", "archived", "active", "new", "health", "needs-you"] as const) {
    if (fits()) break;
    entries = entries.filter((entry) => entry.tier !== tier);
  }
  if (!fits()) return renderTopSummary(model, width, styles);
  const line = right();
  let x = width - displayWidth(line);
  const chips = entries.map((entry) => {
    const chip = { tier: entry.tier, x, width: displayWidth(group(entry)) };
    x += chip.width + 1;
    return chip;
  });
  return { ...headerWithQuota("FLEET", line, model, width, styles), chips };
}

function renderTopSummary(model: RenderModel, width: number, styles: LayoutStyles): HeaderSummary {
  const board = model.grouping === "stage";
  const parentRows = model.sections.flatMap((section) => section.groups.flatMap((group) => group.sessions))
    .filter((session) => session.kind !== "subagent");
  const following = model.pinSummary?.following === true;
  const mode = model.pinMode ? following ? "FOLLOWING" : "PINNED FLEET" : board ? "WORKFLOW" : "FLEET";
  const countLabel = sessionCountLabel(model);
  const pinLabel = pinSummaryLabel(model);
  const constrained = model.pinSummary?.constrained ? styles.warning("constrained") : "";
  const needsYou = board
    ? new Set(parentRows.filter((session) => session.cockpitTier === "needs-you").map((session) => session.cockpitOwnerId)).size
    : model.cockpitNavigation.find((entry) => entry.tier === "needs-you")?.ownerCount ?? 0;
  const health = board
    ? new Set(parentRows.filter((session) => session.cockpitTier === "health").map((session) => session.cockpitOwnerId)).size
    : model.cockpitNavigation.find((entry) => entry.tier === "health")?.ownerCount ?? 0;
  const ordered = [
    styles.accent(countLabel),
    ...(pinLabel ? [styles.muted(pinLabel)] : []),
    ...(constrained ? [constrained] : []),
    ...(needsYou ? [styles.warning(`${needsYou} needs you`)] : []),
    ...(health ? [styles.error(`${health} health`)] : []),
  ];
  const required = ordered[0] ?? "";
  const needs = needsYou ? ordered.find((part) => stripAnsi(part) === `${needsYou} needs you`) : undefined;
  const candidates = [
    ordered,
    ordered.filter((part) => !stripAnsi(part).endsWith(" health")),
    [required, ...(constrained ? [constrained] : []), ...(needs ? [needs] : [])],
    [required, ...(needs ? [needs] : [])],
    [required],
  ].map((parts) => parts.join(styles.border(` ${glyphs.pendingStep} `)));
  const right = candidates.find(right => right && displayWidth(mode) + displayWidth(right) + 1 <= width);
  return right ? headerWithQuota(mode, right, model, width, styles) : { line: headerBand(truncate(styles.accent(mode), width), width, styles), chips: [] };
}

function pinnedDecisionRows(height: number | undefined): number {
  if (height === undefined || height <= 0 || height >= 24) return 6;
  if (height >= 14) return 4;
  if (height >= 10) return 3;
  if (height >= 9) return 2;
  if (height >= 8) return 1;
  return 0;
}

function renderPinnedDecisionStrip(workspace: RenderWorkspace, width: number, rows: number, now: number, styles: LayoutStyles, narrow: boolean): WorkspaceRendered {
  if (rows <= 0) return { lines: [], targets: [] };
  if (workspace.panel) return renderActionWorkspace(workspace, width, rows, now, styles, narrow);
  const rendered = renderActionWorkspace(workspace, width, Math.max(2, rows), now, styles, narrow);
  if (rows > 1) return rendered;
  const primaryId = workspace.actions[0]?.id ?? workspace.moreCommand.id;
  const index = rendered.targets.indexOf(primaryId);
  return index < 0
    ? { lines: [], targets: [] }
    : { lines: [rendered.lines[index]!], targets: [primaryId] };
}

type AdaptiveRowShape = "full-parent" | "single-parent" | "micro-child";

function adaptiveRowShape(session: RenderSession): AdaptiveRowShape {
  if (session.kind === "subagent") return "micro-child";
  return session.section === "active" ? "full-parent" : "single-parent";
}

interface SessionLineMeta {
  ownerId?: string;
  sectionOwnerIds?: string[];
  tier?: CockpitTier;
  richTree: boolean;
  treeEnd: boolean;
  commands?: { x: number; width: number; commandId: string }[];
}

interface SessionListContent {
  lines: string[];
  targets: (SessionListTarget | undefined)[];
  lineMeta: (SessionLineMeta | undefined)[];
  selectedOwnerId?: string;
  docked?: boolean;
  selectedIndex: number;
  selectedEndIndex: number;
  continuationPriorities: Map<number, number>;
  contextIndexes: Map<number, number[]>;
  priorityIndexes?: number[];
  panel?: { bodyStart: number; content: NonNullable<RenderWorkspace["panel"]>; width: number; indent: string; retainedText?: string; frame?: { focused: boolean; metadata?: string; tone: (text: string) => string; keys?: ReturnType<typeof cardKeyRows> } };
  framedCard?: NonNullable<SessionListContent["panel"]>;
  cardScrollOffset?: number;
}

/** The selected fleet module: a tone stripe down its left edge on the selection plate. */
/** The selected card's stripe: the request tone, the health tone for errors, else accent. */
function selectionTone(session: RenderSession, styles: LayoutStyles): (text: string) => string {
  return session.pendingQuestion || (styles.panel && session.attention) ? styles.warning
    : session.attention?.kind === "ready" ? styles.success
    : session.attention?.kind === "question" ? styles.warning
    : session.attention?.kind === "blocked" || session.displayStatus === "error" ? styles.error
    : styles.accent;
}

function selectedCardIdentity(session: RenderSession, width: number, terminalWidth: number, styles: LayoutStyles, repoMode: boolean) {
  const roomy = terminalWidth >= 40;
  const tone = selectionTone(session, styles);
  const contentWidth = Math.max(1, width - 2);
  // Body text aligns under the title, after the stripe and state glyph; tiny panes keep those two columns for text.
  const indent = terminalWidth < 40 ? 2 : 4;
  // Running subagents and extra repositories ride the title like on roster rows; tiny panes keep them on the metadata line.
  const counts = roomy ? cardMarkers(session, styles) : "";
  const marker = `${session.worktreeMarker ? ` ${session.worktreeMarker}` : ""}${stripAnsi(counts)}${session.unopened ? " new" : ""}`;
  const group = styles.muted(session.group);
  const state = session.attention ? attentionGlyph(session.attention.kind, styles) : styles.status(session.displayStatus, session.symbol);
  const disclosure = session.boardExpanded === undefined ? "" : `${session.boardExpanded ? glyphs.expanded : glyphs.collapsed} `;
  const prefix = `${disclosure}${state} `;
  // The age ends the title row like every other module's, when it leaves the title readable.
  const ageText = rowAge(session) ?? "";
  const age = ageText && contentWidth - displayWidth(prefix + marker) - displayWidth(ageText) - 2 >= Math.min(12, displayWidth(session.title)) ? styles.muted(ageText) : "";
  const titleRoom = contentWidth - displayWidth(prefix + marker) - (age ? displayWidth(age) + 2 : 0);
  const groupOnTop = roomy && displayWidth(session.title + group) + 2 <= titleRoom;
  // When no repo name shares its line, the branch would sit alone there; it follows the group instead,
  // without repeating the worktree marker the title already carries.
  const branchName = session.worktreeBranch ?? session.worktreeLifecycle?.repositories?.find(item => item.role === "primary" && item.state !== "cleaned")?.branch;
  const branch = branchName ? styles.muted(` ${glyphs.pendingStep} ${branchName}`) : "";
  const branchOnTop = groupOnTop && branch !== "" && !repoNameSignal(session, styles, repoMode)
    && displayWidth(session.title + group + branch) + 2 <= titleRoom;
  const title = `${prefix}${styles.strong(truncate(session.title, Math.max(1, titleRoom - (groupOnTop ? displayWidth(group) + 2 : 0))))}${styles.muted(session.worktreeMarker ? ` ${session.worktreeMarker}` : "")}${counts}${styles.muted(session.unopened ? " new" : "")}${groupOnTop ? `  ${group}` : ""}${branchOnTop ? branch : ""}`;
  const top = `${selectionMarker(tone(glyphs.selected))} ${age ? twoColumn(title, age, contentWidth) : title}`;
  // Metadata sits under the title text (after the stripe and state glyph); STEP carries workflow position.
  const metadata = inboxMetadataLine(session, Math.max(1, width - indent), terminalWidth, styles, repoMode, !groupOnTop, !branchOnTop, !roomy);
  return { top, tone, indent, metadata: stripAnsi(metadata).trim() ? metadata : undefined };
}

/**
 * `docked` renders the selected fleet session like every other row; its card then docks in a fixed strip
 * below the list, so moving the selection never moves rows.
 */
function renderSessionList(model: RenderModel, width: number, styles: LayoutStyles, spacers: boolean, dense = false, docked = false): SessionListContent {
  if (model.noMatches) {
    const lines = noMatchListLines(width, model, styles);
    return {
      lines,
      targets: lines.map(() => undefined),
      lineMeta: lines.map(() => undefined),
      selectedIndex: -1,
      selectedEndIndex: -1,
      continuationPriorities: new Map(),
      contextIndexes: new Map(),
    };
  }

  const board = model.grouping === "stage";
  const visibleSessions = model.sections.flatMap((section) => section.groups.flatMap((group) => group.sessions));
  const selectedOwnerId = visibleSessions.find((session) => session.selected)?.cockpitOwnerId;
  // Tree gutters are board-only; fleet cards group their lines with surfaces.
  const richOwners = new Set<string>();
  if (board && model.width >= 100) {
    for (const session of visibleSessions) {
      if (adaptiveRowShape(session) !== "full-parent") continue;
      const hasVisibleChild = visibleSessions.some((candidate) => candidate.kind === "subagent" && candidate.cockpitOwnerId === session.cockpitOwnerId);
      if (hasVisibleChild || adaptiveCardLines(session, Math.max(0, width - 3), styles, board, model.width).length > 0) richOwners.add(session.cockpitOwnerId);
    }
  }
  const lines: string[] = [];
  const targets: (SessionListTarget | undefined)[] = [];
  const lineMeta: (SessionLineMeta | undefined)[] = [];
  const continuationPriorities = new Map<number, number>();
  const contextIndexes = new Map<number, number[]>();
  const priorityIndexes: number[] = [];
  let selectedIndex = -1;
  let selectedEndIndex = -1;
  let panel: SessionListContent["panel"];
  const pushLine = (line: string, target?: SessionListTarget, owner?: RenderSession, meta?: SessionLineMeta) => {
    lines.push(line);
    targets.push(target);
    lineMeta.push(meta ?? (owner ? {
      ownerId: owner.cockpitOwnerId,
      tier: owner.cockpitTier,
      richTree: richOwners.has(owner.cockpitOwnerId),
      treeEnd: false,
    } : undefined));
  };
  let gridWorkflow: WorkflowRuntimeSnapshot | undefined;
  const gridGap = !board && !model.pinMode || model.width <= NARROW_LAYOUT_MAX_WIDTH ? " " : "  ";
  const shortRows = !board && model.width < 100 && model.height !== undefined && model.height > 0 && model.height < SHORT_FLEET_HEIGHT;
  const pushRow = (session: RenderSession, siblings: RenderSession[], index: number, context: number[] = []) => {
    // Text on the selection plate reads at muted or stronger.
    const rowStyles = session.cockpitOwnerId === selectedOwnerId ? { ...styles, dim: styles.muted } : styles;
    if (session.selected) selectedIndex = lines.length;
    const shape = adaptiveRowShape(session);
    const childLast = shape === "micro-child"
      ? !siblings.slice(index + 1).some((candidate) => candidate.kind === "subagent" && candidate.parentId === session.parentId)
      : false;
    const gutterColumn = model.width >= 100 && !model.pinMode;
    const titleFirst = !board && shape === "full-parent";
    const inbox = !board && !model.pinMode;
    // Roster rows name their own step; only board and pin rows sit under a shared grid.
    const cell = (titleFirst && !inbox) || board ? fleetWorkflowCell(session, rowStyles, gridWorkflow, gridGap) : undefined;
    const workspace = session.selected && model.workspace?.session.id === session.id ? model.workspace : undefined;
    const frame = inbox && session.selected && shape !== "micro-child" && !docked
      ? selectedCardIdentity(session, width, model.width, rowStyles, model.fleetGrouping === "repo") : undefined;
    const indent = frame ? " ".repeat(frame.indent) : gutterColumn ? "   " : "  ";
    const contentWidth = Math.max(1, width - indent.length);
    const rowStart = lines.length;
    let keyRows: ReturnType<typeof cardKeyRows> | undefined;
    let keyStart = -1;
    const inline = inbox && session.selected && !docked;
    const oneLine = titleFirst && (shortRows || (dense && (docked || session.cockpitOwnerId !== selectedOwnerId))) && !inline;
    // Fleet parents are modules; only an inline selected card replaces its module with the full card.
    const card = titleFirst && inbox && !inline;
    const row = renderSessionRow(session, width, rowStyles, { board, repoMode: model.fleetGrouping === "repo" && !board, terminalWidth: model.width, childLast, gutterColumn, titleFirst, oneLine: oneLine || card, card, workflowCell: cell });
    pushLine(frame?.top ?? row, { kind: "session", id: session.id }, session);
    contextIndexes.set(lines.length - 1, context);
    if (frame?.metadata) {
      pushLine(`${indent}${frame.metadata}`, { kind: "session-continuation", id: session.id }, session);
      continuationPriorities.set(lines.length - 1, -1);
    } else if (frame) {
      // The card's title row carries everything the metadata line would show.
    } else if (card) {
      if (!oneLine && !model.compactRows) {
        // Detail lines start under the state glyph.
        const detailIndent = gutterColumn ? 5 : 4;
        for (const detail of rosterLines(session, Math.max(1, width - detailIndent), rowStyles, model.width)) {
          pushLine(`${" ".repeat(detailIndent)}${detail.line}`, { kind: "session-continuation", id: session.id }, session);
          continuationPriorities.set(lines.length - 1, detail.priority);
        }
      }
    } else if (titleFirst && cell && (!oneLine || (shortRows && session.selected))) {
      const metadataCell = oneLine ? { ...cell, right: "" } : cell;
      // Without card lines, the metadata line is the only place a differing repo name can appear.
      const repoInline = model.width < 100 || model.compactRows || oneLine;
      pushLine(`${indent}${fleetMetadataLine(session, width - indent.length, rowStyles, metadataCell, model.fleetGrouping === "repo", repoInline)}`, { kind: "session-continuation", id: session.id }, session);
      continuationPriorities.set(lines.length - 1, -1);
    }
    if (shape === "full-parent" && !model.compactRows && !oneLine && !card) {
      const hideFocusedQuestion = session.selected && model.workspace?.session.id === session.id && model.workspace.panel?.kind === "answer";
      const replying = session.selected && model.workspace?.session.id === session.id && Boolean(model.workspace.panel);
      for (const continuation of adaptiveCardLines(session, contentWidth, rowStyles, board, model.width, inbox, hideFocusedQuestion, model.now, replying)) {
        pushLine(`${frame ? indent : styles.border(indent)}${continuation.line}`, { kind: "session-continuation", id: session.id }, session);
        continuationPriorities.set(lines.length - 1, continuation.priority);
      }
    }
    if (inline && model.workspace?.session.id === session.id) {
      const workspace = model.workspace;
      const append = (line: string) => pushLine(`${indent}${truncate(line, contentWidth)}`, { kind: "session-continuation", id: session.id }, session);
      const blocks = actionWorkspaceBlocks(workspace, contentWidth, model.now, rowStyles);
      for (const block of blocks) {
        if (["closure", "guidance"].includes(block.key) || (shape !== "full-parent" && ["request", "receipt", "task"].includes(block.key))) {
          // The card's ERR field already states the error; guidance adds only what to do about it.
          const lines = block.key === "guidance" && shape === "full-parent" ? (workspace.guidance ? wrapWords(workspace.guidance, contentWidth, contentWidth) : []) : block.lines;
          for (const line of lines) append(line);
        }
      }
      if (!workspace.panel) {
        keyRows = cardKeyRows(workspace, contentWidth, rowStyles, Boolean(frame));
        keyStart = lines.length;
        for (const keys of keyRows) {
          append(keys.line);
          lineMeta[lines.length - 1]!.commands = keys.hits.map(hit => ({ ...hit, x: hit.x + indent.length }));
        }
      }
      if (workspace.evidenceVisible) {
        for (const block of blocks) {
          const detail = block.key === "identity" ? block.lines.slice(1, -1) : block.key === "workflow" || block.key === "lifecycle" ? block.lines : [];
          for (const line of detail) append(line);
        }
        for (const line of workspaceEvidenceLines(workspace, contentWidth, model.now, rowStyles)) append(line);
      }
      if (workspace.panel) {
        const bodyStart = lines.length;
        for (const line of workspace.panel.body) append(typeof line === "string" ? line : renderCursorValue(line.value, line.cursor, Math.max(1, width - indent.length), "start"));
        for (const line of workspace.panel.keyLine.split("\n")) append(line);
        panel = { bodyStart, content: workspace.panel, width, indent,
          ...(workspace.session.deliveryResult ? { retainedText: plainAttentionText(workspace.session.deliveryResult) } : {}) };
      }
    }
    if (frame) {
      const bodyStart = rowStart + (frame.metadata ? 2 : 1);
      const prefix = lines.slice(bodyStart, panel?.bodyStart ?? lines.length).flatMap((line, index) => {
        const originalIndex = bodyStart + index;
        return keyStart >= 0 && originalIndex >= keyStart && originalIndex < keyStart + (keyRows?.length ?? 0) ? [] : [sliceByColumn(line, indent.length, width)];
      });
      const focused = workspace?.panel;
      // The panel's own rows come first: context above it gives way from its end when the pane is short.
      if (focused && model.height) {
        const own = renderFocusedPanel("", [], focused, width, undefined, rowStyles, indent).lines.length;
        const room = Math.max(0, model.height - 3 - own - (frame.metadata ? 1 : 0));
        if (prefix.length > room) prefix.length = room;
      }
      if (focused && session.deliveryResult) {
        const receipt = stripAnsi(truncate(plainAttentionText(session.deliveryResult), contentWidth)).trim();
        const index = prefix.findIndex(line => stripAnsi(line).trim() === receipt);
        if (index >= 0) prefix.splice(index, 1);
      }
      // A rule sets the question or reply apart from the context kept above it.
      if (focused && prefix.length) {
        const head = focused.kind === "answer" ? `${rowStyles.dim(glyphs.horizontal.repeat(2))} ${rowStyles.warning("ASK")} ` : "";
        prefix.push(`${head}${rowStyles.dim(glyphs.horizontal.repeat(Math.max(0, contentWidth - displayWidth(head))))}`);
      }
      panel = { bodyStart, width, indent, frame: { focused: Boolean(workspace?.panel), metadata: frame.metadata, tone: frame.tone, keys: keyRows },
        content: focused ? { ...focused, body: [...prefix, ...focused.body],
          hangingIndents: [...prefix.map(() => 0), ...(focused.hangingIndents ?? focused.body.map(() => 0))],
          focusRows: focused.focusRows?.map(index => index + prefix.length), proseFrom: prefix.length }
          : { body: prefix.length ? prefix : [""], keyLine: keyRows?.filter(row => row.plain).map(row => row.plain).join("\n") ?? "Enter Open in Pi", offset: model.cardScrollOffset ?? 0 },
        ...(focused && session.deliveryResult ? { retainedText: plainAttentionText(session.deliveryResult) } : {}) };
      for (let index = rowStart; index < lines.length; index++) lineMeta[index] = { ...lineMeta[index]!, richTree: false };
    }
    if (docked && inbox && session.selected) {
      // The docked selection keeps its module's rows and only gains the card's stripe.
      const stripe = cardStripe(selectionTone(session, rowStyles));
      for (let index = rowStart; index < lines.length; index++) lines[index] = `${stripe}${sliceByColumn(lines[index]!, 1, width)}`;
    }
    if (session.selected) selectedEndIndex = lines.length - 1;
  };
  const releaseCue = model.guidance.releaseCue;
  let releaseCueRendered = false;
  const pushReleaseCue = () => {
    if (!releaseCue || releaseCueRendered) return;
    const prefix = releaseCue.selected ? `${styles.accent(glyphs.selected)} ` : "  ";
    const copy = [styles.accent(`${releaseCue.label} ${glyphs.pendingStep} Enter Dismiss`),
      ...releaseCue.text.split("\n").flatMap(line => wrapWords(line, Math.max(1, width - 2), Math.max(1, width - 2))).map(styles.muted)];
    if (lines.length) pushLine("");
    if (releaseCue.selected) {
      selectedIndex = lines.length;
      selectedEndIndex = lines.length;
    }
    for (const [index, line] of copy.entries()) pushLine(`${index === 0 ? prefix : "  "}${truncate(line, Math.max(0, width - 2))}`, { kind: "release-cue" });
    if (releaseCue.selected) selectedEndIndex = lines.length - 1;
    releaseCueRendered = true;
  };
  let firstSection = true;
  if (releaseCue && model.sections[0]?.cockpitTier !== "needs-you") pushReleaseCue();
  for (const section of model.sections) {
    if (!firstSection) pushLine("");
    // Board and pin rows sit under a shared grid from 40 columns; roster rows name their own step.
    gridWorkflow = (!board && !model.pinMode) || model.width < 40 ? undefined : board ? section.gridWorkflow : section.groups.flatMap((group) => group.sessions)
      .find((session) => adaptiveRowShape(session) === "full-parent" && session.workflow)?.workflow;
    const headingTitle = board || section.cockpitTier ? `${section.title} ${section.sessionsTotal}` : section.title;
    const headingRight = board
      ? ""
      : section.repoKey
        ? [
          styles.muted(section.sessionsVisible !== undefined && section.sessionsVisible !== section.sessionsTotal
            ? `${section.sessionsVisible}/${section.sessionsTotal}` : `${glyphs.pendingStep}${section.sessionsTotal}`),
          ...(section.ownerAttentionCount ? [styles.warning(`${section.ownerAttentionCount} needs you`)] : []),
          ...(section.hiddenChildRequestCount ? [styles.warning(`?${section.hiddenChildRequestCount} child`)] : []),
        ].join(styles.border(` ${glyphs.pendingStep} `))
        : cockpitHeadingRight(section, displayWidth(headingTitle), width, styles);
    if (gridWorkflow) {
      const headingWidth = board ? displayWidth(headingTitle) + 4 : section.cockpitTier ? displayWidth(headingTitle) + 3 : Math.min(20, displayWidth(headingTitle) + 4);
      const rightWidth = (headingRight ? displayWidth(headingRight) + 2 : 0) + displayWidth(workflowGridHeader(gridWorkflow, gridGap));
      if (headingWidth + 1 + rightWidth > width) gridWorkflow = undefined;
    }
    const sectionHeadingIndex = lines.length;
    const headerTarget = section.repoKey
      ? { kind: "repo-header" as const, repoKey: section.repoKey }
      : section.collapsible && section.cockpitTier && !alwaysExpanded(section.cockpitTier)
        ? { kind: "section-header" as const, section: section.cockpitTier }
        : undefined;
    if (section.selected) {
      selectedIndex = lines.length;
      selectedEndIndex = lines.length;
    }
    const sectionOwnerIds = [...new Set(section.groups.flatMap((group) => group.sessions.map((session) => session.cockpitOwnerId)))];
    pushLine(
      board
        ? sectionHeader(headingTitle, gridWorkflow ? [headingRight, styles.muted(workflowGridHeader(gridWorkflow, gridGap))].filter(Boolean).join("  ") : headingRight, width, styles, section.collapsible ? section.collapsed : undefined, section.selected, "active", false, true)
        : fleetSectionHeader(section.title, section.repoKey === undefined && section.cockpitTier ? section.sessionsTotal : undefined, gridWorkflow ? [headingRight, styles.muted(workflowGridHeader(gridWorkflow, gridGap))].filter(Boolean).join("  ") : headingRight, width, styles, section.collapsible ? section.collapsed : undefined, section.selected, section.cockpitTier),
      headerTarget,
      undefined,
      { sectionOwnerIds, tier: section.cockpitTier, richTree: false, treeEnd: false },
    );
    if (model.guidance.coach && model.empty && section.cockpitTier === "needs-you") priorityIndexes.push(sectionHeadingIndex);
    if (section.lesson) pushLine(`  ${styles.muted(truncate(section.lesson, Math.max(0, width - 2)))}`);
    firstSection = false;
    for (const [groupIndex, group] of section.groups.entries()) {
      if (groupIndex && model.width >= 100) pushLine("");
      let groupHeadingIndex: number | undefined;
      if (board && model.width >= 100) {
        groupHeadingIndex = lines.length;
        pushLine(twoColumn(`   ${styles.muted(group.name)}`, group.attentionCount ? styles.warning(`?${group.attentionCount}`) : "", width));
      }
      const context = [sectionHeadingIndex, ...(groupHeadingIndex === undefined ? [] : [groupHeadingIndex])];
      const cardSpacers = spacers && model.width >= 100 && !board && !model.compactRows && moduleTier(section.cockpitTier ?? "quiet");
      let parentSeen = false;
      for (const [index, session] of group.sessions.entries()) {
        if (adaptiveRowShape(session) === "full-parent") {
          if (cardSpacers && parentSeen) pushLine("");
          parentSeen = true;
        }
        pushRow(session, group.sessions, index, context);
      }
    }
    if (section.cockpitTier === "needs-you") pushReleaseCue();
    if (section.archiveDisclosure) {
      if (section.archiveDisclosure.selected) {
        selectedIndex = lines.length;
        selectedEndIndex = lines.length;
      }
      const label = section.archiveDisclosure.expanded ? `${glyphs.fewer} show fewer` : `${glyphs.ellipsis} ${section.archiveDisclosure.hiddenParents} older archived`;
      const prefix = section.archiveDisclosure.selected ? `${styles.accent(glyphs.selected)} ` : "  ";
      pushLine(`${prefix}${styles.muted(truncate(label, Math.max(0, width - 2)))}`, { kind: "archive-disclosure" });
      contextIndexes.set(lines.length - 1, [sectionHeadingIndex]);
    }
  }
  pushReleaseCue();
  if (model.guidance.coach && model.empty) {
    pushLine("");
    priorityIndexes.push(lines.length);
    pushLine(`${styles.accent(glyphs.primary)} ${styles.accent("n")}  create the first managed Pi session`);
    priorityIndexes.push(lines.length);
    pushLine(`${styles.accent("Enter")} Open ${glyphs.pendingStep} ${styles.accent("Ctrl+Q")} Return ${glyphs.pendingStep} ${styles.accent("?")} Keys ${glyphs.pendingStep} ${styles.accent(":")} Actions`);
  }
  if (board) {
    pushLine("");
    pushLine(boardHiddenSummary(model, width, styles));
  }
  const lastLineByOwner = new Map<string, number>();
  for (const [index, meta] of lineMeta.entries()) {
    if (meta?.richTree && meta.ownerId) lastLineByOwner.set(meta.ownerId, index);
  }
  for (const index of lastLineByOwner.values()) {
    const meta = lineMeta[index];
    if (meta) meta.treeEnd = true;
  }
  const result: SessionListContent = { lines, targets, lineMeta, panel, docked, ...(!board && !model.pinMode ? { cardScrollOffset: model.cardScrollOffset ?? 0 } : {}), ...(selectedOwnerId ? { selectedOwnerId } : {}), selectedIndex, selectedEndIndex, continuationPriorities, contextIndexes,
    ...(priorityIndexes.length ? { priorityIndexes } : {}) };
  if (panel?.frame && !panel.frame.focused) {
    const rendered = windowPanel(result, undefined, styles);
    const delta = rendered.lines.length - (selectedEndIndex - selectedIndex + 1);
    const shift = (index: number) => index > selectedEndIndex ? index + delta : index;
    return { ...result, panel: undefined, framedCard: panel,
      lines: [...lines.slice(0, selectedIndex), ...rendered.lines, ...lines.slice(selectedEndIndex + 1)],
      targets: [...targets.slice(0, selectedIndex), ...rendered.targets, ...targets.slice(selectedEndIndex + 1)],
      lineMeta: [...lineMeta.slice(0, selectedIndex), ...rendered.lineMeta, ...lineMeta.slice(selectedEndIndex + 1)],
      selectedEndIndex: selectedEndIndex + delta,
      continuationPriorities: new Map([...continuationPriorities].filter(([index]) => index < selectedIndex || index > selectedEndIndex).map(([index, priority]): [number, number] => [shift(index), priority]).concat([[selectedIndex + 1, -1]])),
      contextIndexes: new Map([...contextIndexes].filter(([index]) => index <= selectedIndex || index > selectedEndIndex).map(([index, context]) => [shift(index), context.map(shift)])),
      priorityIndexes: priorityIndexes.map(shift) };
  }
  return result;
}

/** Every non-archived tier renders instrument-panel modules; archived rows stay one line. */
function moduleTier(tier: CockpitTier): boolean {
  return tier !== "archived";
}

function decorateTreeGutter(line: string, meta: SessionLineMeta | undefined, styles: LayoutStyles): string {
  if (!meta?.richTree) return line;
  const glyph = meta.treeEnd ? glyphs.treeEnd : glyphs.vertical;
  const styled = meta.tier === "needs-you" ? styles.warning(glyph) : styles.border(glyph);
  return replaceVisibleColumn(line, 1, styled);
}

function replaceVisibleColumn(value: string, column: number, replacement: string): string {
  let visible = 0;
  for (let index = 0; index < value.length;) {
    if (value[index] === "\u001b" && value[index + 1] === "[") {
      const end = value.indexOf("m", index + 2);
      if (end < 0) return value;
      index = end + 1;
      continue;
    }
    const char = String.fromCodePoint(value.codePointAt(index)!);
    const width = displayWidth(char);
    if (width > 0 && visible === column) return `${value.slice(0, index)}${replacement}${value.slice(index + char.length)}`;
    visible += width;
    index += char.length;
  }
  return value;
}

function noMatchListLines(width: number, model: RenderModel, styles: LayoutStyles): string[] {
  const controls = model.filterEditing ? `Enter Apply ${glyphs.pendingStep} Esc Cancel` : `/ Edit ${glyphs.pendingStep} Esc Clear`;
  return [styles.warning("No sessions match."), "", `${styles.warning(glyphs.primary)} ${controls}`, ""]
    .map((line) => truncate(line, width));
}

function boardHiddenSummary(model: RenderModel, width: number, styles: LayoutStyles): string {
  const parts = [
    model.boardHidden.nonActive ? `${model.boardHidden.nonActive} backlog/archived` : "",
    "S Fleet",
  ].filter(Boolean);
  return styles.muted(truncate(parts.join(` ${glyphs.pendingStep} `), width));
}

interface ListWindow {
  panelViewport?: PanelViewport;
  lines: string[];
  targets: (SessionListTarget | undefined)[];
  lineMeta: (SessionLineMeta | undefined)[];
  selectedIndex: number;
  selectedEndIndex: number;
  top: number;
}

function windowList(list: SessionListContent, capacity: number, scrollTop: number, styles: LayoutStyles): ListWindow {
  const safeCapacity = Math.max(1, capacity);
  if (list.panel) {
    const full = windowPanel(list, undefined, styles);
    const replacedLength = list.selectedEndIndex - list.selectedIndex + 1;
    if (list.lines.length - replacedLength + full.lines.length > safeCapacity) return windowPanel(list, safeCapacity, styles);
    return { ...full, lines: [...list.lines.slice(0, list.selectedIndex), ...full.lines, ...list.lines.slice(list.selectedEndIndex + 1)],
      targets: [...list.targets.slice(0, list.selectedIndex), ...full.targets, ...list.targets.slice(list.selectedEndIndex + 1)],
      lineMeta: [...list.lineMeta.slice(0, list.selectedIndex), ...full.lineMeta, ...list.lineMeta.slice(list.selectedEndIndex + 1)],
      selectedIndex: list.selectedIndex, selectedEndIndex: list.selectedIndex + full.lines.length - 1, top: 0 };
  }
  if (list.lines.length <= safeCapacity) return { ...list, top: 0 };
  if (list.selectedIndex < 0) {
    const chosen = new Set((list.priorityIndexes ?? []).slice(0, safeCapacity));
    const tierHeadings = list.lineMeta.flatMap((meta, index) => meta?.sectionOwnerIds ? [index] : []);
    const usefulRows = list.lines.flatMap((line, index) => displayWidth(line) > 0 ? [index] : []);
    for (const index of [...tierHeadings, ...usefulRows]) {
      if (chosen.size >= safeCapacity) break;
      chosen.add(index);
    }
    const indexes = [...chosen].sort((left, right) => left - right);
    return {
      lines: indexes.map((index) => list.lines[index] ?? ""),
      targets: indexes.map((index) => list.targets[index]),
      lineMeta: indexes.map((index) => list.lineMeta[index]),
      selectedIndex: -1,
      selectedEndIndex: -1,
      top: indexes[0] ?? 0,
    };
  }
  return windowFilledSelectedSpan(list, safeCapacity, scrollTop, styles);
}

/** A line cut after the card's stripe still opens in the stripe's color; reset it before the first cell. */
function withoutStripeTone(line: string): string {
  return line.replace(/^((?:\u001b\[[0-9;:]*m)*)/u, "$1\u001b[39m");
}

function cardStripe(tone: (text: string) => string): string {
  return selectionMarker(tone(glyphs.selected));
}

function windowPanel(list: SessionListContent, capacity: number | undefined, styles: LayoutStyles): ListWindow {
  const panel = list.panel!;
  const context = panel.frame ? [] : list.lines.slice(list.selectedIndex + 1, panel.bodyStart);
  const retainedLine = panel.retainedText
    ? stripAnsi(truncate(panel.retainedText, Math.max(1, panel.width - panel.indent.length)))
    : undefined;
  const optionalContext = retainedLine ? context.filter((line) => stripAnsi(line).trim() !== retainedLine) : context;
  const retained = panel.retainedText ? [styles.accent(panel.retainedText)] : [];
  const rendered = renderFocusedPanel(list.lines[list.selectedIndex]!, optionalContext, panel.content,
    panel.width, capacity === undefined ? undefined : capacity - (panel.frame?.metadata ? 1 : 0), styles, panel.indent, retained);
  if (panel.frame && !rendered.fallback) {
    rendered.lines[0] = list.lines[list.selectedIndex]!;
    if (panel.frame.metadata) rendered.lines.splice(1, 0, panel.indent + panel.frame.metadata);
    const stripe = cardStripe(panel.frame.tone);
    rendered.lines = rendered.lines.map((line, index) => index ? `${stripe}${sliceByColumn(line, 1, panel.width)}` : line);
  }
  const id = list.targets[list.selectedIndex];
  const ownerId = id && "id" in id ? id.id : undefined;
  const meta = list.lineMeta[list.selectedIndex];
  return { lines: rendered.lines, targets: rendered.lines.map((_, index) => index === 0 ? id : ownerId ? { kind: "session-continuation", id: ownerId } : undefined),
    lineMeta: rendered.lines.map((_, index) => meta ? { ...meta, treeEnd: index === rendered.lines.length - 1 && Boolean(list.lineMeta[list.selectedEndIndex]?.treeEnd),
      commands: rendered.fallback && ownerId ? [{ x: 0, width: 16, commandId: `action:${ownerId}:open` }]
        : panel.frame?.keys && index >= rendered.lines.length - panel.frame.keys.length
          ? panel.frame.keys[index - (rendered.lines.length - panel.frame.keys.length)]!.hits.map(hit => ({ ...hit, x: hit.x + panel.indent.length }))
          : undefined } : undefined),
    selectedIndex: 0, selectedEndIndex: rendered.lines.length - 1, top: list.selectedIndex, panelViewport: rendered.panelViewport };
}

function windowFilledSelectedSpan(list: SessionListContent, capacity: number, scrollTop: number, styles: LayoutStyles): ListWindow {
  const safeCapacity = Math.max(1, capacity);
  if (list.lines.length <= safeCapacity) return { ...list, top: 0 };
  // A docked list gives every module the same detail budget, including the selected one.
  const requiredLength = (index: number): number => list.continuationPriorities.get(index + 1) === -1 ? 2 : 1;
  const selectedLength = list.docked ? requiredLength(list.selectedIndex) : list.selectedEndIndex - list.selectedIndex + 1;
  if (selectedLength >= safeCapacity) return windowSelectedCard(list, safeCapacity, styles);

  const beforeIndexes = list.targets.flatMap((target, index) => target?.kind === "session" && index < list.selectedIndex ? [index] : []);
  const afterIndexes = list.targets.flatMap((target, index) => target?.kind === "session" && index > list.selectedEndIndex ? [index] : []);
  // Negative-priority metadata belongs to the title, not the optional card details.
  const titleLimit = Math.max(0, safeCapacity - selectedLength);
  let beforeRows = 0;
  let best: { before: number; after: number; distance: number; contexts: Set<number> } | undefined;
  const beforeContexts = new Set(list.contextIndexes.get(list.selectedIndex) ?? []);
  for (let before = 0; before <= Math.min(beforeIndexes.length, titleLimit); before += 1) {
    if (before) {
      const titleIndex = beforeIndexes[beforeIndexes.length - before]!;
      beforeRows += requiredLength(titleIndex);
      for (const contextIndex of list.contextIndexes.get(titleIndex) ?? []) beforeContexts.add(contextIndex);
    }
    const contexts = new Set(beforeContexts);
    let afterRows = 0;
    for (let after = 0; after <= Math.min(afterIndexes.length, titleLimit - before); after += 1) {
      if (after) {
        const titleIndex = afterIndexes[after - 1]!;
        afterRows += requiredLength(titleIndex);
        for (const contextIndex of list.contextIndexes.get(titleIndex) ?? []) contexts.add(contextIndex);
      }
      if (selectedLength + beforeRows + afterRows + contexts.size > safeCapacity) continue;
      const firstIndex = before ? beforeIndexes[beforeIndexes.length - before]! : list.selectedIndex;
      const distance = Math.abs(firstIndex - scrollTop);
      const shown = before + after;
      const bestShown = (best?.before ?? 0) + (best?.after ?? 0);
      const balance = Math.abs(before - after);
      const bestBalance = best ? Math.abs(best.before - best.after) : Number.POSITIVE_INFINITY;
      if (!best || shown > bestShown || (shown === bestShown && balance < bestBalance) || (shown === bestShown && balance === bestBalance && distance < best.distance)) {
        best = { before, after, distance, contexts: new Set(contexts) };
      }
    }
  }
  if (!best) {
    const availableContext = Math.max(0, safeCapacity - selectedLength);
    const selectedContext = (list.contextIndexes.get(list.selectedIndex) ?? []).slice(-availableContext);
    const selectedIndex = selectedContext.length;
    return {
      lines: [...selectedContext.map((index) => list.lines[index] ?? ""), ...list.lines.slice(list.selectedIndex, list.selectedEndIndex + 1)],
      targets: [...selectedContext.map(() => undefined), ...list.targets.slice(list.selectedIndex, list.selectedEndIndex + 1)],
      lineMeta: [...selectedContext.map(() => undefined), ...list.lineMeta.slice(list.selectedIndex, list.selectedEndIndex + 1)],
      selectedIndex,
      selectedEndIndex: selectedIndex + selectedLength - 1,
      top: selectedContext[0] ?? list.selectedIndex,
    };
  }

  const shownBefore = beforeIndexes.slice(beforeIndexes.length - best.before);
  const shownAfter = afterIndexes.slice(0, best.after);
  const hiddenBefore = beforeIndexes.length - shownBefore.length;
  const hiddenAfter = afterIndexes.length - shownAfter.length;
  const coreRows = selectedLength + [...shownBefore, ...shownAfter].reduce((sum, index) => sum + requiredLength(index), 0) + best.contexts.size;
  let remaining = safeCapacity - coreRows;
  let beforeIndicator = false;
  let afterIndicator = false;
  if (remaining > 0 && hiddenBefore && hiddenAfter) {
    if (remaining > 1) {
      beforeIndicator = true;
      afterIndicator = true;
      remaining -= 2;
    } else if (hiddenBefore >= hiddenAfter) {
      beforeIndicator = true;
      remaining -= 1;
    } else {
      afterIndicator = true;
      remaining -= 1;
    }
  } else if (remaining > 0 && hiddenBefore) {
    beforeIndicator = true;
    remaining -= 1;
  } else if (remaining > 0 && hiddenAfter) {
    afterIndicator = true;
    remaining -= 1;
  }

  const continuationCandidates = [...shownBefore, ...(list.docked ? [list.selectedIndex] : []), ...shownAfter].flatMap((ownerIndex) => {
    const distance = ownerIndex < list.selectedIndex ? list.selectedIndex - ownerIndex : ownerIndex - list.selectedEndIndex;
    const candidates: { index: number; distance: number; priority: number }[] = [];
    for (let index = ownerIndex + 1; list.continuationPriorities.has(index); index += 1) {
      const priority = list.continuationPriorities.get(index) ?? 99;
      if (priority >= 0) candidates.push({ index, distance, priority });
    }
    return candidates;
  // Requests and faults first, then live work and quiet notes; docked roster allocation stays independent of selection.
  }).sort((a, b) => Math.min(a.priority, 2) - Math.min(b.priority, 2) || (list.docked ? 0 : a.distance - b.distance) || a.priority - b.priority || a.index - b.index);
  const keptContinuations = new Set(continuationCandidates.slice(0, remaining).map((candidate) => candidate.index));
  const emittedContexts = new Set<number>();
  const rowsForTitle = (titleIndex: number, includeSelectedSpan = false) => {
    const rows = (list.contextIndexes.get(titleIndex) ?? []).filter((index) => !emittedContexts.has(index));
    for (const index of rows) emittedContexts.add(index);
    if (includeSelectedSpan && !list.docked) return [...rows, ...Array.from({ length: selectedLength }, (_, offset) => list.selectedIndex + offset)];
    rows.push(titleIndex);
    for (let index = titleIndex + 1; list.continuationPriorities.has(index); index += 1) {
      if (list.continuationPriorities.get(index) === -1 || keptContinuations.has(index)) rows.push(index);
    }
    return rows;
  };
  const beforeSourceRows = shownBefore.flatMap((index) => rowsForTitle(index));
  const selectedRows = rowsForTitle(list.selectedIndex, true);
  const afterRows = shownAfter.flatMap((index) => rowsForTitle(index));
  const sourceRows = [...beforeSourceRows, ...selectedRows, ...afterRows];
  const lines = [
    ...(beforeIndicator ? [styles.muted(`${glyphs.up} ${hiddenBefore} more`)] : []),
    ...sourceRows.map((index) => list.lines[index] ?? ""),
    ...(afterIndicator ? [styles.muted(`${glyphs.down} ${hiddenAfter} more`)] : []),
  ];
  const targets = [
    ...(beforeIndicator ? [undefined] : []),
    ...sourceRows.map((index) => list.targets[index]),
    ...(afterIndicator ? [undefined] : []),
  ];
  const lineMeta = [
    ...(beforeIndicator ? [undefined] : []),
    ...sourceRows.map((index) => list.lineMeta[index]),
    ...(afterIndicator ? [undefined] : []),
  ];
  const selectedIndex = (beforeIndicator ? 1 : 0) + sourceRows.indexOf(list.selectedIndex);
  return {
    lines,
    targets,
    lineMeta,
    selectedIndex,
    selectedEndIndex: (beforeIndicator ? 1 : 0) + sourceRows.indexOf(selectedRows.at(-1)!),
    top: sourceRows[0] ?? list.selectedIndex,
  };
}

function windowSelectedCard(list: SessionListContent, capacity: number, styles: LayoutStyles): ListWindow {
  if (list.framedCard) return windowPanel({ ...list, panel: list.framedCard }, capacity, styles);
  const safeCapacity = Math.max(1, capacity);
  if (list.cardScrollOffset !== undefined) {
    const keyRow = list.lineMeta.findIndex((meta, index) => index >= list.selectedIndex && index <= list.selectedEndIndex && meta?.commands?.length);
    const body = Array.from({ length: list.selectedEndIndex - list.selectedIndex }, (_, index) => list.selectedIndex + index + 1).filter(index => index !== keyRow);
    const bodyCapacity = Math.max(0, safeCapacity - 1 - (keyRow >= 0 && safeCapacity > 1 ? 1 : 0));
    const offset = Math.min(list.cardScrollOffset, Math.max(0, body.length - bodyCapacity));
    const indexes = [list.selectedIndex, ...body.slice(offset, offset + bodyCapacity), ...(keyRow >= 0 && safeCapacity > 1 ? [keyRow] : [])];
    return { lines: indexes.map(index => list.lines[index]!), targets: indexes.map(index => list.targets[index]), lineMeta: indexes.map(index => list.lineMeta[index]), selectedIndex: 0, selectedEndIndex: indexes.length - 1, top: list.selectedIndex };
  }
  if (list.lines.length <= safeCapacity) return { ...list, top: 0 };

  const headerIndex = list.selectedIndex;
  const footerIndex = list.selectedEndIndex;
  const preserveFooter = list.continuationPriorities.get(headerIndex + 1) !== -1;
  if (safeCapacity === 1) {
    return { lines: [list.lines[headerIndex] ?? ""], targets: [list.targets[headerIndex]], lineMeta: [list.lineMeta[headerIndex]], selectedIndex: 0, selectedEndIndex: 0, top: headerIndex };
  }

  const beforeCount = list.targets.slice(0, headerIndex).filter((target) => target?.kind === "session").length;
  const afterCount = list.targets.slice(footerIndex + 1).filter((target) => target?.kind === "session").length;
  const indicators = [
    ...(beforeCount ? [{ side: "before" as const, line: styles.muted(`${glyphs.up} ${beforeCount} more`) }] : []),
    ...(afterCount ? [{ side: "after" as const, line: styles.muted(`${glyphs.down} ${afterCount} more`) }] : []),
  ];
  const detailIndexes = Array.from(
    { length: Math.max(0, footerIndex - headerIndex - (preserveFooter ? 1 : 0)) },
    (_, offset) => headerIndex + offset + 1,
  ).sort((a, b) => (list.continuationPriorities.get(a) ?? 99) - (list.continuationPriorities.get(b) ?? 99) || a - b);

  const available = safeCapacity - (preserveFooter ? 2 : 1);
  const coreDetailCount = Math.min(2, detailIndexes.length, available);
  const indicatorCount = Math.min(indicators.length, available - coreDetailCount);
  const detailCount = Math.min(detailIndexes.length, available - indicatorCount);
  const keptDetails = new Set(detailIndexes.slice(0, detailCount));
  const keptIndicators = indicators.slice(0, indicatorCount);
  const beforeIndicator = keptIndicators.find((indicator) => indicator.side === "before");
  const afterIndicator = keptIndicators.find((indicator) => indicator.side === "after");
  const orderedDetails = Array.from(keptDetails).sort((a, b) => a - b);

  const lines = [
    ...(beforeIndicator ? [beforeIndicator.line] : []),
    list.lines[headerIndex] ?? "",
    ...orderedDetails.map((index) => list.lines[index] ?? ""),
    ...(preserveFooter ? [list.lines[footerIndex] ?? ""] : []),
    ...(afterIndicator ? [afterIndicator.line] : []),
  ];
  const targets = [
    ...(beforeIndicator ? [undefined] : []),
    list.targets[headerIndex],
    ...orderedDetails.map((index) => list.targets[index]),
    ...(preserveFooter ? [list.targets[footerIndex]] : []),
    ...(afterIndicator ? [undefined] : []),
  ];
  const lineMeta = [
    ...(beforeIndicator ? [undefined] : []),
    list.lineMeta[headerIndex],
    ...orderedDetails.map((index) => list.lineMeta[index]),
    ...(preserveFooter ? [list.lineMeta[footerIndex]] : []),
    ...(afterIndicator ? [undefined] : []),
  ];
  const selectedIndex = beforeIndicator ? 1 : 0;
  return {
    lines,
    targets,
    lineMeta,
    selectedIndex,
    selectedEndIndex: selectedIndex + orderedDetails.length + (preserveFooter ? 1 : 0),
    top: headerIndex,
  };
}

export function workflowStepMarker(workflow: WorkflowRuntimeSnapshot, index: number): string {
  const done = index < workflow.activeIndex
    || (index === workflow.activeIndex && workflow.currentStepComplete === true);
  return done ? glyphs.ready : index === workflow.activeIndex ? glyphs.activeStep : glyphs.pendingStep;
}

function styledWorkflowMarker(workflow: WorkflowRuntimeSnapshot, index: number, styles: LayoutStyles): string {
  const marker = workflowStepMarker(workflow, index);
  return styles[marker === glyphs.ready ? "success" : marker === glyphs.activeStep ? "accent" : "dim"](marker);
}

function receiptLine(session: RenderSession, width: number, styles: LayoutStyles): string {
  const text = truncate(plainAttentionText(session.deliveryResult ?? ""), width);
  return session.deliveryResult?.startsWith(`${glyphs.ready} Sent`)
    ? session.deliveryEmphasis ? styles.strong(styles.success(text)) : styles.muted(text)
    : styles.accent(text);
}

function adaptiveCardLines(
  session: RenderSession,
  width: number,
  styles: LayoutStyles,
  board: boolean,
  terminalWidth: number,
  inbox = true,
  hideFocusedQuestion = false,
  now = 0,
  replying = false,
): { line: string; priority: number }[] {
  if (board) {
    const receipt = session.deliveryResult
      ? [{ line: receiptLine(session, width, styles), priority: 0 }]
      : [];
    if (terminalWidth < 100) return receipt;
    const lines: { line: string; priority: number }[] = [];
    const context = session.ticketId
      ? `#${session.ticketId}${session.ticketSubtitle ? ` ${glyphs.pendingStep} ${session.ticketSubtitle}` : ""}`
      : session.ticketSubtitle;
    if (context) lines.push({ line: styles.muted(truncate(context, width)), priority: 2 });
    lines.push(...receipt);
    const activityText = activityLabel(session.workflow?.activity);
    const phase = planPhaseLabel(session.plan);
    if (phase) lines.push({ line: styles.muted(truncate(phase, width)), priority: 0 });
    const progress = planProgressBar(session.plan, styles);
    const recap = activityText && progress
      ? `${styles.accent(truncate(activityText, Math.max(0, width - displayWidth(progress) - 3)))}${styles.border(` ${glyphs.pendingStep} `)}${progress}`
      : activityText ? styles.accent(truncate(activityText, width)) : truncate(progress, width);
    if (recap) lines.push({ line: recap, priority: 0 });
    return lines;
  }

  const lines: { line: string; priority: number }[] = [];
  if (!inbox) {
    const summary = session.attention?.text ?? session.ticketSubtitle ?? session.ticketDescription;
    return summary ? [{ line: styles.muted(truncate(session.attention ? `${glyphs.quoteLeft}${summary}${glyphs.quoteRight}` : summary, width)), priority: 0 }] : [];
  }
  // In the fleet only the selected module reaches here: its full task, then the field grid.
  const summary = session.ticketSubtitle ?? session.ticketDescription;
  if (summary) for (const line of wrapWords(plainAttentionText(summary), width, width)) lines.push({ line: styles.muted(line), priority: 0 });
  lines.push(...detailFieldLines(session, width, styles, { terminalWidth, now, hideQuestion: hideFocusedQuestion, replying }));
  return lines;
}

/** Repo grouping names the repo in its header, and groups usually name the repo; only a differing name earns the slot. */
function repoNameSignal(session: RenderSession, styles: LayoutStyles, repoMode: boolean): string {
  if (repoMode || sameName(session.repoLabel, session.group)) return "";
  return styles.muted(session.repoLabel);
}

function sameName(left: string, right: string): boolean {
  const key = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return key(left) === key(right);
}

function activityLabel(activity: WorkflowRuntimeSnapshot["activity"]): string {
  return activity ? `${activity.label}${activity.pass && activity.pass > 1 ? ` (pass ${activity.pass})` : ""}` : "";
}

function executePlan(session: RenderSession): RenderSession["plan"] {
  return session.workflow?.steps[session.workflow.activeIndex]?.id === "execute" ? session.plan : undefined;
}

function planPhaseLabel(plan: RenderSession["plan"]): string {
  return plan?.phase ? `Phase ${plan.phase.index}/${plan.phase.count} ${glyphs.pendingStep} ${plan.phase.title}` : "";
}

function planTaskCount(plan: RenderSession["plan"]): { completed: number; total: number } | undefined {
  const phases = plan?.phases;
  const total = phases?.length
    ? phases.reduce((sum, phase) => sum + phase.total, 0)
    : plan?.tasks?.total ?? 0;
  const completed = phases?.length
    ? phases.reduce((sum, phase) => sum + phase.completed, 0)
    : plan?.tasks?.completed ?? 0;
  return total > 0 && completed >= 0 ? { completed, total } : undefined;
}

function planProgressBar(plan: RenderSession["plan"], styles: LayoutStyles): string {
  const count = planTaskCount(plan);
  if (!count) return "";
  const { completed, total } = count;
  const filled = Math.max(0, Math.min(8, Math.round((completed / total) * 8)));
  return `${styles.accent(glyphs.progressFilled.repeat(filled))}${styles.muted(glyphs.progressEmpty.repeat(8 - filled))} ${completed}/${total} tasks`;
}

function workspacePlanLines(session: RenderSession, width: number, styles: LayoutStyles): string[] {
  const plan = executePlan(session);
  if (!plan) return [];
  const phase = planPhaseLabel(plan);
  const progress = planProgressBar(plan, styles);
  return [
    ...(phase ? wrapWords(phase, width, width).map(styles.muted) : []),
    ...(progress ? [progress] : []),
    ...(plan.nextStep ? [styles.muted("Next unchecked:"), ...wrapWords(plan.nextStep, width, width)] : []),
  ];
}

interface WorkspaceRendered {
  panelViewport?: PanelViewport;
  lines: string[];
  targets: (string | undefined)[];
}

interface WorkspaceBlock extends WorkspaceRendered {
  key: "identity" | "closure" | "request" | "receipt" | "task" | "workflow" | "guidance" | "lifecycle" | "actions" | "evidence";
}

function renderFocusedPanel(title: string, context: string[], panel: NonNullable<RenderWorkspace["panel"]>, width: number, maxRows: number | undefined, styles: LayoutStyles, indent = "", retained: string[] = []): { lines: string[]; panelViewport: PanelViewport; fallback: boolean } {
  const contentWidth = Math.max(1, width - indent.length);
  const body = panel.body.flatMap((line, index) => {
    if (typeof line !== "string") return [indent + styles.accent(renderCursorValue(line.value, line.cursor, contentWidth, "start"))];
    const hangingIndent = Math.max(0, Math.min(contentWidth - 1, panel.hangingIndents?.[index] ?? 0));
    const prefix = hangingIndent ? sliceByColumn(line, 0, hangingIndent) : "";
    const text = hangingIndent ? sliceByColumn(line, hangingIndent, displayWidth(line)) : line;
    // Options and questions wrap at the reading measure; the focus plate still spans the pane.
    const measure = panel.proseFrom !== undefined && index >= panel.proseFrom ? PROSE_MEASURE : contentWidth;
    const parts = wrapTextWithAnsi(text, Math.max(1, Math.min(contentWidth - hangingIndent, measure)))
      .map((part, partIndex) => (partIndex ? " ".repeat(hangingIndent) : prefix) + part);
    return parts.map(part => indent + (panel.focusRows?.includes(index) ? styles.option(pad(part, contentWidth)) : part));
  });
  const keyLines = completeKeyLines(panel.keyLine, contentWidth, styles).map(line => indent + line);
  // A blank row sets the keys apart from the last option when the panel has rows to spare.
  const spare = maxRows === undefined || body.length + context.length + retained.length + keyLines.length + 2 + (panel.statusLine ? 1 : 0) <= maxRows;
  const keys = panel.kind && spare && body.length && stripAnsi(body.at(-1)!).trim() ? ["", ...keyLines] : keyLines;
  const retainedLines = retained.map(line => indent + truncate(line, contentWidth));
  const reserved = 1 + retainedLines.length + keys.length;
  const capacity = maxRows ?? body.length + context.length + reserved + (panel.statusLine ? 1 : 0);
  if (capacity < reserved + 1) return { lines: [styles.accent("Enter Open in Pi")], panelViewport: { pageSize: 1, maxOffset: 0, fallback: true }, fallback: true };
  const status = panel.statusLine && capacity > reserved + 1 ? [indent + styles.muted(truncate(plainAttentionText(panel.statusLine), contentWidth))] : [];
  const keptContext = context.slice(0, Math.max(0, capacity - reserved - 2 - status.length));
  const bodyCapacity = Math.max(0, capacity - keptContext.length - reserved - status.length);
  const maxOffset = Math.max(0, body.length - bodyCapacity);
  const offset = Math.max(0, Math.min(panel.offset, maxOffset));
  return { lines: [truncate(title, width), ...keptContext, ...retainedLines, ...status, ...body.slice(offset, offset + bodyCapacity), ...keys],
    panelViewport: { pageSize: Math.max(1, bodyCapacity), maxOffset }, fallback: false };
}

function actionWorkspaceBlocks(workspace: RenderWorkspace, width: number, now: number, styles: LayoutStyles, pinned = false): WorkspaceBlock[] {
  const session = workspace.session;
  const block = (key: WorkspaceBlock["key"], lines: string[], targets: (string | undefined)[] = []): WorkspaceBlock => ({
    key,
    lines: lines.map((line) => truncate(line, width)),
    targets: lines.map((_, index) => targets[index]),
  });
  const meta = [
    session.ticketId ? `#${session.ticketId}` : undefined,
    session.repoLabel,
    session.repoCount > 1 ? `${glyphs.repos}${session.repoCount}` : undefined,
    session.worktreeBranch ? `${session.worktreeMarker ?? glyphs.worktree} ${session.worktreeBranch}` : session.worktreeMarker ? `${session.worktreeMarker} worktree` : undefined,
    session.kind === "subagent" && workspace.owner ? `subagent of ${workspace.owner.title}` : undefined,
  ].filter(Boolean).join(` ${glyphs.pendingStep} `);
  const titleLines = pinned ? wrapWords(session.title, width, width) : [];
  const identity = block("identity", [
    ...(pinned ? [titleLines[0] ?? "", ...(titleLines.length > 1 ? [truncate(titleLines.slice(1).join(" "), width)] : [])] : [titleStatusRow(session, width, styles)]),
    ...(pinned ? [styles.muted(`Repo: ${session.repoLabel}`)] : meta ? [styles.muted(meta)] : []),
    ...(session.worktreeLifecycle ? [styles.muted(`Worktree owner: ${session.worktreeLifecycle.producer}`)] : []),
    styles.border(glyphs.horizontal.repeat(width)),
  ]);

  const closure = block("closure", workspaceClosureLine(session, styles));
  const attention = session.attention;
  const request = block("request", attention ? [
    ...prefixedWorkspaceText(attentionGlyph(attention.kind, styles), `${glyphs.quoteLeft}${stripAnsi(attention.text)}${glyphs.quoteRight}`, width),
    ...(attention.recommendation ? prefixedWorkspaceText(glyphs.right, stripAnsi(attention.recommendation), width).map((line) => styles.muted(line)) : []),
    ...(attention.artifact ? [styles.muted(`${glyphs.artifact} ${truncateValue(attention.artifact, Math.max(1, width - 2), "start")}`)] : []),
  ] : []);
  const receipt = block("receipt", session.deliveryResult ? [receiptLine(session, width, styles)] : []);
  const taskText = workspaceTaskText(workspace);
  const task = block("task", taskText ? wrapWords(taskText, width, width).slice(0, width >= 40 ? 3 : 2) : []);
  const workflowSession = session.kind === "subagent" ? workspace.owner ?? session : session;
  const workflow = block("workflow", [
    ...workspaceWorkflowLine(workflowSession, styles),
    ...workspacePlanLines(session, width, styles),
  ]);
  const guidanceText = [session.error ? `Error ${glyphs.pendingStep} ${stripAnsi(session.error)}` : undefined, workspace.guidance].filter(Boolean).join(` ${glyphs.pendingStep} `);
  const lifecycleLines = session.worktreeLifecycle?.repositories?.flatMap((item) => {
    const state = item.state === "cleaned" ? `cleaned${item.outcome ? ` (${item.outcome})` : ""}` : item.state.replace(/-/gu, " ");
    const verification = item.verifiedAt ? ` ${glyphs.pendingStep} verified ${ageLabel(Math.max(0, now - item.verifiedAt), "now")} ago` : "";
    return wrapWords(`${item.role}: ${state} ${glyphs.pendingStep} ${item.branch}${verification} ${glyphs.pendingStep} ${item.worktreePath} ${glyphs.right} ${item.sourcePath}${item.branchDeleted === false ? ` ${glyphs.pendingStep} branch retained` : ""}${item.issue ? ` ${glyphs.pendingStep} ${item.issue}` : ""}`, width, width);
  }) ?? [];
  const guidance = block("guidance", guidanceText ? wrapWords(guidanceText, width, width) : []);
  const lifecycle = block("lifecycle", lifecycleLines);
  const hasBody = [closure, request, receipt, task, workflow, guidance, lifecycle].some((candidate) => candidate.lines.length > 0);
  const actions = workspaceActionBlock(workspace, width, styles, block, hasBody);
  const evidence = block("evidence", workspaceEvidenceLines(workspace, width, now, styles));
  return [identity, closure, request, receipt, task, workflow, guidance, lifecycle, actions, evidence];
}

function renderActionWorkspace(workspace: RenderWorkspace, width: number, maxRows: number | undefined, now: number, styles: LayoutStyles, pinned = false): WorkspaceRendered {
  if (workspace.panel) {
    const retained = workspace.session.deliveryResult ? [styles.accent(plainAttentionText(workspace.session.deliveryResult))] : [];
    const rendered = renderFocusedPanel(titleStatusRow(workspace.session, width, styles), [], workspace.panel, width, maxRows, styles, "", retained);
    return { ...rendered, targets: rendered.lines.map((_, index) => rendered.fallback && index === 0 ? `action:${workspace.session.id}:open` : undefined) };
  }
  const blocks = actionWorkspaceBlocks(workspace, width, now, styles, pinned);
  const rowCount = blocks.reduce((sum, candidate) => sum + candidate.lines.length, 0);
  if (maxRows !== undefined && rowCount > maxRows) {
    return compactActionWorkspace(workspace, blocks, maxRows, width, pinned);
  }
  return {
    lines: blocks.flatMap((candidate) => candidate.lines),
    targets: blocks.flatMap((candidate) => candidate.targets),
  };
}

function prefixedWorkspaceText(prefix: string, value: string, width: number): string[] {
  const prefixWidth = displayWidth(prefix) + 1;
  return wrapWords(value, Math.max(4, width - prefixWidth), Math.max(4, width - prefixWidth))
    .map((line, index) => `${index ? " ".repeat(prefixWidth) : `${prefix} `}${line}`);
}

function workspaceTaskText(workspace: RenderWorkspace): string {
  const session = workspace.session;
  if (session.kind === "subagent") return stripAnsi(session.taskPreview?.trim() ?? "");
  return stripAnsi(session.ticketSubtitle?.trim() || session.ticketDescription?.trim() || "");
}

function workspaceWorkflowLine(session: RenderSession, styles: LayoutStyles): string[] {
  const workflow = session.workflow;
  const step = workflow?.steps[workflow.activeIndex];
  if (!workflow || !step) return [];
  const mode = activeWorkflowMode(session);
  const label = mode?.label?.trim() || mode?.short.trim() || step.label?.trim() || step.short;
  return [`${styles.accent(label)}${styles.muted(` ${glyphs.pendingStep} step ${workflow.activeIndex + 1} of ${workflow.steps.length}`)}`];
}

function workspaceActionBlock(
  workspace: RenderWorkspace,
  width: number,
  styles: LayoutStyles,
  block: (key: WorkspaceBlock["key"], lines: string[], targets?: (string | undefined)[]) => WorkspaceBlock,
  includeSeparator: boolean,
): WorkspaceBlock {
  const commands = [...workspace.actions];
  if (!commands.some((command) => command.id === workspace.evidenceCommand.id)) commands.push(workspace.evidenceCommand);
  if (!commands.some((command) => command.id === workspace.moreCommand.id)) commands.push(workspace.moreCommand);
  const primaryId = workspace.actions[0]?.id ?? workspace.moreCommand.id;
  const lines = includeSeparator ? [styles.border(glyphs.horizontal.repeat(width))] : [];
  const targets: (string | undefined)[] = lines.map(() => undefined);
  for (const command of commands) {
    const primary = command.id === primaryId;
    const key = formatKey(command.displayKey ?? "");
    const label = command.id === workspace.evidenceCommand.id && workspace.evidenceVisible ? "Hide details"
      : command.id === workspace.moreCommand.id ? "All actions" : command.label;
    const prefix = primary ? `${styles.accent(glyphs.selected)} ` : "  ";
    const fittedLabel = truncate(label, Math.max(0, width - 3 - displayWidth(key)));
    const labelText = primary ? styles.strong(fittedLabel) : fittedLabel;
    const gap = " ".repeat(Math.max(1, width - 2 - displayWidth(fittedLabel) - displayWidth(key)));
    lines.push(`${prefix}${labelText}${gap}${styles.accent(key)}`);
    targets.push(command.id);
  }
  return block("actions", lines, targets);
}

function workspaceEvidenceLines(workspace: RenderWorkspace, width: number, now: number, styles: LayoutStyles): string[] {
  if (!workspace.evidenceVisible) return [];
  const session = workspace.session;
  const fields = statusEvidenceFields(session, now).filter((field) => {
    if (field.kind === "result") return hasUsefulStatusResult(session);
    if (field.label === "workflow" && field.value === "no workflow reported") return false;
    if (field.label === "read" && field.value === "read state does not affect this result") return false;
    return true;
  });
  return [
    styles.border(glyphs.horizontal.repeat(width)),
    styles.muted("LIVE DETAILS"),
    ...fields.flatMap((field) => renderStatusEvidenceField(field, width, styles)),
  ];
}

function compactActionWorkspace(workspace: RenderWorkspace, blocks: WorkspaceBlock[], maxRows: number, width: number, pinned = false): WorkspaceRendered {
  if (maxRows <= 0) return { lines: [], targets: [] };
  const identity = blocks.find((candidate) => candidate.key === "identity")!;
  const actions = blocks.find((candidate) => candidate.key === "actions")!;
  const evidence = blocks.find((candidate) => candidate.key === "evidence")!;
  const title = { line: identity.lines[0] ?? "", target: undefined as string | undefined };
  const closure = blocks.find((candidate) => candidate.key === "closure")!.lines.slice(0, maxRows >= 3 ? 1 : 0)
    .map((line) => ({ line, target: undefined as string | undefined }));
  const actionRows = actions.lines.flatMap((line, index) => {
    const target = actions.targets[index];
    return target ? [{ line, target }] : [];
  });
  const primary = actionRows[0];
  const evidenceFacts = evidence.lines.slice(2);
  const reservePrimary = primary && maxRows >= 2 ? 1 : 0;
  const reserveEvidence = evidenceFacts.length && maxRows >= 3 ? 1 : 0;
  let budget = Math.max(0, maxRows - 1 - closure.length - reservePrimary - reserveEvidence);
  const identityDetails = identity.lines.slice(1, -1).map((line) => ({ line, target: undefined as string | undefined }));
  const bodyDetails = blocks.filter((candidate) => ["request", "receipt", "task", "workflow", "guidance", "lifecycle"].includes(candidate.key))
    .flatMap((candidate) => candidate.lines.map((line, index) => ({ line, target: candidate.targets[index] })));
  const optionalContent = pinned ? [...identityDetails, ...bodyDetails] : [...bodyDetails, ...identityDetails];
  const content = optionalContent.slice(0, budget);
  budget -= content.length;
  const secondary = actionRows.slice(1, 1 + budget);
  const evidenceBudget = Math.max(0, maxRows - 1 - closure.length - reservePrimary - content.length - secondary.length);
  const evidenceLines = evidenceFacts.slice(0, evidenceBudget);
  const rows = [
    title,
    ...closure,
    ...content,
    ...(reservePrimary && primary ? [primary] : []),
    ...secondary,
    ...evidenceLines.map((line) => ({ line, target: undefined as string | undefined })),
  ];
  return {
    lines: rows.slice(0, maxRows).map(({ line }) => truncate(line, width)),
    targets: rows.slice(0, maxRows).map(({ target }) => target),
  };
}

function workspaceFooter(workspace: RenderWorkspace): string {
  const evidenceKey = workspace.evidenceCommand.displayKey ?? "i";
  const moreKey = workspace.moreCommand.displayKey ?? ":";
  return `Esc Back ${glyphs.pendingStep} ${evidenceKey} Details ${glyphs.pendingStep} ${moreKey} Actions`;
}

/** Static glyph: a second spinner here makes the main-screen diff repaint every row between it and the selected row. */
function titleStatusRow(session: RenderSession, width: number, styles: LayoutStyles): string {
  const symbol = session.displayStatus === "running" ? glyphs.running : session.symbol;
  const status = styles.status(session.displayStatus, `${symbol} ${session.displayStatus}`);
  const statusWidth = displayWidth(status);
  if (statusWidth >= width) return truncate(status, width);
  const title = truncate(styles.accent(session.title), Math.max(0, width - statusWidth - 2));
  const gap = Math.max(1, width - displayWidth(title) - statusWidth);
  return `${title}${" ".repeat(gap)}${status}`;
}

function activeWorkflowMode(session: RenderSession): WorkflowModeDisplay | undefined {
  return session.status === "stopped" ? undefined : session.workflow?.activeMode;
}

function activeStepShort(workflow: WorkflowRuntimeSnapshot, mode?: WorkflowModeDisplay): string {
  const step = workflow.steps[workflow.activeIndex];
  return step ? mode?.short ?? step.short : "";
}

function railCompact(workflow: WorkflowRuntimeSnapshot, mode: WorkflowModeDisplay | undefined, styles: LayoutStyles): string {
  const short = activeStepShort(workflow, mode);
  return short ? `${styledWorkflowMarker(workflow, workflow.activeIndex, styles)}${styles.accent(short)}` : "";
}

function workflowGridHeader(workflow: WorkflowRuntimeSnapshot, gap: string): string {
  return workflow.steps.map((step) => pad(step.short, Math.max(2, displayWidth(step.short)))).join(gap);
}

interface FleetWorkflowCell {
  right: string;
  compatible: boolean;
  gridWidth: number;
}

/** Positional markers under the section grid, or an explicit step label for other pipelines. */
function fleetWorkflowCell(session: RenderSession, styles: LayoutStyles, grid: WorkflowRuntimeSnapshot | undefined, gap: string): FleetWorkflowCell {
  const workflow = session.workflow;
  const compatible = Boolean(workflow && grid && workflow.steps.length === grid.steps.length
    && workflow.steps.every((step, index) => step.id === grid.steps[index].id && step.short === grid.steps[index].short));
  const right = workflow
    ? compatible
      ? workflow.steps.map((step, index) => pad(styledWorkflowMarker(workflow, index, styles), Math.max(2, displayWidth(step.short)))).join(gap)
      : railCompact(workflow, activeWorkflowMode(session), styles)
    : "";
  return { right, compatible, gridWidth: grid ? displayWidth(workflowGridHeader(grid, gap)) : 0 };
}

/** The selected module's identity line: group, repo and branch, then counts the title row had no room for. */
function inboxMetadataLine(session: RenderSession, width: number, terminalWidth: number, styles: LayoutStyles, repoMode: boolean, includeGroup = true, includeBranch = true, includeCounts = true): string {
  const hidden = session.hiddenChildRequestCount ? ` ?${session.hiddenChildRequestCount}` : "";
  const budget = Math.max(0, width - displayWidth(hidden));
  const branchName = session.worktreeBranch ?? session.worktreeLifecycle?.repositories?.find(item => item.role === "primary" && item.state !== "cleaned")?.branch;
  const group = includeGroup ? styles.muted(truncate(session.group, Math.min(24, budget))) : "";
  const repo = terminalWidth >= 40 ? repoNameSignal(session, styles, repoMode) : "";
  const branch = includeBranch && terminalWidth >= 40 && branchName ? styles.muted(`${glyphs.worktree} ${branchName}`) : "";
  let left = group;
  for (const part of [repo, branch]) {
    if (!part) continue;
    if (displayWidth(left) + displayWidth(part) + 1 <= budget) left += ` ${part}`;
    else break;
  }
  if (repoMode && terminalWidth >= 100) {
    const tier = COCKPIT_ROW_LABELS[session.cockpitTier];
    if (displayWidth(left) + tier.length + 1 <= budget) left += ` ${cockpitTone(session.cockpitTier, styles)(tier)}`;
  }
  left = truncate(left, budget) + styles.warning(hidden);
  const running = includeCounts && session.runningSubagentCount ? ` ${glyphs.subagents}${session.runningSubagentCount}` : "";
  if (displayWidth(left) + displayWidth(running) <= width) left += styles.live(running);
  const repos = includeCounts && session.repoCount > 1 ? ` ${glyphs.repos} ${session.repoCount}` : "";
  if (displayWidth(left) + displayWidth(repos) <= width) left += styles.muted(repos);
  // Parts join with a leading separator; drop it when no identity precedes them.
  return trimLeadingSeparator(left);
}

interface KeyItem { key: string; label: string; commandId?: string }

/** A painted keycap's own padding separates it from its label. */
function keyItemText(key: string, label: string, styles: LayoutStyles): string {
  return `${styles.keycap(key)}${label ? styles.muted(styles.padded ? label : ` ${label}`) : ""}`;
}
interface KeyRow { line: string; plain: string; hits: { x: number; width: number; commandId: string }[] }

const KEY_GAP = "   ";

/** Packs keycap items into rows; `plain` is the catalog notation that lays out to the same row again. */
function layoutKeyRows(items: KeyItem[], width: number, styles: LayoutStyles, wrap = true): KeyRow[] {
  const rows: KeyRow[] = [];
  for (const item of items) {
    const text = keyItemText(item.key, item.label, styles);
    const textWidth = displayWidth(text);
    const plain = item.label ? `${item.key} ${item.label}` : item.key;
    const last = rows.at(-1);
    const x = last ? displayWidth(last.line) + KEY_GAP.length : 0;
    if (last && x + textWidth <= width) {
      last.line += `${KEY_GAP}${text}`;
      last.plain += ` ${glyphs.pendingStep} ${plain}`;
      if (item.commandId) last.hits.push({ x, width: textWidth, commandId: item.commandId });
    } else if (wrap || !last && textWidth <= width) {
      for (const [index, line] of wrapTextWithAnsi(text, width).entries()) {
        rows.push({ line, plain: index ? "" : plain, hits: item.commandId ? [{ x: 0, width: displayWidth(line), commandId: item.commandId }] : [] });
      }
    }
  }
  return rows;
}

function keyItems(line: string): KeyItem[] {
  return line.split(` ${glyphs.pendingStep} `).map((part) => {
    const match = /^(\S+)(?: (.*))?$/u.exec(part);
    return { key: match?.[1] ?? part, label: match?.[2] ?? "" };
  });
}

/** Drops leading spaces and separators from a styled string while keeping its styles. */
function trimLeadingSeparator(text: string): string {
  let styles = "";
  let rest = text;
  for (;;) {
    const sgr = /^\u001b\[[0-9;:]*m/u.exec(rest);
    if (sgr) {
      styles += sgr[0];
      rest = rest.slice(sgr[0].length);
    } else if (rest.startsWith(" ")) rest = rest.slice(1);
    else if (rest.startsWith(glyphs.pendingStep)) rest = rest.slice(glyphs.pendingStep.length);
    else return styles + rest;
  }
}

function completeKeyLines(keyLine: string, width: number, styles: LayoutStyles): string[] {
  return keyLine.split("\n").flatMap(line => line ? layoutKeyRows(keyItems(line), width, styles).map(row => row.line) : [""]);
}

function cardKeyRows(workspace: RenderWorkspace, width: number, styles: LayoutStyles, wrap = true): KeyRow[] {
  const commands = [...new Map([...workspace.actions, workspace.evidenceCommand, workspace.moreCommand].map(command => [command.id, command])).values()];
  const rows = layoutKeyRows(commands.map((command) => ({
    key: formatKey(command.displayKey ?? ""),
    label: command.id === workspace.moreCommand.id ? "All actions" : command.label,
    commandId: command.id,
  })), width, styles, wrap);
  return rows.length ? rows : [{ line: "", plain: "", hits: [] }];
}

function fleetMetadataLine(session: RenderSession, width: number, styles: LayoutStyles, cell: FleetWorkflowCell, repoMode: boolean, repoInline = false): string {
  const mode = activeWorkflowMode(session);
  const { right, compatible } = cell;
  const hidden = session.hiddenChildRequestCount ? styles.warning(`?${session.hiddenChildRequestCount}`) : "";
  const taskCount = planTaskCount(executePlan(session));
  const optionalSignals = [
    session.runningSubagentCount ? styles.live(`${glyphs.subagents}${session.runningSubagentCount}`) : "",
    mode && compatible ? styles.accent(mode.short) : "",
    taskCount ? styles.muted(`${taskCount.completed}/${taskCount.total} tasks`) : "",
    // Status grouping already names the tier in the section heading.
    repoMode ? cockpitTone(session.cockpitTier, styles)(COCKPIT_ROW_LABELS[session.cockpitTier]) : "",
    session.repoCount > 1 ? styles.muted(`${glyphs.repos} ${session.repoCount}`) : "",
  ].filter(Boolean);
  const leftWidth = Math.max(0, width - (right ? displayWidth(right) + 1 : 0));
  const minimumGroup = Math.min(8, Math.max(0, leftWidth - (hidden ? displayWidth(hidden) + 1 : 0)));
  let signals = hidden;
  // The repo name never shrinks the group badge; it comes only when the full badge still fits.
  const repo = repoInline ? repoNameSignal(session, styles, repoMode) : "";
  const fullGroup = Math.min(24, displayWidth(session.group) + 2);
  const repoFits = Boolean(repo) && fullGroup + 1 + displayWidth(signals ? `${signals} ${repo}` : repo) <= leftWidth;
  if (repoFits) signals = signals ? `${signals} ${repo}` : repo;
  const groupFloor = repoFits ? fullGroup : minimumGroup;
  for (const signal of optionalSignals) {
    const candidate = signals ? `${signals} ${signal}` : signal;
    if (groupFloor + 1 + displayWidth(candidate) <= leftWidth) signals = candidate;
  }
  const groupWidth = Math.max(0, leftWidth - (signals ? displayWidth(signals) + 1 : 0));
  const group = groupWidth >= 3 ? renderGroupBadge(session.group, Math.min(24, groupWidth), styles) : "";
  let left = truncate([group, signals].filter(Boolean).join(" "), leftWidth);
  const age = rowAge(session);
  if (age && displayWidth(left) + displayWidth(age) + 3 <= leftWidth) left += styles.muted(` ${glyphs.pendingStep} ${age}`);
  return right ? twoColumn(left, right, width) : left;
}

/** Running rows show how long they have run; the spinner already says "now". */
function rowAge(session: RenderSession): string | undefined {
  return session.displayStatus === "running" && session.activityAge === "now" ? undefined : session.activityAge;
}

function pinGlyph(session: RenderSession, styles: LayoutStyles): string {
  if (!session.pinned) return "";
  return `${session.pinFocused ? styles.accent(`${glyphs.pinned}${session.pinSlot}`) : styles.muted(`${glyphs.pin}${session.pinSlot}`)} `;
}

function rowRightAdornment(session: RenderSession, styles: LayoutStyles, board: boolean, repoMode: boolean, width: number, terminalWidth: number, cell?: FleetWorkflowCell): string {
  if (session.kind === "subagent") return "";
  const mode = activeWorkflowMode(session);
  const minimumTitle = board && terminalWidth <= NARROW_LAYOUT_MAX_WIDTH && !mode
    ? Math.max(8, Math.min(18, displayWidth(session.title))) : 8;
  const fits = (right: string): boolean => Boolean(right) && width - displayWidth(right) - 1 >= minimumTitle;
  const join = (parts: string[]) => parts.filter(Boolean).join(styles.border(` ${glyphs.pendingStep} `));
  const hidden = session.hiddenChildRequestCount ? styles.warning(`?${session.hiddenChildRequestCount}`) : "";
  const running = session.runningSubagentCount ? styles.live(`${glyphs.subagents}${session.runningSubagentCount}`) : "";
  const compact = session.workflow ? railCompact(session.workflow, mode, styles) : "";
  const workflow = board ? cell?.right ?? ""
    : session.workflow && terminalWidth >= 120 ? railFull(session.workflow, mode, styles) : compact;
  const age = terminalWidth >= 80 && rowAge(session) ? styles.muted(rowAge(session)!) : "";
  const hierarchy = (tail: string[]) => [
    [hidden, running, ...tail, age],
    [hidden, running, ...tail],
    [hidden, running, compact],
    [hidden, compact],
    [hidden],
    [running, compact],
    [compact],
    [running],
    [age],
  ].map(join);

  if (board) {
    const modeLabel = mode && cell?.compatible ? styles.accent(mode.short) : "";
    return [
      [hidden, running, modeLabel, age, workflow],
      [hidden, running, modeLabel, workflow],
      [hidden, running, compact],
      [hidden, compact],
      [hidden, running, workflow],
      [hidden, workflow],
      [hidden],
      [running, workflow],
      [workflow],
      [running],
      [age],
    ].map(join).find(fits) ?? "";
  }
  if (session.section === "archived") {
    // The meaning is atomic: drop age first, then omit it whole rather than leave an ambiguous lone marker.
    const meaning = archivedMeaning(session, styles);
    const age = session.archivedAge ? styles.muted(session.archivedAge) : "";
    return [join([hidden, meaning, age]), join([hidden, meaning]), join([hidden, age]), hidden, age].find(fits) ?? "";
  }
  if (repoMode) {
    const label = cockpitTone(session.cockpitTier, styles)(COCKPIT_ROW_LABELS[session.cockpitTier]);
    const lifecycle = session.section === "backlog" ? styles.muted("backlog") : "";
    return [...hierarchy([lifecycle, label, ...(workflow ? [workflow] : [])]), label].find(fits) ?? "";
  }
  if (session.section === "backlog") {
    const backlog = styles.muted("backlog");
    return [join([hidden, backlog]), hidden, backlog].find(fits) ?? "";
  }
  return hierarchy(workflow ? [workflow] : []).find(fits) ?? "";
}

/** Drop group, then age, before sacrificing the grid or the title's readable minimum. */
function fleetOneLineTail(session: RenderSession, width: number, styles: LayoutStyles, options: SessionRowOptions): string {
  const minimumTitle = Math.min(12, displayWidth(session.title));
  const fits = (tail: string) => Boolean(tail) && width - displayWidth(tail) - 1 >= minimumTitle;
  // A module's title row ends with its age; its STEP field carries workflow position.
  if (options.card && moduleTier(session.cockpitTier)) {
    const hidden = session.hiddenChildRequestCount ? styles.warning(`?${session.hiddenChildRequestCount}`) : "";
    const age = rowAge(session) ? styles.muted(rowAge(session)!.padStart(3)) : "";
    const step = rosterStep(session, styles);
    return [[hidden, step, age], [hidden, step], [hidden, age], [hidden], [step], [age]].map((parts) => parts.filter(Boolean).join("  ")).find(fits) ?? "";
  }
  // Pin rows: the shared grid, then group and age.
  const workflow = options.workflowCell?.right ?? "";
  const grid = workflow + " ".repeat(Math.max(0, (options.workflowCell?.gridWidth ?? 0) - displayWidth(workflow)));
  const compact = session.workflow ? railCompact(session.workflow, activeWorkflowMode(session), styles) : "";
  // Selected short-window rows retain group metadata below; phones keep their title + progress shape.
  if (session.selected || options.terminalWidth <= NARROW_LAYOUT_MAX_WIDTH) return [grid, compact].find(fits) ?? "";
  const hidden = session.hiddenChildRequestCount ? styles.warning(`?${session.hiddenChildRequestCount}`) : "";
  const age = rowAge(session) ?? "";
  const metadata = (group: boolean, withAge: boolean) => styles.muted([
    ...(group ? [session.group] : []), ...(withAge && age ? [age] : []),
  ].join(` ${glyphs.pendingStep} `));
  return [
    [hidden, metadata(true, true), grid],
    [hidden, metadata(false, true), grid],
    [hidden, grid],
    [hidden, compact],
    [hidden],
    [grid],
    [compact],
  ].map((parts) => parts.filter(Boolean).join("  ")).find(fits) ?? "";
}

function archivedMeaning(session: RenderSession, styles: LayoutStyles): string {
  if (session.closure === "done") return styles.success(glyphs.ready);
  if (session.closure === "abandoned") return styles.muted(glyphs.abandoned);
  const workflow = session.workflow;
  const step = workflow?.steps[workflow.activeIndex];
  return workflow && step ? `${styles.muted(step.short)} ${styledWorkflowMarker(workflow, workflow.activeIndex, styles)}` : "";
}

function workspaceClosureLine(session: RenderSession, styles: LayoutStyles): string[] {
  if (!session.closure) return [];
  const outcome = session.closure === "done" ? styles.success(`${glyphs.ready} Closed ${glyphs.pendingStep} Done`) : styles.muted(`${glyphs.abandoned} Closed ${glyphs.pendingStep} Abandoned`);
  // Closing never stops children, so keep live descendants visible beside the outcome.
  const children = session.runningSubagentCount ? `${styles.dim(` ${glyphs.pendingStep} `)}${styles.live(`${glyphs.subagents}${session.runningSubagentCount}`)} running` : "";
  return [`${outcome}${children}`];
}

function railFull(workflow: WorkflowRuntimeSnapshot, mode: WorkflowModeDisplay | undefined, styles: LayoutStyles): string {
  return workflow.steps
    .map((step, index) => {
      const short = index === workflow.activeIndex ? activeStepShort(workflow, mode) : step.short;
      const styledShort = index === workflow.activeIndex ? styles.accent(short) : styles.muted(short);
      return `${styledWorkflowMarker(workflow, index, styles)} ${styledShort}`;
    })
    .join(styles.border(glyphs.horizontal));
}

function renderStatusEvidenceField(field: StatusEvidenceField, width: number, styles: LayoutStyles): string[] {
  const label = field.label === "heartbeat" ? "beat" : field.label === "workflow" ? "flow" : field.label;
  if (field.kind === "result") {
    const tier = field.tier.toUpperCase().replace("-", " ");
    const value = `${styles.status(field.status, field.status)} ${glyphs.pendingStep} ${cockpitTone(field.tier, styles)(tier)} ${glyphs.pendingStep} ${field.reason}`;
    return workField(label, value, width, styles, `${styles.accent(field.marker)} `);
  }
  const marker = field.tone === "success" ? styles.success(field.marker) : field.tone === "error" ? styles.error(field.marker) : styles.muted(field.marker);
  const value = field.label === "tmux"
    ? field.value.replace(/^tmux /, "")
    : field.label === "heartbeat"
      ? field.value.replace(/^heartbeat /, "")
      : field.label === "workflow"
        ? field.value.replace(/^producer /, "")
        : field.value;
  return workField(label, value, width, styles, `${marker} `);
}

function workField(label: string, value: string, width: number, styles: LayoutStyles, marker = ""): string[] {
  const labelWidth = 6;
  const labelText = styles.muted(pad(label, labelWidth));
  const firstPrefix = `${labelText} `;
  const nextPrefix = `${pad("", labelWidth)} `;
  const firstWidth = Math.max(4, width - displayWidth(firstPrefix) - displayWidth(marker));
  const nextWidth = Math.max(4, width - displayWidth(nextPrefix));
  return wrapWords(value, firstWidth, nextWidth).map((line, index) => index === 0 ? `${firstPrefix}${marker}${line}` : `${nextPrefix}${line}`);
}

export function wrapWords(value: string, firstWidth: number, nextWidth: number): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let width = firstWidth;
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (displayWidth(candidate) <= width) {
      current = candidate;
      continue;
    }
    if (current) {
      lines.push(current);
      current = "";
      width = nextWidth;
    }
    let remainder = word;
    while (displayWidth(remainder) > width) {
      const [head, tail] = splitAtWidth(remainder, width);
      lines.push(head);
      remainder = tail;
      width = nextWidth;
    }
    current = remainder;
  }
  if (current) lines.push(current);
  return lines;
}

function splitAtWidth(value: string, width: number): [string, string] {
  let head = "";
  let consumed = 0;
  for (const char of value) {
    if (head && displayWidth(`${head}${char}`) > width) break;
    head += char;
    consumed += char.length;
  }
  return [head, value.slice(consumed)];
}

function cockpitTone(tier: CockpitTier | undefined, styles: LayoutStyles): (text: string) => string {
  if (tier === "needs-you") return styles.warning;
  if (tier === "health") return styles.error;
  if (tier === "new") return styles.accent;
  if (tier === "active") return styles.success;
  return tier ? styles.muted : styles.border;
}

const COCKPIT_ROW_LABELS: Record<CockpitTier, string> = {
  "needs-you": "NEEDS YOU",
  health: "HEALTH",
  new: "NEW",
  active: "ACTIVE",
  quiet: "QUIET",
  archived: "ARCHIVED",
};

function sectionHeader(title: string, right: string, width: number, styles: LayoutStyles, collapsed?: boolean, selected = false, tier?: CockpitTier, repo = false, bold = false): string {
  const tone = repo ? styles.text : cockpitTone(tier, styles);
  const disclosureTone = repo ? styles.accent : tone;
  const prefix = collapsed === undefined
    ? tone(`${glyphs.horizontal}${glyphs.horizontal}`)
    : `${selected ? styles.accent(glyphs.selected) : tone(glyphs.horizontal)}${disclosureTone(collapsed ? glyphs.collapsed : glyphs.expanded)}`;
  const label = tone(` ${title} `);
  return twoColumn(`${prefix}${bold ? `\u001b[1m${label}\u001b[22m` : label}`, right, width);
}

/**
 * Fleet headings are ruled panel sections: a bold label, its count in the tier's signal tone (warning for
 * NEEDS YOU, error for HEALTH, else muted), then a dim rule up to any right-side signals.
 */
function fleetSectionHeader(title: string, count: number | undefined, right: string, width: number, styles: LayoutStyles, collapsed?: boolean, selected = false, tier?: CockpitTier): string {
  const countTone = tier === "needs-you" ? styles.warning : tier === "health" ? styles.error : styles.muted;
  // Selection and disclosure keep separate columns so a selected, collapsed tier still shows both.
  const prefix = `${selected ? cardStripe(styles.accent) : " "}${collapsed ? styles.muted(glyphs.collapsed) : styles.dim(glyphs.horizontal)}${styles.dim(glyphs.horizontal)} `;
  const left = `${prefix}${styles.strong(title)}${count === undefined ? "" : ` ${countTone(`${count}`)}`} `;
  const tail = right ? ` ${right}` : "";
  const rule = width - displayWidth(left) - displayWidth(tail);
  return rule > 0 ? `${left}${styles.dim(glyphs.horizontal.repeat(rule))}${tail}` : twoColumn(left, right, width);
}

/** Child requests keep priority; the unread count shortens, then drops, before the tier title is cut. */
function cockpitHeadingRight(section: RenderModel["sections"][number], titleWidth: number, width: number, styles: LayoutStyles): string {
  const separator = ` ${glyphs.pendingStep} `;
  const child = section.hiddenChildRequestCount ? `?${section.hiddenChildRequestCount} child` : "";
  const unread = section.hiddenUnreadCount;
  // fleetSectionHeader renders a four-cell prefix and the title with its count and a space, then at least one
  // rule cell and a space before the signals.
  const available = width - (titleWidth + 7) - (child ? displayWidth(child) + displayWidth(separator) : 0);
  const unreadLabel = !unread ? ""
    : [`${glyphs.waiting} ${unread} unread`, `${glyphs.waiting}${unread}`].find((label) => displayWidth(label) <= available) ?? "";
  return [child && styles.warning(child), unreadLabel && styles.warning(unreadLabel)].filter(Boolean).join(styles.border(separator));
}

function attentionGlyph(kind: NonNullable<RenderSession["attention"]>["kind"], styles: LayoutStyles): string {
  if (styles.panel) return styles.warning(kind === "ready" ? glyphs.ready : kind === "question" ? "?" : "!");
  if (kind === "ready") return styles.success(glyphs.ready);
  if (kind === "question") return styles.warning("?");
  return styles.error("!");
}

interface SessionRowOptions {
  board: boolean;
  repoMode: boolean;
  terminalWidth: number;
  childLast: boolean;
  gutterColumn: boolean;
  titleFirst?: boolean;
  oneLine?: boolean;
  /** An unselected fleet card title: group and task ride beside the title instead of on a metadata line. */
  card?: boolean;
  workflowCell?: FleetWorkflowCell;
}

/** Running descendants and extra repositories travel with the title on card rows. */
function cardMarkers(session: RenderSession, styles: LayoutStyles): string {
  const running = session.runningSubagentCount ? styles.live(` ${glyphs.subagents}${session.runningSubagentCount}`) : "";
  const repos = session.repoCount > 1 ? styles.muted(` ${glyphs.repos}${session.repoCount}`) : "";
  return `${running}${repos}`;
}

/** Group, then the task at 100+ columns; Repo grouping also names the tier. A module's mode rides its STEP field. */
function cardIdentity(session: RenderSession, styles: LayoutStyles, options: SessionRowOptions, room: number): string {
  // Beside the detail pane the roster is narrow, and the pane names the task.
  const task = options.terminalWidth >= 160 ? session.ticketSubtitle ?? session.ticketDescription : undefined;
  const parts = [session.group, ...(task ? [plainAttentionText(task)] : [])];
  const text = styles.muted(parts.join(` ${glyphs.pendingStep} `));
  // Repo grouping names the tier whole or not at all: a cut label reads as noise.
  const tier = options.repoMode && options.terminalWidth >= 100 ? ` ${cockpitTone(session.cockpitTier, styles)(COCKPIT_ROW_LABELS[session.cockpitTier])}` : "";
  return tier && displayWidth(text) + displayWidth(tier) <= room ? `${text}${tier}` : truncate(text, room);
}

/** Field labels take five cells and two spaces, so every module's values start in one column. */
const FIELD_LABEL_WIDTH = 5;
const FIELD_INDENT = " ".repeat(FIELD_LABEL_WIDTH + 2);
const TASK_METER_CELLS = 8;

type FieldLine = { line: string; priority: number };

function requestLabel(kind: NonNullable<RenderSession["attention"]>["kind"]): string {
  return kind === "ready" ? "RDY" : kind === "question" ? "ASK" : "BLK";
}

/** Producer labels can be wider than the column; they keep one space before the value instead of throwing. */
function fieldLabel(label: string, tone: (text: string) => string): string {
  return `${tone(label)}${" ".repeat(Math.max(1, FIELD_LABEL_WIDTH + 2 - displayWidth(label)))}`;
}

/** A labeled field: the label, then its value lines hanging at the shared value column. */
function fieldLines(label: string, tone: (text: string) => string, values: string[], priorities: number[]): FieldLine[] {
  return values.map((value, index) => ({ line: `${index ? FIELD_INDENT : fieldLabel(label, tone)}${value}`, priority: priorities[Math.min(index, priorities.length - 1)]! }));
}

function taskMeter(count: { completed: number; total: number }, styles: LayoutStyles): string {
  const filled = Math.max(0, Math.min(TASK_METER_CELLS, Math.round((count.completed / count.total) * TASK_METER_CELLS)));
  return `${styles.text(glyphs.quotaFilled.repeat(filled))}${styles.muted(glyphs.quotaEmpty.repeat(TASK_METER_CELLS - filled))}`;
}

/** The producer's lens is work state like the rail: a stopped or stale session keeps it. */
function lensOf(session: RenderSession): WorkflowLens | undefined {
  return session.workflow?.lens ?? session.lens;
}

function lensProgress(lens: WorkflowLens | undefined): { completed: number; total: number } | undefined {
  return lens?.progress && lens.progress.total > 0 ? lens.progress : undefined;
}

/**
 * WHERE: the rail, then a rule and the lens stages, the task meter and count, the summary, `pass N`, and the mode.
 * Narrow widths drop the summary, the mode, the pass, the meter (its count stays), the stages, then the count,
 * before the rail turns compact. A lens without a workflow position has no rail: its count names its unit.
 */
function whereLine(session: RenderSession, width: number, styles: LayoutStyles, terminalWidth: number): string {
  const workflow = session.workflow;
  const step = workflow?.steps[workflow.activeIndex];
  const lens = lensOf(session);
  if (!(workflow && step) && !lens) return "";
  const mode = activeWorkflowMode(session);
  const progress = lensProgress(lens);
  const stages = lens?.stages?.map(({ label, state }) =>
    `${styles.muted(label)}${styles[state === "done" ? "success" : state === "active" ? "accent" : "dim"](state === "done" ? glyphs.ready : state === "active" ? glyphs.activeStep : glyphs.pendingStep)}`).join(" ") ?? "";
  // Without a rail the count names its unit, such as `2/6 committed`.
  const unit = !workflow && progress && lens?.progress?.unit ? ` ${lens.progress.unit}` : "";
  const count = progress ? styles.text(`${progress.completed}/${progress.total}${unit}`) : "";
  const meter = progress ? `${taskMeter(progress, styles)} ` : "";
  const summary = lens?.summary ? styles.muted(plainAttentionText(lens.summary)) : "";
  const pass = lens?.pass ? styles.muted(`pass ${lens.pass}`) : "";
  // Producer markers at 80+; a plain step name below, which already names the mode.
  const full = !workflow || !step ? ""
    : terminalWidth >= 80
      ? workflow.steps.map((item, index) => `${styles.muted(item.short)}${styledWorkflowMarker(workflow, index, styles)}`).join(" ")
      : styles.text(mode?.short ?? step.label ?? step.short);
  const compact = workflow && terminalWidth >= 80 ? railCompact(workflow, mode, styles) : full;
  const line = (rail: string, parts: { stages?: boolean; meter?: boolean; count?: boolean; summary?: boolean; pass?: boolean; mode?: boolean }) => {
    // A separator leads a part only after an earlier one, so a lens without a rail starts at its first part.
    let value = rail;
    const append = (separator: string, part: string) => { if (part) value += `${value ? separator : ""}${part}`; };
    const rule = styles.dim(` ${glyphs.vertical} `);
    append(rule, parts.stages ? stages : "");
    const counted = parts.count && count;
    append("  ", counted ? `${parts.meter ? meter : ""}${count}` : "");
    append(counted ? styles.dim(` ${glyphs.pendingStep} `) : rule, parts.summary ? summary : "");
    append("  ", parts.pass ? pass : "");
    // The compact rail and the plain step already name the mode.
    append("  ", parts.mode && mode && rail !== compact ? styles.text(mode.short) : "");
    return value;
  };
  const ladder = [
    { stages: true, meter: true, count: true, summary: true, pass: true, mode: true },
    { stages: true, meter: true, count: true, pass: true, mode: true },
    { stages: true, meter: true, count: true, pass: true },
    { stages: true, meter: true, count: true },
    { stages: true, count: true },
    { count: true },
    {},
  ];
  const room = width - FIELD_INDENT.length;
  for (const rail of full === compact ? [full] : [full, compact]) {
    for (const parts of ladder) {
      const value = line(rail, parts);
      if (value && displayWidth(value) <= room) return `${fieldLabel("WHERE", styles.muted)}${value}`;
    }
  }
  return compact ? truncate(`${fieldLabel("WHERE", styles.muted)}${compact}`, width) : "";
}

const LENS_MARKS: Record<NonNullable<WorkflowLens["list"]>["items"][number]["state"], { glyph: string; tone: keyof Pick<LayoutStyles, "muted" | "accent" | "dim" | "warning"> }> = {
  done: { glyph: glyphs.ready, tone: "muted" },
  active: { glyph: glyphs.activeStep, tone: "accent" },
  pending: { glyph: glyphs.pendingStep, tone: "dim" },
  attention: { glyph: glyphs.blocked, tone: "warning" },
  skipped: { glyph: glyphs.range, tone: "muted" },
};

const LIST_ITEMS_BEFORE = 2;
const LIST_ITEMS_SHOWN = 7;

/** The lens list: its head, then items around the first open one, with the producer's and the window's skips counted. */
function lensListLines(session: RenderSession, valueWidth: number, styles: LayoutStyles, compact: boolean): FieldLine[] {
  const list = lensOf(session)?.list;
  if (!list) return [];
  const items = list.items;
  const active = items.findIndex((item) => item.state === "active");
  const next = active >= 0 ? active : items.findIndex((item) => item.state !== "done" && item.state !== "skipped");
  // Below the roster the card has few rows: it keeps the head and the open item only.
  const start = compact ? Math.max(0, next) : Math.max(0, Math.min((next < 0 ? items.length : next) - LIST_ITEMS_BEFORE, items.length - LIST_ITEMS_SHOWN));
  const shown = compact ? items.slice(start, next < 0 ? start : start + 1) : items.slice(start, start + LIST_ITEMS_SHOWN);
  const earlier = list.before + start;
  const later = list.after + Math.max(0, items.length - start - shown.length);
  const values: string[] = [];
  if (list.head) values.push(styles.text(truncate(plainAttentionText(list.head), valueWidth)));
  if (earlier && !compact) values.push(styles.muted(`${glyphs.ready} ${earlier} earlier`));
  for (const [offset, item] of shown.entries()) {
    const mark = LENS_MARKS[item.state];
    const text = truncate(plainAttentionText(item.text), Math.max(1, valueWidth - 2));
    const focus = start + offset === next;
    values.push(`${styles[mark.tone](mark.glyph)} ${item.state === "done" || item.state === "skipped" ? styles.muted(text) : focus ? styles.strong(text) : styles.text(text)}`);
  }
  if (later && !compact) values.push(styles.muted(`${glyphs.pendingStep} ${later} more`));
  return values.length ? fieldLines(plainAttentionText(list.label), styles.muted, values, [1]) : [];
}

/** What one tool call was for: the tool's name in a fixed column, then its short argument. */
function actionText(action: SessionAction, width: number, styles: LayoutStyles, tone: (text: string) => string): string {
  const tool = pad(truncate(action.tool, ACTION_TOOL_WIDTH), ACTION_TOOL_WIDTH);
  return `${tone(tool)} ${styles.muted(truncate(plainAttentionText(action.detail ?? ""), Math.max(0, width - ACTION_TOOL_WIDTH - 1)))}`;
}
const ACTION_TOOL_WIDTH = 7;
const ACTION_AGE_WIDTH = 3;
const PROSE_MEASURE = 76;
const SAID_LINES_REPLYING = 4;

/** The workflow step an agent is on, for a roster title row: its short name, checked when the step is complete. */
function rosterStep(session: RenderSession, styles: LayoutStyles): string {
  const workflow = session.workflow;
  const step = workflow?.steps[workflow.activeIndex];
  if (!workflow || !step) return "";
  const mode = activeWorkflowMode(session);
  return (mode ? styles.accent : styles.muted)(`${mode?.short ?? step.short}${workflow.currentStepComplete === true ? glyphs.ready : ""}`);
}

/** A roster status line's right edge: the lens progress meter and count. */
function rosterProgress(session: RenderSession, styles: LayoutStyles, width: number): string {
  const tasks = session.status !== "error" ? lensProgress(lensOf(session)) : undefined;
  if (!tasks) return "";
  const count = styles.text(`${tasks.completed}/${tasks.total}`);
  return width >= 40 ? `${taskMeter(tasks, styles)} ${count}` : count;
}

/**
 * A roster module's one status line under its title: the request, the fault, the lens DOING, the live tool
 * call, the running subagent, or the last progress note, in that order. Its right edge carries the lens
 * progress. A request may take a second line when rows allow.
 */
function rosterLines(session: RenderSession, width: number, styles: LayoutStyles, terminalWidth: number): FieldLine[] {
  const right = rosterProgress(session, styles, width);
  const valueWidth = Math.max(4, width - FIELD_INDENT.length - (right ? displayWidth(right) + 2 : 0));
  // Requests and faults keep priority 0, so short windows keep them on every row; live work comes next.
  const first = (label: string, tone: (text: string) => string, value: string, priority = 0): FieldLine => {
    const left = `${fieldLabel(label, tone)}${value}`;
    return { line: right ? twoColumn(left, right, width) : left, priority };
  };
  const attention = session.attention;
  if (attention) {
    const words = wrapWords(plainAttentionText(attention.text), valueWidth, Math.max(4, width - FIELD_INDENT.length));
    const second = words.length > 1 ? truncate(words.slice(1).join(" "), Math.max(4, width - FIELD_INDENT.length)) : "";
    return [first(requestLabel(attention.kind), styles.warning, styles.text(words[0] ?? "")),
      ...(second ? [{ line: `${FIELD_INDENT}${styles.text(second)}`, priority: 2 }] : []),
      ...(session.deliveryResult ? [{ line: receiptLine(session, width, styles), priority: 0 }] : [])];
  }
  const lines: FieldLine[] = [];
  const live = session.displayStatus === "running";
  const error = session.displayStatus === "error" && session.error ? plainAttentionText(session.error) : "";
  const action = live ? session.activity?.current ?? session.activity?.recent?.[0] : undefined;
  const doing = lensOf(session)?.doing;
  const child = session.boardExpanded ? undefined : session.runningSubagent;
  // The title row names the task at 160+; below that the quiet fallback can.
  const task = terminalWidth < 160 ? session.ticketSubtitle ?? session.ticketDescription : undefined;
  if (error) lines.push(first("ERR", styles.error, styles.text(truncate(error, valueWidth))));
  else if (doing) lines.push(first("DOING", live ? styles.live : styles.muted, styles.text(truncate(plainAttentionText(doing), valueWidth)), 1));
  else if (action) lines.push(first("NOW", styles.live, actionText(action, valueWidth, styles, styles.text), 1));
  else if (child) lines.push(first("SUB", styles.live, truncate([styles.text(child.agentName), child.taskPreview && styles.muted(plainAttentionText(child.taskPreview))].filter(Boolean).join(" "), valueWidth), 1));
  else if (session.progress?.done) lines.push(first("DONE", styles.muted, styles.text(truncate(plainAttentionText(session.progress.done), valueWidth)), 2));
  // A quiet agent still says something useful: the handoff you already read, else the task it works on.
  else if (session.context?.attention?.text) lines.push(first("SAID", styles.muted, styles.muted(truncate(plainAttentionText(session.context.attention.text), valueWidth)), 2));
  else if (task) lines.push(first("TASK", styles.muted, styles.muted(truncate(plainAttentionText(task), valueWidth)), 2));
  else if (right) lines.push({ line: twoColumn("", right, width), priority: 2 });
  if (session.deliveryResult) lines.push({ line: receiptLine(session, width, styles), priority: 0 });
  return lines;
}

interface DetailFieldOptions {
  terminalWidth: number;
  now: number;
  hideQuestion?: boolean;
  /** An Answer or Reply panel is open: keep what the agent asked and said, drop position and activity. */
  replying?: boolean;
}

const LOG_ACTIONS = 3;
const SAID_LINES = 14;

/**
 * The selected session's fields in fixed order: the request (ASK/RDY/BLK) or ERR, the lens DOING (else the
 * DONE and NEXT progress note), WHERE, the lens list, NOW and LOG tool calls, SUB, then SAID, the agent's
 * latest message. A label appears only with a value.
 */
function detailFieldLines(session: RenderSession, width: number, styles: LayoutStyles, options: DetailFieldOptions): FieldLine[] {
  const lines: FieldLine[] = [];
  const valueWidth = Math.max(4, width - FIELD_INDENT.length);
  // Sentences wrap at a reading measure; a wide pane does not stretch them edge to edge.
  const proseWidth = Math.min(valueWidth, PROSE_MEASURE);
  const attention = session.attention;
  const question = session.pendingQuestion;
  // A focused answer panel already shows the question, and the request it answers.
  const request = question && options.hideQuestion ? undefined
    : question ? { kind: "question" as const, text: `${question.header} ${glyphs.pendingStep} ${question.question}` } : attention;
  if (request) {
    const words = wrapWords(plainAttentionText(request.text), proseWidth, proseWidth);
    const recommendations = attention?.recommendation ? wrapWords(`${glyphs.right} ${plainAttentionText(attention.recommendation)}`, proseWidth, proseWidth).map(styles.muted) : [];
    // One line that keeps the file name: a long path loses its start, not its end.
    const artifact = attention?.artifact ? [styles.muted(`${glyphs.artifact} ${truncateValue(plainAttentionText(attention.artifact), Math.max(1, valueWidth - 2), "start")}`)] : [];
    lines.push(...fieldLines(requestLabel(request.kind), styles.warning, [...words.map(styles.strong), ...recommendations, ...artifact], [0]));
  }
  if (session.deliveryResult) lines.push({ line: receiptLine(session, width, styles), priority: 0 });
  const error = session.displayStatus === "error" && session.error ? plainAttentionText(session.error) : "";
  if (error) lines.push(...fieldLines("ERR", styles.error, wrapWords(error, proseWidth, proseWidth).map(styles.text), [0]));
  const compact = options.terminalWidth < SIDE_PANE_MIN_WIDTH;
  // The side pane has rows to spare: a blank row separates request, position, activity, progress and message.
  const group = () => { if (!compact && lines.length && lines.at(-1)!.line !== "") lines.push({ line: "", priority: 4 }); };
  group();
  const note = (label: string, value: string | undefined) => {
    if (value) lines.push(...fieldLines(label, styles.muted, wrapWords(plainAttentionText(value), proseWidth, proseWidth).map(styles.text), [2]));
  };
  const notes = () => {
    // A ready handoff already says what was done.
    if (request?.kind !== "ready") note("DONE", session.progress?.done);
    // An open request is what comes next; the note's guess would only repeat it.
    if (!request) note("NEXT", session.progress?.next);
  };
  // The producer's DOING replaces the progress note; without one the side pane leads with the agent's own
  // summary and the short dock keeps position first.
  const doing = lensOf(session)?.doing;
  if (doing) lines.push(...fieldLines("DOING", styles.muted, wrapWords(plainAttentionText(doing), proseWidth, proseWidth).map(styles.strong), [1]));
  else if (!compact) { notes(); group(); }
  const where = options.replying ? "" : whereLine(session, width, styles, options.terminalWidth);
  if (where) lines.push({ line: where, priority: 3 });
  group();
  if (!options.replying) lines.push(...lensListLines(session, valueWidth, styles, compact));
  group();
  // A timeline: how long ago in a fixed column beside the call, so the eye does not cross the pane for it.
  const actionRow = (action: SessionAction, tone: (text: string) => string) =>
    `${styles.dim(pad(ageLabel(Math.max(0, options.now - action.at)), ACTION_AGE_WIDTH))} ${actionText(action, valueWidth - ACTION_AGE_WIDTH - 1, styles, tone)}`;
  const current = session.displayStatus === "running" ? session.activity?.current : undefined;
  const now = options.replying || !current ? [] : [actionRow(current, styles.text)];
  // A running agent between tool calls is thinking; the card says so instead of looking idle.
  const thinking = !options.replying && !now.length && session.displayStatus === "running" && session.kind !== "subagent";
  if (thinking) now.push(styles.text(`Thinking${glyphs.ellipsis}`));
  if (now.length) lines.push(...fieldLines("NOW", styles.live, now, [2]));
  const recent = options.replying ? [] : (session.activity?.recent ?? []).slice(0, compact ? 1 : LOG_ACTIONS);
  if (recent.length) lines.push(...fieldLines("LOG", styles.muted, recent.map((action) => actionRow(action, styles.muted)), [3]));
  if (compact && !doing) notes();
  // A collapsed tree is doing whatever its running subagents are doing; an expanded tree lists them.
  const child = session.boardExpanded || options.replying ? undefined : session.runningSubagent;
  if (child) {
    const more = (session.runningSubagentCount ?? 1) - 1;
    const doing = [styles.text(child.agentName), child.taskPreview && styles.muted(plainAttentionText(child.taskPreview)), more > 0 && styles.muted(`+${more} more`)]
      .filter(Boolean).join(styles.muted(` ${glyphs.pendingStep} `));
    lines.push(...fieldLines("SUB", styles.muted, [truncate(doing, valueWidth)], [3]));
  }
  group();
  // Without the live message (a session not yet reloaded), a handoff you already read still says what it reported.
  const message = session.lastMessage ?? (!request && !options.replying && session.displayStatus !== "running" ? session.context?.attention?.text : undefined);
  if (message) {
    // The side pane sets the message apart under its own rule, from the label column, with its emphasis kept.
    const ruled = !compact;
    const said = renderMarkdown(message, ruled ? Math.min(width, PROSE_MEASURE + FIELD_INDENT.length) : valueWidth, styles.theme, true).filter((line, index, all) => stripAnsi(line).trim() || stripAnsi(all[index - 1] ?? "").trim());
    // Collapsed, the cap counts text lines only, so paragraph breaks do not halve it.
    let textLines = 0;
    // Beside an open question or reply the message is context: a few lines, so the editor leads.
    const cap = options.replying ? SAID_LINES_REPLYING : SAID_LINES;
    const cut = session.messageExpanded && !options.replying ? said.length : said.findIndex((line) => stripAnsi(line).trim() && ++textLines > cap);
    const shown = cut < 0 ? said : said.slice(0, cut);
    while (shown.length && !stripAnsi(shown.at(-1)!).trim()) shown.pop();
    // The panel owns the keys while it is open, so the fold names no key there.
    if (shown.length < said.length) shown.push(styles.muted(`${glyphs.ellipsis} ${said.length - shown.length} more lines${options.replying ? "" : ` ${glyphs.pendingStep} C Full message`}`));
    else if (session.messageExpanded) shown.push(styles.muted(`C Fold ${glyphs.pendingStep} c Conversation`));
    if (ruled) {
      const head = `${styles.dim(glyphs.horizontal.repeat(2))} ${styles.muted("SAID")} `;
      lines.push({ line: `${head}${styles.dim(glyphs.horizontal.repeat(Math.max(0, width - displayWidth(head))))}`, priority: 3 }, ...shown.map((line) => ({ line, priority: 3 })));
    } else lines.push(...fieldLines("SAID", styles.muted, shown, [3]));
  }
  while (lines.at(-1)?.line === "") lines.pop();
  // A card with nothing to report says so, with how long the session has been quiet.
  if (!lines.length && !options.replying && session.kind !== "subagent") {
    const quiet = `${session.displayStatus === "stopped" ? "Stopped" : "Idle"}${session.activityAge && session.activityAge !== "now" ? ` ${session.activityAge}` : ""}`;
    lines.push({ line: styles.muted(`${quiet} ${glyphs.pendingStep} nothing reported yet`), priority: 3 });
  }
  return lines;
}

function renderSessionRow(session: RenderSession, width: number, styles: LayoutStyles, options: SessionRowOptions): string {
  const selection = session.selected ? selectionMarker(styles.accent(glyphs.selected)) : " ";
  const state = session.attention ? attentionGlyph(session.attention.kind, styles)
    : session.section === "active" ? styles.status(session.displayStatus, session.symbol)
    : styles.muted(session.symbol);
  const sidePaneMarker = pinGlyph(session, styles);

  if (session.kind === "subagent") {
    const branch = session.depth > 1 ? `${glyphs.vertical}${glyphs.treeEnd}` : options.childLast ? `${glyphs.treeEnd}${glyphs.horizontal}` : `${glyphs.treeBranch}${glyphs.horizontal}`;
    const prefix = `${selection}${options.gutterColumn ? "  " : " "}${styles.dim(branch)} ${state} ${sidePaneMarker}`;
    const available = Math.max(0, width - displayWidth(prefix));
    const task = session.taskPreview?.trim() ?? "";
    const minTask = task ? Math.min(8, Math.max(0, available - 10)) : 0;
    const nameWidth = Math.max(0, Math.min(20, available - (task ? minTask + 1 : 0)));
    const name = styles.muted(truncate(session.agentName ?? "subagent", nameWidth));
    const taskWidth = Math.max(0, available - displayWidth(name) - (task ? 1 : 0));
    const taskText = task ? ` ${styles.muted(truncate(task, taskWidth))}` : "";
    return truncate(`${prefix}${name}${taskText}`, width);
  }

  const disclosure = session.boardDescendantCount
    ? styles.accent(session.boardExpanded ? glyphs.expanded : glyphs.collapsed)
    : " ";
  const prefix = `${selection}${options.gutterColumn ? "  " : " "}${disclosure} ${state} ${sidePaneMarker}`;
  const worktree = session.worktreeMarker ? ` ${worktreeMarkerStyle(session.worktreeMarker, styles)}` : "";
  if (options.titleFirst) {
    const markers = options.card ? cardMarkers(session, styles) : "";
    const available = Math.max(0, width - displayWidth(prefix) - displayWidth(worktree) - displayWidth(markers));
    const right = options.oneLine ? fleetOneLineTail(session, available, styles, options) : "";
    const titleSpace = available - (right ? displayWidth(right) + 1 : 0);
    const newMarker = newBadge(session, titleSpace, styles);
    const title = truncate(session.title, titleSpace - displayWidth(newMarker));
    const identityRoom = titleSpace - displayWidth(title) - displayWidth(newMarker) - 3;
    // The group shows whole, or with enough of it left to read; a two-letter stub only adds noise.
    const identity = options.card && identityRoom >= Math.min(displayWidth(session.group), 10) ? `   ${cardIdentity(session, styles, options, identityRoom)}` : "";
    const left = `${prefix}${styles.strong(title)}${worktree}${markers}${newMarker}${identity}`;
    return right ? twoColumn(left, right, width) : truncate(left, width);
  }
  const repoCount = options.terminalWidth >= 80 && session.repoCount > 1 ? styles.muted(` ${glyphs.repos} ${session.repoCount}`) : "";
  const badgeBudget = Math.min(options.terminalWidth <= NARROW_LAYOUT_MAX_WIDTH ? 8 : options.terminalWidth >= 100 ? 24 : 18, Math.max(8, Math.floor(width * 0.4)));
  const showGroup = !options.board || options.terminalWidth < 100;
  const badge = showGroup ? `${renderGroupBadge(session.group, badgeBudget, styles)} ` : "";
  const adornments = `${badge}${repoCount}`;
  const rightWidthBase = Math.max(0, width - displayWidth(prefix) - displayWidth(worktree) - displayWidth(adornments));
  let right = rowRightAdornment(session, styles, options.board, options.repoMode, rightWidthBase, options.terminalWidth, options.workflowCell);
  if (options.terminalWidth <= NARROW_LAYOUT_MAX_WIDTH && session.section === "active" && !activeWorkflowMode(session)
    && rightWidthBase - displayWidth(right) - 1 < Math.min(18, displayWidth(session.title))) {
    right = session.hiddenChildRequestCount ? styles.warning(`?${session.hiddenChildRequestCount}`) : "";
  }
  const rightSpace = right ? displayWidth(right) + 1 : 0;
  const minimumTitle = Math.min(8, Math.max(0, width - displayWidth(prefix) - displayWidth(worktree) - 4));
  const availableAdornments = Math.max(0, width - displayWidth(prefix) - displayWidth(worktree) - minimumTitle - rightSpace);
  const fittedBadgeWidth = Math.min(badgeBudget, Math.max(0, availableAdornments - 1));
  const fittedBadge = showGroup && fittedBadgeWidth >= 3 ? `${renderGroupBadge(session.group, fittedBadgeWidth, styles)} ` : "";
  const fittedCount = displayWidth(fittedBadge) + displayWidth(repoCount) <= availableAdornments ? repoCount : "";
  const fittedAdornments = `${fittedBadge}${fittedCount}`;
  const titleSpace = Math.max(0, width - displayWidth(prefix) - displayWidth(worktree) - displayWidth(fittedAdornments) - rightSpace);
  const newMarker = newBadge(session, titleSpace, styles);
  const title = styles.strong(truncate(session.title, titleSpace - displayWidth(newMarker)));
  const left = `${prefix}${fittedBadge}${title}${worktree}${newMarker}${fittedCount}`;
  return right ? twoColumn(left, right, width) : truncate(left, width);
}

const NEW_BADGE = " new";

/** Drops before the title would truncate below its readable minimum. */
function newBadge(session: RenderSession, titleSpace: number, styles: LayoutStyles): string {
  if (!session.unopened) return "";
  const titleNeed = Math.min(12, displayWidth(session.title));
  return titleSpace - NEW_BADGE.length >= titleNeed ? styles.accent(NEW_BADGE) : "";
}

function worktreeMarkerStyle(marker: NonNullable<RenderSession["worktreeMarker"]>, styles: LayoutStyles): string {
  if (marker === glyphs.worktreePending || marker === glyphs.worktreeWarning) return styles.warning(marker);
  return styles.muted(marker);
}

function renderGroupBadge(group: string, width: number, styles: LayoutStyles): string {
  return `${styles.dim("[")}${styles.muted(truncate(group, width - 2))}${styles.dim("]")}`;
}

export interface FormField {
  key: string;
  label: string;
  value: string;
  cursor?: number;
  hint?: string;
  error?: string;
  section?: string;
  truncate?: "end" | "start";
  readonly?: boolean;
  primary?: boolean;
  frame?: "input" | "picker";
}

export interface FormSpec {
  title: string;
  fields: FormField[];
  focus: string;
  footer: string;
  narrowFooter?: string;
  compact?: boolean;
  height?: number;
  detailOffset?: number;
  /** Receives one whole-row hit per visible field line, plus footer key taps. */
  hits?: DialogHitSink<string>;
}

interface FormLine {
  text: string;
  key?: string;
}

export function renderForm(spec: FormSpec, width: number, theme?: SessionsTheme): string[] {
  const styles = theme ? createStyles(theme) : plainStyles();
  const inner = Math.max(20, Math.min(Math.max(20, width - 2), 86));
  const narrow = width <= NARROW_LAYOUT_MAX_WIDTH;
  const showHints = inner >= 38;
  const labelWidth = Math.max(...spec.fields.map((field) => displayWidth(field.label)), 5);
  let previousSection: string | undefined;
  const fieldBlocks = spec.fields.map((field) => {
    const lines: FormLine[] = [];
    if (field.section && field.section !== previousSection) {
      lines.push({ text: `  ${styles.muted(field.section)}` });
      previousSection = field.section;
    }
    const focused = field.key === spec.focus;
    const stacked = narrow && (!field.readonly || Boolean(field.frame));
    const valueWidth = stacked ? Math.max(0, inner - 2) : inner - labelWidth - 4;
    const caret = focused ? styles.accent(glyphs.focus) : " ";
    const label = focused ? field.label : styles.muted(field.label);
    const prefix = field.frame ? "[ " : "";
    const suffix = field.frame === "picker" ? ` ${glyphs.expanded} ]` : field.frame ? " ]" : "";
    const contentWidth = Math.max(0, valueWidth - prefix.length - suffix.length);
    const focusedValue = field.readonly
      ? truncateValue(field.value, contentWidth, field.truncate)
      : renderCursorValue(field.value, field.cursor, contentWidth, field.truncate);
    const rawValue = focused ? styles.accent(focusedValue) : truncateValue(field.value, contentWidth, field.truncate);
    const content = field.readonly && !focused
      ? field.primary ? styles.accent(rawValue) : styles.muted(rawValue)
      : rawValue;
    const value = `${styles.border(prefix)}${content}${styles.border(suffix)}`;
    if (stacked) {
      lines.push({ text: `${caret} ${truncate(label, Math.max(0, inner - 2))}`, key: field.key });
      lines.push({ text: `  ${value}`, key: field.key });
    } else {
      lines.push({ text: `${caret} ${pad(label, labelWidth)}  ${value}`, key: field.key });
    }
    const hintText = !narrow && !spec.compact
      ? field.error ? styles.error(field.error) : (showHints && field.hint ? styles.muted(field.hint) : "")
      : "";
    if (hintText) lines.push({ text: `  ${pad("", labelWidth)}  ${truncate(hintText, valueWidth)}`, key: field.key });
    if (!spec.compact) lines.push({ text: "" });
    return lines;
  });
  const focusedField = spec.fields.find((field) => field.key === spec.focus);
  const detailText = focusedField?.error
    ? `${focusedField.label}: ${focusedField.error}`
    : showHints && focusedField?.hint ? focusedField.hint : "";
  const detailLines = detailText ? wrapWords(detailText, inner, inner) : [];
  const contentRows = spec.height && spec.height > 0 ? Math.max(1, spec.height - 7) : undefined;
  const detailLimit = narrow
    ? contentRows !== undefined
      ? contentRows >= 3 ? Math.min(detailLines.length ? 3 : 1, contentRows - 2) : 0
      : Math.max(1, Math.min(3, detailLines.length))
    : spec.compact ? 1 : 0;
  const detailOffset = Math.max(0, Math.min(spec.detailOffset ?? 0, Math.max(0, detailLines.length - detailLimit)));
  const visibleDetail = !narrow && spec.compact
    ? [truncate(focusedField?.error ? styles.error(detailText) : detailText ? styles.muted(detailText) : "", inner)]
    : detailLines.slice(detailOffset, detailOffset + detailLimit).map((line) =>
      focusedField?.error ? styles.error(line) : styles.muted(line));
  while (visibleDetail.length < detailLimit) visibleDetail.push("");
  const availableFieldRows = contentRows === undefined ? undefined : Math.max(1, contentRows - visibleDetail.length);
  const visibleBlocks = availableFieldRows === undefined
    ? fieldBlocks
    : windowFormBlocks(fieldBlocks, Math.max(0, spec.fields.findIndex((field) => field.key === spec.focus)), availableFieldRows);
  const visibleFields = visibleBlocks.flat();
  const fieldPadding = contentRows === undefined
    ? []
    : Array.from({ length: Math.max(0, contentRows - visibleFields.length - visibleDetail.length) }, () => "");
  const body: string[] = [
    styles.accent(spec.title),
    styles.border(glyphs.horizontal.repeat(inner)),
    "",
    ...visibleFields.map((line) => line.text),
    ...fieldPadding,
    ...visibleDetail,
    styles.border(glyphs.horizontal.repeat(inner)),
  ];
  const footer = narrow && displayWidth(spec.footer) > inner ? (spec.narrowFooter ?? `Enter Confirm ${glyphs.pendingStep} Esc Cancel`) : spec.footer;
  if (spec.hits) {
    // The frame's top border precedes the title, rule and blank row.
    visibleFields.forEach((line, index) => {
      const action = line.key === undefined ? undefined : spec.hits!.target(line.key);
      if (action) spec.hits!.out.push({ ...action, row: 4 + index });
    });
    spec.hits.out.push(...footerHits(body.length + 1, footer, DIALOG_CONTENT_X, inner));
  }
  body.push(truncate(styles.muted(footer), inner));
  return frame(width, body, styles);
}

function windowFormBlocks(blocks: FormLine[][], focusIndex: number, rowLimit: number): FormLine[][] {
  if (blocks.reduce((total, block) => total + block.length, 0) <= rowLimit) return blocks;
  const focusedBlock = blocks[focusIndex] ?? [];
  if (focusedBlock.length > rowLimit) {
    const required = [...focusedBlock];
    while (required.at(-1)?.text === "") required.pop();
    return rowLimit > 0 ? [required.slice(-rowLimit)] : [];
  }
  let start = focusIndex;
  let end = focusIndex + 1;
  let rows = focusedBlock.length;
  let before = focusIndex - 1;
  let after = focusIndex + 1;
  let preferBefore = true;
  while (before >= 0 || after < blocks.length) {
    const candidates: Array<{ index: number; side: "before" | "after" }> = preferBefore
      ? [{ index: before, side: "before" }, { index: after, side: "after" }]
      : [{ index: after, side: "after" }, { index: before, side: "before" }];
    const candidate = candidates.find(({ index }) => index >= 0 && index < blocks.length && rows + blocks[index]!.length <= rowLimit);
    if (!candidate) break;
    rows += blocks[candidate.index]!.length;
    if (candidate.side === "before") {
      start = candidate.index;
      before = candidate.index - 1;
    } else {
      end = candidate.index + 1;
      after = candidate.index + 1;
    }
    preferBefore = candidate.side !== "before";
  }
  return blocks.slice(start, end);
}

export function inputCursor(now: number): string {
  const marker = Math.floor(now / 1_000) % 2 === 0 ? glyphs.cursor : glyphs.selected;
  return `\u001b[5m${marker}\u001b[25m`;
}

export function renderCursorValue(value: string, cursor: number | undefined, width: number, mode: "end" | "start" | undefined, marker = glyphs.cursor): string {
  if (width <= 0) return "";
  const chars = [...value];
  const pos = Math.max(0, Math.min(cursor ?? chars.length, chars.length));
  const rendered = renderTextInput(createTextInput(value, pos), marker);
  if (displayWidth(rendered) <= width) return rendered;
  if (mode === "start" || displayWidth(chars.slice(0, pos).join("")) >= width - 1) {
    let start = pos;
    let before = "";
    const markerWidth = displayWidth(marker);
    const prefixWidth = displayWidth(glyphs.ellipsis);
    while (start > 0 && displayWidth(chars[start - 1]! + before) <= width - markerWidth - prefixWidth) {
      before = chars[--start]! + before;
    }
    const prefix = start > 0 && width >= prefixWidth + markerWidth ? glyphs.ellipsis : "";
    let result = `${prefix}${before}${marker}`;
    for (const char of chars.slice(pos)) {
      if (displayWidth(result + char) > width) break;
      result += char;
    }
    return result;
  }
  return truncate(rendered, width);
}

function truncateValue(value: string, width: number, mode: "end" | "start" | undefined): string {
  if (width <= 0) return "";
  if (displayWidth(value) <= width) return value;
  if (mode !== "start") return truncate(value, width);
  const prefixWidth = displayWidth(glyphs.ellipsis);
  if (width <= prefixWidth) return "";
  const visible = stripAnsi(value);
  const tail = sliceByColumn(visible, displayWidth(visible) - width + prefixWidth, width - prefixWidth, true);
  return `${glyphs.ellipsis}${tail}`;
}

export function renderDialog(title: string, rows: string[], width: number, theme?: SessionsTheme): string[] {
  const styles = theme ? createStyles(theme) : plainStyles();
  const inner = Math.max(20, Math.min(Math.max(20, width - 2), 86));
  const body = [styles.accent(title), styles.border(glyphs.horizontal.repeat(Math.min(inner, Math.max(0, displayWidth(title) + 8)))), ...rows];
  return frame(width, body, styles);
}

/** Dialog frame; the dashboard itself is frameless. */
function frame(width: number, body: string[], styles: LayoutStyles): string[] {
  const inner = Math.max(20, Math.min(Math.max(20, width - 2), 86));
  const top = `${styles.border(glyphs.topLeft)}${styles.border(glyphs.horizontal.repeat(inner))}${styles.border(glyphs.topRight)}`;
  const bottom = `${styles.border(glyphs.bottomLeft)}${styles.border(glyphs.horizontal.repeat(inner))}${styles.border(glyphs.bottomRight)}`;
  return [top, ...body.map((line) => `${styles.border(glyphs.vertical)}${pad(line, inner)}${styles.border(glyphs.vertical)}`), bottom];
}

function twoColumn(left: string, right: string, width: number): string {
  if (!right) return truncate(left, width);
  const rightWidth = displayWidth(right);
  if (rightWidth >= width) return truncate(right, width);
  const visibleLeft = truncate(left, Math.max(0, width - rightWidth - 1));
  const gap = Math.max(1, width - displayWidth(visibleLeft) - rightWidth);
  return `${visibleLeft}${" ".repeat(gap)}${right}`;
}

function pad(value: string, width: number): string {
  const text = truncate(value, width);
  return `${text}${" ".repeat(Math.max(0, width - displayWidth(text)))}`;
}

export function truncate(value: string, width: number): string {
  if (width <= 1) return "";
  return truncateToWidth(value, width, glyphs.ellipsis);
}

function displayWidth(value: string): number {
  return visibleWidth(value);
}
