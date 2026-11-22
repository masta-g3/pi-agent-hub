import { basename } from "node:path";
import { interactionTarget } from "../app/session-interaction.js";
import type { SessionSection } from "../core/session-bucket.js";
import { plainTerminalText } from "../core/terminal-text.js";
import type { RuntimeSession, SessionAttentionKind, SessionClosure, SessionStatus, WorkflowLensState } from "../core/types.js";
import { primaryWorktree } from "../core/worktree.js";
import { ageLabel } from "../tui/age.js";
import { effectiveSessionLifecycle } from "../tui/archive-section.js";
import { modelTag } from "../tui/model-badge.js";
import { buildDashboardProjection, visibleAttention, type DashboardProjection } from "../tui/render-model.js";

export type InboxTierName = "needs-you" | "health" | "new" | "active" | "quiet";

export interface InboxAttention {
  requestId?: string;
  kind: SessionAttentionKind;
  text: string;
  recommendation?: string;
  artifact?: string;
}

export interface InboxSession {
  id: string;
  /** Exact write target; the client echoes these so a restarted session rejects a stale card. */
  piSessionId?: string;
  instanceId?: string;
  title: string;
  group: string;
  status: SessionStatus;
  age?: string;
  ticketId?: string;
  subtitle?: string;
  /** Producer label of the active step, and every step's short code with its positional state. */
  step?: string;
  /** The active step's short code, for the list row. */
  stepShort?: string;
  /** The producer lens's progress, only with a positive total. */
  progress?: { completed: number; total: number };
  /** Archived parents only: the explicit outcome. */
  closure?: SessionClosure;
  steps?: { short: string; state: "done" | "active" | "pending" }[];
  attention?: InboxAttention;
  statusLine?: string;
  /** Only while the agent works: the live tool call (none means it is thinking), the run's call count, and when the run began. */
  work?: { tool?: string; calls?: number; since?: number };
  runningSubagents: number;
  hiddenChildRequests: number;
  canInteract: boolean;
}

export interface InboxTier { tier: InboxTierName; sessions: InboxSession[] }
export interface InboxSnapshot { now: number; requestCount: number; tiers: InboxTier[]; backlog: InboxSession[]; archived: InboxSession[] }

/** The selected session's card: the dashboard card's fields, bounded plain text, absent when empty. */
export interface InboxCard {
  section: SessionSection;
  goal?: string;
  doing?: string;
  done?: string;
  next?: string;
  stages?: { label: string; state: "done" | "active" | "pending" }[];
  progress?: { completed: number; total: number; unit?: string };
  pass?: number;
  summary?: string;
  mode?: string;
  list?: { label: string; head?: string; items: { state: WorkflowLensState; text: string }[]; before: number; after: number };
  now?: string;
  log: { text: string; at: number }[];
  subagents: { name: string; task?: string }[];
  model?: string;
  repo?: string;
  branch?: string;
}

const TITLE_CHARS = 120;
const TEXT_CHARS = 2_000;
const CARD_CHARS = 240;
const ITEM_CHARS = 160;
const CARD_LIST_ITEMS = 12;
/** Items shown before the open one, as in the dashboard card. */
const CARD_LIST_BEFORE = 2;
const CARD_LOG = 3;
const CARD_SUBAGENTS = 3;
/** The phone shows only the newest archived parents; older ones stay in the terminal dashboard. */
export const INBOX_ARCHIVED_LIMIT = 20;

export function boundedText(value: string | undefined, limit: number): string | undefined {
  if (!value) return undefined;
  const text = plainTerminalText(value);
  if (!text) return undefined;
  const chars = [...text];
  return chars.length > limit ? `${chars.slice(0, limit - 1).join("")}…` : text;
}

/** The phone's view of the fleet: owner trees in the Status cockpit's tiers and order, plus the newest archived parents apart. */
export function buildInboxSnapshot(sessions: RuntimeSession[], now: number): InboxSnapshot {
  const projection = buildDashboardProjection({ sessions, archiveExpanded: true });
  const tiers: InboxTier[] = [];
  const archived: InboxSession[] = [];
  const backlog: { row: RuntimeSession; session: InboxSession }[] = [];
  let requestCount = 0;
  for (const row of projection.visible) {
    const tier = projection.cockpitTierById.get(row.id);
    // A subagent whose parent is gone owns its own tree in the cockpit, but the phone has no subagent screen.
    if (!tier || row.kind === "subagent" || projection.cockpitOwnerById.get(row.id) !== row.id) continue;
    const descendants = projection.allTree.descendants(row.id);
    if (tier === "archived") {
      if (archived.length < INBOX_ARCHIVED_LIMIT) archived.push(inboxSession(row, descendants, now));
      continue;
    }
    // Parked work leaves the working tiers on the phone: never counted or announced.
    if (sectionOf(row, projection) === "backlog") {
      backlog.push({ row, session: inboxSession(row, descendants, now) });
      continue;
    }
    const session = inboxSession(row, descendants, now);
    if (session.attention) requestCount += 1;
    const last = tiers.at(-1);
    if (last?.tier === tier) last.sessions.push(session);
    else tiers.push({ tier, sessions: [session] });
  }
  backlog.sort((a, b) => (b.row.bucketChangedAt ?? 0) - (a.row.bucketChangedAt ?? 0));
  return { now, requestCount, tiers, backlog: backlog.slice(0, INBOX_ARCHIVED_LIMIT).map((entry) => entry.session), archived };
}

const sectionOf = (row: RuntimeSession, projection: DashboardProjection) => effectiveSessionLifecycle(row, projection.allRows, projection.allTree).section;

/** One parent's row and card, without the list's caps, so any parent the page shows can be opened. */
export function inboxDetail(sessions: RuntimeSession[], id: string, now: number): { session: InboxSession; card: InboxCard } | undefined {
  const projection = buildDashboardProjection({ sessions, archiveExpanded: true });
  const row = projection.allTree.get(id);
  if (!row || row.kind === "subagent" || projection.cockpitOwnerById.get(row.id) !== row.id) return undefined;
  const descendants = projection.allTree.descendants(row.id);
  return { session: inboxSession(row, descendants, now), card: inboxCard(row, descendants, sectionOf(row, projection)) };
}

function inboxCard(row: RuntimeSession, descendants: readonly RuntimeSession[], section: SessionSection): InboxCard {
  const text = (value: string | undefined, limit = CARD_CHARS) => boundedText(value, limit);
  const optional = <K extends string>(key: K, value: string | undefined) => {
    const bounded = text(value);
    return bounded ? { [key]: bounded } as Record<K, string> : {};
  };
  const lens = row.workflow?.lens ?? row.lens;
  const progress = row.context?.progress;
  const live = row.status === "running" || row.status === "starting";
  const action = (tool: string, detail: string | undefined) => text(`${tool}${detail ? ` ${detail}` : ""}`)!;
  const branch = row.worktreeBranch ?? row.worktreeLifecycle?.repositories?.find((item) => item.role === "primary" && item.state !== "cleaned")?.branch;
  const ticketCopy = row.context?.ticket?.subtitle ?? row.context?.ticket?.description;
  return {
    section,
    ...(ticketCopy ? {} : optional("goal", progress?.goal)),
    ...optional("doing", lens?.doing),
    ...optional("done", progress?.done),
    ...optional("next", progress?.next),
    ...(lens?.stages?.length ? { stages: lens.stages.map((stage) => ({ label: text(stage.label, 40) ?? "", state: stage.state })) } : {}),
    ...(lens?.progress && lens.progress.total > 0 ? { progress: {
      completed: lens.progress.completed, total: lens.progress.total, ...(text(lens.progress.unit, 40) ? { unit: text(lens.progress.unit, 40) } : {}),
    } } : {}),
    ...(lens?.pass ? { pass: lens.pass } : {}),
    ...optional("summary", lens?.summary),
    ...optional("mode", row.workflow?.activeMode?.label ?? row.workflow?.activeMode?.short),
    ...(lens?.list ? { list: cardList(lens.list) } : {}),
    ...(live && row.activity?.current ? { now: action(row.activity.current.tool, row.activity.current.detail) } : {}),
    log: (row.activity?.recent ?? []).slice(0, CARD_LOG).map((item) => ({ text: action(item.tool, item.detail), at: item.at })),
    subagents: descendants.filter((child) => child.status === "starting" || child.status === "running").slice(0, CARD_SUBAGENTS)
      .map((child) => ({ name: text(child.agentName ?? child.title, 60) ?? child.id, ...(text(child.taskPreview, ITEM_CHARS) ? { task: text(child.taskPreview, ITEM_CHARS) } : {}) })),
    ...(row.model ? { model: text([modelTag(row.model), row.model.thinking].filter(Boolean).join(" "), 60) } : {}),
    repo: basename(primaryWorktree(row)?.repoRoot ?? row.cwd),
    ...optional("branch", branch),
  };
}

/** A window of the lens list around its open item, as the dashboard card shows it; the rest become counts. */
function cardList(list: NonNullable<InboxCard["list"]>): NonNullable<InboxCard["list"]> {
  const items = list.items;
  const active = items.findIndex((item) => item.state === "active");
  const open = active >= 0 ? active : items.findIndex((item) => item.state !== "done" && item.state !== "skipped");
  const start = Math.max(0, Math.min((open < 0 ? items.length : open) - CARD_LIST_BEFORE, items.length - CARD_LIST_ITEMS));
  const shown = items.slice(start, start + CARD_LIST_ITEMS);
  return {
    label: boundedText(list.label, 40) ?? "List",
    ...(boundedText(list.head, CARD_CHARS) ? { head: boundedText(list.head, CARD_CHARS) } : {}),
    items: shown.map((item) => ({ state: item.state, text: boundedText(item.text, ITEM_CHARS) ?? "" })),
    before: list.before + start,
    after: list.after + items.length - start - shown.length,
  };
}

function inboxSession(row: RuntimeSession, descendants: readonly RuntimeSession[], now: number): InboxSession {
  const target = interactionTarget(row);
  const attention = visibleAttention(row);
  const text = attention && boundedText(attention.text, TEXT_CHARS);
  const step = row.workflow?.steps[row.workflow.activeIndex];
  const action = row.activity?.current;
  const lensProgress = (row.workflow?.lens ?? row.lens)?.progress;
  const statusLine = row.status === "error" ? row.error
    : action ? `${action.tool}${action.detail ? ` ${action.detail}` : ""}`
    : row.context?.progress?.next ?? row.context?.progress?.done;
  const optional = <K extends string>(key: K, value: string | undefined, limit = TEXT_CHARS) => {
    const bounded = boundedText(value, limit);
    return bounded ? { [key]: bounded } as Record<K, string> : {};
  };
  return {
    id: row.id,
    ...(row.piSessionId ? { piSessionId: row.piSessionId } : {}),
    ...(target ? { instanceId: target.instanceId } : {}),
    title: boundedText(row.title, TITLE_CHARS) ?? row.id,
    group: boundedText(row.group, TITLE_CHARS) ?? "",
    status: row.status,
    ...(row.lastActivityAt === undefined ? {} : { age: ageLabel(Math.max(0, now - row.lastActivityAt), "now") }),
    ...optional("ticketId", row.workflow?.ticketId ?? row.context?.ticket?.id, TITLE_CHARS),
    ...optional("subtitle", row.context?.ticket?.subtitle ?? row.context?.ticket?.description, 240),
    ...optional("step", step?.label ?? step?.id, TITLE_CHARS),
    ...optional("stepShort", step?.short, 16),
    ...(lensProgress && lensProgress.total > 0 ? { progress: { completed: lensProgress.completed, total: lensProgress.total } } : {}),
    ...(row.closure ? { closure: row.closure } : {}),
    ...(row.workflow?.steps.length ? { steps: row.workflow.steps.map((item, index) => ({
      short: boundedText(item.short, 16) ?? "",
      // Positional cue, as in the dashboard: earlier steps are done, the current one only when the producer says so.
      state: index < row.workflow!.activeIndex || (index === row.workflow!.activeIndex && row.workflow!.currentStepComplete === true) ? "done" as const
        : index === row.workflow!.activeIndex ? "active" as const : "pending" as const,
    })) } : {}),
    ...(attention && text ? { attention: {
      ...(attention.requestId ? { requestId: attention.requestId } : {}),
      kind: attention.kind,
      text,
      ...optional("recommendation", attention.recommendation),
      ...optional("artifact", attention.artifact),
    } } : {}),
    ...optional("statusLine", statusLine, 240),
    ...(row.status === "running" || row.status === "starting" ? { work: {
      ...optional("tool", action && `${action.tool}${action.detail ? ` ${action.detail}` : ""}`, 240),
      ...(row.activity?.calls ? { calls: row.activity.calls } : {}),
      ...(row.statusEvidence?.heartbeat.state === "running" && row.statusEvidence.heartbeat.stateSince !== undefined ? { since: row.statusEvidence.heartbeat.stateSince } : {}),
    } } : {}),
    runningSubagents: descendants.filter((child) => child.status === "starting" || child.status === "running").length,
    hiddenChildRequests: descendants.filter((child) => visibleAttention(child) !== undefined).length,
    canInteract: target !== undefined,
  };
}
