import assert from "node:assert/strict";
import test from "node:test";
import { ConversationReader } from "../src/tui/conversation.js";
import type { ConversationPage } from "../src/core/conversation.js";
const page = (start: number): ConversationPage => ({ branchId: "b", revision: String(start), before: start ? `m${start}` : undefined, items: Array.from({ length: 20 }, (_, i) => ({ id: `m${start + i}`, role: "assistant", text: `Message ${start + i}` })) });

test("a disconnected latest page keeps the missing middle history reloadable", () => {
  const reader = new ConversationReader();
  reader.accept(page(0));
  reader.accept(page(40));
  assert.equal(reader.items[0]!.id, "m40");
  assert.equal(reader.before, "m40");
  reader.accept(page(20), true);
  assert.deepEqual(reader.items.map(item => item.id), Array.from({ length: 40 }, (_, i) => `m${20 + i}`));
});

test("a disconnected update does not move a detached reader; End admits the latest page", () => {
  const reader = new ConversationReader();
  reader.accept(page(0));
  reader.render(60, 10);
  reader.scroll(-4);
  const anchor = { ...reader.anchor! };
  reader.accept(page(40));
  assert.deepEqual(reader.anchor, anchor);
  assert.equal(reader.items.at(-1)!.id, "m19");
  assert.equal(reader.newMessages, true);
  reader.end();
  reader.accept(page(40));
  assert.equal(reader.items[0]!.id, "m40");
});

test("a page that shares nothing with the transcript and has no older history replaces it", () => {
  const reader = new ConversationReader();
  reader.accept({ branchId: "b", revision: "1", items: [{ id: "a1", role: "user", text: "before compaction" }] });
  reader.accept({ branchId: "b", revision: "2", items: [{ id: "n1", role: "user", text: "after" }, { id: "n2", role: "assistant", text: "ok" }] });
  assert.deepEqual(reader.items.map(item => item.id), ["n1", "n2"]);
});

test("an unchanged poll keeps every message object, so nothing is redrawn", () => {
  const reader = new ConversationReader();
  reader.accept(page(0));
  const items = reader.items;
  const second = reader.items[1];
  reader.accept(page(0));
  assert.equal(reader.items, items);
  reader.accept({ ...page(0), items: page(0).items.map(item => item.id === "m5" ? { ...item, text: "changed" } : item) });
  assert.equal(reader.items[1], second);
  assert.equal(reader.items[5]!.text, "changed");
});

test("a branch change opens the new branch at its end, not at a message it shares with the old one", () => {
  const reader = new ConversationReader();
  reader.accept(page(0));
  // A new message is revealed from its start.
  reader.accept({ ...page(0), items: [...page(0).items, { id: "shared", role: "assistant", text: "Shared" }] });
  const forked: ConversationPage = { branchId: "fork", revision: "f", items: [
    { id: "shared", role: "assistant", text: "Shared" },
    ...Array.from({ length: 30 }, (_, i) => ({ id: `f${i}`, role: "assistant" as const, text: `Fork ${i}` })),
  ] };
  reader.accept(forked);
  const lines = reader.render(60, 6);
  assert.match(lines.join("\n"), /Fork 29/u);
  assert.doesNotMatch(lines.join("\n"), /Shared/u);
});
