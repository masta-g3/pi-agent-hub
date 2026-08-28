import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { WorkflowModeDisplay, WorkflowRuntimeSnapshot } from "../core/types.js";
import { ageLabel } from "./age.js";
import type { CockpitTier, RenderModel, RenderSession, RenderWorkspace, StatusCounts } from "./render-model.js";
import { createTextInput, renderTextInput } from "./text-input.js";
import { statusEvidenceFields, type StatusEvidenceField } from "./status-evidence.js";
import { darkTheme, stripAnsi, styleBgToken, styleToken, type SessionsTheme } from "./theme.js";

export type SessionListTarget =
  | { kind: "session"; id: string }
  | { kind: "session-continuation"; id: string }
  | { kind: "archive-disclosure" }
  | { kind: "section-header"; section: "backlog" | "archived" };

export interface SessionsLayout {
  lines: string[];
  rowTargets: (SessionListTarget | undefined)[];
  workspaceRowTargets: (string | undefined)[];
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
    workspaceRowTargets: lines.map(() => undefined),
    listWidth: 0,
    listScrollTop: 0,
  });
  if (model.empty) return emptyLayout(box(width, fitBoxBody(emptyLines(width, styles), model.height), styles));

  const bodyWidth = width - 2;
  if (model.noMatches) {
    const body = [renderTopSummary(model, bodyWidth, styles), ...(model.panelStrip ? [renderPanelStrip(model, bodyWidth, styles)] : []), ...noMatchLines(width, model.filter ?? "", styles), styles.border("─".repeat(bodyWidth)), styleFooter(model.footer, styles)];
    return emptyLayout(box(width, fitBoxBody(body, model.height), styles));
  }
  if (model.noBoardSessions) {
    const body = [renderTopSummary(model, bodyWidth, styles), ...(model.panelStrip ? [renderPanelStrip(model, bodyWidth, styles)] : []), ...noBoardLines(width, model, styles), styles.border("─".repeat(bodyWidth)), styleFooter(model.footer, styles)];
    return emptyLayout(box(width, fitBoxBody(body, model.height), styles));
  }
  if (model.showWorkspace && model.workspace?.fullScreen) {
    return renderWorkspaceScreen(model.workspace, width, model.height, model.now, styles);
  }

  const workspaceWidth = model.showWorkspace ? (width >= 160 ? 44 : 34) : 0;
  const split = model.showWorkspace ? bodyWidth - workspaceWidth - 1 : bodyWidth;
  const stripLines = model.panelStrip ? 1 : 0;
  const targetRows = bodyRowsFromHeight(model.height, stripLines);
  const left = renderSessionList(model, split, styles);
  const workspace = model.showWorkspace && model.workspace
    ? renderActionWorkspace(model.workspace, workspaceWidth, targetRows, model.now, styles)
    : { lines: [] as string[], targets: [] as (string | undefined)[] };
  const rows = targetRows ?? Math.max(left.lines.length, workspace.lines.length, 8);
  const windowedLeft = windowList(left, rows, model.listScrollTop ?? 0, styles);
  const body: string[] = [renderTopSummary(model, bodyWidth, styles)];
  if (model.panelStrip) body.push(renderPanelStrip(model, bodyWidth, styles));
  for (let i = 0; i < rows; i += 1) {
    const padded = pad(windowedLeft.lines[i] ?? "", split);
    const leftLine = i >= windowedLeft.selectedIndex && i <= windowedLeft.selectedEndIndex ? styles.selected(padded) : padded;
    body.push(model.showWorkspace ? `${leftLine}${styles.border("│")}${pad(workspace.lines[i] ?? "", workspaceWidth)}` : leftLine);
  }
  body.push(styles.border("─".repeat(bodyWidth)));
  body.push(truncate(styleFooter(model.footer, styles), bodyWidth));
  const lines = box(width, body, styles);
  const rowTargets = lines.map(() => undefined as SessionListTarget | undefined);
  const workspaceRowTargets = lines.map(() => undefined as string | undefined);
  for (let i = 0; i < rows; i += 1) {
    const lineIndex = 2 + stripLines + i;
    rowTargets[lineIndex] = windowedLeft.targets[i];
    workspaceRowTargets[lineIndex] = workspace.targets[i];
  }
  return {
    lines,
    rowTargets,
    workspaceRowTargets,
    ...(model.showWorkspace ? { workspaceStartX: split + 3 } : {}),
    listWidth: split,
    listScrollTop: windowedLeft.top,
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
  return { lines, rowTargets: lines.map(() => undefined), workspaceRowTargets, workspaceStartX: 2, listWidth: 0, listScrollTop: 0 };
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

function noMatchLines(width: number, filter: string, styles: LayoutStyles): string[] {
  const inner = width - 2;
  return [
    "",
    styles.warning(`No sessions match ${JSON.stringify(filter)}.`),
    "",
    `${styles.warning("▶")} Use the footer controls below.`,
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

const STATUS_ORDER = [
  ["running", "●"],
  ["waiting", "◐"],
  ["idle", "○"],
  ["error", "×"],
  ["stopped", "-"],
] as const;

function renderTopSummary(model: RenderModel, width: number, styles: LayoutStyles): string {
  const board = model.grouping === "stage";
  const countLabel = board
    ? `${model.boardCardCount} Active ${model.boardCardCount === 1 ? "session" : "sessions"}`
    : model.filter === undefined
      ? `${model.summary.total} ${model.summary.total === 1 ? "session" : "sessions"}`
      : `${model.summary.visibleTotal}/${model.summary.total} sessions`;
  const parts = [styles.accent(countLabel)];
  if (board) {
    const counts = formatStatusCounts(model.boardStatusCounts, styles);
    if (counts) parts.push(counts);
    parts.push(styles.dim("view lanes"));
  } else {
    const needsYou = model.sections.find((section) => section.cockpitTier === "needs-you")?.sessionsTotal ?? 0;
    const health = model.sections.find((section) => section.cockpitTier === "health")?.sessionsTotal ?? 0;
    if (needsYou) parts.push(styles.warning(`?${needsYou} needs you`));
    if (health) parts.push(styles.error(`×${health} health`));
  }
  if (model.filter !== undefined) parts.push(styles.dim(`filter: ${model.filter}`));
  return truncate(parts.join(" · "), width);
}

function groupAttentionCount(count: number, styles: LayoutStyles, muted = false): string {
  if (!count) return "";
  return (muted ? styles.muted : styles.warning)(`◐${count}`);
}

function groupBoardCounts(group: RenderModel["sections"][number]["groups"][number], parentCount: number, styles: LayoutStyles): string {
  return [groupAttentionCount(group.attentionCount, styles), styles.dim(`·${parentCount}`)].filter(Boolean).join(" ");
}

function renderPanelStrip(model: RenderModel, width: number, styles: LayoutStyles): string {
  const segments = model.panelStrip?.map(({ slot, title }) => {
    if (!title) return styles.dim(`·${slot}`);
    const text = `◫${slot} ${title}`;
    return slot === model.sidePaneFocusedSlot ? styles.accent(text) : `${styles.muted(`◫${slot}`)} ${title}`;
  }) ?? [];
  return truncate(segments.join("  "), width);
}

interface SessionListContent {
  lines: string[];
  targets: (SessionListTarget | undefined)[];
  selectedIndex: number;
  selectedEndIndex: number;
  continuationPriorities: Map<number, number>;
  contextIndexes: Map<number, number[]>;
  fillAroundSelected?: boolean;
}

function renderSessionList(model: RenderModel, width: number, styles: LayoutStyles): SessionListContent {
  const board = model.grouping === "stage";
  const lines: string[] = [];
  const targets: (SessionListTarget | undefined)[] = [];
  const continuationPriorities = new Map<number, number>();
  const contextIndexes = new Map<number, number[]>();
  let selectedIndex = -1;
  let selectedEndIndex = -1;
  const pushLine = (line: string, target?: SessionListTarget) => {
    lines.push(line);
    targets.push(target);
  };
  const pushRow = (session: RenderSession, junction?: { last: boolean; rich: boolean }, context: number[] = []) => {
    if (model.density === "all-cards" && junction) {
      if (session.selected) selectedIndex = lines.length;
      const branch = junction.last ? (session.selected ? "┗" : "└") : session.selected ? "┣" : "├";
      const branchText = session.selected ? styles.accent(branch) : styles.border(branch);
      const attention = session.attention ? `${attentionGlyph(session.attention.kind, styles)} ` : "";
      const titlePrefix = `${branchText} ${attention}`;
      const title = renderSessionRow(session, Math.max(0, width - displayWidth(titlePrefix)), styles, {
        board,
        focusedSlot: model.sidePaneFocusedSlot,
        selectionMarker: false,
        titleSource: "stored",
        prefixMode: "none",
      });
      pushLine(`${titlePrefix}${title}`, { kind: "session", id: session.id });
      contextIndexes.set(lines.length - 1, context);
      if (junction.rich) {
        const continuationBranch = junction.last ? " " : session.selected ? "┃" : "│";
        const continuationPrefix = `${session.selected ? styles.accent(continuationBranch) : styles.border(continuationBranch)} `;
        for (const continuation of allCardLines(session, Math.max(0, width - 2), styles)) {
          pushLine(`${continuationPrefix}${continuation.line}`, { kind: "session-continuation", id: session.id });
          continuationPriorities.set(lines.length - 1, continuation.priority);
        }
      }
      if (session.selected) selectedEndIndex = lines.length - 1;
      return;
    }
    if (session.selected) selectedIndex = lines.length;
    pushLine(renderSessionRow(session, width, styles, { board, focusedSlot: model.sidePaneFocusedSlot }), { kind: "session", id: session.id });
    if (model.density === "all-cards") contextIndexes.set(lines.length - 1, context);
    if (session.selected) selectedEndIndex = lines.length - 1;
  };
  let firstSection = true;
  for (const section of model.sections) {
    if (!firstSection) pushLine("");
    const headingRight = board
      ? styles.dim(`·${section.sessionsTotal}`)
      : cockpitTone(section.cockpitTier, styles)(`·${section.sessionsTotal}`);
    const sectionHeadingIndex = lines.length;
    const headerTarget = section.collapsible && section.key === "archived"
      ? { kind: "section-header" as const, section: "archived" as const }
      : undefined;
    if (section.selected) {
      selectedIndex = lines.length;
      selectedEndIndex = lines.length;
    }
    pushLine(sectionHeader(section.title, headingRight, width, styles, section.collapsible ? section.collapsed : undefined, section.selected, section.cockpitTier), headerTarget);
    firstSection = false;
    for (const [groupIndex, group] of section.groups.entries()) {
      if (model.density === "all-cards" && groupIndex) pushLine("");
      let groupHeadingIndex: number | undefined;
      if (board) {
        const parentCount = group.sessions.filter((session) => session.kind !== "subagent").length;
        const groupName = model.density === "all-cards" ? styles.accent(group.name) : styles.muted(group.name);
        groupHeadingIndex = lines.length;
        pushLine(twoColumn(groupName, groupBoardCounts(group, parentCount, styles), width));
      }
      const context = [sectionHeadingIndex, ...(groupHeadingIndex === undefined ? [] : [groupHeadingIndex])];
      const junction = model.density === "all-cards" && section.key !== "archived";
      for (const [index, session] of group.sessions.entries()) {
        pushRow(session, junction ? {
          last: index === group.sessions.length - 1,
          rich: (board || session.section === "active") && session.kind !== "subagent",
        } : undefined, context);
      }
    }
    if (section.archiveDisclosure) {
      if (section.archiveDisclosure.selected) {
        selectedIndex = lines.length;
        selectedEndIndex = lines.length;
      }
      const label = section.archiveDisclosure.expanded ? "⌃ show fewer" : `… ${section.archiveDisclosure.hiddenParents} older archived`;
      const prefix = section.archiveDisclosure.selected ? `${styles.accent("▌")} ` : "  ";
      pushLine(`${prefix}${styles.dim(truncate(label, Math.max(0, width - 2)))}`, { kind: "archive-disclosure" });
      if (model.density === "all-cards") contextIndexes.set(lines.length - 1, [sectionHeadingIndex]);
    }
  }
  if (board) {
    pushLine("");
    pushLine(boardHiddenSummary(model, width, styles));
  }
  return { lines, targets, selectedIndex, selectedEndIndex, continuationPriorities, contextIndexes, fillAroundSelected: model.density === "all-cards" };
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
  selectedIndex: number;
  selectedEndIndex: number;
  top: number;
}

function windowList(list: SessionListContent, capacity: number, scrollTop: number, styles: LayoutStyles): ListWindow {
  if (list.fillAroundSelected) return windowFilledSelectedSpan(list, capacity, scrollTop, styles);
  if (capacity <= 0 || list.lines.length <= capacity) return { ...list, top: 0 };
  const total = list.lines.length;
  const selectedIndex = Math.max(0, list.selectedIndex);
  const sessionCount = (from: number, to: number) => list.targets.slice(Math.max(0, from), Math.min(total, to)).filter((target) => target?.kind === "session").length;
  const indicator = (arrow: "↑" | "↓", count: number) => count > 0 ? styles.dim(`${arrow} ${count} more`) : "";
  const slice = (top: number, lines: string[], targets: (SessionListTarget | undefined)[], selectedOffset = top): ListWindow => {
    const visibleSelected = selectedIndex >= selectedOffset && selectedIndex < selectedOffset + lines.length ? selectedIndex - selectedOffset : -1;
    return { lines, targets, selectedIndex: visibleSelected, selectedEndIndex: visibleSelected, top };
  };

  if (capacity === 1) return slice(selectedIndex, [list.lines[selectedIndex] ?? ""], [list.targets[selectedIndex]], selectedIndex);

  if (selectedIndex < capacity - 1) {
    const visibleEnd = capacity - 1;
    return slice(0, [...list.lines.slice(0, visibleEnd), indicator("↓", sessionCount(visibleEnd, total))], [...list.targets.slice(0, visibleEnd), undefined]);
  }

  if (selectedIndex >= total - (capacity - 1)) {
    const top = total - (capacity - 1);
    return {
      lines: [indicator("↑", sessionCount(0, top)), ...list.lines.slice(top)],
      targets: [undefined, ...list.targets.slice(top)],
      selectedIndex: selectedIndex - top + 1,
      selectedEndIndex: selectedIndex - top + 1,
      top,
    };
  }

  if (capacity === 2) {
    return {
      lines: [indicator("↑", sessionCount(0, selectedIndex)), list.lines[selectedIndex] ?? ""],
      targets: [undefined, list.targets[selectedIndex]],
      selectedIndex: 1,
      selectedEndIndex: 1,
      top: selectedIndex,
    };
  }

  const lastContent = capacity - 3;
  const maxTop = total - (capacity - 1);
  let top = Math.max(1, Math.min(scrollTop, maxTop));
  if (selectedIndex < top) top = selectedIndex;
  if (selectedIndex > top + lastContent) top = selectedIndex - lastContent;
  top = Math.max(1, Math.min(top, maxTop));
  const bottomStart = top + capacity - 2;
  return {
    lines: [indicator("↑", sessionCount(0, top)), ...list.lines.slice(top, bottomStart), indicator("↓", sessionCount(bottomStart, total))],
    targets: [undefined, ...list.targets.slice(top, bottomStart), undefined],
    selectedIndex: selectedIndex - top + 1,
    selectedEndIndex: selectedIndex - top + 1,
    top,
  };
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
  const selectedIndex = (beforeIndicator ? 1 : 0) + beforeRows.length + selectedRows.length - selectedLength;
  return {
    lines,
    targets,
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
    return { lines: [list.lines[headerIndex] ?? ""], targets: [list.targets[headerIndex]], selectedIndex: 0, selectedEndIndex: 0, top: headerIndex };
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
  const selectedIndex = beforeIndicator ? 1 : 0;
  return {
    lines,
    targets,
    selectedIndex,
    selectedEndIndex: selectedIndex + orderedDetails.length + 1,
    top: headerIndex,
  };
}

const CARD = {
  stepDone: "✓", stepActive: "◉", stepPending: "·",
  taskDone: "▰", taskPending: "▱", phaseSep: "│",
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

function workflowVisualLine(session: RenderSession, width: number, styles: LayoutStyles): string | undefined {
  const workflow = session.workflow;
  if (!workflow?.steps[workflow.activeIndex]) return undefined;
  const dots = workflow.steps.map((_step, index) => styledWorkflowMarker(workflow, index, styles)).join("");
  const activity = workflow.activity;
  if (activity) {
    const pass = activity.pass && activity.pass > 1 ? ` (pass ${activity.pass})` : "";
    return truncate(`${dots}  ${activity.label}${pass}`, width);
  }
  const plan = session.plan;
  const phases = plan?.phases;
  const taskMarker = (done: boolean) => done ? styles.accent(CARD.taskDone) : styles.dim(CARD.taskPending);
  const renderCells = (completed: number, total: number) => Array.from(
    { length: total },
    (_, index) => taskMarker(index < completed),
  ).join("");
  const total = phases?.length
    ? phases.reduce((sum, phase) => sum + phase.total, 0)
    : plan?.tasks?.total ?? 0;
  const completed = phases?.length
    ? phases.reduce((sum, phase) => sum + phase.completed, 0)
    : plan?.tasks?.completed ?? 0;
  if (!total) return truncate(dots, width);

  const base = `${dots}  `;
  const available = Math.max(0, width - displayWidth(base));
  let separatedZone = "";
  let flatZone = "";
  if (phases?.length) {
    if (total + phases.length - 1 <= available) {
      separatedZone = phases.map((phase) => renderCells(phase.completed, phase.total)).join(styles.border(CARD.phaseSep));
    }
    if (total <= available) flatZone = renderCells(completed, total);
  } else if (plan?.tasks) {
    const suffix = plan.phase ? ` p${plan.phase.index}/${plan.phase.count}` : "";
    if (total + displayWidth(suffix) <= available) separatedZone = `${renderCells(completed, total)}${styles.dim(suffix)}`;
  }
  const ratioDone = Math.round((completed / total) * 10);
  const ratioZone = Array.from({ length: 10 }, (_, index) => taskMarker(index < ratioDone)).join("");
  const candidates = [
    separatedZone ? `${base}${separatedZone}` : "",
    flatZone ? `${base}${flatZone}` : "",
    `${base}${ratioZone} ${completed}/${total}`,
  ];
  return truncate(candidates.find((candidate) => candidate && displayWidth(candidate) <= width) ?? dots, width);
}

function allCardLines(session: RenderSession, width: number, styles: LayoutStyles): { line: string; priority: number }[] {
  const indent = "  ";
  const contentWidth = Math.max(0, width - indent.length);
  const lines: { line: string; priority: number }[] = [];
  if (session.ticketId) {
    const id = `#${session.ticketId}`;
    const subtitle = session.ticketSubtitle && normalizedText(session.ticketSubtitle) !== normalizedText(session.title)
      ? ` · ${session.ticketSubtitle}` : "";
    const text = displayWidth(`${id}${subtitle}`) <= contentWidth || contentWidth - displayWidth(id) >= 12 ? `${id}${subtitle}` : id;
    lines.push({ line: `${indent}${styles.dim(truncate(text, contentWidth))}`, priority: 2 });
  }
  const recap = allCardRecapLine(session, contentWidth, styles);
  if (recap) lines.push({ line: `${indent}${recap}`, priority: 0 });
  return lines;
}

function allCardRecapLine(session: RenderSession, width: number, styles: LayoutStyles): string | undefined {
  return session.workflow
    ? workflowVisualLine(session, width, styles)
    : session.plan ? planProgressText(session.plan, styles) : undefined;
}

function planProgressText(plan: NonNullable<RenderSession["plan"]>, styles: LayoutStyles): string {
  const phaseTasks = plan.phase ? plan.phases?.[plan.phase.index - 1] : undefined;
  const phase = plan.phase ? `Phase ${plan.phase.index}/${plan.phase.count}${phaseTasks ? ` · ${phaseTasks.completed}/${phaseTasks.total}` : ""}` : undefined;
  const tasks = plan.tasks ? `${plan.tasks.completed}/${plan.tasks.total}` : undefined;
  const text = [phase, tasks].filter(Boolean).join(" · ");
  return text ? styles.dim(text) : "";
}

interface WorkspaceRendered {
  lines: string[];
  targets: (string | undefined)[];
}

interface WorkspaceBlock extends WorkspaceRendered {
  key: "identity" | "request" | "recommendation" | "actions" | "context" | "state" | "evidence" | "workflow" | "tree";
}

function renderActionWorkspace(workspace: RenderWorkspace, width: number, maxRows: number | undefined, now: number, styles: LayoutStyles): WorkspaceRendered {
  const session = workspace.session;
  const block = (key: WorkspaceBlock["key"], lines: string[], targets: (string | undefined)[] = []): WorkspaceBlock => ({
    key,
    lines: lines.map((line) => truncate(line, width)),
    targets: lines.map((_, index) => targets[index]),
  });
  const meta = [session.ticketId ? `#${session.ticketId}` : undefined, session.group, session.repoCount > 1 ? `⧉${session.repoCount}` : undefined, session.worktreeBranch ? `⎇ ${session.worktreeBranch}` : undefined].filter(Boolean).join(" · ");
  const identity = block("identity", [styles.accent("SELECTED SESSION"), titleStatusRow(session, width, styles), ...(meta ? [styles.dim(meta)] : []), styles.border("─".repeat(width))]);

  const request = session.attention
    ? block("request", [
      `${attentionGlyph(session.attention.kind, styles)} ${styles.warning(session.attention.kind.toUpperCase())}`,
      ...wrapWords(`“${stripAnsi(session.attention.text)}”`, width, width),
    ])
    : block("request", [styles.dim("· no explicit request")]);

  const recommendation = block("recommendation", [styles.dim("RECOMMENDED NEXT"), ...wrapWords(stripAnsi(workspace.recommendation), width, width)]);
  const actionLines: string[] = [];
  const actionTargets: (string | undefined)[] = [];
  const action = (command: RenderWorkspace["actions"][number]) => {
    const key = command.displayKey ?? "";
    const hint = width >= 40 ? ` · ${command.hint}` : "";
    actionLines.push(`${styles.accent(pad(key, Math.max(4, displayWidth(key) + 1)))}${command.label}${styles.dim(hint)}`);
    actionTargets.push(command.id);
  };
  for (const command of workspace.actions) action(command);
  action(workspace.moreCommand);
  const actions = block("actions", [styles.border("─".repeat(width)), ...actionLines, styles.border("─".repeat(width))], [undefined, ...actionTargets, undefined]);

  const context = session.context
    ? block("context", [
      styles.dim("CONTEXT · bounded producer fields"),
      ...(session.ticketSubtitle ? [session.ticketSubtitle] : []),
      ...(width >= 40 && session.ticketDescription ? wrapWords(stripAnsi(session.ticketDescription), width, width).slice(0, 2) : []),
      styles.dim(`· producer context · ${ageLabel(Math.max(0, now - session.context.updatedAt))} ago`),
    ])
    : session.kind === "subagent" && session.taskPreview
      ? block("context", [styles.dim("CONTEXT · subagent task"), ...wrapWords(stripAnsi(session.taskPreview), width, width).slice(0, 2), styles.dim(`· producer-owned${workspace.owner ? ` · subagent of ${workspace.owner.title}` : ""}`)])
      : block("context", [styles.dim("CONTEXT"), styles.dim("· no producer context · Hub shows runtime state only")]);

  const result = statusEvidenceFields(session, now).find((field): field is Extract<StatusEvidenceField, { kind: "result" }> => field.kind === "result")!;
  const state = block("state", [
    styles.dim("STATE"),
    `${styles.status(result.status, session.symbol)} ${styles.status(result.status, result.status)} · ${cockpitTone(result.tier, styles)(result.tier.toUpperCase().replace("-", " "))}`,
    ...wrapWords(result.reason, width, width).slice(0, 2),
    ...(session.error ? wrapWords(`error · ${stripAnsi(session.error)}`, width, width).slice(0, 2).map(styles.error) : []),
    ...(workspace.actions.some((command) => command.id === workspace.evidenceCommand.id) ? [] : [
      `${styles.accent(workspace.evidenceCommand.displayKey ?? "i")} ${styles.dim(workspace.evidenceVisible ? "Hide live status" : "Explain live status")}`,
    ]),
  ]);

  const evidenceFields = statusEvidenceFields(session, now).filter((field) => field.kind === "fact");
  const evidence = block("evidence", workspace.evidenceVisible ? [
    styles.dim("LIVE EVIDENCE"),
    ...evidenceFields.flatMap((field) => renderStatusEvidenceField(field, width, styles)),
  ] : []);
  const workflowSession = session.kind === "subagent" ? workspace.owner ?? session : session;
  const mode = activeWorkflowMode(workflowSession);
  const workflow = block("workflow", workflowSession.workflow
    ? [styles.dim("WORKFLOW"), railLine(workflowSession.workflow, mode, width, styles)]
    : [styles.dim("WORKFLOW"), styles.dim("· no workflow reported")]);
  const visibleTree = workspace.descendants.slice(0, 2);
  const relation = session.kind === "subagent"
    ? `subagent${workspace.owner ? ` of ${workspace.owner.title}` : ""}`
    : workspace.descendants.length ? `${workspace.descendants.filter((row) => row.status === "starting" || row.status === "running").length} active of ${workspace.descendants.length} subagents` : "no subagents";
  const tree = block("tree", [
    styles.dim(`TREE · ${relation}`),
    ...visibleTree.map((row) => `${styles.status(row.displayStatus, row.symbol)} ${row.agentName ?? row.title}${row.taskPreview ? ` · ${row.taskPreview}` : ""}`),
    ...(workspace.descendants.length > visibleTree.length ? [styles.dim(`· +${workspace.descendants.length - visibleTree.length} more descendants`)] : []),
  ]);

  let blocks = [identity, request, recommendation, actions, context, state, evidence, workflow, tree].filter((candidate) => candidate.lines.length > 0);
  if (maxRows !== undefined) {
    for (const key of ["tree", "workflow", "context"] as const) {
      if (blocks.reduce((sum, candidate) => sum + candidate.lines.length, 0) <= maxRows) break;
      blocks = blocks.filter((candidate) => candidate.key !== key);
    }
    if (blocks.reduce((sum, candidate) => sum + candidate.lines.length, 0) > maxRows) {
      return compactActionWorkspace(workspace, maxRows, now, width, styles);
    }
  }
  const lines = blocks.flatMap((candidate) => candidate.lines);
  const targets = blocks.flatMap((candidate) => candidate.targets);
  return {
    lines: maxRows === undefined ? lines : lines.slice(0, maxRows),
    targets: maxRows === undefined ? targets : targets.slice(0, maxRows),
  };
}

function compactActionWorkspace(workspace: RenderWorkspace, maxRows: number, now: number, width: number, styles: LayoutStyles): WorkspaceRendered {
  if (maxRows <= 0) return { lines: [], targets: [] };
  const session = workspace.session;
  const lines: string[] = [titleStatusRow(session, width, styles)];
  const targets: (string | undefined)[] = [undefined];
  const evidenceLines = workspace.evidenceVisible
    ? [
      styles.dim("LIVE EVIDENCE"),
      ...statusEvidenceFields(session, now)
        .filter((field) => field.kind === "fact")
        .flatMap((field) => renderStatusEvidenceField(field, width, styles)),
    ]
    : [];
  const reserveEvidence = evidenceLines.length ? Math.min(evidenceLines.length, maxRows >= 8 ? 2 : 1) : 0;
  const reserveState = maxRows >= 6 ? 1 : 0;
  const reserveAction = maxRows - lines.length - reserveEvidence - reserveState > 0 ? 1 : 0;
  const requestText = session.attention
    ? `${attentionGlyph(session.attention.kind, styles)} ${stripAnsi(session.attention.text)}`
    : styles.dim("· no explicit request");
  const remainingDecisionRows = maxRows - lines.length - reserveEvidence - reserveState - reserveAction;
  if (remainingDecisionRows === 1) {
    lines.push(truncate(`${requestText} · ${styles.dim("next: ")}${workspace.recommendation}`, width));
    targets.push(undefined);
  } else if (remainingDecisionRows > 1) {
    lines.push(truncate(requestText, width));
    targets.push(undefined);
    lines.push(truncate(`${styles.dim("next · ")}${workspace.recommendation}`, width));
    targets.push(undefined);
  }
  const actionBudget = Math.max(reserveAction, maxRows - lines.length - reserveEvidence - reserveState);
  const actionRows = workspace.actions.slice(0, actionBudget);
  if (actionBudget >= 2) actionRows.splice(actionBudget - 1, 1, workspace.moreCommand);
  if (actionBudget > 0 && actionRows.length === 0) actionRows.push(workspace.moreCommand);
  for (const command of actionRows) {
    const key = command.displayKey ?? "";
    lines.push(truncate(`${styles.accent(pad(key, Math.max(4, displayWidth(key) + 1)))}${command.label}`, width));
    targets.push(command.id);
  }
  if (reserveState && lines.length < maxRows - reserveEvidence) {
    const tier = session.cockpitTier.toUpperCase().replace("-", " ");
    lines.push(`${styles.status(session.displayStatus, session.symbol)} ${session.displayStatus} · ${cockpitTone(session.cockpitTier, styles)(tier)}`);
    targets.push(undefined);
  }
  const evidenceBudget = Math.max(0, maxRows - lines.length);
  const visibleEvidence = evidenceBudget === 1 && evidenceLines.length > 1
    ? evidenceLines.slice(1, 2)
    : evidenceLines.slice(0, evidenceBudget);
  for (const line of visibleEvidence) {
    lines.push(truncate(line, width));
    targets.push(undefined);
  }
  return { lines: lines.slice(0, maxRows), targets: targets.slice(0, maxRows) };
}

function workspaceFooter(workspace: RenderWorkspace): string {
  const evidenceKey = workspace.evidenceCommand.displayKey ?? "i";
  const moreKey = workspace.moreCommand.displayKey ?? ":";
  return `Esc Back · ${evidenceKey} Evidence · ${moreKey} Actions`;
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

function sidePaneGlyph(slot: number | undefined, focusedSlot: number | undefined, styles: LayoutStyles): string {
  if (slot === undefined) return "";
  return `${slot === focusedSlot ? styles.accent(`◫${slot}`) : styles.muted(`◫${slot}`)} `;
}

function rowRightAdornment(session: RenderSession, styles: LayoutStyles, board: boolean, width: number): string {
  const mode = activeWorkflowMode(session);
  const fits = (right: string): boolean => Boolean(right) && width - displayWidth(right) - 1 >= 12;
  if (board) {
    if (session.kind === "subagent" || !session.workflow) return "";
    const short = railCompact(session.workflow, mode, styles);
    return fits(short) ? short : "";
  }
  if (session.archivedAge) return fits(styles.dim(session.archivedAge)) ? styles.dim(session.archivedAge) : "";

  const lifecycle = session.section === "backlog" ? styles.muted("backlog") : "";
  const group = styles.dim(session.group);
  const stage = session.workflow ? railCompact(session.workflow, mode, styles) : "";
  const activity = session.displayStatus === "running" ? "" : session.activityAge ? styles.dim(session.activityAge) : "";
  const join = (parts: string[]) => parts.filter(Boolean).join(styles.border(" · "));
  const candidates = lifecycle
    ? [[lifecycle, group, stage, activity], [lifecycle, group, stage], [lifecycle, group], [lifecycle, stage], [lifecycle]]
    : [[group, stage, activity], [group, stage], [group, activity], [group], [stage, activity], [activity], [stage]];
  return candidates.map(join).find(fits) ?? "";
}

function railFull(workflow: WorkflowRuntimeSnapshot, mode: WorkflowModeDisplay | undefined, styles: LayoutStyles): string {
  const rail = workflow.steps
    .map((step, index) => {
      const short = index === workflow.activeIndex ? activeStepShort(workflow, mode) : step.short;
      const styledShort = index === workflow.activeIndex ? styles.accent(short) : styles.dim(short);
      return `${styledWorkflowMarker(workflow, index, styles)} ${styledShort}`;
    })
    .join(styles.border("─"));
  return workflow.ticketId ? `${rail} ${styles.border("·")} ${styles.muted(workflow.ticketId)}` : rail;
}

function railLine(workflow: WorkflowRuntimeSnapshot, mode: WorkflowModeDisplay | undefined, width: number, styles: LayoutStyles): string {
  const full = railFull(workflow, mode, styles);
  return displayWidth(full) <= width ? full : railCompact(workflow, mode, styles);
}

function renderStatusEvidenceField(field: StatusEvidenceField, width: number, styles: LayoutStyles): string[] {
  if (field.kind === "result") {
    const tier = field.tier.toUpperCase().replace("-", " ");
    const value = `${styles.status(field.status, field.status)} · ${cockpitTone(field.tier, styles)(tier)} · ${field.reason}`;
    return workField(field.label, value, width, styles, `${styles.accent(field.marker)} `);
  }
  const marker = field.tone === "success" ? styles.success(field.marker) : field.tone === "error" ? styles.error(field.marker) : styles.dim(field.marker);
  return workField(field.label, field.value, width, styles, `${marker} `);
}

function workField(label: string, value: string, width: number, styles: LayoutStyles, marker = ""): string[] {
  const labelText = styles.muted(pad(label, 9));
  const firstPrefix = `${labelText} `;
  const nextPrefix = `${pad("", 9)} `;
  const firstWidth = Math.max(4, width - displayWidth(firstPrefix) - displayWidth(marker));
  const nextWidth = Math.max(4, width - displayWidth(nextPrefix));
  return wrapWords(value, firstWidth, nextWidth).map((line, index) => index === 0 ? `${firstPrefix}${marker}${line}` : `${nextPrefix}${line}`);
}

function normalizedText(value: string | undefined): string {
  return value?.trim().replace(/\s+/g, " ").toLowerCase() ?? "";
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

function formatStatusCounts(counts: StatusCounts, styles: LayoutStyles, muted = false): string {
  return STATUS_ORDER
    .flatMap(([status, symbol]) => counts[status] ? [muted ? styles.muted(`${symbol}${counts[status]}`) : styles.status(status, `${symbol}${counts[status]}`)] : [])
    .join(" ");
}

function attentionGlyph(kind: NonNullable<RenderSession["attention"]>["kind"], styles: LayoutStyles): string {
  if (kind === "ready") return styles.success("✓");
  if (kind === "question") return styles.warning("?");
  return styles.error("!");
}

interface SessionRowOptions {
  board?: boolean;
  focusedSlot?: number;
  selectionMarker?: boolean;
  titleSource?: "context" | "stored";
  prefixMode?: "default" | "none";
}

function renderSessionRow(session: RenderSession, width: number, styles: LayoutStyles, options: SessionRowOptions = {}): string {
  const board = options.board ?? false;
  const selectionMarker = options.selectionMarker ?? true;
  const attention = selectionMarker && session.attention ? attentionGlyph(session.attention.kind, styles) : "";
  const selection = session.selected && selectionMarker ? styles.accent("▌") : "";
  const prefix = selection ? `${selection}${attention ? ` ${attention}` : ""}` : attention || (session.status === "stopped" ? styles.dim("·") : " ");
  const symbol = session.section === "active"
    ? styles.status(session.displayStatus, session.symbol)
    : styles.muted(session.symbol);
  const titleText = session.kind === "subagent" ? (session.agentName ?? "subagent") : session.title;
  const styleTitle = (value: string) => session.status === "stopped" ? styles.dim(value) : value;
  const sidePaneMarker = sidePaneGlyph(session.sidePaneSlot, options.focusedSlot, styles);
  const repoBadge = !board && session.repoCount > 1 && session.kind !== "subagent" ? styles.dim(` ⧉ ${session.repoCount}`) : "";
  const worktreeMarker = !board && session.worktreeBranch && session.kind !== "subagent" ? styles.accent("⎇ ") : "";
  const disclosureBadge = session.kind !== "subagent" && session.boardDescendantCount
    ? ` ${styles.dim(session.boardExpanded ? "▾" : "▸")}`
    : "";
  const runningBadge = board && session.kind !== "subagent" && session.runningSubagentCount
    ? ` ${styles.success(`⚙︎${session.runningSubagentCount}`)}`
    : "";
  const indent = session.depth > 0 ? styles.dim(`${"  ".repeat(session.depth)}└ `) : "";
  const rowPrefix = options.prefixMode === "none" ? "" : board && !selectionMarker && prefix === " " ? prefix : `${prefix} `;
  const leftPrefix = `${rowPrefix}${indent}${symbol} ${sidePaneMarker}${worktreeMarker}`;
  const leftSuffix = `${disclosureBadge}${runningBadge}${repoBadge}`;
  const fixedLeftWidth = displayWidth(leftPrefix) + displayWidth(leftSuffix);
  const adornmentWidth = board ? width : Math.max(0, width - fixedLeftWidth);
  const right = rowRightAdornment(session, styles, board, adornmentWidth);
  const rightSpace = right ? displayWidth(right) + 1 : 0;
  const titleWidth = Math.max(0, width - displayWidth(leftPrefix) - displayWidth(leftSuffix) - rightSpace);
  const text = `${leftPrefix}${styleTitle(truncate(titleText, titleWidth))}${leftSuffix}`;
  return right ? twoColumn(text, right, width) : truncate(text, width);
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
