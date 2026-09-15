import test from "node:test";
import assert from "node:assert/strict";
import { computeStatus } from "../src/core/status.js";
import type { RuntimeSession } from "../src/core/types.js";
import { buildRenderModel } from "../src/tui/render-model.js";
import { hasUsefulStatusResult, statusEvidenceFields } from "../src/tui/status-evidence.js";

const now = 100_000;

function session(id: string, overrides: Partial<RuntimeSession> = {}): RuntimeSession {
  return {
    id,
    title: id,
    cwd: `/tmp/${id}`,
    group: "default",
    tmuxSession: `pi-agent-hub-${id}`,
    status: "idle",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function values(sessions: RuntimeSession[], selectedId: string): string[] {
  const expandedProjectParentIds = new Set(sessions.filter((item) => item.kind !== "subagent").map((item) => item.id));
  const selected = buildRenderModel({ sessions, selectedId, width: 100, now, expandedProjectParentIds }).selected!;
  return statusEvidenceFields(selected, now).map((field) => field.kind === "result"
    ? `${field.status} · ${field.tier} · ${field.reason}`
    : field.value);
}

test("status evidence without an observation avoids repeating visible status", () => {
  assert.ok(values([session("quiet")], "quiet").includes("idle · quiet · runtime evidence unavailable"));
});

test("result relevance keeps exceptional causes and suppresses routine conclusions", () => {
  const routine = buildRenderModel({ sessions: [session("routine", { status: "running" })], selectedId: "routine", width: 100 }).selected!;
  assert.equal(hasUsefulStatusResult(routine), false);

  const broken = buildRenderModel({
    sessions: [session("broken", {
      status: "error",
      statusEvidence: {
        observedAt: now,
        reason: "heartbeat-error",
        tmux: { state: "present" },
        heartbeat: { freshness: "fresh", state: "error", updatedAt: now },
        acknowledgement: { state: "not-applicable" },
        workflow: { source: "absent" },
      },
    })],
    selectedId: "broken",
    width: 100,
  }).selected!;
  assert.equal(hasUsefulStatusResult(broken), true);
});

test("status evidence wording covers missing and stale heartbeat fallbacks", () => {
  const base = session("api", { status: "running" });
  const missingDecision = computeStatus({ session: base, tmux: { exists: true }, now });
  const missing = { ...base, status: missingDecision.status, statusEvidence: missingDecision.evidence };
  const staleHeartbeat = { managedSessionId: base.id, cwd: base.cwd, state: "waiting" as const, stateSince: 1, updatedAt: now - 61_000 };
  const staleDecision = computeStatus({ session: base, tmux: { exists: true }, heartbeat: staleHeartbeat, now });
  const stale = { ...base, status: staleDecision.status, statusEvidence: staleDecision.evidence };

  assert.ok(values([missing], base.id).some((value) => /no heartbeat · using tmux fallback/.test(value)));
  assert.ok(values([missing], base.id).some((value) => value === "waiting · quiet · heartbeat unavailable; previous running state became waiting"));
  assert.ok(values([stale], base.id).some((value) => /heartbeat stale · 1m old · Pi state waiting/.test(value)));
});

test("status evidence does not explain a running owner by repeating its status", () => {
  const base = session("active", { status: "running" });
  const decision = computeStatus({
    session: base,
    tmux: { exists: true },
    heartbeat: { managedSessionId: base.id, cwd: base.cwd, state: "running", stateSince: 1, updatedAt: now },
    now,
  });
  const active = { ...base, status: decision.status, statusEvidence: decision.evidence };
  const result = values([active], active.id).find((value) => value.startsWith("running · active ·"));
  assert.equal(result, "running · active · fresh heartbeat reports running");
  assert.doesNotMatch(result ?? "", /owner is running/);
});

test("status evidence names active descendants and inherited quiet placement", () => {
  const parent = session("parent", { status: "waiting", title: "Parent" });
  const running = session("worker", { kind: "subagent", parentId: parent.id, agentName: "worker", status: "running" });
  const activeValues = values([parent, running], parent.id);
  assert.ok(activeValues.some((value) => value === "waiting · active · worker is running"));

  const quietParent = session("quiet-parent", { title: "Quiet parent" });
  const childBase = session("child", { kind: "subagent", parentId: quietParent.id, agentName: "child", status: "error", error: "failed" });
  const child = {
    ...childBase,
    statusEvidence: computeStatus({
      session: childBase,
      tmux: { exists: true },
      heartbeat: { managedSessionId: childBase.id, cwd: childBase.cwd, state: "error" as const, stateSince: now, updatedAt: now, message: "failed" },
      now,
    }).evidence,
  };
  const quietValues = values([quietParent, child], child.id);
  assert.ok(quietValues.some((value) => value === "error · quiet · Pi heartbeat reported an error; owner tree is quiet with owner \"Quiet parent\""));
});

test("status evidence explains Health, Archived, and retained workflow independently", () => {
  const errorBase = session("broken", { status: "error", error: "failed" });
  const broken = { ...errorBase, statusEvidence: computeStatus({ session: errorBase, tmux: { exists: false }, now }).evidence };
  assert.ok(values([broken], broken.id).some((value) => value === "error · health · tmux session is missing; owner reported an error"));

  const archived = session("archived", { status: "stopped", bucket: "archived", bucketChangedAt: 1 });
  assert.ok(values([archived], archived.id).some((value) => value === "stopped · archived · lifecycle archived"));

  const workflow = { steps: [{ id: "review", short: "RV", label: "Review" }], activeIndex: 0, updatedAt: 1 };
  const retainedBase = session("retained", { status: "waiting", workflow });
  const retained = { ...retainedBase, statusEvidence: computeStatus({ session: retainedBase, tmux: { exists: true }, now }).evidence };
  assert.ok(values([retained], retained.id).some((value) => value === "producer step 1/1 · Review · retained from last fresh heartbeat"));
});
