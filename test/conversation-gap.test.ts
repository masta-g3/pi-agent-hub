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
