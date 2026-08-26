import { ARCHIVE_PRUNE_AFTER_MS, type SessionSection } from "../core/session-bucket.js";
import { orderedSessions } from "../core/session-order.js";
import { createSessionTreeIndex, orderedSessionRows, sessionDepth, type SessionTreeIndex } from "../core/session-tree.js";
import { primaryWorktree, sessionWorktrees } from "../core/worktree.js";
import type { PiAgentHubContextV1, RuntimeSession, SessionAttention, SessionStatus, WorkflowRuntimeSnapshot, WorkflowSnapshot } from "../core/types.js";
import { archiveSectionRows, effectiveSessionLifecycle } from "./archive-section.js";
import type { CollapsibleSection } from "./dialog.js";

export type CockpitTier = "needs-you" | "health" | "active" | "quiet" | "archived";

export interface RenderSession {
  id: string;
  cockpitTier: CockpitTier;
  cockpitOwnerId: string;
  title: string;
  cwd: string;
  additionalCwds: string[];
  workspaceCwd?: string;
  repoCount: number;
  group: string;
  section: SessionSection;
  bucketChangedAt?: number;
  archivedAge?: string;
  archiveRetentionIn?: string;
  lastActivityAt?: number;
  activityAge?: string;
  status: SessionStatus;
  displayStatus: "running" | "waiting" | "idle" | "error" | "stopped";
  symbol: string;
  needsAttention: boolean;
  selected: boolean;
  error?: string;
  sessionFile?: string;
  enabledMcpServers: string[];
  skillCount?: number;
  kind: "main" | "subagent";
  depth: number;
  parentId?: string;
  agentName?: string;
  taskPreview?: string;
  resultSummary?: string;
  context?: PiAgentHubContextV1;
  ticketId?: string;
  ticketSubtitle?: string;
  ticketDescription?: string;
  attention?: SessionAttention;
  boardDescendantCount?: number;
  boardExpanded?: boolean;
  runningSubagentCount?: number;
  plan?: RenderPlanSummary;
  workflow?: WorkflowRuntimeSnapshot;
  worktreePath?: string;
  worktreeBranch?: string;
  worktreeBaseBranch?: string;
  worktreeOwnedByHub?: boolean;
  worktreeCount?: number;
  sidePaneSlot?: number;
}

export interface StatusCounts {
  running: number;
  waiting: number;
  idle: number;
  error: number;
  stopped: number;
}

export interface RenderGroup {
  name: string;
  statusCounts: StatusCounts;
  attentionCount: number;
  sessions: RenderSession[];
}

export interface ArchiveDisclosure {
  expanded: boolean;
  hiddenParents: number;
  selected: boolean;
}

export interface RenderSection {
  key: string;
  cockpitTier?: CockpitTier;
  title: string;
  statusCounts: StatusCounts;
  sessionsTotal: number;
  groups: RenderGroup[];
  collapsible?: boolean;
  collapsed?: boolean;
  selected?: boolean;
  archiveDisclosure?: ArchiveDisclosure;
}

export interface RenderSummary {
  total: number;
  visibleTotal: number;
  statusCounts: StatusCounts;
}

export interface PanelStripItem {
  slot: 1 | 2 | 3 | 4;
  title?: string;
}

export interface RenderPlanSummary {
  feature?: string;
  phase?: { title: string; index: number; count: number };
  tasks?: { completed: number; total: number };
  phases?: { completed: number; total: number }[];
  nextStep?: string;
}

export interface BoardHiddenCounts {
  nonActive: number;
}

export interface RenderModel {
  width: number;
  height?: number;
  listScrollTop?: number;
  empty: boolean;
  noMatches: boolean;
  noBoardSessions: boolean;
  showPreview: boolean;
  compactFooter: boolean;
  sections: RenderSection[];
  summary: RenderSummary;
  boardCardCount: number;
  boardStatusCounts: StatusCounts;
  boardHidden: BoardHiddenCounts;
  selected?: RenderSession;
  footer: string;
  filter?: string;
  preview: string;
  detailsExpanded: boolean;
  grouping: "project" | "stage";
  density: "compact" | "all-cards";
  panelStrip?: PanelStripItem[];
  sidePaneFocusedSlot?: number;
}

export interface DashboardProjection {
  allRows: RuntimeSession[];
  allTree: SessionTreeIndex<RuntimeSession>;
  activeRows: RuntimeSession[];
  boardProjection: BoardProjection<RuntimeSession>;
  archive: ReturnType<typeof archiveSectionRows>;
  visible: RuntimeSession[];
  filterActive: boolean;
  board: boolean;
  cockpitTierById: ReadonlyMap<string, CockpitTier>;
  cockpitOwnerById: ReadonlyMap<string, string>;
}

export interface DashboardProjectionInput {
  sessions: RuntimeSession[];
  filter?: string;
  grouping?: "project" | "stage";
  archiveExpanded?: boolean;
  collapsedSections?: ReadonlySet<CollapsibleSection>;
  expandedBoardParentIds?: ReadonlySet<string>;
  expandedProjectParentIds?: ReadonlySet<string>;
}

/** Structural dashboard rows shared by rendering and navigation. */
export function buildDashboardProjection(input: DashboardProjectionInput): DashboardProjection {
  const board = (input.grouping ?? "project") === "stage";
  const filterActive = Boolean(input.filter?.trim());
  const sourceRows = orderedSessionRows(input.sessions);
  const sourceTree = createSessionTreeIndex(sourceRows);
  const { tierById: cockpitTierById, ownerById: cockpitOwnerById } = cockpitIndex(sourceRows, sourceTree);
  const allRows = filterActive ? orderedSessionRows(input.sessions, input.filter) : sourceRows;
  const allTree = filterActive ? createSessionTreeIndex(allRows) : sourceTree;
  const activeRows = allRows.filter((session) => effectiveSessionLifecycle(session, allRows, allTree).section === "active");
  const boardProjection = projectExpandedBoardRows(
    projectBoardRows(activeRows, allRows), input.expandedBoardParentIds ?? new Set(), filterActive,
  );
  const archive = archiveSectionRows(allRows, { expanded: input.archiveExpanded ?? false, filterActive }, allTree);
  const visibleProjectRows = visibleTreeRows(archive.rows, allRows, input.expandedProjectParentIds ?? new Set(), filterActive);
  const projectRows = orderCockpitRows(visibleProjectRows, cockpitTierById);
  const collapsedSections = input.collapsedSections ?? new Set<CollapsibleSection>();
  const visible = board ? boardProjection.rows : filterActive ? projectRows : projectRows.filter((session) => {
    const section = effectiveSessionLifecycle(session, allRows, allTree).section;
    return section !== "archived" || !collapsedSections.has("archived");
  });
  return { allRows, allTree, activeRows, boardProjection, archive, visible, filterActive, board, cockpitTierById, cockpitOwnerById };
}

function cockpitIndex(
  rows: RuntimeSession[],
  tree: SessionTreeIndex<RuntimeSession>,
): { tierById: Map<string, CockpitTier>; ownerById: Map<string, string> } {
  const ownerById = new Map<string, string>();
  const ownerRows = new Map<string, RuntimeSession>();
  for (const row of rows) {
    const trace = tree.trace(row);
    const owner = trace.owner ?? trace.terminal;
    ownerById.set(row.id, owner.id);
    ownerRows.set(owner.id, owner);
  }
  const tierByOwner = new Map<string, CockpitTier>();
  for (const owner of ownerRows.values()) tierByOwner.set(owner.id, cockpitTierFor(owner, rows, tree));
  const tierById = new Map<string, CockpitTier>();
  for (const row of rows) tierById.set(row.id, tierByOwner.get(ownerById.get(row.id)!)!);
  return { ownerById, tierById };
}

function cockpitTierFor(
  owner: RuntimeSession,
  rows: RuntimeSession[],
  tree: SessionTreeIndex<RuntimeSession>,
): CockpitTier {
  if (effectiveSessionLifecycle(owner, rows, tree).section === "archived") return "archived";
  if (visibleAttention(owner)) return "needs-you";
  if (owner.status === "error") return "health";
  if (owner.status === "starting" || owner.status === "running"
    || tree.descendants(owner.id).some((row) => row.status === "starting" || row.status === "running")) return "active";
  return "quiet";
}

const COCKPIT_TIER_ORDER: CockpitTier[] = ["needs-you", "health", "active", "quiet", "archived"];

function orderCockpitRows(rows: RuntimeSession[], tiers: ReadonlyMap<string, CockpitTier>): RuntimeSession[] {
  const order = new Map(COCKPIT_TIER_ORDER.map((tier, index) => [tier, index]));
  return rows.map((row, index) => ({ row, index }))
    .sort((a, b) => order.get(tiers.get(a.row.id)!)! - order.get(tiers.get(b.row.id)!)! || a.index - b.index)
    .map(({ row }) => row);
}

export interface BuildRenderModelInput {
  sessions: RuntimeSession[];
  selectedId?: string;
  width: number;
  height?: number;
  listScrollTop?: number;
  filter?: string;
  filterEditing?: boolean;
  preview?: string;
  detailsExpanded?: boolean;
  selectedSkillCount?: number;
  grouping?: "project" | "stage";
  density?: "compact" | "all-cards";
  now?: number;
  sidePaneSessionIds?: ReadonlyMap<string, number>;
  sidePaneFocusedSlot?: number;
  archiveExpanded?: boolean;
  archiveDisclosureSelected?: boolean;
  selectedSection?: CollapsibleSection;
  collapsedSections?: ReadonlySet<CollapsibleSection>;
  hidePreview?: boolean;
  expandedBoardParentIds?: ReadonlySet<string>;
  expandedProjectParentIds?: ReadonlySet<string>;
  structuralProjection?: DashboardProjection;
}

export function buildRenderModel(input: BuildRenderModelInput): RenderModel {
  const grouping = input.grouping ?? "project";
  const density = input.density ?? "compact";
  const projection = input.structuralProjection ?? buildDashboardProjection(input);
  const { allRows, allTree, boardProjection, archive, visible, filterActive, board, cockpitTierById, cockpitOwnerById } = projection;
  const collapsedSections = input.collapsedSections ?? new Set<CollapsibleSection>();
  const selectedId = pickSelectedId(input.archiveDisclosureSelected || input.selectedSection ? allRows : visible, input.selectedId);
  const sidePaneSessionIds = input.sidePaneSessionIds;
  const subagentStats = descendantSubagentStats(input.sessions, createSessionTreeIndex(input.sessions));
  const occupiedSlots = new Map<number, string>();
  for (const session of input.sessions) {
    const slot = sidePaneSessionIds?.get(session.id);
    if (slot !== undefined) occupiedSlots.set(slot, session.title);
  }
  const panelStrip = occupiedSlots.size
    ? ([1, 2, 3, 4] as const).map((slot) => ({ slot, ...(occupiedSlots.has(slot) ? { title: occupiedSlots.get(slot) } : {}) }))
    : undefined;
  const treeExpanded = (id: string) => filterActive || (board
    ? input.expandedBoardParentIds?.has(id) === true
    : input.expandedProjectParentIds?.has(id) === true);
  // Build each source row once. Visible selection is a small overlay: lifecycle
  // headers and archive disclosure can suppress the list highlight while keeping
  // the selected row available to the details pane.
  const allMapped = allRows.map((session) => toRenderSession(
    session, session.id === selectedId, allRows, allTree,
    session.id === selectedId ? input.selectedSkillCount : undefined, input.now,
    sidePaneSessionIds?.get(session.id), board, density, subagentStats.get(session.id), treeExpanded(session.id),
    cockpitTierById.get(session.id)!, cockpitOwnerById.get(session.id)!,
  ));
  const mappedById = new Map(allMapped.map((session) => [session.id, session]));
  const listSelected = !input.archiveDisclosureSelected && !input.selectedSection;
  const mapped = visible.flatMap((session) => {
    const rendered = mappedById.get(session.id);
    return rendered ? [{ ...rendered, selected: listSelected && rendered.id === selectedId }] : [];
  });
  const sections = board
    ? lanesForBoard(mapped, boardProjection)
    : cockpitSectionsForSessions(mapped, allMapped, archive.showDisclosure && !collapsedSections.has("archived") ? {
      expanded: input.archiveExpanded ?? false,
      hiddenParents: archive.hiddenParents,
      selected: input.archiveDisclosureSelected ?? false,
    } : undefined, collapsedSections, input.selectedSection, filterActive);

  const compactFooter = input.width < 90;
  const selected = (board ? mapped : allMapped).find((session) => session.id === selectedId);
  const worktreeFooter = selected?.worktreeOwnedByHub ? " · w Finish WT" : "";
  const showLifecycleFooter = selected && selected.kind !== "subagent" && input.width >= 120;
  const lifecycleFooter = showLifecycleFooter ? selected.section === "active" ? " · A Archive · B Backlog" : " · U Restore" : "";
  const deleteFooter = input.width >= 120 ? "d Delete" : "d Del";
  const boardParents = mapped.filter((session) => session.kind !== "subagent");
  const noBoardMatches = board && filterActive && allRows.length > 0 && mapped.length === 0;
  return {
    width: input.width,
    empty: input.sessions.length === 0,
    noMatches: input.sessions.length > 0 && (allRows.length === 0 || noBoardMatches),
    noBoardSessions: board && !filterActive && mapped.length === 0,
    showPreview: input.width >= 80 && !input.hidePreview,
    compactFooter,
    sections,
    summary: {
      total: input.sessions.length,
      visibleTotal: allRows.length,
      statusCounts: countRenderSessions(allMapped),
    },
    boardCardCount: boardParents.length,
    boardStatusCounts: countRenderSessions(boardParents),
    boardHidden: boardProjection.hidden,
    ...(input.height ? { height: input.height } : {}),
    ...(input.listScrollTop ? { listScrollTop: input.listScrollTop } : {}),
    selected,
    footer: compactFooter
      ? "1-4 Set · x# Close · F# Focus · ? Help"
      : input.width < 120
        ? "Enter Open · 1-4 Panels · x# Close · F#/Alt+# Focus · o Reset · / Filter · i Info · ? Help"
        : `Enter Open · 1-4 Panels · x# Close · F#/Alt+# Focus · o Reset · n New · / Filter  │  p Send · i Info · r Restart · R Rename · ${deleteFooter}${worktreeFooter}${lifecycleFooter}  │  v Density · S Lanes · ? Help`,
    filter: input.filter,
    preview: input.preview ?? "",
    detailsExpanded: input.detailsExpanded ?? false,
    grouping,
    density,
    ...(panelStrip ? { panelStrip } : {}),
    ...(input.sidePaneFocusedSlot !== undefined ? { sidePaneFocusedSlot: input.sidePaneFocusedSlot } : {}),
  };
}

export function visibleTreeRows<T extends BoardLaneRow>(
  rows: T[],
  allRows: T[],
  expandedParentIds: ReadonlySet<string>,
  revealAll = false,
): T[] {
  if (revealAll) return rows;
  const tree = createSessionTreeIndex(allRows);
  return rows.filter((row) => {
    if (row.kind !== "subagent") return true;
    const owner = tree.trace(row).owner;
    return !owner || expandedParentIds.has(owner.id);
  });
}

export interface BoardLaneRow {
  id: string;
  kind?: "main" | "subagent";
  parentId?: string;
  workflow?: WorkflowRuntimeSnapshot;
}

interface BoardProjection<T> {
  rows: T[];
  lanes: { key: string; title: string; rows: T[]; parentCount: number }[];
  hidden: BoardHiddenCounts;
}

export function boardLaneRows<T extends BoardLaneRow>(
  activeRows: T[],
  allRows: T[] = activeRows,
  options: { expandedParentIds?: ReadonlySet<string>; revealAll?: boolean } = {},
): { key: string; rows: T[] }[] {
  const projection = projectExpandedBoardRows(
    projectBoardRows(activeRows, allRows),
    options.expandedParentIds ?? new Set(),
    options.revealAll ?? false,
  );
  return projection.lanes.map(({ key, rows }) => ({ key, rows }));
}

function projectBoardRows<T extends BoardLaneRow>(activeRows: T[], allRows: T[]): BoardProjection<T> {
  const activeParents = activeRows.filter((row) => row.kind !== "subagent");
  const pipelineCounts = new Map<string, number>();
  for (const parent of activeParents) {
    const identity = workflowIdentity(parent.workflow);
    if (identity) pipelineCounts.set(identity, (pipelineCounts.get(identity) ?? 0) + 1);
  }
  const canonicalIdentity = [...pipelineCounts.entries()]
    .sort(([aId, aCount], [bId, bCount]) => bCount - aCount || aId.localeCompare(bId))[0]?.[0];
  const compatibleParents = canonicalIdentity
    ? activeParents.filter((parent) => workflowIdentity(parent.workflow) === canonicalIdentity)
    : [];
  const vocabularyOwner = compatibleParents
    .slice()
    .sort((a, b) => (b.workflow?.updatedAt ?? 0) - (a.workflow?.updatedAt ?? 0) || a.id.localeCompare(b.id))[0];
  const steps = vocabularyOwner?.workflow?.steps ?? [];
  const compatibleIds = new Set(compatibleParents.map((parent) => parent.id));
  const tree = createSessionTreeIndex(activeRows);
  const ownerOf = (row: T): T | undefined => tree.trace(row).owner;
  const workflowRows = activeRows.filter((row) => {
    const owner = ownerOf(row);
    return owner ? compatibleIds.has(owner.id) : false;
  });
  const lanes = steps.flatMap((step) => {
    const laneRows = workflowRows.filter((row) => {
      const owner = ownerOf(row);
      return owner?.workflow?.steps[owner.workflow.activeIndex]?.id === step.id;
    });
    if (!laneRows.length) return [];
    return [{
      key: step.id,
      title: (step.label ?? step.id).toUpperCase(),
      rows: laneRows,
      parentCount: laneRows.filter((row) => row.kind !== "subagent").length,
    }];
  });
  const otherRows = activeRows.filter((row) => {
    const owner = ownerOf(row);
    return owner ? !compatibleIds.has(owner.id) : false;
  });
  if (otherRows.length) {
    lanes.push({
      key: "other-active",
      title: "OTHER ACTIVE",
      rows: otherRows,
      parentCount: otherRows.filter((row) => row.kind !== "subagent").length,
    });
  }
  const allParents = allRows.filter((row) => row.kind !== "subagent");
  const activeParentIds = new Set(activeParents.map((row) => row.id));
  return {
    rows: lanes.flatMap((lane) => lane.rows),
    lanes,
    hidden: {
      nonActive: allParents.filter((parent) => !activeParentIds.has(parent.id)).length,
    },
  };
}

function projectExpandedBoardRows<T extends BoardLaneRow>(
  projection: BoardProjection<T>,
  expandedParentIds: ReadonlySet<string>,
  revealAll: boolean,
): BoardProjection<T> {
  const tree = createSessionTreeIndex(projection.rows);
  const topLevelParentId = (row: T): string | undefined => tree.trace(row).owner?.id;
  const lanes = projection.lanes.map((lane) => ({
    ...lane,
    rows: lane.rows.filter((row) => {
      if (row.kind !== "subagent" || revealAll) return true;
      const parentId = topLevelParentId(row);
      return parentId ? expandedParentIds.has(parentId) : false;
    }),
  }));
  return { ...projection, rows: lanes.flatMap((lane) => lane.rows), lanes };
}

function workflowIdentity(workflow: WorkflowSnapshot | undefined): string | undefined {
  if (!workflow || !Number.isFinite(workflow.updatedAt) || !Number.isInteger(workflow.activeIndex)) return undefined;
  if (!workflow.steps.length || workflow.activeIndex < 0 || workflow.activeIndex >= workflow.steps.length) return undefined;
  const ids = new Set<string>();
  const orderedIds: string[] = [];
  for (const step of workflow.steps) {
    const id = step.id?.trim();
    if (!id || !step.short?.trim() || ids.has(id)) return undefined;
    if (step.label !== undefined && !step.label.trim()) return undefined;
    ids.add(id);
    orderedIds.push(id);
  }
  return orderedIds.join("\u001f");
}

function lanesForBoard(sessions: RenderSession[], projection: BoardProjection<RuntimeSession>): RenderSection[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  return projection.lanes.map((lane) => {
    const rows = lane.rows.flatMap((row) => {
      const session = byId.get(row.id);
      return session ? [session] : [];
    });
    return {
      key: lane.key,
      title: lane.title,
      statusCounts: countRenderSessions(rows),
      sessionsTotal: lane.parentCount,
      groups: boardGroupsForSessions(rows),
    } satisfies RenderSection;
  });
}

export function retainSelectionAfterRefresh(
  previous: RuntimeSession[],
  next: RuntimeSession[],
  selectedId: string | undefined,
): string | undefined {
  if (!next.length) return undefined;
  if (selectedId && next.some((session) => session.id === selectedId)) return selectedId;
  const removed = previous.find((session) => session.id === selectedId);
  if (!removed) return next[0]?.id;

  const sameGroup = orderedSessions(next).filter((session) => session.group === removed.group);
  if (!sameGroup.length) return orderedSessions(next)[0]?.id;

  const previousSameGroup = orderedSessions(previous).filter((session) => session.group === removed.group);
  const oldIndex = previousSameGroup.findIndex((session) => session.id === selectedId);
  return sameGroup[Math.min(oldIndex, sameGroup.length - 1)]?.id ?? sameGroup.at(-1)?.id;
}

function pickSelectedId(sessions: RuntimeSession[], selectedId: string | undefined): string | undefined {
  if (!sessions.length) return undefined;
  if (selectedId && sessions.some((session) => session.id === selectedId)) return selectedId;
  return sessions[0]?.id;
}

function boardGroupsForSessions(sessions: RenderSession[]): RenderGroup[] {
  const tree = createSessionTreeIndex(sessions);
  const ownerGroup = (session: RenderSession): string => tree.trace(session).terminal.group;
  const groupsByName = new Map<string, RenderSession[]>();
  for (const session of sessions) {
    const name = ownerGroup(session);
    const group = groupsByName.get(name) ?? [];
    group.push(session);
    groupsByName.set(name, group);
  }
  return [...groupsByName.entries()].map(([name, groupSessions]) => ({
    name,
    statusCounts: countRenderSessions(groupSessions),
    attentionCount: countAttentionSessions(groupSessions),
    sessions: groupSessions,
  } satisfies RenderGroup));
}

function cockpitSectionsForSessions(
  sessions: RenderSession[],
  allSessions: RenderSession[],
  archiveDisclosure?: ArchiveDisclosure,
  collapsedSections: ReadonlySet<CollapsibleSection> = new Set(),
  selectedSection?: CollapsibleSection,
  filterActive = false,
): RenderSection[] {
  const titles: Record<CockpitTier, string> = {
    "needs-you": "NEEDS YOU",
    health: "HEALTH",
    active: "ACTIVE",
    quiet: "QUIET",
    archived: "ARCHIVED",
  };
  return COCKPIT_TIER_ORDER.flatMap((tier) => {
    const sectionSessions = sessions.filter((session) => session.cockpitTier === tier);
    const allSectionSessions = allSessions.filter((session) => session.cockpitTier === tier);
    if (!allSectionSessions.length) return [];
    const collapsed = tier === "archived" && collapsedSections.has("archived");
    return [{
      key: tier,
      cockpitTier: tier,
      title: titles[tier],
      statusCounts: countRenderSessions(allSectionSessions),
      sessionsTotal: new Set(allSectionSessions.map((session) => session.cockpitOwnerId)).size,
      groups: collapsed && !filterActive ? [] : [{
        name: "",
        statusCounts: countRenderSessions(allSectionSessions),
        attentionCount: countAttentionSessions(sectionSessions),
        sessions: sectionSessions,
      }],
      collapsible: tier === "archived",
      collapsed,
      selected: tier === "archived" && selectedSection === "archived",
      ...(tier === "archived" && archiveDisclosure ? { archiveDisclosure } : {}),
    } satisfies RenderSection];
  });
}

interface DescendantSubagentStats {
  total: number;
  running: number;
}

function descendantSubagentStats(
  sessions: RuntimeSession[],
  tree: SessionTreeIndex<RuntimeSession>,
): Map<string, DescendantSubagentStats> {
  const stats = new Map<string, DescendantSubagentStats>();
  for (const session of sessions) {
    if (session.kind !== "subagent") continue;
    for (const parentId of tree.trace(session).linkedParentIds) {
      const current = stats.get(parentId) ?? { total: 0, running: 0 };
      current.total += 1;
      if (session.status === "starting" || session.status === "running") current.running += 1;
      stats.set(parentId, current);
    }
  }
  return stats;
}

function toRenderSession(session: RuntimeSession, selected: boolean, sessions: RuntimeSession[], tree: SessionTreeIndex<RuntimeSession>, skillCount: number | undefined, now: number | undefined, sidePaneSlot: number | undefined, board: boolean, density: RenderModel["density"], subagentStats: DescendantSubagentStats | undefined, boardExpanded: boolean, cockpitTier: CockpitTier, cockpitOwnerId: string): RenderSession {
  const displayStatus = displayStatusFor(session.status);
  const worktree = primaryWorktree(session);
  const worktrees = sessionWorktrees(session);
  const lifecycle = effectiveSessionLifecycle(session, sessions, tree);
  const attention = visibleAttention(session);
  const archiveTiming = archiveTimingFor(lifecycle.section, lifecycle.bucketChangedAt, now);
  return {
    id: session.id,
    cockpitTier,
    cockpitOwnerId,
    title: session.title,
    cwd: session.cwd,
    additionalCwds: session.additionalCwds ?? [],
    workspaceCwd: session.workspaceCwd,
    repoCount: 1 + (session.additionalCwds?.length ?? 0),
    group: session.group,
    section: lifecycle.section,
    bucketChangedAt: lifecycle.bucketChangedAt,
    ...archiveTiming,
    lastActivityAt: session.lastActivityAt,
    activityAge: activityAge(session.lastActivityAt, now),
    status: session.status,
    displayStatus,
    symbol: symbolFor(displayStatus),
    needsAttention: session.status === "waiting" && session.acknowledgedAt === undefined,
    selected,
    error: session.error,
    sessionFile: session.sessionFile,
    enabledMcpServers: session.enabledMcpServers ?? [],
    ...(skillCount !== undefined ? { skillCount } : {}),
    kind: session.kind ?? "main",
    depth: sessionDepth(session, sessions, tree),
    parentId: session.parentId,
    agentName: session.agentName,
    taskPreview: session.taskPreview,
    resultSummary: session.resultSummary,
    context: session.context,
    ...ticketDisplay(session),
    ...(session.kind !== "subagent" && subagentStats?.total ? {
      boardDescendantCount: subagentStats.total,
      boardExpanded,
      ...(subagentStats.running ? { runningSubagentCount: subagentStats.running } : {}),
    } : {}),
    ...(attention ? { attention } : {}),
    ...(density === "all-cards" && lifecycle.section === "active" && session.kind !== "subagent" && session.workflow?.plan
      ? { plan: planSummary(session.workflow.plan) }
      : {}),
    workflow: session.workflow,
    worktreePath: worktree?.path ?? session.worktreePath,
    worktreeBranch: worktree?.branch ?? session.worktreeBranch,
    worktreeBaseBranch: worktree?.baseBranch ?? session.worktreeBaseBranch,
    worktreeOwnedByHub: session.worktreeOwnedByHub,
    worktreeCount: worktrees.length || undefined,
    sidePaneSlot,
  };
}

function archiveTimingFor(section: SessionSection, changedAt: number | undefined, now: number | undefined): Pick<RenderSession, "archivedAge" | "archiveRetentionIn"> {
  if (section !== "archived" || changedAt === undefined || now === undefined) return {};
  const elapsed = Math.max(0, now - changedAt);
  const remaining = ARCHIVE_PRUNE_AFTER_MS - elapsed;
  return {
    archivedAge: ageLabel(elapsed),
    archiveRetentionIn: remaining <= 0 ? "now" : remaining < 60_000 ? "<1m" : ageLabel(remaining),
  };
}

function activityAge(lastActivityAt: number | undefined, now: number | undefined): string | undefined {
  if (lastActivityAt === undefined || now === undefined) return undefined;
  return ageLabel(Math.max(0, now - lastActivityAt));
}

function visibleAttention(session: RuntimeSession): SessionAttention | undefined {
  return session.status === "waiting" || session.status === "idle" ? session.context?.attention : undefined;
}

function ticketDisplay(session: RuntimeSession): Pick<RenderSession, "ticketId" | "ticketSubtitle" | "ticketDescription"> {
  const runtimeId = session.workflow?.ticketId;
  const contextTicket = session.context?.ticket;
  if (runtimeId && contextTicket?.id !== runtimeId) return { ticketId: runtimeId };
  const ticketId = runtimeId ?? contextTicket?.id;
  return ticketId ? {
    ticketId,
    ...(contextTicket?.subtitle ? { ticketSubtitle: contextTicket.subtitle } : {}),
    ...(contextTicket?.description ? { ticketDescription: contextTicket.description } : {}),
  } : {};
}

function planSummary(plan: NonNullable<WorkflowRuntimeSnapshot["plan"]>): RenderPlanSummary | undefined {
  const summary: RenderPlanSummary = {
    phase: plan.phase,
    tasks: plan.tasks,
    phases: plan.phases,
    nextStep: plan.nextStep,
  };
  return summary.phase || summary.tasks || summary.phases || summary.nextStep ? summary : undefined;
}

function ageLabel(ageMs: number): string {
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (ageMs < minute) return "now";
  if (ageMs < hour) return `${Math.floor(ageMs / minute)}m`;
  if (ageMs < day) return `${Math.floor(ageMs / hour)}h`;
  return `${Math.floor(ageMs / day)}d`;
}

function displayStatusFor(status: SessionStatus): RenderSession["displayStatus"] {
  if (status === "starting") return "running";
  return status;
}

function symbolFor(status: RenderSession["displayStatus"]): string {
  switch (status) {
    case "running": return "●";
    case "waiting": return "◐";
    case "idle": return "○";
    case "error": return "×";
    case "stopped": return "-";
  }
}

function emptyStatusCounts(): StatusCounts {
  return { running: 0, waiting: 0, idle: 0, error: 0, stopped: 0 };
}

function countRenderSessions(sessions: RenderSession[]): StatusCounts {
  const counts = emptyStatusCounts();
  for (const session of sessions) counts[session.displayStatus] += 1;
  return counts;
}

function countAttentionSessions(sessions: RenderSession[]): number {
  return sessions.reduce((count, session) => count + (session.needsAttention ? 1 : 0), 0);
}
