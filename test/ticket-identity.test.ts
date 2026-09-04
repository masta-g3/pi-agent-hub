import test from "node:test";
import assert from "node:assert/strict";
import { matchesFilter } from "../src/core/session-tree.js";
import { ticketIdentity, ticketSearchText } from "../src/core/ticket-identity.js";
import type { RuntimeSession } from "../src/core/types.js";

const session = (values: Partial<RuntimeSession>): RuntimeSession => ({
  id: "session", title: "API cleanup", cwd: "/repo/api", group: "default", tmuxSession: "tmux-session",
  status: "running", createdAt: 1, updatedAt: 1, ...values,
});

test("workflow ticket identity wins and suppresses conflicting context details", () => {
  const value = ticketIdentity(session({
    workflow: { steps: [{ id: "execute", short: "EX" }], activeIndex: 0, ticketId: "ENG-42", updatedAt: 2 },
    context: { version: 1, updatedAt: 2, ticket: { id: "OLD-7", subtitle: "Old title", description: "Old details" } },
  }));
  assert.deepEqual(value, { id: "ENG-42" });
  assert.deepEqual(ticketSearchText(session({
    workflow: { steps: [{ id: "execute", short: "EX" }], activeIndex: 0, ticketId: "ENG-42", updatedAt: 2 },
    context: { version: 1, updatedAt: 2, ticket: { id: "OLD-7" } },
  })), ["ENG-42", "", ""]);
});

test("search uses only the canonical ticket identity", () => {
  const value = session({
    workflow: { steps: [{ id: "execute", short: "EX" }], activeIndex: 0, ticketId: "ENG-42", updatedAt: 2 },
    context: { version: 1, updatedAt: 2, ticket: { id: "OLD-7", subtitle: "Old title" } },
  });
  assert.equal(matchesFilter(value, "eng-42"), true);
  assert.equal(matchesFilter(value, "old-7"), false);
  assert.equal(matchesFilter(value, "old title"), false);
});

test("matching context supplies ticket details", () => {
  const value = ticketIdentity(session({
    workflow: { steps: [{ id: "execute", short: "EX" }], activeIndex: 0, ticketId: "ENG-42", updatedAt: 2 },
    context: { version: 1, updatedAt: 2, ticket: { id: "ENG-42", subtitle: "API cleanup", description: "Remove stale metadata" } },
  }));
  assert.deepEqual(value, { id: "ENG-42", subtitle: "API cleanup", description: "Remove stale metadata" });
});

test("context supplies identity when workflow has no ticket", () => {
  const value = ticketIdentity(session({ context: { version: 1, updatedAt: 2, ticket: { id: "ENG-42" } } }));
  assert.deepEqual(value, { id: "ENG-42" });
});

test("unlinked sessions have no ticket identity and titles stay independent", () => {
  const value = ticketIdentity(session({ title: "API cleanup" }));
  assert.equal(value, undefined);
  assert.equal(session({ title: "API cleanup" }).title, "API cleanup");
});
