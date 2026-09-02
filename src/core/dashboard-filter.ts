import { sessionSection, type SessionSection } from "./session-bucket.js";
import type { SessionTreeIndex } from "./session-tree.js";
import type { RuntimeSession } from "./types.js";

export const DASHBOARD_LIFECYCLES: readonly SessionSection[] = ["active", "backlog", "archived"];

export interface DashboardFilter {
  text?: string;
  lifecycle: Set<SessionSection>;
}

export interface DashboardFilterState {
  text?: string;
  lifecycle: SessionSection[];
}

export function allDashboardLifecycles(): Set<SessionSection> {
  return new Set(DASHBOARD_LIFECYCLES);
}

export function parseDashboardFilter(value: string | undefined): DashboardFilter {
  const textParts: string[] = [];
  let lifecycle: Set<SessionSection> | undefined;
  for (const part of value?.trim().split(/\s+/) ?? []) {
    if (!part.toLowerCase().startsWith("lifecycle:")) {
      if (part) textParts.push(part);
      continue;
    }
    const rawValues = part.slice("lifecycle:".length).toLowerCase().split(",");
    const valid = rawValues.filter((item): item is SessionSection => DASHBOARD_LIFECYCLES.includes(item as SessionSection));
    if (rawValues.length === 1 && rawValues[0] === "") {
      lifecycle = new Set();
    } else if (valid.length > 0) {
      lifecycle = new Set(valid);
    }
  }
  const text = textParts.join(" ");
  return {
    lifecycle: lifecycle ?? allDashboardLifecycles(),
    ...(text ? { text } : {}),
  };
}

export function dashboardFilterFromState(value: unknown): DashboardFilter | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const state = value as { text?: unknown; lifecycle?: unknown };
  if (!Array.isArray(state.lifecycle)) return undefined;
  const lifecycle = [...new Set(state.lifecycle.filter((item): item is SessionSection => DASHBOARD_LIFECYCLES.includes(item as SessionSection)))];
  const text = typeof state.text === "string" ? state.text.trim() : "";
  return { lifecycle: new Set(lifecycle), ...(text ? { text } : {}) };
}

export function dashboardFilterState(filter: DashboardFilter): DashboardFilterState {
  const lifecycle = DASHBOARD_LIFECYCLES.filter((section) => filter.lifecycle.has(section));
  return { lifecycle, ...(filter.text?.trim() ? { text: filter.text.trim() } : {}) };
}

export function serializeDashboardFilter(filter: DashboardFilter): string | undefined {
  const lifecycle = DASHBOARD_LIFECYCLES.filter((section) => filter.lifecycle.has(section));
  const allSelected = lifecycle.length === DASHBOARD_LIFECYCLES.length;
  const parts = [
    ...(!allSelected ? [`lifecycle:${lifecycle.join(",")}`] : []),
    ...(filter.text?.trim() ? [filter.text.trim()] : []),
  ];
  return parts.length ? parts.join(" ") : undefined;
}

export function matchesDashboardFilter(
  session: RuntimeSession,
  filter: DashboardFilter,
  tree?: SessionTreeIndex<RuntimeSession>,
): boolean {
  if (!filter.lifecycle.has(effectiveLifecycle(session, tree))) return false;
  if (!filter.text) return true;
  return searchableValues(session, tree).some((value) => value.toLowerCase().includes(filter.text!.toLowerCase()));
}

export function matchesFilter(session: RuntimeSession, filter: string): boolean {
  return matchesDashboardFilter(session, parseDashboardFilter(filter));
}

export function effectiveLifecycle(session: RuntimeSession, tree?: SessionTreeIndex<RuntimeSession>): SessionSection {
  if (!tree) return sessionSection(session);
  const trace = tree.trace(session);
  const owner = trace.owner ?? trace.terminal;
  return sessionSection(owner);
}

export function searchableValues(session: RuntimeSession, tree?: SessionTreeIndex<RuntimeSession>): string[] {
  const lifecycle = tree ? effectiveLifecycle(session, tree) : sessionSection(session);
  return [
    session.title,
    session.group,
    basename(session.cwd),
    ...(session.additionalCwds ?? []).map(basename),
    session.status,
    lifecycle,
    session.agentName ?? "",
    session.taskPreview ?? "",
    session.context?.ticket?.id ?? "",
    session.context?.ticket?.subtitle ?? "",
    session.context?.ticket?.description ?? "",
    session.context?.attention?.kind ?? "",
    session.context?.attention?.text ?? "",
    session.workflow?.ticketId ?? "",
    session.workflow?.activity?.label ?? "",
    session.workflow?.plan?.phase?.title ?? "",
    session.workflow?.plan?.nextStep ?? "",
  ];
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
