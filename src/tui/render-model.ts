import { ARCHIVE_PRUNE_AFTER_MS, type SessionSection } from "../core/session-bucket.js";
import { orderedSessions } from "../core/session-order.js";
import { createSessionTreeIndex, orderedSessionRows, sessionDepth, type SessionTreeIndex } from "../core/session-tree.js";
import { primaryWorktree, sessionWorktrees } from "../core/worktree.js";
import type { PiAgentHubContextV1, RuntimeSession, SessionAttention, SessionStatus, WorkflowRuntimeSnapshot, WorkflowSnapshot } from "../core/types.js";
import { archiveSectionRows, effectiveSessionLifecycle } from "./archive-section.js";
import { ageLabel } from "./age.js";
import type { CollapsibleSection } from "./dialog.js";
import { dashboardFooter, pinnedDashboardFooter, type WorkspaceCommandSelection } from "./dashboard-commands.js";

export type CockpitTier = "needs-you" | "health" | "active" | "quiet" | "archived";

export type CockpitPlacementReason =
  | { kind: "archived"; ownerId: string; ownerTitle: string }
  | { kind: "explicit-attention"; ownerId: string; ownerTitle: string; attentionKind: SessionAttention["kind"] }
  | { kind: "owner-error"; ownerId: string; ownerTitle: string }
  | { kind: "owner-active"; ownerId: string; ownerTitle: string; status: "starting" | "running" }
  | { kind: "descendant-active"; ownerId: string; ownerTitle: string; driverId: string; driverTitle: string; status: "starting" | "running" }
  | { kind: "quiet"; ownerId: string; ownerTitle: string };

export interface RenderSession {
  id: string;
  cockpitTier: CockpitTier;
  cockpitOwnerId: string;
  cockpitPlacement: CockpitPlacementReason;
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
  statusEvidence?: RuntimeSession["statusEvidence"];
  displayStatus: "running" | "waiting" | "idle" | "error" | "stopped";
  symbol: string;
  needsAttention: boolean;
  selected: boolean;
  error?: string;
  sessionFile?: string;
  enabledMcpServers: string[];
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
  hiddenChildRequestCount?: number;
  plan?: RenderPlanSummary;
  workflow?: WorkflowRuntimeSnapshot;
  worktreePath?: string;
  worktreeBranch?: string;
  worktreeBaseBranch?: string;
  worktreeOwnedByHub?: boolean;
  worktreeCount?: number;
  pinned?: boolean;
  pinSlot?: number;
  pinFocused?: boolean;
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
  hiddenChildRequestCount: number;
}

export interface RenderSummary {
  total: number;
  visibleTotal: number;
  ownerTotal: number;
  visibleOwnerTotal: number;
  statusCounts: StatusCounts;
}

export interface CockpitNavigationEntry {
  tier: CockpitTier;
  label: string;
  ownerCount: number;
  firstOwnerId?: string;
}

export interface RenderCockpitNavigationEntry extends CockpitNavigationEntry {
  selected: boolean;
}

export interface RenderPinSummary {
  slots: readonly { slot: number; title?: string; active: boolean }[];
  constrained: boolean;
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

export interface RenderWorkspace extends WorkspaceCommandSelection {
  session: RenderSession;
  owner?: RenderSession;
  descendants: RenderSession[];
  evidenceVisible: boolean;
  fullScreen: boolean;
}

export interface RenderModel {
  width: number;
  now: number;
  height?: number;
  listScrollTop?: number;
  empty: boolean;
  noMatches: boolean;
  noBoardSessions: boolean;
  showWorkspace: boolean;
  compactFooter: boolean;
  sections: RenderSection[];
  cockpitNavigation: RenderCockpitNavigationEntry[];
  summary: RenderSummary;
  boardCardCount: number;
  boardTotalCardCount: number;
  boardHidden: BoardHiddenCounts;
  selected?: RenderSession;
  workspace?: RenderWorkspace;
  footer: string;
  filter?: string;
  grouping: "project" | "stage";
  pinMode: boolean;
  pinSummary?: RenderPinSummary;
}

export interface DashboardProjection {
  allRows: RuntimeSession[];
  allTree: SessionTreeIndex<RuntimeSession>;
  activeRows: RuntimeSession[];
  boardProjection: BoardProjection<RuntimeSession>;
  boardTotalCardCount: number;
  archive: ReturnType<typeof archiveSectionRows>;
  cockpitNavigation: CockpitNavigationEntry[];
  visible: RuntimeSession[];
  filterActive: boolean;
  board: boolean;
  cockpitTierById: ReadonlyMap<string, CockpitTier>;
  cockpitOwnerById: ReadonlyMap<string, string>;
  cockpitPlacementById: ReadonlyMap<string, CockpitPlacementReason>;
}

export interface DashboardProjectionInput {
  sessions: RuntimeSession[];
  filter?: string;
  grouping?: "project" | "stage";
  archiveExpanded?: boolean;
  collapsedSections?: ReadonlySet<CollapsibleSection>;
  expandedBoardParentIds?: ReadonlySet<string>;
  expandedProjectParentIds?: ReadonlySet<string>;
  revealedSessionId?: string;
}

/** Structural dashboard rows shared by rendering and navigation. */
export function buildDashboardProjection(input: DashboardProjectionInput): DashboardProjection {
  const board = (input.grouping ?? "project") === "stage";
  const filterActive = Boolean(input.filter?.trim());
  const sourceRows = orderedSessionRows(input.sessions);
  const sourceTree = createSessionTreeIndex(sourceRows);
  const { tierById: cockpitTierById, ownerById: cockpitOwnerById, placementById: cockpitPlacementById } = cockpitIndex(sourceRows, sourceTree);
  const allRows = filterActive ? orderedSessionRows(input.sessions, input.filter) : sourceRows;
  const allTree = filterActive ? createSessionTreeIndex(allRows) : sourceTree;
  const sourceActiveRows = sourceRows.filter((session) => effectiveSessionLifecycle(session, sourceRows, sourceTree).section === "active");
  const activeRows = filterActive
    ? allRows.filter((session) => effectiveSessionLifecycle(session, allRows, allTree).section === "active")
    : sourceActiveRows;
  const boardTotalCardCount = sourceActiveRows.filter((session) => session.kind !== "subagent").length;
  const boardProjection = projectExpandedBoardRows(
    projectBoardRows(activeRows, allRows), input.expandedBoardParentIds ?? new Set(), filterActive,
  );
  let archive = archiveSectionRows(allRows, { expanded: input.archiveExpanded ?? false, filterActive }, allTree);
  const revealed = input.revealedSessionId ? allTree.get(input.revealedSessionId) : undefined;
  const revealedOwner = revealed ? (allTree.trace(revealed).owner ?? allTree.trace(revealed).terminal) : undefined;
  const revealedArchiveIds = new Set<string>();
  if (revealedOwner && effectiveSessionLifecycle(revealedOwner, allRows, allTree).section === "archived") {
    revealedArchiveIds.add(revealedOwner.id);
    for (const descendant of allTree.descendants(revealedOwner.id)) revealedArchiveIds.add(descendant.id);
    const archiveRowIds = new Set(archive.rows.map((row) => row.id));
    archive = {
      ...archive,
      rows: allRows.filter((row) => archiveRowIds.has(row.id) || revealedArchiveIds.has(row.id)),
    };
  }
  const visibleProjectRows = visibleTreeRows(archive.rows, allRows, input.expandedProjectParentIds ?? new Set(), filterActive);
  const projectRows = orderCockpitRows(visibleProjectRows, cockpitTierById);
  const cockpitNavigation = COCKPIT_TIER_ORDER.map((tier) => {
    const owners = allRows.filter((row) => cockpitTierById.get(row.id) === tier && cockpitOwnerById.get(row.id) === row.id);
    const firstOwner = projectRows.find((row) => cockpitTierById.get(row.id) === tier && cockpitOwnerById.get(row.id) === row.id);
    return {
      tier,
      label: COCKPIT_TIER_LABELS[tier],
      ownerCount: owners.length,
      ...(firstOwner ? { firstOwnerId: firstOwner.id } : {}),
    };
  });
  const collapsedSections = input.collapsedSections ?? new Set<CollapsibleSection>();
  const visible = board ? boardProjection.rows : filterActive ? projectRows : projectRows.filter((session) => {
    const section = effectiveSessionLifecycle(session, allRows, allTree).section;
    return section !== "archived" || !collapsedSections.has("archived") || revealedArchiveIds.has(session.id);
  });
  return { allRows, allTree, activeRows, boardProjection, boardTotalCardCount, archive, cockpitNavigation, visible, filterActive, board, cockpitTierById, cockpitOwnerById, cockpitPlacementById };
}

function cockpitIndex(
  rows: RuntimeSession[],
  tree: SessionTreeIndex<RuntimeSession>,
): {
  tierById: Map<string, CockpitTier>;
  ownerById: Map<string, string>;
  placementById: Map<string, CockpitPlacementReason>;
} {
  const ownerById = new Map<string, string>();
  const ownerRows = new Map<string, RuntimeSession>();
  for (const row of rows) {
    const trace = tree.trace(row);
    const owner = trace.owner ?? trace.terminal;
    ownerById.set(row.id, owner.id);
    ownerRows.set(owner.id, owner);
  }
  const decisionByOwner = new Map<string, { tier: CockpitTier; placement: CockpitPlacementReason }>();
  for (const owner of ownerRows.values()) decisionByOwner.set(owner.id, cockpitPlacementFor(owner, rows, tree));
  const tierById = new Map<string, CockpitTier>();
  const placementById = new Map<string, CockpitPlacementReason>();
  for (const row of rows) {
    const decision = decisionByOwner.get(ownerById.get(row.id)!)!;
    tierById.set(row.id, decision.tier);
    placementById.set(row.id, decision.placement);
  }
  return { ownerById, tierById, placementById };
}

function cockpitPlacementFor(
  owner: RuntimeSession,
  rows: RuntimeSession[],
  tree: SessionTreeIndex<RuntimeSession>,
): { tier: CockpitTier; placement: CockpitPlacementReason } {
  const ownerFields = { ownerId: owner.id, ownerTitle: owner.title };
  if (effectiveSessionLifecycle(owner, rows, tree).section === "archived") {
    return { tier: "archived", placement: { kind: "archived", ...ownerFields } };
  }
  const attention = visibleAttention(owner);
  if (attention) return { tier: "needs-you", placement: { kind: "explicit-attention", ...ownerFields, attentionKind: attention.kind } };
  if (owner.status === "error") return { tier: "health", placement: { kind: "owner-error", ...ownerFields } };
  if (owner.status === "starting" || owner.status === "running") {
    return { tier: "active", placement: { kind: "owner-active", ...ownerFields, status: owner.status } };
  }
  const driver = tree.descendants(owner.id).find((row) => row.status === "starting" || row.status === "running");
  if (driver && (driver.status === "starting" || driver.status === "running")) {
    return {
      tier: "active",
      placement: {
        kind: "descendant-active",
        ...ownerFields,
        driverId: driver.id,
        driverTitle: driver.agentName ?? driver.title,
        status: driver.status,
      },
    };
  }
  return { tier: "quiet", placement: { kind: "quiet", ...ownerFields } };
}

const COCKPIT_TIER_ORDER: CockpitTier[] = ["needs-you", "health", "active", "quiet", "archived"];
const COCKPIT_TIER_LABELS: Record<CockpitTier, string> = {
  "needs-you": "NEEDS YOU",
  health: "HEALTH",
  active: "ACTIVE",
  quiet: "QUIET",
  archived: "ARCHIVED",
};

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
  workspaceCommands?: WorkspaceCommandSelection;
  workspaceEvidenceVisible?: boolean;
  workspaceFullScreen?: boolean;
  grouping?: "project" | "stage";
  now?: number;
  pinSlots?: readonly (string | undefined)[];
  activePinnedSessionId?: string;
  pinCapacity?: number;
  pinConstrained?: boolean;
  archiveExpanded?: boolean;
  archiveDisclosureSelected?: boolean;
  selectedSection?: CollapsibleSection;
  collapsedSections?: ReadonlySet<CollapsibleSection>;
  expandedBoardParentIds?: ReadonlySet<string>;
  expandedProjectParentIds?: ReadonlySet<string>;
  revealedSessionId?: string;
  structuralProjection?: DashboardProjection;
}

export function buildRenderModel(input: BuildRenderModelInput): RenderModel {
  const grouping = input.grouping ?? "project";
  const projection = input.structuralProjection ?? buildDashboardProjection(input);
  const { allRows, allTree, boardProjection, boardTotalCardCount, archive, cockpitNavigation, visible, filterActive, board, cockpitTierById, cockpitOwnerById, cockpitPlacementById } = projection;
  const collapsedSections = input.collapsedSections ?? new Set<CollapsibleSection>();
  const selectedId = pickSelectedId(input.archiveDisclosureSelected || input.selectedSection ? allRows : visible, input.selectedId);
  const pinSlots = input.pinSlots ?? [];
  const pinned = new Set(pinSlots.filter((id): id is string => Boolean(id)));
  const slotBySession = new Map(pinSlots.flatMap((id, index) => id ? [[id, index + 1] as const] : []));
  const pinMode = pinned.size > 0;
  const subagentStats = descendantSubagentStats(input.sessions, createSessionTreeIndex(input.sessions));
  const attentiveDescendantIds = descendantAttentionIds(input.sessions, cockpitOwnerById);
  const visibleIds = new Set(visible.map((session) => session.id));
  const hiddenAttentionCount = (id: string) => [...(attentiveDescendantIds.get(id) ?? [])]
    .filter((descendantId) => !visibleIds.has(descendantId)).length;
  const treeExpanded = (id: string) => filterActive || (board
    ? input.expandedBoardParentIds?.has(id) === true
    : input.expandedProjectParentIds?.has(id) === true);
  // Build each source row once. Visible selection is a small overlay: lifecycle
  // headers and archive disclosure can suppress the list highlight while keeping
  // the selected row available to the details pane.
  const allMapped = allRows.map((session) => toRenderSession(
    session, session.id === selectedId, allRows, allTree, input.now,
    slotBySession.get(session.id), pinned.has(session.id), session.id === input.activePinnedSessionId, board, subagentStats.get(session.id), treeExpanded(session.id),
    cockpitTierById.get(session.id)!, cockpitOwnerById.get(session.id)!, cockpitPlacementById.get(session.id)!, hiddenAttentionCount(session.id),
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
    } : undefined, collapsedSections, input.selectedSection,
    filterActive || (input.revealedSessionId !== undefined && mappedById.get(input.revealedSessionId)?.cockpitTier === "archived"));

  const compactFooter = input.width < 90;
  const selected = (board ? mapped : allMapped).find((session) => session.id === selectedId);
  const selectedSource = selected ? allTree.get(selected.id) : undefined;
  const ownerSource = selectedSource ? allTree.trace(selectedSource).owner : undefined;
  const workspace = selected && input.workspaceCommands ? {
    ...input.workspaceCommands,
    session: selected,
    ...(ownerSource && ownerSource.id !== selected.id ? { owner: mappedById.get(ownerSource.id) } : {}),
    descendants: selectedSource ? allTree.descendants(selected.id).flatMap((row) => {
      const rendered = mappedById.get(row.id);
      return rendered ? [rendered] : [];
    }) : [],
    evidenceVisible: input.workspaceEvidenceVisible ?? false,
    fullScreen: input.workspaceFullScreen ?? false,
  } : undefined;
  const boardParents = mapped.filter((session) => session.kind !== "subagent");
  const noBoardMatches = board && filterActive && allRows.length > 0 && mapped.length === 0;
  return {
    width: input.width,
    now: input.now ?? Date.now(),
    empty: input.sessions.length === 0,
    noMatches: input.sessions.length > 0 && (allRows.length === 0 || noBoardMatches),
    noBoardSessions: board && !filterActive && mapped.length === 0,
    showWorkspace: Boolean(workspace && !pinMode && (input.width >= 120 || input.workspaceFullScreen)),
    compactFooter,
    sections,
    cockpitNavigation: cockpitNavigation.map((entry) => ({
      ...entry,
      selected: selected?.cockpitTier === entry.tier,
    })),
    summary: {
      total: input.sessions.length,
      visibleTotal: allRows.length,
      ownerTotal: new Set(input.sessions.map((session) => cockpitOwnerById.get(session.id) ?? session.id)).size,
      visibleOwnerTotal: cockpitNavigation.reduce((sum, entry) => sum + entry.ownerCount, 0),
      statusCounts: countRenderSessions(allMapped),
    },
    boardCardCount: boardParents.length,
    boardTotalCardCount,
    boardHidden: boardProjection.hidden,
    ...(input.height ? { height: input.height } : {}),
    ...(input.listScrollTop ? { listScrollTop: input.listScrollTop } : {}),
    selected,
    ...(workspace ? { workspace } : {}),
    footer: pinMode ? pinnedDashboardFooter(input.width) : dashboardFooter(input.width),
    filter: input.filter,
    grouping,
    pinMode,
    ...(pinMode ? {
      pinSummary: {
        slots: [1, 2, 3, 4].slice(0, Math.max(input.pinCapacity ?? 0, pinSlots.reduce((highest, id, index) => id ? index + 1 : highest, 0))).map((slot) => {
          const id = pinSlots[slot - 1];
          return { slot, ...(id ? { title: input.sessions.find((session) => session.id === id)?.title } : {}), active: id === input.activePinnedSessionId };
        }),
        constrained: input.pinConstrained ?? false,
      },
    } : {}),
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
      hiddenChildRequestCount: 0,
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
  return COCKPIT_TIER_ORDER.flatMap((tier) => {
    const sectionSessions = sessions.filter((session) => session.cockpitTier === tier);
    const allSectionSessions = allSessions.filter((session) => session.cockpitTier === tier);
    if (!allSectionSessions.length) return [];
    const collapsed = tier === "archived" && collapsedSections.has("archived");
    return [{
      key: tier,
      cockpitTier: tier,
      title: COCKPIT_TIER_LABELS[tier],
      statusCounts: countRenderSessions(allSectionSessions),
      sessionsTotal: new Set(allSectionSessions.map((session) => session.cockpitOwnerId)).size,
      hiddenChildRequestCount: allSectionSessions
        .filter((session) => session.id === session.cockpitOwnerId)
        .reduce((sum, session) => sum + (session.hiddenChildRequestCount ?? 0), 0),
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

function descendantAttentionIds(
  sessions: RuntimeSession[],
  ownerById: ReadonlyMap<string, string>,
): Map<string, Set<string>> {
  const ids = new Map<string, Set<string>>();
  for (const session of sessions) {
    if (session.kind !== "subagent" || !visibleAttention(session)) continue;
    const ownerId = ownerById.get(session.id);
    if (!ownerId || ownerId === session.id) continue;
    const descendants = ids.get(ownerId) ?? new Set<string>();
    descendants.add(session.id);
    ids.set(ownerId, descendants);
  }
  return ids;
}

function toRenderSession(session: RuntimeSession, selected: boolean, sessions: RuntimeSession[], tree: SessionTreeIndex<RuntimeSession>, now: number | undefined, pinSlot: number | undefined, pinned: boolean, pinFocused: boolean, board: boolean, subagentStats: DescendantSubagentStats | undefined, boardExpanded: boolean, cockpitTier: CockpitTier, cockpitOwnerId: string, cockpitPlacement: CockpitPlacementReason, hiddenChildRequestCount: number): RenderSession {
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
    cockpitPlacement,
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
    statusEvidence: session.statusEvidence,
    displayStatus,
    symbol: symbolFor(displayStatus),
    needsAttention: session.status === "waiting" && session.acknowledgedAt === undefined,
    selected,
    error: session.error,
    sessionFile: session.sessionFile,
    enabledMcpServers: session.enabledMcpServers ?? [],
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
      ...(session.id === cockpitOwnerId && hiddenChildRequestCount ? { hiddenChildRequestCount } : {}),
    } : {}),
    ...(attention ? { attention } : {}),
    ...(lifecycle.section === "active" && session.kind !== "subagent" && session.workflow?.plan
      ? { plan: planSummary(session.workflow.plan) }
      : {}),
    workflow: session.workflow,
    worktreePath: worktree?.path ?? session.worktreePath,
    worktreeBranch: worktree?.branch ?? session.worktreeBranch,
    worktreeBaseBranch: worktree?.baseBranch ?? session.worktreeBaseBranch,
    worktreeOwnedByHub: session.worktreeOwnedByHub,
    worktreeCount: worktrees.length || undefined,
    ...(pinned ? { pinned: true } : {}),
    ...(pinSlot !== undefined ? { pinSlot } : {}),
    ...(pinFocused ? { pinFocused: true } : {}),
  };
}

function archiveTimingFor(section: SessionSection, changedAt: number | undefined, now: number | undefined): Pick<RenderSession, "archivedAge" | "archiveRetentionIn"> {
  if (section !== "archived" || changedAt === undefined || now === undefined) return {};
  const elapsed = Math.max(0, now - changedAt);
  const remaining = ARCHIVE_PRUNE_AFTER_MS - elapsed;
  return {
    archivedAge: ageLabel(elapsed, "now"),
    archiveRetentionIn: remaining <= 0 ? "now" : remaining < 60_000 ? "<1m" : ageLabel(remaining, "now"),
  };
}

function activityAge(lastActivityAt: number | undefined, now: number | undefined): string | undefined {
  if (lastActivityAt === undefined || now === undefined) return undefined;
  return ageLabel(Math.max(0, now - lastActivityAt), "now");
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
