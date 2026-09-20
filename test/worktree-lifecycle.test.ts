import test from "node:test";
import assert from "node:assert/strict";
import { aggregateWorktreeState, effectiveWorktreeLifecycle, worktreeMarker } from "../src/core/worktree-lifecycle.js";
import type { ManagedSession, WorktreeLifecycleSnapshot } from "../src/core/types.js";

function snapshot(states: Array<"active" | "awaiting-merge" | "cleanup-pending" | "check-needed" | "cleaned">): WorktreeLifecycleSnapshot {
  return {
    version: 1, recordId: "r", producer: "other", revision: 1, updatedAt: 1,
    repositories: states.map((state, index) => ({ sourcePath: `/s/${index}`, worktreePath: `/w/${index}`, branch: "b", role: index ? "additional" : "primary", state, ...(state === "cleaned" ? { verifiedAt: 10 } : {}) })),
  };
}

const base: ManagedSession = { id: "s", title: "S", cwd: "/w", group: "default", tmuxSession: "tmux", status: "idle", createdAt: 1, updatedAt: 1 };

test("worktree aggregation uses check, cleanup, merge, active, cleaned priority", () => {
  assert.equal(aggregateWorktreeState(snapshot(["cleaned", "check-needed"])), "check-needed");
  assert.equal(aggregateWorktreeState(snapshot(["cleaned", "cleanup-pending"])), "cleanup-pending");
  assert.equal(aggregateWorktreeState(snapshot(["active", "awaiting-merge"])), "awaiting-merge");
  assert.equal(aggregateWorktreeState(snapshot(["cleaned", "cleaned"])), "cleaned");
  assert.equal(worktreeMarker({ ...base, worktreeLifecycle: snapshot(["cleaned"]) }), "⎇✓");
});

test("cleaned producer state requires verification before showing the checkmark", () => {
  const unverified = snapshot(["cleaned"]);
  delete unverified.repositories?.[0]?.verifiedAt;
  assert.equal(aggregateWorktreeState(unverified), "check-needed");
  assert.equal(worktreeMarker({ ...base, worktreeLifecycle: unverified }), "⎇!");
  const verified = snapshot(["cleaned"]);
  assert.equal(aggregateWorktreeState(verified), "cleaned");
  assert.equal(worktreeMarker({ ...base, worktreeLifecycle: verified }), "⎇✓");
});

test("persisted reset tombstones stay hidden from effective lifecycle rendering", () => {
  const cleared = { version: 1 as const, recordId: "r", producer: "other", revision: 3, updatedAt: 3, cleared: true as const };
  assert.equal(effectiveWorktreeLifecycle({ ...base, worktreeLifecycle: cleared }), undefined);
  assert.equal(worktreeMarker({ ...base, worktreeLifecycle: cleared }), undefined);
});

test("Hub-owned active mappings are derived without a persisted duplicate", () => {
  const session: ManagedSession = {
    ...base,
    worktreeOwnedByHub: true,
    worktrees: [{ path: "/w", repoRoot: "/s", branch: "b", baseBranch: "main", role: "primary" }],
  };
  assert.equal(session.worktreeLifecycle, undefined);
  assert.equal(effectiveWorktreeLifecycle(session)?.repositories?.[0]?.state, "active");
  assert.equal(worktreeMarker(session), "⎇");
});
