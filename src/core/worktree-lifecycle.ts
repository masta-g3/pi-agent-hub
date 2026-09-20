import { sessionWorktrees } from "./worktree.js";
import type { ManagedSession, WorktreeLifecycleRepository, WorktreeLifecycleSnapshot, WorktreeLifecycleState } from "./types.js";

export type WorktreeLifecycleMarker = "⎇" | "⎇…" | "⎇!" | "⎇✓";

export function effectiveWorktreeLifecycle(session: ManagedSession): WorktreeLifecycleSnapshot | undefined {
  const owned = session.worktreeOwnedByHub === true ? sessionWorktrees(session) : [];
  if (owned.length) {
    const evidence = new Map(session.worktreeLifecycle?.repositories?.map((item) => [item.worktreePath, item]));
    const repositories: WorktreeLifecycleRepository[] = owned.map((item) => evidence.get(item.path) ?? {
      sourcePath: item.repoRoot,
      worktreePath: item.path,
      branch: item.branch,
      role: item.role,
      state: "active",
    });
    // Retain already completed repositories during a partial multi-repo closeout.
    for (const item of session.worktreeLifecycle?.repositories ?? []) {
      if (!repositories.some((candidate) => candidate.worktreePath === item.worktreePath)) repositories.push(item);
    }
    return {
      version: 1,
      recordId: session.worktreeLifecycle?.recordId ?? `hub:${session.id}`,
      producer: "pi-agent-hub",
      revision: session.worktreeLifecycle?.revision ?? 0,
      updatedAt: session.worktreeLifecycle?.updatedAt ?? session.createdAt,
      repositories,
    };
  }
  return session.worktreeLifecycle?.cleared ? undefined : session.worktreeLifecycle;
}

export function aggregateWorktreeState(snapshot: WorktreeLifecycleSnapshot | undefined): WorktreeLifecycleState | undefined {
  const states = snapshot?.repositories?.map((item) => item.state);
  if (!states?.length) return undefined;
  if (states.includes("check-needed")) return "check-needed";
  if (states.includes("cleanup-pending")) return "cleanup-pending";
  if (states.includes("awaiting-merge")) return "awaiting-merge";
  if (states.includes("active")) return "active";
  if (states.every((state) => state === "cleaned")) {
    return snapshot!.repositories!.every((item) => typeof item.verifiedAt === "number" && Number.isFinite(item.verifiedAt)) ? "cleaned" : "check-needed";
  }
  return undefined;
}

export function worktreeMarker(session: ManagedSession): WorktreeLifecycleMarker | undefined {
  switch (aggregateWorktreeState(effectiveWorktreeLifecycle(session))) {
    case "active": return "⎇";
    case "awaiting-merge": return "⎇…";
    case "cleanup-pending":
    case "check-needed": return "⎇!";
    case "cleaned": return "⎇✓";
    default: return session.worktreeBranch || session.worktreePath ? "⎇" : undefined;
  }
}
