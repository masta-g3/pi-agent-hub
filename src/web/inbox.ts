import { interactionTarget } from "../app/session-interaction.js";
import { plainTerminalText } from "../core/terminal-text.js";
import type { RuntimeSession, SessionAttentionKind, SessionStatus } from "../core/types.js";
import { ageLabel } from "../tui/age.js";
import { buildDashboardProjection, visibleAttention } from "../tui/render-model.js";

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
  steps?: { short: string; state: "done" | "active" | "pending" }[];
  attention?: InboxAttention;
  statusLine?: string;
  runningSubagents: number;
  hiddenChildRequests: number;
  canInteract: boolean;
}

export interface InboxTier { tier: InboxTierName; sessions: InboxSession[] }
export interface InboxSnapshot { now: number; requestCount: number; tiers: InboxTier[] }

const TITLE_CHARS = 120;
const TEXT_CHARS = 2_000;

export function boundedText(value: string | undefined, limit: number): string | undefined {
  if (!value) return undefined;
  const text = plainTerminalText(value);
  if (!text) return undefined;
  const chars = [...text];
  return chars.length > limit ? `${chars.slice(0, limit - 1).join("")}…` : text;
}

/** The phone's view of the fleet: non-archived owner trees in the Status cockpit's tiers and order. */
export function buildInboxSnapshot(sessions: RuntimeSession[], now: number): InboxSnapshot {
  const projection = buildDashboardProjection({ sessions });
  const tiers: InboxTier[] = [];
  let requestCount = 0;
  for (const row of projection.visible) {
    const tier = projection.cockpitTierById.get(row.id);
    // A subagent whose parent is gone owns its own tree in the cockpit, but the phone has no subagent screen.
    if (!tier || tier === "archived" || row.kind === "subagent" || projection.cockpitOwnerById.get(row.id) !== row.id) continue;
    const descendants = projection.allTree.descendants(row.id);
    const session = inboxSession(row, descendants, now);
    if (session.attention) requestCount += 1;
    const last = tiers.at(-1);
    if (last?.tier === tier) last.sessions.push(session);
    else tiers.push({ tier, sessions: [session] });
  }
  return { now, requestCount, tiers };
}

function inboxSession(row: RuntimeSession, descendants: readonly RuntimeSession[], now: number): InboxSession {
  const target = interactionTarget(row);
  const attention = visibleAttention(row);
  const text = attention && boundedText(attention.text, TEXT_CHARS);
  const step = row.workflow?.steps[row.workflow.activeIndex];
  const action = row.activity?.current;
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
    runningSubagents: descendants.filter((child) => child.status === "starting" || child.status === "running").length,
    hiddenChildRequests: descendants.filter((child) => visibleAttention(child) !== undefined).length,
    canInteract: target !== undefined,
  };
}
