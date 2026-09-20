import test from "node:test";
import assert from "node:assert/strict";
import { parseSessionContext } from "../src/core/session-context.js";

test("generic context accepts bounded optional fields and ignores unknown fields", () => {
  assert.deepEqual(parseSessionContext({
    version: 1,
    updatedAt: 12,
    ticket: { id: "metadata-redesign-001", subtitle: " Simplify   session context ", description: "One outcome.", future: true },
    attention: { requestId: " request-42 ", kind: "question", text: " Choose rollout order ", confidence: 0.9 },
    future: {},
  }), {
    version: 1,
    updatedAt: 12,
    ticket: { id: "metadata-redesign-001", subtitle: "Simplify session context", description: "One outcome." },
    attention: { requestId: "request-42", kind: "question", text: "Choose rollout order" },
  });
  assert.deepEqual(parseSessionContext({ version: 1, updatedAt: 1 }), { version: 1, updatedAt: 1 });
});

test("generic context accepts producer-neutral worktree-only snapshots", () => {
  const parsed = parseSessionContext({
    version: 1,
    updatedAt: 4,
    worktree: {
      version: 1,
      recordId: "task-1",
      producer: "alternative-producer",
      revision: 2,
      updatedAt: 3,
      repositories: [{ sourcePath: "/src/repo", worktreePath: "/work/repo", branch: "feature/x", role: "primary", state: "awaiting-merge" }],
    },
  });
  assert.equal(parsed?.worktree?.producer, "alternative-producer");
  assert.equal(parsed?.worktree?.repositories?.[0]?.state, "awaiting-merge");
});

test("generic context requires absolute source and worktree paths", () => {
  const lifecycle = {
    version: 1,
    recordId: "task-1",
    producer: "rules",
    revision: 1,
    updatedAt: 4,
    repositories: [{ sourcePath: "/src/repo", worktreePath: "/work/repo", branch: "feature/x", role: "primary", state: "active" }],
  };
  assert.equal(parseSessionContext({ version: 1, updatedAt: 4, worktree: { ...lifecycle, repositories: [{ ...lifecycle.repositories[0], sourcePath: "src/repo" }] } })?.worktree, undefined);
  assert.equal(parseSessionContext({ version: 1, updatedAt: 4, worktree: { ...lifecycle, repositories: [{ ...lifecycle.repositories[0], worktreePath: "work/repo" }] } })?.worktree, undefined);
  assert.equal(parseSessionContext({ version: 1, updatedAt: 4, worktree: lifecycle })?.worktree?.repositories?.[0]?.worktreePath, "/work/repo");
});

test("generic context isolates malformed worktree decoration and accepts reset tombstones", () => {
  const isolated = parseSessionContext({ version: 1, updatedAt: 4, ticket: { id: "T-1" }, worktree: { version: 1, recordId: "bad" } });
  assert.equal(isolated?.ticket?.id, "T-1");
  assert.equal(isolated?.worktree, undefined);
  const reset = parseSessionContext({ version: 1, updatedAt: 5, worktree: { version: 1, recordId: "task-1", producer: "rules", revision: 3, updatedAt: 5, cleared: true } });
  assert.equal(reset?.worktree?.cleared, true);
});

test("generic context rejects malformed versions, fields, and text bounds", () => {
  for (const value of [
    undefined,
    { version: 2, updatedAt: 1 },
    { version: 1, updatedAt: Number.NaN },
    { version: 1, updatedAt: 1, ticket: {} },
    { version: 1, updatedAt: 1, ticket: { id: "x".repeat(81) } },
    { version: 1, updatedAt: 1, ticket: { id: "x", subtitle: "x".repeat(65) } },
    { version: 1, updatedAt: 1, attention: { kind: "waiting", text: "Choose" } },
    { version: 1, updatedAt: 1, attention: { requestId: " ", kind: "ready", text: "Choose" } },
    { version: 1, updatedAt: 1, attention: { requestId: "x".repeat(65), kind: "ready", text: "Choose" } },
    { version: 1, updatedAt: 1, attention: { kind: "ready", text: "x".repeat(151) } },
  ]) assert.equal(parseSessionContext(value), undefined);
});
