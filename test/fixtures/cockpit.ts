import type { RuntimeSession, SessionStatus, WorkflowRuntimeSnapshot } from "../../src/core/types.js";

export const COCKPIT_NOW = 1_000_000;

export const COCKPIT_WORKFLOW: WorkflowRuntimeSnapshot = {
  steps: [
    { id: "plan-md", short: "PL", label: "Plan" },
    { id: "execute", short: "EX", label: "Execute" },
    { id: "review", short: "RV", label: "Review" },
  ],
  activeIndex: 1,
  ticketId: "cockpit-001",
  updatedAt: COCKPIT_NOW - 1_000,
};

function session(id: string, title: string, group: string, status: SessionStatus): RuntimeSession {
  return {
    id,
    title,
    cwd: `/tmp/${id}`,
    group,
    tmuxSession: `pi-agent-hub-${id}`,
    status,
    createdAt: 1,
    updatedAt: 1,
    lastActivityAt: COCKPIT_NOW - 8 * 60_000,
  };
}

function attention(kind: "ready" | "question" | "blocked", text: string) {
  return { version: 1 as const, updatedAt: COCKPIT_NOW - 500, attention: { kind, text } };
}

export function cockpitFleet(): RuntimeSession[] {
  return [
    { ...session("docs", "Docs refresh", "Docs", "waiting"), context: attention("question", "Which changelog section wins?"), workflow: { ...COCKPIT_WORKFLOW, activeIndex: 2 } },
    { ...session("ready", "Release notes ready", "Release", "idle"), context: attention("ready", "Review the release notes") },
    { ...session("blocked", "Migration decision", "Data", "waiting"), context: attention("blocked", "Choose the migration boundary") },
    { ...session("qa", "Flaky test investigation", "QA", "error"), error: "three retries failed" },
    { ...session("dashboard", "Dashboard UI polish", "Pi Agent Hub", "waiting"), workflow: COCKPIT_WORKFLOW },
    { ...session("worker", "code-critic", "Pi Agent Hub", "running"), kind: "subagent", parentId: "dashboard", agentName: "code-critic", taskPreview: "Review cockpit hierarchy geometry" },
    { ...session("scout", "scout", "Pi Agent Hub", "idle"), kind: "subagent", parentId: "dashboard", agentName: "scout", taskPreview: "needle context" },
    { ...session("release", "Package release checks", "Release", "running"), workflow: { ...COCKPIT_WORKFLOW, activeIndex: 2 } },
    session("waiting", "Waiting without request", "Default", "waiting"),
    session("mcp", "MCP integration cleanup", "Integrations", "idle"),
    session("quiet-parent", "Quiet parent", "Agents", "idle"),
    { ...session("child-attention", "worker-question", "Agents", "idle"), kind: "subagent", parentId: "quiet-parent", agentName: "worker-question", context: attention("question", "Child-only request") },
    { ...session("child-error", "worker-error", "Agents", "error"), kind: "subagent", parentId: "quiet-parent", agentName: "worker-error", error: "child failed" },
    { ...session("theme", "Theme compatibility spike", "Experiments", "idle"), bucket: "backlog", bucketChangedAt: COCKPIT_NOW - 60_000 },
    { ...session("orphan", "orphan-scout", "Agents", "idle"), kind: "subagent", parentId: "missing", agentName: "orphan-scout" },
    { ...session("archive-new", "Recent archive", "Archive", "stopped"), bucket: "archived", bucketChangedAt: COCKPIT_NOW - 60_000 },
    { ...session("archive-old", "Older archive", "Archive", "stopped"), bucket: "archived", bucketChangedAt: COCKPIT_NOW - 2 * 60_000 },
  ];
}

const FRAME_IDS = new Set(["docs", "qa", "dashboard", "worker", "release", "mcp", "quiet-parent", "child-attention", "theme", "archive-new"]);

export function cockpitFrameFleet(): RuntimeSession[] {
  return cockpitFleet().filter((session) => FRAME_IDS.has(session.id));
}
