import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { plainTerminalText } from "../core/terminal-text.js";
import type { WorkflowModeDisplay, WorkflowRuntimeSnapshot } from "../core/types.js";
import type { CockpitTier, RenderModel, RenderSession, RenderWorkspace } from "./render-model.js";
import { createTextInput, renderTextInput } from "./text-input.js";
import { hasUsefulStatusResult, statusEvidenceFields, type StatusEvidenceField } from "./status-evidence.js";
import { darkTheme, stripAnsi, styleBgToken, styleToken, type SessionsTheme } from "./theme.js";

export type SessionListTarget =
  | { kind: "session"; id: string }
  | { kind: "session-continuation"; id: string }
  | { kind: "archive-disclosure" }
  | { kind: "release-cue" }
  | { kind: "section-header"; section: "archived" };

export interface TierNavigatorTarget {
  tier: CockpitTier;
}

export interface SessionsLayout {
  lines: string[];
  rowTargets: (SessionListTarget | undefined)[];
  navigatorRowTargets: (TierNavigatorTarget | undefined)[];
  workspaceRowTargets: (string | undefined)[];
  announcementRowTargets: (string | undefined)[];
  navigatorWidth: number;
  listStartX: number;
  workspaceStartX?: number;
  listWidth: number;
  listScrollTop: number;
}

export function renderSessions(model: RenderModel, theme?: SessionsTheme): SessionsLayout {
  const styles = theme ? createStyles(theme) : plainStyles();
  const width = Math.max(40, model.width);
  const emptyLayout = (lines: string[]): SessionsLayout => ({
    lines,
    rowTargets: lines.map(() => undefined),
    navigatorRowTargets: lines.map(() => undefined),
    workspaceRowTargets: lines.map(() => undefined),
    announcementRowTargets: lines.map(() => undefined),
    navigatorWidth: 0,
    listStartX: 2,
    listWidth: 0,
    listScrollTop: 0,
  });
  if (model.empty && !model.guidance.coach && !model.guidance.releaseCue) {
    return emptyLayout(box(width, fitBoxBody(emptyLines(width, styles), model.height), styles));
  }

  const bodyWidth = width - 2;
  if (model.noBoardSessions) {
    const announcement = renderAttentionAnnouncement(model, bodyWidth, styles, !model.height || model.height >= 10);
    const body = [renderTopSummary(model, bodyWidth, styles), ...announcement.lines, ...(model.pinSummary ? [renderPinSummary(model, bodyWidth, styles)] : []), ...noBoardLines(width, model, styles), styles.border("─".repeat(bodyWidth)), styleFooter(model.footer, styles)];
    const layout = emptyLayout(box(width, fitBoxBody(body, model.height), styles));
    for (let i = 0; i < announcement.targets.length; i += 1) layout.announcementRowTargets[2 + i] = announcement.targets[i];
    return layout;
  }
  if (model.showWorkspace && model.workspace?.fullScreen) {
    return renderWorkspaceScreen(model.workspace, width, model.height, model.now, styles);
  }

  const workspaceWidth = model.showWorkspace ? (width >= 160 ? 44 : 34) : 0;
  const navigatorWidth = model.grouping === "project" && !model.pinMode && width >= 100 ? (width >= 120 ? 17 : 16) : 0;
  const listWidth = bodyWidth
    - workspaceWidth - (workspaceWidth ? 1 : 0)
    - navigatorWidth - (navigatorWidth ? 1 : 0);
  const listStartX = 2 + navigatorWidth + (navigatorWidth ? 1 : 0);
  const decision = model.pinMode && model.workspace
    ? renderPinnedDecisionStrip(model.workspace, bodyWidth, pinnedDecisionRows(model.height), model.now, styles)
    : { lines: [] as string[], targets: [] as (string | undefined)[] };
  const baseStripLines = (model.pinSummary ? 1 : 0) + decision.lines.length;
  const announcement = renderAttentionAnnouncement(model, bodyWidth, styles,
    !model.height || model.height - 5 - baseStripLines - (model.pinMode ? 1 : 2) >= 4);
  const stripLines = announcement.lines.length + baseStripLines;
  const targetRows = bodyRowsFromHeight(model.height, stripLines);
  const left = renderSessionList(model, listWidth, styles);
  const workspace = model.showWorkspace && model.workspace
    ? renderActionWorkspace(model.workspace, workspaceWidth, targetRows, model.now, styles)
    : { lines: [] as string[], targets: [] as (string | undefined)[] };
  const rows = targetRows ?? Math.max(left.lines.length, workspace.lines.length, 8);
  const navigator = renderTierNavigator(model, navigatorWidth, rows, styles);
  const windowedLeft = windowList(left, rows, model.listScrollTop ?? 0, styles);
  const body: string[] = [renderTopSummary(model, bodyWidth, styles), ...announcement.lines];
  if (model.pinSummary) body.push(renderPinSummary(model, bodyWidth, styles));
  body.push(...decision.lines);
  const visibleLinesByOwner = new Map<string, number>();
  for (const meta of windowedLeft.lineMeta) {
    if (meta?.ownerId && meta.richTree) visibleLinesByOwner.set(meta.ownerId, (visibleLinesByOwner.get(meta.ownerId) ?? 0) + 1);
  }
  for (let i = 0; i < rows; i += 1) {
    const meta = windowedLeft.lineMeta[i];
    const capped = decorateAttentionSectionCap(windowedLeft.lines[i] ?? "", meta, visibleLinesByOwner, styles);
    const gutterMeta = meta?.ownerId && (visibleLinesByOwner.get(meta.ownerId) ?? 0) > 1 ? meta : undefined;
    const decorated = decorateTreeGutter(capped, gutterMeta, styles);
    const padded = pad(decorated, listWidth);
    const selected = Boolean(left.selectedOwnerId && meta?.ownerId === left.selectedOwnerId)
      || (!left.selectedOwnerId && i >= windowedLeft.selectedIndex && i <= windowedLeft.selectedEndIndex);
    const leftLine = selected ? styles.selected(padded) : padded;
    const navLine = navigatorWidth ? `${pad(navigator.lines[i] ?? "", navigatorWidth)}${styles.border("│")}` : "";
    const workspaceLine = workspaceWidth ? `${styles.border("│")}${pad(workspace.lines[i] ?? "", workspaceWidth)}` : "";
    body.push(`${navLine}${leftLine}${workspaceLine}`);
  }
  body.push(styles.border("─".repeat(bodyWidth)));
  body.push(truncate(styleFooter(model.footer, styles), bodyWidth));
  const lines = box(width, body, styles);
  const rowTargets = lines.map(() => undefined as SessionListTarget | undefined);
  const navigatorRowTargets = lines.map(() => undefined as TierNavigatorTarget | undefined);
  const workspaceRowTargets = lines.map(() => undefined as string | undefined);
  const announcementRowTargets = lines.map(() => undefined as string | undefined);
  for (let i = 0; i < announcement.targets.length; i += 1) announcementRowTargets[2 + i] = announcement.targets[i];
  const decisionStart = 2 + announcement.lines.length + (model.pinSummary ? 1 : 0);
  for (let i = 0; i < decision.targets.length; i += 1) workspaceRowTargets[decisionStart + i] = decision.targets[i];
  for (let i = 0; i < rows; i += 1) {
    const lineIndex = 2 + stripLines + i;
    rowTargets[lineIndex] = windowedLeft.targets[i];
    navigatorRowTargets[lineIndex] = navigator.targets[i];
    workspaceRowTargets[lineIndex] = workspace.targets[i];
  }
  return {
    lines,
    rowTargets,
    navigatorRowTargets,
    workspaceRowTargets,
    announcementRowTargets,
    navigatorWidth,
    listStartX,
    ...(workspaceWidth ? { workspaceStartX: listStartX + listWidth + 1 } : decision.lines.length ? { workspaceStartX: 2 } : {}),
    listWidth,
    listScrollTop: windowedLeft.top,
  };
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
  const tone = newest.kind === "blocked" ? styles.error : newest.kind === "ready" ? styles.success : styles.warning;
  const glyph = newest.kind === "blocked" ? "!" : newest.kind === "ready" ? "✓" : "?";
  const label = active.length > 1 ? `${glyph} ${active.length} NEW` : `${glyph} ${newest.kind.toUpperCase()}`;
  const identity = plainAttentionText(newest.ownerTitle ? `${newest.title} → ${newest.ownerTitle}` : newest.title);
  const workspaceDuplicatesRequest = model.workspace?.session.id === newest.sessionId;
  const more = model.width >= 100 && active.length > 1 ? styles.dim(`+${active.length - 1} more`) : undefined;
  const leftPrefix = [tone("┃"), tone(label)].join("  ");
  const left = `${leftPrefix}  ${identity}`;
  const locate = `${styles.accent(":")} ${styles.dim("locate")}`;
  const fixedTail = [more, locate, model.width >= 160 ? styles.dim("6s") : undefined]
    .filter((part): part is string => Boolean(part)).join("  ");
  const request = model.width >= 100 && !model.pinMode && !workspaceDuplicatesRequest
    ? `“${plainAttentionText(newest.text)}”`
    : undefined;
  const requestBudget = request
    ? Math.max(0, width - displayWidth(leftPrefix) - Math.min(16, displayWidth(identity)) - displayWidth(fixedTail) - 3)
    : 0;
  const detail = request && requestBudget > 1 ? styles.muted(truncate(request, requestBudget)) : undefined;
  const tail = [detail, fixedTail].filter(Boolean).join("  ");
  const commandId = `view:locate-attention:${encodeURIComponent(newest.sessionId)}:${encodeURIComponent(newest.requestId)}`;
  const content = pad(twoColumn(left, tail, width), width);
  if (model.pinMode) return { lines: [content], targets: [commandId] };
  return { lines: [content, styles.border("─".repeat(width))], targets: [commandId, undefined] };
}

function plainAttentionText(value: string): string {
  return plainTerminalText(stripAnsi(value));
}

function renderTierNavigator(model: RenderModel, width: number, rows: number, styles: LayoutStyles): { lines: string[]; targets: (TierNavigatorTarget | undefined)[] } {
  if (!width) return { lines: [], targets: [] };
  const lines = [styles.dim("TIERS")];
  const targets: (TierNavigatorTarget | undefined)[] = [undefined];
  for (const entry of model.cockpitNavigation) {
    const tone = cockpitTone(entry.tier, styles);
    const label = entry.ownerCount ? tone(entry.label) : styles.dim(entry.label);
    const count = styles.dim(String(entry.ownerCount));
    const line = pad(twoColumn(label, count, width), width);
    lines.push(entry.selected ? styles.selected(line) : line);
    targets.push(entry.ownerCount && entry.firstOwnerId ? { tier: entry.tier } : undefined);
  }
  return {
    lines: [...lines, ...Array.from({ length: Math.max(0, rows - lines.length) }, () => "")].slice(0, rows),
    targets: [...targets, ...Array.from({ length: Math.max(0, rows - targets.length) }, () => undefined)].slice(0, rows),
  };
}

function renderWorkspaceScreen(workspace: RenderWorkspace, width: number, height: number | undefined, now: number, styles: LayoutStyles): SessionsLayout {
  const bodyWidth = width - 2;
  const bodyRows = height && height > 0 ? Math.max(2, height - 2) : undefined;
  const contentRows = bodyRows === undefined ? undefined : Math.max(0, bodyRows - 2);
  const rendered = renderActionWorkspace(workspace, bodyWidth, contentRows, now, styles);
  const footer = workspaceFooter(workspace);
  const content = contentRows === undefined
    ? rendered.lines
    : [...rendered.lines.slice(0, contentRows), ...Array.from({ length: Math.max(0, contentRows - rendered.lines.length) }, () => "")];
  const lines = box(width, [...content, styles.border("─".repeat(bodyWidth)), truncate(styleFooter(footer, styles), bodyWidth)], styles);
  const workspaceRowTargets = lines.map(() => undefined as string | undefined);
  for (let i = 0; i < content.length; i += 1) workspaceRowTargets[i + 1] = rendered.targets[i];
  return {
    lines,
    rowTargets: lines.map(() => undefined),
    navigatorRowTargets: lines.map(() => undefined),
    workspaceRowTargets,
    announcementRowTargets: lines.map(() => undefined),
    navigatorWidth: 0,
    listStartX: 2,
    workspaceStartX: 2,
    listWidth: 0,
    listScrollTop: 0,
  };
}

// Footer strings stay plain in the render model for testability; keys get
// accent, labels dim, separators border here.
function styleFooter(footer: string, styles: LayoutStyles): string {
  return footer.split("│").map((segment) =>
    segment.split(" · ").map((part) => {
      const match = /^(\s*)(\S+)((?: .*)?)$/.exec(part);
      if (!match) return part;
      const [, lead = "", key = "", label = ""] = match;
      return `${lead}${styles.accent(key)}${label ? styles.dim(label) : ""}`;
    }).join(styles.border(" · ")),
  ).join(styles.border("│"));
}

function bodyRowsFromHeight(height: number | undefined, stripLines = 0): number | undefined {
  if (!height || height <= 0) return undefined;
  return Math.max(1, height - 5 - stripLines);
}

function fitBoxBody(lines: string[], height: number | undefined): string[] {
  if (!height || height <= 0) return lines;
  const target = Math.max(0, height - 2);
  if (lines.length >= target) return lines.slice(0, target);
  return [...lines, ...Array.from({ length: target - lines.length }, () => "")];
}

interface LayoutStyles {
  accent(text: string): string;
  border(text: string): string;
  dim(text: string): string;
  error(text: string): string;
  success(text: string): string;
  muted(text: string): string;
  text(text: string): string;
  warning(text: string): string;
  selected(text: string): string;
  status(status: RenderSession["displayStatus"], text: string): string;
}

function createStyles(theme: SessionsTheme): LayoutStyles {
  return {
    accent: (text) => styleToken(theme, "accent", text),
    border: (text) => styleToken(theme, "border", text),
    dim: (text) => styleToken(theme, "dim", text),
    error: (text) => styleToken(theme, "error", text),
    success: (text) => styleToken(theme, "success", text),
    muted: (text) => styleToken(theme, "muted", text),
    text: (text) => styleToken(theme, "text", text),
    warning: (text) => styleToken(theme, "warning", text),
    selected: (text) => styleBgToken(theme, "selectedBg", text),
    status: (status, text) => styleToken(theme, status === "error" ? "error" : status === "waiting" ? "warning" : status === "running" ? "success" : "muted", text),
  };
}

function plainStyles(): LayoutStyles {
  return createStyles({ ...darkTheme, accent: "", border: "", dim: "", error: "", muted: "", success: "", warning: "", selectedBg: "" });
}

function emptyLines(width: number, styles: LayoutStyles): string[] {
  const inner = width - 2;
  return [
    "",
    styles.accent("No managed Pi sessions yet."),
    "",
    `${styles.accent("▶")} ${styles.accent("n")}  create a session here`,
    `  ${styles.accent("?")}  ${styles.dim("show help")}`,
    `  ${styles.accent("q")}  ${styles.dim("quit")}`,
    "",
  ].map((line) => truncate(line, inner));
}

function noBoardLines(width: number, model: RenderModel, styles: LayoutStyles): string[] {
  const inner = width - 2;
  return [
    "",
    styles.accent("No Active sessions."),
    "",
    `${styles.accent("▶")} ${styles.accent("S")}  return to project view`,
    boardHiddenSummary(model, inner, styles),
    "",
  ].map((line) => truncate(line, inner));
}

function renderTopSummary(model: RenderModel, width: number, styles: LayoutStyles): string {
  const board = model.grouping === "stage";
  const parentRows = model.sections.flatMap((section) => section.groups.flatMap((group) => group.sessions))
    .filter((session) => session.kind !== "subagent");
  const mode = model.pinMode ? "PINNED FLEET" : board ? "WORKFLOW" : "FLEET";
  const visibleTrees = board ? model.boardCardCount : model.summary.visibleOwnerTotal;
  const totalTrees = board ? model.boardTotalCardCount : model.summary.ownerTotal;
  const countLabel = model.filter !== undefined
    ? `${visibleTrees}/${totalTrees}${board ? " Active" : ""} trees`
    : `${visibleTrees}${board ? " Active" : ""} ${visibleTrees === 1 ? "tree" : "trees"}`;
  const pinCount = model.pinSummary?.slots.filter((slot) => slot.title).length ?? 0;
  const needsYou = board
    ? new Set(parentRows.filter((session) => session.cockpitTier === "needs-you").map((session) => session.cockpitOwnerId)).size
    : model.cockpitNavigation.find((entry) => entry.tier === "needs-you")?.ownerCount ?? 0;
  const health = board
    ? new Set(parentRows.filter((session) => session.cockpitTier === "health").map((session) => session.cockpitOwnerId)).size
    : model.cockpitNavigation.find((entry) => entry.tier === "health")?.ownerCount ?? 0;
  const ordered = [
    styles.accent(countLabel),
    ...(pinCount ? [styles.muted(`${pinCount} pinned`)] : []),
    ...(needsYou ? [styles.warning(`${needsYou} needs you`)] : []),
    ...(health ? [styles.error(`${health} health`)] : []),
    ...(model.filter !== undefined ? [styles.dim(`filter: ${model.filter}`)] : []),
  ];
  const required = ordered[0] ?? "";
  const needs = needsYou ? ordered.find((part) => stripAnsi(part) === `${needsYou} needs you`) : undefined;
  const candidates = [
    ordered,
    ordered.filter((part) => !stripAnsi(part).startsWith("filter: ")),
    ordered.filter((part) => !stripAnsi(part).startsWith("filter: ") && !stripAnsi(part).endsWith(" health")),
    [required, ...(needs ? [needs] : [])],
    [required],
  ].map((parts) => parts.join(styles.border(" · ")));
  return renderModeHeader(mode, candidates, width, styles);
}

function renderModeHeader(mode: string, rightCandidates: string[], width: number, styles: LayoutStyles): string {
  const left = styles.accent(mode);
  for (const right of rightCandidates) {
    if (right && displayWidth(left) + displayWidth(right) + 1 <= width) return twoColumn(left, right, width);
  }
  return truncate(left, width);
}

function groupAttentionCount(count: number, styles: LayoutStyles, muted = false): string {
  if (!count) return "";
  return (muted ? styles.muted : styles.warning)(`◐${count}`);
}

function groupBoardCounts(group: RenderModel["sections"][number]["groups"][number], parentCount: number, styles: LayoutStyles): string {
  return [groupAttentionCount(group.attentionCount, styles), styles.dim(`·${parentCount}`)].filter(Boolean).join(" ");
}

function renderPinSummary(model: RenderModel, width: number, styles: LayoutStyles): string {
  const summary = model.pinSummary;
  if (!summary) return "";
  const slots = summary.slots.map((slot) => slot.title
    ? `${slot.active ? styles.accent(`▣${slot.slot}`) : styles.muted(`▢${slot.slot}`)} ${slot.title}`
    : styles.dim(`${slot.slot} empty`));
  const constrained = summary.constrained ? ` · ${styles.warning("constrained")}` : "";
  return truncate(`${styles.dim("PINNED")} · ${slots.join(" · ")}${constrained}`, width);
}

function pinnedDecisionRows(height: number | undefined): number {
  if (height === undefined || height <= 0 || height >= 10) return 3;
  if (height >= 9) return 2;
  if (height >= 8) return 1;
  return 0;
}

function renderPinnedDecisionStrip(workspace: RenderWorkspace, width: number, rows: number, now: number, styles: LayoutStyles): WorkspaceRendered {
  if (rows <= 0) return { lines: [], targets: [] };
  const rendered = renderActionWorkspace(workspace, width, Math.max(2, rows), now, styles);
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
}

interface SessionListContent {
  lines: string[];
  targets: (SessionListTarget | undefined)[];
  lineMeta: (SessionLineMeta | undefined)[];
  selectedOwnerId?: string;
  selectedIndex: number;
  selectedEndIndex: number;
  continuationPriorities: Map<number, number>;
  contextIndexes: Map<number, number[]>;
  priorityIndexes?: number[];
}

function renderSessionList(model: RenderModel, width: number, styles: LayoutStyles): SessionListContent {
  if (model.noMatches) {
    const lines = noMatchListLines(width, model.filter ?? "", styles);
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
  const richOwners = new Set<string>();
  if (model.width >= 100 && !model.pinMode) {
    for (const session of visibleSessions) {
      if (adaptiveRowShape(session) !== "full-parent") continue;
      const hasVisibleChild = visibleSessions.some((candidate) => candidate.kind === "subagent" && candidate.cockpitOwnerId === session.cockpitOwnerId);
      const hasContinuation = adaptiveCardLines(session, Math.max(0, width - 3), styles, board, model.width).length > 0;
      if (hasVisibleChild || hasContinuation) richOwners.add(session.cockpitOwnerId);
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
  const pushRow = (session: RenderSession, siblings: RenderSession[], index: number, context: number[] = []) => {
    if (session.selected) selectedIndex = lines.length;
    const shape = adaptiveRowShape(session);
    const childLast = shape === "micro-child"
      ? !siblings.slice(index + 1).some((candidate) => candidate.kind === "subagent" && candidate.parentId === session.parentId)
      : false;
    const gutterColumn = model.width >= 100 && !model.pinMode;
    pushLine(renderSessionRow(session, width, styles, { board, terminalWidth: model.width, childLast, gutterColumn }), { kind: "session", id: session.id }, session);
    contextIndexes.set(lines.length - 1, context);
    if (shape === "full-parent" && !model.pinMode) {
      for (const continuation of adaptiveCardLines(session, Math.max(0, width - (gutterColumn ? 3 : 2)), styles, board, model.width)) {
        pushLine(`${styles.border(gutterColumn ? "   " : "  ")}${continuation.line}`, { kind: "session-continuation", id: session.id }, session);
        continuationPriorities.set(lines.length - 1, continuation.priority);
      }
    }
    if (session.selected) selectedEndIndex = lines.length - 1;
  };
  const releaseCue = model.guidance.releaseCue;
  let releaseCueRendered = false;
  const pushReleaseCue = () => {
    if (!releaseCue || releaseCueRendered) return;
    const prefix = releaseCue.selected ? `${styles.accent("▌")} ` : "  ";
    const detail = model.width >= 160 ? " · ? explains · : finds actions · Enter dismiss" : model.width >= 100 ? " · ? explains · : finds actions" : "";
    const copy = `${styles.accent(releaseCue.label)}  ${styles.muted(releaseCue.text)}${styles.dim(detail)}`;
    if (lines.length) pushLine("");
    if (releaseCue.selected) {
      selectedIndex = lines.length;
      selectedEndIndex = lines.length;
    }
    pushLine(`${prefix}${truncate(copy, Math.max(0, width - 2))}`, { kind: "release-cue" });
    releaseCueRendered = true;
  };
  let firstSection = true;
  if (releaseCue && model.sections[0]?.cockpitTier !== "needs-you") pushReleaseCue();
  for (const section of model.sections) {
    if (!firstSection) pushLine("");
    const headingRight = board
      ? styles.dim(`·${section.sessionsTotal}`)
      : [
        cockpitTone(section.cockpitTier, styles)(`·${section.sessionsTotal}`),
        ...(section.hiddenChildRequestCount ? [styles.warning(`?${section.hiddenChildRequestCount} child`)] : []),
      ].join(styles.border(" · "));
    const sectionHeadingIndex = lines.length;
    const headerTarget = section.collapsible && section.key === "archived"
      ? { kind: "section-header" as const, section: "archived" as const }
      : undefined;
    if (section.selected) {
      selectedIndex = lines.length;
      selectedEndIndex = lines.length;
    }
    const sectionOwnerIds = [...new Set(section.groups.flatMap((group) => group.sessions.map((session) => session.cockpitOwnerId)))];
    pushLine(
      sectionHeader(section.title, headingRight, width, styles, section.collapsible ? section.collapsed : undefined, section.selected, section.cockpitTier),
      headerTarget,
      undefined,
      { sectionOwnerIds, tier: section.cockpitTier, richTree: false, treeEnd: false },
    );
    if (model.guidance.coach && model.empty && section.cockpitTier === "needs-you") priorityIndexes.push(sectionHeadingIndex);
    if (section.lesson) pushLine(`  ${styles.dim(truncate(section.lesson, Math.max(0, width - 2)))}`);
    firstSection = false;
    for (const [groupIndex, group] of section.groups.entries()) {
      if (groupIndex && model.width >= 100) pushLine("");
      let groupHeadingIndex: number | undefined;
      if (board && model.width >= 100) {
        const parentCount = group.sessions.filter((session) => session.kind !== "subagent").length;
        groupHeadingIndex = lines.length;
        pushLine(twoColumn(styles.accent(group.name), groupBoardCounts(group, parentCount, styles), width));
      }
      const context = [sectionHeadingIndex, ...(groupHeadingIndex === undefined ? [] : [groupHeadingIndex])];
      for (const [index, session] of group.sessions.entries()) pushRow(session, group.sessions, index, context);
    }
    if (section.cockpitTier === "needs-you") pushReleaseCue();
    if (section.archiveDisclosure) {
      if (section.archiveDisclosure.selected) {
        selectedIndex = lines.length;
        selectedEndIndex = lines.length;
      }
      const label = section.archiveDisclosure.expanded ? "⌃ show fewer" : `… ${section.archiveDisclosure.hiddenParents} older archived`;
      const prefix = section.archiveDisclosure.selected ? `${styles.accent("▌")} ` : "  ";
      pushLine(`${prefix}${styles.dim(truncate(label, Math.max(0, width - 2)))}`, { kind: "archive-disclosure" });
      contextIndexes.set(lines.length - 1, [sectionHeadingIndex]);
    }
  }
  pushReleaseCue();
  if (model.guidance.coach && model.empty) {
    pushLine("");
    priorityIndexes.push(lines.length);
    pushLine(`${styles.accent("▶")} ${styles.accent("n")}  create the first managed Pi session`);
    priorityIndexes.push(lines.length);
    pushLine(`${styles.accent("Enter")} opens · ${styles.accent("Alt+Q")} returns · ${styles.accent("?")} keys · ${styles.accent(":")} actions`);
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
  return { lines, targets, lineMeta, ...(selectedOwnerId ? { selectedOwnerId } : {}), selectedIndex, selectedEndIndex, continuationPriorities, contextIndexes,
    ...(priorityIndexes.length ? { priorityIndexes } : {}) };
}

function decorateAttentionSectionCap(
  line: string,
  meta: SessionLineMeta | undefined,
  visibleLinesByOwner: ReadonlyMap<string, number>,
  styles: LayoutStyles,
): string {
  if (meta?.tier !== "needs-you" || !meta.sectionOwnerIds?.some((id) => (visibleLinesByOwner.get(id) ?? 0) > 1)) return line;
  return replaceVisibleColumn(line, 1, styles.warning("│"));
}

function decorateTreeGutter(line: string, meta: SessionLineMeta | undefined, styles: LayoutStyles): string {
  if (!meta?.richTree) return line;
  const glyph = meta.treeEnd ? "└" : "│";
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

function noMatchListLines(width: number, filter: string, styles: LayoutStyles): string[] {
  return [styles.warning(`No sessions match ${JSON.stringify(filter)}.`), "", `${styles.warning("▶")} Use the footer controls below.`, ""]
    .map((line) => truncate(line, width));
}

function boardHiddenSummary(model: RenderModel, width: number, styles: LayoutStyles): string {
  const parts = [
    model.boardHidden.nonActive ? `${model.boardHidden.nonActive} backlog/archived` : "",
    "S projects",
  ].filter(Boolean);
  return styles.dim(truncate(parts.join(" · "), width));
}

interface ListWindow {
  lines: string[];
  targets: (SessionListTarget | undefined)[];
  lineMeta: (SessionLineMeta | undefined)[];
  selectedIndex: number;
  selectedEndIndex: number;
  top: number;
}

function windowList(list: SessionListContent, capacity: number, scrollTop: number, styles: LayoutStyles): ListWindow {
  const safeCapacity = Math.max(1, capacity);
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

function windowFilledSelectedSpan(list: SessionListContent, capacity: number, scrollTop: number, styles: LayoutStyles): ListWindow {
  const safeCapacity = Math.max(1, capacity);
  if (list.lines.length <= safeCapacity) return { ...list, top: 0 };
  const selectedLength = list.selectedEndIndex - list.selectedIndex + 1;
  if (selectedLength >= safeCapacity) return windowSelectedCard(list, safeCapacity, styles);

  const beforeIndexes = list.targets.flatMap((target, index) => target?.kind === "session" && index < list.selectedIndex ? [index] : []);
  const afterIndexes = list.targets.flatMap((target, index) => target?.kind === "session" && index > list.selectedEndIndex ? [index] : []);
  const titleLimit = Math.max(0, safeCapacity - selectedLength);
  let best: { before: number; after: number; distance: number; contexts: Set<number> } | undefined;
  const beforeContexts = new Set(list.contextIndexes.get(list.selectedIndex) ?? []);
  for (let before = 0; before <= Math.min(beforeIndexes.length, titleLimit); before += 1) {
    if (before) {
      const titleIndex = beforeIndexes[beforeIndexes.length - before]!;
      for (const contextIndex of list.contextIndexes.get(titleIndex) ?? []) beforeContexts.add(contextIndex);
    }
    const contexts = new Set(beforeContexts);
    for (let after = 0; after <= Math.min(afterIndexes.length, titleLimit - before); after += 1) {
      if (after) {
        const titleIndex = afterIndexes[after - 1]!;
        for (const contextIndex of list.contextIndexes.get(titleIndex) ?? []) contexts.add(contextIndex);
      }
      if (selectedLength + before + after + contexts.size > safeCapacity) continue;
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
  const coreRows = selectedLength + shownBefore.length + shownAfter.length + best.contexts.size;
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

  const continuationCandidates = [...shownBefore, ...shownAfter].flatMap((ownerIndex) => {
    const distance = ownerIndex < list.selectedIndex ? list.selectedIndex - ownerIndex : ownerIndex - list.selectedEndIndex;
    const candidates: { index: number; distance: number; priority: number }[] = [];
    for (let index = ownerIndex + 1; list.continuationPriorities.has(index); index += 1) {
      candidates.push({ index, distance, priority: list.continuationPriorities.get(index) ?? 99 });
    }
    return candidates;
  }).sort((a, b) => a.distance - b.distance || a.priority - b.priority || a.index - b.index);
  const keptContinuations = new Set(continuationCandidates.slice(0, remaining).map((candidate) => candidate.index));
  const emittedContexts = new Set<number>();
  const rowsForTitle = (titleIndex: number, includeSelectedSpan = false) => {
    const rows = (list.contextIndexes.get(titleIndex) ?? []).filter((index) => !emittedContexts.has(index));
    for (const index of rows) emittedContexts.add(index);
    if (includeSelectedSpan) return [...rows, ...Array.from({ length: selectedLength }, (_, offset) => list.selectedIndex + offset)];
    rows.push(titleIndex);
    for (let index = titleIndex + 1; list.continuationPriorities.has(index); index += 1) {
      if (keptContinuations.has(index)) rows.push(index);
    }
    return rows;
  };
  const beforeRows = shownBefore.flatMap((index) => rowsForTitle(index));
  const selectedRows = rowsForTitle(list.selectedIndex, true);
  const afterRows = shownAfter.flatMap((index) => rowsForTitle(index));
  const sourceRows = [...beforeRows, ...selectedRows, ...afterRows];
  const lines = [
    ...(beforeIndicator ? [styles.dim(`↑ ${hiddenBefore} more`)] : []),
    ...sourceRows.map((index) => list.lines[index] ?? ""),
    ...(afterIndicator ? [styles.dim(`↓ ${hiddenAfter} more`)] : []),
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
  const selectedIndex = (beforeIndicator ? 1 : 0) + beforeRows.length + selectedRows.length - selectedLength;
  return {
    lines,
    targets,
    lineMeta,
    selectedIndex,
    selectedEndIndex: selectedIndex + selectedLength - 1,
    top: sourceRows[0] ?? list.selectedIndex,
  };
}

function windowSelectedCard(list: SessionListContent, capacity: number, styles: LayoutStyles): ListWindow {
  const safeCapacity = Math.max(1, capacity);
  if (list.lines.length <= safeCapacity) return { ...list, top: 0 };

  const headerIndex = list.selectedIndex;
  const footerIndex = list.selectedEndIndex;
  if (safeCapacity === 1) {
    return { lines: [list.lines[headerIndex] ?? ""], targets: [list.targets[headerIndex]], lineMeta: [list.lineMeta[headerIndex]], selectedIndex: 0, selectedEndIndex: 0, top: headerIndex };
  }

  const beforeCount = list.targets.slice(0, headerIndex).filter((target) => target?.kind === "session").length;
  const afterCount = list.targets.slice(footerIndex + 1).filter((target) => target?.kind === "session").length;
  const indicators = [
    ...(beforeCount ? [{ side: "before" as const, line: styles.dim(`↑ ${beforeCount} more`) }] : []),
    ...(afterCount ? [{ side: "after" as const, line: styles.dim(`↓ ${afterCount} more`) }] : []),
  ];
  const detailIndexes = Array.from(
    { length: Math.max(0, footerIndex - headerIndex - 1) },
    (_, offset) => headerIndex + offset + 1,
  ).sort((a, b) => (list.continuationPriorities.get(a) ?? 99) - (list.continuationPriorities.get(b) ?? 99) || a - b);

  const available = safeCapacity - 2;
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
    list.lines[footerIndex] ?? "",
    ...(afterIndicator ? [afterIndicator.line] : []),
  ];
  const targets = [
    ...(beforeIndicator ? [undefined] : []),
    list.targets[headerIndex],
    ...orderedDetails.map((index) => list.targets[index]),
    list.targets[footerIndex],
    ...(afterIndicator ? [undefined] : []),
  ];
  const lineMeta = [
    ...(beforeIndicator ? [undefined] : []),
    list.lineMeta[headerIndex],
    ...orderedDetails.map((index) => list.lineMeta[index]),
    list.lineMeta[footerIndex],
    ...(afterIndicator ? [undefined] : []),
  ];
  const selectedIndex = beforeIndicator ? 1 : 0;
  return {
    lines,
    targets,
    lineMeta,
    selectedIndex,
    selectedEndIndex: selectedIndex + orderedDetails.length + 1,
    top: headerIndex,
  };
}

const CARD = {
  stepDone: "✓", stepActive: "◉", stepPending: "·",
} as const;

export function workflowStepMarker(workflow: WorkflowRuntimeSnapshot, index: number): "✓" | "◉" | "·" {
  const done = index < workflow.activeIndex
    || (index === workflow.activeIndex && workflow.currentStepComplete === true);
  return done ? CARD.stepDone : index === workflow.activeIndex ? CARD.stepActive : CARD.stepPending;
}

function styledWorkflowMarker(workflow: WorkflowRuntimeSnapshot, index: number, styles: LayoutStyles): string {
  const marker = workflowStepMarker(workflow, index);
  return styles[marker === CARD.stepDone ? "success" : marker === CARD.stepActive ? "accent" : "dim"](marker);
}

function adaptiveCardLines(
  session: RenderSession,
  width: number,
  styles: LayoutStyles,
  board: boolean,
  terminalWidth: number,
): { line: string; priority: number }[] {
  if (board) {
    if (terminalWidth < 100) return [];
    const lines: { line: string; priority: number }[] = [];
    const context = session.ticketId
      ? `#${session.ticketId}${session.ticketSubtitle ? ` · ${session.ticketSubtitle}` : ""}`
      : session.ticketSubtitle;
    if (context) lines.push({ line: styles.muted(truncate(context, width)), priority: 2 });
    const activity = session.workflow?.activity;
    const activityText = activity ? `${activity.label}${activity.pass && activity.pass > 1 ? ` (pass ${activity.pass})` : ""}` : "";
    const progress = boardProgressBar(session.plan, styles);
    const recap = activityText && progress
      ? `${styles.accent(truncate(activityText, Math.max(0, width - displayWidth(progress) - 3)))}${styles.border(" · ")}${progress}`
      : activityText ? styles.accent(truncate(activityText, width)) : truncate(progress, width);
    if (recap) lines.push({ line: recap, priority: 0 });
    return lines;
  }

  const lines: { line: string; priority: number }[] = [];
  const summary = session.attention?.text ?? session.ticketSubtitle ?? session.ticketDescription;
  if (summary) {
    const text = session.attention ? `“${summary}”` : summary;
    lines.push({ line: styles.muted(truncate(text, width)), priority: 0 });
  }
  if (terminalWidth >= 80) {
    const meta = [session.ticketId ? `#${session.ticketId}` : "", terminalWidth >= 100 ? session.group : ""]
      .filter(Boolean)
      .join(styles.border(" · "));
    if (meta) lines.push({ line: styles.dim(truncate(meta, width)), priority: 2 });
  }
  return lines;
}

function boardProgressBar(plan: RenderSession["plan"], styles: LayoutStyles): string {
  const phases = plan?.phases;
  const total = phases?.length
    ? phases.reduce((sum, phase) => sum + phase.total, 0)
    : plan?.tasks?.total ?? 0;
  const completed = phases?.length
    ? phases.reduce((sum, phase) => sum + phase.completed, 0)
    : plan?.tasks?.completed ?? 0;
  if (!total || total < 0 || completed < 0) return "";
  const filled = Math.max(0, Math.min(8, Math.round((completed / total) * 8)));
  return `${styles.accent("■".repeat(filled))}${styles.dim("□".repeat(8 - filled))} ${completed}/${total}`;
}

interface WorkspaceRendered {
  lines: string[];
  targets: (string | undefined)[];
}

interface WorkspaceBlock extends WorkspaceRendered {
  key: "identity" | "request" | "task" | "workflow" | "guidance" | "actions" | "evidence";
}

function renderActionWorkspace(workspace: RenderWorkspace, width: number, maxRows: number | undefined, now: number, styles: LayoutStyles): WorkspaceRendered {
  const session = workspace.session;
  const block = (key: WorkspaceBlock["key"], lines: string[], targets: (string | undefined)[] = []): WorkspaceBlock => ({
    key,
    lines: lines.map((line) => truncate(line, width)),
    targets: lines.map((_, index) => targets[index]),
  });
  const meta = [
    session.ticketId ? `#${session.ticketId}` : undefined,
    session.group,
    session.repoCount > 1 ? `⧉${session.repoCount}` : undefined,
    session.worktreeBranch ? `⎇ ${session.worktreeBranch}` : undefined,
    session.kind === "subagent" && workspace.owner ? `subagent of ${workspace.owner.title}` : undefined,
  ].filter(Boolean).join(" · ");
  const identity = block("identity", [
    titleStatusRow(session, width, styles),
    ...(meta ? [styles.dim(meta)] : []),
    styles.border("─".repeat(width)),
  ]);

  const request = block("request", session.attention ? prefixedWorkspaceText(
    attentionGlyph(session.attention.kind, styles),
    `“${stripAnsi(session.attention.text)}”`,
    width,
  ) : []);
  const taskText = workspaceTaskText(workspace);
  const task = block("task", taskText ? wrapWords(taskText, width, width).slice(0, width >= 40 ? 3 : 2) : []);
  const workflowSession = session.kind === "subagent" ? workspace.owner ?? session : session;
  const workflow = block("workflow", workspaceWorkflowLine(workflowSession, styles));
  const guidanceText = [session.error ? `Error · ${stripAnsi(session.error)}` : undefined, workspace.guidance].filter(Boolean).join(" · ");
  const guidance = block("guidance", guidanceText ? wrapWords(guidanceText, width, width) : []);
  const hasBody = [request, task, workflow, guidance].some((candidate) => candidate.lines.length > 0);
  const actions = workspaceActionBlock(workspace, width, styles, block, hasBody);
  const evidence = block("evidence", workspaceEvidenceLines(workspace, width, now, styles));
  const blocks = [identity, request, task, workflow, guidance, actions, evidence];
  const rowCount = blocks.reduce((sum, candidate) => sum + candidate.lines.length, 0);
  if (maxRows !== undefined && rowCount > maxRows) {
    return compactActionWorkspace(workspace, blocks, maxRows, width);
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
  return [`${styles.accent(label)}${styles.dim(` · step ${workflow.activeIndex + 1} of ${workflow.steps.length}`)}`];
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
  const lines = includeSeparator ? [styles.border("─".repeat(width))] : [];
  const targets: (string | undefined)[] = lines.map(() => undefined);
  for (const command of commands) {
    const primary = command.id === primaryId;
    const key = command.displayKey ?? "";
    const label = command.id === workspace.evidenceCommand.id && workspace.evidenceVisible ? "Hide details" : command.label;
    const prefix = primary ? `${styles.accent("▸")} ` : "  ";
    const keyText = primary ? styles.accent(pad(key, 7)) : pad(key, 7);
    lines.push(`${prefix}${keyText}${label}`);
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
    styles.border("─".repeat(width)),
    styles.dim("LIVE DETAILS"),
    ...fields.flatMap((field) => renderStatusEvidenceField(field, width, styles)),
  ];
}

function compactActionWorkspace(workspace: RenderWorkspace, blocks: WorkspaceBlock[], maxRows: number, width: number): WorkspaceRendered {
  if (maxRows <= 0) return { lines: [], targets: [] };
  const identity = blocks.find((candidate) => candidate.key === "identity")!;
  const actions = blocks.find((candidate) => candidate.key === "actions")!;
  const evidence = blocks.find((candidate) => candidate.key === "evidence")!;
  const title = { line: identity.lines[0] ?? "", target: undefined as string | undefined };
  const actionRows = actions.lines.flatMap((line, index) => {
    const target = actions.targets[index];
    return target ? [{ line, target }] : [];
  });
  const primary = actionRows[0];
  const evidenceFacts = evidence.lines.slice(2);
  const reservePrimary = primary && maxRows >= 2 ? 1 : 0;
  const reserveEvidence = evidenceFacts.length && maxRows >= 3 ? 1 : 0;
  let budget = Math.max(0, maxRows - 1 - reservePrimary - reserveEvidence);
  const optionalContent = [
    ...blocks.filter((candidate) => ["request", "task", "workflow", "guidance"].includes(candidate.key))
      .flatMap((candidate) => candidate.lines.map((line, index) => ({ line, target: candidate.targets[index] }))),
    ...identity.lines.slice(1, -1).map((line) => ({ line, target: undefined as string | undefined })),
  ];
  const content = optionalContent.slice(0, budget);
  budget -= content.length;
  const secondary = actionRows.slice(1, 1 + budget);
  const evidenceBudget = Math.max(0, maxRows - 1 - reservePrimary - content.length - secondary.length);
  const evidenceLines = evidenceFacts.slice(0, evidenceBudget);
  const rows = [
    title,
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
  return `Esc Back · ${evidenceKey} Details · ${moreKey} Actions`;
}

function titleStatusRow(session: RenderSession, width: number, styles: LayoutStyles): string {
  const status = styles.status(session.displayStatus, `${session.symbol} ${session.displayStatus}`);
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

function pinGlyph(session: RenderSession, styles: LayoutStyles): string {
  if (!session.pinned) return "";
  return `${session.pinFocused ? styles.accent(`▣${session.pinSlot}`) : styles.muted(`▢${session.pinSlot}`)} `;
}

function rowRightAdornment(session: RenderSession, styles: LayoutStyles, board: boolean, width: number, terminalWidth: number): string {
  if (session.kind === "subagent") return "";
  const mode = activeWorkflowMode(session);
  const fits = (right: string): boolean => Boolean(right) && width - displayWidth(right) - 1 >= 8;
  const join = (parts: string[]) => parts.filter(Boolean).join(styles.border(" · "));
  const hidden = session.hiddenChildRequestCount ? styles.warning(`?${session.hiddenChildRequestCount}`) : "";
  const running = session.runningSubagentCount ? styles.success(`⚙︎${session.runningSubagentCount}`) : "";
  const compact = session.workflow ? railCompact(session.workflow, mode, styles) : "";
  const full = session.workflow && terminalWidth >= 120 ? railFull(session.workflow, mode, styles, false) : compact;
  const age = terminalWidth >= 80 && session.displayStatus !== "running" && session.activityAge ? styles.dim(session.activityAge) : "";
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

  if (board) return hierarchy(full ? [full] : []).find(fits) ?? "";
  if (session.archivedAge) {
    const archived = styles.dim(session.archivedAge);
    return [join([hidden, archived]), hidden, archived].find(fits) ?? "";
  }
  if (session.section === "backlog") {
    const backlog = styles.muted("backlog");
    const group = terminalWidth >= 100 ? styles.dim(session.group) : "";
    return [join([hidden, backlog, group]), join([hidden, backlog]), hidden, backlog].find(fits) ?? "";
  }
  return hierarchy(full ? [full] : []).find(fits) ?? "";
}

function railFull(workflow: WorkflowRuntimeSnapshot, mode: WorkflowModeDisplay | undefined, styles: LayoutStyles, includeTicket = true): string {
  const rail = workflow.steps
    .map((step, index) => {
      const short = index === workflow.activeIndex ? activeStepShort(workflow, mode) : step.short;
      const styledShort = index === workflow.activeIndex ? styles.accent(short) : styles.dim(short);
      return `${styledWorkflowMarker(workflow, index, styles)} ${styledShort}`;
    })
    .join(styles.border("─"));
  return includeTicket && workflow.ticketId ? `${rail} ${styles.border("·")} ${styles.muted(workflow.ticketId)}` : rail;
}

function renderStatusEvidenceField(field: StatusEvidenceField, width: number, styles: LayoutStyles): string[] {
  const label = field.label === "heartbeat" ? "beat" : field.label === "workflow" ? "flow" : field.label;
  if (field.kind === "result") {
    const tier = field.tier.toUpperCase().replace("-", " ");
    const value = `${styles.status(field.status, field.status)} · ${cockpitTone(field.tier, styles)(tier)} · ${field.reason}`;
    return workField(label, value, width, styles, `${styles.accent(field.marker)} `);
  }
  const marker = field.tone === "success" ? styles.success(field.marker) : field.tone === "error" ? styles.error(field.marker) : styles.dim(field.marker);
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

function wrapWords(value: string, firstWidth: number, nextWidth: number): string[] {
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
  if (tier === "active") return styles.success;
  return tier ? styles.muted : styles.border;
}

function sectionHeader(title: string, right: string, width: number, styles: LayoutStyles, collapsed?: boolean, selected = false, tier?: CockpitTier): string {
  const tone = cockpitTone(tier, styles);
  const prefix = collapsed === undefined
    ? tone("──")
    : `${selected ? styles.accent("▌") : tone("─")}${tone(collapsed ? "▸" : "▾")}`;
  return twoColumn(`${prefix}${tone(` ${title} `)}`, right, width);
}

function attentionGlyph(kind: NonNullable<RenderSession["attention"]>["kind"], styles: LayoutStyles): string {
  if (kind === "ready") return styles.success("✓");
  if (kind === "question") return styles.warning("?");
  return styles.error("!");
}

interface SessionRowOptions {
  board: boolean;
  terminalWidth: number;
  childLast: boolean;
  gutterColumn: boolean;
}

function renderSessionRow(session: RenderSession, width: number, styles: LayoutStyles, options: SessionRowOptions): string {
  const selection = session.selected ? styles.accent("▌") : " ";
  const attention = session.attention ? attentionGlyph(session.attention.kind, styles) : " ";
  const symbol = session.section === "active"
    ? styles.status(session.displayStatus, session.symbol)
    : styles.muted(session.symbol);
  const sidePaneMarker = pinGlyph(session, styles);

  if (session.kind === "subagent") {
    const branch = session.depth > 1 ? "│└" : options.childLast ? "└─" : "├─";
    const prefix = `${selection}${options.gutterColumn ? "  " : " "}${styles.dim(branch)} ${attention} ${symbol} ${sidePaneMarker}`;
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
    ? styles.accent(session.boardExpanded ? "▾" : "▸")
    : styles.dim("·");
  const prefix = `${selection}${options.gutterColumn ? "  " : " "}${disclosure} ${attention} ${symbol} ${sidePaneMarker}`;
  const worktree = !options.board && session.worktreeBranch ? styles.accent("⎇ ") : "";
  const repo = !options.board && options.terminalWidth >= 80 && session.repoCount > 1 ? styles.dim(` ⧉ ${session.repoCount}`) : "";
  const suffix = repo;
  const rightWidthBase = Math.max(0, width - displayWidth(prefix) - displayWidth(worktree) - displayWidth(suffix));
  const right = rowRightAdornment(session, styles, options.board, rightWidthBase, options.terminalWidth);
  const rightSpace = right ? displayWidth(right) + 1 : 0;
  const titleWidth = Math.max(0, width - displayWidth(prefix) - displayWidth(worktree) - displayWidth(suffix) - rightSpace);
  const title = styles.text(truncate(session.title, titleWidth));
  const left = `${prefix}${worktree}${title}${suffix}`;
  return right ? twoColumn(left, right, width) : truncate(left, width);
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
}

export interface FormSpec {
  title: string;
  fields: FormField[];
  focus: string;
  footer: string;
  narrowFooter?: string;
}

export function renderForm(spec: FormSpec, width: number, theme?: SessionsTheme): string[] {
  const styles = theme ? createStyles(theme) : plainStyles();
  const inner = Math.max(20, Math.min(Math.max(20, width - 2), 86));
  const showHints = inner >= 38;
  const labelWidth = Math.max(...spec.fields.map((field) => displayWidth(field.label)), 5);
  const valueWidth = inner - labelWidth - 4;
  const body: string[] = [styles.accent(spec.title), styles.border("─".repeat(inner)), ""];
  let previousSection: string | undefined;
  for (const field of spec.fields) {
    if (field.section && field.section !== previousSection) {
      body.push(styles.muted(field.section));
      previousSection = field.section;
    }
    const focused = field.key === spec.focus;
    const caret = focused ? styles.accent("▎") : " ";
    const label = focused ? field.label : styles.muted(field.label);
    const focusedValue = field.readonly
      ? truncateValue(field.value, valueWidth, field.truncate)
      : renderCursorValue(field.value, field.cursor, valueWidth, field.truncate);
    const rawValue = focused ? styles.accent(focusedValue) : truncateValue(field.value, valueWidth, field.truncate);
    const value = field.readonly && !focused ? styles.dim(rawValue) : rawValue;
    body.push(`${caret} ${pad(label, labelWidth)}  ${value}`);
    const hintText = field.error ? styles.error(field.error) : (showHints && field.hint ? styles.dim(field.hint) : "");
    if (hintText) body.push(`  ${pad("", labelWidth)}  ${truncate(hintText, valueWidth)}`);
    body.push("");
  }
  body.push(styles.border("─".repeat(inner)));
  const footer = inner < 32 ? (spec.narrowFooter ?? "enter · esc") : spec.footer;
  body.push(truncate(styles.dim(footer), inner));
  return frame(width, body, styles, { border: "dialog-title" });
}

function renderCursorValue(value: string, cursor: number | undefined, width: number, mode: "end" | "start" | undefined): string {
  if (width <= 0) return "";
  const chars = [...value];
  const pos = Math.max(0, Math.min(cursor ?? chars.length, chars.length));
  const rendered = renderTextInput(createTextInput(value, pos));
  if ([...rendered].length <= width) return rendered;
  if (mode === "start" || pos >= width - 1) {
    const tailWidth = Math.max(0, width - 1);
    const tail = `${chars.slice(Math.max(0, pos - tailWidth + 1), pos).join("")}█${chars.slice(pos, pos + Math.max(0, tailWidth - Math.min(pos, tailWidth - 1))).join("")}`;
    return `…${[...tail].slice(-tailWidth).join("")}`;
  }
  return truncate(rendered, width);
}

function truncateValue(value: string, width: number, mode: "end" | "start" | undefined): string {
  if (width <= 0) return "";
  if (displayWidth(value) <= width) return value;
  if (mode !== "start") return truncate(value, width);
  if (width <= 1) return "";
  const visible = stripAnsi(value);
  const tail = [...visible].slice(-(width - 1)).join("");
  return `…${tail}`;
}

export function renderDialog(title: string, rows: string[], width: number, theme?: SessionsTheme): string[] {
  const styles = theme ? createStyles(theme) : plainStyles();
  const inner = Math.max(20, Math.min(Math.max(20, width - 2), 86));
  const body = [styles.accent(title), styles.border("─".repeat(Math.min(inner, Math.max(0, displayWidth(title) + 8)))), ...rows];
  return frame(width, body, styles, { border: "dialog-title" });
}

interface FrameOptions {
  border: "dashboard-title" | "dialog-title";
  title?: string;
}

function box(width: number, body: string[], styles: LayoutStyles): string[] {
  return frame(width, body, styles, { border: "dashboard-title", title: "pi agent hub" });
}

function frame(width: number, body: string[], styles: LayoutStyles, options: FrameOptions): string[] {
  const inner = options.border === "dashboard-title"
    ? width - 2
    : Math.max(20, Math.min(Math.max(20, width - 2), 86));
  const top = options.border === "dashboard-title"
    ? `${styles.border("╭")} ${styles.accent(options.title ?? "")} ${styles.border("─".repeat(Math.max(0, inner - displayWidth(options.title ?? "") - 2)))}${styles.border("╮")}`
    : `${styles.border("╭")}${styles.border("─".repeat(inner))}${styles.border("╮")}`;
  const bottom = `${styles.border("╰")}${styles.border("─".repeat(inner))}${styles.border("╯")}`;
  const lines = [top, ...body.map((line) => `${styles.border("│")}${pad(line, inner)}${styles.border("│")}`), bottom];
  return options.border === "dashboard-title" ? lines.map((line) => truncate(line, width)) : lines;
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
  return truncateToWidth(value, width, "…");
}

function displayWidth(value: string): number {
  return visibleWidth(value);
}
