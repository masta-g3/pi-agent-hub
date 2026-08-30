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
    { version: 1, updatedAt: 1, attention: { kind: "ready", text: "x".repeat(97) } },
  ]) assert.equal(parseSessionContext(value), undefined);
});
